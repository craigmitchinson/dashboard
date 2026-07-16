import { useMemo, useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useReference } from "../reference/reference-context";
import { useFilters } from "../filters-context";
import type { Filters } from "../filters-context";
import { useNav } from "../nav-context";
import { useAuth } from "../auth/auth-context";
import { IconAlert } from "../components/icons";
import { DATE_MAX, fmtDateFull, ROWS, DATA_MIN_ISO, DATA_MAX_ISO, DAY_WORKTIME_TOTALS, SPOKE_DAY_WORKTIME_TOTALS, PROCESS_BY_ID } from "../rpaData";
import { buildRateTables } from "../reference/economics";
import { useAlerts, viewAlert } from "./alerts-context";
import { dailySeriesFor, WINDOW_DAYS } from "./engine";
import type { Alert } from "./engine";
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
// alerts/AlertsPage.tsx
// ---------------------------------------------------------------------------
// A monitoring FEED, not a tile grid — mental model: a GitHub notifications
// list or a Datadog monitors list. One <li> per alert, full width, separated
// by a hairline (no card chrome/shadows/rounded boxes). Reads alerts + ack
// state from the single shared AlertsProvider (alerts/alerts-context.tsx) —
// this page never calls evaluateAlerts() itself.
// ---------------------------------------------------------------------------

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

  return (
    <svg width={w} height={h} aria-hidden style={{ flex: "0 0 auto" }}>
      <line x1={0} x2={w} y1={thresholdY} y2={thresholdY} stroke={t.inkFaint} strokeWidth={1} strokeDasharray="3 2" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  );
}

// One <li> row — factored out so the filtered-own-spoke group and the
// separated "Estate-wide" group below it (see AlertsPage) render identically
// instead of forking the JSX. `omitSpoke` is threaded straight through to
// headlineFor/scopeContextFor (see format.ts) — true only for rows in the
// own-spoke group when a spoke slicer is active, never for the Estate-wide
// group (estate alerts always keep their "Estate —" prefix regardless).
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
          style={{ border: `1px solid ${t.ruleSoft}`, color: t.ink, whiteSpace: "nowrap" }}
        >
          Open {PAGE_LABEL[a.pageId] ?? a.pageId} →
        </button>
        {isAcked ? (
          <>
            <span style={{ fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>
              Acknowledged
            </span>
            <button onClick={() => unackOne(a.id)} className="bar-btn" style={{ border: `1px solid ${t.ruleSoft}`, color: t.ink, whiteSpace: "nowrap" }}>
              Unacknowledge
            </button>
          </>
        ) : (
          <button onClick={() => ackOne(a.id)} className="bar-btn" style={{ border: `1px solid ${t.ruleSoft}`, color: t.ink, whiteSpace: "nowrap" }}>
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

  // Once any of the three entity slicers narrows the view, pull estate-scope
  // alerts out into their own separated group at the bottom (rendered as a
  // plain divider row, not a card) so they can never be mistaken for the
  // filtered spoke/process's own alerts. Unfiltered, everything stays in one
  // feed in the shared severity/scope sort order, exactly as before.
  const ownAlerts = isFiltered ? scopedAlerts.filter((a) => a.scope !== "estate") : scopedAlerts;
  const estateAlerts = isFiltered ? scopedAlerts.filter((a) => a.scope === "estate") : [];

  const ownRows = orderedRows(ownAlerts, hideAcked, acked);
  const estateRows = orderedRows(estateAlerts, hideAcked, acked);
  const totalRows = ownRows.length + estateRows.length;

  // Toolbar counts reflect the FILTERED set (scopedAlerts), not every alert
  // the signed-in user may see — that's the whole point of the slicer bar
  // now being visible on this page.
  const breachCount = scopedAlerts.filter((a) => !acked.has(a.id) && a.severity === "breach").length;
  const warnCount = scopedAlerts.filter((a) => !acked.has(a.id) && a.severity === "warn").length;
  const ackedCount = scopedAlerts.filter((a) => acked.has(a.id)).length;

  // "Acknowledge all" acts on the filtered set only (ackMany), never the
  // full permission-scoped set — that remains ackAll's contract, reserved
  // for NotificationBell.
  const ackAllFiltered = () => ackMany(scopedAlerts.map((a) => a.id));

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
        <span style={{ fontFamily: fonts.mono, fontSize: 11, color: t.inkSoft, whiteSpace: "nowrap" }}>
          Data through {fmtDateFull(DATE_MAX)} · Trailing {WINDOW_DAYS} days
        </span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: t.inkSoft, cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={hideAcked} onChange={(e) => setHideAcked(e.target.checked)} />
          Hide acknowledged
        </label>
        <button onClick={ackAllFiltered} className="bar-btn" style={{ border: `1px solid ${t.ruleSoft}`, color: t.ink, whiteSpace: "nowrap" }}>
          Acknowledge all
        </button>
      </div>
      <div style={{ padding: "0 2px 12px", borderBottom: `1px solid ${t.ruleSoft}`, fontFamily: fonts.body, fontSize: 11.5, fontStyle: "italic", color: t.inkSoft }}>
        Alerts always evaluate the trailing 7 days of the latest data — the date range slicer does not apply.
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
          <p style={{ fontFamily: fonts.body, fontSize: 13.5, color: t.inkSoft, padding: "18px 2px" }}>No unacknowledged alerts.</p>
        ) : (
          <>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {ownRows.map((a) => (
                <AlertRow
                  key={a.id}
                  alert={a}
                  reference={reference}
                  tables={tables}
                  omitSpoke={isFiltered && filters.spoke !== "All" && a.scope !== "estate" && a.spokeFilter === filters.spoke}
                  isAcked={acked.has(a.id)}
                  ackOne={ackOne}
                  unackOne={unackOne}
                  setFilters={setFilters}
                  setPageId={setPageId}
                />
              ))}
            </ul>
            {estateRows.length > 0 && (
              <>
                <div
                  style={{
                    padding: "10px 4px 6px",
                    fontFamily: fonts.mono,
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: t.inkSoft,
                    borderTop: ownRows.length > 0 ? `1px solid ${t.ruleSoft}` : undefined,
                  }}
                >
                  Estate-wide
                </div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {estateRows.map((a) => (
                    <AlertRow
                      key={a.id}
                      alert={a}
                      reference={reference}
                      tables={tables}
                      omitSpoke={false}
                      isAcked={acked.has(a.id)}
                      ackOne={ackOne}
                      unackOne={unackOne}
                      setFilters={setFilters}
                      setPageId={setPageId}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
