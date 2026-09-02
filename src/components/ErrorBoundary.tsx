// ---------------------------------------------------------------------------
// components/ErrorBoundary.tsx
// ---------------------------------------------------------------------------
// Last-resort crash containment. Used in two places (wired up elsewhere):
// once wrapping the whole app, once wrapping just the active page's canvas so
// a crash in one page doesn't take the surrounding nav chrome down with it.
//
// Deliberately has ZERO dependency on the app's ThemeProvider/useTheme()
// context — that context could itself be unmounted/broken when this fires,
// which is exactly the situation this component exists to survive. Instead:
//   - colours are literal hex values matching this app's dark boot palette
//     (see the pre-App error screen in src/main.tsx: #071316 / #f4f1eb),
//   - fonts reference the app's real global CSS custom properties
//     (--font-body / --font-mono, plain :root variables in src/styles.css,
//     NOT React context) so they still resolve correctly even if theming is
//     broken, since the CSS itself is unaffected by a React-level crash.
// ---------------------------------------------------------------------------

import { Component, useEffect, useState } from "react";
import type { CSSProperties, ErrorInfo, ReactElement, ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Change this value to force-clear a caught error even without a remount
   *  (e.g. App.tsx passes the active page id here so switching pages always
   *  recovers a crashed page boundary). */
  resetKey?: unknown;
  /** Optional label shown in the fallback heading, e.g. "This page" vs "The dashboard" — defaults to "Something". */
  label?: string;
}

interface State {
  error: Error | null;
}

// Reads the boot-screen CSS custom properties (styles.css — light values at
// :root, dark override via `@media (prefers-color-scheme: dark)` only, since
// this renders with zero React context and no `data-theme` attribute is set
// yet this early — see that block's comment) instead of hardcoding this
// app's dark palette, so a light-OS visitor sees a light-mode crash screen
// instead of a dark-on-light mismatch.
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

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`ErrorBoundary (${this.props.label ?? "app"}) caught:`, error, info);
  }

  componentDidUpdate(prevProps: Props) {
    // Lets a page-level boundary self-heal when the user navigates away from
    // the page that crashed it, without requiring the whole subtree to remount.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  handleReset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children as ReactNode;

    const label = this.props.label ?? "Something";
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          height: "100%",
          minHeight: 320,
          padding: 24,
          background: "var(--boot-bg, #071316)",
          color: "var(--boot-ink, #f4f1eb)",
          fontFamily: "var(--font-body)",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h2 style={{ fontFamily: "var(--font-display, Georgia, serif)", fontSize: 19, marginBottom: 8 }}>
            {label} went wrong
          </h2>
          <p style={{ color: "var(--boot-ink-soft)", fontSize: 13.5, lineHeight: 1.6, marginBottom: 16, wordBreak: "break-word" }}>
            {error.message || String(error)}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={this.handleReset} style={btnStyle}>
              Try again
            </button>
            <button onClick={() => window.location.reload()} style={btnStyle}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

// ---------------------------------------------------------------------------
// Global, non-boundary error surfacing.
// ---------------------------------------------------------------------------
// React error boundaries can only catch errors thrown during render/lifecycle
// of their subtree — NOT errors thrown from event handlers, timers, or
// rejected promises. These two exports catch that remaining surface via the
// window-level "error" and "unhandledrejection" events, independent of the
// ErrorBoundary class above.

export function installGlobalErrorHandlers(onError: (message: string) => void): () => void {
  const handleError = (event: ErrorEvent) => {
    console.error(event);
    onError(event.message || "An unexpected error occurred.");
  };
  const handleRejection = (event: PromiseRejectionEvent) => {
    console.error(event);
    const reasonMessage = event.reason instanceof Error ? event.reason.message : String(event.reason);
    onError(`Unhandled promise rejection: ${reasonMessage}`);
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
}

interface Toast {
  id: number;
  message: string;
}

let nextToastId = 1;

// Self-contained toast stack: mounts its own global handlers, keeps its own
// state, and auto-dismisses — a caller drops <GlobalErrorToast /> once near
// the app root and needs nothing else.
export function GlobalErrorToast(): ReactElement | null {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    const dismiss = (id: number) => {
      const timer = timers.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(id);
      }
      setToasts((prev) => prev.filter((t) => t.id !== id));
    };

    const pushToast = (message: string) => {
      const id = nextToastId++;
      setToasts((prev) => [...prev, { id, message }]);
      // Auto-dismiss after ~8s so a toast never blocks a slower reader
      // indefinitely, but doesn't vanish before it can be read either.
      timers.set(
        id,
        setTimeout(() => dismiss(id), 8000),
      );
    };

    const cleanupHandlers = installGlobalErrorHandlers(pushToast);

    return () => {
      cleanupHandlers();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          aria-live="assertive"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            maxWidth: 360,
            padding: "10px 12px",
            background: "#071316",
            color: "#f4f1eb",
            fontFamily: "var(--font-body)",
            fontSize: 13,
            lineHeight: 1.5,
            borderLeft: "3px solid #FF222F",
            borderRadius: 4,
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
          }}
        >
          <span style={{ flex: 1, wordBreak: "break-word" }}>{toast.message}</span>
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            aria-label="Dismiss"
            style={{
              background: "transparent",
              border: "none",
              color: "#f4f1eb",
              opacity: 0.7,
              cursor: "pointer",
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
