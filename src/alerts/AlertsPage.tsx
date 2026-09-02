import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { fonts, type as typeScale } from "../theme";
import { useTheme } from "../theme-context";
import { useReference } from "../reference/reference-context";
import { useFilters } from "../filters-context";
import type { Filters } from "../filters-context";
import { useNav } from "../nav-context";
import { useAuth } from "../auth/auth-context";
import { IconAlert, IconChevron, IconInfo } from "../components/icons";
import { ExportCsvButton } from "../components/PageActions";
import { SpokeSwatch } from "../components/SpokeSwatch";
import { DATE_MAX, fmtDateFull, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS, PROCESS_BY_ID } from "../rpaData";
import { buildRateTables } from "../reference/economics";
import { useAlerts, viewAlert } from "./alerts-context";
import { dailySeriesFor, WINDOW_DAYS } from "./engine";
import type { Alert, AlertScope } from "./engine";
import { headlineFor, scopeContextFor, severityLabelFor, PAGE_LABEL } from "./format";
import type { ReferenceJson } from "../reference/reference-store";

// ---------------------------------------------------------------------------
// Slicer-aware narrowing, layered ON TOP of the provider's permission scoping
// (alerts-context.tsx) — never weakens it, only narrows further. Precedence
// (each step additionally narrows what the previous step produced):
//
//  1. filters.spoke !== "All"      -> keep estate-scope + alerts whose owning
//                                      spoke (spoke/process/vdi, resolved at
//                                      construction in engine.ts via
//                                      Alert.spokeFilter) is the selected spoke.
//  2. filters.proposition !== "All" -> additionally keep only process-scope
//                                      alerts whose process belongs to that
//                                      proposition, plus estate/spoke-scope
//                                      alerts (vdi-scope has no proposition to
//                                      match against, so it drops out here).
//  3. filters.processId !== "All"   -> additionally keep only that process's
//                                      own process-scope alerts, plus
//                                      estate-scope + the spoke-scope alert of
//                                      THAT process's own spoke (resolved via
//                                      PROCESS_BY_ID, independent of whatever
//                                      filters.spoke happens to be — vdi-scope
//                                      drops out here too).
//
// A spoke-scoped user's permission filter (alerts-context.tsx) already
// guarantees every alert reaching this function is one the signed-in user may
// see — this only ever removes rows further, never adds any back.
// ---------------------------------------------------------------------------
type SlicerFilters = Pick<Filters, "spoke" | "proposition" | "processId">;

function filterAlertsForSlicers(alerts: Alert[], f: SlicerFilters): Alert[] {
  let out = alerts;

  if (f.spoke !== "All") {
    out = out.filter((a) => a.scope === "estate" || a.spokeFilter === f.spoke);
  }

  if (f.proposition !== "All") {
    out = out.filter((a) => {
      if (a.scope === "estate" || a.scope === "spoke") return true;
      if (a.scope === "process") return PROCESS_BY_ID.get(a.processFilter ?? "")?.proposition === f.proposition;
      return false; // vdi-scope: no proposition to match against
    });
  }

  if (f.processId !== "All") {
    const procSpoke = PROCESS_BY_ID.get(f.processId)?.spoke;
    out = out.filter((a) => {
      if (a.scope === "estate") return true;
      if (a.scope === "spoke") return a.spokeFilter === procSpoke;
      if (a.scope === "process") return a.processFilter === f.processId;
      return false; // vdi-scope drops out once narrowed to a single process
    });
  }

  return out;
}

// Order a group for display: unacknowledged first (in the shared severity/
// scope sort already applied to the input), then acknowledged — same
// cascade AlertsPage always used, just reusable per-group now that estate
// alerts render as a separate group.
function orderedRows(list: Alert[], hideAcked: boolean, acked: Set<string>): Alert[] {
  const unacked = list.filter((a) => !acked.has(a.id));
  if (hideAcked) return unacked;
  const ackedList = list.filter((a) => acked.has(a.id));
  return [...unacked, ...ackedList];
}

