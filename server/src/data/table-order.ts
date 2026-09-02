// ---------------------------------------------------------------------------
// table-order.ts — the FK-safe write order for reference-data tables,
// mirroring src/reference/reference-store.ts's exportReferenceSql() byte
// for byte (see that file's comment for the FK reasoning: RefGradeSpoke FKs
// to BOTH RefSpoke and RefGrade, so it deletes before both and inserts after
// both). server/test/reference-order.test.ts asserts this equals the SPA
// exporter's order — a regression here is a data-corrupting bug on
// PUT /api/reference against a real database, so keep the two hand-in-hand.
// ---------------------------------------------------------------------------

export const DELETE_ORDER = [
  "RefQueueMap",
  "RefProcess",
  "RefProposition",
  "RefResource",
  "RefGradeSpoke",
  "RefSpoke",
  "RefGrade",
  "RefGradeRate",
  "RefVDICostHistory",
  "RefEstateCostHistory",
  "RefPeopleCostHistory",
  "RefExceptionType",
] as const;

export const INSERT_ORDER = [
  "RefSpoke",
  "RefGrade",
  "RefGradeSpoke",
  "RefGradeRate",
  "RefProposition",
  "RefProcess",
  "RefQueueMap",
  "RefResource",
  "RefVDICostHistory",
  "RefEstateCostHistory",
  "RefPeopleCostHistory",
  "RefExceptionType",
] as const;
