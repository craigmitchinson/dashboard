import { useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, LockBadge, LOCK_REASON, ConfirmDialog,
  inputStyle, useSectionSave, historyRowRights, mostRecent, todayISO, isValidISODate,
} from "./shared";
import type { SectionProps } from "./shared";
import { gradesInScopeForSpoke, spokeIdStringOf, spokeOfProcess } from "../../reference/reference-store";
import type { GradeRef, GradeRateRef } from "../../reference/reference-store";

const toggleId = (ids: string[], id: string): string[] => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);

type SaveFn = ReturnType<typeof useSectionSave>["save"];

export function GradeRateSection({ reference, update, actor, can, isAdmin }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);

  // Grade DEFINITIONS (identity + scope) — reference.grades is the source of
  // truth as of SCHEMA_VERSION 3; fall back to the derive-from-gradeRates path
  // (same one gradesInScopeForSpoke uses internally) only if it's empty, e.g.
  // a reference object built before this dimension existed.
  const gradeDefs: GradeRef[] = useMemo(() => {
    const defs = reference.grades ?? [];
    if (defs.length > 0) return defs;
    return gradesInScopeForSpoke(reference, undefined);
  }, [reference.grades, reference.gradeRates]);

  const gradeSelectOptions = useMemo(() => gradeDefs.map((g) => [g.grade, g.gradeName] as [string, string]), [gradeDefs]);

  const [grade, setGradeRaw] = useState<string>(gradeSelectOptions[0]?.[0] ?? "");
  const [err, setErr] = useState<string | null>(null);
  const today = todayISO();

  // Everything scoped to "which spoke override block am I mid-adding" resets
  // whenever the selected grade changes.
  const [extraSpokeBlocks, setExtraSpokeBlocks] = useState<Set<string>>(new Set());
  const [overridePick, setOverridePick] = useState("");

  const setGrade = (g: string) => {
    setGradeRaw(g);
    setErr(null);
    setExtraSpokeBlocks(new Set());
    setOverridePick("");
    setScopeEditingCode(null);
    setRenamingCode(null);
  };

  const universalRows = reference.gradeRates.filter((g) => g.grade === grade && !g.spokeId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const latest = mostRecent(universalRows);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ effectiveFrom: "", hourlyCostGBP: "" });
  const [addBackdated, setAddBackdated] = useState(false);
  const [addPending, setAddPending] = useState<{ effectiveFrom: string; hourlyCostGBP: number } | null>(null);
  const [addingGrade, setAddingGrade] = useState(false);
  const [newGrade, setNewGrade] = useState({ grade: "", gradeName: "", effectiveFrom: "", hourlyCostGBP: "" });
  const [newGradeScope, setNewGradeScope] = useState<string[]>([]);

  const [renamingCode, setRenamingCode] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [scopeEditingCode, setScopeEditingCode] = useState<string | null>(null);
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);
  const [pendingDeleteGrade, setPendingDeleteGrade] = useState<string | null>(null);

  const commitEdit = (effectiveFrom: string) => {
    const rate = Number(editRate);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    save("gradeRates", (d) => { d.gradeRates = d.gradeRates.map((g) => (g.grade === grade && !g.spokeId && g.effectiveFrom === effectiveFrom ? { ...g, hourlyCostGBP: rate } : g)); });
    setEditingKey(null);
    setErr(null);
  };

  const remove = (effectiveFrom: string) => {
    save("gradeRates", (d) => { d.gradeRates = d.gradeRates.filter((g) => !(g.grade === grade && !g.spokeId && g.effectiveFrom === effectiveFrom)); });
  };

  const resetAddForm = () => {
    setAdding(false);
    setAddDraft({ effectiveFrom: "", hourlyCostGBP: "" });
    setAddBackdated(false);
    setErr(null);
  };

  const commitAddRow = (effectiveFrom: string, rate: number) => {
    const gradeName = universalRows[0]?.gradeName ?? gradeDefs.find((g) => g.grade === grade)?.gradeName ?? grade;
    save("gradeRates", (d) => { d.gradeRates = [...d.gradeRates, { grade, gradeName, effectiveFrom, hourlyCostGBP: rate }]; }, "Saved — dashboards updated.");
    resetAddForm();
  };

  const commitAdd = () => {
    if (!isValidISODate(addDraft.effectiveFrom)) return setErr("Pick a valid effective-from date.");
    if (universalRows.some((r) => r.effectiveFrom === addDraft.effectiveFrom)) return setErr("This grade already has a universal rate effective from that date.");
    const rate = Number(addDraft.hourlyCostGBP);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    if (addDraft.effectiveFrom < today) {
      if (!isAdmin || !addBackdated) return setErr(`New records can't be backdated — ${LOCK_REASON}`);
      setAddPending({ effectiveFrom: addDraft.effectiveFrom, hourlyCostGBP: rate });
      return;
    }
    commitAddRow(addDraft.effectiveFrom, rate);
  };

  const commitNewGrade = () => {
    const code = newGrade.grade.trim().toUpperCase();
    const name = newGrade.gradeName.trim();
    if (!code || !name) return setErr("Grade code and grade name are both required.");
    if (gradeDefs.some((g) => g.grade === code)) return setErr("That grade code already exists.");
    if (!isValidISODate(newGrade.effectiveFrom)) return setErr("Pick a valid effective-from date.");
    if (newGrade.effectiveFrom < today) return setErr(`New records can't be backdated — ${LOCK_REASON}`);
    const rate = Number(newGrade.hourlyCostGBP);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    if (newGradeScope.some((sid) => !reference.spokes.some((s) => String(s.spokeId) === sid))) return setErr("Invalid spoke selected in scope.");
    save("grades", (d) => {
      d.grades = [...(d.grades ?? []), { grade: code, gradeName: name, spokeIds: newGradeScope }];
      d.gradeRates = [...d.gradeRates, { grade: code, gradeName: name, effectiveFrom: newGrade.effectiveFrom, hourlyCostGBP: rate }];
    }, "Saved — new grade is live and selectable on any in-scope process.");
    setAddingGrade(false);
    setNewGrade({ grade: "", gradeName: "", effectiveFrom: "", hourlyCostGBP: "" });
    setNewGradeScope([]);
    setGrade(code);
    setErr(null);
  };

  const commitRename = (code: string) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) return setErr("Grade name is required.");
    save("grades", (d) => {
      d.grades = (d.grades ?? []).map((g) => (g.grade === code ? { ...g, gradeName: trimmed } : g));
      d.gradeRates = d.gradeRates.map((g) => (g.grade === code ? { ...g, gradeName: trimmed } : g));
    }, "Saved — dashboards updated.");
    setRenamingCode(null);
    setErr(null);
  };

  const scopeBlockers = (code: string, nextScope: string[]) => {
    if (nextScope.length === 0) return []; // widening to universal can never exclude anyone
    return reference.processes.filter((p) => {
      if (p.grade !== code) return false;
      const spokeName = spokeOfProcess(reference, String(p.processId));
      const sid = spokeIdStringOf(reference, spokeName);
      return sid == null || !nextScope.includes(sid);
    });
  };

  const commitScope = (code: string) => {
    if (scopeDraft.some((sid) => !reference.spokes.some((s) => String(s.spokeId) === sid))) return setErr("Invalid spoke selected in scope.");
    const blockers = scopeBlockers(code, scopeDraft);
    if (blockers.length > 0) {
      return setErr(`Can't narrow scope — still used by: ${blockers.map((p) => `${p.processName} (${p.processAcronym})`).join(", ")}. Reassign those processes' grade first.`);
    }
    save("grades", (d) => { d.grades = (d.grades ?? []).map((g) => (g.grade === code ? { ...g, spokeIds: scopeDraft } : g)); }, "Saved — dashboards updated.");
    setScopeEditingCode(null);
    setErr(null);
  };

  // Blocker-guard runs immediately; on pass we hold the code pending an
  // explicit confirm (below) rather than deleting straight away, since this
  // now cascade-deletes the grade's full rate history too.
  const requestRemoveGrade = (code: string) => {
    const blockers = reference.processes.filter((p) => p.grade === code);
    if (blockers.length > 0) {
      return setErr(`Can't delete — still used by: ${blockers.map((p) => `${p.processName} (${p.processAcronym})`).join(", ")}. Reassign those processes' grade first.`);
    }
    setErr(null);
    setPendingDeleteGrade(code);
  };

  // Cascade-delete: removes the GradeRef AND every gradeRates row for that
  // grade code — universal (spokeId undefined) and every per-spoke override
  // (spokeId set) — in one atomic save, so no orphaned rate-history rows are
  // left behind for a grade code that no longer has a definition.
  const commitRemoveGrade = (code: string) => {
    save("grades", (d) => {
      d.grades = (d.grades ?? []).filter((g) => g.grade !== code);
      d.gradeRates = d.gradeRates.filter((r) => r.grade !== code);
    }, "Saved — grade and its full rate history removed.");
    if (grade === code) setGrade(gradeDefs.find((g) => g.grade !== code)?.grade ?? "");
    setPendingDeleteGrade(null);
    setErr(null);
  };

  // --- spoke rate overrides for the currently-selected grade ------------------
  const currentGradeDef = gradeDefs.find((g) => g.grade === grade);

  const overrideRowsBySpoke = useMemo(() => {
    const m = new Map<string, GradeRateRef[]>();
    for (const r of reference.gradeRates) {
      if (r.grade === grade && r.spokeId) m.set(r.spokeId, [...(m.get(r.spokeId) ?? []), r]);
    }
    return m;
  }, [reference.gradeRates, grade]);

  const visibleOverrideSpokeIds = useMemo(() => {
    const s = new Set<string>(overrideRowsBySpoke.keys());
    for (const sid of extraSpokeBlocks) s.add(sid);
    return s;
  }, [overrideRowsBySpoke, extraSpokeBlocks]);

  const scopedSpokesForGrade = currentGradeDef && currentGradeDef.spokeIds.length > 0
    ? reference.spokes.filter((s) => currentGradeDef.spokeIds.includes(String(s.spokeId)))
    : reference.spokes;

  // NOTE: edit_spoke_reference is checked against the spoke's NAME (matches
  // user.spokeIds' actual contents — see auth/dev-provider.ts and every other
  // call site in this admin area, e.g. ProcessesSection.tsx), not the
  // spokeId-as-string convention GradeRateRef.spokeId/GradeRef.spokeIds use
  // for their own scoping axis. The two "spoke identity" conventions are
  // deliberately different fields — don't cross them.
  const addOverrideCandidates = scopedSpokesForGrade.filter((s) => !visibleOverrideSpokeIds.has(String(s.spokeId)) && can("edit_spoke_reference", s.spokeName));

  const helperText = isAdmin
    ? "The £/hour rate for each colleague grade, in force on each date. Benefit for every completed item is valued at the grade rate in force on its outcome date — this is the single most sensitive number on the whole dashboard."
    : "The £/hour rate for each colleague grade, in force on each date. Benefit for every completed item is valued at the grade rate in force on its outcome date. Grade definitions and universal rates are admin-only; hub leads may add spoke-specific overrides for their own spoke below.";

  return (
    <div>
      <SectionTitle title="Grade rate card" helper={helperText} />

      {/* --- grade definitions ------------------------------------------------ */}
      <div style={{ marginTop: 10 }}>
        <h3 style={{ margin: "0 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Grade definitions</h3>
        <Table>
          <thead><tr><Th>Code</Th><Th>Name</Th><Th>Scope</Th>{isAdmin && <Th align="right">Actions</Th>}</tr></thead>
          <tbody>
            {gradeDefs.length === 0 && <EmptyRow colSpan={isAdmin ? 4 : 3}>No grades defined yet.</EmptyRow>}
            {gradeDefs.map((g) => {
              const scopeLabel = g.spokeIds.length === 0 ? "All spokes" : g.spokeIds.map((sid) => reference.spokes.find((s) => String(s.spokeId) === sid)?.spokeName ?? sid).join(", ");
              const renaming = renamingCode === g.grade;
              const editingScope = scopeEditingCode === g.grade;
              return (
                <tr key={g.grade}>
                  <Td><span style={{ fontFamily: fonts.mono, fontSize: 11 }}>{g.grade}</span></Td>
                  <Td>{renaming ? <input style={inputStyle(t)} value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} aria-label="Grade name" /> : g.gradeName}</Td>
                  <Td muted>
                    {editingScope ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 110, overflow: "auto" }}>
                          {reference.spokes.map((s) => (
                            <label key={s.spokeId} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.body, fontSize: 11.5 }}>
                              <input type="checkbox" checked={scopeDraft.includes(String(s.spokeId))} onChange={() => setScopeDraft(toggleId(scopeDraft, String(s.spokeId)))} /> {s.spokeName}
                            </label>
                          ))}
                        </div>
                        <span style={{ fontFamily: fonts.body, fontSize: 10.5, color: t.inkSoft }}>Leave all unchecked for universal (every spoke may use this grade).</span>
                      </div>
                    ) : scopeLabel}
                  </Td>
                  {isAdmin && (
                    <Td align="right">
                      {renaming ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => commitRename(g.grade)}>Save</GhostButton>
                          <GhostButton onClick={() => setRenamingCode(null)}>Cancel</GhostButton>
                        </div>
                      ) : editingScope ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => commitScope(g.grade)}>Save scope</GhostButton>
                          <GhostButton onClick={() => setScopeEditingCode(null)}>Cancel</GhostButton>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => { setRenamingCode(g.grade); setRenameDraft(g.gradeName); setErr(null); }}>Rename</GhostButton>
                          <GhostButton onClick={() => { setScopeEditingCode(g.grade); setScopeDraft(g.spokeIds); setErr(null); }}>Change scope</GhostButton>
                          <DangerButton onClick={() => requestRemoveGrade(g.grade)}>Delete</DangerButton>
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>

        {isAdmin && (
          <div style={{ marginTop: 10 }}>
            {addingGrade ? (
              <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <Field id="ng-code" label="Grade code" width={100}><input id="ng-code" style={inputStyle(t)} value={newGrade.grade} onChange={(e) => setNewGrade({ ...newGrade, grade: e.target.value })} placeholder="e.g. G4" /></Field>
                  <Field id="ng-name" label="Grade name" width={180}><input id="ng-name" style={inputStyle(t)} value={newGrade.gradeName} onChange={(e) => setNewGrade({ ...newGrade, gradeName: e.target.value })} placeholder="e.g. Senior analyst" /></Field>
                  <Field id="ng-date" label="Effective from" width={150}><input id="ng-date" type="date" style={inputStyle(t)} value={newGrade.effectiveFrom} onChange={(e) => setNewGrade({ ...newGrade, effectiveFrom: e.target.value })} /></Field>
                  <Field id="ng-rate" label="Hourly cost (£)" width={130}><input id="ng-rate" type="number" min={0} step={0.5} style={inputStyle(t)} value={newGrade.hourlyCostGBP} onChange={(e) => setNewGrade({ ...newGrade, hourlyCostGBP: e.target.value })} /></Field>
                </div>
                <Field id="ng-scope" label="Scope" hint="Leave all unchecked for universal (every spoke may use this grade).">
                  <div id="ng-scope" style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 110, overflow: "auto" }}>
                    {reference.spokes.map((s) => (
                      <label key={s.spokeId} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: fonts.body, fontSize: 11.5 }}>
                        <input type="checkbox" checked={newGradeScope.includes(String(s.spokeId))} onChange={() => setNewGradeScope(toggleId(newGradeScope, String(s.spokeId)))} /> {s.spokeName}
                      </label>
                    ))}
                  </div>
                </Field>
                <div style={{ display: "flex", gap: 8 }}>
                  <PrimaryButton onClick={commitNewGrade}>Save new grade</PrimaryButton>
                  <GhostButton onClick={() => { setAddingGrade(false); setNewGradeScope([]); }}>Cancel</GhostButton>
                </div>
              </div>
            ) : (
              <GhostButton onClick={() => setAddingGrade(true)}>+ Add a new grade</GhostButton>
            )}
          </div>
        )}

        {pendingDeleteGrade && (
          <ConfirmDialog
            title="Delete grade"
            body={`This removes the grade definition AND its full rate history — every universal and per-spoke override rate row (past and future) for ${pendingDeleteGrade}. This can't be undone.`}
            confirmLabel="Delete grade"
            onConfirm={() => commitRemoveGrade(pendingDeleteGrade)}
            onCancel={() => setPendingDeleteGrade(null)}
          />
        )}
      </div>

      {/* --- rate card for the selected grade ---------------------------------- */}
      <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${t.ruleSoft}` }}>
        <Field id="gr-grade" label="Grade" width={240}>
          <select id="gr-grade" style={inputStyle(t)} value={grade} onChange={(e) => setGrade(e.target.value)}>
            {gradeSelectOptions.length === 0 && <option value="">No grades yet</option>}
            {gradeSelectOptions.map(([g, name]) => <option key={g} value={g}>{name} ({g})</option>)}
          </select>
        </Field>

        {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

        {grade && (
          <div style={{ marginTop: 12 }}>
            <RateTable rows={universalRows} today={today} editable={isAdmin} onEdit={(r) => { setEditingKey(r.effectiveFrom); setEditRate(String(r.hourlyCostGBP)); setErr(null); }} onDelete={remove} editingKey={editingKey} editRate={editRate} setEditRate={setEditRate} onSave={commitEdit} onCancel={() => setEditingKey(null)} latestKey={latest?.effectiveFrom} />
          </div>
        )}

        {isAdmin && grade && (
          adding ? (
            <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field id="gr-add-date" label="Effective from" width={150}><input id="gr-add-date" type="date" style={inputStyle(t)} value={addDraft.effectiveFrom} onChange={(e) => setAddDraft({ ...addDraft, effectiveFrom: e.target.value })} /></Field>
              <Field id="gr-add-rate" label="Hourly cost (£)" width={130}><input id="gr-add-rate" type="number" min={0} step={0.5} style={inputStyle(t)} value={addDraft.hourlyCostGBP} onChange={(e) => setAddDraft({ ...addDraft, hourlyCostGBP: e.target.value })} /></Field>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, paddingBottom: 8 }}>
                <input type="checkbox" checked={addBackdated} onChange={(e) => setAddBackdated(e.target.checked)} />
                This is a backdated correction (admin only)
              </label>
              <PrimaryButton onClick={commitAdd}>Add record</PrimaryButton>
              <GhostButton onClick={resetAddForm}>Cancel</GhostButton>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}><GhostButton onClick={() => setAdding(true)}>+ Add record from date…</GhostButton></div>
          )
        )}

        {addPending && (
          <ConfirmDialog
            title="Confirm backdated rate change"
            body="This re-values already-reported cost history."
            confirmLabel="Confirm backdated change"
            onConfirm={() => { commitAddRow(addPending.effectiveFrom, addPending.hourlyCostGBP); setAddPending(null); }}
            onCancel={() => setAddPending(null)}
          />
        )}

        {/* --- per-spoke overrides ------------------------------------------- */}
        {grade && (
          <div style={{ marginTop: 22 }}>
            <h4 style={{ margin: "0 0 4px", fontFamily: fonts.display, fontSize: 13, fontWeight: 700, color: t.ink }}>Spoke overrides</h4>
            {visibleOverrideSpokeIds.size === 0 && <p style={{ margin: "0 0 8px", fontFamily: fonts.body, fontSize: 11.5, color: t.inkSoft }}>No spoke-specific overrides for this grade — every in-scope spoke pays the universal rate above.</p>}
            {[...visibleOverrideSpokeIds].map((sid) => {
              const spoke = reference.spokes.find((s) => String(s.spokeId) === sid);
              const spokeName = spoke?.spokeName ?? sid;
              const spokeEditable = can("edit_spoke_reference", spokeName);
              return (
                <SpokeOverrideBlock
                  key={sid}
                  grade={grade}
                  gradeName={gradeDefs.find((g) => g.grade === grade)?.gradeName ?? grade}
                  spokeId={sid}
                  spokeName={spokeName}
                  rows={overrideRowsBySpoke.get(sid) ?? []}
                  editable={spokeEditable}
                  isAdmin={isAdmin}
                  today={today}
                  save={save}
                  setErr={setErr}
                />
              );
            })}

            {addOverrideCandidates.length > 0 && (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 14 }}>
                <Field id="gr-add-override-spoke" label="Add a spoke override for" width={220}>
                  <select id="gr-add-override-spoke" style={inputStyle(t)} value={overridePick} onChange={(e) => setOverridePick(e.target.value)}>
                    <option value="">Choose a spoke…</option>
                    {addOverrideCandidates.map((s) => <option key={s.spokeId} value={String(s.spokeId)}>{s.spokeName}</option>)}
                  </select>
                </Field>
                <GhostButton onClick={() => { if (overridePick) { setExtraSpokeBlocks(new Set([...extraSpokeBlocks, overridePick])); setOverridePick(""); } }} disabled={!overridePick}>+ Start override</GhostButton>
              </div>
            )}
          </div>
        )}
      </div>

      <Announcer />
    </div>
  );
}

// --- one spoke's override rate history for the selected grade -----------------
function SpokeOverrideBlock({
  grade, gradeName, spokeId, spokeName, rows, editable, isAdmin, today, save, setErr,
}: {
  grade: string;
  gradeName: string;
  spokeId: string;
  spokeName: string;
  rows: GradeRateRef[];
  editable: boolean;
  isAdmin: boolean;
  today: string;
  save: SaveFn;
  setErr: (e: string | null) => void;
}) {
  const t = useTheme();
  const sorted = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const latest = mostRecent(sorted);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ effectiveFrom: "", hourlyCostGBP: "" });
  const [backdated, setBackdated] = useState(false);
  const [pending, setPending] = useState<{ effectiveFrom: string; hourlyCostGBP: number } | null>(null);

  const commitEdit = (effectiveFrom: string) => {
    const rate = Number(editRate);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    save("gradeRates", (d) => { d.gradeRates = d.gradeRates.map((g) => (g.grade === grade && g.spokeId === spokeId && g.effectiveFrom === effectiveFrom ? { ...g, hourlyCostGBP: rate } : g)); });
    setEditingKey(null);
    setErr(null);
  };

  const remove = (effectiveFrom: string) => {
    save("gradeRates", (d) => { d.gradeRates = d.gradeRates.filter((g) => !(g.grade === grade && g.spokeId === spokeId && g.effectiveFrom === effectiveFrom)); });
  };

  const resetAddForm = () => {
    setAdding(false);
    setAddDraft({ effectiveFrom: "", hourlyCostGBP: "" });
    setBackdated(false);
    setErr(null);
  };

  const commitAddRow = (effectiveFrom: string, rate: number) => {
    save("gradeRates", (d) => { d.gradeRates = [...d.gradeRates, { grade, gradeName, effectiveFrom, hourlyCostGBP: rate, spokeId }]; }, "Saved — dashboards updated.");
    resetAddForm();
  };

  const commitAdd = () => {
    if (!isValidISODate(addDraft.effectiveFrom)) return setErr("Pick a valid effective-from date.");
    if (sorted.some((r) => r.effectiveFrom === addDraft.effectiveFrom)) return setErr(`${spokeName} already has an override rate effective from that date.`);
    const rate = Number(addDraft.hourlyCostGBP);
    if (!isFinite(rate) || rate <= 0) return setErr("Hourly cost must be a positive number.");
    if (addDraft.effectiveFrom < today) {
      if (!isAdmin || !backdated) return setErr(`New records can't be backdated — ${LOCK_REASON}`);
      setPending({ effectiveFrom: addDraft.effectiveFrom, hourlyCostGBP: rate });
      return;
    }
    commitAddRow(addDraft.effectiveFrom, rate);
  };

  return (
    <div style={{ marginTop: 14, paddingLeft: 12, borderLeft: `2px solid ${t.ruleSoft}` }}>
      <h5 style={{ margin: "0 0 6px", fontFamily: fonts.display, fontSize: 12, fontWeight: 700, color: t.ink }}>{spokeName}{!editable && <LockBadge reason="Only an admin or this spoke's hub lead can edit its override rates." />}</h5>
      <RateTable rows={sorted} today={today} editable={editable} onEdit={(r) => { setEditingKey(r.effectiveFrom); setEditRate(String(r.hourlyCostGBP)); setErr(null); }} onDelete={remove} editingKey={editingKey} editRate={editRate} setEditRate={setEditRate} onSave={commitEdit} onCancel={() => setEditingKey(null)} latestKey={latest?.effectiveFrom} />
      {editable && (
        adding ? (
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field id={`gr-ov-${spokeId}-date`} label="Effective from" width={150}><input id={`gr-ov-${spokeId}-date`} type="date" style={inputStyle(t)} value={addDraft.effectiveFrom} onChange={(e) => setAddDraft({ ...addDraft, effectiveFrom: e.target.value })} /></Field>
            <Field id={`gr-ov-${spokeId}-rate`} label="Hourly cost (£)" width={130}><input id={`gr-ov-${spokeId}-rate`} type="number" min={0} step={0.5} style={inputStyle(t)} value={addDraft.hourlyCostGBP} onChange={(e) => setAddDraft({ ...addDraft, hourlyCostGBP: e.target.value })} /></Field>
            {isAdmin && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, paddingBottom: 8 }}>
                <input type="checkbox" checked={backdated} onChange={(e) => setBackdated(e.target.checked)} />
                This is a backdated correction (admin only)
              </label>
            )}
            <PrimaryButton onClick={commitAdd}>Add record</PrimaryButton>
            <GhostButton onClick={resetAddForm}>Cancel</GhostButton>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}><GhostButton onClick={() => setAdding(true)}>+ Add override record from date…</GhostButton></div>
        )
      )}
      {pending && (
        <ConfirmDialog
          title="Confirm backdated rate change"
          body="This re-values already-reported cost history."
          confirmLabel="Confirm backdated change"
          onConfirm={() => { commitAddRow(pending.effectiveFrom, pending.hourlyCostGBP); setPending(null); }}
          onCancel={() => setPending(null)}
        />
      )}
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
