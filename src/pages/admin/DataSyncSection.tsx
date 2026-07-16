import { useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import { useReference } from "../../reference/reference-context";
import {
  ConfirmDialog, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, SavedPill,
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
