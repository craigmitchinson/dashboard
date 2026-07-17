// ---------------------------------------------------------------------------
// alerts/format.ts
// ---------------------------------------------------------------------------
// Pure presentation helpers for Alert[] — sort order, metric/value
// formatting, and plain-English headline/scope text — shared by
// NotificationBell and AlertsPage so their copy can never drift apart.
// ---------------------------------------------------------------------------
import type { Alert, AlertMetric, AlertScope } from "./engine";
import { PAGE_LABELS } from "../page-labels";
import type { ReferenceJson } from "../reference/reference-store";
import { fmtDate } from "../rpaData";

export const SEVERITY_ORDER: Record<Alert["severity"], number> = { breach: 0, warn: 1 };
export const SCOPE_ORDER: Record<AlertScope, number> = { estate: 0, spoke: 1, process: 2, vdi: 3 };

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] ||
      a.scopeLabel.localeCompare(b.scopeLabel),
  );
}

export const METRIC_LABEL: Record<AlertMetric, string> = {
  completionPct: "Completion rate",
  exceptionRate: "Exception rate",
  systemRate: "System exception rate",
  costPerCase: "Cost per case",
  utilisation: "Utilisation",
  staleVdi: "VDI activity",
};

export function formatMetricValue(metric: AlertMetric, value: number): string {
  if (metric === "costPerCase") return `£${value.toFixed(2)}`;
  if (metric === "staleVdi") {
    const days = Math.round(value);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${(value * 100).toFixed(1)}%`;
}

// Read directly off alert.direction (set explicitly at construction in
// engine.ts) rather than inferring it from value vs threshold — the warn band
// for a "min" (floor) threshold can fire for values slightly ABOVE the
// threshold (see engine.ts's classify()), so a value/threshold comparison at
// render time would misclassify a warn-severity floor alert as a ceiling.
export function directionSymbolFor(alert: Alert): "≥" | "≤" {
  return alert.direction === "min" ? "≥" : "≤";
}

// Re-exports the shared page-labels module (src/page-labels.ts) instead of
// duplicating the literals here — see that module's header comment for why
// it exists as a separate, import-free module (App.tsx imports the Alerts
// page and the bell, so an import running the other way would be circular).
export const PAGE_LABEL: Record<string, string> = PAGE_LABELS;

export function severityLabelFor(alert: Alert): "Breach" | "Warning" {
  return alert.severity === "breach" ? "Breach" : "Warning";
}

export function scopeDisplayFor(alert: Alert): string {
  return alert.scope === "estate" ? "Estate" : alert.scopeLabel;
}

// `omitSpoke` drops the trailing "· Spoke: X" fragment — used by AlertsPage
// when the slicer bar is already filtered to that exact spoke, so the spoke
// name isn't redundantly repeated on every row (proposition still shown, since
// that's finer-grained information the filter doesn't already convey).
// Defaults to false so NotificationBell's call (no second argument) is
// unaffected.
export function scopeContextFor(alert: Alert, reference: ReferenceJson, options?: { omitSpoke?: boolean }): string | null {
  const omitSpoke = options?.omitSpoke ?? false;
  if (alert.scope === "process") {
    const proc = reference.processes.find((p) => String(p.processId) === alert.processFilter);
    const propositionName = proc ? reference.propositions.find((pr) => pr.propositionId === proc.propositionId)?.propositionName : undefined;
    return `Process: ${alert.scopeLabel} · Proposition: ${propositionName ?? "—"}${omitSpoke ? "" : ` · Spoke: ${alert.spokeFilter ?? "—"}`}`;
  }
  if (alert.scope === "vdi") return `VDI: ${alert.scopeLabel}${omitSpoke ? "" : ` · Spoke: ${alert.spokeFilter ?? "Hub"}`}`;
  return null;
}

/**
 * Plain-English headline. This EXACT truthful algorithm matches classify()'s
 * real branches (engine.ts) — do not deviate:
 *   direction "min", value <  threshold -> breach -> "... below the X floor"
 *   direction "min", value >= threshold -> warn   -> "... only just above the X floor (warning: ...)"
 *   direction "max", value >  threshold -> breach -> "... above the X ceiling"
 *   direction "max", value <= threshold -> warn   -> "... approaching the X ceiling (warning: ...)"
 * e.g. "Consumer Lending — System exception rate 7.2%, above the 5.0% ceiling"
 *      "Estate — Completion rate 91.2%, below the 95.0% floor"
 *
 * `omitSpoke` drops the leading "SpokeName — " for a scope:"spoke" alert
 * (only spoke-scope's scopeLabel IS the spoke name — process/vdi-scope
 * headlines already lead with the process/VDI name, and estate-scope always
 * keeps its "Estate —" prefix, so this has no effect on those). Used by
 * AlertsPage when the slicer bar is already filtered to that exact spoke.
 * Defaults to false so NotificationBell's call (no second argument) is
 * unaffected.
 *
 * "staleVdi" is a DELIBERATE EXCEPTION to the floor/ceiling phrasing above —
 * it's not a rate breaching a threshold, it's a VDI that's gone quiet, so it
 * gets its own fixed phrasing instead:
 *   "VDI-RPA-COM-04 — no cases for 21 days (last case 23 Jun) — review for retirement"
 */
export function headlineFor(alert: Alert, options?: { omitSpoke?: boolean }): string {
  if (alert.metric === "staleVdi") {
    const days = Math.round(alert.value);
    const lastCase = alert.lastSeenISO ? fmtDate(Date.parse(alert.lastSeenISO + "T00:00:00Z")) : "unknown";
    return `${alert.scopeLabel} — no cases for ${days} day${days === 1 ? "" : "s"} (last case ${lastCase}) — review for retirement`;
  }
  const { metric, value, threshold, direction } = alert;
  const dropScope = (options?.omitSpoke ?? false) && alert.scope === "spoke";
  const prefix = dropScope
    ? `${METRIC_LABEL[metric]} ${formatMetricValue(metric, value)}`
    : `${scopeDisplayFor(alert)} — ${METRIC_LABEL[metric]} ${formatMetricValue(metric, value)}`;
  const th = formatMetricValue(metric, threshold);
  if (direction === "min") {
    return value < threshold
      ? `${prefix}, below the ${th} floor`
      : `${prefix}, only just above the ${th} floor (warning: within the early-warning band)`;
  }
  return value > threshold
    ? `${prefix}, above the ${th} ceiling`
    : `${prefix}, approaching the ${th} ceiling (warning: within the early-warning band)`;
}
