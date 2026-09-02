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

export function ExportCsvButton({ filename, rows }: { filename: string; rows: () => Record<string, unknown>[] }) {
  const handleClick = () => {
    const data = rows();
    if (!data.length) return; // nothing to export — don't hand back a blank file
    const headers = Object.keys(data[0] ?? {});
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(","), ...data.map((row) => headers.map((h) => escape(row[h])).join(","))];
    const csv = lines.join("\n");
    // DATE_MAX is a UTC-midnight timestamp (see rpaData.ts's `tsOf`), so
    // slicing its ISO string is always exactly the data-through YYYY-MM-DD —
    // filename-safe with no further formatting needed.
    const dateSuffix = new Date(DATE_MAX).toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}-${dateSuffix}.csv`;
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
