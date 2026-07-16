import { useEffect, useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { TargetsRef, ThresholdOverrideRef } from "../../reference/reference-store";
import { spokeOfProcess, resolveThreshold } from "../../reference/reference-store";
import { MIN_ALERT_VOLUME } from "../../alerts/engine";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow,
  inputStyle, useSectionSave,
} from "./shared";
import type { SectionProps } from "./shared";

// ---------------------------------------------------------------------------
// admin/ThresholdsSection.tsx
// ---------------------------------------------------------------------------
// "Targets & thresholds" — the six global TargetsRef values (used by the
// alert engine, src/alerts/engine.ts) plus per-spoke/per-process overrides of
// them (ThresholdOverrideRef[]). Deliberately NOT the same thing as the
// baked target reference lines already drawn on Overview/Capacity/Commercial/
// Input & Outcome — those come from the data build and are read-only here;
// see the SectionTitle helper below for the exact wording shown to users.
// ---------------------------------------------------------------------------

type TargetUnit = "pct" | "gbp";

interface TargetField {
  key: keyof TargetsRef;
  label: string;
  unit: TargetUnit;
  hint: string;
}

const TARGET_FIELDS: TargetField[] = [
  { key: "completionPct", label: "Completion rate", unit: "pct", hint: "Target is a floor (≥)." },
  { key: "exceptionRate", label: "Exception rate", unit: "pct", hint: "Target is a ceiling (≤)." },
  { key: "systemRate", label: "System exception rate", unit: "pct", hint: "Target is a ceiling (≤)." },
  { key: "costPerCase", label: "Cost per case", unit: "gbp", hint: "Target is a ceiling (≤)." },
  { key: "utilMin", label: "Utilisation — minimum", unit: "pct", hint: "Floor — utilisation should not fall below this." },
  { key: "utilMax", label: "Utilisation — maximum", unit: "pct", hint: "Ceiling — utilisation should not rise above this." },
];

const fieldFor = (key: keyof TargetsRef) => TARGET_FIELDS.find((f) => f.key === key)!;

function fmtValue(unit: TargetUnit, value: number): string {
  return unit === "pct" ? `${(value * 100).toFixed(1)}%` : `£${value.toFixed(2)}`;
}

type Draft = Record<keyof TargetsRef, string>;

function targetsToDraft(targets: TargetsRef): Draft {
  const d = {} as Draft;
  for (const f of TARGET_FIELDS) {
    d[f.key] = f.unit === "pct" ? (targets[f.key] * 100).toFixed(1) : String(targets[f.key]);
  }
  return d;
}

