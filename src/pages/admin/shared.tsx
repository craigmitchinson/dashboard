import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import { IconClose, IconLock } from "../../components/icons";
import type { ReferenceJson } from "../../reference/reference-store";
import type { PermAction } from "../../auth/auth-context";

// Matches useReference()'s update() signature exactly (reference-context.tsx).
export type UpdateFn = (mutator: (draft: ReferenceJson) => ReferenceJson | void, opts?: { section?: string; actor?: string }) => void;

// Every section component gets the same props from Admin.tsx.
export interface SectionProps {
  reference: ReferenceJson;
  update: UpdateFn;
  actor: string;
  can: (action: PermAction, spokeId?: string) => boolean;
  isAdmin: boolean;
}

// ---------------------------------------------------------------------------
// admin/shared.tsx
// ---------------------------------------------------------------------------
// Shared UI atoms + pure helpers for every Administration section. Kept in one
// file so the eight sections (Admin.tsx) look and behave identically — same
// field/table chrome, same locked-history rule, same confirm-dialog pattern.
// ---------------------------------------------------------------------------

// --- date helpers -------------------------------------------------------------

/** Real wall-clock "today" (ISO, UTC) — used to decide whether a date-effective
 * record is future-dated. Deliberately NOT the dataset's DATA_MAX_ISO: an
 * admin adding a pay-rate change is reasoning about real calendar time ("this
 * takes effect next month"), not about how far the mock dataset happens to
 * extend — and DATA_MAX_ISO is frequently in the past relative to real "now". */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return !isNaN(t);
}

/**
 * Locked-history classification shared by People costs and the Grade rate
 * card: both are simple date-effective histories where past records must
 * never be rewritten (pro-rating/benefit calculations already depend on the
 * value that was in force on each historical date). A record may be:
 *   - edited AND deleted, if its effectiveFrom is strictly after today
 *   - deleted only (not edited), if it is the most-recent record in its group
 *     (by effectiveFrom) even though it's today-or-past-dated — this is the
 *     "I just added the wrong number, undo it" escape hatch
 *   - otherwise locked (neither editable nor deletable)
 */
export function historyRowRights(effectiveFrom: string, isMostRecentInGroup: boolean, today: string): { canEdit: boolean; canDelete: boolean } {
  const future = effectiveFrom > today;
  return { canEdit: future, canDelete: future || isMostRecentInGroup };
}

/** The single most-recent row in a date-effective group, by effectiveFrom. */
export function mostRecent<T extends { effectiveFrom: string }>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>((best, r) => (!best || r.effectiveFrom > best.effectiveFrom ? r : best), undefined);
}

// --- VDI coverage window (display only) --------------------------------------
// economics.ts's cycleStart/coverageWindow internals are not exported (only
// vdiDailyCost/vdiAvailableOn/availableDaysInWindow are) — this mirrors that
// same tiling algorithm (365-day cycles anchored on renewalDate, capped by
// licenseExpiryDate / retired activeTo) purely so the VDI estate table can
// show "current coverage window" to an editor. All actual cost/capacity
// numbers shown elsewhere in the dashboard still come exclusively from
// src/reference/economics.ts — this function is never used for a money figure.
const DAY_MS = 86400000;
const parseISO = (d: string) => Date.parse(d + "T00:00:00Z");
const dateOnly = (ts: number) => new Date(ts).toISOString().slice(0, 10);

export interface CoverageInput {
  activeFrom: string;
  activeTo: string | null;
  renewalDate: string;
  licenseExpiryDate: string | null;
  status: "active" | "retired";
}

export function currentCoverageWindow(vdi: CoverageInput, asOfISO: string): { startISO: string; endISO: string; covered: boolean } {
  const renewalTs = parseISO(vdi.renewalDate);
  const asOfTs = parseISO(asOfISO);
  const cycleIndex = Math.floor((asOfTs - renewalTs) / (365 * DAY_MS));
  const cycleStartTs = renewalTs + cycleIndex * 365 * DAY_MS;
  let end = cycleStartTs + 365 * DAY_MS;
  if (vdi.licenseExpiryDate) end = Math.min(end, parseISO(vdi.licenseExpiryDate) + DAY_MS);
  if (vdi.status === "retired" && vdi.activeTo) end = Math.min(end, parseISO(vdi.activeTo) + DAY_MS);
  const start = Math.max(cycleStartTs, parseISO(vdi.activeFrom));
  return { startISO: dateOnly(start), endISO: dateOnly(end - DAY_MS), covered: asOfTs >= start && asOfTs < end };
}

