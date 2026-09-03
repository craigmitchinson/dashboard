import type { AuthProvider } from "./provider";
import type { Session, User } from "./types";
import { GROUP_ROLE_MAPPINGS, mapClaimsToUser as sharedMapClaimsToUser } from "../../shared/auth-mappings.mjs";

// ---------------------------------------------------------------------------
// Entra ID (Azure AD) provider — a real, working auth-code + PKCE
// implementation (no `@azure/msal-browser` dependency — see below).
//
// beginAuthorizeRedirect() sends the browser to Microsoft's login page;
// completeEntraRedirect() (called once at app boot — see auth-context.tsx)
// finishes the flow when the browser lands back with `code`/`state`, storing
// the resulting Session plus ID/refresh/access tokens; tryRenewEntraSession()
// silently refreshes that session off the stored refresh token; and
// getAccessToken() hands callers a live API-scoped access token, renewing
// first if the cached one is missing or near expiry. EntraAuthProvider wires
// these into the AuthProvider interface auth-context.tsx consumes — the same
// shape DevAuthProvider implements, so swapping providers is a one-line
// change there. isEntraConfigured() gates all of this on the env vars below
// being present; signIn() throws NOT_CONFIGURED otherwise.
//
// ---- Config (Vite env vars, read once at module load) --------------------
//
//   VITE_ENTRA_TENANT_ID    required — the Entra tenant to authenticate against.
//   VITE_ENTRA_CLIENT_ID    required — this app's registration's client id.
//   VITE_ENTRA_REDIRECT_URI optional — defaults to window.location.origin.
//   VITE_ENTRA_SCOPES       optional — defaults to "openid profile email";
//                           offline_access is appended automatically so a
//                           refresh token is issued.
//   VITE_ENTRA_API_SCOPE    optional — defaults to `api://<client-id>/.default`
//                           when CLIENT_ID is set; see the API-scope note below.
//
// ---- ID token vs access token: two different audiences --------------------
//
// The ID token (who signed in) always has `aud` == this app's client id —
// checked in decodeAndValidateIdToken below. The ACCESS token (what this app
// is allowed to call) is scoped separately via API_SCOPE and has `aud` ==
// the API's application-id-URI (e.g. `api://<client-id>`), which is what the
// server checks incoming `/api/*` requests against via its own
// `ENTRA_AUDIENCE` env var. Requesting API_SCOPE requires the app
// registration to have an "Expose an API" scope matching that value; without
// it, Microsoft either omits the access token or scopes it to nothing the
// server recognizes, and every `/api/*` call would 401.
//
// ---- Groups overage -------------------------------------------------------
//
// When a signed-in user belongs to too many Entra groups to list directly in
// the ID token, Entra replaces `groups` with a `_claim_names`/
// `_claim_sources` overage pointer (or just `hasgroups: true` with no
// `groups` array), meaning the group list would require a separate
// Microsoft Graph call to resolve. decodeAndValidateIdToken below detects
// both overage shapes and throws rather than silently mapping the user to no
// role — this client-side provider does not perform that Graph lookup (see
// PLAYBOOK.md for the production plan).
//
// ---- Background, for anyone reading this who isn't an engineer -----------
//
// "Entra ID" is Microsoft's current name for what used to be called
// "Azure Active Directory" (Azure AD) — it's Microsoft's cloud identity
// service. It's the thing that already knows every employee's corporate
// login, their manager, and — most usefully for us — which security groups
// they belong to.
//
// To let our dashboard use that login, Microsoft requires us to register
// the dashboard as an "app registration" in Entra ID: a one-time admin
// step in the Azure portal that gives the dashboard a client ID (an
// identifier for "this app") and a list of allowed redirect URLs (where
// Microsoft is allowed to send the user back to after they sign in).
//
// "MSAL" (Microsoft Authentication Library) is the official JavaScript
// library that does the actual sign-in handshake in the browser. We do NOT
// import it here — no new npm dependencies in this prototype — but this is
// the library a real integration would add (`@azure/msal-browser` /
// `@azure/msal-react`). Instead, the handshake below is implemented directly
// with `fetch` and the browser's built-in WebCrypto (`crypto.subtle` /
// `crypto.getRandomValues`).
//
// The handshake performed is called "auth code + PKCE" (Proof Key for
// Code Exchange), and at a high level it goes:
//   1. Our app redirects the browser to a Microsoft login page.
//   2. The user signs in with their normal corporate credentials (and MFA,
//      if the organisation requires it) — WE NEVER SEE THEIR PASSWORD.
//   3. Microsoft redirects the browser back to our app with a short-lived
//      "authorization code" in the URL.
//   4. Our app exchanges that code for tokens — an "ID token"
//      (who the user is) and an "access token" (what the user is allowed
//      to call, not needed here since we don't call Microsoft Graph).
//   5. The ID token is a signed JSON blob of "claims" — user's name,
//      email, unique object id (oid), and — if the app registration is
//      configured to include them — the security groups they belong to.
//
// ---- Mapping Entra groups to our Role / spokeIds --------------------------
//
// Rather than manage roles inside the dashboard, we'd reuse groups the IT
// team already maintains in Entra ID: one group per role, plus one group
// per spoke-lead. GROUP_ROLE_MAPPINGS below is the translation table a real
// integration would use to turn "this user's ID token lists these group
// names" into "this user gets this Role (and, for spoke leads, this
// spokeId)". mapClaimsToUser() below does that translation, fed by the real
// decoded ID token claims once completeEntraRedirect() or
// tryRenewEntraSession() has run.
// ---------------------------------------------------------------------------

