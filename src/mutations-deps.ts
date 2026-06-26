import type {
  DependenciesBoard,
  Dependency,
  DepStatus,
  Horizon,
  BoardField,
} from "./types";
import { DEP_STATUSES, RISK_SEVERITIES } from "./types";

// Immutable edits to the dependencies board, mirroring the roadmap mutation
// style: each returns a new board so React state updates cleanly.

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;

const clone = (b: DependenciesBoard): DependenciesBoard => structuredClone(b);

export function editBoardField(
  board: DependenciesBoard,
  field: BoardField,
  text: string,
): DependenciesBoard {
  return { ...board, [field]: text };
}

export function addDependency(
  board: DependenciesBoard,
  horizon: Horizon,
  status: DepStatus,
): DependenciesBoard {
  const b = clone(board);
  b[horizon].push({
    id: uid("d"),
    text: "New dependency",
    status,
    origin: "incoming",
  });
  return b;
}

export function editDependency(
  board: DependenciesBoard,
  horizon: Horizon,
  id: string,
  text: string,
): DependenciesBoard {
  const b = clone(board);
  const d = b[horizon].find((x) => x.id === id);
  if (!d) return board;
  d.text = text;
  return b;
}

export function cycleStatus(
  board: DependenciesBoard,
  horizon: Horizon,
  id: string,
): DependenciesBoard {
  const b = clone(board);
  const d = b[horizon].find((x) => x.id === id);
  if (!d) return board;
  const i = DEP_STATUSES.indexOf(d.status);
  d.status = DEP_STATUSES[(i + 1) % DEP_STATUSES.length];
  return b;
}

export function toggleOrigin(
  board: DependenciesBoard,
  horizon: Horizon,
  id: string,
): DependenciesBoard {
  const b = clone(board);
  const d = b[horizon].find((x) => x.id === id);
  if (!d) return board;
  d.origin = d.origin === "incoming" ? "existing" : "incoming";
  return b;
}

export function removeDependency(
  board: DependenciesBoard,
  horizon: Horizon,
  id: string,
): DependenciesBoard {
  const b = clone(board);
  b[horizon] = b[horizon].filter((x) => x.id !== id);
  return b;
}

export function addEscalation(board: DependenciesBoard): DependenciesBoard {
  const b = clone(board);
  b.escalations.push({ id: uid("x"), text: "New escalation" });
  return b;
}

export function editEscalation(
  board: DependenciesBoard,
  id: string,
  text: string,
): DependenciesBoard {
  const b = clone(board);
  const e = b.escalations.find((x) => x.id === id);
  if (!e) return board;
  e.text = text;
  return b;
}

export function removeEscalation(
  board: DependenciesBoard,
  id: string,
): DependenciesBoard {
  const b = clone(board);
  b.escalations = b.escalations.filter((x) => x.id !== id);
  return b;
}

/** All dependencies in a horizon that have the given status, preserving order. */
export function byStatus(
  list: Dependency[],
  status: DepStatus,
): Dependency[] {
  return list.filter((d) => d.status === status);
}

// --- Risks ----------------------------------------------------------------

export function addRisk(board: DependenciesBoard): DependenciesBoard {
  const b = clone(board);
  b.risks.push({ id: uid("r"), text: "New risk", severity: "medium" });
  return b;
}

export function editRisk(
  board: DependenciesBoard,
  id: string,
  text: string,
): DependenciesBoard {
  const b = clone(board);
  const r = b.risks.find((x) => x.id === id);
  if (!r) return board;
  r.text = text;
  return b;
}

export function cycleSeverity(
  board: DependenciesBoard,
  id: string,
): DependenciesBoard {
  const b = clone(board);
  const r = b.risks.find((x) => x.id === id);
  if (!r) return board;
  const i = RISK_SEVERITIES.indexOf(r.severity);
  r.severity = RISK_SEVERITIES[(i + 1) % RISK_SEVERITIES.length];
  return b;
}

export function removeRisk(
  board: DependenciesBoard,
  id: string,
): DependenciesBoard {
  const b = clone(board);
  b.risks = b.risks.filter((x) => x.id !== id);
  return b;
}
