import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTheme } from "../theme-context";
import { fonts } from "../theme";
import { useAuth } from "../auth/auth-context";
import { listUsers } from "../auth/dev-provider";
import { highestRoleLabel } from "../auth/types";

// Full-viewport branded sign-in. Rendered inside a dark ThemeProvider by
// App.tsx (there's no persisted theme preference to read before sign-in),
// so it reads chrome colours from useTheme() like every other themed piece
// of the app rather than hardcoding them.
export function Login() {
  const t = useTheme();
  const { signIn } = useAuth();
  const [users] = useState(() => listUsers());
  const [userId, setUserId] = useState<string>(users[0]?.id ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
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

  return (
    <div className="login" style={{ background: t.page, color: t.ink }}>
      <div className="login__card" style={{ background: t.paper, border: `1px solid ${t.ruleSoft}`, boxShadow: t.shadow }}>
        <div className="login__brand">
          <span className="login__badge" style={{ background: t.accentFill, fontFamily: fonts.display }}>IA</span>
          <div>
            <div className="login__title" style={{ fontFamily: fonts.display, color: t.ink }}>Intelligent Automation</div>
            <div className="login__subtitle" style={{ fontFamily: fonts.mono, color: t.inkSoft }}>Performance dashboard</div>
          </div>
        </div>

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
            style={{ background: t.themeBand, color: t.ink, border: `1px solid ${t.ruleSoft}` }}
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
            style={{ background: t.themeBand, color: t.ink, border: `1px solid ${t.ruleSoft}` }}
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

        <button
          type="button"
          className="login__sso-btn"
          disabled
          aria-disabled="true"
          title="Coming soon — Entra ID integration pending"
        >
          <span className="login__sso-icon" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          Sign in with Microsoft
        </button>
        <p className="login__note" style={{ color: t.inkSoft }}>
          Production sign-in will use "Sign in with Microsoft" via Entra ID — every seeded demo account above uses the
          passphrase <code>demo</code>.
        </p>
      </div>
    </div>
  );
}
