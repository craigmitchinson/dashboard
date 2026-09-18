// ---------------------------------------------------------------------------
// validate-workqueue-csv.mjs
// ---------------------------------------------------------------------------
// Checks a BPAWorkQueueItem-shaped CSV against docs/DATA-CONTRACT.md BEFORE
// you spend a `npm run data:build` cycle finding out something is wrong.
// This is a pre-flight check only: it does not write anything, and it makes
// its own independent judgement about the file — it does not call into
// tools/build-dashboard-data.mjs (which silently drops/nulls bad data rather
// than reporting it).
//
// Usage: npm run data:validate -- path/to/your.csv
//        node tools/validate-workqueue-csv.mjs path/to/your.csv
//        (no path -> validates data/mock/BPAWorkQueueItem.csv)
//
// Exit code: 1 if any row has an ERROR, 0 if clean or warnings-only.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const HEADER = [
  "ID", "KeyValue", "Priority", "Status", "Tags", "Resource", "Attempt",
  "LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate", "CompletedDate",
  "Worktime", "ExceptionDate", "ExceptionReason", "QueueName",
];

// Vocabulary observed in the mock generator / accepted by the dashboard's
// mental model of a work item's state. The build script does NOT actually
// branch on this text (it derives outcome from which date columns are
// populated — see docs/DATA-CONTRACT.md rule 3), so an unrecognised Status
// will not break `data:build`, but it usually means the export or the field
// mapping is wrong, so this validator treats it as an error.
export const STATUS_VOCAB = new Set(["Completed", "Exception", "Pending", "Deferred"]);

const DATE_COLUMNS = ["LoadedDate", "LastUpdatedDate", "DeferredDate", "LockedDate", "CompletedDate", "ExceptionDate"];

// --- RFC-4180 CSV parser (small, dependency-free copy of the one in
// tools/build-dashboard-data.mjs — that file exports nothing, so this is an
// independent parser kept behaviour-identical on purpose) -------------------
export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Same date acceptance rule as tools/build-dashboard-data.mjs's parseDt:
// "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (space or 'T' separator,
// UTC assumed — a 'Z' is appended before parsing, so a value that already
// carries its own timezone offset will NOT parse cleanly).
// Returns: { blank: true } | { blank: false, ok: true, ts } | { blank: false, ok: false }
export function classifyDate(raw) {
  const s = (raw ?? "").trim();
  if (!s) return { blank: true };
  const ts = Date.parse(s.replace(" ", "T") + "Z");
  return Number.isNaN(ts) ? { blank: false, ok: false } : { blank: false, ok: true, ts };
}

function isIntString(s) {
  return /^-?\d+$/.test((s ?? "").trim());
}

