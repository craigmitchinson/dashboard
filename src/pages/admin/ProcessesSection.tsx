import { useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { ProcessRef, PropositionRef, QueueMapRef } from "../../reference/reference-store";
import { gradeNameOf, gradesInScopeForSpoke } from "../../reference/reference-store";
import type { GradeRef } from "../../reference/reference-store";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow,
  inputStyle, useSectionSave, PROCESS_ICON_OPTIONS,
} from "./shared";
import type { SectionProps } from "./shared";

type ProcDraft = { processName: string; processAcronym: string; processDescription: string; propositionId: number; smvMinutes: string; grade: string; isActive: boolean; icon: string; tags: string };
const procDraftOf = (p: ProcessRef): ProcDraft => ({ processName: p.processName, processAcronym: p.processAcronym, processDescription: p.processDescription, propositionId: p.propositionId, smvMinutes: String(p.smvMinutes), grade: p.grade, isActive: p.isActive, icon: p.icon, tags: p.tags.join(", ") });

export function ProcessesSection({ reference, update, actor, can }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const [selectedSpokeId, setSelectedSpokeId] = useState<number | null>(reference.spokes[0]?.spokeId ?? null);
  const [err, setErr] = useState<string | null>(null);

  const spoke = reference.spokes.find((s) => s.spokeId === selectedSpokeId);
  const editable = !!spoke && can("edit_spoke_reference", spoke.spokeName);

  const spokePropositions = useMemo(() => reference.propositions.filter((p) => p.spokeId === selectedSpokeId), [reference.propositions, selectedSpokeId]);
  const spokeProcesses = useMemo(() => reference.processes.filter((p) => spokePropositions.some((pr) => pr.propositionId === p.propositionId)), [reference.processes, spokePropositions]);

  return (
    <div>
      <SectionTitle
        title="Propositions & processes"
        helper="What each spoke automates: propositions group processes, each process carries the standard minutes value (SMV) and colleague grade that drive benefit, and the queue mappings tell the pipeline which Blue Prism queue feeds which process."
      />

      <Field id="proc-spoke-picker" label="Spoke" width={280}>
        <select id="proc-spoke-picker" style={inputStyle(t)} value={selectedSpokeId ?? ""} onChange={(e) => setSelectedSpokeId(e.target.value ? Number(e.target.value) : null)}>
          {reference.spokes.length === 0 && <option value="">No spokes yet — add one under Squads</option>}
          {reference.spokes.map((s) => (
            <option key={s.spokeId} value={s.spokeId}>{s.spokeName}{!can("edit_spoke_reference", s.spokeName) ? " (read-only for you)" : ""}</option>
          ))}
        </select>
      </Field>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      {spoke && (
        <>
          <PropositionsBlock reference={reference} spokeId={spoke.spokeId} editable={editable} save={save} setErr={setErr} />
          <ProcessesBlock reference={reference} propositions={spokePropositions} processes={spokeProcesses} editable={editable} save={save} setErr={setErr} />
          <QueueMapBlock reference={reference} processes={spokeProcesses} editable={editable} save={save} setErr={setErr} />
        </>
      )}
      <Announcer />
    </div>
  );
}

type SaveFn = ReturnType<typeof useSectionSave>["save"];