// --- contrast hint -------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colours, or null if either is unparseable. */
export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Small pass/fail contrast hint for a spoke accent colour against its own
 * surface (paper) colour — accents are used as small text/icons/borders, not
 * full-page body copy, so the bar is the UI-component threshold (3:1), not
 * the 4.5:1 body-text bar. */
export function ContrastHint({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const t = useTheme();
  const ratio = contrastRatio(fg, bg);
  if (ratio == null) return null;
  const pass = ratio >= 3;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontFamily: fonts.mono,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.03em",
        color: pass ? t.ink : t.accent,
      }}
      title={`Contrast of ${label} accent against its surface: ${ratio.toFixed(2)}:1 (non-text UI elements need ≥3:1)`}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: pass ? "#2E9E5B" : t.accent, flex: "0 0 auto" }} />
      {ratio.toFixed(1)}:1 {pass ? "OK" : "low"}
    </span>
  );
}

// --- form field atoms ----------------------------------------------------------

export function inputStyle(t: ReturnType<typeof useTheme>, extra?: CSSProperties): CSSProperties {
  return {
    fontFamily: fonts.body,
    fontSize: 13,
    padding: "7px 9px",
    borderRadius: 7,
    border: `1px solid ${t.ruleSoft}`,
    background: t.themeBand,
    color: t.ink,
    outline: "none",
    width: "100%",
    ...extra,
  };
}

export function Field({ id, label, children, hint, width }: { id: string; label: string; children: ReactNode; hint?: string; width?: number }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>
        {label}
      </label>
      {children}
      {hint && (
        <span style={{ fontFamily: fonts.body, fontSize: 11, color: t.inkSoft, lineHeight: 1.4 }}>{hint}</span>
      )}
    </div>
  );
}

export function HelperText({ children }: { children: string }) {
  const t = useTheme();
  return (
    <p style={{ margin: "2px 0 12px", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, lineHeight: 1.55, maxWidth: 760 }}>{children}</p>
  );
}

export function SectionTitle({ title, helper }: { title: string; helper: string }) {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 4 }}>
      <h2 style={{ margin: 0, fontFamily: fonts.display, fontSize: 18, fontWeight: 700, color: t.ink }}>{title}</h2>
      <HelperText>{helper}</HelperText>
    </div>
  );
}

// --- buttons ---------------------------------------------------------------

const baseBtn: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  padding: "7px 12px",
  borderRadius: 7,
  cursor: "pointer",
  border: "1px solid transparent",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  whiteSpace: "nowrap",
};

export function PrimaryButton({ children, onClick, disabled, type = "button" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  const t = useTheme();
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ ...baseBtn, background: t.accentFill, color: "#fff", opacity: disabled ? 0.55 : 1, cursor: disabled ? "default" : "pointer" }}>
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, disabled, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  const t = useTheme();
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{ ...baseBtn, background: "transparent", color: t.ink, border: `1px solid ${t.ruleSoft}`, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
      {children}
    </button>
  );
}

