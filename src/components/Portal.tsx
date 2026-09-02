import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// components/Portal.tsx
// ---------------------------------------------------------------------------
// Renders `children` into a dedicated <div> appended to document.body,
// outside the React tree's normal DOM position. Required for every floating
// popover/dialog that sits inside (or behind, in paint order) a
// backdrop-filter surface (the nav rail, the sticky top band): a child of a
// backdrop-filter parent can only ever blur that parent's own backdrop
// snapshot, not the real page behind it — see the .glass-persistent /
// .glass-overlay material notes in src/styles.css.
//
// The host div is created once per mount (lazy ref, not state, so it's
// stable across re-renders and never recreated) and cleaned up on unmount.
// Positioning is the caller's job (see useAnchoredPopover.tsx) — this
// component only handles WHERE in the DOM the content lives, not where it's
// drawn on screen.
// ---------------------------------------------------------------------------

export function Portal({ children }: { children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    hostRef.current = document.createElement("div");
  }

  useEffect(() => {
    const host = hostRef.current!;
    document.body.appendChild(host);
    return () => {
      if (host.parentNode) host.parentNode.removeChild(host);
    };
  }, []);

  return createPortal(children, hostRef.current);
}
