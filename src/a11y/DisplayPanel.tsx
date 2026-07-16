import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import type { ThemeTokens } from "../theme";
import { IconClose } from "../components/icons";
import { useDisplayPrefs } from "./prefs-context";

// ---------------------------------------------------------------------------
// Accessibility & display settings dialog. A WCAG 2.2 AA modal: focus moves in
// on mount and is trapped inside while open, Escape and backdrop-click both
// close it, and focus returns to whatever opened it on unmount. Presence in
// the tree is the only "open" state — the parent mounts/unmounts this.
//
// Theming note (dark-mode fix): App.tsx mounts <DisplayPanel> as a sibling of
// the `.report` div, not a descendant of it (`{showA11yPanel && <DisplayPanel
// .../>}` sits after `.report` closes). The panel's dark-mode CSS lived under
// `.report[data-mode="dark"] .foo` selectors, which therefore never matched —
// the dialog kept its light-theme background/colours (via CSS custom
// properties like --paper/--teal, which also never repaint per-theme) while
// a handful of text nodes read theme-correct colours straight from
// useTheme(), producing near-invisible light-on-light or dark-on-dark text
// in dark mode. Fixed by giving every themed surface in this file an inline
// style computed from `t` (useTheme()) — the same pattern already used by
// peer components (e.g. the h2 title, .a11y-desc paragraphs) and elsewhere
// in the app (src/App.tsx's .nav-item) — instead of leaning on CSS class
// scoping that assumed a DOM position this component doesn't have.
// ---------------------------------------------------------------------------

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Dialog chrome. Contrast vs the active `t.paper` background:
//   light: ink #0B3239 on paper #FAF7F2   = 12.85:1
//   dark:  ink #F4F1EB on paper #0C2329   = 14.46:1
// (high-contrast mode is untouched by this — its `!important` rules in
// styles.css already target `.modal-dialog` via `:root[data-theme=...]`,
// which — unlike `.report[data-mode=...]` — matches regardless of the
// panel's DOM position, so it keeps winning over these inline styles.)
function dialogStyle(t: ThemeTokens): CSSProperties {
  return {
    background: t.paper,
    color: t.ink,
    borderColor: t.ruleSoft,
    boxShadow: t.shadow,
    // Also repaints the focus ring for every focusable control inside this
    // dialog (see the `var(--a11y-focus-color, ...)` fallback rules in
    // styles.css) — the global :focus-visible rule is scoped to `.report`
    // for its dark variant and, like the rest of this panel, never reached
    // this subtree; that left a ~1.2:1 (invisible) ring in dark mode.
    ["--a11y-focus-color" as string]: t.ink,
  } as CSSProperties;
}

