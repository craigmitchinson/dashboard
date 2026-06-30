import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { IconDots, IconExpand } from "./icons";

// ---------------------------------------------------------------------------
// Visual toolkit for the report. Every page composes these so the look is
// defined once. Charts are hand-drawn SVG — deliberately minimal, no chart
// junk: one accent, light gridlines, clear axis labels.
// ---------------------------------------------------------------------------

// --- palette ---------------------------------------------------------------
export function useViz() {
  const t = useTheme();
  return {
    t,
    ink: t.ink,
    soft: t.inkSoft,
    faint: t.inkFaint,
    grid: t.ruleSoft,
    accent: t.accent,
    surface: t.paper,
    band: t.themeBand,
    // outcome semantics (reuse the deck's good / neutral / bad status palette)
    completed: t.status.committed.dot,
    business: t.status["not-committed"].dot,
    system: t.status.blocked.dot,
    good: t.status.committed.dot,
    bad: t.status.blocked.dot,
  };
}

// --- formatters ------------------------------------------------------------
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
export const fmtCompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(n));
};
export const fmtPct = (x: number, dp = 1) => (x * 100).toFixed(dp) + "%";
export const fmtGBP = (n: number) =>
  "£" + Math.round(n).toLocaleString("en-GB");
export const fmtGBPc = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return "£" + (n / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return "£" + (n / 1e3).toFixed(1) + "k";
  return "£" + n.toFixed(2);
};
export const fmtMoney2 = (n: number) => "£" + n.toFixed(2);
export const fmtHours = (n: number) => fmtCompact(n) + " h";

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * mag;
}

// --- container sizing ------------------------------------------------------
export function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setS({ w: e[0].contentRect.width, h: e[0].contentRect.height }));
    ro.observe(ref.current);
    setS({ w: ref.current.clientWidth, h: ref.current.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, s] as const;
}

// --- visual card (a Power BI "visual" frame) -------------------------------
export function VisualCard({
  title,
  subtitle,
  right,
  children,
  className,
  style,
  pad = true,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  pad?: boolean;
}) {
  const t = useTheme();
  return (
    <section
      className={`viz-card${className ? " " + className : ""}`}
      style={{
        background: `linear-gradient(168deg, ${t.paper}, ${t.themeBand})`,
        border: `1px solid ${t.ruleSoft}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        ...style,
      }}
    >
      <header style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px 8px" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, fontFamily: fonts.display, fontSize: 16, fontWeight: 700, color: t.ink, lineHeight: 1.2 }}>{title}</h3>
          {subtitle && (
            <div style={{ marginTop: 2, fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, lineHeight: 1.3 }}>{subtitle}</div>
          )}
        </div>
        {right}
        <div className="viz-card__icons" style={{ display: "flex", gap: 4, color: t.inkSoft, flex: "0 0 auto" }}>
          <span title="Focus mode" style={{ display: "grid", placeItems: "center", cursor: "default" }}><IconExpand size={14} /></span>
          <span title="More options" style={{ display: "grid", placeItems: "center", cursor: "default" }}><IconDots size={14} /></span>
        </div>
      </header>
      <div style={{ flex: 1, minHeight: 0, padding: pad ? "0 14px 14px" : 0, display: "flex", flexDirection: "column" }}>{children}</div>
    </section>
  );
}

// --- KPI card --------------------------------------------------------------
export function KpiCard({
  label,
  value,
  sub,
  accent,
  delta,
  deltaGood = "up",
  spark,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  delta?: number; // fractional change vs previous
  deltaGood?: "up" | "down";
  spark?: number[];
}) {
  const t = useTheme();
  return (
    <div
      className="tile-lift kpi-card"
      style={{
        background: `linear-gradient(165deg, ${t.paper}, ${t.themeBand})`,
        border: `1px solid ${t.ruleSoft}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: 12,
        padding: "13px 15px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      <span style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.09em", textTransform: "uppercase", color: t.inkSoft, fontWeight: 600 }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: fonts.display, fontSize: 33, fontWeight: 700, lineHeight: 1.02, color: t.ink }}>{value}</span>
        {spark && <Sparkline data={spark} color={accent} />}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 16 }}>
        {delta !== undefined && <Delta value={delta} good={deltaGood} />}
        {sub && <span style={{ fontFamily: fonts.body, fontSize: 12, color: t.inkSoft }}>{sub}</span>}
      </span>
    </div>
  );
}

export function Delta({ value, good = "up" }: { value: number; good?: "up" | "down" }) {
  const v = useViz();
  if (!isFinite(value)) return null;
  const up = value >= 0;
  const positive = good === "up" ? up : !up;
  const c = Math.abs(value) < 0.001 ? v.soft : positive ? v.good : v.bad;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: fonts.mono, fontSize: 11.5, fontWeight: 700, color: c }}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {fmtPct(Math.abs(value), 1)}
    </span>
  );
}

