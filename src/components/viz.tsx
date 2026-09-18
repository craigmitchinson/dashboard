import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { fonts, type, space, radius, controlHeight, glassOverlayVars } from "../theme";
import { useTheme } from "../theme-context";
import { useDisplayPrefs } from "../a11y/prefs-context";
import "../styles/primitives.css";

// ---------------------------------------------------------------------------
// Visual toolkit for the report. Every page composes these so the look is
// defined once. Charts are hand-drawn SVG — deliberately minimal, no chart
// junk: one accent, light gridlines, clear axis labels.
// ---------------------------------------------------------------------------

// --- palette ---------------------------------------------------------------
export function useViz() {
  const t = useTheme();
  const { prefs } = useDisplayPrefs();
  const cvd = prefs.colorVisionSafe;
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
    // — swapped for the Okabe-Ito colour-blind-safe palette when the user's
    // colour-vision-safe display preference is on.
    completed: cvd ? "#009E73" : t.status.committed.dot,
    business: cvd ? "#E69F00" : t.status["not-committed"].dot,
    system: cvd ? "#D55E00" : t.status.blocked.dot,
    good: cvd ? "#009E73" : t.status.committed.dot,
    bad: cvd ? "#D55E00" : t.status.blocked.dot,
  };
}

// --- formatters ------------------------------------------------------------
// Shared rule across every formatter below: NaN/+Infinity/-Infinity all
// render as "—" (a plain guard, not a per-formatter special case) — a
// dashboard number that failed to compute should read as "we don't have
// this", never as a leaked "£NaN"/"£∞". Every money formatter additionally
// keeps a negative sign BEFORE the currency symbol (`-£382.7k`, `-£53,320`,
// `-£10.24`), never `£-...`. Compact money/number forms keep one forced
// decimal at k/M magnitude (£382.7k, £1.0M — the .0 is never dropped) and no
// forced decimal below 1k (£950); full (non-compact) forms are
// thousands-grouped with no decimals (£53,320) unless |n| < 100, in which
// case pence are shown (£10.24) — fmtNum follows the exact same full/compact
// split as fmtMoney, just without the £ symbol.
const NON_FINITE = "—";

export const fmtInt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-GB") : NON_FINITE);
export const fmtCompact = (n: number) => {
  if (!Number.isFinite(n)) return NON_FINITE;
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(n));
};
export const fmtPct = (x: number, dp = 1) => (Number.isFinite(x) ? (x * 100).toFixed(dp) + "%" : NON_FINITE);
export const fmtGBP = (n: number) => {
  if (!Number.isFinite(n)) return NON_FINITE;
  return (n < 0 ? "-" : "") + "£" + Math.round(Math.abs(n)).toLocaleString("en-GB");
};
export const fmtGBPc = (n: number) => {
  if (!Number.isFinite(n)) return NON_FINITE;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return sign + "£" + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return sign + "£" + (a / 1e3).toFixed(1) + "k";
  return sign + "£" + a.toFixed(2);
};
export const fmtMoney2 = (n: number) => {
  if (!Number.isFinite(n)) return NON_FINITE;
  return (n < 0 ? "-" : "") + "£" + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const fmtHours = (n: number) => (Number.isFinite(n) ? fmtCompact(n) + " h" : NON_FINITE);

export function fmtMoney(n: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(n)) return NON_FINITE;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (opts?.compact) {
    if (a >= 1e6) return sign + "£" + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + "£" + (a / 1e3).toFixed(1) + "k";
    return sign + "£" + Math.round(a).toLocaleString("en-GB");
  }
  if (a < 100) return sign + "£" + a.toFixed(2);
  return sign + "£" + Math.round(a).toLocaleString("en-GB");
}

// Mirrors fmtMoney's full/compact rule exactly, minus the £ symbol (see the
// section doc comment above) — including the full-mode <100 decimal branch.
export function fmtNum(n: number, opts?: { compact?: boolean }): string {
  if (!Number.isFinite(n)) return NON_FINITE;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (opts?.compact) {
    if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + "M";
    if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + "k";
    return sign + Math.round(a).toLocaleString("en-GB");
  }
  if (a < 100) return sign + a.toFixed(2);
  return sign + Math.round(a).toLocaleString("en-GB");
}

