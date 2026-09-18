import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fonts, glassOverlayVars } from "../theme";
import { useTheme } from "../theme-context";
import { Portal } from "../components/Portal";
import { IconClose } from "../components/icons";
import { TOUR_STEPS, resolveVisibleSteps } from "./tour-steps";
import type { TourTargetId } from "./tour-steps";

// ---------------------------------------------------------------------------
// help/TourOverlay.tsx
// ---------------------------------------------------------------------------
// Six-step spotlight tour. Finds each step's target via `[data-tour="<id>"]`
// (added, attribute-only, to the six real elements — see App.tsx, viz.tsx's
// KpiCard and NotificationBell.tsx), skipping any step whose target isn't
// present/visible right now (resolveVisibleSteps — help/tour-steps.ts, pure
// and unit tested). The spotlight itself is a single fixed div sized to the
// target's rect with a huge `box-shadow` used as the dimmed backdrop — the
// div itself is `pointer-events: none` so the backdrop dims everything
// except the cut-out without ever blocking a click on the real target
// underneath it (the brief's "pointer-events on the backdrop only").
//
// Card follows the same focus-management shape as DisplayPanel.tsx (focus
// moves onto the card, Escape skips + returns focus to the opener) without
// being a full aria-modal dialog — the whole point of a spotlight tour is
// that the highlighted control underneath stays reachable/clickable.
// ---------------------------------------------------------------------------

function targetEl(id: TourTargetId): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`);
  for (const el of Array.from(nodes)) {
    if (el.offsetParent !== null || getComputedStyle(el).position === "fixed") return el;
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.getAttribute("data-reduce-motion") === "true"
  );
}

function btnStyle(t: ReturnType<typeof useTheme>): CSSProperties {
  return {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    padding: "6px 10px",
    borderRadius: 7,
    border: `1px solid ${t.ruleSoft}`,
    background: "transparent",
    color: t.ink,
    cursor: "pointer",
  };
}

function primaryBtnStyle(t: ReturnType<typeof useTheme>): CSSProperties {
  return { ...btnStyle(t), border: "none", background: t.accentFill, color: "#fff" };
}

export interface TourOverlayProps {
  stepIndex: number;
  onStepChange: (i: number) => void;
  onFinish: () => void;
}

export function TourOverlay({ stepIndex, onStepChange, onFinish }: TourOverlayProps) {
  const t = useTheme();
  // Computed once, at mount — the tour never navigates pages mid-run, so the
  // set of live targets on the current page doesn't change while it's open.
  const [steps] = useState(() => resolveVisibleSteps(TOUR_STEPS, (id) => !!targetEl(id)));
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const step = steps[stepIndex];

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
  }, []);

  const finish = () => {
    const o = openerRef.current;
    if (o && o !== document.body && document.contains(o)) o.focus();
    onFinish();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    if (!step) {
      finishRef.current();
      return;
    }
    const el = targetEl(step.id);
    const update = () => setRect(el ? el.getBoundingClientRect() : null);
    update();
    if (!prefersReducedMotion()) {
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      el?.scrollIntoView({ behavior: "auto", block: "center" });
    }
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    cardRef.current?.focus();
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finishRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!step) return null;

  const idx = stepIndex;
  const total = steps.length;
  const reduced = prefersReducedMotion();

  const CARD_W = 320;
  const cardTop = rect ? Math.min(rect.bottom + 14, window.innerHeight - 220) : window.innerHeight / 2 - 90;
  const cardLeft = rect ? Math.min(Math.max(16, rect.left), window.innerWidth - CARD_W - 16) : window.innerWidth / 2 - CARD_W / 2;

  return (
    <Portal>
      {rect && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            borderRadius: 10,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            pointerEvents: "none",
            zIndex: "var(--z-popover)" as unknown as number,
            transitionProperty: reduced ? "none" : "top, left, width, height",
            transitionDuration: reduced ? "0s" : "160ms",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-label={`Tour step ${idx + 1} of ${total}: ${step.title}`}
        tabIndex={-1}
        className="glass-overlay"
        style={{
          position: "fixed",
          top: cardTop,
          left: cardLeft,
          width: CARD_W,
          zIndex: "var(--z-popover)" as unknown as number,
          padding: 16,
          border: `1px solid ${t.ruleSoft}`,
          outline: "none",
          ...glassOverlayVars(t),
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <h2 style={{ margin: 0, fontFamily: fonts.display, fontSize: 15, fontWeight: 700, color: t.ink }}>{step.title}</h2>
          <button
            aria-label="Skip tour"
            onClick={finish}
            style={{ border: "none", background: "transparent", color: t.inkSoft, cursor: "pointer", padding: 2, flex: "0 0 auto" }}
          >
            <IconClose size={16} />
          </button>
        </div>
        <p style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, margin: "8px 0 12px", lineHeight: 1.45 }}>{step.body}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 10.5, color: t.inkSoft }}>
            {idx + 1} / {total}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            {idx > 0 && (
              <button onClick={() => onStepChange(idx - 1)} style={btnStyle(t)}>
                Back
              </button>
            )}
            <button onClick={finish} style={btnStyle(t)}>
              Skip
            </button>
            {idx < total - 1 ? (
              <button onClick={() => onStepChange(idx + 1)} style={primaryBtnStyle(t)}>
                Next
              </button>
            ) : (
              <button onClick={finish} style={primaryBtnStyle(t)}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
      <div aria-live="polite" role="status" className="sr-only">
        Step {idx + 1} of {total}: {step.title}. {step.body}
      </div>
    </Portal>
  );
}
