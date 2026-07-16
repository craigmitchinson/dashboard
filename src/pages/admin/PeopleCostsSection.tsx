import { useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { PeopleCostHistoryRef } from "../../reference/reference-store";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, LockBadge, LOCK_REASON,
  inputStyle, useSectionSave, historyRowRights, mostRecent, todayISO, isValidISODate,
} from "./shared";
import type { SectionProps } from "./shared";

const ownerLabel = (ownerId: string, reference: SectionProps["reference"]) =>
  ownerId === "HUB" ? "Hub (CoE team)" : reference.spokes.find((s) => String(s.spokeId) === ownerId)?.spokeName ?? `Owner ${ownerId}`;

export function PeopleCostsSection({ reference, update, actor, can }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const owners = useMemo(() => ["HUB", ...reference.spokes.map((s) => String(s.spokeId))], [reference.spokes]);
  const [ownerId, setOwnerId] = useState(owners[0] ?? "HUB");
  const [err, setErr] = useState<string | null>(null);

  const spokeNameFor = ownerId === "HUB" ? null : reference.spokes.find((s) => String(s.spokeId) === ownerId)?.spokeName ?? null;
  const editable = ownerId === "HUB" ? can("edit_global_reference") : spokeNameFor != null && can("edit_spoke_reference", spokeNameFor);

  const rows = reference.peopleCostHistory.filter((p) => p.ownerId === ownerId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const latest = mostRecent(rows);
  const today = todayISO();

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ headcount: string; annualCostGBP: string; note: string }>({ headcount: "", annualCostGBP: "", note: "" });
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<{ effectiveFrom: string; headcount: string; annualCostGBP: string; note: string }>({ effectiveFrom: "", headcount: "", annualCostGBP: "", note: "" });

  const startEdit = (r: PeopleCostHistoryRef) => {
    setEditingKey(r.effectiveFrom);
    setEditDraft({ headcount: String(r.headcount), annualCostGBP: String(r.annualCostGBP), note: r.note ?? "" });
    setErr(null);
  };

  const commitEdit = (effectiveFrom: string) => {
    const hc = Number(editDraft.headcount);
    const cost = Number(editDraft.annualCostGBP);
    if (!isFinite(hc) || hc <= 0) return setErr("Headcount must be a positive number.");
    if (!isFinite(cost) || cost <= 0) return setErr("Annual cost must be a positive number.");
    save("peopleCostHistory", (d) => {
      d.peopleCostHistory = d.peopleCostHistory.map((p) => (p.ownerId === ownerId && p.effectiveFrom === effectiveFrom ? { ...p, headcount: hc, annualCostGBP: cost, note: editDraft.note.trim() || undefined } : p));
    });
    setEditingKey(null);
    setErr(null);
  };

  const remove = (effectiveFrom: string) => {
    save("peopleCostHistory", (d) => { d.peopleCostHistory = d.peopleCostHistory.filter((p) => !(p.ownerId === ownerId && p.effectiveFrom === effectiveFrom)); });
  };

  const commitAdd = () => {
    if (!isValidISODate(addDraft.effectiveFrom)) return setErr("Pick a valid effective-from date.");
    if (addDraft.effectiveFrom < today) return setErr(`New records can't be backdated — ${LOCK_REASON}`);
    if (rows.some((r) => r.effectiveFrom === addDraft.effectiveFrom)) return setErr("This owner already has a record effective from that date.");
    const hc = Number(addDraft.headcount);
    const cost = Number(addDraft.annualCostGBP);
    if (!isFinite(hc) || hc <= 0) return setErr("Headcount must be a positive number.");
    if (!isFinite(cost) || cost <= 0) return setErr("Annual cost must be a positive number.");
    save("peopleCostHistory", (d) => {
      d.peopleCostHistory = [...d.peopleCostHistory, { ownerId, headcount: hc, annualCostGBP: cost, effectiveFrom: addDraft.effectiveFrom, note: addDraft.note.trim() || undefined }];
    }, "Saved — dashboards updated.");
    setAdding(false);
    setAddDraft({ effectiveFrom: "", headcount: "", annualCostGBP: "", note: "" });
    setErr(null);
  };

  return (
    <div>
      <SectionTitle
        title="People costs"
        helper="The CoE team's run-rate (owner 'HUB') is the only people cost that feeds the economics engine — it becomes the hub pool £/day, apportioned across all automated work by bot worktime. Each spoke's own people cost is recorded here for reference only; it is never charged into estate cost."
      />

      <Field id="pc-owner" label="Owner" width={280}>
        <select id="pc-owner" style={inputStyle(t)} value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setErr(null); setAdding(false); setEditingKey(null); }}>
          {owners.map((o) => <option key={o} value={o}>{ownerLabel(o, reference)}{o !== "HUB" && !can("edit_spoke_reference", ownerLabel(o, reference)) ? " (read-only for you)" : ""}</option>)}
        </select>
      </Field>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ marginTop: 12 }}>
        <Table>
          <thead><tr><Th>Effective from</Th><Th align="right">Headcount</Th><Th align="right">Annual cost (£)</Th><Th>Note</Th>{editable && <Th align="right">Actions</Th>}</tr></thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={editable ? 5 : 4}>No cost history recorded for this owner yet.</EmptyRow>}
            {rows.map((r) => {
              const rights = historyRowRights(r.effectiveFrom, latest?.effectiveFrom === r.effectiveFrom, today);
              const editing = editingKey === r.effectiveFrom;
              return (
                <tr key={r.effectiveFrom}>
                  <Td>{r.effectiveFrom}{r.effectiveFrom > today && <span style={{ marginLeft: 6, fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft }}>(future)</span>}</Td>
                  <Td align="right">{editing ? <input type="number" min={1} style={inputStyle(t, { width: 80, textAlign: "right" })} value={editDraft.headcount} onChange={(e) => setEditDraft({ ...editDraft, headcount: e.target.value })} aria-label="Headcount" /> : r.headcount}</Td>
                  <Td align="right">{editing ? <input type="number" min={0} step={100} style={inputStyle(t, { width: 110, textAlign: "right" })} value={editDraft.annualCostGBP} onChange={(e) => setEditDraft({ ...editDraft, annualCostGBP: e.target.value })} aria-label="Annual cost" /> : `£${r.annualCostGBP.toLocaleString("en-GB")}`}</Td>
                  <Td muted>{editing ? <input style={inputStyle(t)} value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} aria-label="Note" /> : (r.note ?? "—")}</Td>
                  {editable && (
                    <Td align="right">
                      {editing ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => commitEdit(r.effectiveFrom)}>Save</GhostButton>
                          <GhostButton onClick={() => setEditingKey(null)}>Cancel</GhostButton>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                          {rights.canEdit && <GhostButton onClick={() => startEdit(r)}>Edit</GhostButton>}
                          {rights.canDelete && <DangerButton onClick={() => remove(r.effectiveFrom)} title={!rights.canEdit ? "This is the most recent record — delete undoes it if it was added by mistake." : undefined}>Delete</DangerButton>}
                          {!rights.canEdit && !rights.canDelete && <LockBadge reason={LOCK_REASON} />}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {editable && (
        adding ? (
          <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field id="pc-add-date" label="Effective from" width={150}><input id="pc-add-date" type="date" style={inputStyle(t)} value={addDraft.effectiveFrom} onChange={(e) => setAddDraft({ ...addDraft, effectiveFrom: e.target.value })} /></Field>
            <Field id="pc-add-hc" label="Headcount" width={100}><input id="pc-add-hc" type="number" min={1} style={inputStyle(t)} value={addDraft.headcount} onChange={(e) => setAddDraft({ ...addDraft, headcount: e.target.value })} /></Field>
            <Field id="pc-add-cost" label="Annual cost (£)" width={140}><input id="pc-add-cost" type="number" min={0} step={100} style={inputStyle(t)} value={addDraft.annualCostGBP} onChange={(e) => setAddDraft({ ...addDraft, annualCostGBP: e.target.value })} /></Field>
            <Field id="pc-add-note" label="Note (optional)" width={220}><input id="pc-add-note" style={inputStyle(t)} value={addDraft.note} onChange={(e) => setAddDraft({ ...addDraft, note: e.target.value })} /></Field>
            <PrimaryButton onClick={commitAdd}>Add record</PrimaryButton>
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}><GhostButton onClick={() => { setAdding(true); setAddDraft({ effectiveFrom: "", headcount: "", annualCostGBP: "", note: "" }); }}>+ Add record from date…</GhostButton></div>
        )
      )}
      <Announcer />
    </div>
  );
}
