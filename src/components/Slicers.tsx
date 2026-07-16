import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { IconChevron } from "./icons";
import { useFilters, DATA_MIN_ISO, DATA_MAX_ISO } from "../filters-context";
import type { RangePreset } from "../filters-context";
import { SPOKES, SPOKE_INFO, QUEUES, TAGS } from "../rpaData";
import { useReference } from "../reference/reference-context";

const shortISO = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

// A slicer popover: a labelled trigger that opens a panel of options. Used for
// every dropdown in the filter bar so they look and behave identically.
function Slicer({ label, summary, active, children, width = 178, first }: { label: string; summary: string; active: boolean; children: (close: () => void) => ReactNode; width?: number; first?: boolean }) {
  // `width` now only sizes the dropdown *panel* (a sensible floor for its
  // content) — the trigger button itself stretches to fill its grid track
  // (see FilterBar's grid-template-columns) so the six slicers share the
  // full bar width proportionally instead of sitting at fixed pixel widths.
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={box} style={{ position: "relative", minWidth: 0 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: "0.09em", textTransform: "uppercase", color: t.inkSoft, marginBottom: 3, fontWeight: 600 }}>{label}</div>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        {...(first ? { "data-first-slicer": "true" } : {})}
        style={{
          width: "100%",
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: fonts.body,
          fontSize: 13,
          padding: "7px 10px",
          borderRadius: 8,
          border: `1px solid ${active ? t.accent : t.ruleSoft}`,
          background: active ? `${t.accent}14` : t.themeBand,
          color: t.ink,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: active ? 700 : 400 }}>{summary}</span>
        <IconChevron size={13} style={{ color: t.inkSoft, transition: "transform .15s", transform: open ? "rotate(-90deg)" : "rotate(90deg)" }} />
      </button>
      {open && (
        <div
          className="dropdown-panel"
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            left: 0,
            zIndex: 30,
            minWidth: width,
            maxWidth: 280,
            maxHeight: 320,
            overflow: "auto",
            background: t.paper,
            border: `1px solid ${t.ruleSoft}`,
            boxShadow: t.shadow,
            borderRadius: 10,
            padding: 5,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  const t = useTheme();
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        textAlign: "left",
        fontFamily: fonts.body,
        fontSize: 13,
        padding: "7px 9px",
        borderRadius: 7,
        border: "none",
        background: selected ? t.themeBand : "transparent",
        color: t.ink,
        cursor: "pointer",
        fontWeight: selected ? 700 : 400,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = t.themeBand)}
      onMouseLeave={(e) => (e.currentTarget.style.background = selected ? t.themeBand : "transparent")}
    >
      <span style={{ width: 13, height: 13, flex: "0 0 auto", borderRadius: 4, border: `1.5px solid ${selected ? t.accent : t.ruleSoft}`, background: selected ? t.accent : "transparent", display: "grid", placeItems: "center", color: t.paper, fontSize: 9, fontWeight: 900 }}>{selected ? "✓" : ""}</span>
      {children}
    </button>
  );
}

const RANGES: { v: RangePreset; label: string }[] = [
  { v: 7, label: "Last 7 days" },
  { v: 30, label: "Last 30 days" },
  { v: 90, label: "Last 90 days" },
  { v: "ytd", label: "Year to date" },
  { v: "all", label: "All time" },
  { v: "custom", label: "Custom range…" },
];

function defaultCustomFrom() {
  const d = new Date(DATA_MAX_ISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 29);
  return d.toISOString().slice(0, 10);
}

// Spoke identity (SPOKES/SPOKE_INFO) is populated once from model.json at
// load — a spoke added via Administration lives only in the reference-data
// overlay until the next data build. Merging it in here (name + colour only —
// it naturally has no processes/activity yet) is what makes "add a spoke in
// Administration" plug-and-play for the slicer, per that page's spec.
function useSlicerSpokes(): { names: string[]; info: Record<string, { short: string; light: string; dark: string }> } {
  const { reference } = useReference();
  const names = [...SPOKES];
  const info = { ...SPOKE_INFO };
  for (const s of reference.spokes) {
    if (!names.includes(s.spokeName)) names.push(s.spokeName);
    if (!info[s.spokeName]) info[s.spokeName] = { short: s.shortName, light: s.colorLight, dark: s.colorDark };
  }
  return { names, info };
}

