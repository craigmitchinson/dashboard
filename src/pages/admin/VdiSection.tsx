import { useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { ResourceRef, VdiCostHistoryRef } from "../../reference/reference-store";
import { resolveThreshold } from "../../reference/reference-store";
import { RESOURCE_ACTIVITY, DATE_MAX, fmtDate } from "../../rpaData";
import { DEFAULT_VDI_STALE_DAYS } from "../../alerts/engine";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, HelperText, Table, Td, Th, EmptyRow, InfoBanner,
  LockBadge, LOCK_REASON, ConfirmDialog,
  inputStyle, useSectionSave, historyRowRights, mostRecent, currentCoverageWindow, todayISO, isValidISODate,
} from "./shared";
import type { SectionProps } from "./shared";

type AddDraft = {
  resourceName: string; botName: string; botAcronym: string; vdiName: string; costClass: string;
  owner: string; // "HUB" or spokeId as string
  activeFrom: string; renewalDate: string; annualCostGBP: string; licenseExpiryDate: string; notes: string;
};

type RegisterDraft = {
  resourceName: string; vdiName: string; costClass: string; owner: string; // "" = not yet chosen (forced when multiple spokes served)
  activeFrom: string; renewalDate: string; annualCostGBP: string; licenseExpiryDate: string; notes: string;
};

type ActivityInfo = { firstSeen: string; lastSeen: string; items: number; spokesServed: string[] };
type DiscoveredRow = { resourceName: string; activity: ActivityInfo };

const DAY_MS = 86400000;
const parseISODate = (d: string) => Date.parse(d + "T00:00:00Z");