// ---------------------------------------------------------------------------
// Section grouping: "{Breaches|Warnings} · {Estate|SpokeName} · {count}" —
// severity first (breaches before warnings, matching SEVERITY_ORDER), then
// by OWNING spoke identity, not by alert.scope's kind. Estate-scope alerts
// have no owning spoke (they're estate-wide) so they get their own "Estate"
// bucket; spoke/process/vdi-scope alerts all carry `spokeFilter` (the spoke
// they belong to, resolved at construction in engine.ts) and group under
// that spoke's real name — so a spoke's own spoke-rate alert and its
// processes' alerts can land in the same section. This also makes the
// `omitSpoke` case a plain function of the group itself (see AlertRow's
// caller below): once a row is filed under a named spoke section, repeating
// "SpokeName — " in the headline or "· Spoke: SpokeName" in the metadata
// line is always redundant, regardless of whether a slicer happens to be
// narrowing the view to that spoke too.
const SEVERITY_LABEL_PLURAL: Record<Alert["severity"], string> = { breach: "Breaches", warn: "Warnings" };

function groupKeyFor(a: Alert): string {
  return a.scope === "estate" ? "Estate" : (a.spokeFilter ?? "Estate");
}

interface AlertGroup {
  severity: Alert["severity"];
  groupName: string;
  alerts: Alert[];
}

// Buckets an already severity/scope-sorted, ack-ordered list into
// (severity, groupName) sections without disturbing each alert's relative
// order — "Estate" sorts first within its severity (it's the top of
// SCOPE_ORDER already), the rest keep the order they were first encountered.
function buildGroups(rows: Alert[]): AlertGroup[] {
  const order: { severity: Alert["severity"]; groupName: string }[] = [];
  const buckets = new Map<string, Alert[]>();
  // Keyed on JSON.stringify([severity, groupName]) rather than a delimiter-
  // joined string: spoke names contain spaces ("Consumer Lending"), which
  // would make a plain-space join ambiguous to split back apart.
  const keyOf = (severity: Alert["severity"], groupName: string) => JSON.stringify([severity, groupName]);
  for (const a of rows) {
    const severity = a.severity;
    const groupName = groupKeyFor(a);
    const key = keyOf(severity, groupName);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push({ severity, groupName });
    }
    buckets.get(key)!.push(a);
  }
  order.sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_ORDER_LOCAL[a.severity] - SEVERITY_ORDER_LOCAL[b.severity];
    if (a.groupName === "Estate") return -1;
    if (b.groupName === "Estate") return 1;
    return 0; // stable: keep first-encountered relative order among named spokes
  });
  return order.map(({ severity, groupName }) => ({ severity, groupName, alerts: buckets.get(keyOf(severity, groupName))! }));
}
const SEVERITY_ORDER_LOCAL: Record<Alert["severity"], number> = { breach: 0, warn: 1 };

// Scope-kind filter chips (toolbar): narrows the feed to one or more of the
// four alert "shapes" regardless of which entity they belong to — additive
// to (never a replacement for) the spoke/proposition/process slicer bar,
// same precedence rule as filterAlertsForSlicers above (this only removes
// rows further). Empty selection = no restriction (every kind shown), so a
// user can never accidentally chip their way to a permanently blank page.
const SCOPE_CHIPS: { key: AlertScope; label: string }[] = [
  { key: "estate", label: "Estate" },
  { key: "spoke", label: "Spoke" },
  { key: "process", label: "Process" },
  { key: "vdi", label: "VDI" },
];

// ---------------------------------------------------------------------------
// alerts/AlertsPage.tsx
// ---------------------------------------------------------------------------
// A monitoring FEED, not a tile grid — mental model: a GitHub notifications
// list or a Datadog monitors list. One <li> per alert, full width, separated
// by a hairline (no card chrome/shadows/rounded boxes). Reads alerts + ack
// state from the single shared AlertsProvider (alerts/alerts-context.tsx) —
// this page never calls evaluateAlerts() itself.
// ---------------------------------------------------------------------------