export function ThresholdsSection({ reference, update, actor, can, isAdmin }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);

  // --- 2a. global targets --------------------------------------------------
  const [draft, setDraft] = useState<Draft>(() => targetsToDraft(reference.targets));
  const [globalErr, setGlobalErr] = useState<string | null>(null);

  // Resync the draft whenever the underlying targets object actually changes
  // (a successful save here, a reset-to-base, or an edit made elsewhere) —
  // never while the user is still mid-keystroke, since reference.targets
  // itself only changes on a committed update().
  useEffect(() => {
    setDraft(targetsToDraft(reference.targets));
  }, [reference.targets]);

  const commitGlobalSave = () => {
    const next = {} as TargetsRef;
    for (const f of TARGET_FIELDS) {
      const raw = Number(draft[f.key]);
      if (!isFinite(raw)) return setGlobalErr(`${f.label} must be a number.`);
      if (f.unit === "pct") {
        if (raw < 0 || raw > 100) return setGlobalErr(`${f.label} must be between 0 and 100.`);
        next[f.key] = raw / 100;
      } else {
        if (raw <= 0) return setGlobalErr(`${f.label} must be greater than 0.`);
        next[f.key] = raw;
      }
    }
    if (next.utilMin >= next.utilMax) return setGlobalErr("Utilisation minimum must be less than utilisation maximum.");
    save("targets", (d) => { d.targets = { ...d.targets, ...next }; });
    setGlobalErr(null);
  };

  // --- 2b. per-spoke / per-process overrides --------------------------------
  const overrides = reference.thresholdOverrides ?? [];

  const editableSpokes = useMemo(() => reference.spokes.filter((s) => can("edit_spoke_reference", s.spokeName)), [reference.spokes, can]);
  // Grouped by "Spoke — Proposition" (user requirement: propositions must be
  // mapped to processes in the picker, so an override can't be attached
  // ambiguously — a process name alone "could relate to anything").
  const editableProcessGroups = useMemo(() => {
    const groups = new Map<string, { processId: number; processName: string }[]>();
    for (const p of reference.processes) {
      const spoke = spokeOfProcess(reference, String(p.processId));
      if (!spoke || !can("edit_spoke_reference", spoke)) continue;
      const proposition = reference.propositions.find((pr) => pr.propositionId === p.propositionId)?.propositionName ?? "Unassigned";
      const key = `${spoke} — ${proposition}`;
      const list = groups.get(key) ?? [];
      list.push({ processId: p.processId, processName: p.processName });
      groups.set(key, list);
    }
    return groups;
  }, [reference, can]);

  // Can this user add an override for at least one spoke/process at all?
  const canAddAnyOverride = can("edit_spoke_reference");

  const canEditOverride = (o: ThresholdOverrideRef): boolean => {
    if (o.scope === "spoke") return can("edit_spoke_reference", o.scopeId);
    const spoke = spokeOfProcess(reference, o.scopeId);
    return can("edit_spoke_reference", spoke ?? "");
  };

  const targetLabelFor = (o: ThresholdOverrideRef): string =>
    o.scope === "spoke" ? o.scopeId : reference.processes.find((p) => String(p.processId) === o.scopeId)?.processName ?? o.scopeId;

  const removeOverride = (o: ThresholdOverrideRef) => {
    save("thresholdOverrides", (d) => {
      d.thresholdOverrides = (d.thresholdOverrides ?? []).filter((x) => !(x.scope === o.scope && x.scopeId === o.scopeId && x.metric === o.metric));
    });
  };

  const [addingOverride, setAddingOverride] = useState(false);
  const [scopeType, setScopeType] = useState<"spoke" | "process">("spoke");
  const [scopeTarget, setScopeTarget] = useState("");
  const [metric, setMetric] = useState<keyof TargetsRef>("completionPct");
  const [valueStr, setValueStr] = useState("");
  const [overrideErr, setOverrideErr] = useState<string | null>(null);

  const openAddOverride = () => {
    const firstSpoke = editableSpokes[0]?.spokeName ?? "";
    setScopeType("spoke");
    setScopeTarget(firstSpoke);
    setMetric("completionPct");
    setValueStr("");
    setOverrideErr(null);
    setAddingOverride(true);
  };

  const onScopeTypeChange = (next: "spoke" | "process") => {
    setScopeType(next);
    if (next === "spoke") {
      setScopeTarget(editableSpokes[0]?.spokeName ?? "");
    } else {
      const firstGroup = [...editableProcessGroups.values()][0];
      setScopeTarget(firstGroup?.[0] ? String(firstGroup[0].processId) : "");
      // utilMin/utilMax are never selectable at process scope (see metricOptions
      // below) — if the metric field still holds one of them from a prior
      // spoke-scoped selection, fall back to a metric that's actually valid
      // for "process" rather than leaving stale state the select can't display.
      if (metric === "utilMin" || metric === "utilMax") setMetric("completionPct");
    }
    setOverrideErr(null);
  };

  // VDIs are spoke-owned, not process-owned (see engine.ts's vdi-scope block,
  // which only ever resolves utilMin/utilMax via scope="spoke") — a
  // process-scoped utilMin/utilMax override would save successfully but never
  // be read by the alert engine. Restrict the metric choices offered per scope
  // type so that trap can't be created from the add-override form.
  const metricOptions = scopeType === "process" ? TARGET_FIELDS.filter((f) => f.key !== "utilMin" && f.key !== "utilMax") : TARGET_FIELDS;

  const commitAddOverride = () => {
    if (!scopeTarget) return setOverrideErr("Choose a target.");
    const field = fieldFor(metric);
    const raw = Number(valueStr);
    if (!isFinite(raw)) return setOverrideErr("Enter a numeric value.");
    let fraction: number;
    if (field.unit === "pct") {
      if (raw < 0 || raw > 100) return setOverrideErr(`${field.label} must be between 0 and 100.`);
      fraction = raw / 100;
    } else {
      if (raw <= 0) return setOverrideErr(`${field.label} must be greater than 0.`);
      fraction = raw;
    }
    if (metric === "utilMin") {
      const effectiveMax = resolveThreshold(reference, "utilMax", scopeType, scopeTarget);
      if (!(fraction < effectiveMax)) return setOverrideErr(`Utilisation minimum must be less than the current effective utilisation maximum (${fmtValue("pct", effectiveMax)}) for this scope.`);
      // Cross-check process-level utilMax overrides beneath this spoke. The
      // metric <select> above no longer offers utilMin/utilMax when adding a
      // NEW process-scoped override, so this can't be created going forward —
      // but a process-scoped utilMax override could still exist from before
      // that restriction: reference.thresholdOverrides is an additive field
      // that does NOT bump SCHEMA_VERSION (see reference-store.ts), so a
      // localStorage overlay saved before this fix — or a directly-edited
      // JSON import — can still carry one. It would never be evaluated by the
      // alert engine (engine.ts only resolves utilMin/utilMax via
      // scope="spoke"), but it would be silently invisible to THIS validation
      // if we didn't check it, letting a spoke-level utilMin be saved that
      // reads as inverted against that dormant row in the table above.
      if (scopeType === "spoke") {
        const conflict = overrides.find(
          (o) => o.scope === "process" && o.metric === "utilMax" && spokeOfProcess(reference, o.scopeId) === scopeTarget && !(fraction < o.value),
        );
        if (conflict) {
          const procName = reference.processes.find((p) => String(p.processId) === conflict.scopeId)?.processName ?? conflict.scopeId;
          return setOverrideErr(`Utilisation minimum must be less than the (inert but still stored) process-level utilisation maximum override on "${procName}" (${fmtValue("pct", conflict.value)}) beneath this spoke.`);
        }
      }
    }
    if (metric === "utilMax") {
      const effectiveMin = resolveThreshold(reference, "utilMin", scopeType, scopeTarget);
      if (!(fraction > effectiveMin)) return setOverrideErr(`Utilisation maximum must be greater than the current effective utilisation minimum (${fmtValue("pct", effectiveMin)}) for this scope.`);
      // See the matching comment in the utilMin branch above.
      if (scopeType === "spoke") {
        const conflict = overrides.find(
          (o) => o.scope === "process" && o.metric === "utilMin" && spokeOfProcess(reference, o.scopeId) === scopeTarget && !(fraction > o.value),
        );
        if (conflict) {
          const procName = reference.processes.find((p) => String(p.processId) === conflict.scopeId)?.processName ?? conflict.scopeId;
          return setOverrideErr(`Utilisation maximum must be greater than the (inert but still stored) process-level utilisation minimum override on "${procName}" (${fmtValue("pct", conflict.value)}) beneath this spoke.`);
        }
      }
    }
    const exists = overrides.some((o) => o.scope === scopeType && o.scopeId === scopeTarget && o.metric === metric);
    if (exists) return setOverrideErr("An override for this scope and metric already exists — delete it first, then add a new one.");
    save("thresholdOverrides", (d) => {
      d.thresholdOverrides = [...(d.thresholdOverrides ?? []), { scope: scopeType, scopeId: scopeTarget, metric, value: fraction }];
    });
    setAddingOverride(false);
    setValueStr("");
    setOverrideErr(null);
  };

  return (
    <div>
      <SectionTitle
        title="Targets & thresholds"
        helper={`These global targets and per-spoke/per-process overrides drive the threshold alerts shown in the bell icon in the header — they do NOT change the target reference lines already shown on Overview/Capacity/Commercial/Input & Outcome, which come from the data build's own baked targets and are unaffected by edits made here. Resolution order for a given metric: a process-level override wins, else its spoke's override, else the global target below. Per-process alerts are skipped entirely for any process with fewer than ${MIN_ALERT_VOLUME} completed+exception items in the trailing 7-day window, to avoid noise from very low-volume processes. Utilisation minimum/maximum can only be overridden at spoke (or estate) level, never per process — VDIs are spoke-owned rather than tied to any single process, so a process-level utilisation override wouldn't have anything to attach to.`}
      />

      {/* --- 2a. global targets --- */}
      {isAdmin ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 6 }}>
          {TARGET_FIELDS.map((f) => (
            <Field key={f.key} id={`tg-${f.key}`} label={`${f.label}${f.unit === "pct" ? " (%)" : " (£)"}`} width={170} hint={f.hint}>
              <input
                id={`tg-${f.key}`}
                type="number"
                min={f.unit === "pct" ? 0 : 0.01}
                max={f.unit === "pct" ? 100 : undefined}
                step={f.unit === "pct" ? 0.1 : 0.01}
                style={inputStyle(t)}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </Field>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 6 }}>
          {TARGET_FIELDS.map((f) => (
            <Field key={f.key} id={`tg-ro-${f.key}`} label={`${f.label}${f.unit === "pct" ? " (%)" : " (£)"}`} width={170} hint={f.hint}>
              <div style={{ fontFamily: fonts.body, fontSize: 13, color: t.ink, padding: "7px 0" }}>{fmtValue(f.unit, reference.targets[f.key])}</div>
            </Field>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          {globalErr && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "6px 0 10px" }}>{globalErr}</p>}
          <div style={{ marginBottom: 18 }}>
            <PrimaryButton onClick={commitGlobalSave}>Save targets</PrimaryButton>
          </div>
        </>
      )}
      {!isAdmin && <div style={{ marginBottom: 18 }} />}

      {/* --- 2b. overrides --- */}
      <h3 style={{ margin: "6px 0 8px", fontFamily: fonts.display, fontSize: 14.5, fontWeight: 700, color: t.ink }}>Spoke &amp; process overrides</h3>

      <Table>
        <thead>
          <tr>
            <Th>Scope</Th>
            <Th>Target</Th>
            <Th>Metric</Th>
            <Th align="right">Value</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {overrides.length === 0 && <EmptyRow colSpan={5}>No overrides yet — every spoke and process uses the global targets above.</EmptyRow>}
          {overrides.map((o, i) => {
            const field = fieldFor(o.metric);
            // Defensive: engine.ts only ever resolves utilMin/utilMax via
            // scope="spoke" (see the vdi-scope block), so a process-scoped row
            // here — e.g. a stale row saved before the scope-aware metric
            // filter above existed, or a directly-edited JSON import — would
            // never actually be evaluated. Flag it inline rather than listing
            // it as if it were live.
            const isInertProcessUtil = o.scope === "process" && (o.metric === "utilMin" || o.metric === "utilMax");
            return (
              <tr key={`${o.scope}|${o.scopeId}|${o.metric}|${i}`}>
                <Td>{o.scope === "spoke" ? "Spoke" : "Process"}</Td>
                <Td>{targetLabelFor(o)}</Td>
                <Td>
                  {field.label}
                  {isInertProcessUtil && (
                    <div style={{ fontFamily: fonts.body, fontSize: 10.5, fontStyle: "italic", color: t.inkSoft, marginTop: 2 }}>
                      (not evaluated — utilisation overrides only apply per spoke)
                    </div>
                  )}
                </Td>
                <Td align="right">{fmtValue(field.unit, o.value)}</Td>
                <Td align="right">
                  {canEditOverride(o) && <DangerButton onClick={() => removeOverride(o)}>Delete</DangerButton>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {canAddAnyOverride && (
        addingOverride ? (
          <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field id="to-scope-type" label="Scope" width={120}>
              <select id="to-scope-type" style={inputStyle(t)} value={scopeType} onChange={(e) => onScopeTypeChange(e.target.value as "spoke" | "process")}>
                <option value="spoke">Spoke</option>
                <option value="process">Process</option>
              </select>
            </Field>
            <Field id="to-scope-target" label={scopeType === "spoke" ? "Spoke" : "Process"} width={240}>
              <select id="to-scope-target" style={inputStyle(t)} value={scopeTarget} onChange={(e) => setScopeTarget(e.target.value)}>
                {scopeType === "spoke"
                  ? editableSpokes.map((s) => <option key={s.spokeId} value={s.spokeName}>{s.spokeName}</option>)
                  : [...editableProcessGroups.entries()].map(([groupLabel, procs]) => (
                      <optgroup key={groupLabel} label={groupLabel}>
                        {procs.map((p) => <option key={p.processId} value={String(p.processId)}>{p.processName}</option>)}
                      </optgroup>
                    ))}
              </select>
            </Field>
            <Field id="to-metric" label="Metric" width={200}>
              <select id="to-metric" style={inputStyle(t)} value={metric} onChange={(e) => setMetric(e.target.value as keyof TargetsRef)}>
                {metricOptions.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </Field>
            <Field id="to-value" label={fieldFor(metric).unit === "pct" ? "Value (%)" : "Value (£)"} width={120}>
              <input
                id="to-value"
                type="number"
                min={fieldFor(metric).unit === "pct" ? 0 : 0.01}
                max={fieldFor(metric).unit === "pct" ? 100 : undefined}
                step={fieldFor(metric).unit === "pct" ? 0.1 : 0.01}
                style={inputStyle(t)}
                value={valueStr}
                onChange={(e) => setValueStr(e.target.value)}
              />
            </Field>
            <PrimaryButton onClick={commitAddOverride}>Add</PrimaryButton>
            <GhostButton onClick={() => { setAddingOverride(false); setOverrideErr(null); }}>Cancel</GhostButton>
            {overrideErr && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, width: "100%", margin: "4px 0 0" }}>{overrideErr}</p>}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}><GhostButton onClick={openAddOverride}>+ Add override…</GhostButton></div>
        )
      )}

      <Announcer />
    </div>
  );
}
