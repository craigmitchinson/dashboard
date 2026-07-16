// ---------------------------------------------------------------------------
// Display / accessibility preferences
// ---------------------------------------------------------------------------
// The foundational store for personalisation & accessibility settings: theme
// (including a high-contrast mode), text scale, dyslexia-friendly type,
// reading ruler, bionic reading, colour-vision-safe palettes, reduced motion
// and a couple of cosmetic toggles (seasonal accent, clocks). Persisted per
// signed-in user in localStorage, namespaced the same way App.tsx namespaces
// its own saved UI state — see the local keyFor/read/write helpers below,
// which mirror (not import, to avoid a circular dependency) the pattern in
// src/App.tsx. Consumers read/write via useDisplayPrefs(); this module knows
// nothing about auth — the current user id is handed in as a prop.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type DisplayTheme = "light" | "dark" | "high-contrast";
export type TextScale = 1 | 1.15 | 1.3;

export interface DisplayPrefs {
  theme: DisplayTheme;
  textScale: TextScale;
  dyslexiaMode: boolean;
  readingRuler: boolean;
  bionicReading: boolean;
  colorVisionSafe: boolean;
  reduceMotion: "system" | "on";
  seasonalAccent: boolean; // default true
  clocks: boolean; // default true
  liquidGlass: boolean; // default true
}

export const SHORTCUT_THEME_CYCLE: DisplayTheme[] = ["light", "dark", "high-contrast"];

interface DisplayPrefsContextValue {
  prefs: DisplayPrefs;
  setPrefs: (patch: Partial<DisplayPrefs>) => void;
  cycleTheme: () => void;
}

// Base localStorage key name. Namespaced per signed-in user, same idiom as
// PERSIST/VIEWS_KEY in src/App.tsx.
const PREFS_KEY = "bp-display-prefs-v1";

// Mirrors the keyFor() helper in src/App.tsx: a per-user namespaced key, or
// the bare base name while no user is known.
function keyFor(base: string, userId: string | undefined): string {
  return userId ? `${base}::${userId}` : base;
}

// Computes the first-run defaults. Only ever called from the lazy useState
// initializer below so the media-query checks run exactly once per mount.
function defaultPrefs(): DisplayPrefs {
  let theme: DisplayTheme = "light";
  if (typeof window !== "undefined" && window.matchMedia) {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }
    if (window.matchMedia("(prefers-contrast: more)").matches) {
      theme = "high-contrast";
    }
  }
  return {
    theme,
    textScale: 1,
    dyslexiaMode: false,
    readingRuler: false,
    bionicReading: false,
    colorVisionSafe: false,
    reduceMotion: "system",
    seasonalAccent: true,
    clocks: true,
    liquidGlass: true,
  };
}

// Reads the namespaced prefs value for this user, falling back to computed
// defaults on first run (no legacy un-namespaced key to fall back to — this
// is a brand-new pref set).
function readPrefs(userId: string | undefined): DisplayPrefs {
  try {
    const raw = localStorage.getItem(keyFor(PREFS_KEY, userId));
    if (raw) return { ...defaultPrefs(), ...(JSON.parse(raw) as Partial<DisplayPrefs>) };
  } catch {
    /* ignore */
  }
  return defaultPrefs();
}

function writePrefs(userId: string | undefined, prefs: DisplayPrefs): void {
  try {
    localStorage.setItem(keyFor(PREFS_KEY, userId), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

const DisplayPrefsContext = createContext<DisplayPrefsContextValue | null>(null);

/**
 * Parent must mount this with `key={userId}` (or equivalent) across a user
 * change so prefs re-initialize for the new user — mirrors the remount-per-
 * user idiom already used in App.tsx for saved views.
 */
export function DisplayPrefsProvider({ userId, children }: { userId: string | undefined; children: ReactNode }): JSX.Element {
  const [prefs, setPrefsState] = useState<DisplayPrefs>(() => readPrefs(userId));

  const setPrefs = (patch: Partial<DisplayPrefs>): void => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      writePrefs(userId, next);
      return next;
    });
  };

  const cycleTheme = (): void => {
    const idx = SHORTCUT_THEME_CYCLE.indexOf(prefs.theme);
    setPrefs({ theme: SHORTCUT_THEME_CYCLE[(idx + 1) % SHORTCUT_THEME_CYCLE.length] });
  };

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", prefs.theme);
    if (prefs.dyslexiaMode) el.setAttribute("data-dyslexia", "true");
    else el.removeAttribute("data-dyslexia");
    el.setAttribute("data-text-scale", String(prefs.textScale));
    if (prefs.reduceMotion === "on") el.setAttribute("data-reduce-motion", "true");
    else el.removeAttribute("data-reduce-motion");
    if (prefs.colorVisionSafe) el.setAttribute("data-cvd-safe", "true");
    else el.removeAttribute("data-cvd-safe");
    el.setAttribute("data-glass", prefs.liquidGlass ? "on" : "off");
  }, [prefs]);

  return <DisplayPrefsContext.Provider value={{ prefs, setPrefs, cycleTheme }}>{children}</DisplayPrefsContext.Provider>;
}

export function useDisplayPrefs(): DisplayPrefsContextValue {
  const ctx = useContext(DisplayPrefsContext);
  if (!ctx) throw new Error("useDisplayPrefs must be used within a DisplayPrefsProvider");
  return ctx;
}
