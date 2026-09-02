import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fonts, glassOverlayVars } from "../theme";
import { useTheme } from "../theme-context";
import { Portal } from "./Portal";
import { useAnchoredPopover } from "./useAnchoredPopover";
import { IconMore } from "./icons";

// ---------------------------------------------------------------------------
// components/HeaderOverflowMenu.tsx
// ---------------------------------------------------------------------------
// The "⋯" header control that absorbs Accessibility + Theme once the header
// container drops below 1200px (see the `.hdr-overflow-trigger` container
// query in styles.css). Same menu keyboard pattern as ViewsMenu/UserMenu in
// App.tsx (arrow up/down with wraparound, Esc closes + returns focus to the
// trigger, focus moves to the first item on open) — role="menu"/"menuitem"
// rather than those two's implicit listbox-ish button list, since this one
// really is a command menu (each item fires an action and closes).
// ---------------------------------------------------------------------------

export interface OverflowItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

export function HeaderOverflowMenu({ items, className }: { items: OverflowItem[]; className?: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  const style = useAnchoredPopover(triggerRef, open, close, { align: "end", width: 220 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!buttons.length) return;
      e.preventDefault();
      const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (idx + 1) % buttons.length : (idx - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className={`bar-btn hdr-overflow-trigger${className ? ` ${className}` : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More header options"
        title="More"
        style={{ ...btnBase(t), padding: "0 9px" }}
      >
        <IconMore size={15} />
      </button>
      {open && style && (
        <Portal>
          <div
            ref={panelRef}
            role="menu"
            aria-label="More header options"
            className="dropdown-panel glass-overlay"
            style={{ ...style, zIndex: "var(--z-popover)" as unknown as number, border: `1px solid ${t.ruleSoft}`, padding: 6, ...glassOverlayVars(t) }}
          >
            {items.map((it) => (
              <button
                key={it.key}
                role="menuitem"
                onClick={() => {
                  it.onClick();
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  fontFamily: fonts.body,
                  fontSize: 13,
                  padding: "8px 9px",
                  borderRadius: 7,
                  border: "none",
                  background: "transparent",
                  color: t.ink,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = t.themeBand)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </>
  );
}

function btnBase(t: ReturnType<typeof useTheme>) {
  return {
    // display deliberately omitted — see the .bar-btn comment in styles.css:
    // an inline `display` here would defeat the .hdr-overflow-trigger
    // container query below it (this button also carries className="bar-btn").
    alignItems: "center",
    gap: 6,
    fontFamily: fonts.mono,
    fontSize: 11,
    height: "var(--control-h)",
    borderRadius: "var(--r-control)",
    cursor: "pointer",
    fontWeight: 700,
    border: `1px solid ${t.ruleSoft}`,
    background: "transparent",
    color: t.inkSoft,
    boxSizing: "border-box" as const,
  };
}
