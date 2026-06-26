# Roadmap pack

Fixed-dimension (1920x1080, 16:9) slides for a presentation pack, switched via
tabs at the top. React + Vite + TypeScript, no backend.

- **Roadmap** ([src/components/Slide.tsx](src/components/Slide.tsx)): a five-level
  hierarchical roadmap as vertically aligned columns.
- **Summary** ([src/components/SummarySlide.tsx](src/components/SummarySlide.tsx)):
  the executive opener. Headline stat cards (objectives RAG split, delivery
  predictability, blocked dependencies + escalations, high risks) are derived
  automatically from the other tabs for the selected quarter, so they cannot drift.
  Below that, a one-line headline (human-entered) and a split story that is
  derived from the other tabs: Highlights (delivery highlights + on-track
  objectives), Watch-outs (off-track objectives, blocked dependencies, high risks,
  escalations) and Next quarter focus (at-risk/off-track objectives + next-quarter
  incoming dependencies). A "Decisions needed" panel holds the asks (each with a
  team owner). So the only free text is the headline and the asks; everything else
  reflects the real data.
- **Objectives** ([src/components/ObjectivesSlide.tsx](src/components/ObjectivesSlide.tsx)):
  objectives and key results with RAG status (on track / at risk / off track,
  reusing the status palette). Click a status dot to cycle it; key results carry a
  freeform progress metric. Per quarter.
- **Delivery** ([src/components/DeliverySlide.tsx](src/components/DeliverySlide.tsx)):
  a three-quarter trend (the selected quarter and the two before it) with rows for
  features committed, features delivered, committed features delivered (with a
  predictability %) and total throughput, each cell editable with a trend bar; the
  current quarter shows commitments but no delivered metrics yet. On the right, a
  per-quarter Delivery highlights panel (team › what they delivered). Metrics are
  keyed by quarter so each column edits that quarter's data.
- **Dependencies** ([src/components/DependenciesSlide.tsx](src/components/DependenciesSlide.tsx)):
  number cards (total / Committed / Not committed / Blocked) across the top, then
  cross-team dependencies grouped by time horizon into Committed / Not committed /
  Blocked lanes (lanes spread to fill the panel height). Each item carries a clear
  origin badge ("New" for incoming, "Carried" for existing); click it to toggle,
  or the status control to recategorise. The right column stacks an Escalations
  commentary panel and a Risks panel with High / Medium / Low severity.