// <60s: bare seconds (`45s`, `0s` at zero) — no minutes component at all.
// <1h: `10m 21s` (seconds zero-padded, minutes not). >=1h: `1h 04m` (minutes
// zero-padded, seconds dropped entirely). Negative input clamps to 0;
// non-integer seconds round first; non-finite input is the shared "—" guard.
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec)) return NON_FINITE;
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(ss).padStart(2, "0")}s`;
}

export function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nf * mag;
}

// --- empty state -------------------------------------------------------------
// Shared "no data" filler for cards/tables/charts so an empty result reads as
// a deliberate state, not a clipped or broken one.
export function EmptyState({ icon, title = "No data", hint = "No data in range for the current filters.", onReset }: { icon?: ReactNode; title?: string; hint?: string; onReset?: () => void }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, minHeight: 0, padding: "24px 12px", textAlign: "center" }}>
      {icon ?? <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden focusable="false"><rect x={1} y={1} width={14} height={14} rx={3} fill="none" stroke={t.inkFaint} strokeWidth={1.4} /><path d="M4 10l3-3 2 2 3-4" fill="none" stroke={t.inkFaint} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" /></svg>}
      <div style={{ ...type.bodyM, color: t.ink, fontWeight: 600 }}>{title}</div>
      <div style={{ ...type.bodyS, color: t.inkSoft, maxWidth: 220 }}>{hint}</div>
      {onReset && (
        <button type="button" onClick={onReset} style={{ marginTop: 4, ...type.bodyS, color: t.accent, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
          Reset slicers
        </button>
      )}
    </div>
  );
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

// --- visual card ------------------------------------------------------------
export function VisualCard({
  title,
  subtitle,
  right,
  children,
  className,
  style,
  pad = true,
  summary,
  scroll,
}: {
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  pad?: boolean;
  summary?: string;
  scroll?: boolean;
}) {
  const t = useTheme();
  const chartId = useId();
  const chartLabel = typeof subtitle === "string" ? `${title} — ${subtitle}` : title;
  return (
    <section
      className={`viz-card${className ? " " + className : ""}`}
      style={{
        background: `linear-gradient(168deg, ${t.paper}, ${t.themeBand})`,
        border: `1px solid ${t.ruleSoft}`,
        borderRadius: radius.card,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        ...style,
      }}
    >
      <header style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: `${space[4]}px ${space[4]}px ${space[2]}px` }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0, ...type.displayM, color: t.ink }}>{title}</h3>
          {subtitle && (
            <div style={{ marginTop: 2, ...type.bodyS, color: t.inkSoft }}>{subtitle}</div>
          )}
        </div>
        {right}
      </header>
      <div
        role="img"
        aria-label={chartLabel}
        aria-describedby={summary ? `${chartId}-summary` : undefined}
        className={scroll ? "viz-scroll" : undefined}
        style={{ flex: 1, minHeight: 0, padding: pad ? `0 ${space[4]}px ${space[4]}px` : 0, display: "flex", flexDirection: "column", ...(scroll ? { overflowY: "auto" } : null) }}
      >
        {children}
      </div>
      {summary && (
        <p id={`${chartId}-summary`} className="sr-only">
          {summary}
        </p>
      )}
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
  target,
  empty,
}: {
  label: string;
  value: string;
  sub?: string;
  accent: string;
  delta?: number; // fractional change vs previous
  deltaGood?: "up" | "down";
  spark?: number[];
  target?: { label: string; met: boolean }; // vs-target / SLA indicator
  empty?: boolean;
}) {
  const t = useTheme();
  const v = useViz();
  // Callers pass e.g. `Target ≥ 95%` / `Target ≤ £9.00` (see Overview.tsx,
  // Capacity.tsx, Commercial.tsx, ValueFinance.tsx) — stripped of its
  // leading "Target " here so the on/off-target line below can read "Off
  // target (≥ 95%)" instead of the doubled-up, wraps-to-two-lines "Target ≥
  // 95% · Off target".
  const targetThreshold = target ? target.label.replace(/^Target\s+/i, "") : "";
  return (
    <div
      className="tile-lift kpi-card"
      style={{
        background: `linear-gradient(165deg, ${t.paper}, ${t.themeBand})`,
        border: `1px solid ${t.ruleSoft}`,
        borderTop: `3px solid ${accent}`,
        borderRadius: radius.card,
        // "14px 16px" deliberately falls outside the type/space scale per the
        // design brief — there's no space[] token for 14, and the brief calls
        // this pair out literally rather than asking for a token pair.
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 0,
      }}
    >
      <span style={{ ...type.label, letterSpacing: "0.09em", textTransform: "uppercase", color: t.inkSoft }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ ...type.displayXl, color: t.ink }}>{empty ? "—" : value}</span>
        {!empty && spark && <Sparkline data={spark} color={accent} />}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 16 }}>
        {!empty && delta !== undefined && <Delta value={delta} good={deltaGood} />}
        {empty ? (
          <span style={{ fontFamily: fonts.body, fontSize: 12, color: t.inkSoft }}>No data in range</span>
        ) : (
          sub && <span style={{ fontFamily: fonts.body, fontSize: 12, color: t.inkSoft }}>{sub}</span>
        )}
      </span>
      {!empty && target && (
        // Single line at card width (nav/motion polish): "Target ≥ 95% · Off
        // target" wrapped to two lines at 1440×900 on Overview — nowrap +
        // ellipsis + minWidth:0 (flex items default to min-width:auto, which
        // would otherwise block the shrink that makes the ellipsis kick in)
        // keep it to one, and the shorter "Off target (≥ 95%)" phrasing
        // gives the ellipsis more room before it's ever needed.
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            marginTop: 1,
            fontFamily: fonts.mono,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.03em",
            color: target.met ? v.good : v.bad,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: target.met ? v.good : v.bad, flex: "0 0 auto" }} />
          {target.met ? "On" : "Off"} target ({targetThreshold})
        </span>
      )}
      <span className="sr-only">
        {label}: {empty ? "no data in range" : value}
        {!empty && delta !== undefined ? `, ${delta >= 0 ? "up" : "down"} ${fmtPct(Math.abs(delta), 1)} vs previous period` : ""}
        {!empty && target ? `, ${target.met ? "on target" : "off target"} (${targetThreshold})` : ""}
      </span>
    </div>
  );
}

// Radial gauge with a target band.
export function Gauge({ value, min = 0, max = 1, target, band, format, color, label, size }: { value: number; min?: number; max?: number; target?: number; band?: [number, number]; format: (n: number) => string; color: string; label?: string; size?: number }) {
  const t = useTheme();
  const v = useViz();
  // `size` scales the whole gauge (default 168 wide, same as before this
  // prop existed) — every dimension below is proportional to it so a
  // smaller gauge (e.g. a tighter Capacity-page layout) stays legible
  // rather than just cropping a fixed-size drawing.
  const W = size ?? 168;
  const scale = W / 168;
  const H = 104 * scale;
  const cx = W / 2;
  const cy = H - 10 * scale;
  const r = 74 * scale;
  const a0 = Math.PI; // 180deg (left)
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const pt = (f: number, rad: number) => [cx + Math.cos(a0 + f * Math.PI) * rad, cy + Math.sin(a0 + f * Math.PI) * rad] as const;
  const arc = (f0: number, f1: number, rad: number) => {
    const [x0, y0] = pt(f0, rad);
    const [x1, y1] = pt(f1, rad);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rad} ${rad} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const tf = (n: number) => Math.max(0, Math.min(1, (n - min) / (max - min || 1)));
  const gaugeLabel = `${label ?? "Gauge"}: ${format(value)}${target !== undefined ? `, target ${format(target)}` : ""}`;
  const strokeW = 12 * scale;
  return (
    <svg width={W} height={H} style={{ display: "block" }} role="img" aria-label={gaugeLabel}>
      <path d={arc(0, 1, r)} fill="none" stroke={v.grid} strokeWidth={strokeW} strokeLinecap="round" />
      {band && <path d={arc(tf(band[0]), tf(band[1]), r)} fill="none" stroke={`${v.good}55`} strokeWidth={strokeW} />}
      <path d={arc(0, frac, r)} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round" />
      {target !== undefined && (() => { const [tx, ty] = pt(tf(target), r + 9 * scale); const [ix, iy] = pt(tf(target), r - 9 * scale); return <line x1={ix} y1={iy} x2={tx} y2={ty} stroke={t.ink} strokeWidth={2} />; })()}
      <text x={cx} y={cy - 14 * scale} textAnchor="middle" fontFamily={fonts.display} fontSize={26 * scale} fontWeight={700} fill={t.ink}>{format(value)}</text>
      {label && <text x={cx} y={cy + 6 * scale} textAnchor="middle" fontFamily={fonts.mono} fontSize={Math.max(9.5, 9.5 * scale)} letterSpacing="0.06em" fill={t.inkSoft}>{label.toUpperCase()}</text>}
    </svg>
  );
}

// Direction glyph paths (8x8 viewBox), reusable by anything else that needs
// an up/down arrow.
const ARROW_UP_D = "M4 1l4 6H0z";
const ARROW_DOWN_D = "M4 7L0 1h8z";

export function Delta({ value, good = "up" }: { value: number; good?: "up" | "down" }) {
  const v = useViz();
  if (!isFinite(value)) return null;
  const up = value >= 0;
  const positive = good === "up" ? up : !up;
  const c = Math.abs(value) < 0.001 ? v.soft : positive ? v.good : v.bad;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: fonts.mono, fontSize: 11.5, fontWeight: 700, color: c }}>
      <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden focusable="false" style={{ flex: "0 0 auto" }}>
        <path d={up ? ARROW_UP_D : ARROW_DOWN_D} fill="currentColor" />
      </svg>
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
  forecast?: boolean; // project this series into the forecast region
  // Precomputed forecast (e.g. components/forecast.ts's seasonalNaiveForecast)
  // — when all three are present and each has exactly `forecast.periods`
  // entries, LineChart draws THESE instead of fitting its own linear
  // regression + fixed ±12% band. Omit to keep the old regression/±12%
  // behaviour (fully backward compatible — existing callers that only set
  // `forecast: true` are unaffected).
  forecastPoint?: number[];
  forecastLo?: number[];
  forecastHi?: number[];
}
export interface RefLine {
  value: number;
  label?: string;
  color?: string;
}

// Cached canvas-measurement helper (module scope) for dynamic left-padding
// and ref-line label halos — avoids allocating a new canvas per render.
let measureCanvas: HTMLCanvasElement | null = null;
export function measureTextWidth(text: string, font: string): number {
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 6; // crude fallback if canvas 2d is unavailable
  ctx.font = font;
  return ctx.measureText(text).width;
}

export function LineChart({
  labels,
  series,
  height,
  yFormat = fmtCompact,
  tipFormat = fmtInt,
  yLabel,
  refLines,
  forecast,
  weekendMask,
  bandWeekends,
  smooth,
  empty,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
  yFormat?: (n: number) => string;
  tipFormat?: (n: number) => string;
  yLabel?: string;
  refLines?: RefLine[];
  forecast?: { periods: number; labelFor?: (k: number) => string };
  weekendMask?: boolean[]; // parallel to labels — true where that index is a weekend day
  bandWeekends?: boolean; // render a band per contiguous weekend run (needs weekendMask)
  smooth?: number; // trailing moving-average window size, drawn as a dashed overlay
  empty?: { title?: string; hint?: string; onReset?: () => void };
}) {
  const v = useViz();
  const { prefs } = useDisplayPrefs();
  const cvdSafe = prefs.colorVisionSafe;
  const [ref, size] = useSize();
  const w = size.w;
  const H = height ?? size.h;
  const [hi, setHi] = useState<number | null>(null);

  const n = labels.length;
  if (n === 0) {
    return (
      <div ref={ref} style={{ width: "100%", height: height ?? "100%", display: "flex" }}>
        <EmptyState {...empty} />
      </div>
    );
  }

  // linear regression on a series, returns (slope, intercept) over index
  const fit = (vals: number[]) => {
    const k = vals.length;
    if (k === 0) return { slope: 0, intercept: 0 }; // no data to regress on — a k=0 divisor below would yield NaN
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    vals.forEach((val, i) => { sx += i; sy += val; sxy += i * val; sxx += i * i; });
    const d = k * sxx - sx * sx || 1;
    const slope = (k * sxy - sx * sy) / d;
    return { slope, intercept: (sy - slope * sx) / k };
  };

  const fp = forecast?.periods ?? 0;
  const total = n + fp;

  // forecast projections (per flagged series) — a precomputed forecast (see
  // LineSeries.forecastPoint's doc comment) wins when present; otherwise
  // fall back to the original linear-regression projection.
  const proj = new Map<string, number[]>();
  const projBand = new Map<string, { lo: number[]; hi: number[] }>();
  if (fp > 0 && n > 0) {
    series.forEach((s) => {
      if (!s.forecast) return;
      if (s.forecastPoint && s.forecastPoint.length === fp) {
        proj.set(s.name, s.forecastPoint);
        if (s.forecastLo?.length === fp && s.forecastHi?.length === fp) {
          projBand.set(s.name, { lo: s.forecastLo, hi: s.forecastHi });
        }
        return;
      }
      const { slope, intercept } = fit(s.values);
      const arr: number[] = [];
      for (let i = n; i < total; i++) arr.push(Math.max(0, slope * i + intercept));
      proj.set(s.name, arr);
    });
  }

  // don't floor to 1 — that breaks small-magnitude series (e.g. £0.09 cost/case)
  const rawMax = Math.max(
    0,
    ...series.flatMap((s) => s.values),
    ...[...proj.values()].flat(),
    ...[...projBand.values()].flatMap((b) => b.hi),
    ...(refLines?.map((r) => r.value) ?? []),
  );
  const top = niceMax(rawMax);
  const ticks = 4;

  // Dynamic left padding: widest tick label at the axis font, plus 12px —
  // fixes clipped wide labels (e.g. "£750.0k") that a fixed 46px assumed
  // could never happen.
  const tickLabelStrings = Array.from({ length: ticks + 1 }, (_, i) => yFormat((top / ticks) * i));
  const maxTickWidth = Math.max(0, ...tickLabelStrings.map((l) => measureTextWidth(l, `10px ${fonts.mono}`)));
  const padL = Math.max(46, Math.ceil(maxTickWidth) + 12);
  const padR = 14;
  const padT = 10;
  const padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = Math.max(10, H - padT - padB);

  const x = (i: number) => padL + (total <= 1 ? iw / 2 : (i / (total - 1)) * iw);
  const y = (val: number) => padT + ih - (val / top) * ih;
  // Math.max(0, …): when there's no actual data but forecast periods still
  // exist (n === 0, fp > 0 — e.g. a filter combo with zero rows), (n-1) is
  // -1 and this would otherwise go negative, an invalid SVG rect width.
  const realW = total <= 1 ? iw : Math.max(0, ((n - 1) / (total - 1)) * iw);

  // weekend banding: contiguous runs of `true` in weekendMask
  const weekendBands: [number, number][] = [];
  if (bandWeekends && weekendMask) {
    let runStart: number | null = null;
    for (let i = 0; i < n; i++) {
      const wknd = !!weekendMask[i];
      if (wknd && runStart === null) runStart = i;
      if (!wknd && runStart !== null) { weekendBands.push([runStart, i - 1]); runStart = null; }
    }
    if (runStart !== null) weekendBands.push([runStart, n - 1]);
  }

  // trailing simple moving average overlay, per series
  const smoothed = new Map<string, number[]>();
  if (smooth && smooth > 1 && n > 0) {
    series.forEach((s) => {
      const arr: number[] = s.values.map((_, i) => {
        const lo = Math.max(0, i - smooth + 1);
        const win = s.values.slice(lo, i + 1);
        return win.reduce((a, b) => a + b, 0) / win.length;
      });
      smoothed.set(s.name, arr);
    });
  }

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (n === 0) return; // nothing to index into — leave hi at null rather than clamping to a phantom 0
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const idx = Math.round((px / Math.max(1, realW)) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, idx)));
  };

  const allLabels = [...labels, ...Array.from({ length: fp }, (_, k) => forecast?.labelFor?.(k) ?? "")];
  const step = Math.ceil(total / Math.max(2, Math.floor(iw / 64)));

  return (
    <div ref={ref} className="viz-enter" style={{ width: "100%", height: height ?? "100%", minHeight: 0, position: "relative" }}>
      {w > 0 && H > 0 && (
        <svg width={w} height={H} style={{ display: "block", fontFamily: fonts.mono }} aria-hidden="true" focusable="false">
          {/* weekend banding — behind the gridlines */}
          {weekendBands.map(([a, b]) => (
            <rect key={`wknd-${a}`} x={x(a)} y={padT} width={Math.max(0, x(b + 1) - x(a))} height={ih} fill={v.band} stroke="none" />
          ))}
          {/* gridlines + y labels — a formatted label is suppressed if it
              repeats the previous tick's text (e.g. an all-zero/near-zero
              series where niceMax's 0->1 fallback plus a coarse yFormat would
              otherwise print "0, 0, 1, 1, 1"); the gridline itself still
              draws so the scale reads correctly. */}
          {(() => {
            let lastLabel: string | null = null;
            return Array.from({ length: ticks + 1 }, (_, i) => {
              const val = (top / ticks) * i;
              const yy = y(val);
              const label = yFormat(val);
              const show = label !== lastLabel;
              if (show) lastLabel = label;
              return (
                <g key={i}>
                  <line x1={padL} x2={w - padR} y1={yy} y2={yy} stroke={v.grid} strokeWidth={1} />
                  {show && <text x={padL - 7} y={yy + 3} textAnchor="end" fontSize={10} fill={v.soft}>{label}</text>}
                </g>
              );
            });
          })()}
          {/* forecast region shading + divider — nothing to project forward
              from when there's no historical data (n === 0) for the current
              filters, so this stays hidden alongside the projection itself. */}
          {fp > 0 && n > 0 && (
            <g>
              <rect x={x(n - 1)} y={padT} width={x(total - 1) - x(n - 1)} height={ih} fill={v.soft} opacity={0.04} />
              <line x1={x(n - 1)} x2={x(n - 1)} y1={padT} y2={padT + ih} stroke={v.soft} strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
              <text x={(x(n - 1) + x(total - 1)) / 2} y={padT + 10} textAnchor="middle" fontSize={9} fill={v.soft} letterSpacing="0.08em">FORECAST</text>
            </g>
          )}
          {/* reference / target lines — label anchored at the left padding
              edge (was the right edge, which overlapped the series) with a
              paper-coloured halo rect behind the text for legibility. */}
          {refLines?.map((r) => {
            const labelText = r.label;
            const haloW = labelText ? measureTextWidth(labelText, `9.5px ${fonts.body}`) + 8 : 0;
            return (
              <g key={r.label ?? r.value}>
                <line x1={padL} x2={w - padR} y1={y(r.value)} y2={y(r.value)} stroke={r.color ?? v.accent} strokeWidth={1.4} strokeDasharray="6 4" opacity={0.9} />
                {labelText && (
                  <>
                    <rect x={padL + 4} y={y(r.value) - 4 - 10} width={haloW} height={13} fill={v.surface} />
                    <text x={padL + 4} y={y(r.value) - 4} textAnchor="start" fontSize={9.5} fill={r.color ?? v.accent} fontWeight={700}>{labelText}</text>
                  </>
                )}
              </g>
            );
          })}
          {/* x labels */}
          {allLabels.map((l, i) => {
            const isLast = i === total - 1;
            const isStep = i % step === 0 && total - 1 - i >= step * 0.6;
            if ((!isStep && !isLast) || !l) return null;
            const anchor = isLast ? "end" : "middle";
            return (
              <text key={i} x={isLast ? w - padR : x(i)} y={H - 9} textAnchor={anchor} fontSize={10} fill={v.soft}>{l}</text>
            );
          })}
          {/* series (actual) — nothing to plot when there's no data for the
              current filters (n === 0: dPts would be "", and the area path
              below would then start with "L" instead of "M", an invalid SVG
              path command that the browser rejects and logs a console error
              for), so skip the whole series rather than emit broken paths. */}
          {n > 0 && series.map((s, i) => {
            const dPts = s.values.map((val, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(val).toFixed(1)}`).join(" ");
            return (
              <g key={s.name}>
                {s.area && <path d={`${dPts} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={s.color} opacity={0.1} />}
                <path
                  className={`viz-series viz-series-${i % 4}`}
                  d={dPts}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.2}
                  strokeDasharray={s.dashed ? "5 5" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {cvdSafe && i > 0 && s.values.map((val, k) => (
                  <circle key={k} cx={x(k)} cy={y(val)} r={2.6} fill={v.surface} stroke={s.color} strokeWidth={1.6} />
                ))}
              </g>
            );
          })}
          {/* trailing moving-average overlay — purely a visual trend line, not
              a first-class series (no tooltip row, no cvd-safe dot markers),
              drawn after the main series paths so it sits on top. */}
          {smoothed.size > 0 && (
            <g>
              {series.map((s) => {
                const arr = smoothed.get(s.name);
                if (!arr) return null;
                const dPts = arr.map((val, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(val).toFixed(1)}`).join(" ");
                return <path key={s.name} d={dPts} fill="none" stroke={s.color} strokeWidth={1.6} strokeDasharray="2 4" opacity={0.55} />;
              })}
            </g>
          )}
          {/* forecast projections (dashed + band) */}
          {[...proj.entries()].map(([name, arr]) => {
            const s = series.find((q) => q.name === name)!;
            const startX = x(n - 1), startY = y(s.values[n - 1]);
            const line = `M${startX.toFixed(1)} ${startY.toFixed(1)} ` + arr.map((val, k) => `L${x(n + k).toFixed(1)} ${y(val).toFixed(1)}`).join(" ");
            // A precomputed band (precomputedBand) wins when present;
            // otherwise the original fixed ±12% band around the projected point.
            const precomputedBand = projBand.get(name);
            const up = arr.map((val, k) => `${x(n + k).toFixed(1)} ${y(precomputedBand ? precomputedBand.hi[k] : val * 1.12).toFixed(1)}`);
            const dn = arr.map((val, k) => `${x(n + k).toFixed(1)} ${y(precomputedBand ? precomputedBand.lo[k] : val * 0.88).toFixed(1)}`).reverse();
            const band = `M${startX.toFixed(1)} ${startY.toFixed(1)} L${up.join(" L")} L${dn.join(" L")} Z`;
            return (
              <g key={name}>
                <path d={band} fill={s.color} opacity={0.08} />
                <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />
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
          <rect x={padL} y={padT} width={realW} height={ih} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHi(null)} />
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
      className="dropdown-panel glass-overlay"
      style={{
        position: "absolute",
        top: 6,
        left,
        width: 156,
        pointerEvents: "none",
        border: `1px solid ${t.ruleSoft}`,
        borderRadius: radius.overlay,
        padding: "8px 10px",
        zIndex: 5,
        ...glassOverlayVars(t),
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

// --- stacked share trend (100%-stacked daily bar strip) --------------------
export interface StackTrendSeries {
  name: string;
  color: string;
  values: number[]; // parallel to `labels`, same length
}
export function StackedShareTrend({
  labels,
  series,
  height,
  empty,
}: {
  labels: string[];
  series: StackTrendSeries[];
  height?: number;
  empty?: { title?: string; hint?: string; onReset?: () => void };
}) {
  const [ref, size] = useSize();
  const w = size.w;
  const H = height ?? size.h;
  const n = labels.length;
  if (n === 0) {
    return (
      <div ref={ref} style={{ width: "100%", height: height ?? "100%", display: "flex" }}>
        <EmptyState {...empty} />
      </div>
    );
  }
  const gap = 1.5;
  const barW = Math.max(1, w / n - gap);
  return (
    <div ref={ref} className="viz-enter" style={{ width: "100%", height: height ?? "100%", minHeight: 0 }}>
      {w > 0 && H > 0 && (
        <svg width={w} height={H} aria-hidden="true" focusable="false" style={{ display: "block" }}>
          {labels.map((label, i) => {
            const total = series.reduce((s, ser) => s + (ser.values[i] || 0), 0) || 1;
            let cursor = H;
            const x = i * (w / n) + gap / 2;
            // key by index, not the display label: `label` is a day+month
            // string with no year (fmtDate), so any window spanning more
            // than a year (e.g. "All time") has genuine duplicate labels —
            // keying by them causes React "duplicate key" warnings and lets
            // it conflate two different days' bars.
            return (
              <g key={i}>
                {series.map((ser) => {
                  const val = ser.values[i] || 0;
                  const segH = (val / total) * H;
                  const y = cursor - segH;
                  cursor -= segH;
                  return (
                    <rect key={ser.name} x={x} y={y} width={barW} height={Math.max(0, segH)} fill={ser.color}>
                      <title>{`${label} — ${ser.name}: ${val.toLocaleString("en-GB")} (${((val / total) * 100).toFixed(1)}%)`}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// --- horizontal bar chart --------------------------------------------------
export function HBarChart({
  rows,
  valueFormat = fmtCompact,
  barColor,
  height,
  onRowClick,
  activeId,
  empty,
}: {
  rows: { label: string; value: number; sub?: string; color?: string; id?: string }[];
  valueFormat?: (n: number) => string;
  barColor?: string;
  height?: number | string;
  onRowClick?: (id: string) => void;
  activeId?: string;
  empty?: { title?: string; hint?: string; onReset?: () => void };
}) {
  const v = useViz();
  if (rows.length === 0) {
    return (
      <div style={{ display: "flex", height: height ?? "100%", minHeight: 0 }}>
        <EmptyState {...empty} />
      </div>
    );
  }
  const max = niceMax(Math.max(1, ...rows.map((r) => r.value)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, height: height ?? "100%", minHeight: 0, justifyContent: rows.length > 1 ? "space-between" : "flex-start" }}>
      {rows.map((r) => {
        const clickable = !!(onRowClick && r.id);
        const active = !!(r.id && r.id === activeId);
        return (
          <div
            key={r.label}
            className={clickable ? "bar-row" : undefined}
            onClick={clickable ? () => onRowClick!(r.id!) : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-pressed={clickable ? active : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (e.key === " ") e.preventDefault();
                      onRowClick!(r.id!);
                    }
                  }
                : undefined
            }
            style={{ display: "grid", gridTemplateColumns: "150px 1fr 64px", alignItems: "center", gap: 10, cursor: clickable ? "pointer" : undefined, borderRadius: 5, padding: "1px 3px", margin: "0 -3px", background: active ? v.band : undefined }}
          >
            <span style={{ ...type.bodyM, color: v.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: active ? 700 : 400 }} title={r.label}>{r.label}</span>
            <span style={{ height: 16, background: v.grid, borderRadius: 4, overflow: "hidden", position: "relative" }}>
              <span style={{ position: "absolute", inset: 0, width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color ?? barColor ?? v.t.series, borderRadius: 4, opacity: activeId && !active ? 0.45 : 1 }} />
              {r.sub && <span style={{ position: "absolute", right: 6, top: 0, ...type.micro, lineHeight: "16px", color: v.soft }}>{r.sub}</span>}
            </span>
            <span style={{ ...type.label, color: v.ink, textAlign: "right" }}>{valueFormat(r.value)}</span>
          </div>
        );
      })}
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
// Single triangle chevron, reused for every sort-glyph state (rotated 180deg
// for ascending via the wrapping span's transform).
const CHEVRON_D = "M3 5L0 1h6z";

// Shared sort-direction indicator for a sortable-column header button — the
// same SVG chevron treatment for every table that sorts (DataTable below and
// viz-finance.tsx's SpokePLTable), replacing a bare "▲"/"▼"/"▾" glyph.
// Decorative only (aria-hidden) — the header button's own aria-sort carries
// the meaning for assistive tech.
export function SortGlyph({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", opacity: active ? 1 : 0.25, marginLeft: 5 }}>
      <span style={{ display: "inline-flex", transform: active && dir === "asc" ? "rotate(180deg)" : undefined }}>
        <svg width={6} height={6} viewBox="0 0 6 6" aria-hidden focusable="false"><path d={CHEVRON_D} fill="currentColor" /></svg>
      </span>
    </span>
  );
}

export function DataTable<T extends { [k: string]: any }>({
  columns,
  rows,
  initialSort,
  maxBodyHeight,
  empty,
  onSortedChange,
}: {
  columns: Column<T>[];
  rows: T[];
  initialSort?: { key: string; dir: "asc" | "desc" };
  maxBodyHeight?: number;
  empty?: { title?: string; hint?: string; onReset?: () => void };
  // Fires with the table's current sorted row order whenever it changes —
  // lets a page track "what's actually on screen right now" (e.g. for a CSV
  // export that must match the visible sort) without lifting sort state out
  // of this component. Optional and purely additive: nothing subscribes,
  // nothing changes for existing callers.
  onSortedChange?: (rows: T[]) => void;
}) {
  const t = useTheme();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>(initialSort ?? { key: columns[0].key, dir: "asc" });

  const col = columns.find((c) => c.key === sort.key) ?? columns[0];
  // Deliberately NOT keyed on `col`/`columns`: callers pass a fresh columns
  // array literal every render (a new object identity every time even when
  // its shape never changes), so keying this memo on it recomputed `sorted`
  // every render — which, combined with the onSortedChange effect below,
  // was an infinite render loop (each recompute produced a new `sorted`
  // array => effect fires => setState in the caller => re-render => new
  // columns array => recompute again). `sort.key` (a primitive) is what
  // actually selects `col`, so it's the correct — and stable — dependency.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const va = col.sortValue ? col.sortValue(a) : a[col.key];
        const vb = col.sortValue ? col.sortValue(b) : b[col.key];
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === "asc" ? cmp : -cmp;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort.key, sort.dir],
  );

  useEffect(() => onSortedChange?.(sorted), [sorted, onSortedChange]);

  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div style={{ overflow: "auto", height: "100%", maxHeight: maxBodyHeight, border: `1px solid ${t.ruleSoft}`, borderRadius: 9 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: t.paper,
                  padding: 0,
                  ...type.label,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: sort.key === c.key ? t.ink : t.inkSoft,
                  borderBottom: `1px solid ${t.ruleSoft}`,
                  whiteSpace: "nowrap",
                  width: c.width,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  style={{
                    display: "flex",
                    width: "100%",
                    justifyContent: c.align === "right" ? "flex-end" : "flex-start",
                    textAlign: c.align ?? "left",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    font: "inherit",
                    color: "inherit",
                    padding: "9px 12px",
                  }}
                >
                  {c.header}
                  <SortGlyph active={sort.key === c.key} dir={sort.dir} />
                </button>
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
                    ...type.bodyM,
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
              <td colSpan={columns.length} style={{ padding: 0 }}>
                <EmptyState title={empty?.title ?? "No data"} hint={empty?.hint ?? "No rows for the current filters."} onReset={empty?.onReset} />
              </td>
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
        ...type.bodyM,
        padding: "6px 10px",
        borderRadius: radius.control,
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

// Page body: fills the available canvas height and animates in. Rows flagged
// flex:1 share the remaining height so every page fits without scrolling.
// `fit` (default true) fills 100% of .report__canvas's content box —
// .report__canvas is the scroll container (flex:1 1 auto; column flex) and
// PageGrid is its direct child, so a real 100%-height box is already
// available to fill; the existing `.report__canvas > * { min-height: 700px }`
// CSS rule (unchanged) supplies the floor on very short windows, so no
// viewport-unit max() calc is needed here. Pass fit={false} for
// document-style pages (Value & Finance) that should scroll instead of
// being height-locked.
export function PageGrid({ children, style, fit = true }: { children: ReactNode; style?: CSSProperties; fit?: boolean }) {
  return (
    <div
      className="anim-up page-grid"
      style={{
        display: "flex",
        flexDirection: "column",
        ...(fit ? { flex: "1 1 auto", height: "100%", minHeight: "max(700px, 100%)" } : { height: "100%", minHeight: 0 }),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// A row of equal-height visuals that grows to fill leftover canvas height.
// `weight` scales how much of the remaining flex space this row claims
// relative to sibling rows (default 1, same as before weight existed).
export function Row({ cols, children, grow = true, weight = 1, style }: { cols: string; children: ReactNode; grow?: boolean; weight?: number; style?: CSSProperties }) {
  return (
    <div className="page-row" style={{ flex: grow ? `${weight} 1 0` : "0 0 auto", minHeight: 0, display: "grid", gridTemplateColumns: cols, ...style }}>
      {children}
    </div>
  );
}

// --- segmented control -------------------------------------------------------
export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel?: string }) {
  const t = useTheme();
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "inline-flex", height: controlHeight, padding: 3, borderRadius: radius.control, background: t.themeBand, border: `1px solid ${t.ruleSoft}`, gap: 2 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            style={{
              ...type.bodyS,
              fontWeight: 700,
              padding: "0 12px",
              borderRadius: radius.inner,
              border: "none",
              cursor: "pointer",
              background: active ? t.paper : "transparent",
              color: active ? t.ink : t.inkSoft,
              boxShadow: active ? t.shadow : "none",
              transition: "background 0.15s, color 0.15s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
