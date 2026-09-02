// ---------------------------------------------------------------------------
// reference-mapping.ts — maps a full ReferenceJson object directly to the
// assembleModel rowset shapes for spokes/propositions/processes/resources
// (PascalCase, vw_Dim*-shaped + the extension columns those existing views
// don't carry — see shared/model-assembler.mjs's header comment). Shared by
// BOTH data/fixtures.ts (the in-memory reference store is the only source
// of truth for these dims in fixture mode) and data/sql.ts (attaching
// Icon/Tags/Queues / RenewalDate/AnnualCostGBP/LicenseExpiryDate/Status
// columns the real vw_DimProcess/vw_DimResource views don't expose).
// Mirrors tools/build-dashboard-data.mjs's ref.spokes.map/etc exactly.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ref = Record<string, any>;

export function spokesRowsetFromReference(ref: Ref) {
  return ref.spokes.map((s: Ref) => ({
    SpokeId: s.spokeId,
    SpokeName: s.spokeName,
    ShortName: s.shortName,
    ColorHexLight: s.colorLight,
    ColorHexDark: s.colorDark,
  }));
}

export function propositionsRowsetFromReference(ref: Ref) {
  const spokeById = new Map(ref.spokes.map((s: Ref) => [s.spokeId, s]));
  return ref.propositions.map((p: Ref) => ({
    PropositionId: p.propositionId,
    PropositionName: p.propositionName,
    SpokeId: p.spokeId,
    SpokeName: (spokeById.get(p.spokeId) as Ref)?.spokeName,
  }));
}

export function processesRowsetFromReference(ref: Ref) {
  const propById = new Map(ref.propositions.map((p: Ref) => [p.propositionId, p]));
  const spokeById = new Map(ref.spokes.map((s: Ref) => [s.spokeId, s]));
  return ref.processes.map((p: Ref) => {
    const prop = propById.get(p.propositionId) as Ref;
    const spoke = spokeById.get(prop.spokeId) as Ref;
    return {
      ProcessId: p.processId,
      ProcessName: p.processName,
      ProcessAcronym: p.processAcronym,
      ProcessDescription: p.processDescription,
      PropositionId: p.propositionId,
      PropositionName: prop.propositionName,
      SpokeId: spoke.spokeId,
      SpokeName: spoke.spokeName,
      SMVMinutes: p.smvMinutes,
      Grade: p.grade,
      Icon: p.icon,
      Tags: p.tags,
      Queues: ref.queueMap
        .filter((q: Ref) => q.processId === p.processId)
        .map((q: Ref) => ({ queue: q.queueName, stage: q.stageName, order: q.stageOrder })),
    };
  });
}

export function resourcesRowsetFromReference(ref: Ref) {
  const spokeById = new Map(ref.spokes.map((s: Ref) => [s.spokeId, s]));
  return ref.resources.map((r: Ref) => ({
    ResourceName: r.resourceName,
    BotName: r.botName,
    BotAcronym: r.botAcronym,
    VDIName: r.vdiName,
    CostClass: r.costClass,
    SpokeId: r.spokeId ?? null,
    SpokeName: r.spokeId != null ? (spokeById.get(r.spokeId) as Ref)?.spokeName : "Hub",
    ActiveFrom: r.activeFrom,
    ActiveTo: r.activeTo,
    Notes: r.notes,
    RenewalDate: r.renewalDate,
    AnnualCostGBP: r.annualCostGBP ?? null,
    LicenseExpiryDate: r.licenseExpiryDate ?? null,
    Status: r.status,
  }));
}