export function DangerButton({ children, onClick, disabled, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) {
  const t = useTheme();
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{ ...baseBtn, background: "transparent", color: t.accent, border: `1px solid ${t.accent}55`, opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>
      {children}
    </button>
  );
}

// --- lock badge (with a hover/focus tooltip, reusing the app-wide .tip pattern) --

export function LockBadge({ reason }: { reason: string }) {
  const t = useTheme();
  return (
    <span className="tip" tabIndex={0} style={{ color: t.inkSoft, cursor: "help" }}>
      <IconLock size={14} />
      <span className="tip__bubble" role="tooltip" style={{ background: t.paper, border: `1px solid ${t.ruleSoft}`, borderRadius: 8, boxShadow: t.shadow, padding: "8px 10px", fontFamily: fonts.body, fontSize: 11.5, color: t.ink, lineHeight: 1.4 }}>
        {reason}
      </span>
    </span>
  );
}

export const LOCK_REASON = "Locked — past records are never rewritten because pro-rating and every historical chart already depend on the value that was in force on that date.";

// --- table chrome ------------------------------------------------------------

export function Table({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <div style={{ overflow: "auto", border: `1px solid ${t.ruleSoft}`, borderRadius: 9 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body }}>{children}</table>
    </div>
  );
}

export function Th({ children, align, width }: { children: ReactNode; align?: "left" | "right" | "center"; width?: number }) {
  const t = useTheme();
  return (
    <th style={{ position: "sticky", top: 0, background: t.paper, textAlign: align ?? "left", padding: "8px 10px", fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700, borderBottom: `1px solid ${t.ruleSoft}`, whiteSpace: "nowrap", width }}>
      {children}
    </th>
  );
}

export function Td({ children, align, muted }: { children: ReactNode; align?: "left" | "right" | "center"; muted?: boolean }) {
  const t = useTheme();
  return (
    <td style={{ textAlign: align ?? "left", padding: "7px 10px", fontSize: 12.5, color: muted ? t.inkSoft : t.ink, borderBottom: `1px solid ${t.ruleSoft}`, verticalAlign: "middle" }}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: string }) {
  const t = useTheme();
  return (
    <tr>
      <td colSpan={colSpan} style={{ padding: "18px 10px", textAlign: "center", color: t.inkSoft, fontSize: 12.5 }}>
        {children}
      </td>
    </tr>
  );
}

// --- banners -----------------------------------------------------------------

export function ErrorBanner({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <div role="alert" style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.accent}`, background: `${t.accent}14`, color: t.ink, fontFamily: fonts.body, fontSize: 13 }}>
      <strong style={{ color: t.accent, flex: "0 0 auto" }}>⚠</strong>
      <span>{children}</span>
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10, border: `1px solid ${t.ruleSoft}`, background: t.themeBand, color: t.inkSoft, fontFamily: fonts.body, fontSize: 12.5, lineHeight: 1.5 }}>
      <span>{children}</span>
    </div>
  );
}

// --- save status (aria-live announcer) ----------------------------------------

export function useSaveAnnounce() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = (msg: string) => {
    setMessage(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 4500);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const Announcer = () => (
    <div aria-live="polite" className="sr-only" role="status">
      {message ?? ""}
    </div>
  );
  return { announce, Announcer, message };
}

/** Bundles update() + the aria-live announcer into one `save(section, mutator)`
 * call so every section fires the same "Saved — dashboards updated." status
 * line instead of repeating the wiring eight times. */
export function useSectionSave(update: UpdateFn, actor: string) {
  const { announce, Announcer } = useSaveAnnounce();
  const save = (section: string, mutator: (draft: ReferenceJson) => ReferenceJson | void, message = "Saved — dashboards updated.") => {
    update(mutator, { section, actor });
    announce(message);
  };
  return { save, Announcer };
}

export function SavedPill({ text }: { text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: fonts.mono, fontSize: 11, fontWeight: 700, color: "#2E9E5B", background: "#2E9E5B1a", border: "1px solid #2E9E5B55", padding: "4px 10px", borderRadius: 20 }} role="status">
    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#2E9E5B" }} />
      {text}
    </span>
  );
}

// --- confirm dialog (focus-trapped modal, mirrors src/a11y/DisplayPanel.tsx) --

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Accepted for call-site intent; the confirm button is always accentFill (destructive-red) today. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    confirmBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="admin-confirm-title" className="modal-dialog" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <h2 id="admin-confirm-title" style={{ margin: 0, fontFamily: fonts.display, fontSize: 17, fontWeight: 700, color: t.ink }}>{title}</h2>
          <button aria-label="Cancel" onClick={onCancel} className="a11y-seg-btn">
            <IconClose size={18} />
          </button>
        </div>
        <div style={{ margin: "12px 0 18px", fontFamily: fonts.body, fontSize: 13, color: t.inkSoft, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <GhostButton onClick={onCancel}>{cancelLabel}</GhostButton>
          <button ref={confirmBtnRef} type="button" onClick={onConfirm} style={{ ...baseBtn, background: t.accentFill, color: "#fff" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- domain constants shared across sections -----------------------------------

// Mirrors rpaData.ts's internal ICONS map keys (that map itself isn't exported —
// only used to resolve ProcessDim.Icon at initData() time) so the process
// editor can offer the same finite icon set a process's `icon` string may
// reference from data/reference/reference.json.
export const PROCESS_ICON_OPTIONS = ["form", "letter", "payment", "shield", "globe", "route", "inbox", "card", "refresh", "graph"] as const;
