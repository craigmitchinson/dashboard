// A selected business quarter, shared across the pack. It drives the QBR eyebrow
// on every slide and the time-horizon titles on the dependencies slide.

export interface Quarter {
  q: 1 | 2 | 3 | 4;
  year: number;
}

/** Stable map key for a quarter, e.g. "2026-Q3". */
export const quarterKey = (qt: Quarter): string => `${qt.year}-Q${qt.q}`;

/** "Q3 '26" */
export const shortQuarter = (qt: Quarter): string =>
  `Q${qt.q} '${String(qt.year).slice(2)}`;

/** Today's real calendar quarter, used as the anchor in the picker. */
export const currentQuarter = (): Quarter => {
  const d = new Date();
  return {
    q: (Math.floor(d.getMonth() / 3) + 1) as Quarter["q"],
    year: d.getFullYear(),
  };
};

/** The four quarters of a year, Q1..Q4. */
export const quartersOfYear = (year: number): Quarter[] =>
  ([1, 2, 3, 4] as Quarter["q"][]).map((q) => ({ q, year }));

/** The quarter immediately after the given one, wrapping the year. */
export const nextQuarter = (qt: Quarter): Quarter =>
  qt.q === 4 ? { q: 1, year: qt.year + 1 } : { q: (qt.q + 1) as Quarter["q"], year: qt.year };

/** The quarter immediately before the given one, wrapping the year. */
export const previousQuarter = (qt: Quarter): Quarter =>
  qt.q === 1 ? { q: 4, year: qt.year - 1 } : { q: (qt.q - 1) as Quarter["q"], year: qt.year };

/** Eyebrow label: "Quarterly business review · Q3 '26" (rendered uppercase). */
export const qbrKicker = (qt: Quarter): string =>
  `Quarterly business review · ${shortQuarter(qt)}`;

export const currentHorizonTitle = (qt: Quarter): string =>
  `This quarter (Q${qt.q}) and previous`;

export const nextHorizonTitle = (qt: Quarter): string =>
  `Next quarter (Q${nextQuarter(qt).q}) and beyond`;

export const sameQuarter = (a: Quarter, b: Quarter): boolean =>
  a.q === b.q && a.year === b.year;

/** A rolling list of quarters around the selection for the picker menu. */
export const quarterOptions = (around: Quarter): Quarter[] => {
  const out: Quarter[] = [];
  for (let year = around.year - 1; year <= around.year + 1; year += 1) {
    for (let q = 1 as Quarter["q"]; q <= 4; q = (q + 1) as Quarter["q"]) {
      out.push({ q, year });
    }
  }
  return out;
};