export function VdiSection({ reference, update, actor, can }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const owners = useMemo(() => ["HUB", ...reference.spokes.map((s) => String(s.spokeId))], [reference.spokes]);
  const [ownerId, setOwnerId] = useState(owners[0] ?? "HUB");
  const [err, setErr] = useState<string | null>(null);
  const today = todayISO();

  const ownerSpokeName = ownerId === "HUB" ? null : reference.spokes.find((s) => String(s.spokeId) === ownerId)?.spokeName ?? null;
  const editable = ownerId === "HUB" ? can("edit_global_reference") : ownerSpokeName != null && can("edit_spoke_reference", ownerSpokeName);
  const isGlobalAdmin = can("edit_global_reference");

  const rows = reference.resources.filter((r) => (ownerId === "HUB" ? r.spokeId == null : String(r.spokeId) === ownerId));
  const costClasses = useMemo(() => Array.from(new Set(reference.vdiCostHistory.map((v) => v.costClass))), [reference.vdiCostHistory]);

  // --- discovered-but-unregistered VDIs (D6 activity discovery, joined by
  // ResourceName === RESOURCE_ACTIVITY map key === VdiDim.id) scoped to the
  // currently selected owner tab: a single-spoke discovery lands on that
  // spoke's tab, everything else (no spoke recorded, or served >1 spoke —
  // ambiguous) lands on the HUB tab where it must be assigned explicitly. ---
  const registeredNames = useMemo(() => new Set(reference.resources.map((r) => r.resourceName)), [reference.resources]);
  const discoveredForOwner: DiscoveredRow[] = useMemo(() => {
    if (!RESOURCE_ACTIVITY) return [];
    const out: DiscoveredRow[] = [];
    for (const [name, activity] of RESOURCE_ACTIVITY.entries()) {
      if (registeredNames.has(name)) continue;
      const singleSpoke = activity.spokesServed.length === 1
        ? reference.spokes.find((s) => s.spokeName === activity.spokesServed[0])
        : undefined;
      const belongsHere = ownerId === "HUB"
        ? activity.spokesServed.length !== 1
        : singleSpoke != null && String(singleSpoke.spokeId) === ownerId;
      if (belongsHere) out.push({ resourceName: name, activity });
    }
    return out.sort((a, b) => a.resourceName.localeCompare(b.resourceName));
  }, [registeredNames, reference.spokes, ownerId]);

  // Resolved per this owner's spoke (see resolveThreshold in
  // reference-store.ts) so a spoke-level vdiStaleDays override actually
  // changes both which VDIs land in the review queue below AND the
  // threshold text shown in its header. HUB has no spoke to override
  // against, so it reads the flat global directly (matching
  // resolveThreshold's own no-match fallback behaviour).
  const effectiveVdiStaleDays = useMemo(
    () => (ownerSpokeName != null
      ? resolveThreshold(reference, "vdiStaleDays", "spoke", ownerSpokeName)
      : reference.targets.vdiStaleDays) ?? DEFAULT_VDI_STALE_DAYS,
    [reference, ownerSpokeName],
  );

  // --- review queue: registered, non-retired VDIs in this owner's scope whose
  // last recorded activity is older than effectiveVdiStaleDays, anchored on
  // the dataset's DATE_MAX (not real "today") so it stays consistent with the
  // staleVdi alert in src/alerts/engine.ts. `rows` above is already filtered
  // to this single owner (HUB or one spoke), so the same resolved threshold
  // applies to every row in this queue. ---
  const reviewQueue = useMemo(() => {
    if (!RESOURCE_ACTIVITY) return [];
    const out: { resourceName: string; idleDays: number; lastSeen: string }[] = [];
    for (const r of rows) {
      if (r.status === "retired") continue;
      const activity = RESOURCE_ACTIVITY.get(r.resourceName);
      if (!activity) continue;
      const idleDays = Math.floor((DATE_MAX - parseISODate(activity.lastSeen)) / DAY_MS);
      if (idleDays > effectiveVdiStaleDays) out.push({ resourceName: r.resourceName, idleDays, lastSeen: activity.lastSeen });
    }
    return out.sort((a, b) => b.idleDays - a.idleDays);
  }, [rows, effectiveVdiStaleDays]);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ costClass: string; annualCostGBP: string; licenseExpiryDate: string; notes: string }>({ costClass: "", annualCostGBP: "", licenseExpiryDate: "", notes: "" });
  const [renewingName, setRenewingName] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState(today);
  const [retiringName, setRetiringName] = useState<string | null>(null);
  const [retireDate, setRetireDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({ resourceName: "", botName: "", botAcronym: "", vdiName: "", costClass: costClasses[0] ?? "prod", owner: ownerId, activeFrom: today, renewalDate: today, annualCostGBP: "", licenseExpiryDate: "", notes: "" });
  const [registeringName, setRegisteringName] = useState<string | null>(null);
  const [registerDraft, setRegisterDraft] = useState<RegisterDraft>({ resourceName: "", vdiName: "", costClass: costClasses[0] ?? "", owner: "HUB", activeFrom: today, renewalDate: "", annualCostGBP: "", licenseExpiryDate: "", notes: "" });
  const [rateClass, setRateClass] = useState(costClasses[0] ?? "");

  const startEdit = (r: ResourceRef) => {
    setEditingName(r.resourceName);
    setEditDraft({ costClass: r.costClass, annualCostGBP: r.annualCostGBP != null ? String(r.annualCostGBP) : "", licenseExpiryDate: r.licenseExpiryDate ?? "", notes: r.notes ?? "" });
    setErr(null);
  };

  const commitEdit = (resourceName: string) => {
    const override = editDraft.annualCostGBP.trim() === "" ? null : Number(editDraft.annualCostGBP);
    if (override != null && (!isFinite(override) || override < 0)) return setErr("Annual cost override must be a non-negative number, or left blank.");
    if (editDraft.licenseExpiryDate && !isValidISODate(editDraft.licenseExpiryDate)) return setErr("License expiry must be a valid date.");
    save("resources", (d) => {
      d.resources = d.resources.map((r) => (r.resourceName === resourceName ? { ...r, costClass: editDraft.costClass, annualCostGBP: override, licenseExpiryDate: editDraft.licenseExpiryDate || null, notes: editDraft.notes.trim() || null } : r));
    });
    setEditingName(null);
    setErr(null);
  };

  const commitRenew = (resourceName: string) => {
    if (!isValidISODate(renewDate)) return setErr("Pick a valid renewal date.");
    save("resources", (d) => { d.resources = d.resources.map((r) => (r.resourceName === resourceName ? { ...r, renewalDate: renewDate } : r)); }, "Saved — renewal booked, dashboards updated.");
    setRenewingName(null);
    setErr(null);
  };

  // Shared retire mutation — used by BOTH the per-row Retire confirm (below,
  // where the admin picks a date) and the review queue's one-click Retire
  // (which always defaults to today via todayISO()). Keeping this as a single
  // function guarantees identical retire semantics from either entry point.
  const doRetire = (resourceName: string, date: string) => {
    if (!isValidISODate(date)) return setErr("Pick a valid retirement date.");
    save("resources", (d) => { d.resources = d.resources.map((r) => (r.resourceName === resourceName ? { ...r, status: "retired", activeTo: date, isActive: false } : r)); }, "Saved — VDI retired, dashboards updated.");
    setErr(null);
  };

  const commitRetire = (resourceName: string) => {
    doRetire(resourceName, retireDate);
    setRetiringName(null);
  };

  const commitAdd = () => {
    if (!addDraft.resourceName.trim()) return setErr("Resource name is required.");
    if (reference.resources.some((r) => r.resourceName === addDraft.resourceName.trim())) return setErr("A VDI with that resource name already exists.");
    if (!isValidISODate(addDraft.activeFrom)) return setErr("Active-from must be a valid date.");
    if (!isValidISODate(addDraft.renewalDate)) return setErr("Renewal date must be a valid date.");
    if (addDraft.licenseExpiryDate && !isValidISODate(addDraft.licenseExpiryDate)) return setErr("License expiry must be a valid date, or left blank.");
    const override = addDraft.annualCostGBP.trim() === "" ? null : Number(addDraft.annualCostGBP);
    if (override != null && (!isFinite(override) || override < 0)) return setErr("Annual cost override must be a non-negative number, or left blank.");
    const spokeId = addDraft.owner === "HUB" ? null : Number(addDraft.owner);
    const row: ResourceRef = {
      resourceName: addDraft.resourceName.trim(), botName: addDraft.botName.trim() || addDraft.resourceName.trim(), botAcronym: addDraft.botAcronym.trim() || addDraft.resourceName.trim().slice(0, 4).toUpperCase(),
      vdiName: addDraft.vdiName.trim() || addDraft.resourceName.trim(), costClass: addDraft.costClass, spokeId, activeFrom: addDraft.activeFrom, activeTo: null, notes: addDraft.notes.trim() || null,
      isActive: true, renewalDate: addDraft.renewalDate, annualCostGBP: override, licenseExpiryDate: addDraft.licenseExpiryDate || null, status: "active",
    };
    save("resources", (d) => { d.resources = [...d.resources, row]; }, "Saved — new VDI is live and will feed the capacity/cost calculations for any activity recorded against it.");
    setAdding(false);
    setAddDraft({ ...addDraft, resourceName: "", botName: "", botAcronym: "", vdiName: "", annualCostGBP: "", licenseExpiryDate: "", notes: "" });
    setErr(null);
  };

  const startRegister = (d: DiscoveredRow) => {
    const single = d.activity.spokesServed.length === 1 ? reference.spokes.find((s) => s.spokeName === d.activity.spokesServed[0]) : undefined;
    const owner = single ? String(single.spokeId) : d.activity.spokesServed.length > 1 ? "" : "HUB";
    setRegisteringName(d.resourceName);
    setRegisterDraft({ resourceName: d.resourceName, vdiName: d.resourceName, costClass: costClasses[0] ?? "", owner, activeFrom: d.activity.firstSeen, renewalDate: "", annualCostGBP: "", licenseExpiryDate: "", notes: "" });
    setErr(null);
  };

  const commitRegister = () => {
    if (!registerDraft.costClass.trim()) return setErr("Cost class is required to register this VDI.");
    if (!registerDraft.owner) return setErr("Choose which spoke this VDI belongs to (or Hub) before registering — activity was seen against multiple spokes.");
    if (!isValidISODate(registerDraft.activeFrom)) return setErr("Active-from must be a valid date.");
    if (!isValidISODate(registerDraft.renewalDate)) return setErr("Renewal date is required and must be a valid date.");
    if (registerDraft.licenseExpiryDate && !isValidISODate(registerDraft.licenseExpiryDate)) return setErr("Licence expiry must be a valid date, or left blank.");
    const override = registerDraft.annualCostGBP.trim() === "" ? null : Number(registerDraft.annualCostGBP);
    if (override != null && (!isFinite(override) || override < 0)) return setErr("Annual cost override must be a non-negative number, or left blank.");
    const spokeId = registerDraft.owner === "HUB" ? null : Number(registerDraft.owner);
    const row: ResourceRef = {
      resourceName: registerDraft.resourceName, botName: registerDraft.resourceName, botAcronym: registerDraft.resourceName.slice(0, 4).toUpperCase(),
      vdiName: registerDraft.vdiName.trim() || registerDraft.resourceName, costClass: registerDraft.costClass, spokeId,
      activeFrom: registerDraft.activeFrom, activeTo: null, notes: registerDraft.notes.trim() || null,
      isActive: true, renewalDate: registerDraft.renewalDate, annualCostGBP: override, licenseExpiryDate: registerDraft.licenseExpiryDate || null, status: "active",
    };
    save("resources", (d) => { d.resources = [...d.resources, row]; }, "Saved — VDI registered and now feeds the capacity/cost calculations.");
    setRegisteringName(null);
    setErr(null);
  };

  // Applies `mutate` to just the (costClass, spokeIdScope) slice of
  // reference.vdiCostHistory and writes the merged array back — spokeIdScope
  // undefined = universal rows, a spokeId string = that spoke's override rows.
  const updateVdiCostHistoryScope = (costClass: string, spokeIdScope: string | undefined, mutate: (rows: VdiCostHistoryRef[]) => VdiCostHistoryRef[]) => {
    if (!costClass.trim()) return setErr("Pick or enter a cost class first.");
    save("vdiCostHistory", (d) => {
      const scopeRows = d.vdiCostHistory.filter((v) => v.costClass === costClass && v.spokeId === spokeIdScope);
      const otherRows = d.vdiCostHistory.filter((v) => !(v.costClass === costClass && v.spokeId === spokeIdScope));
      d.vdiCostHistory = [...otherRows, ...mutate(scopeRows)];
    });
    setErr(null);
  };

  const universalRateRows = useMemo(
    () => reference.vdiCostHistory.filter((v) => v.costClass === rateClass && v.spokeId === undefined).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
    [reference.vdiCostHistory, rateClass],
  );
  const spokeRateRows = useMemo(
    () => reference.vdiCostHistory.filter((v) => v.costClass === rateClass && v.spokeId === ownerId).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
    [reference.vdiCostHistory, rateClass, ownerId],
  );

  const colCount = editable ? 10 : 9;

  return (
    <div>
      <SectionTitle
        title="VDI estate"
        helper="Every digital-worker VDI licence: which spoke pays for it (or the hub, for shared/test machines), its annual cost, and its renewal/expiry dates. Renewing books a full year of cover from the date you choose — it is never pro-rated. An expiry date cuts coverage short even mid-cycle."
      />

      <Field id="vdi-owner" label="Owner" width={280}>
        <select id="vdi-owner" style={inputStyle(t)} value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setErr(null); setRegisteringName(null); }}>
          {owners.map((o) => {
            const name = o === "HUB" ? "Hub (shared / test)" : reference.spokes.find((s) => String(s.spokeId) === o)?.spokeName ?? o;
            return <option key={o} value={o}>{name}{o !== "HUB" && !can("edit_spoke_reference", name) ? " (read-only for you)" : ""}</option>;
          })}
        </select>
      </Field>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      {reviewQueue.length > 0 && (
        <div className="adm-panel" style={{ marginTop: 14, border: `1px solid ${t.ruleSoft}`, borderRadius: 10, padding: "10px 14px", background: t.themeBand }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, marginBottom: 8 }}>
            Review queue — idle beyond {effectiveVdiStaleDays} days
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reviewQueue.map((q) => (
              <div key={q.resourceName} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontFamily: fonts.body, fontSize: 12.5, color: t.ink }}>
                <span><strong>{q.resourceName}</strong> — idle {q.idleDays} days — last case {fmtDate(parseISODate(q.lastSeen))}</span>
                {editable && <DangerButton onClick={() => doRetire(q.resourceName, todayISO())}>Retire</DangerButton>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Table>
          <thead>
            <tr>
              <Th>Resource</Th><Th>Cost class</Th><Th>Renewal date</Th><Th align="right">Annual cost override (£)</Th><Th>Licence expiry</Th><Th>Status</Th><Th>Current coverage window</Th><Th>First case</Th><Th>Last case</Th>
              {editable && <Th align="right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && discoveredForOwner.length === 0 && <EmptyRow colSpan={colCount}>No VDIs recorded for this owner yet.</EmptyRow>}
            {rows.map((r) => {
              const editing = editingName === r.resourceName;
              const cov = currentCoverageWindow(r, today);
              const activity = RESOURCE_ACTIVITY?.get(r.resourceName);
              return (
                <tr key={r.resourceName}>
                  <Td><strong style={{ fontFamily: fonts.body }}>{r.resourceName}</strong><span style={{ display: "block", fontFamily: fonts.mono, fontSize: 10, color: t.inkSoft }}>{r.vdiName}</span></Td>
                  <Td>{editing ? (
                    <input style={inputStyle(t)} value={editDraft.costClass} onChange={(e) => setEditDraft({ ...editDraft, costClass: e.target.value })} aria-label="Cost class" list="vdi-cost-classes" />
                  ) : r.costClass}</Td>
                  <Td>{r.renewalDate}</Td>
                  <Td align="right">{editing ? (
                    <input type="number" min={0} style={inputStyle(t, { width: 110, textAlign: "right" })} value={editDraft.annualCostGBP} onChange={(e) => setEditDraft({ ...editDraft, annualCostGBP: e.target.value })} aria-label="Annual cost override" placeholder="class rate" />
                  ) : (r.annualCostGBP != null ? `£${r.annualCostGBP.toLocaleString("en-GB")}` : <span style={{ color: t.inkSoft }}>class rate</span>)}</Td>
                  <Td>{editing ? (
                    <input type="date" style={inputStyle(t, { width: 140 })} value={editDraft.licenseExpiryDate} onChange={(e) => setEditDraft({ ...editDraft, licenseExpiryDate: e.target.value })} aria-label="Licence expiry" />
                  ) : (r.licenseExpiryDate ?? "—")}</Td>
                  <Td>
                    <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: r.status === "active" ? "#2E9E5B" : t.inkSoft, textTransform: "uppercase" }}>{r.status}</span>
                    {!activity && <span style={{ display: "block", fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft, marginTop: 2 }}>No activity in data</span>}
                  </Td>
                  <Td muted>{cov.covered ? `${cov.startISO} – ${cov.endISO}` : "not covered today"}</Td>
                  <Td muted>{activity ? fmtDate(parseISODate(activity.firstSeen)) : "—"}</Td>
                  <Td muted>{activity ? fmtDate(parseISODate(activity.lastSeen)) : "—"}</Td>
                  {editable && (
                    <Td align="right">
                      {editing ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => commitEdit(r.resourceName)}>Save</GhostButton>
                          <GhostButton onClick={() => setEditingName(null)}>Cancel</GhostButton>
                        </div>
                      ) : renewingName === r.resourceName ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center" }}>
                          <input type="date" style={inputStyle(t, { width: 140 })} value={renewDate} onChange={(e) => setRenewDate(e.target.value)} aria-label="New renewal date" />
                          <GhostButton onClick={() => commitRenew(r.resourceName)}>Confirm</GhostButton>
                          <GhostButton onClick={() => setRenewingName(null)}>Cancel</GhostButton>
                        </div>
                      ) : retiringName === r.resourceName ? (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, alignItems: "center" }}>
                          <input type="date" style={inputStyle(t, { width: 140 })} value={retireDate} onChange={(e) => setRetireDate(e.target.value)} aria-label="Retirement date" />
                          <DangerButton onClick={() => commitRetire(r.resourceName)}>Confirm retire</DangerButton>
                          <GhostButton onClick={() => setRetiringName(null)}>Cancel</GhostButton>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                          <GhostButton onClick={() => startEdit(r)}>Edit</GhostButton>
                          {r.status === "active" && <GhostButton onClick={() => { setRenewingName(r.resourceName); setRenewDate(today); }}>Renew</GhostButton>}
                          {r.status === "active" && <DangerButton onClick={() => { setRetiringName(r.resourceName); setRetireDate(today); }}>Retire</DangerButton>}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
            {discoveredForOwner.map((d) => (
              <tr key={`discovered-${d.resourceName}`}>
                <Td><strong style={{ fontFamily: fonts.body }}>{d.resourceName}</strong></Td>
                <Td muted>—</Td>
                <Td muted>—</Td>
                <Td align="right"><span style={{ color: t.inkSoft }}>—</span></Td>
                <Td muted>—</Td>
                <Td>
                  <span style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.accent, textTransform: "uppercase", letterSpacing: "0.03em" }}>Unregistered — complete registration</span>
                </Td>
                <Td muted>—</Td>
                <Td muted>{fmtDate(parseISODate(d.activity.firstSeen))}</Td>
                <Td muted>{fmtDate(parseISODate(d.activity.lastSeen))}</Td>
                {editable && (
                  <Td align="right">
                    <GhostButton onClick={() => (registeringName === d.resourceName ? setRegisteringName(null) : startRegister(d))}>
                      {registeringName === d.resourceName ? "Cancel" : "Register"}
                    </GhostButton>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        <datalist id="vdi-cost-classes">{costClasses.map((c) => <option key={c} value={c} />)}</datalist>
      </div>

      {editable && registeringName && (() => {
        const d = discoveredForOwner.find((x) => x.resourceName === registeringName);
        if (!d) return null;
        return (
          <div style={{ border: `1px dashed ${t.accent}`, borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, color: t.accent, textTransform: "uppercase", letterSpacing: "0.03em" }}>
              Register {d.resourceName} — first seen {fmtDate(parseISODate(d.activity.firstSeen))}, last seen {fmtDate(parseISODate(d.activity.lastSeen))}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="vr-vdi" label="VDI name (optional)" width={180}><input id="vr-vdi" style={inputStyle(t)} value={registerDraft.vdiName} onChange={(e) => setRegisterDraft({ ...registerDraft, vdiName: e.target.value })} /></Field>
              <Field id="vr-class" label="Cost class" width={140}><input id="vr-class" style={inputStyle(t)} value={registerDraft.costClass} onChange={(e) => setRegisterDraft({ ...registerDraft, costClass: e.target.value })} list="vdi-cost-classes" /></Field>
              <Field id="vr-owner" label={d.activity.spokesServed.length > 1 ? "Multiple spokes — choose" : "Owner"} width={220}>
                <select id="vr-owner" style={inputStyle(t)} value={registerDraft.owner} onChange={(e) => setRegisterDraft({ ...registerDraft, owner: e.target.value })}>
                  {d.activity.spokesServed.length > 1 && <option value="">— choose —</option>}
                  <option value="HUB">Hub (shared / test)</option>
                  {reference.spokes.map((s) => <option key={s.spokeId} value={String(s.spokeId)}>{s.spokeName}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="vr-active" label="Active from" width={150}><input id="vr-active" type="date" style={inputStyle(t)} value={registerDraft.activeFrom} onChange={(e) => setRegisterDraft({ ...registerDraft, activeFrom: e.target.value })} /></Field>
              <Field id="vr-renewal" label="Renewal date" width={150}><input id="vr-renewal" type="date" style={inputStyle(t)} value={registerDraft.renewalDate} onChange={(e) => setRegisterDraft({ ...registerDraft, renewalDate: e.target.value })} /></Field>
              <Field id="vr-cost" label="Annual cost override (optional)" width={190}><input id="vr-cost" type="number" min={0} style={inputStyle(t)} value={registerDraft.annualCostGBP} onChange={(e) => setRegisterDraft({ ...registerDraft, annualCostGBP: e.target.value })} placeholder="leave blank to use class rate" /></Field>
              <Field id="vr-expiry" label="Licence expiry (optional)" width={170}><input id="vr-expiry" type="date" style={inputStyle(t)} value={registerDraft.licenseExpiryDate} onChange={(e) => setRegisterDraft({ ...registerDraft, licenseExpiryDate: e.target.value })} /></Field>
            </div>
            <Field id="vr-notes" label="Notes (optional)" width={480}><input id="vr-notes" style={inputStyle(t)} value={registerDraft.notes} onChange={(e) => setRegisterDraft({ ...registerDraft, notes: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton onClick={commitRegister}>Complete registration</PrimaryButton>
              <GhostButton onClick={() => setRegisteringName(null)}>Cancel</GhostButton>
            </div>
          </div>
        );
      })()}

      {editable && (
        adding ? (
          <div style={{ border: `1px dashed ${t.ruleSoft}`, borderRadius: 10, padding: 14, marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="va-name" label="Resource name" width={200}><input id="va-name" style={inputStyle(t)} value={addDraft.resourceName} onChange={(e) => setAddDraft({ ...addDraft, resourceName: e.target.value })} placeholder="e.g. VDI-RPA-COM-04" /></Field>
              <Field id="va-bot" label="Bot name (optional)" width={160}><input id="va-bot" style={inputStyle(t)} value={addDraft.botName} onChange={(e) => setAddDraft({ ...addDraft, botName: e.target.value })} /></Field>
              <Field id="va-acr" label="Bot acronym (optional)" width={120}><input id="va-acr" style={inputStyle(t)} value={addDraft.botAcronym} onChange={(e) => setAddDraft({ ...addDraft, botAcronym: e.target.value })} /></Field>
              <Field id="va-vdi" label="VDI name (optional)" width={160}><input id="va-vdi" style={inputStyle(t)} value={addDraft.vdiName} onChange={(e) => setAddDraft({ ...addDraft, vdiName: e.target.value })} /></Field>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Field id="va-class" label="Cost class" width={140}><input id="va-class" style={inputStyle(t)} value={addDraft.costClass} onChange={(e) => setAddDraft({ ...addDraft, costClass: e.target.value })} list="vdi-cost-classes" /></Field>
              <Field id="va-active" label="Active from" width={150}><input id="va-active" type="date" style={inputStyle(t)} value={addDraft.activeFrom} onChange={(e) => setAddDraft({ ...addDraft, activeFrom: e.target.value })} /></Field>
              <Field id="va-renewal" label="Renewal date" width={150}><input id="va-renewal" type="date" style={inputStyle(t)} value={addDraft.renewalDate} onChange={(e) => setAddDraft({ ...addDraft, renewalDate: e.target.value })} /></Field>
              <Field id="va-cost" label="Annual cost override (optional)" width={190}><input id="va-cost" type="number" min={0} style={inputStyle(t)} value={addDraft.annualCostGBP} onChange={(e) => setAddDraft({ ...addDraft, annualCostGBP: e.target.value })} placeholder="leave blank to use class rate" /></Field>
              <Field id="va-expiry" label="Licence expiry (optional)" width={170}><input id="va-expiry" type="date" style={inputStyle(t)} value={addDraft.licenseExpiryDate} onChange={(e) => setAddDraft({ ...addDraft, licenseExpiryDate: e.target.value })} /></Field>
            </div>
            <Field id="va-notes" label="Notes (optional)" width={480}><input id="va-notes" style={inputStyle(t)} value={addDraft.notes} onChange={(e) => setAddDraft({ ...addDraft, notes: e.target.value })} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <PrimaryButton onClick={commitAdd}>Save VDI</PrimaryButton>
              <GhostButton onClick={() => setAdding(false)}>Cancel</GhostButton>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <GhostButton onClick={() => { setAdding(true); setAddDraft({ ...addDraft, owner: ownerId, activeFrom: today, renewalDate: today }); }}>+ Add VDI</GhostButton>
          </div>
        )
      )}

      <div style={{ marginTop: 14 }}>
        <InfoBanner>Renewing, retiring or changing the cost of an existing VDI updates the Capacity and Commercial pages immediately. A newly added VDI appears in this table straight away, but won't show utilisation or cost until real work-queue activity for it is included in the next data build.</InfoBanner>
      </div>

      <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${t.ruleSoft}` }}>
        <h3 style={{ margin: "0 0 4px", fontFamily: fonts.display, fontSize: 15, fontWeight: 700, color: t.ink }}>VDI class-rate card</h3>
        <HelperText>The annual list price per VDI for each cost class, in force on each date. A class-rate change takes effect per VDI at that VDI's NEXT renewal — rates lock in for a VDI at the start of its current cover cycle, so changing today's class rate never retroactively changes what a VDI already mid-cycle is charged.</HelperText>

        <Field id="vdi-rate-class" label="Cost class" width={220}>
          <input id="vdi-rate-class" style={inputStyle(t)} value={rateClass} onChange={(e) => setRateClass(e.target.value)} list="vdi-cost-classes" placeholder="e.g. prod" />
        </Field>

        <VdiRateHistoryBlock
          idPrefix="vdi-rate-universal"
          title="Universal rate (applies to every spoke unless overridden below)"
          rows={universalRateRows}
          today={today}
          editable={isGlobalAdmin}
          canBackdate={isGlobalAdmin}
          onAdd={(row) => updateVdiCostHistoryScope(rateClass, undefined, (rs) => [...rs, { costClass: rateClass, spokeId: undefined, ...row }])}
          onEdit={(ef, rate) => updateVdiCostHistoryScope(rateClass, undefined, (rs) => rs.map((r) => (r.effectiveFrom === ef ? { ...r, annualCostPerVDIGBP: rate } : r)))}
          onDelete={(ef) => updateVdiCostHistoryScope(rateClass, undefined, (rs) => rs.filter((r) => r.effectiveFrom !== ef))}
          emptyLabel="No universal rate history for this class yet."
        />

        {ownerId !== "HUB" && (
          <VdiRateHistoryBlock
            idPrefix="vdi-rate-spoke"
            title={`${ownerSpokeName ?? "This spoke"} override`}
            rows={spokeRateRows}
            today={today}
            editable={editable}
            canBackdate={isGlobalAdmin}
            onAdd={(row) => updateVdiCostHistoryScope(rateClass, ownerId, (rs) => [...rs, { costClass: rateClass, spokeId: ownerId, ...row }])}
            onEdit={(ef, rate) => updateVdiCostHistoryScope(rateClass, ownerId, (rs) => rs.map((r) => (r.effectiveFrom === ef ? { ...r, annualCostPerVDIGBP: rate } : r)))}
            onDelete={(ef) => updateVdiCostHistoryScope(rateClass, ownerId, (rs) => rs.filter((r) => r.effectiveFrom !== ef))}
            emptyLabel={`No ${ownerSpokeName ?? "spoke"}-specific override for this class yet — the universal rate above applies.`}
          />
        )}

        <div style={{ marginTop: 12 }}>
          <InfoBanner>Select a spoke owner above (instead of Hub) to view or add that spoke's rate override for this cost class.</InfoBanner>
        </div>
      </div>

      <Announcer />
    </div>
  );
}

// --- VDI class-rate history block (mirrors GradeRateSection's locked-history
// UX: effectiveFrom-sorted rows, historyRowRights gating edit/delete, a
// standard non-backdated add form, plus an admin-only "backdated correction"
// escape hatch gated behind an explicit checkbox + ConfirmDialog). ---
function VdiRateHistoryBlock({
  idPrefix, title, rows, today, editable, canBackdate, onAdd, onEdit, onDelete, emptyLabel,
}: {
  idPrefix: string;
  title: string;
  rows: VdiCostHistoryRef[];
  today: string;
  editable: boolean;
  canBackdate: boolean;
  onAdd: (row: { effectiveFrom: string; annualCostPerVDIGBP: number }) => void;
  onEdit: (effectiveFrom: string, rate: number) => void;
  onDelete: (effectiveFrom: string) => void;
  emptyLabel: string;
}) {
  const t = useTheme();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ effectiveFrom: "", rate: "" });
  const [backdated, setBackdated] = useState(false);
  const [blockErr, setBlockErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ effectiveFrom: string; annualCostPerVDIGBP: number } | null>(null);
  const latest = mostRecent(rows);

  const resetAddForm = () => { setAdding(false); setDraft({ effectiveFrom: "", rate: "" }); setBackdated(false); setBlockErr(null); };

  const submitAdd = () => {
    if (!isValidISODate(draft.effectiveFrom)) return setBlockErr("Pick a valid effective-from date.");
    if (rows.some((r) => r.effectiveFrom === draft.effectiveFrom)) return setBlockErr("A rate is already effective from that date.");
    const rate = Number(draft.rate);
    if (!isFinite(rate) || rate <= 0) return setBlockErr("Rate must be a positive number.");
    if (draft.effectiveFrom < today) {
      if (!canBackdate || !backdated) return setBlockErr(`New records can't be backdated — ${LOCK_REASON}`);
      setPending({ effectiveFrom: draft.effectiveFrom, annualCostPerVDIGBP: rate });
      return;
    }
    onAdd({ effectiveFrom: draft.effectiveFrom, annualCostPerVDIGBP: rate });
    resetAddForm();
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft, marginBottom: 6 }}>{title}</div>
      <Table>
        <thead><tr><Th>Effective from</Th><Th align="right">Annual cost / VDI (£)</Th>{editable && <Th align="right">Actions</Th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={editable ? 3 : 2}>{emptyLabel}</EmptyRow>}
          {rows.map((r) => {
            const rights = historyRowRights(r.effectiveFrom, latest?.effectiveFrom === r.effectiveFrom, today);
            const editing = editingKey === r.effectiveFrom;
            return (
              <tr key={r.effectiveFrom}>
                <Td>{r.effectiveFrom}{r.effectiveFrom > today && <span style={{ marginLeft: 6, fontFamily: fonts.mono, fontSize: 9.5, color: t.inkSoft }}>(future)</span>}</Td>
                <Td align="right">{editing ? (
                  <input type="number" min={0} step={0.5} style={inputStyle(t, { width: 100, textAlign: "right" })} value={editRate} onChange={(e) => setEditRate(e.target.value)} aria-label="Annual cost per VDI" />
                ) : `£${r.annualCostPerVDIGBP.toLocaleString("en-GB")}`}</Td>
                {editable && (
                  <Td align="right">
                    {editing ? (
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <GhostButton onClick={() => {
                          const rate = Number(editRate);
                          if (!isFinite(rate) || rate <= 0) return setBlockErr("Rate must be a positive number.");
                          onEdit(r.effectiveFrom, rate);
                          setEditingKey(null);
                          setBlockErr(null);
                        }}>Save</GhostButton>
                        <GhostButton onClick={() => setEditingKey(null)}>Cancel</GhostButton>
                      </div>
                    ) : (
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                        {rights.canEdit && <GhostButton onClick={() => { setEditingKey(r.effectiveFrom); setEditRate(String(r.annualCostPerVDIGBP)); setBlockErr(null); }}>Edit</GhostButton>}
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
      {blockErr && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "8px 0 0" }}>{blockErr}</p>}
      {editable && (
        adding ? (
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field id={`${idPrefix}-add-date`} label="Effective from" width={150}><input id={`${idPrefix}-add-date`} type="date" style={inputStyle(t)} value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} /></Field>
            <Field id={`${idPrefix}-add-rate`} label="Annual cost / VDI (£)" width={160}><input id={`${idPrefix}-add-rate`} type="number" min={0} step={0.5} style={inputStyle(t)} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} /></Field>
            {canBackdate && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft, paddingBottom: 8 }}>
                <input type="checkbox" checked={backdated} onChange={(e) => setBackdated(e.target.checked)} />
                This is a backdated correction (admin only)
              </label>
            )}
            <PrimaryButton onClick={submitAdd}>Add record</PrimaryButton>
            <GhostButton onClick={resetAddForm}>Cancel</GhostButton>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}><GhostButton onClick={() => setAdding(true)}>+ Add rate record from date…</GhostButton></div>
        )
      )}
      {pending && (
        <ConfirmDialog
          title="Confirm backdated rate change"
          body="This re-values already-reported cost history."
          confirmLabel="Confirm backdated change"
          onConfirm={() => { onAdd(pending); setPending(null); resetAddForm(); }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
