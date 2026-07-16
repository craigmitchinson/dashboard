// ---------------------------------------------------------------------------
// Reading ruler overlay
// ---------------------------------------------------------------------------
// A translucent horizontal band, fixed to the viewport, that tracks the
// pointer's vertical position (and keyboard focus) to help users keep their
// place while reading. Purely an opt-in accessibility aid, gated on
// prefs.readingRuler from useDisplayPrefs(). Mount this once near the app
// root (e.g. in App.tsx) — it renders nothing when the pref is off, and does
// not attach any listeners in that state either.
import { useEffect, useRef, useState } from "react";
import { useDisplayPrefs } from "./prefs-context";

export function ReadingRuler(): JSX.Element | null {
  const { prefs } = useDisplayPrefs();
  const [y, setY] = useState(0);
  const lastY = useRef(0);
  const rafPending = useRef(false);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    if (!prefs.readingRuler) return;

    const scheduleUpdate = (clientY: number): void => {
      lastY.current = clientY;
      if (rafPending.current) return;
      rafPending.current = true;
      rafId.current = requestAnimationFrame(() => {
        setY(lastY.current);
        rafPending.current = false;
        rafId.current = null;
      });
    };

    const handleMouseMove = (e: MouseEvent): void => {
      scheduleUpdate(e.clientY);
    };

    const handleFocusIn = (e: FocusEvent): void => {
      const target = e.target;
      if (target instanceof Element) {
        const rect = target.getBoundingClientRect();
        scheduleUpdate(rect.top + rect.height / 2);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("focusin", handleFocusIn);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      rafId.current = null;
      rafPending.current = false;
    };
  }, [prefs.readingRuler]);

  if (!prefs.readingRuler) return null;

  const rootFontSize =
    typeof document !== "undefined" ? parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 : 16;
  const bandHeightPx = 2.2 * rootFontSize;
  const halfHeightPx = bandHeightPx / 2;

  return (
    <div
      className="reading-ruler"
      aria-hidden="true"
      style={{
        position: "fixed",
        top: y - halfHeightPx,
        left: 0,
        right: 0,
        height: "2.2em",
        pointerEvents: "none",
      }}
    />
  );
}
