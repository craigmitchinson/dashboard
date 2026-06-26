import type {
  DeliveryBoard,
  MetricField,
  HighlightField,
} from "./types";

// Immutable edits to a single quarter's delivery board.

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq += 1)}`;

const clone = (b: DeliveryBoard): DeliveryBoard => structuredClone(b);

/** Parse a typed number cell into a non-negative integer. */
const toCount = (text: string): number => {
  const n = Math.round(Number(text.replace(/[^0-9.-]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function setMetric(
  board: DeliveryBoard,
  field: MetricField,
  text: string,
): DeliveryBoard {
  const b = clone(board);
  b.metrics[field] = toCount(text);
  return b;
}

export function editDeliveryTitle(
  board: DeliveryBoard,
  text: string,
): DeliveryBoard {
  return { ...board, title: text };
}

// Keep highlights ordered by team name (stable for equal teams).
const sortByTeam = (b: DeliveryBoard): DeliveryBoard => {
  b.highlights.sort((x, y) => x.team.localeCompare(y.team));
  return b;
};

export function addHighlight(board: DeliveryBoard): DeliveryBoard {
  const b = clone(board);
  b.highlights.push({ id: uid("h"), team: "Team", text: "What they delivered" });
  return sortByTeam(b);
}

export function editHighlight(
  board: DeliveryBoard,
  id: string,
  field: HighlightField,
  text: string,
): DeliveryBoard {
  const b = clone(board);
  const h = b.highlights.find((x) => x.id === id);
  if (!h) return board;
  h[field] = text;
  // Re-sort when the team changes so the list stays alphabetical.
  return field === "team" ? sortByTeam(b) : b;
}

export function removeHighlight(
  board: DeliveryBoard,
  id: string,
): DeliveryBoard {
  const b = clone(board);
  b.highlights = b.highlights.filter((x) => x.id !== id);
  return b;
}
