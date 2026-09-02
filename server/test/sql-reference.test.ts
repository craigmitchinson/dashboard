// ---------------------------------------------------------------------------
// sql-reference.test.ts — SqlReferenceStore against a lightweight in-memory
// fake of the mssql surface it uses (no real database). Covers:
//   1. Round-trip: put() a reference with process icons/tags, get() it back,
//      assert it comes back identical -- proof core.RefProcess.Icon/Tags
//      (03_core_dimensions.sql) fully replace the retired processExtras
//      core.RefAppSettings stopgap (no data loss, no residual document).
//   2. The server writer's RefProcess column list includes Icon and Tags.
//   3. "spa-exporter-columns-in-sync": src/reference/reference-store.ts's
//      exportReferenceSql() RefProcess column list (parsed as TEXT, by
//      design -- see the task note below) must equal the server writer's
//      RefProcess column list. THIS TEST IS EXPECTED TO FAIL until the SPA
//      half of this change lands (src/reference/reference-store.ts is owned
//      by a different worker) -- its failure message prints the exact edit
//      needed.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface Store {
  RefSpoke: Row[];
  RefGrade: Row[];
  RefGradeSpoke: Row[];
  RefGradeRate: Row[];
  RefProposition: Row[];
  RefProcess: Row[];
  RefQueueMap: Row[];
  RefResource: Row[];
  RefVDICostHistory: Row[];
  RefEstateCostHistory: Row[];
  RefPeopleCostHistory: Row[];
  RefExceptionType: Row[];
  RefAppSettings: Row[];
  RefVersion: Row[];
  RefChangeLog: Row[];
}

function makeStore(): Store {
  return {
    RefSpoke: [],
    RefGrade: [],
    RefGradeSpoke: [],
    RefGradeRate: [],
    RefProposition: [],
    RefProcess: [],
    RefQueueMap: [],
    RefResource: [],
    RefVDICostHistory: [],
    RefEstateCostHistory: [],
    RefPeopleCostHistory: [],
    RefExceptionType: [],
    RefAppSettings: [],
    RefVersion: [{ Id: 1, Version: 1, UpdatedAt: new Date().toISOString(), UpdatedBy: null }],
    RefChangeLog: [],
  };
}

/** A tiny, purpose-built interpreter for the FINITE, KNOWN set of query
 *  shapes server/src/data/sql-reference.ts issues (see that file's
 *  `.query(...)` call sites) -- not a general SQL engine. */