/**
 * Entra AD group name → the Role it grants. `spokeFromGroup: true` means the
 * spoke identifier is embedded in the group name itself (see
 * mapClaimsToUser), rather than the group being spoke-agnostic.
 *
 * Group names use the four real spoke short codes: IPI (Insurance, Pensions
 * & Investments), RSK (Risk), COM (Commercial), CLD (Consumer Lending).
 *
 * The actual table now lives in shared/auth-mappings.mjs (repo root) so the
 * SPA and the server-side data API's group→role resolution can never drift
 * apart — this re-export just keeps the name available from this module.
 */
export { GROUP_ROLE_MAPPINGS };

/**
 * Pure function: Entra ID token claims → our User shape. Called by
 * completeEntraRedirect() and tryRenewEntraSession() below with the decoded
 * ID token claims once a sign-in or silent renewal has produced them.
 *
 * Expected claims of interest (standard Entra ID token claims):
 *   - claims.oid: string — the user's unique, stable object id in the tenant.
 *   - claims.name: string — display name.
 *   - claims.preferred_username: string — usually the user's email/UPN.
 *   - claims.groups: string[] — group object-ids or names the token carries
 *     (requires the app registration to be configured to emit group claims,
 *     and typically groups-by-name rather than by GUID for this to be
 *     directly useful without a separate Graph lookup).
 *
 * Delegates to shared/auth-mappings.mjs so the SPA and the server-side API's
 * group->role resolution can never drift apart — this wrapper exists only to
 * keep this module's existing exported name/signature stable for anything
 * importing mapClaimsToUser from here.
 */
export function mapClaimsToUser(claims: Record<string, unknown>): User {
  return sharedMapClaimsToUser(claims) as User;
}

const NOT_CONFIGURED = "Entra ID provider not configured — see PLAYBOOK for app registration + MSAL setup steps.";

// ---------------------------------------------------------------------------
// Config — read once at module load from Vite's import.meta.env.
// ---------------------------------------------------------------------------
const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID as string | undefined;
const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID as string | undefined;
const REDIRECT_URI = (import.meta.env.VITE_ENTRA_REDIRECT_URI as string | undefined) || window.location.origin;
const SCOPES = (import.meta.env.VITE_ENTRA_SCOPES as string | undefined) || "openid profile email";

/**
 * The API-scoped scope requested alongside SCOPES so the token response also
 * includes an ACCESS token this app can present to its own data API — the ID
 * token alone (which SCOPES/openid/profile/email produce) is for "who is
 * this user", never for authorizing API calls.
 *
 * For this to succeed, the app registration must have "Exposed an API"
 * (Azure portal → App registrations → this app → Expose an API) with a scope
 * matching this value. The ID token's `aud` claim always stays the client id
 * (checked in decodeAndValidateIdToken above), while the ACCESS token's `aud`
 * is instead the API's application-id-URI (e.g. `api://<client-id>`) — that's
 * the value the server checks its incoming requests against via its own
 * `ENTRA_AUDIENCE` env var. Without requesting this scope, Microsoft issues
 * an access token scoped to nothing our API recognizes (or none at all), and
 * every `/api/*` call would 401.
 */
const API_SCOPE = (import.meta.env.VITE_ENTRA_API_SCOPE as string | undefined) || (CLIENT_ID ? `api://${CLIENT_ID}/.default` : undefined);