// --- row-level check --------------------------------------------------------
// Pure function: one row's fields (already keyed by header name) in, a list
// of { level: "error"|"warning", code, message } issues out. Takes no line
// number / file context, so it's directly unit-testable on inline samples
// (see tests/validate-csv.test.ts). File-grain checks that need the WHOLE
// file (ID uniqueness) are done by the caller, not here.
export function checkRow(fields, { queueNames } = {}) {
  const issues = [];
  const err = (code, message) => issues.push({ level: "error", code, message });
  const warn = (code, message) => issues.push({ level: "warning", code, message });

  const id = (fields.ID ?? "").trim();
  if (!id) err("ID_BLANK", "ID is blank");

  for (const col of DATE_COLUMNS) {
    const d = classifyDate(fields[col]);
    if (!d.blank && !d.ok) err("DATE_UNPARSEABLE", `${col} is not a parseable date/time: "${fields[col]}"`);
  }

  const worktimeRaw = (fields.Worktime ?? "").trim();
  if (worktimeRaw !== "") {
    if (!isIntString(worktimeRaw) || Number(worktimeRaw) < 0) {
      err("WORKTIME_INVALID", `Worktime must be a whole number of seconds >= 0, got "${fields.Worktime}"`);
    }
  } else {
    err("WORKTIME_INVALID", "Worktime is blank (must be a whole number of seconds >= 0)");
  }

  const status = (fields.Status ?? "").trim();
  if (!status) err("STATUS_INVALID", "Status is blank");
  else if (!STATUS_VOCAB.has(status)) err("STATUS_INVALID", `Status "${status}" is not one of: ${[...STATUS_VOCAB].join(", ")}`);

  const attemptRaw = (fields.Attempt ?? "").trim();
  if (attemptRaw !== "") {
    if (!isIntString(attemptRaw) || Number(attemptRaw) < 1) {
      err("ATTEMPT_INVALID", `Attempt must be a whole number >= 1, got "${fields.Attempt}"`);
    }
  } else {
    err("ATTEMPT_INVALID", "Attempt is blank (must be a whole number >= 1)");
  }

  const queueName = (fields.QueueName ?? "").trim();
  if (!queueName) err("QUEUE_BLANK", "QueueName is blank");
  else if (queueNames && !queueNames.has(queueName)) warn("QUEUE_UNMAPPED", `QueueName "${queueName}" is not in reference.json queueMap`);

  const loaded = classifyDate(fields.LoadedDate);
  const completed = classifyDate(fields.CompletedDate);
  if (loaded.ok && completed.ok && completed.ts < loaded.ts) {
    warn("COMPLETED_BEFORE_LOADED", `CompletedDate (${fields.CompletedDate}) is earlier than LoadedDate (${fields.LoadedDate})`);
  }

  const exceptionDate = classifyDate(fields.ExceptionDate);
  const isExceptionStatus = status === "Exception";
  if (isExceptionStatus && exceptionDate.blank) {
    warn("EXCEPTION_DATE_MISSING", 'Status is "Exception" but ExceptionDate is blank');
  } else if (!isExceptionStatus && !exceptionDate.blank) {
    warn("EXCEPTION_DATE_UNEXPECTED", `Status is "${status || "(blank)"}" but ExceptionDate is set (${fields.ExceptionDate})`);
  }

  return issues;
}

// --- header check -------------------------------------------------------------
export function checkHeader(header) {
  const trimmed = header.map((h) => h.trim());
  const missing = HEADER.filter((h) => !trimmed.includes(h));
  const extra = trimmed.filter((h) => !HEADER.includes(h));
  const orderOk = missing.length === 0 && extra.length === 0 && HEADER.every((h, i) => trimmed[i] === h);
  return { ok: missing.length === 0 && extra.length === 0 && orderOk, missing, extra, misordered: missing.length === 0 && extra.length === 0 && !orderOk, actual: trimmed };
}

// --- full-file validation -----------------------------------------------------
export function validateCsvText(text, { queueNames } = {}) {
  const raw = parseCsv(text);
  if (raw.length === 0) {
    return { headerCheck: { ok: false, missing: HEADER, extra: [], misordered: false, actual: [] }, rows: 0, valid: 0, rejected: 0, warned: 0, errorTotals: new Map(), warningTotals: new Map(), examples: new Map(), duplicateIds: [], duplicateCount: 0 };
  }
  const header = raw[0];
  const headerCheck = checkHeader(header);

  const errorTotals = new Map(); // code -> count
  const warningTotals = new Map();
  const examples = new Map(); // code -> [{line, message}]
  const idCounts = new Map(); // id -> [lineNos]
  let valid = 0, rejected = 0, warned = 0;

  const addExample = (code, line, message) => {
    let list = examples.get(code);
    if (!list) examples.set(code, (list = []));
    if (list.length < 3) list.push({ line, message });
  };

  const rowCount = raw.length - 1;
  if (headerCheck.ok) {
    for (let i = 1; i < raw.length; i++) {
      const lineNo = i + 1; // +1 for 1-based, header is line 1
      const r = raw[i];
      const fields = Object.fromEntries(header.map((h, idx) => [h.trim(), r[idx] ?? ""]));
      const id = (fields.ID ?? "").trim();
      if (id) {
        let list = idCounts.get(id);
        if (!list) idCounts.set(id, (list = []));
        list.push(lineNo);
      }
      const issues = checkRow(fields, { queueNames });
      let hasError = false, hasWarning = false;
      for (const issue of issues) {
        if (issue.level === "error") {
          hasError = true;
          errorTotals.set(issue.code, (errorTotals.get(issue.code) ?? 0) + 1);
          addExample(issue.code, lineNo, issue.message);
        } else {
          hasWarning = true;
          warningTotals.set(issue.code, (warningTotals.get(issue.code) ?? 0) + 1);
          addExample(issue.code, lineNo, issue.message);
        }
      }
      if (hasError) rejected++; else valid++;
      if (hasWarning) warned++;
    }
  }

  const duplicateIds = [...idCounts.entries()].filter(([, lines]) => lines.length > 1);
  if (duplicateIds.length) {
    errorTotals.set("ID_DUPLICATE", duplicateIds.reduce((s, [, lines]) => s + lines.length, 0));
    for (const [id, lines] of duplicateIds.slice(0, 3)) addExample("ID_DUPLICATE", lines[0], `ID "${id}" appears on lines ${lines.join(", ")}`);
  }

  return {
    headerCheck,
    rows: headerCheck.ok ? rowCount : 0,
    valid,
    rejected: rejected + (headerCheck.ok ? 0 : rowCount),
    warned,
    errorTotals,
    warningTotals,
    examples,
    duplicateIds: duplicateIds.map(([id, lines]) => ({ id, lines })),
    duplicateCount: duplicateIds.length,
  };
}

