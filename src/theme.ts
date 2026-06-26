// ---------------------------------------------------------------------------
// Brand theme tokens
// ---------------------------------------------------------------------------
// Every colour, font and spacing value lives here so the look is defined once
// and cannot drift. Fonts, spacing and the type scale are shared across modes;
// colours come in a light and a dark variant. Components never use literal
// colours: they read the active variant from the theme context.

import type { Level, DepStatus } from "./types";

export type Mode = "light" | "dark";

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

export const fonts = {
  display: '"Gelasio", Georgia, "Times New Roman", serif',
  body: '"Carlito", Calibri, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", Consolas, "Courier New", monospace',
} as const;

// Fixed slide canvas. Never responds to viewport; a Playwright capture at 2x
// of this element yields a clean 3840x2160 PNG.
export const slide = {
  width: 1920,
  height: 1080,
  padding: 44,
  headerHeight: 96,
  columnGap: 16,
  rowGap: 6,
  radius: 14,
  // Relative widths of the five columns (theme..value), summed and normalised.
  columnWeights: {
    theme: 1.15,
    outcome: 1.1,
    epic: 1.1,
    feature: 1.25,
    value: 1.3,
  } as Record<Level, number>,
} as const;

// Per-level visual treatment for the bracket-style nesting. Each level reads as
// a nested band: a tinted surface plus a coloured left rail so the parent box's
// left edge brackets the full height of its children.
export interface LevelStyle {
  surface: string;
  rail: string;
  text: string;
  /** Slightly stronger tint used for the alternating theme band behind a row. */
  band: string;
}

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
  /** Neutral area around the slide. */
  page: string;
  /** Slide background. */
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
  /** Strong rule under the title. */
  rule: string;
  /** Soft rule below the column headers. */
  ruleSoft: string;
  /** Alternating band tint behind every other theme. */
  themeBand: string;
  /** Slide drop shadow. */
  shadow: string;
  levelStyles: Record<Level, LevelStyle>;
  status: Record<DepStatus, StatusStyle>;
}

export const lightTheme: ThemeTokens = {
  mode: "light",
  page: "#ECE8E1",
  paper: swatch.paper,
  ink: swatch.teal,
  inkSoft: "rgba(11,50,57,0.5)",
  inkFaint: "rgba(11,50,57,0.15)",
  accent: swatch.red,
  accentSoft: swatch.redWarm,
  rule: swatch.teal,
  ruleSoft: "rgba(11,50,57,0.15)",
  themeBand: "rgba(11,50,57,0.035)",
  shadow: "0 24px 60px rgba(11,50,57,0.22)",
  levelStyles: {
    theme: { surface: swatch.teal, rail: swatch.redWarm, text: swatch.paper, band: "rgba(11,50,57,0.04)" },
    outcome: { surface: swatch.lightPurple, rail: swatch.darkPurple, text: swatch.teal, band: "rgba(221,187,255,0.10)" },
    epic: { surface: swatch.lightPink, rail: swatch.darkPink, text: swatch.teal, band: "rgba(255,204,217,0.10)" },
    feature: { surface: swatch.digitalGrey, rail: "rgba(11,50,57,0.18)", text: swatch.teal, band: "rgba(11,50,57,0.02)" },
    value: { surface: swatch.white, rail: "rgba(11,50,57,0.10)", text: swatch.teal, band: "transparent" },
  },
  status: {
    committed: { dot: swatch.teal, rail: swatch.teal, surface: "rgba(11,50,57,0.05)", text: swatch.teal },
    "not-committed": { dot: "#8A6FB0", rail: swatch.darkPurple, surface: swatch.lightPurple, text: swatch.teal },
    blocked: { dot: swatch.red, rail: swatch.redWarm, surface: swatch.lightPink, text: swatch.teal },
  },
};

// Dark variant: a deep teal canvas with cream ink. Level bands become luminous
// tints of the same secondary palette so the nesting still reads, and the reds
// are nudged brighter to keep their punch against the dark ground.
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
  rule: "rgba(244,241,235,0.85)",
  ruleSoft: "rgba(244,241,235,0.18)",
  themeBand: "rgba(255,255,255,0.05)",
  shadow: "0 24px 60px rgba(0,0,0,0.5)",
  levelStyles: {
    theme: { surface: "#103D45", rail: "#FF6A4D", text: darkInk, band: "rgba(255,255,255,0.05)" },
    outcome: { surface: "rgba(221,187,255,0.16)", text: "#EFE7FF", rail: swatch.darkPurple, band: "rgba(221,187,255,0.08)" },
    epic: { surface: "rgba(255,178,198,0.14)", text: "#FFE3EA", rail: swatch.darkPink, band: "rgba(255,204,217,0.07)" },
    feature: { surface: "rgba(244,241,235,0.06)", text: darkInk, rail: "rgba(244,241,235,0.3)", band: "rgba(244,241,235,0.03)" },
    value: { surface: "rgba(244,241,235,0.03)", text: darkInk, rail: "rgba(244,241,235,0.16)", band: "transparent" },
  },
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

// Typographic scale (px on the 1920x1080 canvas).
export const type = {
  slideTitle: 34,
  slideKicker: 14,
  team: 22,
  columnHeader: 15,
  theme: 20,
  outcome: 17,
  epic: 16,
  feature: 15,
  value: 14,
  control: 13,
} as const;
