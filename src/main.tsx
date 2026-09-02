import { StrictMode, useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initData } from "./rpaData";
import { ErrorBoundary, GlobalErrorToast } from "./components/ErrorBoundary";
import { DATA_MODE, DataError, fetchModel, setAuthTokenProvider } from "./data/client";
import { completeEntraRedirect, EntraAuthProvider, getAccessToken, isEntraConfigured } from "./auth/entra-provider";
import "./styles.css";

// ---------------------------------------------------------------------------
// Boot sequence. THE SWAP POINT for the frontend:
//   - local mode (default, VITE_API_URL unset): the static /data/model.json
//     baked by `npm run data:build` (mock CSV today, a real export tomorrow —
//     same schema, same file).
//   - api mode (VITE_API_URL set): a live data API serving the same JSON
//     shape (src/data/client.ts's fetchModel() already branches on this —
//     nothing below needs to know which mode it's in beyond that).
//
// Unlike the old inline `fetch(...).then(...)` version of this file, the app
// is never left on a blank white screen: a themed loading screen renders
// FIRST, synchronously, before any network activity starts; a themed error
// screen (with Retry, no full reload) replaces it on failure; the real App
// only mounts once initData() has installed a fully-populated model — every
// other module keeps reading the same live `let` bindings from rpaData.ts it
// always has.
// ---------------------------------------------------------------------------

const root = createRoot(document.getElementById("root")!);

// A second, independent React root for the global error toast — mounted
// once, immediately, regardless of what the main root is currently showing
// (loading / error / the app itself), so an error surfaced via
// window.onerror/unhandledrejection is never lost just because the main
// root happens to be mid-transition. Created as a plain DOM node appended to
// <body> rather than touching index.html (not owned by this task).
const toastHost = document.createElement("div");
toastHost.id = "global-error-toast-root";
document.body.appendChild(toastHost);
createRoot(toastHost).render(
  <StrictMode>
    <GlobalErrorToast />
  </StrictMode>,
);

// --- themed screens (zero dependency on ThemeProvider/React context — see
// ErrorBoundary.tsx's file header for why: literal hex colours matching the
// app's dark boot palette, fonts via the app's real global CSS vars). -------

// Reads the boot CSS custom properties (styles.css) rather than hardcoding
// this app's dark palette — see that block's comment for why: these screens
// render with zero React context (no ThemeProvider yet), so a plain CSS var
// with a `@media (prefers-color-scheme: dark)` override is the only themeable
// lever available this early, and it's what makes a light-OS visitor see a
// light boot screen instead of the old dark-regardless-of-preference one.
function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        height: "100vh",
        background: "var(--boot-bg, #071316)",
        color: "var(--boot-ink, #f4f1eb)",
        fontFamily: "var(--font-body)",
      }}
    >
      <div style={{ maxWidth: 520, textAlign: "center" }}>{children}</div>
    </div>
  );
}

// Themed boot skeleton (§6): nav rail outline + top band + six shimmering
// KPI blocks, rendered synchronously before any network activity starts —
// replaces the old plain "Loading…" text so the very first paint already
// reads as "this app", not a blank/generic loading state. prefers-color-
// scheme aware via the same --boot-* vars as Shell (no ThemeProvider yet).
function SkeletonBlock({ style }: { style?: CSSProperties }) {
  return <div className="boot-shimmer" style={{ borderRadius: 10, ...style }} />;
}

function LoadingScreen() {
  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--boot-bg, #071316)", overflow: "hidden" }}>
      <div style={{ width: 232, flex: "0 0 auto", borderRight: "1px solid var(--boot-btn-border)", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonBlock style={{ height: 32, width: 32, borderRadius: 9, marginBottom: 12 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} style={{ height: 32 }} />
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ height: 56, flex: "0 0 auto", borderBottom: "1px solid var(--boot-btn-border)", display: "flex", alignItems: "center", padding: "0 24px" }}>
          <SkeletonBlock style={{ height: 18, width: 220 }} />
        </div>
        <div style={{ flex: 1, padding: 24, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, alignContent: "start" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} style={{ height: 120 }} />
          ))}
        </div>
        <div role="status" className="sr-only">
          Loading Intelligent Automation — fetching the latest performance data.
        </div>
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  textTransform: "uppercase",
  fontSize: 12,
  letterSpacing: "0.04em",
  padding: "8px 16px",
  borderRadius: 6,
  border: "1px solid var(--boot-btn-border, rgba(244, 241, 235, 0.35))",
  background: "var(--boot-btn-bg, rgba(244, 241, 235, 0.08))",
  color: "var(--boot-ink, #f4f1eb)",
  cursor: "pointer",
};

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function startEntraSignIn() {
  new EntraAuthProvider().signIn().catch((err) => {
    console.error("Entra sign-in failed to start:", err);
  });
}

