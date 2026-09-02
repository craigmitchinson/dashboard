// ---------------------------------------------------------------------------
// Brand theme tokens
// ---------------------------------------------------------------------------
import type { CSSProperties } from "react";

// Every colour, font and spacing value lives here so the look is defined once
// and cannot drift. Fonts, spacing and the type scale are shared across modes;
// colours come in a light and a dark variant. Components never use literal
// colours: they read the active variant from the theme context.

export type Mode = "light" | "dark";

// Palette band keys for a three-state (good / neutral / bad) status scale,
// used for status dots, rails and surfaces across the dashboard (e.g.
// exception/health indicators).
export type DepStatus = "committed" | "not-committed" | "blocked";

// Raw brand swatches. Referenced only to build the variants below.
const swatch = {
  teal: "#0B3239",
  red: "#FF222F",
  redWarm: "#E0432E",
  paper: "#FAF7F2",
  darkPink: "#FFCCD9",
  darkPurple: "#DDBBFF",
  digitalGrey: "#F8F8F8",
  lightPink: "#FFE2E8",
  lightPurple: "#EDE9FF",
  white: "#FFFFFF",
} as const;

// Fonts flow through CSS variables (defined in styles.css) so an accessibility
// mode can swap a face for the whole app from one place. The real families:
//   --font-display: Gelasio (serif)  --font-body: Carlito  --font-mono: JetBrains
export const fonts = {
  display: "var(--font-display)",
  body: "var(--font-body)",
  mono: "var(--font-mono)",
} as const;

// Dependency status treatment (committed / not committed / blocked).
export interface StatusStyle {
  dot: string;
  rail: string;
  surface: string;
  text: string;
}

// The full set of semantic tokens for one mode. The render layer only ever
// touches these names, so light and dark stay perfectly in step.
export interface ThemeTokens {
  mode: Mode;
  /** Neutral area around the app canvas. */
  page: string;
  /** Card/page background. */
  paper: string;
  /** Primary text. */
  ink: string;
  /** Muted text (kickers, legends). */
  inkSoft: string;
  /** Faint rules and hairlines. */
  inkFaint: string;
  /** Accent red, emphasis only. */
  accent: string;
  /** Warm accent red. */
  accentSoft: string;
  /** Darker accent for FILLED controls carrying white text — must hold ≥4.5:1 vs #fff. */
  accentFill: string;
  /** Strong rule under the title. */
  rule: string;
  /** Soft rule below the column headers. */
  ruleSoft: string;
  /** Alternating band tint behind every other theme. */
  themeBand: string;
  /** Card drop shadow. */
  shadow: string;
  /** The three-state committed/not-committed/blocked scale, PLUS two flat
   *  semantic colours (`positive`/`warn`) for KPI deltas, alert severities
   *  etc. — theme.ts previously had no amber/warn tone at all (App.tsx's
   *  Report() picked a literal per-mode amber inline rather than introduce
   *  one here; now centralised). Both are ≥4.5:1 against `paper` (see the
   *  ratios noted next to each value below). */
  status: Record<DepStatus, StatusStyle> & { positive: string; warn: string };
  /** Neutral chart/series ink — the default line/bar colour when a viz has no
   *  semantic status mapping of its own. Not the brand accent (that's
   *  reserved for emphasis), and not spoke-aware. */
  series: string;
  /** Active spoke colour (mode-appropriate), or undefined on the hub view.
   *  Set by ThemedReport (src/App.tsx) from SPOKE_INFO — NOT folded into
   *  `accent`/`accentSoft` any more (that was a WCAG failure: it silently
   *  recoloured every accent-reading control, including ones never audited
   *  against the brand red's contrast pairing, to an arbitrary spoke hex).
   *  Consumers that want spoke identity (nav active state, and — per the
   *  pages-half of this pass — admin tabs/buttons/KPI accents) read this
   *  explicitly and fall back to `accent` themselves via `t.spoke ?? t.accent`.
   */
  spoke?: string;
}