// --- propositions -------------------------------------------------------------
function PropositionsBlock({ reference, spokeId, editable, save, setErr }: { reference: SectionProps["reference"]; spokeId: number; editable: boolean; save: SaveFn; setErr: (e: string | null) => void }) {
  const t = useTheme();
  const list = reference.propositions.filter((p) => p.spokeId === spokeId);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");

  const commitEdit = (id: number) => {
    const trimmed = name.trim();
    if (!trimmed) return setErr("Proposition name is required.");
    if (list.some((p) => p.propositionId !== id && p.propositionName.toLowerCase() === trimmed.toLowerCase())) return setErr("That proposition name is already used in this spoke.");
    save("propositions", (draft) => { draft.propositions = draft.propositions.map((p) => (p.propositionId === id ? { ...p, propositionName: trimmed } : p)); });
    setEditingId(null);
    setErr(null);
  };

  const commitAdd = () => {
    const trimmed = addName.trim();
    if (!trimmed) return setErr("Proposition name is required.");
    if (list.some((p) => p.propositionName.toLowerCase() === trimmed.toLowerCase())) return setErr("That proposition name is already used in this spoke.");
    const nextId = reference.propositions.length ? Math.max(...reference.propositions.map((p) => p.propositionId)) + 1 : 1;
    save("propositions", (draft) => { draft.propositions = [...draft.propositions, { propositionId: nextId, propositionName: trimmed, spokeId }]; });
    setAdding(false);
    setAddName("");
    setErr(null);
  };

  const remove = (id: number) => {
    if (reference.processes.some((p) => p.propositionId === id)) return setErr("Can't delete a proposition that still has processes assigned to it — reassign or delete those first.");
    save("propositions", (draft) => { draft.propositions = draft.propositions.filter((p) => p.propositionId !== id); });
  };

  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Propositions</h3>
      <Table>
        <thead><tr><Th>Name</Th>{editable && <Th align="right">Actions</Th>}</tr></thead>
        <tbody>
          {list.length === 0 && <EmptyRow colSpan={editable ? 2 : 1}>No propositions in this spoke yet.</EmptyRow>}
          {list.map((p) => (
            <tr key={p.propositionId}>
              <Td>{editingId === p.propositionId ? <input style={inputStyle(t)} value={name} onChange={(e) => setName(e.target.value)} aria-label="Proposition name" /> : p.propositionName}</Td>
              {editable && (
                <Td align="right">
                  {editingId === p.propositionId ? (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <GhostButton onClick={() => commitEdit(p.propositionId)}>Save</GhostButton>
                      <GhostButton onClick={() => setEditingId(null)}>Cancel</GhostButton>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <GhostButton onClick={() => { setEditingId(p.propositionId); setName(p.propositionName); }}>Edit</GhostButton>
                      <DangerButton onClick={() => remove(p.propositionId)}>Delete</DangerButton>
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </Table>
      {editable && (
        adding ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "flex-end" }}>
            <Field id="prop-add-name" label="New proposition name" width={260}>
              <input id="prop-add-name" style={inputStyle(t)} value={addName} onChange={(e) => setAddName(e.target.value)} />
            </Field>
            <PrimaryButton onClick={commitAdd}>Add</PrimaryButton>
            <GhostButton onClick={() => { setAdding(false); setAddName(""); }}>Cancel</GhostButton>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}><GhostButton onClick={() => setAdding(true)}>+ Add proposition</GhostButton></div>
        )
      )}
    </div>
  );
}

// --- processes ------------------------------------------------------------------
function ProcessesBlock({
  reference, propositions, processes, editable, save, setErr,
}: {
  reference: SectionProps["reference"];
  propositions: PropositionRef[];
  processes: ProcessRef[];
  editable: boolean;
  save: SaveFn;
  setErr: (e: string | null) => void;
}) {
  const t = useTheme();

  // A process's grade may only be one that's in-scope for its proposition's
  // OWNING spoke (propositions are spoke-scoped — PropositionRef.spokeId).
  // Recomputed per-proposition (not just once for the tab's selected spoke)
  // so it stays correct if this block is ever reused somewhere propositions
  // aren't already pre-filtered to a single spoke.
  const gradesForProposition = (propositionId: number): GradeRef[] => {
    const prop = reference.propositions.find((pr) => pr.propositionId === propositionId);
    const spokeName = prop ? reference.spokes.find((s) => s.spokeId === prop.spokeId)?.spokeName : undefined;
    return gradesInScopeForSpoke(reference, spokeName);
  };

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProcDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<ProcDraft>({ processName: "", processAcronym: "", processDescription: "", propositionId: propositions[0]?.propositionId ?? 0, smvMinutes: "5", grade: gradesForProposition(propositions[0]?.propositionId ?? 0)[0]?.grade ?? "", isActive: true, icon: "form", tags: "" });

  const validate = (d: ProcDraft): string | null => {
    if (!d.processName.trim()) return "Process name is required.";
    if (!d.processAcronym.trim()) return "Process acronym is required.";
    const smv = Number(d.smvMinutes);
    if (!isFinite(smv) || smv <= 0) return "SMV minutes must be a positive number.";
    if (!d.grade) return "Choose a grade.";
    if (!d.propositionId) return "Choose a proposition.";
    if (!gradesForProposition(d.propositionId).some((g) => g.grade === d.grade)) return `Grade '${gradeNameOf(reference, d.grade)}' is not available for this proposition's spoke — pick a grade in scope.`;
    return null;
  };

  const toRef = (id: number, d: ProcDraft): ProcessRef => ({
    processId: id, processName: d.processName.trim(), processAcronym: d.processAcronym.trim().toUpperCase(),
    processDescription: d.processDescription.trim(), propositionId: d.propositionId, smvMinutes: Number(d.smvMinutes),
    grade: d.grade, isActive: d.isActive, icon: d.icon, tags: d.tags.split(",").map((x) => x.trim()).filter(Boolean),
  });

  const commitEdit = (id: number) => {
    if (!draft) return;
    const e = validate(draft);
    if (e) return setErr(e);
    save("processes", (drf) => { drf.processes = drf.processes.map((p) => (p.processId === id ? toRef(id, draft) : p)); });
    setEditingId(null);
    setDraft(null);
    setErr(null);
  };

  const commitAdd = () => {
    const e = validate(addDraft);
    if (e) return setErr(e);
    const nextId = reference.processes.length ? Math.max(...reference.processes.map((p) => p.processId)) + 1 : 1;
    save("processes", (drf) => { drf.processes = [...drf.processes, toRef(nextId, addDraft)]; }, "Saved — new process is live. Map a queue to it below so work-queue activity can flow into it on the next data build.");
    setAdding(false);
    setAddDraft({ ...addDraft, processName: "", processAcronym: "", processDescription: "", tags: "" });
    setErr(null);
  };

  const remove = (id: number) => {
    if (reference.queueMap.some((q) => q.processId === id)) return setErr("Can't delete a process that still has a queue mapped to it — remove the mapping first.");
    save("processes", (drf) => { drf.processes = drf.processes.filter((p) => p.processId !== id); });
  };

  const propName = (id: number) => propositions.find((p) => p.propositionId === id)?.propositionName ?? "—";

  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Processes</h3>
      <Table>
        <thead>
          <tr>
            <Th>Process</Th><Th>Acronym</Th><Th>Proposition</Th><Th align="right">SMV (min)</Th><Th>Grade</Th><Th align="center">Active</Th>
            {editable && <Th align="right">Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {processes.length === 0 && <EmptyRow colSpan={editable ? 7 : 6}>No processes in this spoke yet.</EmptyRow>}
          {processes.map((p) => {
            const editing = editingId === p.processId && draft;
            return (
              <tr key={p.processId}>
                {editing ? (
                  <>
                    <Td><input style={inputStyle(t)} value={draft.processName} onChange={(e) => setDraft({ ...draft, processName: e.target.value })} aria-label="Process name" /></Td>
                    <Td><input style={inputStyle(t, { width: 90 })} value={draft.processAcronym} onChange={(e) => setDraft({ ...draft, processAcronym: e.target.value })} aria-label="Acronym" /></Td>
                    <Td>
                      <select
                        style={inputStyle(t)}
                        value={draft.propositionId}
                        onChange={(e) => {
                          const newPropId = Number(e.target.value);
                          const inScope = gradesForProposition(newPropId);
                          if (draft.grade && !inScope.some((g) => g.grade === draft.grade)) {
                            setErr(`Grade '${gradeNameOf(reference, draft.grade)}' is not available for this proposition's spoke — pick a grade in scope.`);
                            setDraft({ ...draft, propositionId: newPropId, grade: "" });
                          } else {
                            setDraft({ ...draft, propositionId: newPropId });
                          }
                        }}
                        aria-label="Proposition"
                      >
                        {propositions.map((pr) => <option key={pr.propositionId} value={pr.propositionId}>{pr.propositionName}</option>)}
                      </select>
                    </Td>
                    <Td align="right"><input type="number" min={0.1} step={0.1} style={inputStyle(t, { width: 80, textAlign: "right" })} value={draft.smvMinutes} onChange={(e) => setDraft({ ...draft, smvMinutes: e.target.value })} aria-label="SMV minutes" /></Td>
                    <Td>
                      <select style={inputStyle(t)} value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} aria-label="Grade">
                        {gradesForProposition(draft.propositionId).length === 0 && <option value="">No grades in scope</option>}
                        {gradesForProposition(draft.propositionId).map((g) => <option key={g.grade} value={g.grade}>{g.gradeName} ({g.grade})</option>)}
                      </select>
                    </Td>
                    <Td align="center"><input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} aria-label="Active" /></Td>
                    <Td align="right">
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <GhostButton onClick={() => commitEdit(p.processId)}>Save</GhostButton>
                        <GhostButton onClick={() => { setEditingId(null); setDraft(null); }}>Cancel</GhostButton>
                      </div>
                    </Td>
                  </>
                ) : (
                  <>
                    <Td>{p.processName}</Td>
                    <Td><span style={{ fontFamily: fonts.mono, fontSize: 11 }}>{p.processAcronym}</span></Td>
                    <Td muted>{propName(p.propositionId)}</Td>
                    <Td align="right">{p.smvMinutes}</Td>
                    <Td>{p.grade}</Td>
                    <Td align="center">{p.isActive ? "✓" : "—"}</Td>
                    {editable && (
                      <Td align="right">
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => { setEditingId(p.processId); setDraft(procDraftOf(p)); }}>Edit</GhostButton>
                          <DangerButton onClick={() => remove(p.processId)}>Delete</DangerButton>
                        </div>
                      </Td>
                    )}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>

      {editable && (
        adding ? (
          <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="pa-name" label="Process name" width={220}><input id="pa-name" style={inputStyle(t)} value={addDraft.processName} onChange={(e) => setAddDraft({ ...addDraft, processName: e.target.value })} /></Field>
              <Field id="pa-acr" label="Acronym" width={100}><input id="pa-acr" style={inputStyle(t)} value={addDraft.processAcronym} onChange={(e) => setAddDraft({ ...addDraft, processAcronym: e.target.value })} /></Field>
              <Field id="pa-prop" label="Proposition" width={200}>
                <select
                  id="pa-prop"
                  style={inputStyle(t)}
                  value={addDraft.propositionId}
                  onChange={(e) => {
                    const newPropId = Number(e.target.value);
                    const inScope = gradesForProposition(newPropId);
                    if (addDraft.grade && !inScope.some((g) => g.grade === addDraft.grade)) {
                      setErr(`Grade '${gradeNameOf(reference, addDraft.grade)}' is not available for this proposition's spoke — pick a grade in scope.`);
                      setAddDraft({ ...addDraft, propositionId: newPropId, grade: "" });
                    } else {
                      setAddDraft({ ...addDraft, propositionId: newPropId });
                    }
                  }}
                >
                  {propositions.map((pr) => <option key={pr.propositionId} value={pr.propositionId}>{pr.propositionName}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="pa-smv" label="SMV minutes" width={110}><input id="pa-smv" type="number" min={0.1} step={0.1} style={inputStyle(t)} value={addDraft.smvMinutes} onChange={(e) => setAddDraft({ ...addDraft, smvMinutes: e.target.value })} /></Field>
              <Field id="pa-grade" label="Grade" width={180}>
                <select id="pa-grade" style={inputStyle(t)} value={addDraft.grade} onChange={(e) => setAddDraft({ ...addDraft, grade: e.target.value })}>
                  {gradesForProposition(addDraft.propositionId).length === 0 && <option value="">No grades in scope</option>}
                  {gradesForProposition(addDraft.propositionId).map((g) => <option key={g.grade} value={g.grade}>{g.gradeName} ({g.grade})</option>)}
                </select>
              </Field>
              <Field id="pa-icon" label="Icon" width={140}>
                <select id="pa-icon" style={inputStyle(t)} value={addDraft.icon} onChange={(e) => setAddDraft({ ...addDraft, icon: e.target.value })}>
                  {PROCESS_ICON_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field id="pa-tags" label="Tags (comma-separated)" width={220}><input id="pa-tags" style={inputStyle(t)} value={addDraft.tags} onChange={(e) => setAddDraft({ ...addDraft, tags: e.target.value })} /></Field>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.body, fontSize: 12.5, color: t.ink, alignSelf: "flex-end", paddingBottom: 8 }}>
                <input type="checkbox" checked={addDraft.isActive} onChange={(e) => setAddDraft({ ...addDraft, isActive: e.target.checked })} /> Active
              </label>
            </div>
            <Field id="pa-desc" label="Description" width={480}><input id="pa-desc" style={inputStyle(t)} value={addDraft.processDescription} onChange={(e) => setAddDraft({ ...addDraft, processDescription: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton onClick={commitAdd}>Save process</PrimaryButton>
              <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}><GhostButton onClick={() => setAdding(true)} disabled={propositions.length === 0} title={propositions.length === 0 ? "Add a proposition first" : undefined}>+ Add process</GhostButton></div>
        )
      )}
    </div>
  );
}

// --- queue mappings ---------------------------------------------------------------
function QueueMapBlock({ reference, processes, editable, save, setErr }: { reference: SectionProps["reference"]; processes: ProcessRef[]; editable: boolean; save: SaveFn; setErr: (e: string | null) => void }) {
  const t = useTheme();
  const processIds = new Set(processes.map((p) => p.processId));
  const rows = reference.queueMap.filter((q) => processIds.has(q.processId));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ queueName: string; processId: number; stageName: string; stageOrder: string }>({ queueName: "", processId: processes[0]?.processId ?? 0, stageName: "", stageOrder: "" });

  const processName = (id: number) => processes.find((p) => p.processId === id)?.processName ?? reference.processes.find((p) => p.processId === id)?.processName ?? "—";

  const commitAdd = () => {
    if (!draft.queueName.trim()) return setErr("Queue name is required.");
    if (reference.queueMap.some((q) => q.queueName.toLowerCase() === draft.queueName.trim().toLowerCase())) return setErr("That queue name is already mapped.");
    if (!draft.processId) return setErr("Choose a process.");
    const row: QueueMapRef = { queueName: draft.queueName.trim(), processId: draft.processId, stageName: draft.stageName.trim() || null, stageOrder: draft.stageOrder ? Number(draft.stageOrder) : null };
    save("queueMap", (d) => { d.queueMap = [...d.queueMap, row]; });
    setAdding(false);
    setDraft({ queueName: "", processId: processes[0]?.processId ?? 0, stageName: "", stageOrder: "" });
    setErr(null);
  };

  const remove = (queueName: string) => {
    save("queueMap", (d) => { d.queueMap = d.queueMap.filter((q) => q.queueName !== queueName); });
  };

  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Queue mappings</h3>
      <Table>
        <thead><tr><Th>Queue name</Th><Th>Process</Th><Th>Stage</Th><Th align="right">Order</Th>{editable && <Th align="right">Actions</Th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={editable ? 5 : 4}>No queues mapped for this spoke's processes yet.</EmptyRow>}
          {rows.map((q) => (
            <tr key={q.queueName}>
              <Td><span style={{ fontFamily: fonts.mono, fontSize: 11.5 }}>{q.queueName}</span></Td>
              <Td>{processName(q.processId)}</Td>
              <Td muted>{q.stageName ?? "—"}</Td>
              <Td align="right">{q.stageOrder ?? "—"}</Td>
              {editable && <Td align="right"><DangerButton onClick={() => remove(q.queueName)}>Delete</DangerButton></Td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {editable && (
        adding ? (
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field id="qm-name" label="Queue name" width={200}><input id="qm-name" style={inputStyle(t)} value={draft.queueName} onChange={(e) => setDraft({ ...draft, queueName: e.target.value })} /></Field>
            <Field id="qm-proc" label="Process" width={200}>
              <select id="qm-proc" style={inputStyle(t)} value={draft.processId} onChange={(e) => setDraft({ ...draft, processId: Number(e.target.value) })}>
                {processes.map((p) => <option key={p.processId} value={p.processId}>{p.processName}</option>)}
              </select>
            </Field>
            <Field id="qm-stage" label="Stage name (optional)" width={160}><input id="qm-stage" style={inputStyle(t)} value={draft.stageName} onChange={(e) => setDraft({ ...draft, stageName: e.target.value })} /></Field>
            <Field id="qm-order" label="Stage order (optional)" width={110}><input id="qm-order" type="number" style={inputStyle(t)} value={draft.stageOrder} onChange={(e) => setDraft({ ...draft, stageOrder: e.target.value })} /></Field>
            <PrimaryButton onClick={commitAdd}>Add mapping</PrimaryButton>
            <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}><GhostButton onClick={() => setAdding(true)} disabled={processes.length === 0} title={processes.length === 0 ? "Add a process first" : undefined}>+ Add queue mapping</GhostButton></div>
        )
      )}
    </div>
  );
}
