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
  status: Record<DepStatus, StatusStyle>;
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
  },
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
  },
};

export const themes: Record<Mode, ThemeTokens> = {
  light: lightTheme,
  dark: darkTheme,
};

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