export const lightTheme: ThemeTokens = {
  mode: "light",
  page: "#ECE8E1",
  paper: swatch.paper,
  ink: swatch.teal,
  inkSoft: "rgba(11,50,57,0.68)", // ~4.94:1 vs paper #FAF7F2 (was 0.5 alpha / ~3.0:1 — failed AA)
  inkFaint: "rgba(11,50,57,0.15)",
  accent: swatch.red,
  accentSoft: swatch.redWarm,
  accentFill: "#C81E2B", // white text on this = ~5.7:1 (brand red #FF222F is only ~3.6:1 — fails AA)
  rule: swatch.teal,
  ruleSoft: "rgba(11,50,57,0.15)",
  themeBand: "rgba(11,50,57,0.035)",
  shadow: "0 24px 60px rgba(11,50,57,0.22)",
  status: {
    committed: { dot: swatch.teal, rail: swatch.teal, surface: "rgba(11,50,57,0.05)", text: swatch.teal },
    "not-committed": { dot: "#8A6FB0", rail: swatch.darkPurple, surface: swatch.lightPurple, text: swatch.teal },
    blocked: { dot: swatch.red, rail: swatch.redWarm, surface: swatch.lightPink, text: swatch.teal },
    // positive #0F766E vs paper #FAF7F2 = ~5.13:1 (AA)
    positive: "#0F766E",
    // warn #B45309 vs paper #FAF7F2 = ~4.70:1 (AA, thin margin — deliberately
    // darkened off the raw amber swatch to clear the bar, same convention as
    // accentFill's comment above)
    warn: "#B45309",
  },
  series: swatch.teal,
};

// Dark variant: a deep teal canvas with cream ink. The reds are nudged
// brighter to keep their punch against the dark ground.
const darkInk = "#F4F1EB";
export const darkTheme: ThemeTokens = {
  mode: "dark",
  page: "#071316",
  paper: "#0C2329",
  ink: darkInk,
  inkSoft: "rgba(244,241,235,0.55)",
  inkFaint: "rgba(244,241,235,0.16)",
  accent: "#FF3B43",
  accentSoft: "#FF6A4D",
  accentFill: "#D2262F", // white text on this = ~5.2:1; slightly brighter than light-mode fill to keep punch on the dark ground
  rule: "rgba(244,241,235,0.85)",
  ruleSoft: "rgba(244,241,235,0.18)",
  themeBand: "rgba(255,255,255,0.05)",
  shadow: "0 24px 60px rgba(0,0,0,0.5)",
  status: {
    committed: { dot: "#86C7BD", rail: "#86C7BD", surface: "rgba(134,199,189,0.12)", text: darkInk },
    "not-committed": { dot: "#C9B3F0", rail: swatch.darkPurple, surface: "rgba(221,187,255,0.14)", text: "#EFE7FF" },
    blocked: { dot: "#FF6A6F", rail: "#FF6A4D", surface: "rgba(255,178,198,0.13)", text: "#FFE3EA" },
    // positive #86C7BD vs paper #0C2329 = ~8.48:1 (AA)
    positive: "#86C7BD",
    // warn #F59E0B vs paper #0C2329 = ~7.59:1 (AA)
    warn: "#F59E0B",
  },
  series: "#86C7BD",
};

export const themes: Record<Mode, ThemeTokens> = {
  light: lightTheme,
  dark: darkTheme,
};

// ---------------------------------------------------------------------------
// Type scale / spacing / radius tokens
// ---------------------------------------------------------------------------
// Numeric mirrors of the CSS custom properties defined at :root in
// styles.css (search that file for "design-elevation P0 tokens") — this app
// is almost entirely inline px (not rem/CSS custom properties) so the pages
// half of this pass consumes these as plain numbers/CSSProperties fragments
// rather than `var(--t-body-m)` strings. Keep both files' values byte-for-
// byte in sync by hand; there is no build step that generates one from the
// other.
export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  fontWeight?: number;
}

export const type = {
  displayXl: { fontSize: 32, lineHeight: 1.05, fontFamily: fonts.display, fontWeight: 700 } satisfies TypeStyle,
  displayL: { fontSize: 20, lineHeight: 1.15, fontFamily: fonts.display, fontWeight: 700 } satisfies TypeStyle,
  displayM: { fontSize: 16, lineHeight: 1.2, fontFamily: fonts.display, fontWeight: 700 } satisfies TypeStyle,
  displayS: { fontSize: 14, lineHeight: 1.3, fontFamily: fonts.display, fontWeight: 700 } satisfies TypeStyle,
  bodyL: { fontSize: 14, lineHeight: 1.4, fontFamily: fonts.body } satisfies TypeStyle,
  bodyM: { fontSize: 13, lineHeight: 1.45, fontFamily: fonts.body } satisfies TypeStyle,
  bodyS: { fontSize: 12, lineHeight: 1.4, fontFamily: fonts.body } satisfies TypeStyle,
  // mono, 0.06em tracking, uppercase — callers add letterSpacing/textTransform
  // themselves (TypeStyle has no room for them; every other mono label in
  // this app already sets those two properties explicitly at the use site).
  label: { fontSize: 11, lineHeight: 1, fontFamily: fonts.mono, fontWeight: 700 } satisfies TypeStyle,
  // floor — nothing in this app renders smaller than this.
  micro: { fontSize: 10, lineHeight: 1, fontFamily: fonts.mono } satisfies TypeStyle,
};

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;

