import type { ObjectivesBoard, KrField } from "./types";
import { RAG_STATUSES } from "./types";

// Immutable edits to a single quarter's objectives board.

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;
const clone = (b: ObjectivesBoard): ObjectivesBoard => structuredClone(b);
const cycle = <T,>(list: readonly T[], v: T): T =>
  list[(list.indexOf(v) + 1) % list.length];

export function editObjectivesTitle(
  board: ObjectivesBoard,
  text: string,
): ObjectivesBoard {
  return { ...board, title: text };
}

export function addObjective(board: ObjectivesBoard): ObjectivesBoard {
  const b = clone(board);
  b.objectives.push({
    id: uid("ob"),
    text: "New objective",
    status: "on-track",
    keyResults: [
      { id: uid("k"), text: "New key result", metric: "Target", status: "on-track" },
    ],
  });
  return b;
}

export function editObjective(
  board: ObjectivesBoard,
  id: string,
  text: string,
): ObjectivesBoard {
  const b = clone(board);
  const o = b.objectives.find((x) => x.id === id);
  if (!o) return board;
  o.text = text;
  return b;
}

export function cycleObjectiveStatus(
  board: ObjectivesBoard,
  id: string,
): ObjectivesBoard {
  const b = clone(board);
  const o = b.objectives.find((x) => x.id === id);
  if (!o) return board;
  o.status = cycle(RAG_STATUSES, o.status);
  return b;
}

export function removeObjective(
  board: ObjectivesBoard,
  id: string,
): ObjectivesBoard {
  const b = clone(board);
  b.objectives = b.objectives.filter((x) => x.id !== id);
  return b;
}

export function addKeyResult(
  board: ObjectivesBoard,
  objectiveId: string,
): ObjectivesBoard {
  const b = clone(board);
  const o = b.objectives.find((x) => x.id === objectiveId);
  if (!o) return board;
  o.keyResults.push({
    id: uid("k"),
    text: "New key result",
    metric: "Target",
    status: "on-track",
  });
  return b;
}

export function editKeyResult(
  board: ObjectivesBoard,
  objectiveId: string,
  krId: string,
  field: KrField,
  text: string,
): ObjectivesBoard {
  const b = clone(board);
  const kr = b.objectives
    .find((x) => x.id === objectiveId)
    ?.keyResults.find((k) => k.id === krId);
  if (!kr) return board;
  kr[field] = text;
  return b;
}

export function cycleKeyResultStatus(
  board: ObjectivesBoard,
  objectiveId: string,
  krId: string,
): ObjectivesBoard {
  const b = clone(board);
  const kr = b.objectives
    .find((x) => x.id === objectiveId)
    ?.keyResults.find((k) => k.id === krId);
  if (!kr) return board;
  kr.status = cycle(RAG_STATUSES, kr.status);
  return b;
}

export function removeKeyResult(
  board: ObjectivesBoard,
  objectiveId: string,
  krId: string,
): ObjectivesBoard {
  const b = clone(board);
  const o = b.objectives.find((x) => x.id === objectiveId);
  if (!o) return board;
  o.keyResults = o.keyResults.filter((k) => k.id !== krId);
  return b;
}
