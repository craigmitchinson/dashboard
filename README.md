# Innovation & modernisation pack

Fixed-dimension (1920×1080, 16:9) slides for a **navigable pack of innovation
use cases**. React + Vite + TypeScript, no backend.

The pack opens on a **Contents** page that presents five bets in a deliberate
sequence. Each bet is its own six-slide story arc you can open and walk, so the
reader keeps the same rhythm throughout. Four bets are innovation, one
(clicks-to-code) is modernisation.

- **01 Observability** *(innovation)*: make the cross-system journey visible and
  measurable, and stand up the event backbone the rest reuse.
- **02 Capability agents** *(innovation)*: solve one high-volume task across the
  whole estate rather than automating journeys one at a time.
- **03 Decision-grounding** *(innovation)*: a read-only agent that answers over our
  rules and shows the source behind each answer.
- **04 Knowledge graph** *(innovation)*: resolve entities and relationships across
  systems never built to reconcile.
- **05 Clicks-to-code** *(modernisation)*: move business logic out of brittle UI
  automation into governed, reusable services.

The spine: observability leads, because it builds two pieces of shared
infrastructure the others reuse, the persistent correlation identity (which the
graph later resolves) and the Kafka event backbone (which the agents subscribe to
and the decoupled services publish to). OpenTelemetry is the instrumentation
standard, Kafka is the event backbone, and Dynatrace is the observation layer;
the pack keeps the three distinct.

Navigation: the **use-case rail** (Contents, then 01 to 05) switches bet; the
**slide tabs** below move within the open bet; **left / right arrows** move
between slides. The pack model lives in [src/App.tsx](src/App.tsx); the corner
label per bet comes from [src/pack-context.ts](src/pack-context.ts). New bets live
under [src/slides/](src/slides/) (prefixes: Cap, Dg, Gr for bets 2 to 4).

## Use case 01 — Observability ([src/slides/](src/slides/))

1. **Blind spot** ([src/slides/BlindSpot.tsx](src/slides/BlindSpot.tsx)) — opens on
   a real case crossing the estate (public site → IVR → colleague desktop →
   automation → forms → business-team queue → letters → finance) with the blind
   handoffs marked. Today the picture is reconstructed by hand; no one owns or
   measures the journey end to end.
2. **The idea** ([src/slides/Idea.tsx](src/slides/Idea.tsx)) — one shared identifier
   stamped on each step's event stitches the case into a single live timeline. What
   that gives the business: where every case is, where they fail, what each stage
   costs.
3. **What we'd see** ([src/slides/Board.tsx](src/slides/Board.tsx)) — the operations
   view: end-to-end KPIs, a "where the time goes" ribbon, a per-stage table (time,
   wait between steps, cost, health) and an auto-detected anomaly + alert column.
   Reads from [src/journeyData.ts](src/journeyData.ts).
4. **Why back it** ([src/slides/WorthBacking.tsx](src/slides/WorthBacking.tsx)) —
   proven tools (low technical risk), a new target (the value), correlation as the
   real engineering; with the end-to-end pipeline (Origin → OTel → Kafka →
   Collector → Dynatrace) alongside.
5. **How we'd start** ([src/slides/Approach.tsx](src/slides/Approach.tsx)) — one
   high-value segment sized by value, the de-risking first move (prove the
   identifier carries), and the small specialist team paired to our estate.
6. **Why it matters** ([src/slides/WhyItMatters.tsx](src/slides/WhyItMatters.tsx)) —
   observability as management information, visible *and* defensible, a clear-eyed
   look at the risks, and the ask.

## Use case 02 — Clicks-to-code

1. **Fragility** ([src/slides/CcFragility.tsx](src/slides/CcFragility.tsx)) — we
   automate the screen, not the system: it breaks when screens change, and the
   logic is trapped in the platform (the monolith).
2. **The idea** ([src/slides/CcExtract.tsx](src/slides/CcExtract.tsx)) — lift the
   logic into services; one service, many callers; drive APIs where they exist.
3. **Target shape** ([src/slides/CcArchitecture.tsx](src/slides/CcArchitecture.tsx)) —
   before/after: Blue Prism for UI only, Power Platform for what it's good at,
   microservices for logic — plus the four commercial benefits.
4. **Why back it** ([src/slides/CcModernisation.tsx](src/slides/CcModernisation.tsx)) —
   modernisation, deliberately, not innovation: proven patterns, low risk, the
   accurate word that survives Audit.
5. **How we'd start** ([src/slides/CcApproach.tsx](src/slides/CcApproach.tsx)) —
   selective decoupling, three named services and a pattern, paired delivery —
   framed as the three risks it is built to handle.
6. **Why it matters** ([src/slides/CcMatters.tsx](src/slides/CcMatters.tsx)) — how
   it serves observability (services are observable by design), the baseline that
   makes it fundable, and the ask.

## The observability worked example

The journey itself ([src/journeyData.ts](src/journeyData.ts)) is the realistic
public→business-team path — public website, IVR, colleague desktop, automation,
low-code forms, a business-team queue, human review, letters/email, finance —
with illustrative times, costs and failure rates that the Dynatrace and Anomalies
slides render. Edit that one file to change the worked example everywhere.

## Deck chrome

- **Tabs / arrow keys** navigate the deck; the active slide fills the fixed canvas.
- **Present mode** ("Present") hides the editing chrome, enlarges the slide and
  navigates by tabs or ←/→; Escape (or "Exit present") leaves.
- **Spotlight** lifts any block (`data-spot`) above a scrim to focus the room on
  one thing as you talk; click another to move it, click again to clear.
- **Light / dark** toggle switches the whole slide and the surrounding chrome in
  step; no component holds a literal colour.
- **Export PPTX** captures every slide at 2× (3840×2160) using the browser's own
  rendering and assembles a 16:9 `.pptx`, one full-bleed image per slide, so the
  formatting is preserved exactly (slides are images, not editable PPTX text).
  Uses two lazy-loaded, pure-JS packages (`html-to-image`, `pptxgenjs`).
- **Persistence**: the active slide and light/dark mode are saved to
  `localStorage` and restored on reload.

## How it is built

- **Shell + primitives** ([src/components/Shell.tsx](src/components/Shell.tsx)):
  `SlideFrame` supplies the common header (eyebrow, display title with a red full
  stop, standing brand mark + slide number). Slides compose small primitives
  (`Panel`, `Bullets`, `Tag`, `StatBig`, `Arrow`, `Body`) so the look is defined
  once and cannot drift.
- **Journey strip** ([src/components/JourneyStrip.tsx](src/components/JourneyStrip.tsx)):
  the five-system journey, rendered with the blind handoffs ("blind" mode) or the
  single correlation thread ("thread" mode).
- **Brand** ([src/theme.ts](src/theme.ts)): every colour, font and spacing token
  lives in one file, in a light and a dark variant supplied through a small
  context ([src/theme-context.ts](src/theme-context.ts)). The palette's five
  nesting tones tint the architecture layers; its three states carry
  success / neutral / failure semantics (`statusKey`). Fonts are self-hosted web
  fonts ([src/fonts/](src/fonts/)): Gelasio (Georgia), Carlito (Calibri),
  JetBrains Mono (Consolas).

## Run

```bash
npm install
npm run dev      # open the printed localhost URL
npm run build    # type-check + production build into dist/
```

The slide is centred on a neutral page and scaled to fit the viewport for
on-screen viewing only. The internal layout is always authored at 1920×1080, so a
capture of the `.slide-frame` element at `deviceScaleFactor: 2` (which is what the
PPTX export does) produces a clean 3840×2160 image.
