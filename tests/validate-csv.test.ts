// ---------------------------------------------------------------------------
// tests/validate-csv.test.ts
// ---------------------------------------------------------------------------
// tools/validate-workqueue-csv.mjs's row-level check function (checkRow) and
// header check (checkHeader), unit-tested on small inline samples — no file
// I/O. See docs/DATA-CONTRACT.md for the rules these enforce.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { checkRow, checkHeader, classifyDate, parseCsv, HEADER } from "../tools/validate-workqueue-csv.mjs";

const GOOD_ROW = {
  ID: "GUID-1",
  KeyValue: "POL-1",
  Priority: "2",
  Status: "Completed",
  Tags: "",
  Resource: "VDI-RPA-PROD-01",
  Attempt: "1",
  LoadedDate: "2026-01-01 06:00:00",
  LastUpdatedDate: "2026-01-01 07:00:00",
  DeferredDate: "",
  LockedDate: "",
  CompletedDate: "2026-01-01 07:00:00",
  Worktime: "120",
  ExceptionDate: "",
  ExceptionReason: "",
  QueueName: "INSURANCE_NEW_BUS",
};

const QUEUE_NAMES = new Set(["INSURANCE_NEW_BUS", "HOME_CLAIMS"]);

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("checkRow", () => {
  it("a well-formed Completed row has no issues", () => {
    expect(checkRow(GOOD_ROW, { queueNames: QUEUE_NAMES })).toEqual([]);
  });

  it("flags a blank ID", () => {
    const issues = checkRow({ ...GOOD_ROW, ID: "  " }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("ID_BLANK");
  });

  it("accepts a 'T' separator as well as a space separator", () => {
    const issues = checkRow({ ...GOOD_ROW, LoadedDate: "2026-01-01T06:00:00" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).not.toContain("DATE_UNPARSEABLE");
  });

  it("flags an unparseable date", () => {
    const issues = checkRow({ ...GOOD_ROW, LoadedDate: "not-a-date" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("DATE_UNPARSEABLE");
  });

  it("flags a UK-style date-and-time as unparseable (not silently misread)", () => {
    const issues = checkRow({ ...GOOD_ROW, LoadedDate: "31/01/2026 06:00:00" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("DATE_UNPARSEABLE");
  });

  it("leaves a blank optional date column alone (blank is not unparseable)", () => {
    const issues = checkRow({ ...GOOD_ROW, LockedDate: "" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).not.toContain("DATE_UNPARSEABLE");
  });

  it("flags a negative Worktime", () => {
    const issues = checkRow({ ...GOOD_ROW, Worktime: "-1" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("WORKTIME_INVALID");
  });

  it("flags a non-integer Worktime", () => {
    const issues = checkRow({ ...GOOD_ROW, Worktime: "12.5" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("WORKTIME_INVALID");
  });

  it("accepts Worktime of exactly 0", () => {
    const issues = checkRow({ ...GOOD_ROW, Worktime: "0" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).not.toContain("WORKTIME_INVALID");
  });

  it("flags a Status outside the vocabulary", () => {
    const issues = checkRow({ ...GOOD_ROW, Status: "Running" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("STATUS_INVALID");
  });

  it("flags Attempt < 1", () => {
    const issues = checkRow({ ...GOOD_ROW, Attempt: "0" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("ATTEMPT_INVALID");
  });

  it("warns (does not error) on an unmapped QueueName", () => {
    const issues = checkRow({ ...GOOD_ROW, QueueName: "NEW_QUEUE" }, { queueNames: QUEUE_NAMES });
    const hit = issues.find((i) => i.code === "QUEUE_UNMAPPED");
    expect(hit?.level).toBe("warning");
  });

  it("does not warn about QueueName mapping when no reference set is supplied", () => {
    const issues = checkRow({ ...GOOD_ROW, QueueName: "NEW_QUEUE" }, {});
    expect(codes(issues)).not.toContain("QUEUE_UNMAPPED");
  });

  it("warns when CompletedDate is before LoadedDate", () => {
    const issues = checkRow({ ...GOOD_ROW, LoadedDate: "2026-01-02 06:00:00", CompletedDate: "2026-01-01 07:00:00" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("COMPLETED_BEFORE_LOADED");
  });

  it("warns when Status is Exception but ExceptionDate is blank", () => {
    const issues = checkRow({ ...GOOD_ROW, Status: "Exception", CompletedDate: "", ExceptionDate: "" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("EXCEPTION_DATE_MISSING");
  });

  it("warns when ExceptionDate is set but Status is not Exception", () => {
    const issues = checkRow({ ...GOOD_ROW, ExceptionDate: "2026-01-01 06:30:00" }, { queueNames: QUEUE_NAMES });
    expect(codes(issues)).toContain("EXCEPTION_DATE_UNEXPECTED");
  });
});

describe("checkHeader", () => {
  it("passes the exact 16-column header in order", () => {
    expect(checkHeader(HEADER).ok).toBe(true);
  });

  it("reports a missing column", () => {
    const h = checkHeader(HEADER.filter((c) => c !== "Worktime"));
    expect(h.ok).toBe(false);
    expect(h.missing).toContain("Worktime");
  });

  it("reports an extra column", () => {
    const h = checkHeader([...HEADER, "ExtraColumn"]);
    expect(h.ok).toBe(false);
    expect(h.extra).toContain("ExtraColumn");
  });

  it("reports misordered columns", () => {
    const swapped = [...HEADER];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const h = checkHeader(swapped);
    expect(h.ok).toBe(false);
    expect(h.misordered).toBe(true);
  });
});

describe("classifyDate", () => {
  it("treats an empty string as blank, not unparseable", () => {
    expect(classifyDate("")).toEqual({ blank: true });
  });

  it("parses 'YYYY-MM-DD HH:MM:SS'", () => {
    const d = classifyDate("2026-01-01 06:00:00");
    expect(d.ok).toBe(true);
  });

  it("parses 'YYYY-MM-DDTHH:MM:SS'", () => {
    const d = classifyDate("2026-01-01T06:00:00");
    expect(d.ok).toBe(true);
  });

  it("rejects a UK-style date", () => {
    const d = classifyDate("01/01/2026 06:00:00");
    expect(d.blank).toBe(false);
    expect(d.ok).toBe(false);
  });
});

describe("parseCsv", () => {
  it("parses a quoted field containing a comma", () => {
    const rows = parseCsv('a,b\n"1,2",3\n');
    expect(rows).toEqual([["a", "b"], ["1,2", "3"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    const rows = parseCsv('a\n"he said ""hi"""\n');
    expect(rows).toEqual([["a"], ['he said "hi"']]);
  });
});