// Shared box model for the three row action buttons (Open / Acknowledge /
// Unacknowledge) — .bar-btn (styles.css) already sets height:32/padding:0
// 12px/display:inline-flex, but not align-items, so a plain-text button
// (Acknowledge) defaulted to align-items:stretch while "Open" (icon + text)
// separately centred itself inline — the two rendered with visibly different
// text baselines within the same 32px box. Centralising the full recipe here
// keeps all three buttons identical rather than "Open" being a one-off.
function rowBtnStyle(t: ReturnType<typeof useTheme>): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 32,
    padding: "0 12px",
    lineHeight: 1,
    border: `1px solid ${t.ruleSoft}`,
    color: t.ink,
    whiteSpace: "nowrap",
  };
}

// Small, quiet inline trend: 7 days of dailySeriesFor() plotted as a thin
// line, plus a dashed horizontal line at the alert's threshold — the same
// path-building math as viz.tsx's Sparkline, but with a threshold reference
// line (Sparkline itself has no such support, and this is alert-specific
// enough not to warrant adding one there).
function AlertTrend({ alert, reference, tables }: { alert: Alert; reference: ReferenceJson; tables: ReturnType<typeof buildRateTables> }) {
  const t = useTheme();
  const data = useMemo(() => dailySeriesFor(alert, reference, tables), [alert, reference, tables]);
  const w = 92;
  const h = 28;
  const color = alert.severity === "breach" ? t.accent : t.inkSoft;

  if (data.length < 2) return null;

  const max = Math.max(...data, alert.threshold);
  const min = Math.min(...data, alert.threshold);
  const span = max - min || 1;
  const py = (v: number) => h - 2 - ((v - min) / span) * (h - 4);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - 3) + 1.5, py(v)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const thresholdY = py(alert.threshold);

  // t.accent/t.inkSoft/t.inkFaint are theme tokens, not CSS classes — fine
  // as-is in light/dark, but high-contrast reuses the dark theme's tokens
  // verbatim (see theme-context.ts) and forces this row's ancestor
  // (.report__canvas) to a pure #000 background via the HC overlay below;
  // against true black, darkTheme.inkFaint (rgba(244,241,235,0.16), used for
  // the dashed threshold line) computes to only ~1.4:1 contrast — well under
  // the 3:1 non-text UI bar the rest of this theme holds to. className hooks
  // here let the HC overlay (styles.css) push the threshold line to solid
  // white and the trend line/dot to a clearly-legible colour without
  // touching the SVG's light/dark rendering (no !important reaches inline
  // presentation attributes unless the selector matches, and these classes
  // only exist to be matched). Breach vs warn stays colour-only in HC
  // (white vs cyan) — acceptable per the row's own severityLabelFor() text.
  return (
    <svg width={w} height={h} aria-hidden className="alert-trend" style={{ flex: "0 0 auto" }}>
      <line className="alert-trend__threshold" x1={0} x2={w} y1={thresholdY} y2={thresholdY} stroke={t.inkFaint} strokeWidth={1} strokeDasharray="3 2" />
      <path
        className={`alert-trend__series${alert.severity === "breach" ? " alert-trend__series--breach" : ""}`}
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        className={`alert-trend__series${alert.severity === "breach" ? " alert-trend__series--breach" : ""}`}
        cx={last[0]}
        cy={last[1]}
        r={2.2}
        fill={color}
      />
    </svg>
  );
}

