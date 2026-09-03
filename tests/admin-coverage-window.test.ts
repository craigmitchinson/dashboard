// ---------------------------------------------------------------------------
// tests/admin-coverage-window.test.ts
// ---------------------------------------------------------------------------
// src/pages/admin/shared.tsx's currentCoverageWindow() is a thin wrapper over
// src/reference/economics.ts's exported cycleStart()/coverageWindow() — this
// pins that the wrapper's ISO-string/`covered` output is byte-for-byte
// derived from the SAME cycle the economics engine itself would compute, for
// both a retired VDI (activeTo-capped) and an active VDI with an expired
// license (licenseExpiryDate-capped).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { currentCoverageWindow } from "../src/pages/admin/shared";
import { cycleStart, coverageWindow } from "../src/reference/economics";

const DAY_MS = 86400000;
const dateOnly = (ts: number) => new Date(ts).toISOString().slice(0, 10);

describe("currentCoverageWindow: thin wrapper over economics.ts's cycleStart/coverageWindow", () => {
  it("matches economics.ts exactly for a RETIRED VDI (activeTo-capped window)", () => {
    const vdi = {
      activeFrom: "2020-01-01",
      activeTo: "2026-03-31",
      renewalDate: "2026-01-01",
      licenseExpiryDate: null,
      status: "retired" as const,
    };
    const asOfISO = "2026-03-15";

    const cs = cycleStart(vdi.renewalDate, asOfISO);
    const { start, end } = coverageWindow(vdi, cs);
    const asOfTs = Date.parse(asOfISO + "T00:00:00Z");
    const expected = { startISO: dateOnly(start), endISO: dateOnly(end - DAY_MS), covered: asOfTs >= start && asOfTs < end };

    expect(currentCoverageWindow(vdi, asOfISO)).toEqual(expected);
    // sanity: the retirement date really did cap the window below a full 365 days.
    expect(expected.endISO).toBe("2026-03-31");
    expect(expected.covered).toBe(true);
  });

  it("matches economics.ts exactly for an EXPIRED (licenseExpiryDate-capped) VDI", () => {
    const vdi = {
      activeFrom: "2020-01-01",
      activeTo: null,
      renewalDate: "2026-01-01",
      licenseExpiryDate: "2026-06-30",
      status: "active" as const,
    };
    const asOfISO = "2026-07-15"; // AFTER the license expiry -- not covered

    const cs = cycleStart(vdi.renewalDate, asOfISO);
    const { start, end } = coverageWindow(vdi, cs);
    const asOfTs = Date.parse(asOfISO + "T00:00:00Z");
    const expected = { startISO: dateOnly(start), endISO: dateOnly(end - DAY_MS), covered: asOfTs >= start && asOfTs < end };

    expect(currentCoverageWindow(vdi, asOfISO)).toEqual(expected);
    expect(expected.endISO).toBe("2026-06-30");
    expect(expected.covered).toBe(false);
  });
});
