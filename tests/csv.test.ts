// ---------------------------------------------------------------------------
// tests/csv.test.ts
// ---------------------------------------------------------------------------
// Covers src/components/PageActions.tsx's pure CSV helpers: buildCsv's
// RFC-4180-ish quoting rules and csvFilename's date-suffix formatting.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { buildCsv, csvFilename } from "../src/components/PageActions";

describe("buildCsv", () => {
  it("derives the header from the keys of the first row when no columns are given", () => {
    const csv = buildCsv([{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }]);
    expect(csv).toBe("id,name\n1,Alpha\n2,Beta");
  });

  it("uses an explicit columns list for the header, in that order", () => {
    const csv = buildCsv([{ id: 1, name: "Alpha", extra: "ignored via column order but still present" }], ["name", "id"]);
    expect(csv).toBe("name,id\nAlpha,1");
  });

  it("returns an empty string for no rows and no columns (cannot infer a header)", () => {
    expect(buildCsv([])).toBe("");
  });

  it("emits just the header line for no rows when columns are given", () => {
    expect(buildCsv([], ["a", "b"])).toBe("a,b");
  });

  it("quotes a value containing a comma", () => {
    expect(buildCsv([{ label: "Loans, Retail" }])).toBe('label\n"Loans, Retail"');
  });

  it("quotes a value containing a double quote and doubles the internal quote", () => {
    expect(buildCsv([{ label: 'The "best" queue' }])).toBe('label\n"The ""best"" queue"');
  });

  it("quotes a value containing a newline", () => {
    expect(buildCsv([{ note: "line one\nline two" }])).toBe('note\n"line one\nline two"');
  });

  it("does not quote a value with none of comma/quote/newline", () => {
    expect(buildCsv([{ label: "Plain text - no special chars" }])).toBe("label\nPlain text - no special chars");
  });

  it("leaves numbers unquoted", () => {
    expect(buildCsv([{ count: 1234, rate: 0.5, negative: -3 }])).toBe("count,rate,negative\n1234,0.5,-3");
  });

  it("renders null and undefined values as an empty field", () => {
    expect(buildCsv([{ a: null, b: undefined, c: 0 }])).toBe("a,b,c\n,,0");
  });

  it("a column absent from a row (via an explicit columns list) is also an empty field", () => {
    expect(buildCsv([{ a: 1 }], ["a", "missing"])).toBe("a,missing\n1,");
  });

  it("joins rows with \\n and does not add a trailing newline or BOM", () => {
    const csv = buildCsv([{ a: 1 }, { a: 2 }]);
    expect(csv.endsWith("\n")).toBe(false);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.split("\n")).toEqual(["a", "1", "2"]);
  });

  it("Excel/Sheets formula-injection case: a leading '=' is NOT escaped (documented current behaviour, not hardened here)", () => {
    // A cell opened in Excel/Sheets that starts with =, +, -, or @ can be
    // interpreted as a formula. buildCsv does not defend against this today —
    // this test pins that (arguably unsafe) status quo rather than changing
    // it, per the task's "document, don't fix" instruction.
    const csv = buildCsv([{ formula: "=SUM(A1:A9)" }]);
    expect(csv).toBe("formula\n=SUM(A1:A9)");
  });
});

describe("csvFilename", () => {
  it("appends the date's leading YYYY-MM-DD and a .csv extension", () => {
    expect(csvFilename("exceptions", "2026-09-02T00:00:00.000Z")).toBe("exceptions-2026-09-02.csv");
  });

  it("accepts a bare YYYY-MM-DD date string unchanged", () => {
    expect(csvFilename("exceptions", "2026-09-02")).toBe("exceptions-2026-09-02.csv");
  });
});
