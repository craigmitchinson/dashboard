// ---------------------------------------------------------------------------
// data/client.ts
// ---------------------------------------------------------------------------
// The single place in the app that knows whether we're running against the
// static local JSON export (default, `npm run data:build` output) or a live
// API (VITE_API_URL set at build time). Every network read/write the app
// performs — booting the model, polling API health, reading/writing the
// editable reference data — goes through this module so retry/timeout/error
// handling is defined exactly once instead of scattered across callers.
//
// DATA_MODE mirrors the swap-point comment in src/main.tsx / src/rpaData.ts:
// local mode reads /data/model.json (or VITE_DATA_URL) as a flat static file;
// api mode talks to a small REST surface in front of the live warehouse. The
// two modes share fetchModel() as their single boot entry point.
// ---------------------------------------------------------------------------

import type { ModelJson } from "../rpaData";
import type { ReferenceJson } from "../reference/reference-store";

// --- mode + base URL ---------------------------------------------------------

export const DATA_MODE: "api" | "local" = import.meta.env.VITE_API_URL ? "api" : "local";

// Strip any trailing slash(es) so callers can always write `${API_BASE}/api/x`
// without worrying whether the env var was configured with or without one.
export const API_BASE: string | undefined = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace(/\/+$/, "")
  : undefined;

// --- error type ---------------------------------------------------------------

// A single error shape for every failure mode this module can produce, so UI
// code can branch on `kind` (e.g. show a "retry" affordance for network/timeout,
// but not for schema errors, which won't fix themselves on retry) without
// parsing message strings. `message` is always written to be shown to a user
// as-is, not a raw stack/exception string.
export class DataError extends Error {
  kind: "network" | "http" | "timeout" | "schema" | "auth";
  status?: number;

  constructor(message: string, kind: "network" | "http" | "timeout" | "schema" | "auth", status?: number) {
    super(message);
    this.name = "DataError";
    this.kind = kind;
    this.status = status;
  }
}

// --- retry/backoff helpers ---------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Base delay doubles per attempt (300ms, 600ms, 1200ms, ...) with up to 30%
// random jitter ADDED on top — never subtracted — so a caller never waits
// *less* than the plain exponential backoff would, only ever a bit more.
// That avoids every retrying client waking up in lockstep and re-hammering a
// struggling server at exactly the same moments (classic thundering herd).
function jitteredBackoff(attempt: number): number {
  const base = 300 * Math.pow(2, attempt);
  const jitter = base * 0.3 * Math.random();
  return base + jitter;
}

// --- fetch with timeout -------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // AbortError from OUR OWN controller means we timed out, not that the
    // caller cancelled us (we never expose the controller to callers), so
    // any abort observed here is unambiguously a timeout.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new DataError(`Timed out after ${timeoutMs}ms fetching ${url}`, "timeout");
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new DataError(`Network error contacting ${url}: ${message}`, "network");
  } finally {
    clearTimeout(timer);
  }
}

// --- auth header injection ----------------------------------------------------

// Injectable bearer-token getter, registered by src/auth/auth-context.tsx
// (and, for the very first boot-time fetch, by src/main.tsx directly) when
// the active auth provider can supply an API-scoped access token — today,
// only EntraAuthProvider. Dev mode never registers one, so authHeaders()
// below is always a no-op for it, matching today's unauthenticated local
// dev experience exactly.
let authTokenProvider: ((forceRenew?: boolean) => Promise<string | null>) | null = null;

export function setAuthTokenProvider(fn: ((forceRenew?: boolean) => Promise<string | null>) | null): void {
  authTokenProvider = fn;
}

