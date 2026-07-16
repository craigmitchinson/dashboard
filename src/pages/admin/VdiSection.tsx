import { useMemo, useState } from "react";
import { fonts } from "../../theme";
import { useTheme } from "../../theme-context";
import type { ResourceRef } from "../../reference/reference-store";
import {
  Field, GhostButton, PrimaryButton, DangerButton, SectionTitle, Table, Td, Th, EmptyRow, InfoBanner,
  inputStyle, useSectionSave, currentCoverageWindow, todayISO, isValidISODate,
} from "./shared";
import type { SectionProps } from "./shared";

type AddDraft = {
  resourceName: string; botName: string; botAcronym: string; vdiName: string; costClass: string;
  owner: string; // "HUB" or spokeId as string
  activeFrom: string; renewalDate: string; annualCostGBP: string; licenseExpiryDate: string; notes: string;
};

export function VdiSection({ reference, update, actor, can }: SectionProps) {
  const t = useTheme();
  const { save, Announcer } = useSectionSave(update, actor);
  const owners = useMemo(() => ["HUB", ...reference.spokes.map((s) => String(s.spokeId))], [reference.spokes]);
  const [ownerId, setOwnerId] = useState(owners[0] ?? "HUB");
  const [err, setErr] = useState<string | null>(null);
  const today = todayISO();

  const ownerSpokeName = ownerId === "HUB" ? null : reference.spokes.find((s) => String(s.spokeId) === ownerId)?.spokeName ?? null;
  const editable = ownerId === "HUB" ? can("edit_global_reference") : ownerSpokeName != null && can("edit_spoke_reference", ownerSpokeName);

  const rows = reference.resources.filter((r) => (ownerId === "HUB" ? r.spokeId == null : String(r.spokeId) === ownerId));
  const costClasses = useMemo(() => Array.from(new Set(reference.vdiCostHistory.map((v) => v.costClass))), [reference.vdiCostHistory]);

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ costClass: string; annualCostGBP: string; licenseExpiryDate: string; notes: string }>({ costClass: "", annualCostGBP: "", licenseExpiryDate: "", notes: "" });
  const [renewingName, setRenewingName] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState(today);
  const [retiringName, setRetiringName] = useState<string | null>(null);
  const [retireDate, setRetireDate] = useState(today);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>({ resourceName: "", botName: "", botAcronym: "", vdiName: "", costClass: costClasses[0] ?? "prod", owner: ownerId, activeFrom: today, renewalDate: today, annualCostGBP: "", licenseExpiryDate: "", notes: "" });

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

  const commitRetire = (resourceName: string) => {
    if (!isValidISODate(retireDate)) return setErr("Pick a valid retirement date.");
    save("resources", (d) => { d.resources = d.resources.map((r) => (r.resourceName === resourceName ? { ...r, status: "retired", activeTo: retireDate, isActive: false } : r)); }, "Saved — VDI retired, dashboards updated.");
    setRetiringName(null);
    setErr(null);
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

  return (
    <div>
      <SectionTitle
        title="VDI estate"
        helper="Every digital-worker VDI licence: which spoke pays for it (or the hub, for shared/test machines), its annual cost, and its renewal/expiry dates. Renewing books a full year of cover from the date you choose — it is never pro-rated. An expiry date cuts coverage short even mid-cycle."
      />

      <Field id="vdi-owner" label="Owner" width={280}>
        <select id="vdi-owner" style={inputStyle(t)} value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setErr(null); }}>
          {owners.map((o) => {
            const name = o === "HUB" ? "Hub (shared / test)" : reference.spokes.find((s) => String(s.spokeId) === o)?.spokeName ?? o;
            return <option key={o} value={o}>{name}{o !== "HUB" && !can("edit_spoke_reference", name) ? " (read-only for you)" : ""}</option>;
          })}
        </select>
      </Field>

      {err && <p role="alert" style={{ color: t.accent, fontFamily: fonts.body, fontSize: 12.5, margin: "10px 0 0" }}>{err}</p>}

      <div style={{ marginTop: 12 }}>
        <Table>
          <thead>
            <tr>
              <Th>Resource</Th><Th>Cost class</Th><Th>Renewal date</Th><Th align="right">Annual cost override (£)</Th><Th>Licence expiry</Th><Th>Status</Th><Th>Current coverage window</Th>
              {editable && <Th align="right">Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={editable ? 8 : 7}>No VDIs recorded for this owner yet.</EmptyRow>}
            {rows.map((r) => {
              const editing = editingName === r.resourceName;
              const cov = currentCoverageWindow(r, today);
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
                  </Td>
                  <Td muted>{cov.covered ? `${cov.startISO} – ${cov.endISO}` : "not covered today"}</Td>
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
          </tbody>
        </Table>
        <datalist id="vdi-cost-classes">{costClasses.map((c) => <option key={c} value={c} />)}</datalist>
      </div>

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
      <Announcer />
    </div>
  );
}
