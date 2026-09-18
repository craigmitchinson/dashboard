// ---------------------------------------------------------------------------
// help/help-store.ts
// ---------------------------------------------------------------------------
// Tiny external store for the help drawer + first-run tour's open/active
// state. It exists so the header help button, the "Take the tour"/"Help for
// this page" command-palette actions and the Shift+H shortcut — all of which
// live in files this feature does not otherwise own (App.tsx, CommandPalette.tsx)
// — can trigger the drawer/tour without App.tsx having to hold that state
// itself and thread it down as props (the brief restricts App.tsx to a
// single lazy mount of the help/tour root plus a handful of named, additive
// edits — it does not license wiring a new piece of lifted state through
// Report()'s render tree).
//
// This module is deliberately tiny and dependency-free (no React import, no
// catalogue data) so importing it eagerly from App.tsx/CommandPalette.tsx
// costs nothing — the actual UI (HelpRoot, lazy-loaded from App.tsx) is what
// pulls in the heavier tour/drawer code, subscribing to this store via
// useSyncExternalStore.
// ---------------------------------------------------------------------------

export interface HelpState {
  drawerOpen: boolean;
  tourActive: boolean;
  tourStepIndex: number;
}

let state: HelpState = {
  drawerOpen: false,
  tourActive: false,
  tourStepIndex: 0,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<HelpState>): void {
  state = { ...state, ...patch };
  emit();
}

/** useSyncExternalStore subscribe function. */
export function subscribeHelp(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** useSyncExternalStore snapshot getter — same reference until state changes. */
export function getHelpSnapshot(): HelpState {
  return state;
}

export function openHelpDrawer(): void {
  setState({ drawerOpen: true, tourActive: false });
}

export function closeHelpDrawer(): void {
  setState({ drawerOpen: false });
}

/** Starts (or restarts) the tour from its first step, closing the drawer if open. */
export function startTour(): void {
  setState({ tourActive: true, tourStepIndex: 0, drawerOpen: false });
}

export function stopTour(): void {
  setState({ tourActive: false });
}

export function setTourStepIndex(i: number): void {
  setState({ tourStepIndex: i });
}
