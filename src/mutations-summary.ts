import type { SummaryBoard, SummaryField, AskField } from "./types";

// Immutable edits to a single quarter's executive summary board.

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;
const clone = (b: SummaryBoard): SummaryBoard => structuredClone(b);

export function editSummaryField(
  board: SummaryBoard,
  field: SummaryField,
  text: string,
): SummaryBoard {
  return { ...board, [field]: text };
}

export function addAsk(board: SummaryBoard): SummaryBoard {
  const b = clone(board);
  b.asks.push({ id: uid("a"), owner: "Team", text: "Decision needed" });
  return b;
}

export function editAsk(
  board: SummaryBoard,
  id: string,
  field: AskField,
  text: string,
): SummaryBoard {
  const b = clone(board);
  const a = b.asks.find((x) => x.id === id);
  if (!a) return board;
  a[field] = text;
  return b;
}

export function removeAsk(board: SummaryBoard, id: string): SummaryBoard {
  const b = clone(board);
  b.asks = b.asks.filter((x) => x.id !== id);
  return b;
}
