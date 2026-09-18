import { useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import { useReference } from "../../reference/reference-context";
import { DATA_MODE } from "../../data/client";
import { useSystemStatus } from "../../data/status";
import { META } from "../../rpaData";
import {
  ConfirmDialog, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, SavedPill,
  InfoBanner, ErrorBanner,
} from "./shared";
import type { SectionProps } from "./shared";

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// --- Data health --------------------------------------------------------
// The "set and forget" surface: what the last ingest pipeline run actually
// did, not just "is the API up" (App.tsx's header dot already covers
// that). Visible to everyone who can see Administration at all (this
// section has no can()-gated visibility of its own — see Admin.tsx) since
// "is our data trustworthy" is not a privileged question. See
// server/src/routes/health.ts for the `lastRun`/`stale` contract this
// reads, and 11_pipeline_ops.sql / 05_proc_load_staging.sql for where the
// numbers come from.

function StatRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderBottom: `1px solid ${t.ruleSoft}`, fontFamily: fonts.body, fontSize: 12.5 }}>
      <span style={{ color: t.inkSoft }}>{label}</span>
      <span style={{ color: warn ? t.status.warn : t.ink, fontWeight: warn ? 700 : 400, fontFamily: fonts.mono }}>{value}</span>
    </div>
  );
}

function StatusDot({ color }: { color: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block", marginRight: 6 }} />;
}

function DataHealthBlock() {
  const t = useTheme();
  const status = useSystemStatus();

  if (DATA_MODE === "local") {
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Data health</h3>
        <InfoBanner>
          Static build — no live pipeline. This copy of the dashboard was built from a fixed data snapshot: {META.sourceRows.toLocaleString()} source rows, built {fmtWhen(META.generatedAt)}.
        </InfoBanner>
      </div>
    );
  }

  if (status.checking) {
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Data health</h3>
        <InfoBanner>Checking pipeline status…</InfoBanner>
      </div>
    );
  }

  if (!status.reachable) {
    return (
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Data health</h3>
        <ErrorBanner>Can't reach the data API right now — showing the dashboard's last loaded data. This will recover automatically on the next check (every 60s).</ErrorBanner>
      </div>
    );
  }

  const run = status.lastRun;
  const runDotColor = !run ? t.inkSoft : run.status === "success" ? t.status.committed.dot : run.status === "failed" ? t.status.blocked.dot : t.status.warn;

  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Data health</h3>

      {status.stale && (
        <div style={{ marginBottom: 10 }}>
          <ErrorBanner>
            The underlying data hasn't updated in {run?.watermarkAgeMinutes?.toLocaleString() ?? "an unknown number of"} minutes — longer than a normal gap between pulls. Check the ingest job in Cloud Run.
          </ErrorBanner>
        </div>
      )}
      {!status.stale && run?.status === "failed" && (
        <div style={{ marginBottom: 10 }}>
          <ErrorBanner>The last pipeline run failed{run.error ? `: ${run.error}` : "."}</ErrorBanner>
        </div>
      )}

      {!run && <InfoBanner>No pipeline run has been recorded yet.</InfoBanner>}

      {run && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) minmax(220px, 320px)", gap: "0 32px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${t.ruleSoft}`, fontFamily: fonts.body, fontSize: 12.5 }}>
              <StatusDot color={runDotColor} />
              <span style={{ color: t.inkSoft, marginRight: "auto" }}>Last pull</span>
              <span style={{ fontFamily: fonts.mono, color: t.ink }}>{run.finishedAt ? fmtWhen(run.finishedAt) : "in progress"} · {run.status}</span>
            </div>
            <StatRow label="Rows staged" value={run.rowsStaged != null ? run.rowsStaged.toLocaleString() : "—"} />
            <StatRow label="Rows merged" value={run.rowsMerged != null ? run.rowsMerged.toLocaleString() : "—"} />
            <StatRow
              label="Rows rejected"
              value={run.rowsRejected != null ? run.rowsRejected.toLocaleString() : "—"}
              warn={!!run.rowsRejected}
            />
            <StatRow
              label="Watermark age"
              value={run.watermarkAgeMinutes != null ? `${run.watermarkAgeMinutes.toLocaleString()} min` : "—"}
              warn={status.stale}
            />
          </div>

          <div>
            <h4 style={{ margin: "0 0 4px", fontFamily: fonts.mono, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 700 }}>Unmapped queues</h4>
            {run.unmappedQueues.length === 0 ? (
              <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft }}>None — every queue in this pull's data is mapped.</p>
            ) : (
              <Table>
                <thead><tr><Th>Queue</Th><Th align="right">Rows</Th></tr></thead>
                <tbody>
                  {run.unmappedQueues.map((q) => (
                    <tr key={q.queue}>
                      <Td>
                        {q.queue}
                        <div style={{ fontSize: 11, color: t.inkSoft, marginTop: 2 }}>Map it under Propositions &amp; processes → Queue mappings</div>
                      </Td>
                      <Td align="right" muted>{q.rows.toLocaleString()}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function DataSyncSection({ can }: SectionProps) {
  const t = useTheme();
  const { exportJson, exportSql, changelog, dirty, resetToBase } = useReference();
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [justDiscarded, setJustDiscarded] = useState(false);
  const canDiscard = can("edit_spoke_reference") || can("edit_global_reference");

  const recent = [...changelog].reverse();

  return (
    <div>
      <SectionTitle title="Data & sync" helper="Export the current reference data (with every edit made in this browser) as JSON for the app, or as a SQL script for the analytics warehouse. The change log below is a running record of every save, most recent first." />

      <DataHealthBlock />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PrimaryButton onClick={() => download("reference.json", exportJson(), "application/json")}>Download reference.json</PrimaryButton>
        <PrimaryButton onClick={() => download("07_seed_reference.sql", exportSql(), "application/sql")}>Download SQL sync script</PrimaryButton>
      </div>

      <div style={{ marginTop: 22 }}>
        <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Change log</h3>
        <Table>
          <thead><tr><Th>When</Th><Th>Section</Th><Th>Actor</Th></tr></thead>
          <tbody>
            {recent.length === 0 && <EmptyRow colSpan={3}>No local edits yet — this dashboard is showing the base reference data.</EmptyRow>}
            {recent.map((c, i) => (
              <tr key={i}>
                <Td>{fmtWhen(c.ts)}</Td>
                <Td muted>{c.section}</Td>
                <Td muted>{c.actor ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {canDiscard && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${t.ruleSoft}` }}>
          <h3 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Discard local edits</h3>
          <p style={{ margin: "0 0 10px", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, lineHeight: 1.5, maxWidth: 640 }}>
            Wipes every edit made in this browser and reverts to the base reference data shipped with the build. This cannot be undone — export a backup first if you need one.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <DangerButton onClick={() => setConfirmingDiscard(true)} disabled={!dirty} title={!dirty ? "No local edits to discard." : undefined}>Discard local edits</DangerButton>
            {justDiscarded && <SavedPill text="Discarded — showing base reference data" />}
          </div>
        </div>
      )}

      {confirmingDiscard && (
        <ConfirmDialog
          title="Discard all local edits?"
          body="Every change made in this browser — spokes, processes, rates, VDIs, people costs, exception patterns — will be permanently reverted to the base reference data. This can't be undone."
          confirmLabel="Discard everything"
          danger
          onConfirm={() => { resetToBase(); setConfirmingDiscard(false); setJustDiscarded(true); }}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}
    </div>
  );
}