async function withAuthHeader(init: RequestInit | undefined, forceRenew: boolean): Promise<RequestInit | undefined> {
  if (DATA_MODE !== "api" || !authTokenProvider) return init;
  const token = await authTokenProvider(forceRenew);
  if (!token) return init;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

// Adds a bearer token (when one is available) and, on an unrecoverable
// 401, attempts exactly ONE forced token renewal + retry before giving up.
// This is the auth-aware layer every read AND write below goes through —
// fetchWithTimeout itself stays auth-agnostic.
async function fetchAuthed(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  let res = await fetchWithTimeout(url, await withAuthHeader(init, false), timeoutMs);
  if (res.status === 401 && DATA_MODE === "api" && authTokenProvider) {
    res = await fetchWithTimeout(url, await withAuthHeader(init, true), timeoutMs);
    if (res.status === 401) {
      throw new DataError("Your session has expired — please sign in again.", "auth", 401);
    }
  }
  return res;
}

// --- GET with retry (internal — reads only, never used for writes) -----------

async function fetchJsonWithRetry<T>(
  url: string,
  opts?: { attempts?: number; timeoutMs?: number; init?: RequestInit },
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const timeoutMs = opts?.timeoutMs ?? 12000;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const isLastAttempt = attempt === attempts - 1;
    let res: Response;
    try {
      res = await fetchAuthed(url, opts?.init, timeoutMs);
    } catch (err) {
      // Only timeout/network failures are retryable — both are transient
      // conditions on the wire, distinct from an HTTP error response (which
      // is handled below with its own retry rule based on status code).
      if (err instanceof DataError && (err.kind === "timeout" || err.kind === "network")) {
        if (isLastAttempt) throw err;
        await sleep(jitteredBackoff(attempt));
        continue;
      }
      throw err;
    }

    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429;
      if (!retryable || isLastAttempt) {
        throw new DataError(`${url} returned ${res.status} ${res.statusText}`, "http", res.status);
      }
      // Honour Retry-After when the server gives one (common on 429s) rather
      // than guessing at a backoff it didn't ask for.
      const retryAfterHeader = res.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader !== null ? Number(retryAfterHeader) * 1000 : NaN;
      const waitMs = Number.isFinite(retryAfterMs) ? retryAfterMs : jitteredBackoff(attempt);
      await sleep(waitMs);
      continue;
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      // Bad JSON is not a transient condition — retrying would just get the
      // same malformed body again — so this fails immediately, unlike the
      // timeout/network/5xx cases above.
      const message = err instanceof Error ? err.message : String(err);
      throw new DataError(`${url} returned invalid JSON: ${message}`, "schema");
    }
  }

  // Unreachable: the loop above always returns or throws on its final
  // iteration. Present only to satisfy the function's return type.
  throw new DataError(`${url}: exhausted retry attempts`, "network");
}

// --- model schema validation --------------------------------------------------

// These are exactly the top-level array fields of ModelJson (src/rpaData.ts) —
// keep this list in step with that interface if it grows new array fields.
const REQUIRED_MODEL_ARRAYS = [
  "spokes",
  "propositions",
  "processes",
  "resources",
  "exceptionReasons",
  "estateRateByDate",
  "dayRows",
  "excRows",
  "resRows",
] as const;

export function validateModelJson(json: unknown): ModelJson {
  if (typeof json !== "object" || json === null) {
    throw new DataError("Model data is malformed: expected a JSON object at the top level.", "schema");
  }
  const obj = json as Record<string, unknown>;

  for (const key of REQUIRED_MODEL_ARRAYS) {
    if (!Array.isArray(obj[key])) {
      throw new DataError(`Model data is malformed: expected "${key}" to be an array.`, "schema");
    }
  }
  if (typeof obj.meta !== "object" || obj.meta === null) {
    throw new DataError('Model data is malformed: expected "meta" to be an object.', "schema");
  }
  if (typeof obj.reference !== "object" || obj.reference === null) {
    throw new DataError('Model data is malformed: expected "reference" to be an object.', "schema");
  }

  return json as ModelJson;
}

// --- URLs ----------------------------------------------------------------------

// Preserves EXACTLY the existing DATA_URL expression from src/main.tsx — local
// mode behaviour must not change when main.tsx is wired to call fetchModel()
// instead of fetching inline.
const LOCAL_DATA_URL = import.meta.env.VITE_DATA_URL || `${import.meta.env.BASE_URL}data/model.json`;

export const MODEL_URL: string = DATA_MODE === "api" ? `${API_BASE}/api/model` : LOCAL_DATA_URL;
export const HEALTH_URL: string | undefined = DATA_MODE === "api" ? `${API_BASE}/api/health` : undefined;
export const REFERENCE_URL: string | undefined = DATA_MODE === "api" ? `${API_BASE}/api/reference` : undefined;

// --- model boot ------------------------------------------------------------

// The ONE function used to boot the app, in both local and api mode — MODEL_URL
// already branches on DATA_MODE, so callers never need to.
export async function fetchModel(): Promise<ModelJson> {
  const json = await fetchJsonWithRetry<unknown>(MODEL_URL, { attempts: 3, timeoutMs: 15000 });
  return validateModelJson(json);
}

// --- health ----------------------------------------------------------------

// GET {API}/api/health -> { ok, dataThrough, lastPullAt, dbOk, version }
export interface HealthStatus {
  ok: boolean;
  dataThrough: string;
  lastPullAt: string | null;
  dbOk: boolean;
  version: string;
}