The QBR eyebrow on each slide is a **quarter picker**
([src/components/QuarterPicker.tsx](src/components/QuarterPicker.tsx)): it looks
like plain eyebrow text but opens a quarter menu on click. The selected quarter is
shared across the pack and drives the "Quarterly business review · Q3 '26" label
and the dependencies horizon titles ("This quarter (Q3) and previous" / "Next
quarter (Q4) and beyond", where next is the quarter after).

- **Charts** ([src/components/ChartsSlide.tsx](src/components/ChartsSlide.tsx)): a
  year-to-date performance view as a 2x2 grid: YTD totals plus committed-vs-delivered,
  predictability (with a dashed 80% target line), throughput and an objectives RAG
  trend (a stacked on-track / at-risk / off-track bar per quarter) across all four
  quarters of the selected year (CSS bars, no chart library). Derived from delivery
  and objectives, so it is read-only. The real current quarter is marked. Being a
  tab, it is part of the deck and the PPTX export.

**Current-quarter anchor.** The quarter picker marks today's real quarter with a
"Now" badge and ring, so there is always an anchor point regardless of which
quarter is selected.

**Spotlight.** The "Spotlight" toggle (in the bar and in present mode) lets you
click any block on any tab to lift it and dim the rest, with a subtle animation,
so you can focus the room on one thing as you talk. Clicking another block moves
the spotlight; clicking it again clears it. Blocks are marked with `data-spot`.

**Persistence.** The whole pack is saved to `localStorage` and restored on reload,
so edits are not lost.

**Present mode.** The "Present" button hides all the editing chrome (utility bar,
actions, per-cell controls, pickers), enlarges the slide to fill the viewport, and
locks the slide so clicks do not start editing. Navigate with the tabs or the
left/right arrow keys; Escape (or "Exit present") leaves.

**Export to PowerPoint.** The "Export PPTX" button (top utility bar) captures all
six slides for the selected quarter at 2x (3840x2160) using the browser's own
rendering, and assembles a 16:9 `.pptx` with one full-bleed image per slide, so
nothing of the formatting, structure or quality is lost. Editing affordances are
hidden during capture. It uses two lazy-loaded, pure-JS packages
(`html-to-image`, `pptxgenjs`); the slides are images in the deck, so they look
identical but are not editable as PowerPoint text. Export reflects the current
light/dark mode.

The page chrome puts a quiet utility bar on top (app label, contextual hint,
dark-mode toggle) and the **tabs directly above the slide** with that slide's
contextual actions on the right, so navigation sits next to the artefact.

The **team** is a dropdown ([src/components/TeamPicker.tsx](src/components/TeamPicker.tsx))
backed by a shared, editable list of teams: pick one, add a new team, or delete
teams. It is used for the org team and for each delivery highlight, so team names
stay consistent across the pack. The Dependencies and Delivery slides size their
content to fill the space (metrics fill the height; dependency rows grow when a
panel is sparse and tighten when full).

**Content is per team and per quarter.** Everything is keyed by `team#quarter`
([src/teamdata.ts](src/teamdata.ts)); pick a team and a quarter to see only that
team's content, and it persists per team. The team selector (in the org block)
also offers **All teams**, a read-only roll-up that aggregates every team's data
for the quarter (objectives, dependencies, delivery summed, highlights, asks) for
senior reporting. The roadmap roll-up merges by name at every level (theme, outcome, epic,
feature, value), so identical items from different teams collapse into one and
nothing is ever duplicated. A new team + quarter starts empty. On an empty quarter a
"Copy structure from {previous quarter}" button carries the previous quarter's
theme / outcome / epic scaffolding forward (with refs, under fresh ids), leaving
features and values to fill in. "Reset quarter" empties the current quarter;
"Populate examples" drops in the seed template. The **org identity** (Platform >
Lab > Team,
[src/components/OrgIdentity.tsx](src/components/OrgIdentity.tsx)) is global
instead: editing it on any slide updates it everywhere, across both tabs and every
quarter.

## Run

```bash
npm install
npm run dev      # open the printed localhost URL
npm run build    # type-check + production build into dist/
```

The slide is centred on a neutral page and scaled to fit the viewport for
on-screen viewing only. The internal layout is always authored at 1920x1080, so
a Playwright capture of the `.slide-frame` element at `deviceScaleFactor: 2`
produces a clean 3840x2160 PNG. (Capture itself is out of scope here.)

## How it is built

- **Data shape** ([src/types.ts](src/types.ts)): the roadmap is a five-level tree,
  Theme > Outcome > Epic > Feature > Value (Value held inline on each Feature).
  Seed content is in [src/data.ts](src/data.ts) with deliberately uneven branch
  depths.
- **Alignment logic** ([src/layout.ts](src/layout.ts)): a Value is the base unit
  of height (a Feature can hold several Values). The whole slide is one CSS grid,
  five columns wide and as many rows tall as there are leaves. Every node spans a
  number of rows equal to the count of leaves beneath it, so each parent is
  exactly as tall as its descendants and sits centred against them. Nothing is
  hard-positioned; change the data and the spans recompute. Rows size to their
  content, so a cell with more than one line of text expands vertically and the
  whole branch re-aligns.
- **Visual linkage**: containment is shown with bracket-style grouping, not
  connector lines. Each box has a coloured left rail, and because a parent box
  spans the full height of its children its left edge reads as a bracket around
  the group. A subtle alternating tint band per theme lets the eye track a theme
  across all five columns.
- **Brand** ([src/theme.ts](src/theme.ts)): every colour, font and spacing token
  lives in one file so the look cannot drift. Fonts are self-hosted web fonts
  ([src/fonts/](src/fonts/)) for deterministic rendering: Gelasio (Georgia),
  Carlito (Calibri), JetBrains Mono (Consolas).
- **Light and dark modes**: the token file ships a light and a dark variant of
  the same palette, supplied to the render layer through a small context
  ([src/theme-context.ts](src/theme-context.ts)). The toolbar toggle switches the
  whole slide and the surrounding chrome in step; no component holds a literal
  colour.
- **Editing** ([src/components/EditableCell.tsx](src/components/EditableCell.tsx)):
  click any cell to edit text inline (Enter commits, Shift+Enter adds a line,
  Escape reverts). The slide chrome (kicker, title, team) is editable too. Hover a
  cell for its controls: up/down arrows reorder it among its siblings, `+` adds a
  child (theme adds an outcome, outcome an epic, epic a feature, feature a value)
  and `x` removes the entry. `+ Theme` in the toolbar adds a top-level theme.
  Mutations are immutable ([src/mutations.ts](src/mutations.ts)), so any edit,
  reorder, add or remove re-flows and re-aligns the whole slide automatically.
- **Jira references**: outcomes, epics and features carry a tracker ref
  (e.g. "ONB-1201"), shown as a muted mono label inline before the title and
  always visible. Being inline, it shares the title's line, so it never adds
  height or shifts the layout; an unset ref shows a faint "REF" hint to fill in.
- **Fixed canvas with a capacity warning**: the slide never grows past 1920x1080
  in any direction. The body measures the grid's natural height against the space
  available and reports a status to the toolbar (off the slide): nothing when
  there is room, "Slide is nearly full" when close, and "Content exceeds the
  slide" with a clipped count once content no longer fits.
- **Dulled placeholders**: a node with no children (a feature with no values, an
  epic with no features, and so on) is dimmed so the populated content stays
  prominent. Hovering or focusing it restores it for editing.

State lives in component state with a clean JSON shape (`Roadmap`) so persistence
can be added later without touching the render layer.