// Signed-in-via-Entra-required gate: shown BEFORE any model fetch is even
// attempted, only when DATA_MODE is "api", Entra is the active auth
// provider, and neither a just-completed redirect nor a cached session
// produced anything to use — a real Entra deployment's /api/* routes
// require a bearer token on every request (see server/src/auth/middleware.ts),
// so attempting the model fetch first would just guarantee an immediate,
// confusing 401 on a brand-new visitor's very first load.
function SignInGate({ message }: { message?: string }) {
  return (
    <Shell>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 8 }}>Sign in to continue</h1>
      <p style={{ opacity: 0.75, fontSize: 13.5, lineHeight: 1.6, marginBottom: 16 }}>
        {message ?? "This dashboard's data comes from an API that requires you to sign in first."}
      </p>
      <button style={btnStyle} onClick={startEntraSignIn}>
        Sign in with Microsoft
      </button>
    </Shell>
  );
}

function ErrorScreen({
  message,
  lastAttempt,
  onRetry,
  showSignIn,
}: {
  message: string;
  lastAttempt: Date;
  onRetry: () => void;
  showSignIn: boolean;
}) {
  return (
    <Shell>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: 20, marginBottom: 8 }}>Couldn't load dashboard data</h1>
      <p style={{ opacity: 0.75, fontSize: 13.5, lineHeight: 1.6, marginBottom: 6, wordBreak: "break-word" }}>{message}</p>
      <p style={{ opacity: 0.55, fontSize: 11.5, fontFamily: "var(--font-mono)", marginBottom: 16 }}>Last attempt {fmtTime(lastAttempt)}</p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        {showSignIn && (
          <button style={btnStyle} onClick={startEntraSignIn}>
            Sign in with Microsoft
          </button>
        )}
        <button style={btnStyle} onClick={onRetry}>
          Retry
        </button>
      </div>
    </Shell>
  );
}

type BootState =
  | { phase: "loading" }
  | { phase: "sign-in"; message?: string }
  | { phase: "error"; message: string; lastAttempt: Date; showSignIn: boolean }
  | { phase: "ready" };

// Owns the retry loop so clicking "Retry" re-fetches without a full page
// reload — `attempt` is bumped to re-run the boot effect from scratch; no
// other state needs to survive a retry.
function Boot() {
  const [state, setState] = useState<BootState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });

    async function boot() {
      // In api mode with Entra configured as the active provider, resolve
      // (or establish) a session BEFORE attempting the model fetch — see
      // SignInGate's comment above for why. This also has the side effect
      // of persisting a session to localStorage the moment a
      // redirect-return is detected, so if AuthContextProvider (mounted
      // later, inside App, once we're past this gate) also happens to call
      // completeEntraRedirect() itself, it correctly finds nothing left to
      // do (the URL is already cleaned) and just picks up the session from
      // storage on its own lazy getSession() read.
      if (DATA_MODE === "api" && import.meta.env.VITE_AUTH_PROVIDER === "entra") {
        try {
          await completeEntraRedirect();
        } catch (err) {
          if (cancelled) return;
          console.error("Entra redirect completion failed during boot:", err);
          setState({
            phase: "error",
            message: err instanceof Error ? err.message : String(err),
            lastAttempt: new Date(),
            showSignIn: isEntraConfigured(),
          });
          return;
        }
        setAuthTokenProvider(getAccessToken);
        const hasSession = new EntraAuthProvider().getSession() != null;
        if (!hasSession) {
          if (!cancelled) setState({ phase: "sign-in" });
          return;
        }
      }

      try {
        const model = await fetchModel();
        if (cancelled) return;
        initData(model);
        setState({ phase: "ready" });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        const isAuthFailure = err instanceof DataError && err.kind === "auth";
        setState({ phase: "error", message, lastAttempt: new Date(), showSignIn: isAuthFailure && isEntraConfigured() });
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.phase === "loading") return <LoadingScreen />;
  if (state.phase === "sign-in") return <SignInGate message={state.message} />;
  if (state.phase === "error") {
    return (
      <ErrorScreen
        message={state.message}
        lastAttempt={state.lastAttempt}
        showSignIn={state.showSignIn}
        onRetry={() => setAttempt((a) => a + 1)}
      />
    );
  }

  return (
    <ErrorBoundary label="The dashboard">
      <App />
    </ErrorBoundary>
  );
}

root.render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
