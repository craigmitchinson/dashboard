import { useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, LockBadge, LOCK_REASON,
  inputStyle, useSectionSave, historyRowRights, mostRecent, todayISO, isValidISODate,
} from "./shared";
import type { SectionProps } from "./shared";

export function GradeRateSection({ reference, update, actor, isAdmin }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const grades = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of reference.gradeRates) m.set(g.grade, g.gradeName);
    return Array.from(m.entries());
  }, [reference.gradeRates]);
  const [grade, setGrade] = useState<string>(grades[0]?.[0] ?? "");
  const [err, setErr] = useState<string | null>(null);
  const today = todayISO();

  const rows = reference.gradeRates.filter((g) => g.grade === grade).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const latest = mostRecent(rows);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ effectiveFrom: "", hourlyCostGBP: "" });
  const [addingGrade, setAddingGrade] = useState(false);
  const [newGrade, setNewGrade] = useState({ grade: "", gradeName: "", effectiveFrom: "", hourlyCostGBP: "" });

  if (!isAdmin) {
    return (
      <div>
        <SectionTitle title="Grade rate card" helper="The £/hour rate for each colleague grade, in force on each date. Benefit for every completed item is valued at the grade rate in force on its outcome date. Admin-only — read-only for your role." />
        <RateTable rows={reference.gradeRates.filter((g) => g.grade === grade).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))} today={today} editable={false} onEdit={() => {}} onDelete={() => {}} editingKey={null} editRate="" setEditRate={() => {}} onSave={() => {}} onCancel={() => {}} />
      </div>
    );
  }

  const commitEdit = (effectiveFrom: string) => {
    const rate = Number(editRate);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    save("gradeRates", (d) => { d.gradeRates = d.gradeRates.map((g) => (g.grade === grade && g.effectiveFrom === effectiveFrom ? { ...g, hourlyCostGBP: rate } : g)); });
    setEditingKey(null);
    setErr(null);
  };

  const remove = (effectiveFrom: string) => {
    save("gradeRates", (d) => { d.gradeRates = d.gradeRates.filter((g) => !(g.grade === grade && g.effectiveFrom === effectiveFrom)); });
  };

  const commitAdd = () => {
    if (!isValidISODate(addDraft.effectiveFrom)) return setErr("Pick a valid effective-from date.");
    if (addDraft.effectiveFrom < today) return setErr(`New records can't be backdated — ${LOCK_REASON}`);
    if (rows.some((r) => r.effectiveFrom === addDraft.effectiveFrom)) return setErr("This grade already has a rate effective from that date.");
    const rate = Number(addDraft.hourlyCostGBP);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    const gradeName = rows[0]?.gradeName ?? grade;
    save("gradeRates", (d) => { d.gradeRates = [...d.gradeRates, { grade, gradeName, effectiveFrom: addDraft.effectiveFrom, hourlyCostGBP: rate }]; }, "Saved — dashboards updated.");
    setAdding(false);
    setAddDraft({ effectiveFrom: "", hourlyCostGBP: "" });
    setErr(null);
  };

  const commitNewGrade = () => {
    const code = newGrade.grade.trim().toUpperCase();
    const name = newGrade.gradeName.trim();
    if (!code || !name) return setErr("Grade code and grade name are both required.");
    if (grades.some(([g]) => g === code)) return setErr("That grade code already exists.");
    if (!isValidISODate(newGrade.effectiveFrom)) return setErr("Pick a valid effective-from date.");
    if (newGrade.effectiveFrom < today) return setErr(`New records can't be backdated — ${LOCK_REASON}`);
    const rate = Number(newGrade.hourlyCostGBP);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    save("gradeRates", (d) => { d.gradeRates = [...d.gradeRates, { grade: code, gradeName: name, effectiveFrom: newGrade.effectiveFrom, hourlyCostGBP: rate }]; }, "Saved — new grade is live and selectable on any process.");
    setAddingGrade(false);
    setNewGrade({ grade: "", gradeName: "", effectiveFrom: "", hourlyCostGBP: "" });
    setGrade(code);
    setErr(null);
  };

  return (
    <div>
      <SectionTitle title="Grade rate card" helper="The £/hour rate for each colleague grade, in force on each date. Benefit for every completed item is valued at the grade rate in force on its outcome date — this is the single most sensitive number on the whole dashboard." />

      <Field id="gr-grade" label="Grade" width={240}>
        <select id="gr-grade" style={inputStyle(t)} value={grade} onChange={(e) => { setGrade(e.target.value); setErr(null); }}>
          {grades.length === 0 && <option value="">No grades yet</option>}
          {grades.map(([g, name]) => <option key={g} value={g}>{name} ({g})</option>)}
        </select>
      </Field>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      {grade && (
        <div style={{ marginTop: 12 }}>
          <RateTable rows={rows} today={today} editable onEdit={(r) => { setEditingKey(r.effectiveFrom); setEditRate(String(r.hourlyCostGBP)); setErr(null); }} onDelete={remove} editingKey={editingKey} editRate={editRate} setEditRate={setEditRate} onSave={commitEdit} onCancel={() => setEditingKey(null)} latestKey={latest?.effectiveFrom} />
        </div>
      )}

      {grade && (
        adding ? (
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end" }}>
            <Field id="gr-add-date" label="Effective from" width={150}><input id="gr-add-date" type="date" style={inputStyle(t)} value={addDraft.effectiveFrom} onChange={(e) => setAddDraft({ ...addDraft, effectiveFrom: e.target.value })} /></Field>
            <Field id="gr-add-rate" label="Hourly cost (£)" width={130}><input id="gr-add-rate" type="number" min={0} step={0.5} style={inputStyle(t)} value={addDraft.hourlyCostGBP} onChange={(e) => setAddDraft({ ...addDraft, hourlyCostGBP: e.target.value })} /></Field>
            <PrimaryButton onClick={commitAdd}>Add record</PrimaryButton>
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}><GhostButton onClick={() => setAdding(true)}>+ Add record from date…</GhostButton></div>
        )
      )}

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${t.ruleSoft}` }}>
        {addingGrade ? (
          <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field id="ng-code" label="Grade code" width={100}><input id="ng-code" style={inputStyle(t)} value={newGrade.grade} onChange={(e) => setNewGrade({ ...newGrade, grade: e.target.value })} placeholder="e.g. G4" /></Field>
            <Field id="ng-name" label="Grade name" width={180}><input id="ng-name" style={inputStyle(t)} value={newGrade.gradeName} onChange={(e) => setNewGrade({ ...newGrade, gradeName: e.target.value })} placeholder="e.g. Senior analyst" /></Field>
            <Field id="ng-date" label="Effective from" width={150}><input id="ng-date" type="date" style={inputStyle(t)} value={newGrade.effectiveFrom} onChange={(e) => setNewGrade({ ...newGrade, effectiveFrom: e.target.value })} /></Field>
            <Field id="ng-rate" label="Hourly cost (£)" width={130}><input id="ng-rate" type="number" min={0} step={0.5} style={inputStyle(t)} value={newGrade.hourlyCostGBP} onChange={(e) => setNewGrade({ ...newGrade, hourlyCostGBP: e.target.value })} /></Field>
            <PrimaryButton onClick={commitNewGrade}>Save new grade</PrimaryButton>
            <GhostButton onClick={() => setAddingGrade(false)}>Cancel</GhostButton>
          </div>
        ) : (
          <GhostButton onClick={() => setAddingGrade(true)}>+ Add a new grade</GhostButton>
        )}
      </div>
      <Announcer />
    </div>
  );
}

function RateTable({
  rows, today, editable, onEdit, onDelete, editingKey, editRate, setEditRate, onSave, onCancel, latestKey,
}: {
  rows: { effectiveFrom: string; hourlyCostGBP: number; gradeName: string; grade: string }[];
  today: string;
  editable: boolean;
  onEdit: (r: { effectiveFrom: string; hourlyCostGBP: number; gradeName: string; grade: string }) => void;
  onDelete: (effectiveFrom: string) => void;
  editingKey: string | null;
  editRate: string;
  setEditRate: (v: string) => void;
  onSave: (effectiveFrom: string) => void;
  onCancel: () => void;
  latestKey?: string;
}) {
  const t = useTheme();
  return (
    <Table>
      <thead><tr><Th>Effective from</Th><Th align="right">Hourly cost (£)</Th>{editable && <Th align="right">Actions</Th>}</tr></thead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={editable ? 3 : 2}>No rate history for this grade yet.</EmptyRow>}
        {rows.map((r) => {
          const rights = historyRowRights(r.effectiveFrom, latestKey === r.effectiveFrom, today);
          const editing = editingKey === r.effectiveFrom;
          return (
            <tr key={r.effectiveFrom}>
              <Td>{r.effectiveFrom}{r.effectiveFrom > today && <span style={{ marginLeft: 6, fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft }}>(future)</span>}</Td>
              <Td align="right">{editing ? <input type="number" min={0} step={0.5} style={inputStyle(t, { width: 100, textAlign: "right" })} value={editRate} onChange={(e) => setEditRate(e.target.value)} aria-label="Hourly cost" /> : `£${r.hourlyCostGBP.toFixed(2)}`}</Td>
              {editable && (
                <Td align="right">
                  {editing ? (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <GhostButton onClick={() => onSave(r.effectiveFrom)}>Save</GhostButton>
                      <GhostButton onClick={onCancel}>Cancel</GhostButton>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                      {rights.canEdit && <GhostButton onClick={() => onEdit(r)}>Edit</GhostButton>}
                      {rights.canDelete && <DangerButton onClick={() => onDelete(r.effectiveFrom)}>Delete</DangerButton>}
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
  );
}