export function FilterBar() {
  const { filters, setFilters, processOptions, propositionOptions } = useFilters();
  const t = useTheme();
  const { names: spokeNames, info: spokeInfo } = useSlicerSpokes();

  return (
    <div
      style={{
        display: "grid",
        // Six slicers share the bar's full width proportionally instead of
        // sitting at fixed pixel widths with a long empty run to the right.
        // Fields with longer content (process name, custom date range) get a
        // slightly larger fraction; each still floors at a legible minimum so
        // nothing clips at narrower viewports.
        gridTemplateColumns:
          "minmax(150px,1fr) minmax(150px,1fr) minmax(170px,1.3fr) minmax(140px,0.85fr) minmax(140px,0.85fr) minmax(160px,1.15fr)",
        gap: 14,
        alignItems: "end",
      }}
    >
      <Slicer label="Spoke" active={filters.spoke !== "All"} summary={filters.spoke === "All" ? "All spokes (hub)" : filters.spoke} width={190} first>
        {(close) => (
          <>
            <Option selected={filters.spoke === "All"} onClick={() => { setFilters({ spoke: "All", proposition: "All", processId: "All", queue: "All" }); close(); }}>All spokes (hub)</Option>
            {spokeNames.map((s) => {
              const c = spokeInfo[s]?.[t.mode === "dark" ? "dark" : "light"];
              return (
                <Option key={s} selected={filters.spoke === s} onClick={() => { setFilters({ spoke: s, proposition: "All", processId: "All", queue: "All" }); close(); }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: c, flex: "0 0 auto" }} />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s}</span>
                  </span>
                </Option>
              );
            })}
          </>
        )}
      </Slicer>

      <Slicer label="Proposition" active={filters.proposition !== "All"} summary={filters.proposition === "All" ? "All propositions" : filters.proposition}>
        {(close) => (
          <>
            <Option selected={filters.proposition === "All"} onClick={() => { setFilters({ proposition: "All", processId: "All", queue: "All" }); close(); }}>All propositions</Option>
            {propositionOptions.map((p) => (
              <Option key={p} selected={filters.proposition === p} onClick={() => { setFilters({ proposition: p, processId: "All", queue: "All" }); close(); }}>{p}</Option>
            ))}
          </>
        )}
      </Slicer>

      <Slicer label="Process name" active={filters.processId !== "All"} summary={filters.processId === "All" ? "All processes" : processOptions.find((p) => p.id === filters.processId)?.name ?? "All processes"} width={200}>
        {(close) => (
          <>
            <Option selected={filters.processId === "All"} onClick={() => { setFilters({ processId: "All", queue: "All" }); close(); }}>All processes</Option>
            {processOptions.map((p) => (
              <Option key={p.id} selected={filters.processId === p.id} onClick={() => { setFilters({ processId: p.id, queue: "All" }); close(); }}>{p.name}</Option>
            ))}
          </>
        )}
      </Slicer>

      <Slicer label="Queue name" active={filters.queue !== "All"} summary={filters.queue === "All" ? "All queues" : filters.queue} width={140}>
        {(close) => (
          <>
            <Option selected={filters.queue === "All"} onClick={() => { setFilters({ queue: "All" }); close(); }}>All queues</Option>
            {QUEUES.map((q) => (
              <Option key={q} selected={filters.queue === q} onClick={() => { setFilters({ queue: q }); close(); }}>{q}</Option>
            ))}
          </>
        )}
      </Slicer>

      <Slicer label="Tags" active={filters.tags.length > 0} summary={filters.tags.length === 0 ? "All tags" : filters.tags.length === 1 ? filters.tags[0] : `${filters.tags.length} tags`} width={150}>
        {() => (
          <>
            <Option selected={filters.tags.length === 0} onClick={() => setFilters({ tags: [] })}>All tags</Option>
            {TAGS.map((tag) => {
              const on = filters.tags.includes(tag);
              return (
                <Option key={tag} selected={on} onClick={() => setFilters({ tags: on ? filters.tags.filter((x) => x !== tag) : [...filters.tags, tag] })}>{tag}</Option>
              );
            })}
          </>
        )}
      </Slicer>

      <Slicer
        label="Date range"
        active={filters.range !== 90}
        width={168}
        summary={filters.range === "custom" && filters.from && filters.to ? `${shortISO(filters.from)} – ${shortISO(filters.to)}` : RANGES.find((r) => r.v === filters.range)?.label ?? "Last 90 days"}
      >
        {(close) => (
          <>
            {RANGES.map((r) => (
              <Option
                key={String(r.v)}
                selected={filters.range === r.v}
                onClick={() => {
                  if (r.v === "custom") {
                    setFilters({ range: "custom", from: filters.from ?? defaultCustomFrom(), to: filters.to ?? DATA_MAX_ISO });
                  } else {
                    setFilters({ range: r.v });
                    close();
                  }
                }}
              >
                {r.label}
              </Option>
            ))}
            {filters.range === "custom" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "8px 7px 4px", marginTop: 4, borderTop: `1px solid ${t.ruleSoft}` }}>
                {([["From", "from"], ["To", "to"]] as const).map(([lbl, key]) => (
                  <label key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: "0.05em", textTransform: "uppercase", color: t.inkSoft }}>
                    {lbl}
                    <input
                      type="date"
                      min={DATA_MIN_ISO}
                      max={DATA_MAX_ISO}
                      value={filters[key] ?? (key === "from" ? defaultCustomFrom() : DATA_MAX_ISO)}
                      onChange={(e) => setFilters({ [key]: e.target.value } as any)}
                      style={{ fontFamily: fonts.body, fontSize: 12, padding: "4px 6px", borderRadius: 6, border: `1px solid ${t.ruleSoft}`, background: t.themeBand, color: t.ink, outline: "none", colorScheme: t.mode === "dark" ? "dark" : "light" }}
                    />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </Slicer>
    </div>
  );
}