// One <li> row — factored out so every (severity, group) section (see
// buildGroups above) renders identically instead of forking the JSX.
// `omitSpoke` is threaded straight through to headlineFor/scopeContextFor
// (see format.ts) — true for every row filed under a named-spoke section
// (repeating that same spoke's name in the row itself would be redundant),
// false for rows in the "Estate" section (which always keep their
// "Estate —" prefix regardless of any slicer).
function AlertRow({
  alert: a,
  reference,
  tables,
  omitSpoke,
  isAcked,
  ackOne,
  unackOne,
  setFilters,
  setPageId,
}: {
  alert: Alert;
  reference: ReferenceJson;
  tables: ReturnType<typeof buildRateTables>;
  omitSpoke: boolean;
  isAcked: boolean;
  ackOne: (id: string) => void;
  unackOne: (id: string) => void;
  setFilters: (f: Partial<Filters>) => void;
  setPageId: (id: string) => void;
}) {
  const t = useTheme();
  const meta = scopeContextFor(a, reference, { omitSpoke });
  return (
    <li
      className="alert-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "13px 4px",
        borderBottom: `1px solid ${t.ruleSoft}`,
        opacity: isAcked ? 0.6 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontFamily: fonts.mono,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            color: a.severity === "breach" ? t.accent : t.inkSoft,
          }}
        >
          <IconAlert size={13} />
          {severityLabelFor(a)}
          {a.scope !== "estate" && a.spokeFilter && <SpokeSwatch spoke={a.spokeFilter} />}
        </div>
        <h2 style={{ margin: "3px 0 0", fontFamily: fonts.display, fontSize: 15, fontWeight: 700, color: t.ink, lineHeight: 1.3 }}>
          {headlineFor(a, { omitSpoke })}
        </h2>
        {meta && <div style={{ marginTop: 2, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft }}>{meta}</div>}
      </div>

      <AlertTrend alert={a} reference={reference} tables={tables} />

      <div className="alert-row__actions" style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
        <button
          onClick={() => viewAlert(a, setFilters, setPageId)}
          className="bar-btn"
          title={PAGE_LABEL[a.pageId] ?? a.pageId}
          aria-label={`Open ${PAGE_LABEL[a.pageId] ?? a.pageId}`}
          style={{ ...rowBtnStyle(t), width: 88, flex: "0 0 88px", justifyContent: "center", gap: 5 }}
        >
          <IconChevron size={11} aria-hidden style={{ transform: "rotate(-90deg)", flex: "0 0 auto" }} />
          Open
        </button>
        {isAcked ? (
          <>
            <span style={{ display: "inline-flex", alignItems: "center", height: 32, lineHeight: 1, fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>
              Acknowledged
            </span>
            <button onClick={() => unackOne(a.id)} className="bar-btn" style={rowBtnStyle(t)}>
              Unacknowledge
            </button>
          </>
        ) : (
          <button onClick={() => ackOne(a.id)} className="bar-btn" style={rowBtnStyle(t)}>
            Acknowledge
          </button>
        )}
      </div>
    </li>
  );
}