function execQuery(store: Store, rawText: string, inputs: Record<string, unknown>): { recordset: Row[] } {
  const text = rawText.trim();

  // RefAppSettings upsert (UPDATE ...; IF @@ROWCOUNT = 0 INSERT ...)
  if (/UPDATE core\.RefAppSettings SET ValueJson/i.test(text)) {
    const key = inputs.key as string;
    const value = inputs.value as string;
    const actor = inputs.actor as string;
    const existing = store.RefAppSettings.find((r) => r.SettingKey === key);
    if (existing) {
      existing.ValueJson = value;
      existing.UpdatedAt = new Date().toISOString();
      existing.UpdatedBy = actor;
    } else {
      store.RefAppSettings.push({ SettingKey: key, ValueJson: value, UpdatedAt: new Date().toISOString(), UpdatedBy: actor });
    }
    return { recordset: [] };
  }

  // RefVersion optimistic-concurrency bump
  if (/UPDATE core\.RefVersion SET Version = Version \+ 1/i.test(text)) {
    const row = store.RefVersion[0];
    row.Version = (row.Version as number) + 1;
    row.UpdatedAt = new Date().toISOString();
    row.UpdatedBy = inputs.actor;
    return { recordset: [] };
  }

  // SELECT ValueJson FROM core.RefAppSettings WHERE SettingKey = @key
  let m = text.match(/^SELECT ValueJson FROM core\.RefAppSettings WHERE SettingKey = @key$/i);
  if (m) {
    const row = store.RefAppSettings.find((r) => r.SettingKey === inputs.key);
    return { recordset: row ? [{ ValueJson: row.ValueJson }] : [] };
  }

  // SELECT TOP 1 <cols> FROM core.RefVersion WHERE Id = 1
  m = text.match(/^SELECT TOP 1 (.+) FROM core\.RefVersion WHERE Id = 1$/i);
  if (m) {
    const cols = m[1].split(",").map((c) => c.trim());
    const row = store.RefVersion[0];
    const projected: Row = {};
    for (const c of cols) projected[c] = row[c];
    return { recordset: [projected] };
  }

  // DELETE FROM core.Table
  m = text.match(/^DELETE FROM core\.(\w+)$/i);
  if (m) {
    const table = m[1] as keyof Store;
    (store[table] as Row[]).length = 0;
    return { recordset: [] };
  }

  // INSERT INTO core.Table (col1, col2, ...) VALUES (@a, @b, ...)
  m = text.match(/^INSERT INTO core\.(\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i);
  if (m) {
    const table = m[1] as keyof Store;
    const cols = m[2].split(",").map((c) => c.trim());
    const placeholders = m[3].split(",").map((c) => c.trim());
    const row: Row = {};
    cols.forEach((c, i) => {
      const ph = placeholders[i];
      row[c] = ph.startsWith("@") ? inputs[ph.slice(1)] : ph;
    });
    (store[table] as Row[]).push(row);
    return { recordset: [] };
  }

  // Generic SELECT col1, col2, ... FROM core.Table (no WHERE)
  m = text.match(/^SELECT (.+) FROM core\.(\w+)$/i);
  if (m) {
    const cols = m[1].split(",").map((c) => c.trim());
    const table = m[2] as keyof Store;
    const rows = (store[table] as Row[]).map((r) => {
      const projected: Row = {};
      for (const c of cols) projected[c] = r[c] ?? null;
      return projected;
    });
    return { recordset: rows };
  }

  throw new Error(`FakeDb: unhandled query shape: ${text}`);
}

function makeFakeDb(store: Store) {
  return {
    request: () => {
      const inputs: Record<string, unknown> = {};
      return {
        input(name: string, _type: unknown, value: unknown) {
          inputs[name] = value;
          return this;
        },
        query: (text: string) => Promise.resolve(execQuery(store, text, inputs)),
      };
    },
    transaction: () => ({
      _exec: (text: string, reqInputs: Record<string, unknown>) => execQuery(store, text, reqInputs),
      begin: async () => {},
      commit: async () => {},
      rollback: async () => {},
    }),
  };
}

// Mock mssql's `Request` class only (the one thing sql-reference.ts
// constructs directly, via `new sql.Request(tx)`, rather than through our
// fake Db's own `request()`/`transaction()` methods above) -- delegates
// straight back to whatever `tx` it's given, which is our own fake
// transaction object (see makeFakeDb, `_exec`). Type placeholders
// (Int/NVarChar/etc.) are inert markers: the fake engine ignores column
// types entirely and stores whatever raw value `.input()` was given.
vi.mock("mssql", () => {
  class FakeRequest {
    private inputs: Record<string, unknown> = {};
    constructor(private ctx: { _exec: (text: string, inputs: Record<string, unknown>) => unknown }) {}
    input(name: string, _type: unknown, value: unknown) {
      this.inputs[name] = value;
      return this;
    }
    query(text: string) {
      return Promise.resolve(this.ctx._exec(text, this.inputs));
    }
  }
  const typeFactory = (..._args: unknown[]) => ({});
  return {
    default: {
      Int: {},
      NVarChar: typeFactory,
      Decimal: typeFactory,
      Bit: {},
      Date: {},
      Char: typeFactory,
      MAX: "MAX",
      Request: FakeRequest,
    },
  };
});

const { SqlReferenceStore, writerColumnsFor } = await import("../src/data/sql-reference.js");
// (dynamic import, not a static one: vi.mock("mssql", ...) above is hoisted
//  above static imports too, but the dynamic form makes the load-order
//  dependency on the mock explicit here.)

function referenceFixture() {
  return {
    spokes: [{ spokeId: 1, spokeName: "Spoke A", shortName: "A", colorLight: "#000000", colorDark: "#000000" }],
    grades: [{ grade: "G1", gradeName: "Grade 1", spokeIds: ["1"] }],
    gradeRates: [{ grade: "G1", gradeName: "Grade 1", effectiveFrom: "2023-01-01", hourlyCostGBP: 10 }],
    propositions: [{ propositionId: 1, propositionName: "Prop 1", spokeId: 1 }],
    processes: [
      {
        processId: 1,
        processName: "Process 1",
        processAcronym: "P1",
        processDescription: "d",
        propositionId: 1,
        smvMinutes: 1,
        grade: "G1",
        isActive: true,
        icon: "form",
        tags: ["Onboarding", "Customer-facing"],
      },
      {
        processId: 2,
        processName: "Process 2",
        processAcronym: "P2",
        processDescription: "d2",
        propositionId: 1,
        smvMinutes: 2,
        grade: "G1",
        isActive: true,
        icon: "",
        tags: [],
      },
    ],
    queueMap: [{ queueName: "Q1", processId: 1, stageName: null, stageOrder: null }],
    resources: [
      {
        resourceName: "R1",
        botName: "B1",
        botAcronym: "B1",
        vdiName: "V1",
        costClass: "prod",
        spokeId: 1,
        activeFrom: "2023-01-01",
        activeTo: null,
        notes: null,
        isActive: true,
        renewalDate: "2023-01-01",
        annualCostGBP: null,
        licenseExpiryDate: null,
        status: "active",
      },
    ],
    vdiOperatingHoursPerDay: 20,
    vdiCostHistory: [{ costClass: "prod", effectiveFrom: "2023-01-01", annualCostPerVDIGBP: 100 }],
    estateCostHistory: [{ effectiveFrom: "2023-01-01", teamAnnualCostGBP: 100, workingDaysPerYear: 252, productiveHoursPerDay: 7.5 }],
    peopleCostHistory: [{ ownerId: "HUB", headcount: 1, annualCostGBP: 100, effectiveFrom: "2023-01-01" }],
    exceptionPatterns: [{ matchPattern: "%x%", exceptionType: "Business", priority: 1 }],
    exceptionDisplayCodes: {},
    targets: { completionPct: 0.95, exceptionRate: 0.06, systemRate: 0.03, costPerCase: 9, utilMin: 0.15, utilMax: 0.6, vdiStaleDays: 14 },
    thresholdOverrides: [],
    financeTargets: [],
  };
}

describe("SqlReferenceStore — process Icon/Tags round-trip", () => {
  let store: Store;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sqlStore: any;

  beforeEach(() => {
    store = makeStore();
    sqlStore = new SqlReferenceStore(makeFakeDb(store) as unknown as Db);
  });

  it("writes a reference with process icons/tags and reads it back identically", async () => {
    const reference = referenceFixture();
    await sqlStore.put({ reference, actor: "tester", section: "processes", expectedVersion: 1 });

    const snapshot = await sqlStore.get();

    expect(snapshot.reference.processes).toEqual(reference.processes);
    expect(snapshot.reference).toEqual(reference);

    // And no residual processExtras document from the retired stopgap.
    expect(store.RefAppSettings.some((r) => r.SettingKey === "processExtras")).toBe(false);
  });

  it("persists Icon/Tags as plain core.RefProcess columns (';'-joined tags, null when absent)", async () => {
    const reference = referenceFixture();
    await sqlStore.put({ reference, actor: "tester", section: "processes", expectedVersion: 1 });

    const p1 = store.RefProcess.find((r) => r.ProcessId === 1)!;
    expect(p1.Icon).toBe("form");
    expect(p1.Tags).toBe("Onboarding;Customer-facing");

    const p2 = store.RefProcess.find((r) => r.ProcessId === 2)!;
    expect(p2.Icon).toBeNull();
    expect(p2.Tags).toBeNull();
  });
});

describe("SqlReferenceStore — financeTargets & targets.fiscalYearStartMonth", () => {
  let store: Store;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sqlStore: any;

  beforeEach(() => {
    store = makeStore();
    sqlStore = new SqlReferenceStore(makeFakeDb(store) as unknown as Db);
  });

  it("round-trips financeTargets (incl. spokeId 'ESTATE') and targets.fiscalYearStartMonth through put() then get()", async () => {
    const base = referenceFixture();
    const reference = {
      ...base,
      targets: { ...base.targets, fiscalYearStartMonth: 1 },
      financeTargets: [
        { spokeId: "ESTATE", annualNetBenefitTargetGBP: 250000 },
        { spokeId: "1", annualNetBenefitTargetGBP: 100000 },
      ],
    };

    await sqlStore.put({ reference, actor: "tester", section: "finance", expectedVersion: 1 });
    const snapshot = await sqlStore.get();

    expect(snapshot.reference.financeTargets).toEqual(reference.financeTargets);
    expect(snapshot.reference.targets.fiscalYearStartMonth).toBe(1);
  });

  it("rejects a PUT with targets.fiscalYearStartMonth = 13 with a 400", async () => {
    const base = referenceFixture();
    const reference = { ...base, targets: { ...base.targets, fiscalYearStartMonth: 13 } };

    await expect(sqlStore.put({ reference, actor: "tester", section: "finance", expectedVersion: 1 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects a PUT with a negative financeTargets.annualNetBenefitTargetGBP with a 400", async () => {
    const base = referenceFixture();
    const reference = { ...base, financeTargets: [{ spokeId: "ESTATE", annualNetBenefitTargetGBP: -1 }] };

    await expect(sqlStore.put({ reference, actor: "tester", section: "finance", expectedVersion: 1 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("records a RefChangeLog entry naming the financeTargets section for a PUT that changes only financeTargets", async () => {
    const base = referenceFixture();
    const reference = { ...base, financeTargets: [{ spokeId: "ESTATE", annualNetBenefitTargetGBP: 300000 }] };

    await sqlStore.put({ reference, actor: "tester", section: "financeTargets", expectedVersion: 1 });

    expect(store.RefChangeLog).toContainEqual(expect.objectContaining({ Actor: "tester", Section: "financeTargets" }));
  });
});

describe("SqlReferenceStore — RefProcess writer column parity", () => {
  it("the server writer's RefProcess column list includes Icon and Tags", () => {
    expect(writerColumnsFor("RefProcess")).toEqual([
      "ProcessId",
      "ProcessName",
      "ProcessAcronym",
      "ProcessDescription",
      "PropositionId",
      "SMVMinutes",
      "GradeCode",
      "IsActive",
      "Icon",
      "Tags",
    ]);
  });

  // NOTE ON DESIGN: this reads src/reference/reference-store.ts AS TEXT and
  // regexes out the RefProcess insertStatement's column-list literal,
  // rather than importing exportReferenceSql() and reverse-engineering the
  // columns from its SQL output (which reference-order.test.ts already does
  // for TABLE ORDER). Parsing the literal directly is more precise for a
  // COLUMN LIST check: it doesn't require constructing a valid row to
  // produce non-empty INSERT output, and it fails loudly with a source
  // location if the call shape is ever restructured.
  it("spa-exporter-columns-in-sync: SPA exportReferenceSql's RefProcess columns match the server writer", () => {
    const here = fileURLToPath(new URL(".", import.meta.url));
    const spaPath = join(here, "..", "..", "src", "reference", "reference-store.ts");
    const spaSource = readFileSync(spaPath, "utf8");

    const match = spaSource.match(/insertStatement\(\s*["']RefProcess["'],\s*\[([^\]]*)\]/);
    if (!match) {
      throw new Error(
        "Could not locate the RefProcess insertStatement(...) call in src/reference/reference-store.ts's " +
          "exportReferenceSql() -- has it been restructured? Update this test's regex to match.",
      );
    }
    const spaColumns = match[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^["']|["']$/g, ""));

    const serverColumns = writerColumnsFor("RefProcess");

    const suggestedEdit = [
      '    insertStatement(',
      '      "RefProcess",',
      '      ["ProcessId", "ProcessName", "ProcessAcronym", "ProcessDescription", "PropositionId", "SMVMinutes", "GradeCode", "IsActive", "Icon", "Tags"],',
      '      reference.processes.map((p) => [',
      '        sqlNum(p.processId),',
      '        sqlStr(p.processName),',
      '        sqlStr(p.processAcronym),',
      '        sqlStr(p.processDescription),',
      '        sqlNum(p.propositionId),',
      '        sqlNum(p.smvMinutes),',
      '        sqlStr(p.grade),',
      '        sqlBit(p.isActive),',
      '        sqlStr(p.icon || null),',
      "        sqlStr(p.tags && p.tags.length ? p.tags.join(';') : null),",
      '      ]),',
      '    ),',
    ].join("\n");

    expect(
      spaColumns,
      "SPA-SIDE CHANGE NEEDED in src/reference/reference-store.ts's exportReferenceSql(): " +
        "the RefProcess insertStatement(...) column list (and its row-mapping) must include Icon and Tags, " +
        "matching the server writer (server/src/data/sql-reference.ts's TABLE_SPECS.RefProcess) exactly.\n\n" +
        `  Server writer columns (expected) : [${serverColumns.join(", ")}]\n` +
        `  SPA exporter columns (found)     : [${spaColumns.join(", ")}]\n\n` +
        "Replace the RefProcess insertStatement(...) call in exportReferenceSql() with:\n\n" +
        suggestedEdit +
        "\n",
    ).toEqual(serverColumns);
  });
});