// --- legend ----------------------------------------------------------------
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center" }}>
      {items.map((i) => (
        <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: fonts.body, fontSize: 12, color: t.inkSoft }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: i.color, flex: "0 0 auto" }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// --- sparkline -------------------------------------------------------------
export function Sparkline({ data, color, w = 60, h = 24 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - 3) + 1.5, h - 2 - ((v - min) / span) * (h - 4)] as const);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden style={{ flex: "0 0 auto" }}>
      <path d={`${d} L${w - 1.5} ${h} L1.5 ${h} Z`} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} />
    </svg>
  );
}

// --- line chart ------------------------------------------------------------
export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
  area?: boolean;
}
export function LineChart({
  labels,
  series,
  height,
  yFormat = fmtCompact,
  tipFormat = fmtInt,
  yLabel,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  yFormat?: (n: number) => string;
  tipFormat?: (n: number) => string;
  yLabel?: string;
}) {
  const v = useViz();
  const [ref, size] = useSize();
  const w = size.w;
  const H = height ?? size.h;
  const [hi, setHi] = useState<number | null>(null);

  const padL = 46;
  const padR = 14;
  const padT = 10;
  const padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = Math.max(10, H - padT - padB);
  const n = labels.length;

  // don't floor to 1 — that breaks small-magnitude series (e.g. £0.09 cost/case)
  const rawMax = Math.max(0, ...series.flatMap((s) => s.values));
  const top = niceMax(rawMax);
  const x = (i: number) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (val: number) => padT + ih - (val / top) * ih;
  const ticks = 4;

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left - padL;
    const idx = Math.round((px / iw) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, idx)));
  };

  // thin x labels so they never collide
  const step = Math.ceil(n / Math.max(2, Math.floor(iw / 64)));

  return (
    <div ref={ref} style={{ width: "100%", height: height ?? "100%", minHeight: 0, position: "relative" }}>
      {w > 0 && H > 0 && (
        <svg width={w} height={H} style={{ display: "block", fontFamily: fonts.mono }}>
          {/* gridlines + y labels */}
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const val = (top / ticks) * i;
            const yy = y(val);
            return (
              <g key={i}>
                <line x1={padL} x2={w - padR} y1={yy} y2={yy} stroke={v.grid} strokeWidth={1} />
                <text x={padL - 7} y={yy + 3} textAnchor="end" fontSize={10} fill={v.soft}>{yFormat(val)}</text>
              </g>
            );
          })}
          {/* x labels — step through, always show the last, and drop the
              penultimate step label if it would collide with the last one */}
          {labels.map((l, i) => {
            const isLast = i === n - 1;
            const isStep = i % step === 0 && n - 1 - i >= step * 0.6;
            if (!isStep && !isLast) return null;
            const anchor = isLast ? "end" : "middle";
            return (
              <text key={i} x={isLast ? w - padR : x(i)} y={H - 9} textAnchor={anchor} fontSize={10} fill={v.soft}>{l}</text>
            );
          })}
          {/* series */}
          {series.map((s) => {
            const dPts = s.values.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join(" ");
            return (
              <g key={s.name}>
                {s.area && <path d={`${dPts} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={s.color} opacity={0.1} />}
                <path d={dPts} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? "5 5" : undefined} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}
          {/* hover guide */}
          {hi !== null && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={padT} y2={padT + ih} stroke={v.soft} strokeWidth={1} strokeDasharray="3 3" />
              {series.map((s) => (
                <circle key={s.name} cx={x(hi)} cy={y(s.values[hi])} r={3.4} fill={v.surface} stroke={s.color} strokeWidth={2} />
              ))}
            </g>
          )}
          {yLabel && (
            <text x={12} y={padT + ih / 2} textAnchor="middle" fontSize={10} fill={v.soft} transform={`rotate(-90 12 ${padT + ih / 2})`}>{yLabel}</text>
          )}
          <rect x={padL} y={padT} width={iw} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHi(null)} />
        </svg>
      )}
      {hi !== null && w > 0 && (
        <Tooltip x={x(hi)} chartW={w} title={labels[hi]} rows={series.map((s) => ({ label: s.name, value: tipFormat(s.values[hi]), color: s.color }))} />
      )}
    </div>
  );
}

function Tooltip({ x, chartW, title, rows }: { x: number; chartW: number; title: string; rows: { label: string; value: string; color: string }[] }) {
  const t = useTheme();
  const left = Math.min(Math.max(x + 12, 8), chartW - 168);
  return (
    <div
      style={{
        position: "absolute",
        top: 6,
        left,
        width: 156,
        pointerEvents: "none",
        background: t.paper,
        border: `1px solid ${t.ruleSoft}`,
        boxShadow: t.shadow,
        borderRadius: 9,
        padding: "8px 10px",
        zIndex: 5,
      }}
    >
      <div style={{ fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.05em", color: t.inkSoft, marginBottom: 5 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flex: "0 0 auto" }} />
          <span style={{ fontFamily: fonts.body, fontSize: 12, color: t.ink, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <span style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// --- horizontal bar chart --------------------------------------------------
export function HBarChart({
  rows,
  valueFormat = fmtCompact,
  barColor,
  height,
}: {
  rows: { label: string; value: number; sub?: string; color?: string }[];
  valueFormat?: (n: number) => string;
  barColor?: string;
  height?: number | string;
}) {
  const v = useViz();
  const max = niceMax(Math.max(1, ...rows.map((r) => r.value)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, height: height ?? "100%", minHeight: 0, justifyContent: rows.length > 1 ? "space-between" : "flex-start" }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "grid", gridTemplateColumns: "150px 1fr 64px", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: fonts.body, fontSize: 12.5, color: v.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.label}>{r.label}</span>
          <span style={{ height: 16, background: v.grid, borderRadius: 4, overflow: "hidden", position: "relative" }}>
            <span style={{ position: "absolute", inset: 0, width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color ?? barColor ?? v.accent, borderRadius: 4 }} />
            {r.sub && <span style={{ position: "absolute", right: 6, top: 0, lineHeight: "16px", fontFamily: fonts.mono, fontSize: 10, color: v.soft }}>{r.sub}</span>}
          </span>
          <span style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: v.ink, textAlign: "right" }}>{valueFormat(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// --- sortable / searchable table -------------------------------------------
export interface Column<T> {
  key: keyof T & string;
  header: string;
  align?: "left" | "right";
  width?: number;
  render?: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string;
}
export function DataTable<T extends { [k: string]: any }>({
  columns,
  rows,
  initialSort,
  maxBodyHeight,
}: {
  columns: Column<T>[];
  rows: T[];
  initialSort?: { key: string; dir: "asc" | "desc" };
  maxBodyHeight?: number;
}) {
  const t = useTheme();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>(initialSort ?? { key: columns[0].key, dir: "asc" });

  const col = columns.find((c) => c.key === sort.key) ?? columns[0];
  const sorted = [...rows].sort((a, b) => {
    const va = col.sortValue ? col.sortValue(a) : a[col.key];
    const vb = col.sortValue ? col.sortValue(b) : b[col.key];
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div style={{ overflow: "auto", height: "100%", maxHeight: maxBodyHeight, border: `1px solid ${t.ruleSoft}`, borderRadius: 9 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                onClick={() => toggle(c.key)}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: t.paper,
                  textAlign: c.align ?? "left",
                  padding: "9px 12px",
                  fontFamily: fonts.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: sort.key === c.key ? t.ink : t.inkSoft,
                  fontWeight: 700,
                  borderBottom: `1px solid ${t.ruleSoft}`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  width: c.width,
                }}
              >
                {c.header}
                <span style={{ opacity: sort.key === c.key ? 1 : 0.25, marginLeft: 5 }}>{sort.key === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? t.themeBand : "transparent" }}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.align ?? "left",
                    padding: "8px 12px",
                    fontSize: 12.5,
                    color: t.ink,
                    borderBottom: `1px solid ${t.ruleSoft}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.render ? c.render(r) : String(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ padding: "22px 12px", textAlign: "center", color: t.inkSoft, fontSize: 13 }}>No rows for the current filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --- search box ------------------------------------------------------------
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const t = useTheme();
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Search…"}
      className="viz-search"
      style={{
        fontFamily: fonts.body,
        fontSize: 12.5,
        padding: "6px 10px",
        borderRadius: 7,
        border: `1px solid ${t.ruleSoft}`,
        background: t.themeBand,
        color: t.ink,
        outline: "none",
        width: 190,
      }}
    />
  );
}

// --- mini bar (for inline cells) -------------------------------------------
export function CellBar({ value, max, color }: { value: number; max: number; color: string }) {
  const v = useViz();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, width: "100%", justifyContent: "flex-end" }}>
      <span style={{ flex: 1, height: 7, background: v.grid, borderRadius: 3, overflow: "hidden", maxWidth: 90 }}>
        <span style={{ display: "block", height: "100%", width: `${Math.max(2, (value / (max || 1)) * 100)}%`, background: color, borderRadius: 3 }} />
      </span>
      <span style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 700 }}>{fmtPct(value, 0)}</span>
    </span>
  );
}

// Page body: fills the fixed report canvas (no scroll) and animates in. Rows
// flagged flex:1 share the remaining height so every page fits a 16:9 page.
export function PageGrid({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="anim-up" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 12, ...style }}>
      {children}
    </div>
  );
}

// A row of equal-height visuals that grows to fill leftover canvas height.
export function Row({ cols, children, grow = true, style }: { cols: string; children: ReactNode; grow?: boolean; style?: CSSProperties }) {
  return (
    <div style={{ flex: grow ? 1 : "0 0 auto", minHeight: 0, display: "grid", gridTemplateColumns: cols, gap: 12, ...style }}>
      {children}
    </div>
  );
}