// --- CLI ----------------------------------------------------------------------
function main() {
  const CSV_PATH = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : join(root, "data", "mock", "BPAWorkQueueItem.csv");
  const REF_PATH = join(root, "data", "reference", "reference.json");

  let text;
  try {
    const buf = readFileSync(CSV_PATH);
    // A UTF-8 file must not contain the byte sequences that indicate UTF-16;
    // readFileSync + toString('utf8') will silently mangle those, so warn
    // plainly instead of producing confusing downstream errors.
    if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
      console.error(`ERROR: ${CSV_PATH} looks like UTF-16 (has a UTF-16 byte-order mark). Re-save it as UTF-8.`);
      process.exit(1);
    }
    text = buf.toString("utf8");
  } catch (e) {
    console.error(`ERROR: could not read ${CSV_PATH}: ${e.message}`);
    process.exit(1);
  }

  let queueNames = null;
  try {
    const ref = JSON.parse(readFileSync(REF_PATH, "utf8"));
    queueNames = new Set(ref.queueMap.map((q) => q.queueName));
  } catch (e) {
    console.warn(`WARNING: could not read ${REF_PATH} (${e.message}) — skipping the QueueName-mapped check`);
  }

  const report = validateCsvText(text, { queueNames });

  console.log(`Validating: ${CSV_PATH}`);
  if (!report.headerCheck.ok) {
    console.log(`\nHEADER: FAILED`);
    if (report.headerCheck.missing.length) console.log(`  missing columns: ${report.headerCheck.missing.join(", ")}`);
    if (report.headerCheck.extra.length) console.log(`  unexpected extra columns: ${report.headerCheck.extra.join(", ")}`);
    if (report.headerCheck.misordered) console.log(`  columns present but out of order. Expected: ${HEADER.join(", ")}`);
    console.log(`  found:    ${report.headerCheck.actual.join(", ")}`);
    console.log(`\nFAILED — fix the header before re-running.`);
    process.exit(1);
  }
  console.log(`HEADER: OK (16 columns, correct order)`);

  console.log(`\nSUMMARY`);
  console.log(`  rows checked: ${report.rows}`);
  console.log(`  valid (no errors): ${report.valid}`);
  console.log(`  rejected (>=1 error): ${report.rejected}`);
  console.log(`  rows with warnings: ${report.warned}`);

  const printTotals = (title, totals) => {
    if (totals.size === 0) return;
    console.log(`\n${title}`);
    for (const [code, count] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count}`);
      for (const ex of report.examples.get(code) ?? []) console.log(`    line ${ex.line}: ${ex.message}`);
    }
  };
  printTotals("ERRORS", report.errorTotals);
  printTotals("WARNINGS", report.warningTotals);

  if (report.errorTotals.size === 0 && report.warningTotals.size === 0) console.log(`\nNo issues found.`);

  const hasErrors = report.errorTotals.size > 0;
  console.log(`\n${hasErrors ? "FAILED" : "PASSED"} — exit code ${hasErrors ? 1 : 0}`);
  process.exit(hasErrors ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