export async function fetchHealth(): Promise<HealthStatus> {
  if (HEALTH_URL === undefined) {
    throw new DataError(
      'fetchHealth called while DATA_MODE is "local" — there is no health endpoint to poll.',
      "network",
    );
  }
  // Only 2 attempts: this is called on a 60s poll interval elsewhere, and a
  // caller polling every 60s doesn't want a single poll eating 15+ seconds
  // retrying — a failed poll just tries again next interval.
  return fetchJsonWithRetry<HealthStatus>(HEALTH_URL, { attempts: 2, timeoutMs: 8000 });
}

// --- reference data (read + write) ------------------------------------------

// GET  {API}/api/reference -> { reference: ReferenceJson, version, updatedAt, updatedBy }
// PUT  {API}/api/reference body { reference, actor, section }, header
//      If-Match: <version> -> 200 { version, updatedAt } | 409 { current: <same shape as GET> } | 403
export interface ReferenceApiGetResponse {
  reference: ReferenceJson;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export async function fetchReferenceApi(): Promise<ReferenceApiGetResponse> {
  if (REFERENCE_URL === undefined) {
    throw new DataError(
      'fetchReferenceApi called while DATA_MODE is "local" — there is no reference endpoint to read.',
      "network",
    );
  }
  return fetchJsonWithRetry<ReferenceApiGetResponse>(REFERENCE_URL, { attempts: 3, timeoutMs: 12000 });
}

export type PutReferenceResult =
  | { ok: true; version: number; updatedAt: string }
  | { ok: false; kind: "conflict"; current: ReferenceApiGetResponse }
  | { ok: false; kind: "forbidden"; message: string }
  | { ok: false; kind: "auth"; message: string }
  | { ok: false; kind: "error"; message: string };

// A WRITE, so — unlike every read above — this does NOT go through
// fetchJsonWithRetry: retrying a PUT blind risks double-applying an edit if
// the first attempt actually succeeded but the response was lost. Exactly one
// attempt; the caller (src/reference/backend.ts) decides what to do next,
// including re-fetching and re-offering the edit on conflict/failure.
export async function putReferenceApi(
  body: { reference: ReferenceJson; actor?: string; section?: string },
  expectedVersion: number,
): Promise<PutReferenceResult> {
  try {
    if (REFERENCE_URL === undefined) {
      // Programmer error if hit — api-mode-only code should be the only
      // caller — but still surfaced as a DataError like everything else here
      // rather than a raw throw, since we're inside this function's own
      // try/catch and want the same handling path as any other failure.
      throw new DataError(
        'putReferenceApi called while DATA_MODE is "local" — there is no reference endpoint to write to.',
        "network",
      );
    }

    const res = await fetchAuthed(
      REFERENCE_URL,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", "If-Match": String(expectedVersion) },
        body: JSON.stringify(body),
      },
      15000,
    );

    if (res.status === 409) {
      try {
        const parsed = (await res.json()) as { current: ReferenceApiGetResponse };
        return { ok: false, kind: "conflict", current: parsed.current };
      } catch {
        return {
          ok: false,
          kind: "error",
          message: "Server reported a conflict but returned an unreadable response.",
        };
      }
    }

    if (res.status === 403) {
      // Server error bodies use { error: string }, not { message: string }
      // (see server/src/auth/middleware.ts / routes/reference.ts) — read the
      // real field name rather than a guessed one.
      try {
        const parsed = (await res.json()) as { error?: string };
        return { ok: false, kind: "forbidden", message: parsed.error ?? "You don't have permission to save this change." };
      } catch {
        return { ok: false, kind: "forbidden", message: "You don't have permission to save this change." };
      }
    }

    if (!res.ok) {
      // Same { error: string } shape applies to 400 (schema validation /
      // missing If-Match) and any other unexpected status — prefer the
      // servers own message when it sends one readable JSON body.
      try {
        const parsed = (await res.json()) as { error?: string };
        return { ok: false, kind: "error", message: parsed.error ?? `Save failed: ${res.status} ${res.statusText}` };
      } catch {
        return { ok: false, kind: "error", message: `Save failed: ${res.status} ${res.statusText}` };
      }
    }

    const parsed = (await res.json()) as { version: number; updatedAt: string };
    return { ok: true, version: parsed.version, updatedAt: parsed.updatedAt };
  } catch (err) {
    // putReferenceApi must NEVER throw — callers (src/reference/backend.ts)
    // rely on it always resolving, so every failure path (network, timeout,
    // JSON parsing) collapses into an { ok: false, ... } shape. An auth
    // failure (fetchAuthed already tried a forced renewal + retry) is
    // surfaced as its own kind so a caller can special-case it (e.g. prompt
    // sign-in) rather than showing a generic error.
    if (err instanceof DataError && err.kind === "auth") return { ok: false, kind: "auth", message: err.message };
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: "error", message };
  }
}
