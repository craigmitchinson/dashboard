import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, MouseEvent } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useSize, useViz, Legend, Sparkline, SortGlyph, measureTextWidth, niceMax, fmtGBPc, fmtMoney2, fmtPct, fmtInt } from "./viz";
import type { SpokeAgg } from "../filters-context";

// ---------------------------------------------------------------------------
// viz-finance.tsx
// ---------------------------------------------------------------------------
// Value & Finance page chart forms — waterfall, Pareto, stacked cost trend +
// a spoke P&L table. Same visual language as components/viz.tsx (mono axis
// text, hairline solid grid, useTheme()/useViz() tokens, shared niceMax/
// measureTextWidth/SortGlyph): a local re-implementation of that file's
// Tooltip only (not exported from there).
// ---------------------------------------------------------------------------

// --- categorical color set (validated against #FAF7F2 light / #0C2329 dark)
export function fyFinanceColors(mode: "light" | "dark") {
  return mode === "dark"
    ? {
        hubPeople: "#3987e5",
        hubInfra: "#d95926",
        spokePeople: "#199e70",
        spokeInfra: "#c98500",
        unattributed: "#d55181",
        netLine: "#9085e9",
      }
    : {
        hubPeople: "#2a78d6",
        hubInfra: "#eb6834",
        spokePeople: "#1baf7a",
        spokeInfra: "#eda100",
        unattributed: "#e87ba4",
        netLine: "#4a3aa7",
      };
}

// Word-wraps the waterfall's per-bar x-axis labels onto up to two lines
// (using viz.tsx's shared `measureTextWidth`): several of the
// cost-composition labels ("CoE machines (VDIs)", "Squad machines (VDIs)",
// "Unattributed idle (memo)") are long enough that, packed one per (of up to
// 7) narrow bar columns, single-line text overlapped its neighbours.
//
// Greedily wraps `label` onto at most `maxLines` lines that each fit within
// `maxWidth` at the given font — a plain word-wrap (never mid-word), with
// the last permitted line ellipsised if words remain.
function wrapLabel(label: string, maxWidth: number, font: string, maxLines = 2): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let cur = "";
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    const word = words[i];
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && measureTextWidth(candidate, font) > maxWidth) {
      lines.push(cur);
      cur = "";
    } else {
      cur = candidate;
      i++;
    }
  }
  if (cur) lines.push(cur);
  // Words remain unplaced (label too long even at maxLines) — ellipsise the
  // last line down until "<text>…" fits.
  if (i < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && measureTextWidth(last + "…", font) > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = last + "…";
  }
  return lines;
}