/** Whether enough config is present to attempt Entra sign-in at all. Exported
 * so the Login page can decide whether to enable its "Sign in with
 * Microsoft" button. */
export function isEntraConfigured(): boolean {
  return Boolean(TENANT_ID && CLIENT_ID);
}

// ---------------------------------------------------------------------------
// PKCE + state/nonce helpers — all via WebCrypto, no dependencies.
// ---------------------------------------------------------------------------

function base64UrlEncodeBytes(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically random, base64url-encoded string — used for `state`,
 * `nonce`, and the PKCE `code_verifier`. */
function randomString(len = 64): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

/** SHA-256 hash of `input`, base64url-encoded — the PKCE `code_challenge`. */
async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64UrlEncodeBytes(digest);
}

// ---------------------------------------------------------------------------
// Endpoints — Microsoft identity platform v2.0, per-tenant.
// ---------------------------------------------------------------------------
const AUTHORITY = () => `https://login.microsoftonline.com/${TENANT_ID}`;
const AUTHORIZE_ENDPOINT = () => `${AUTHORITY()}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = () => `${AUTHORITY()}/oauth2/v2.0/token`;

/** The scope string actually requested — SCOPES plus `offline_access` (so a
 * refresh token is issued for silent renewal) and API_SCOPE (so the token
 * response also includes an API-scoped access token), each appended only if
 * not already present. */
function fullScope(): string {
  let scope = SCOPES.includes("offline_access") ? SCOPES : `${SCOPES} offline_access`;
  if (API_SCOPE && !scope.includes(API_SCOPE)) scope = `${scope} ${API_SCOPE}`;
  return scope;
}

// ---------------------------------------------------------------------------
// Pending-flow + session storage.
//
// sessionStorage holds the short-lived PKCE/state/nonce triple — it must not
// survive across tabs or long-term, only across the redirect round trip.
// localStorage holds the resulting session so it survives a reload, mirroring
// dev-provider's convention of a versioned key name.
// ---------------------------------------------------------------------------
const PENDING_KEY = "bp-entra-pending-v1"; // { state, nonce, codeVerifier }
const SESSION_KEY = "bp-entra-session-v1"; // { session: Session, idToken: string, refreshToken?: string, expiresAt: number }

interface PendingFlow {
  state: string;
  nonce: string;
  codeVerifier: string;
}

interface StoredEntraSession {
  session: Session;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  accessToken?: string;
  accessTokenExpiresAt?: number;
}

function readPending(): PendingFlow | undefined {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as PendingFlow;
  } catch {
    return undefined;
  }
}

function writePending(pending: PendingFlow): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* ignore — storage unavailable, redirect round-trip just won't validate */
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function readStored(): StoredEntraSession | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as StoredEntraSession;
  } catch {
    return undefined;
  }
}

function writeStored(stored: StoredEntraSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  } catch {
    /* ignore — session just won't survive a reload */
  }
}

function clearStored(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Authorize redirect.
// ---------------------------------------------------------------------------

/**
 * Kicks off the auth-code + PKCE flow by navigating the browser to
 * Microsoft's login page. NOTE: this function's promise never actually
 * resolves or rejects in practice — `window.location.assign` unloads the
 * page before anything after the call can run. It's typed `Promise<never>`
 * so callers can `await` it for readability/typing even though nothing after
 * the call executes; the real "sign-in completes" moment is a later page
 * load calling `completeEntraRedirect()`.
 */
async function beginAuthorizeRedirect(): Promise<never> {
  const state = randomString();
  const nonce = randomString();
  const codeVerifier = randomString();
  const codeChallenge = await sha256Base64Url(codeVerifier);

  writePending({ state, nonce, codeVerifier });

  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    response_mode: "query",
    scope: fullScope(),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  window.location.assign(`${AUTHORIZE_ENDPOINT()}?${params}`);

  // Unreachable in practice — the line above navigates the browser away.
  // Present only to satisfy TypeScript's control-flow analysis for a
  // function typed to return `Promise<never>`.
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// ID token decode + validation.
// ---------------------------------------------------------------------------

function base64UrlDecodeToString(b64url: string): string {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  return atob(padded);
}

/**
 * Decodes an ID token's claims and sanity-checks them.
 *
 * IMPORTANT: full RS256 SIGNATURE verification against Microsoft's JWKS is
 * deliberately NOT done here. That belongs server-side — e.g. in the data
 * API this dashboard talks to, which is the actual trust boundary that
 * authorizes requests. The browser only sanity-checks the claims of a token
 * it already trusted enough to redirect for (it came back from Microsoft's
 * own token endpoint over TLS in response to a code this same browser
 * session generated) — this is defence-in-depth against a misconfigured
 * app registration or a confused-deputy redirect, not a substitute for
 * server-side verification.
 *
 * `expectedNonce` is `null` for the silent-refresh path, where there is no
 * fresh authorize redirect (and therefore no nonce) to check against.
 */
function decodeAndValidateIdToken(idToken: string, expectedNonce: string | null): Record<string, unknown> {
  let claims: Record<string, unknown>;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("malformed JWT");
    claims = JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch {
    throw new Error("Sign-in failed: couldn't read the returned identity token.");
  }

  if (expectedNonce !== null && claims.nonce !== expectedNonce) {
    throw new Error("Sign-in failed: identity token nonce mismatch.");
  }
  if (claims.aud !== CLIENT_ID) {
    throw new Error("Sign-in failed: identity token was not issued for this application.");
  }
  if (!(typeof claims.exp === "number" && claims.exp * 1000 > Date.now())) {
    throw new Error("Sign-in failed: identity token is already expired.");
  }
  if (!(String(claims.iss).startsWith("https://login.microsoftonline.com/") && String(claims.iss).includes(TENANT_ID!))) {
    throw new Error("Sign-in failed: identity token issuer is untrusted.");
  }

  // Groups overage: when a user belongs to too many groups to list directly
  // in the token, Entra ID replaces `groups` with a `_claim_names`/
  // `_claim_sources` pointer (or, in some configurations, just sets
  // `hasgroups: true` with no `groups` array) telling the caller to fetch
  // the list from Microsoft Graph instead.
  const claimNames = claims._claim_names as Record<string, unknown> | undefined;
  const hasOveragePointer = Boolean(claimNames && typeof claimNames === "object" && "groups" in claimNames);
  const hasGroupsFlagWithoutGroups = claims.hasgroups === true && !Array.isArray(claims.groups);
  if (hasOveragePointer || hasGroupsFlagWithoutGroups) {
    throw new Error(
      "This account belongs to too many Entra ID groups for them to be included directly in the sign-in token (the 'groups overage' case). Resolving this user's roles requires a server-side Microsoft Graph lookup, which this prototype's client-side auth does not perform — see PLAYBOOK.md for the production plan.",
    );
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Redirect completion (authorization code → tokens → session).
// ---------------------------------------------------------------------------

interface TokenResponse {
  id_token: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Called once at app boot. If the current URL is a return from Microsoft's
 * login page (has `code` and `state` query params), completes the PKCE code
 * exchange and returns the resulting Session. Otherwise returns `null`
 * (nothing to do — not mid-redirect).
 */
export async function completeEntraRedirect(): Promise<Session | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return null;

  const pending = readPending();
  if (!pending || pending.state !== state) {
    throw new Error("Sign-in failed: the redirect state did not match — please try signing in again.");
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: pending.codeVerifier,
        scope: fullScope(),
      }),
    });
  } catch {
    throw new Error("Couldn't reach Microsoft's sign-in service — check connectivity and try again.");
  }

  if (!res.ok) {
    let error: string | undefined;
    let errorDescription: string | undefined;
    try {
      const body = await res.json();
      error = body?.error;
      errorDescription = body?.error_description;
    } catch {
      /* ignore — fall through to status-code message */
    }
    throw new Error(`Sign-in failed: ${errorDescription ?? error ?? res.status}`);
  }

  const body = (await res.json()) as TokenResponse;
  const claims = decodeAndValidateIdToken(body.id_token, pending.nonce);

  clearPending();

  const user = mapClaimsToUser(claims);
  const session: Session = { user, issuedAt: new Date().toISOString(), provider: "entra" };
  const expiresAt = Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
  writeStored({
    session,
    idToken: body.id_token,
    refreshToken: body.refresh_token,
    expiresAt,
    accessToken: body.access_token,
    accessTokenExpiresAt: body.access_token ? expiresAt : undefined,
  });

  // Clean the URL so a page refresh doesn't try to re-process the same code.
  window.history.replaceState({}, "", window.location.pathname);

  return session;
}

// ---------------------------------------------------------------------------
// Silent renewal.
// ---------------------------------------------------------------------------

/**
 * Attempts to silently renew the Entra session using the stored refresh
 * token. Returns the renewed Session on success, or `null` if there's
 * nothing to renew or renewal didn't produce a new session.
 *
 * Session-clearing is deliberately NARROW: only an explicit non-ok response
 * FROM the token endpoint (it was reached and rejected the refresh token —
 * genuinely revoked/expired, unrecoverable) clears the stored session. A
 * network/timeout failure reaching the endpoint at all, or a malformed
 * success response, leaves the existing stored session untouched and just
 * returns null — those are transient conditions that say nothing about
 * whether the refresh token itself is still good. This matters because
 * auth-context.tsx calls this on an unconditional periodic timer: treating
 * every failure as "sign the user out" would mean a single network blip
 * during that background check silently drops an otherwise-fine session,
 * which is exactly the failure mode that periodic check exists to prevent.
 */
export async function tryRenewEntraSession(): Promise<Session | null> {
  const stored = readStored();
  if (!stored || !stored.refreshToken) return null;

  let res: Response;
  try {
    res = await fetch(TOKEN_ENDPOINT(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID!,
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        scope: fullScope(),
      }),
    });
  } catch {
    // Couldn't even reach Microsoft's token endpoint — transient, not
    // evidence the refresh token is bad. Leave the stored session alone.
    return null;
  }

  if (!res.ok) {
    // The token endpoint itself rejected the refresh (revoked/expired
    // refresh token, etc.) — this IS unrecoverable, clear it.
    clearStored();
    return null;
  }

  try {
    const body = (await res.json()) as TokenResponse;
    // The refreshed token has no fresh nonce to check (there was no new
    // authorize redirect) — skip that check specifically for this path.
    const claims = decodeAndValidateIdToken(body.id_token, null);
    const user = mapClaimsToUser(claims);
    const session: Session = { user, issuedAt: new Date().toISOString(), provider: "entra" };
    const expiresAt = Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000;
    // Refresh may rotate the refresh token — some IdPs return a new one,
    // some don't; keep the old one if none was returned.
    writeStored({
      session,
      idToken: body.id_token,
      refreshToken: body.refresh_token ?? stored.refreshToken,
      expiresAt,
      accessToken: body.access_token,
      accessTokenExpiresAt: body.access_token ? expiresAt : undefined,
    });
    return session;
  } catch {
    // A 200 response we couldn't parse/validate is a server- or claim-shape
    // surprise, not proof the refresh token is invalid — don't clear a
    // potentially-still-valid stored session over it either.
    return null;
  }
}

// Renew proactively if the cached access token is within this long of expiring,
// rather than waiting for it to actually lapse mid-request.
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * Returns a usable API-scoped access token, or `null` if none is available
 * (not signed in, or renewal failed — caller must fall back to prompting
 * sign-in). Pass `forceRenew: true` to skip the cached-token fast path and
 * always attempt a silent refresh first — used when a request just got a
 * 401 despite what looked like a valid cached token (e.g. server-side
 * revocation, clock skew).
 */
export async function getAccessToken(forceRenew = false): Promise<string | null> {
  if (!forceRenew) {
    const stored = readStored();
    if (stored?.accessToken && stored.accessTokenExpiresAt && stored.accessTokenExpiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return stored.accessToken;
    }
  }
  const renewed = await tryRenewEntraSession();
  if (!renewed) return null;
  return readStored()?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// Provider.
// ---------------------------------------------------------------------------

export class EntraAuthProvider implements AuthProvider {
  async signIn(): Promise<Session> {
    if (!isEntraConfigured()) throw new Error(NOT_CONFIGURED);
    // In practice this call never returns — beginAuthorizeRedirect navigates
    // the browser away before its promise can settle. The real "sign-in
    // completes" moment is completeEntraRedirect() being called on the next
    // page load (wired up in auth-context.tsx).
    return beginAuthorizeRedirect();
  }

  signOut(): void {
    try {
      clearStored();
    } catch {
      /* ignore — mirrors DevAuthProvider's swallow-and-move-on style */
    }
    // A real deployment may additionally redirect to
    // `${AUTHORITY()}/oauth2/v2.0/logout?post_logout_redirect_uri=...` to
    // also end the Microsoft session. That's a small follow-up, not required
    // for this prototype.
  }

  getSession(): Session | null {
    const stored = readStored();
    if (!stored) return null;
    // Expired — caller (auth-context) is responsible for trying
    // tryRenewEntraSession() proactively before this lapses; a lapsed
    // session here just means "not signed in" rather than throwing.
    if (stored.expiresAt <= Date.now()) return null;
    return stored.session;
  }
}