export function AlertsPage() {
  const t = useTheme();
  const { reference } = useReference();
  const { filters, setFilters } = useFilters();
  const setPageId = useNav();
  const { user } = useAuth();
  const { sortedAlerts, acked, ackOne, unackOne, ackMany } = useAlerts();
  const [hideAcked, setHideAcked] = useState(false);
  // Scope-kind chips (toolbar) — empty set = no restriction (see SCOPE_CHIPS
  // doc comment above).
  const [scopeFilter, setScopeFilter] = useState<Set<AlertScope>>(new Set());
  const toggleScopeChip = (s: AlertScope) =>
    setScopeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  // Distinguishes "genuinely nothing wrong anywhere" (CoE-wide/admin view)
  // from "nothing wrong for the spokes this user can see, but other spokes
  // may have breaches" — mirrors the visibility rule applied once in
  // alerts-context.tsx (admin or spokeIds.length === 0 => CoE-wide).
  const isSpokeScoped = !!user && !user.roles.includes("admin") && user.spokeIds.length > 0;

  // Built once per reference change and shared across every visible row's
  // AlertTrend, instead of each row's dailySeriesFor() rebuilding the full
  // rate tables from scratch (see engine.ts's dailySeriesFor doc comment).
  const tables = useMemo(
    () => buildRateTables(reference, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS),
    [reference],
  );

  // Slicer-aware narrowing on top of the provider's permission scoping (see
  // filterAlertsForSlicers's doc comment above) — deliberately NOT dependent
  // on filters.range: alerts always evaluate their own fixed trailing window
  // (WINDOW_DAYS ending at DATE_MAX), so the date-range slicer must never
  // touch this set (see the note rendered in the toolbar below).
  const isFiltered = filters.spoke !== "All" || filters.proposition !== "All" || filters.processId !== "All";
  const scopedAlerts = useMemo(
    () => filterAlertsForSlicers(sortedAlerts, filters),
    [sortedAlerts, filters.spoke, filters.proposition, filters.processId],
  );

  // Scope-kind chips further narrow scopedAlerts (never widen it — same
  // additive-only precedence as filterAlertsForSlicers). Counts shown on the
  // chips themselves are taken from scopedAlerts (pre-chip), so switching
  // chips never changes what the OTHER chips report as available.
  const scopeCounts = useMemo(() => {
    const counts: Record<AlertScope, number> = { estate: 0, spoke: 0, process: 0, vdi: 0 };
    for (const a of scopedAlerts) counts[a.scope]++;
    return counts;
  }, [scopedAlerts]);
  const chipFilteredAlerts = scopeFilter.size === 0 ? scopedAlerts : scopedAlerts.filter((a) => scopeFilter.has(a.scope));

  // Every visible row, unacked first (see orderedRows), then bucketed into
  // "{Breaches|Warnings} · {Estate|SpokeName}" sections (see buildGroups) —
  // replaces the old own-spoke-vs-"Estate-wide" split: that split is now
  // just what falls out of grouping by owning-spoke identity, and it applies
  // whether or not a slicer is narrowing the view (previously only kicked in
  // when isFiltered).
  const visibleRows = orderedRows(chipFilteredAlerts, hideAcked, acked);
  const groups = useMemo(() => buildGroups(visibleRows), [visibleRows]);
  const totalRows = visibleRows.length;

  // Toolbar counts reflect the FILTERED set (slicers + scope chips), not
  // every alert the signed-in user may see — that's the whole point of the
  // slicer bar and chips being visible on this page.
  const breachCount = chipFilteredAlerts.filter((a) => !acked.has(a.id) && a.severity === "breach").length;
  const warnCount = chipFilteredAlerts.filter((a) => !acked.has(a.id) && a.severity === "warn").length;
  const ackedCount = chipFilteredAlerts.filter((a) => acked.has(a.id)).length;

  // "Acknowledge all" acts on the filtered set only (ackMany), never the
  // full permission-scoped set — that remains ackAll's contract, reserved
  // for NotificationBell.
  const ackAllFiltered = () => ackMany(chipFilteredAlerts.map((a) => a.id));

  const filterLabel =
    filters.spoke !== "All"
      ? filters.spoke
      : filters.processId !== "All"
        ? (PROCESS_BY_ID.get(filters.processId)?.name ?? "the selected process")
        : filters.proposition !== "All"
          ? filters.proposition
          : null;

  return (
    <div className="anim-up" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* --- summary strip: a single-line toolbar, not stat tiles --- */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "8px 18px",
          padding: "4px 2px 4px",
          fontFamily: fonts.body,
          fontSize: 13,
          color: t.ink,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconAlert size={15} style={{ color: t.accent, flex: "0 0 auto" }} />
          <strong style={{ fontWeight: 700 }}>{breachCount}</strong> breach{breachCount === 1 ? "" : "es"}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <IconAlert size={15} style={{ color: t.inkSoft, flex: "0 0 auto" }} />
          <strong style={{ fontWeight: 700 }}>{warnCount}</strong> warning{warnCount === 1 ? "" : "s"}
        </span>
        <span style={{ color: t.inkSoft }}>{ackedCount} acknowledged</span>
        <span style={{ flex: 1, minWidth: 8 }} />
        <span className="tip" tabIndex={0} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "help", fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: t.inkSoft, border: `1px solid ${t.ruleSoft}`, borderRadius: 999, padding: "4px 9px 4px 10px" }}>
          Trailing {WINDOW_DAYS} days
          <IconInfo size={12} aria-hidden style={{ flex: "0 0 auto" }} />
          <span role="tooltip" className="tip__bubble tip__bubble--right" style={{ width: 230 }}>
            <span style={{ display: "block", background: t.paper, color: t.ink, border: `1px solid ${t.ruleSoft}`, borderRadius: 7, padding: "8px 10px", fontFamily: fonts.body, fontSize: 12, fontWeight: 400, textTransform: "none", letterSpacing: "normal", lineHeight: 1.4, boxShadow: t.shadow }}>
              Alerts always evaluate the trailing {WINDOW_DAYS} days of the latest data (through {fmtDateFull(DATE_MAX)}) — the date range slicer does not apply.
            </span>
          </span>
        </span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.inkSoft, cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={hideAcked} onChange={(e) => setHideAcked(e.target.checked)} />
          Hide acknowledged
        </label>
        <button onClick={ackAllFiltered} className="bar-btn" style={rowBtnStyle(t)}>
          Acknowledge all
        </button>
        <ExportCsvButton
          filename="alerts"
          rows={() =>
            visibleRows.map((a) => ({
              Severity: severityLabelFor(a),
              Scope: a.scope,
              Spoke: a.spokeFilter ?? "",
              Headline: headlineFor(a, { omitSpoke: false }),
              Meta: scopeContextFor(a, reference, { omitSpoke: false }) ?? "",
              Acknowledged: acked.has(a.id) ? "Yes" : "No",
            }))
          }
        />
      </div>
      {/* scope-kind filter chips — additive to the spoke/proposition/process
          slicer bar above the page (see SCOPE_CHIPS's doc comment) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 10px", borderBottom: `1px solid ${t.ruleSoft}` }}>
        <span style={{ fontFamily: typeScale.label.fontFamily, fontSize: typeScale.label.fontSize, fontWeight: typeScale.label.fontWeight, textTransform: "uppercase", letterSpacing: "0.06em", color: t.inkSoft, flex: "0 0 auto" }}>
          Scope
        </span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SCOPE_CHIPS.map((c) => {
            const on = scopeFilter.has(c.key);
            return (
              <button
                key={c.key}
                onClick={() => toggleScopeChip(c.key)}
                aria-pressed={on}
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${on ? t.ink : t.ruleSoft}`,
                  background: on ? t.ink : "transparent",
                  color: on ? t.paper : t.inkSoft,
                  cursor: "pointer",
                }}
              >
                {c.label} · {scopeCounts[c.key]}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- feed --- */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {sortedAlerts.length === 0 ? (
          <p style={{ fontFamily: fonts.body, fontSize: 13.5, color: t.inkSoft, padding: "18px 2px" }}>
            All metrics within targets. Data through {fmtDateFull(DATE_MAX)}.
            {isSpokeScoped && ` No alerts for your ${user!.spokeIds.length === 1 ? "spoke" : "spokes"}.`}
          </p>
        ) : isFiltered && scopedAlerts.length === 0 ? (
          <p style={{ fontFamily: fonts.body, fontSize: 13.5, color: t.inkSoft, padding: "18px 2px" }}>
            No alerts for {filterLabel} — all metrics within targets.
          </p>
        ) : totalRows === 0 ? (
          <p style={{ fontFamily: fonts.body, fontSize: 13.5, color: t.inkSoft, padding: "18px 2px" }}>
            {hideAcked ? "No unacknowledged alerts." : "No alerts match the current filters."}
          </p>
        ) : (
          groups.map((g, gi) => (
            <div key={`${g.severity}-${g.groupName}`}>
              <div
                style={{
                  padding: "10px 4px 6px",
                  fontFamily: fonts.mono,
                  fontSize: 10.5,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: t.inkSoft,
                  borderTop: gi > 0 ? `1px solid ${t.ruleSoft}` : undefined,
                }}
              >
                {SEVERITY_LABEL_PLURAL[g.severity]} · {g.groupName} · {g.alerts.length}
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.alerts.map((a) => (
                  <AlertRow
                    key={a.id}
                    alert={a}
                    reference={reference}
                    tables={tables}
                    omitSpoke={g.groupName !== "Estate"}
                    isAcked={acked.has(a.id)}
                    ackOne={ackOne}
                    unackOne={unackOne}
                    setFilters={setFilters}
                    setPageId={setPageId}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