// --- shared tooltip (same visual style as viz.tsx's local Tooltip) ---------
function FinTooltip({
  x,
  y,
  chartW,
  title,
  rows,
}: {
  x: number;
  y: number;
  chartW: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  const t = useTheme();
  const width = 182;
  const left = Math.min(Math.max(x - width / 2, 8), Math.max(8, chartW - width - 8));
  const top = Math.max(4, y);
  return (
    <div
      className="dropdown-panel"
      style={{
        position: "absolute",
        top,
        left,
        width,
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
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}>
          {r.color && <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flex: "0 0 auto" }} />}
          <span style={{ fontFamily: fonts.body, fontSize: 12, color: t.ink, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label}</span>
          <span style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 700, color: t.ink }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// 1. WaterfallChart
// ===========================================================================
export interface WaterfallStep {
  key: string;
  label: string;
  value: number; // isTotal: absolute bar from 0 to value. otherwise: signed delta (negative for a cost) added to the running cumulative total
  isTotal?: boolean;
  color: string;
  pctOfBase?: number; // 0..1 — shown as a small secondary label under the £ value, e.g. "18.2% of gross"; omit for total bars
  memo?: boolean; // an INFORMATIONAL bar that does NOT feed the running cumulative total — dashed outline, positioned after the last real bar, its own label
}

export function WaterfallChart({ steps, valueFormat = fmtGBPc, height }: { steps: WaterfallStep[]; valueFormat?: (n: number) => string; height?: number }) {
  const v = useViz();
  const [ref, size] = useSize();
  const w = size.w;
  // Fall back to a real minimum height (240) rather than a possibly-still-0
  // `size.h` — the ResizeObserver's first callback can race a 0-height
  // parent (e.g. a flex row mid-layout on the very first paint), and 0 would
  // otherwise make the `H > 0` guard below skip rendering entirely.
  const H = height ?? (size.h || 240);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const chain = steps.filter((s) => !s.memo);
  const memos = steps.filter((s) => s.memo);

  let cumulative = 0;
  const chainBars = chain.map((s) => {
    let before: number, after: number, top: number, bottom: number;
    if (s.isTotal) {
      before = cumulative;
      after = s.value;
      top = Math.max(0, s.value);
      bottom = Math.min(0, s.value);
    } else {
      before = cumulative;
      after = cumulative + s.value;
      top = Math.max(before, after);
      bottom = Math.min(before, after);
    }
    cumulative = after;
    return { step: s, top, bottom, before, after };
  });
  const memoBars = memos.map((s) => ({ step: s, top: Math.max(0, s.value), bottom: Math.min(0, s.value), before: 0, after: s.value }));
  const allBars = [...chainBars, ...memoBars];
  const n = allBars.length;

  const padL = 46,
    padR = 14,
    padT = 40,
    // 46 (was 34): room for the axis label to wrap onto 2 lines — several
    // of the cost-composition labels ("CoE machines (VDIs)", "Squad
    // machines (VDIs)", "Unattributed idle (memo)") no longer fit one line
    // per bar without overlapping their neighbours at typical card widths.
    padB = 46;
  const iw = Math.max(10, w - padL - padR);
  const ih = Math.max(10, H - padT - padB);

  const rawEdges = allBars.flatMap((b) => [b.top, b.bottom]).concat([0]);
  const minV = Math.min(...rawEdges, 0);
  const maxV = Math.max(...rawEdges, 0);
  const span = maxV - minV || 1;
  const domMin = minV - (minV < 0 ? span * 0.05 : 0);
  const domMax = maxV + span * 0.22; // headroom for direct £/% labels above the tallest bar
  const domSpan = domMax - domMin || 1;
  const y = (val: number) => padT + ih - ((val - domMin) / domSpan) * ih;
  const y0 = y(0);

  const gap = 12;
  const cell = n > 0 ? iw / n : 0;
  const barW = Math.max(6, cell - gap);
  const x = (i: number) => padL + cell * i + (cell - barW) / 2;

  // Legend: dedupe by color so shared "total" colors (Gross/Net) collapse
  // into one swatch with both labels.
  const legendMap = new Map<string, string[]>();
  for (const s of steps) legendMap.set(s.color, [...(legendMap.get(s.color) ?? []), s.label]);
  const legendItems = [...legendMap.entries()].map(([color, labels]) => ({ color, label: labels.join(" · ") }));

  return (
    <div style={{ width: "100%", height: height ?? "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <Legend items={legendItems} />
      <div ref={ref} className="viz-enter" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {w > 0 && H > 0 && n > 0 && (
          <svg width={w} height={H} style={{ display: "block", fontFamily: fonts.mono }}>
            <line x1={padL} x2={w - padR} y1={y0} y2={y0} stroke={v.grid} strokeWidth={1} />
            {chainBars.slice(0, -1).map((b, i) => {
              const yy = y(b.after);
              return <line key={`conn-${i}`} x1={x(i) + barW} x2={x(i + 1)} y1={yy} y2={yy} stroke={v.grid} strokeWidth={1} />;
            })}
            {allBars.map((b, i) => {
              const isMemo = !!b.step.memo;
              const bx = x(i);
              const byTop = y(b.top);
              const byBottom = y(b.bottom);
              const bh = Math.max(1, byBottom - byTop);
              const isDecrease = !b.step.isTotal && !isMemo && b.step.value < 0;
              const capY = isDecrease ? byBottom : byTop;
              const labelAbove = !isDecrease;
              const primaryY = labelAbove ? capY - 8 : capY + 15;
              const secondaryY = labelAbove ? primaryY - 12 : primaryY + 12;
              const active = hoverIdx === i;
              return (
                <g key={b.step.key}>
                  <rect
                    x={bx}
                    y={byTop}
                    width={barW}
                    height={bh}
                    rx={2}
                    fill={isMemo ? "none" : b.step.color}
                    fillOpacity={isMemo ? 0.1 : active ? 1 : 0.9}
                    stroke={isMemo ? v.soft : "none"}
                    strokeWidth={isMemo ? 1.5 : 0}
                    strokeDasharray={isMemo ? "4 3" : undefined}
                    tabIndex={0}
                    aria-label={`${b.step.label}: ${valueFormat(b.step.value)}${b.step.pctOfBase !== undefined ? `, ${fmtPct(b.step.pctOfBase)} of gross` : ""}`}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                    onFocus={() => setHoverIdx(i)}
                    onBlur={() => setHoverIdx((h) => (h === i ? null : h))}
                    style={{ outline: "none" }}
                  />
                  <text x={bx + barW / 2} y={primaryY} textAnchor="middle" fontSize={11} fontWeight={700} fill={v.ink}>
                    {valueFormat(b.step.value)}
                    {isMemo ? " (memo)" : ""}
                  </text>
                  {b.step.pctOfBase !== undefined && (
                    <text x={bx + barW / 2} y={secondaryY} textAnchor="middle" fontSize={9.5} fill={v.soft}>
                      {fmtPct(b.step.pctOfBase)} of gross
                    </text>
                  )}
                  {wrapLabel(b.step.label, cell - 4, "10px " + fonts.mono).map((line, li, lines) => (
                    <text key={li} x={bx + barW / 2} y={H - 10 - (lines.length - 1 - li) * 11} textAnchor="middle" fontSize={10} fill={v.soft}>
                      {line}
                    </text>
                  ))}
                </g>
              );
            })}
          </svg>
        )}
        {hoverIdx !== null &&
          w > 0 &&
          (() => {
            const b = allBars[hoverIdx];
            return (
              <FinTooltip
                x={x(hoverIdx) + barW / 2}
                y={Math.max(4, y(b.top) - 64)}
                chartW={w}
                title={b.step.label}
                rows={[
                  { label: "Value", value: valueFormat(b.step.value), color: b.step.color },
                  ...(b.step.pctOfBase !== undefined ? [{ label: "% of gross", value: fmtPct(b.step.pctOfBase) }] : []),
                ]}
              />
            );
          })()}
      </div>
    </div>
  );
}

// ===========================================================================
// 2. ParetoChart
// ===========================================================================
export interface ParetoItem {
  key: string;
  label: string;
  value: number;
}
export function ParetoChart({
  items,
  valueFormat = fmtGBPc,
  height,
  barColor,
  lineColor,
  thresholdPct,
  thresholdLabel,
}: {
  items: ParetoItem[];
  valueFormat?: (n: number) => string;
  height?: number;
  barColor: string;
  lineColor: string;
  thresholdPct?: number;
  thresholdLabel?: string;
}) {
  const v = useViz();
  const [ref, size] = useSize();
  const w = size.w;
  const H = height ?? (size.h || 240);
  const [hi, setHi] = useState<number | null>(null);
  const n = items.length;

  const cum: number[] = [];
  let running = 0;
  for (const it of items) {
    running += it.value;
    cum.push(running);
  }
  const total = running;

  const padL = 46,
    padR = 14,
    padT = 14,
    padB = 34;
  const iw = Math.max(10, w - padL - padR);
  const ih = Math.max(10, H - padT - padB);

  const topMax = niceMax(Math.max(total, ...items.map((i) => i.value), (thresholdPct ?? 0) * total, 1));
  const y = (val: number) => padT + ih - (val / topMax) * ih;

  const bw = n > 0 ? iw / n : 0;
  const barW = Math.max(4, bw * 0.6);
  const xCenter = (i: number) => padL + bw * i + bw / 2;

  const onMove = (e: MouseEvent<SVGRectElement>) => {
    if (n === 0) return;
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const idx = Math.round((px / Math.max(1, iw)) * (n - 1));
    setHi(Math.max(0, Math.min(n - 1, idx)));
  };

  const ticks = 4;
  const labelStep = Math.ceil(n / Math.max(2, Math.floor(iw / 70)));

  return (
    <div style={{ width: "100%", height: height ?? "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <Legend items={[{ label: "Value", color: barColor }, { label: "Cumulative", color: lineColor }]} />
      <div ref={ref} className="viz-enter" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {w > 0 && H > 0 && n > 0 && (
          <svg width={w} height={H} style={{ display: "block", fontFamily: fonts.mono }}>
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const val = (topMax / ticks) * i;
              const yy = y(val);
              return (
                <g key={i}>
                  <line x1={padL} x2={w - padR} y1={yy} y2={yy} stroke={v.grid} strokeWidth={1} />
                  <text x={padL - 7} y={yy + 3} textAnchor="end" fontSize={10} fill={v.soft}>
                    {valueFormat(val)}
                  </text>
                </g>
              );
            })}
            {thresholdPct !== undefined && total > 0 && (
              <g>
                <line x1={padL} x2={w - padR} y1={y(thresholdPct * total)} y2={y(thresholdPct * total)} stroke={v.accent} strokeWidth={1.4} strokeDasharray="6 4" opacity={0.9} />
                <text x={w - padR} y={y(thresholdPct * total) - 4} textAnchor="end" fontSize={9.5} fill={v.accent} fontWeight={700}>
                  {thresholdLabel ?? `${fmtPct(thresholdPct)} threshold`}
                </text>
              </g>
            )}
            {items.map((it, i) => {
              const bx = xCenter(i) - barW / 2;
              const byTop = y(Math.max(0, it.value));
              const bh = Math.max(0.5, padT + ih - byTop);
              return (
                <rect
                  key={it.key}
                  x={bx}
                  y={byTop}
                  width={barW}
                  height={bh}
                  fill={barColor}
                  opacity={hi === i ? 1 : 0.85}
                  tabIndex={0}
                  aria-label={`${it.label}: ${valueFormat(it.value)}, cumulative ${valueFormat(cum[i])}${total ? ` (${fmtPct(cum[i] / total)})` : ""}`}
                  onMouseEnter={() => setHi(i)}
                  onFocus={() => setHi(i)}
                  onMouseLeave={() => setHi((h) => (h === i ? null : h))}
                  onBlur={() => setHi((h) => (h === i ? null : h))}
                  style={{ outline: "none" }}
                />
              );
            })}
            {n > 0 && (
              <path
                d={cum.map((c, i) => `${i ? "L" : "M"}${xCenter(i).toFixed(1)} ${y(c).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={lineColor}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {cum.map((c, i) => (
              <circle key={i} cx={xCenter(i)} cy={y(c)} r={hi === i ? 4.5 : 3.2} fill={v.surface} stroke={lineColor} strokeWidth={2} />
            ))}
            {items.map((it, i) => {
              if (i % labelStep !== 0 && i !== n - 1) return null;
              const label = it.label.length > 11 ? it.label.slice(0, 10) + "…" : it.label;
              return (
                <text key={it.key} x={xCenter(i)} y={H - 8} textAnchor="middle" fontSize={9.5} fill={v.soft}>
                  {label}
                </text>
              );
            })}
            {hi !== null && <line x1={xCenter(hi)} x2={xCenter(hi)} y1={padT} y2={padT + ih} stroke={v.soft} strokeWidth={1} strokeDasharray="3 3" />}
            <rect
              x={padL}
              y={padT}
              width={iw}
              height={ih}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHi(null)}
            />
          </svg>
        )}
        {hi !== null &&
          w > 0 &&
          (() => {
            const it = items[hi];
            const pct = total ? cum[hi] / total : 0;
            return (
              <FinTooltip
                x={xCenter(hi)}
                y={Math.max(4, y(cum[hi]) - 70)}
                chartW={w}
                title={it.label}
                rows={[
                  { label: "Value", value: valueFormat(it.value), color: barColor },
                  { label: "Cumulative", value: total ? `${valueFormat(cum[hi])} (${fmtPct(pct)})` : "—", color: lineColor },
                ]}
              />
            );
          })()}
      </div>
    </div>
  );
}

// ===========================================================================
// 3. StackedCostTrend
// ===========================================================================
export interface StackedCostSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}
export function StackedCostTrend({
  labels,
  stacks,
  net,
  height,
}: {
  labels: string[];
  stacks: StackedCostSeries[];
  net: number[];
  height?: number;
}) {
  const v = useViz();
  const t = useTheme();
  const colors = fyFinanceColors(t.mode);
  const [ref, size] = useSize();
  const w = size.w;
  const H = height ?? (size.h || 240);
  const [hi, setHi] = useState<number | null>(null);
  const n = labels.length;

  const totals = labels.map((_, i) => stacks.reduce((s, ser) => s + Math.max(0, ser.values[i] || 0), 0));
  const minNet = n ? Math.min(0, ...net) : 0;
  const maxVal = n ? Math.max(0, ...totals, ...net) : 0;

  const padL = 46,
    padR = 14,
    padT = 10,
    padB = 26;
  const iw = Math.max(10, w - padL - padR);
  const ih = Math.max(10, H - padT - padB);

  const topMax = niceMax(maxVal || 1);
  const botMin = minNet < 0 ? -niceMax(Math.abs(minNet)) : 0;
  const domSpan = topMax - botMin || 1;
  const y = (val: number) => padT + ih - ((val - botMin) / domSpan) * ih;
  const y0 = y(0);

  const bw = n ? iw / n : 0;
  const barW = Math.max(2, bw * 0.6);
  const xCenter = (i: number) => padL + bw * i + bw / 2;

  const ticks = 4;
  const labelStep = Math.ceil(n / Math.max(2, Math.floor(iw / 60)));

  const legendItems = [...stacks.map((s) => ({ label: s.label, color: s.color })), { label: "Net", color: colors.netLine }];

  return (
    <div style={{ width: "100%", height: height ?? "100%", minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <Legend items={legendItems} />
      <div ref={ref} className="viz-enter" style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {w > 0 && H > 0 && n > 0 && (
          <svg width={w} height={H} style={{ display: "block", fontFamily: fonts.mono }}>
            {Array.from({ length: ticks + 1 }, (_, i) => {
              const val = botMin + ((topMax - botMin) / ticks) * i;
              const yy = y(val);
              return (
                <g key={i}>
                  <line x1={padL} x2={w - padR} y1={yy} y2={yy} stroke={v.grid} strokeWidth={1} />
                  <text x={padL - 7} y={yy + 3} textAnchor="end" fontSize={10} fill={v.soft}>
                    {fmtGBPc(val)}
                  </text>
                </g>
              );
            })}
            {botMin < 0 && <line x1={padL} x2={w - padR} y1={y0} y2={y0} stroke={v.grid} strokeWidth={1.4} />}
            {labels.map((_, i) => {
              let cursor = 0;
              const bx = xCenter(i) - barW / 2;
              return (
                <g key={i}>
                  {stacks.map((s) => {
                    const val = Math.max(0, s.values[i] || 0);
                    const yTop = y(cursor + val);
                    const yBottom = y(cursor);
                    cursor += val;
                    const segH = Math.max(0, yBottom - yTop - 1);
                    return <rect key={s.key} x={bx} y={yTop + 1} width={barW} height={segH} fill={s.color} opacity={hi === i ? 1 : 0.92} />;
                  })}
                </g>
              );
            })}
            {n > 0 && (
              <path
                d={net.map((val, i) => `${i ? "L" : "M"}${xCenter(i).toFixed(1)} ${y(val || 0).toFixed(1)}`).join(" ")}
                fill="none"
                stroke={colors.netLine}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {net.map((val, i) => (
              <circle key={i} cx={xCenter(i)} cy={y(val || 0)} r={hi === i ? 4 : 2.6} fill={v.surface} stroke={colors.netLine} strokeWidth={1.8} />
            ))}
            {labels.map((l, i) => {
              if (i % labelStep !== 0 && i !== n - 1) return null;
              return (
                <text key={i} x={xCenter(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={v.soft}>
                  {l}
                </text>
              );
            })}
            {labels.map((_, i) => (
              <rect
                key={`hit-${i}`}
                x={padL + bw * i}
                y={padT}
                width={bw}
                height={ih}
                fill="transparent"
                tabIndex={0}
                aria-label={`${labels[i]}: ${stacks.map((s) => `${s.label} ${fmtGBPc(s.values[i] || 0)}`).join(", ")}, net ${fmtGBPc(net[i] || 0)}`}
                onMouseEnter={() => setHi(i)}
                onFocus={() => setHi(i)}
                onMouseLeave={() => setHi((h) => (h === i ? null : h))}
                onBlur={() => setHi((h) => (h === i ? null : h))}
                style={{ outline: "none" }}
              />
            ))}
          </svg>
        )}
        {hi !== null &&
          w > 0 &&
          (() => {
            const anchor = Math.max(totals[hi] ?? 0, net[hi] ?? 0);
            return (
              <FinTooltip
                x={xCenter(hi)}
                y={Math.max(4, y(anchor) - 20 - stacks.length * 22)}
                chartW={w}
                title={labels[hi]}
                rows={[...stacks.map((s) => ({ label: s.label, value: fmtGBPc(s.values[hi] || 0), color: s.color })), { label: "Net", value: fmtGBPc(net[hi] || 0), color: colors.netLine }]}
              />
            );
          })()}
      </div>
    </div>
  );
}

// ===========================================================================
// 4. SpokePLTable
// ===========================================================================
type SpokeSortKey = "spoke" | "gross" | "peopleCost" | "infraCost" | "net" | "marginPct" | "costPerCase" | "completed" | "vsTarget";

function cellStyle(t: ReturnType<typeof useTheme>, align: "left" | "right" = "left"): CSSProperties {
  return { textAlign: align, padding: "8px 12px", fontSize: 12.5, color: t.ink, borderBottom: `1px solid ${t.ruleSoft}`, whiteSpace: "nowrap" };
}

export interface SpokeFinanceTarget {
  spokeId: string;
  annualNetBenefitTargetGBP: number;
}

export function SpokePLTable({
  rows,
  financeTargets,
  onSortedChange,
}: {
  rows: SpokeAgg[];
  // Per-spoke annual net benefit targets (ESTATE excluded by the caller) —
  // drives the "vs target" column below. Undefined/empty renders "—" for
  // every row rather than hiding the column, so its position never shifts.
  financeTargets?: SpokeFinanceTarget[];
  // Current sorted row order, for a caller-owned CSV export that must match
  // what's on screen (see viz.tsx's DataTable onSortedChange for the same
  // pattern).
  onSortedChange?: (rows: SpokeAgg[]) => void;
}) {
  const t = useTheme();
  const v = useViz();
  const [sort, setSort] = useState<{ key: SpokeSortKey; dir: "asc" | "desc" }>({ key: "net", dir: "desc" });

  const toggle = (key: SpokeSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const targetMap = useMemo(() => new Map((financeTargets ?? []).map((f) => [f.spokeId, f.annualNetBenefitTargetGBP])), [financeTargets]);
  const vsTargetPct = (r: SpokeAgg): number | undefined => {
    const target = targetMap.get(r.spoke);
    return target ? r.fyToDateNet / target : undefined;
  };

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const va = sort.key === "vsTarget" ? (vsTargetPct(a) ?? -Infinity) : a[sort.key as Exclude<SpokeSortKey, "vsTarget">];
        const vb = sort.key === "vsTarget" ? (vsTargetPct(b) ?? -Infinity) : b[sort.key as Exclude<SpokeSortKey, "vsTarget">];
        const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === "asc" ? cmp : -cmp;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort.key, sort.dir, targetMap],
  );

  useEffect(() => onSortedChange?.(sorted), [sorted, onSortedChange]);

  const totals = rows.reduce(
    (acc, r) => {
      acc.gross += r.gross;
      acc.peopleCost += r.peopleCost;
      acc.infraCost += r.infraCost;
      acc.cost += r.cost;
      acc.net += r.net;
      acc.completed += r.completed;
      return acc;
    },
    { gross: 0, peopleCost: 0, infraCost: 0, cost: 0, net: 0, completed: 0 },
  );
  const totalsMarginPct = totals.gross ? totals.net / totals.gross : 0;
  const totalsCostPerCase = totals.completed ? totals.cost / totals.completed : 0;

  const columns: { key: SpokeSortKey; header: string; align?: "left" | "right" }[] = [
    { key: "spoke", header: "Spoke" },
    { key: "gross", header: "Gross", align: "right" },
    { key: "peopleCost", header: "People cost", align: "right" },
    { key: "infraCost", header: "Infra cost", align: "right" },
    { key: "net", header: "Net", align: "right" },
    { key: "marginPct", header: "Margin %", align: "right" },
    { key: "costPerCase", header: "Cost/case", align: "right" },
    { key: "completed", header: "Completed cases", align: "right" },
    { key: "vsTarget", header: "vs target (FYTD)", align: "right" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", minHeight: 0 }}>
      <div style={{ overflow: "auto", flex: 1, minHeight: 0, border: `1px solid ${t.ruleSoft}`, borderRadius: 9 }}>
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
                    fontFamily: fonts.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: sort.key === c.key ? t.ink : t.inkSoft,
                    fontWeight: 700,
                    borderBottom: `1px solid ${t.ruleSoft}`,
                    whiteSpace: "nowrap",
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
              <th
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: t.paper,
                  fontFamily: fonts.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: t.inkSoft,
                  fontWeight: 700,
                  borderBottom: `1px solid ${t.ruleSoft}`,
                  padding: "9px 12px",
                  whiteSpace: "nowrap",
                }}
              >
                12-week trend
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.spoke} style={{ background: i % 2 ? t.themeBand : "transparent" }}>
                <td style={cellStyle(t)}>{r.spoke}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(r.gross)}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(r.peopleCost)}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(r.infraCost)}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(r.net)}</td>
                <td style={cellStyle(t, "right")}>{r.gross ? fmtPct(r.marginPct) : "—"}</td>
                <td style={cellStyle(t, "right")}>{r.completed ? fmtMoney2(r.costPerCase) : "—"}</td>
                <td style={cellStyle(t, "right")}>{fmtInt(r.completed)}</td>
                <td style={{ ...cellStyle(t, "right"), color: vsTargetPct(r) === undefined ? t.inkSoft : vsTargetPct(r)! >= 1 ? v.good : v.bad, fontWeight: 700 }}>
                  {vsTargetPct(r) === undefined ? "—" : fmtPct(vsTargetPct(r)!)}
                </td>
                <td style={cellStyle(t, "right")}>
                  {r.netTrend12w.length >= 2 ? (
                    <Sparkline data={r.netTrend12w} color={r.netTrend12w[r.netTrend12w.length - 1] >= r.netTrend12w[0] ? v.good : v.bad} />
                  ) : (
                    <span style={{ color: t.inkFaint }}>—</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} style={{ padding: "22px 12px", textAlign: "center", color: t.inkSoft, fontSize: 13 }}>
                  No rows for the current filters.
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: `2px solid ${t.ink}`, fontWeight: 700 }}>
                <td style={cellStyle(t)}>Total</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(totals.gross)}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(totals.peopleCost)}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(totals.infraCost)}</td>
                <td style={cellStyle(t, "right")}>{fmtGBPc(totals.net)}</td>
                <td style={cellStyle(t, "right")}>{totals.gross ? fmtPct(totalsMarginPct) : "—"}</td>
                <td style={cellStyle(t, "right")}>{totals.completed ? fmtMoney2(totalsCostPerCase) : "—"}</td>
                <td style={cellStyle(t, "right")}>{fmtInt(totals.completed)}</td>
                <td style={cellStyle(t, "right")}>—</td>
                <td style={cellStyle(t, "right")}>—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
