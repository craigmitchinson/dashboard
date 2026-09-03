import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTheme } from "../theme-context";
import { fonts, glassOverlayVars } from "../theme";
import { useAuth, lastEntraError } from "../auth/auth-context";
import { listUsers } from "../auth/dev-provider";
import { isEntraConfigured } from "../auth/entra-provider";
import { highestRoleLabel } from "../auth/types";

// Which provider is active — the ONLY other place this same check is made is
// auth-context.tsx's own provider selection. Reading the env var directly
// here (rather than exporting a helper from auth/**, which isn't ours to
// touch) keeps the two in lockstep without adding a dependency either way.
const ENTRA_MODE = import.meta.env.VITE_AUTH_PROVIDER === "entra";

// Full-viewport branded sign-in. Rendered inside a dark ThemeProvider by
// App.tsx (there's no persisted theme preference to read before sign-in),
// so it reads chrome colours from useTheme() like every other themed piece
// of the app rather than hardcoding them.
export function Login() {
  const t = useTheme();
  const { signIn } = useAuth();
  const [users] = useState(() => (ENTRA_MODE ? [] : listUsers()));
  const [userId, setUserId] = useState<string>(users[0]?.id ?? "");
  const [passphrase, setPassphrase] = useState("");
  // Entra mode: a redirect-completion failure (see auth-context.tsx) lands
  // here via the module-level `lastEntraError`, not a thrown promise — the
  // PKCE round trip is a full page navigation, so there's no in-flight
  // signIn() call left to reject by the time this component (re)mounts.
  // Best-effort only: if the exchange is still in flight when this check
  // runs, it'll still be null and nothing shows — see auth-context.tsx's own
  // comment on the same limitation.
  const [error, setError] = useState<string | null>(() => (ENTRA_MODE ? lastEntraError : null));
  const [busy, setBusy] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);
  const msButtonRef = useRef<HTMLButtonElement>(null);
  const entraConfigured = isEntraConfigured();

  useEffect(() => {
    if (ENTRA_MODE) {
      msButtonRef.current?.focus();
    } else {
      firstFieldRef.current?.focus();
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await signIn({ userId, passphrase });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  // Entra mode: signIn() with no credentials starts the PKCE redirect (see
  // auth-context.tsx / entra-provider.ts) — on success this navigates the
  // whole page away to Microsoft's login and never resolves here, so `busy`
  // is only ever cleared by the catch path (a same-tab failure, e.g. popup
  // blocked or config rejected before the redirect fires).
  const handleMicrosoftSignIn = async () => {
    if (busy || !entraConfigured) return;
    setError(null);
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    // `backgroundColor`, not the `background` shorthand — `.login` in
    // styles.css sets `background-image` (the same ambient gradient as
    // `.report`, picked via prefers-color-scheme since there's no signed-in
    // theme preference yet); the shorthand would reset that layer to none.
    <div className="login" style={{ backgroundColor: t.page, color: t.ink }}>
      <div className="login__card glass-overlay" style={glassOverlayVars(t)}>
        <div className="login__brand">
          <span className="login__badge" style={{ background: t.accentFill, fontFamily: fonts.display }}>IA</span>
          <div>
            <div className="login__title" style={{ fontFamily: fonts.display, color: t.ink }}>Intelligent Automation</div>
            <div className="login__subtitle" style={{ fontFamily: fonts.mono, color: t.inkSoft }}>Performance dashboard</div>
          </div>
        </div>

        {!ENTRA_MODE && (
          <>
            <form onSubmit={handleSubmit}>
              <label htmlFor="login-user" style={{ color: t.inkSoft }}>Sign in as</label>
              <select
                id="login-user"
                ref={firstFieldRef}
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setError(null);
                }}
                style={{ background: t.themeBand, color: t.ink, border: `1px solid ${t.ruleSoft}`, colorScheme: "dark" }}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {highestRoleLabel(u.roles)}
                  </option>
                ))}
              </select>

              <label htmlFor="login-pass" style={{ color: t.inkSoft }}>Passphrase</label>
              <input
                id="login-pass"
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setError(null);
                }}
                style={{ background: t.themeBand, color: t.ink, border: `1px solid ${t.ruleSoft}`, colorScheme: "dark" }}
              />

              {error && (
                <p className="login__error" role="alert" aria-live="assertive" style={{ color: t.accent }}>
                  {error}
                </p>
              )}

              <button type="submit" className="login__submit" disabled={busy} style={{ background: t.accentFill, fontFamily: fonts.mono }}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <div className="login__divider" style={{ color: t.inkSoft }}>
              <span style={{ background: t.ruleSoft }} />
              or
              <span style={{ background: t.ruleSoft }} />
            </div>
          </>
        )}

        <button
          ref={msButtonRef}
          type="button"
          className="login__sso-btn"
          disabled={!entraConfigured || busy}
          aria-disabled={!entraConfigured || busy}
          title={
            entraConfigured
              ? undefined
              : "Coming soon — Entra ID integration pending. Needs VITE_AUTH_PROVIDER=entra, VITE_ENTRA_TENANT_ID and VITE_ENTRA_CLIENT_ID."
          }
          onClick={entraConfigured ? handleMicrosoftSignIn : undefined}
        >
          <span className="login__sso-icon" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          {busy && entraConfigured ? "Signing in…" : "Sign in with Microsoft"}
        </button>

        {ENTRA_MODE && error && (
          <p className="login__error" role="alert" aria-live="assertive" style={{ color: t.accent }}>
            {error}
          </p>
        )}

        {!ENTRA_MODE && (
          <p className="login__note" style={{ color: t.inkSoft }}>
            Production sign-in will use "Sign in with Microsoft" via Entra ID — every seeded demo account above uses the
            passphrase <code>demo</code>.
          </p>
        )}
      </div>
    </div>
  );
}
