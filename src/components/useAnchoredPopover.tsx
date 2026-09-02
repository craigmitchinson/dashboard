import { useEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

// ---------------------------------------------------------------------------
// components/useAnchoredPopover.tsx
// ---------------------------------------------------------------------------
// Positions a Portal-rendered popover panel against a trigger element,
// without the panel being a DOM descendant of the trigger (getBoundingClientRect
// + position:fixed, recomputed on open, scroll and resize — NOT on every
// render, so this is cheap while the popover sits open and idle).
//
// Flips above the trigger when there isn't ~260px of room below it and there
// IS more room above (the "near the bottom edge" case), and clamps
// horizontally so the panel never runs off the right edge of the viewport
// (the "near the right edge" case) — both driven by the trigger's own
// getBoundingClientRect(), not a guessed viewport threshold.
//
// Coordination: only one popover opened through this hook stays open at a
// time (module-level, not React state — see the guardrail in styles.css's
// glass-material comment: "≤2 persistent + 1 transient backdrop-filter
// surface on screen"). Opening a second one asks whichever popover opened
// first to close via the `onRequestClose` callback each caller supplies.
// NotificationBell's own dropdown (src/alerts/NotificationBell.tsx) does not
// yet participate — that file's portal adoption is deferred to the next
// worker — so it is the one known gap in this guarantee today.
// ---------------------------------------------------------------------------

export interface AnchoredPosition {
  position: "fixed";
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  minWidth?: number;
  maxWidth?: number;
}

let activeClose: (() => void) | null = null;

export function useAnchoredPopover(
  triggerRef: RefObject<HTMLElement>,
  open: boolean,
  onRequestClose: () => void,
  opts?: { align?: "start" | "end"; width?: number; gap?: number },
): CSSProperties | null {
  const [pos, setPos] = useState<AnchoredPosition | null>(null);
  const align = opts?.align ?? "start";
  const gap = opts?.gap ?? 6;

  // Mutual exclusion: opening this popover closes whatever previously
  // registered one is still open.
  useEffect(() => {
    if (!open) return;
    if (activeClose && activeClose !== onRequestClose) activeClose();
    activeClose = onRequestClose;
    return () => {
      if (activeClose === onRequestClose) activeClose = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function update() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const width = opts?.width ?? Math.max(r.width, 180);

      let left = align === "end" ? r.right - width : r.left;
      left = Math.min(Math.max(8, left), Math.max(8, vw - width - 8));

      const spaceBelow = vh - r.bottom;
      const spaceAbove = r.top;
      const flipUp = spaceBelow < 280 && spaceAbove > spaceBelow;

      setPos({
        position: "fixed",
        left,
        minWidth: width,
        maxWidth: Math.min(360, vw - 16),
        ...(flipUp ? { bottom: vh - r.top + gap } : { top: r.bottom + gap }),
      });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align, opts?.width, gap]);

  if (!pos) return null;
  return pos as CSSProperties;
}
