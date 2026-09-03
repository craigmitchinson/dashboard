import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { DATE_MAX } from "../rpaData";
import { IconDownload } from "./icons";
import { Segmented } from "./viz";

// ---------------------------------------------------------------------------
// components/PageActions.tsx — nav/motion P1
// ---------------------------------------------------------------------------
// Building blocks for a page's contextual header-actions slot (see the
// `Page.actions` field and its doc comment in src/App.tsx). A page owner
// wires one up like:
//
//   function ExceptionsActions() {
//     return <ExportCsvButton filename="exceptions" rows={() => buildRows()} />;
//   }
//   { id: "exceptions", ..., actions: ExceptionsActions }
//
// None of the existing PAGES entries in App.tsx set `actions` yet — that's
// the next pass, done by each page's own owner, not part of this task.
// Every control here is a static 32px height (same recipe as App.tsx's
// header `btn(t)` helper, duplicated locally the same way
// HeaderOverflowMenu.tsx's own `btnBase(t)` duplicates it — App.tsx doesn't
// export `btn`, and shouldn't just for this) and disappears below a 1200px
// `.report__main` container width until a real overflow-menu integration
// for page actions is built (see the `.hdr-page-actions` container-query
// rule in styles.css).
// ---------------------------------------------------------------------------

function actionBtnStyle(t: ReturnType<typeof useTheme>): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    height: "var(--control-h)",
    padding: "0 12px",
    borderRadius: "var(--r-control)",
    cursor: "pointer",
    fontWeight: 700,
    border: `1px solid ${t.ruleSoft}`,
    background: "transparent",
    color: t.inkSoft,
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  };
}

export function ActionButton({
  children,
  onClick,
  icon,
  className,
  style,
  ...rest
}: { children: ReactNode; onClick?: () => void; icon?: ReactNode } & ComponentPropsWithoutRef<"button">) {
  const t = useTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      // className carries "bar-btn" for the shared background-tint hover
      // transition (see styles.css) — the same class every header control
      // in App.tsx already uses for that.
      className={`bar-btn${className ? ` ${className}` : ""}`}
      style={{ ...actionBtnStyle(t), ...style }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

// RFC-4180-ish CSV serialisation: header from `columns` if given, else the
// keys of the first row; a value is quoted only when it contains a comma,
// a double quote or a newline (internal quotes doubled per the spec),
// everything else passes through unquoted; null/undefined become an empty
// field. No trailing newline, `\n` line endings, no BOM — matches this app's
// one existing consumer (ExportCsvButton below) byte-for-byte.
//
// Formula-injection hardening: a spreadsheet app (Excel/Sheets) that opens
// this file treats a cell starting with `=`, `+`, `-`, `@`, a tab or a
// carriage return as a formula to evaluate, not literal text — dangerous
// when a value came from user-editable reference data or an exception
// reason string. Any STRING value starting with one of those characters
// gets a leading `'` (the spreadsheet convention for "force text"), added
// before the comma/quote/newline quoting decision above so the apostrophe
// itself never triggers unnecessary quoting. Trade-off, deliberately
// accepted: a number is emitted raw and is never prefixed (`-3` as a numeric
// cell renders as `-3`, exactly as before) because a real number can't be a
// formula; but a numeric-LOOKING string (e.g. the JS string `"-5"`, as
// opposed to the number `-5`) IS a string as far as this function can tell,
// so it gets the apostrophe like any other leading-`-` string and renders as
// `'-5` — visibly different from a plain numeric column. Callers that need
// a leading-`-`/`+` string to render unprefixed should pass it as a number
// instead.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function buildCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const headers = columns ?? Object.keys(rows[0] ?? {});
  if (!headers.length) return "";
  const escape = (v: unknown) => {
    if (v == null) return "";
    let s = String(v);
    if (typeof v === "string" && FORMULA_LEAD.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))];
  return lines.join("\n");
}

// `dateIso` is any ISO-8601 string (full timestamp or already a bare date);
// only the leading YYYY-MM-DD is used, matching how ExportCsvButton below has
// always derived its filename date suffix from DATE_MAX's ISO string.
export function csvFilename(base: string, dateIso: string): string {
  return `${base}-${dateIso.slice(0, 10)}.csv`;
}

export function ExportCsvButton({ filename, rows }: { filename: string; rows: () => Record<string, unknown>[] }) {
  const handleClick = () => {
    const data = rows();
    if (!data.length) return; // nothing to export — don't hand back a blank file
    const csv = buildCsv(data);
    // DATE_MAX is a UTC-midnight timestamp (see rpaData.ts's `tsOf`), so its
    // ISO string's leading YYYY-MM-DD is always exactly the data-through
    // date — filename-safe with no further formatting needed.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = csvFilename(filename, new Date(DATE_MAX).toISOString());
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <ActionButton onClick={handleClick} icon={<IconDownload size={13} />}>
      Export CSV
    </ActionButton>
  );
}

// Thin wrapper over viz.tsx's own exported `Segmented` — that component
// already exists and already carries the right 32px look, so there is no
// second design system here, just a page-actions-flavoured name for it.
export function GrainToggle({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return <Segmented<string> options={options} value={value} onChange={onChange} />;
}
