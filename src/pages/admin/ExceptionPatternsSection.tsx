import { useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { ExceptionPatternRef } from "../../reference/reference-store";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, InfoBanner,
  inputStyle, useSectionSave,
} from "./shared";
import type { SectionProps } from "./shared";

type Draft = { matchPattern: string; exceptionType: "System" | "Business"; priority: string };

export function ExceptionPatternsSection({ reference, update, actor, isAdmin }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const [err, setErr] = useState<string | null>(null);
  const rows = [...reference.exceptionPatterns].sort((a, b) => a.priority - b.priority);

  const [editingPattern, setEditingPattern] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ matchPattern: "", exceptionType: "System", priority: "10" });
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>({ matchPattern: "", exceptionType: "System", priority: String(rows.length ? Math.max(...rows.map((r) => r.priority)) + 10 : 10) });

  const validate = (d: Draft, excludePattern: string | null): string | null => {
    if (!d.matchPattern.trim()) return "Match pattern is required.";
    if (!d.matchPattern.replace(/%/g, "").trim()) return "Pattern must contain matchable text — '%' alone would match every exception.";
    if (reference.exceptionPatterns.some((p) => p.matchPattern !== excludePattern && p.matchPattern.toLowerCase() === d.matchPattern.trim().toLowerCase())) return "That match pattern already exists.";
    const pr = Number(d.priority);
    if (!isFinite(pr)) return "Priority must be a number.";
    return null;
  };

  const startEdit = (r: ExceptionPatternRef) => {
    setEditingPattern(r.matchPattern);
    setDraft({ matchPattern: r.matchPattern, exceptionType: r.exceptionType, priority: String(r.priority) });
    setErr(null);
  };

  const commitEdit = () => {
    if (editingPattern == null) return;
    const e = validate(draft, editingPattern);
    if (e) return setErr(e);
    save("exceptionPatterns", (d) => {
      d.exceptionPatterns = d.exceptionPatterns.map((p) => (p.matchPattern === editingPattern ? { matchPattern: draft.matchPattern.trim(), exceptionType: draft.exceptionType, priority: Number(draft.priority) } : p));
    });
    setEditingPattern(null);
    setErr(null);
  };

  const remove = (matchPattern: string) => {
    save("exceptionPatterns", (d) => { d.exceptionPatterns = d.exceptionPatterns.filter((p) => p.matchPattern !== matchPattern); });
  };

  const commitAdd = () => {
    const e = validate(addDraft, null);
    if (e) return setErr(e);
    save("exceptionPatterns", (d) => {
      d.exceptionPatterns = [...d.exceptionPatterns, { matchPattern: addDraft.matchPattern.trim(), exceptionType: addDraft.exceptionType, priority: Number(addDraft.priority) }];
    }, "Saved. Note: this reclassifies exceptions from the next data build onward — it does not retroactively re-tag exceptions already loaded in this dashboard.");
    setAdding(false);
    setAddDraft({ matchPattern: "", exceptionType: "System", priority: String(rows.length ? Math.max(...rows.map((r) => r.priority)) + 10 : 10) });
    setErr(null);
  };

  if (!isAdmin) {
    return (
      <div>
        <SectionTitle title="Exception patterns" helper="How raw exception reasons get classified as System or Business. Admin-only — read-only for your role." />
        <PatternTable rows={rows} editable={false} onEdit={() => {}} onDelete={() => {}} editingPattern={null} draft={draft} setDraft={setDraft} onSave={() => {}} onCancel={() => {}} />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title="Exception patterns" helper="How raw exception reasons from the work queue get classified as a System or a Business exception, in priority order (lowest number checked first)." />
      <InfoBanner>Explicit "Business Exception:" / "System Exception:" prefixes already present on the reason text always win over every pattern here, no matter the priority order — these patterns only classify reasons that don't already carry one of those prefixes.</InfoBanner>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ marginTop: 12 }}>
        <PatternTable rows={rows} editable onEdit={startEdit} onDelete={remove} editingPattern={editingPattern} draft={draft} setDraft={setDraft} onSave={commitEdit} onCancel={() => setEditingPattern(null)} />
      </div>

      {adding ? (
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field id="ep-pattern" label="Match pattern" width={260}><input id="ep-pattern" style={inputStyle(t)} value={addDraft.matchPattern} onChange={(e) => setAddDraft({ ...addDraft, matchPattern: e.target.value })} placeholder="e.g. timeout" /></Field>
          <Field id="ep-type" label="Classify as" width={150}>
            <select id="ep-type" style={inputStyle(t)} value={addDraft.exceptionType} onChange={(e) => setAddDraft({ ...addDraft, exceptionType: e.target.value as "System" | "Business" })}>
              <option value="System">System</option>
              <option value="Business">Business</option>
            </select>
          </Field>
          <Field id="ep-priority" label="Priority" width={90}><input id="ep-priority" type="number" style={inputStyle(t)} value={addDraft.priority} onChange={(e) => setAddDraft({ ...addDraft, priority: e.target.value })} /></Field>
          <PrimaryButton onClick={commitAdd}>Add pattern</PrimaryButton>
          <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}><GhostButton onClick={() => setAdding(true)}>+ Add pattern</GhostButton></div>
      )}
      <Announcer />
    </div>
  );
}

function PatternTable({
  rows, editable, onEdit, onDelete, editingPattern, draft, setDraft, onSave, onCancel,
}: {
  rows: ExceptionPatternRef[];
  editable: boolean;
  onEdit: (r: ExceptionPatternRef) => void;
  onDelete: (matchPattern: string) => void;
  editingPattern: string | null;
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  return (
    <Table>
      <thead><tr><Th align="right" width={70}>Priority</Th><Th>Match pattern</Th><Th>Classify as</Th>{editable && <Th align="right">Actions</Th>}</tr></thead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={editable ? 4 : 3}>No exception patterns configured yet.</EmptyRow>}
        {rows.map((r) => {
          const editing = editingPattern === r.matchPattern;
          return (
            <tr key={r.matchPattern}>
              <Td align="right">{editing ? <input type="number" style={inputStyle(t, { width: 60, textAlign: "right" })} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} aria-label="Priority" /> : r.priority}</Td>
              <Td>{editing ? <input style={inputStyle(t)} value={draft.matchPattern} onChange={(e) => setDraft({ ...draft, matchPattern: e.target.value })} aria-label="Match pattern" /> : <span style={{ fontFamily: fonts.mono, fontSize: 11.5 }}>{r.matchPattern}</span>}</Td>
              <Td>
                {editing ? (
                  <select style={inputStyle(t)} value={draft.exceptionType} onChange={(e) => setDraft({ ...draft, exceptionType: e.target.value as "System" | "Business" })} aria-label="Classify as">
                    <option value="System">System</option>
                    <option value="Business">Business</option>
                  </select>
                ) : r.exceptionType}
              </Td>
              {editable && (
                <Td align="right">
                  {editing ? (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <GhostButton onClick={onSave}>Save</GhostButton>
                      <GhostButton onClick={onCancel}>Cancel</GhostButton>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <GhostButton onClick={() => onEdit(r)}>Edit</GhostButton>
                      <DangerButton onClick={() => onDelete(r.matchPattern)}>Delete</DangerButton>
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