export function DisplayPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const t = useTheme();
  const { prefs, setPrefs } = useDisplayPrefs();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Restore focus to the opener BEFORE unmounting (ARIA dialog pattern):
  // doing it at close time, while both elements are still in the DOM, is
  // reliable regardless of unmount effect/DOM-removal ordering — the
  // cleanup-time restore below stays only as a safety net (e.g. if the
  // parent unmounts this dialog without going through a close path).
  const requestClose = () => {
    const o = openerRef.current;
    if (o && o !== document.body && document.contains(o)) o.focus();
    onClose();
  };
  // The keydown listener mounts once ([] deps) — route it through a ref so it
  // always calls the current requestClose/onClose, never a stale closure.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute("disabled") && el.offsetParent !== null
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Safety net only — requestClose() already restored focus on every
      // in-dialog close path. Skip if something focusable already has focus
      // (don't yank it from wherever requestClose put it).
      const o = openerRef.current;
      if (o && o !== document.body && document.contains(o) && (document.activeElement === document.body || document.activeElement === null)) {
        o.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="a11y-panel-title"
        className="modal-dialog"
        style={dialogStyle(t)}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <h2 id="a11y-panel-title" style={{ margin: 0, fontFamily: fonts.display, fontSize: 19, fontWeight: 700, color: t.ink }}>
            Accessibility & display
          </h2>
          <button
            ref={closeBtnRef}
            aria-label="Close accessibility and display settings"
            onClick={requestClose}
            className="a11y-seg-btn"
            style={{ color: t.ink, borderColor: t.ruleSoft }}
          >
            <IconClose size={20} />
          </button>
        </div>

        <section className="a11y-panel__section" style={{ borderTopColor: t.ruleSoft }}>
          <h3 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 14, fontWeight: 700, color: t.ink }}>Theme & contrast</h3>
          <div role="group" aria-label="Theme" style={{ display: "flex", gap: 6 }}>
            <SegButton active={prefs.theme === "light"} onClick={() => setPrefs({ theme: "light" })}>
              Light
            </SegButton>
            <SegButton active={prefs.theme === "dark"} onClick={() => setPrefs({ theme: "dark" })}>
              Dark
            </SegButton>
            <SegButton active={prefs.theme === "high-contrast"} onClick={() => setPrefs({ theme: "high-contrast" })}>
              High contrast
            </SegButton>
          </div>
          <p className="a11y-desc" style={{ fontFamily: fonts.body, color: t.inkSoft }}>
            High contrast uses true black and white with visible borders and no reliance on colour or shadow alone.
          </p>
        </section>

        <section className="a11y-panel__section" style={{ borderTopColor: t.ruleSoft }}>
          <h3 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 14, fontWeight: 700, color: t.ink }}>Text & reading</h3>

          <div role="group" aria-label="Text size" style={{ display: "flex", gap: 6 }}>
            <SegButton active={prefs.textScale === 1} onClick={() => setPrefs({ textScale: 1 })}>
              100%
            </SegButton>
            <SegButton active={prefs.textScale === 1.15} onClick={() => setPrefs({ textScale: 1.15 })}>
              115%
            </SegButton>
            <SegButton active={prefs.textScale === 1.3} onClick={() => setPrefs({ textScale: 1.3 })}>
              130%
            </SegButton>
          </div>
          <p className="a11y-desc" style={{ fontFamily: fonts.body, color: t.inkSoft }}>
            Scales all text and layout together, like browser zoom.
          </p>

          <Switch
            id="a11y-dyslexia"
            label="Dyslexia-friendly mode"
            description="Switches to a clearer humanist font with more letter and line spacing, following British Dyslexia Association guidance."
            checked={prefs.dyslexiaMode}
            onChange={(checked) => setPrefs({ dyslexiaMode: checked })}
          />
          <Switch
            id="a11y-bionic"
            label="Bionic reading"
            description="Bolds the first part of each word in page descriptions to help guide your eye — never applied to chart numbers or axis labels."
            checked={prefs.bionicReading}
            onChange={(checked) => setPrefs({ bionicReading: checked })}
          />
          <Switch
            id="a11y-ruler"
            label="Reading ruler"
            description="A soft highlighted band follows your mouse pointer or keyboard focus to help you track your place on screen."
            checked={prefs.readingRuler}
            onChange={(checked) => setPrefs({ readingRuler: checked })}
          />
        </section>

        <section className="a11y-panel__section" style={{ borderTopColor: t.ruleSoft }}>
          <h3 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 14, fontWeight: 700, color: t.ink }}>Charts</h3>

          <Switch
            id="a11y-cvd-safe"
            label="Colour-vision-safe palette"
            description="Swaps chart colours for a palette distinguishable with the most common forms of colour blindness, and adds distinct line patterns."
            checked={prefs.colorVisionSafe}
            onChange={(checked) => setPrefs({ colorVisionSafe: checked })}
          />
          <Switch
            id="a11y-reduce-motion"
            label="Reduce motion"
            description="Turns off animations and transitions regardless of your system setting. When off, we still follow your device's reduce-motion setting automatically."
            checked={prefs.reduceMotion === "on"}
            onChange={(checked) => setPrefs({ reduceMotion: checked ? "on" : "system" })}
          />
        </section>

        <section className="a11y-panel__section" style={{ borderTopColor: t.ruleSoft }}>
          <h3 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 14, fontWeight: 700, color: t.ink }}>Personalisation</h3>

          <Switch
            id="a11y-seasonal"
            label="Seasonal accent"
            description="Shows a small seasonal icon next to your greeting. Automatically hidden in high-contrast mode."
            checked={prefs.seasonalAccent}
            onChange={(checked) => setPrefs({ seasonalAccent: checked })}
          />
          <Switch
            id="a11y-clocks"
            label="World clocks"
            description="Shows live UK and India time in the header."
            checked={prefs.clocks}
            onChange={(checked) => setPrefs({ clocks: checked })}
          />
        </section>
      </div>
    </div>
  );
}

function SegButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  const t = useTheme();
  // Same ink/paper pairing as dialogStyle above, just reversed for the
  // filled "active" state: 12.85:1 (light) / 14.46:1 (dark) either way round.
  const style: CSSProperties = active
    ? { background: t.ink, color: t.paper, borderColor: t.ink }
    : { background: "transparent", color: t.ink, borderColor: t.ruleSoft };
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`a11y-seg-btn${active ? " is-active" : ""}`} style={style}>
      {children}
    </button>
  );
}

function Switch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const t = useTheme();
  // Track fill: transparent-ish t.ruleSoft/t.inkFaint tint when off (matches
  // the app's existing hairline tokens — a decorative, non-text control, so
  // the ~1.3-1.7:1 fill-vs-background ratio here is intentional and unchanged
  // from the original design; position + the knob + the checkbox's own state
  // still convey "off" unambiguously), t.ink when on (12.85:1 / 14.46:1
  // against the dialog's t.paper background — same pairing as dialogStyle).
  // Knob: white, except checked+dark where it flips to t.paper so it doesn't
  // wash out against the now-light "on" fill (9.6:1 / 14.46:1 either way).
  const trackStyle: CSSProperties = {
    background: checked ? t.ink : t.inkFaint,
    borderColor: checked ? t.ink : t.ruleSoft,
    ["--a11y-knob-bg" as string]: checked && t.mode === "dark" ? t.paper : "#ffffff",
  } as CSSProperties;
  return (
    <div className="a11y-switch-row">
      <label htmlFor={id} className="a11y-switch">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="a11y-switch__track" aria-hidden="true" style={trackStyle} />
        <span className="a11y-switch__label" style={{ fontFamily: fonts.body, color: t.ink }}>
          {label}
        </span>
      </label>
      <p className="a11y-desc" style={{ fontFamily: fonts.body, color: t.inkSoft }}>
        {description}
      </p>
    </div>
  );
}