export const radius = { card: 12, control: 8, inner: 6, overlay: 14 } as const;

export const controlHeight = 32;

// ---------------------------------------------------------------------------
// Liquid-glass surface tokens
// ---------------------------------------------------------------------------
// CSS custom properties consumed by `.liquid-glass` in src/styles.css. Most
// consumers of that class live inside `.report` and get the right variant for
// free from the `.report[data-mode="dark"] .liquid-glass` cascade there; this
// helper exists only for the two dialogs (src/a11y/DisplayPanel.tsx, the
// keyboard-shortcuts sheet in src/App.tsx) that render as *siblings* of
// `.report`, not descendants, so that cascade can't reach them — the same
// reason dialogStyle() in DisplayPanel.tsx already computes background/shadow
// inline from `t` instead of leaning on a `.report[data-mode=...]` selector.
// Values must stay byte-for-byte in sync with the two blocks in styles.css
// (the base `.liquid-glass` rule and its `.report[data-mode="dark"]`
// override) — this is not derived at runtime from the paper/ink tokens above
// because the scrim alpha and rim/sheen opacities were tuned by hand against
// a computed worst-case contrast check (see the comment above the CSS rule),
// not by a formula that could safely regenerate them from `paper` alone.
// `.glass-overlay` (styles.css) equivalent of liquidGlassVars() above, for
// the same structural reason: every consumer (ViewsMenu/UserMenu/
// HeaderOverflowMenu/slicer panels via Portal, plus DisplayPanel and the
// shortcuts dialog as siblings of `.report`) sits outside `.report`'s DOM
// subtree, so the `.report[data-mode="dark"] .glass-overlay` cascade can
// never reach any of them — every consumer must pass this inline instead.
// Scrim/blur values per the P0 spec (§3): .78 alpha, blur(18px) saturate(1.5).
// Not recomputed digit-by-digit here: .78 is a HIGHER alpha than
// liquid-glass's already-verified .62 (light) / .68 (dark) — a higher scrim
// alpha strictly moves the worst-case composited colour closer to the
// scrim's own hue (paper) and further from the extreme opposite-luminance
// backdrop that produced liquid-glass's 4.84:1 / 5.05:1 worst cases (see
// styles.css's comment above `.liquid-glass`), so contrast here is
// strictly higher than that already-passing bound in both modes.
export function glassOverlayVars(t: ThemeTokens): CSSProperties {
  return (
    t.mode === "dark"
      ? {
          "--go-bg": "rgba(12,35,41,0.78)",
          "--go-backdrop": "blur(18px) saturate(1.5)",
          "--go-shadow": "0 4px 10px rgba(0,0,0,0.42), 0 28px 64px rgba(0,0,0,0.52)",
          "--go-rim": "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 0 0 1px rgba(255,255,255,0.2)",
          "--go-solid": "#0C2329",
        }
      : {
          "--go-bg": "rgba(250,247,242,0.78)",
          "--go-backdrop": "blur(18px) saturate(1.5)",
          "--go-shadow": "0 4px 10px rgba(11,50,57,0.16), 0 28px 64px rgba(11,50,57,0.2)",
          "--go-rim": "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px rgba(255,255,255,0.55)",
          "--go-solid": "#FAF7F2",
        }
  ) as CSSProperties;
}

export function liquidGlassVars(t: ThemeTokens): CSSProperties {
  return (
    t.mode === "dark"
      ? {
          "--lg-bg": "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 35%), rgba(12,35,41,0.68)",
          "--lg-backdrop": "blur(2px) saturate(1.6) brightness(0.9)",
          "--lg-shadow": "0 2px 6px rgba(0,0,0,0.4), 0 24px 60px rgba(0,0,0,0.5)",
          "--lg-rim":
            "inset 0 1px 0 rgba(255,255,255,0.55), inset 0 0 0 1px rgba(255,255,255,0.22), inset 0 0 16px 0 rgba(255,255,255,0.1)",
          "--lg-solid": "#0C2329",
        }
      : {
          "--lg-bg": "linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 35%), rgba(250,247,242,0.62)",
          "--lg-backdrop": "blur(2px) saturate(1.7) brightness(1.06)",
          "--lg-shadow": "0 2px 6px rgba(11,50,57,0.18), 0 24px 60px rgba(11,50,57,0.22)",
          "--lg-rim":
            "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.5), inset 0 0 16px 0 rgba(255,255,255,0.22)",
          "--lg-solid": "#FAF7F2",
        }
  ) as CSSProperties;
}
