import { createContext, useContext } from "react";

// Lets any visual trigger report navigation (e.g. drill-through to a detail page).
export const NavContext = createContext<(pageId: string) => void>(() => {});
export const useNav = () => useContext(NavContext);

// ---------------------------------------------------------------------------
// Drill-through origin (design elevation P0, §5)
// ---------------------------------------------------------------------------
// NavOriginContext is ADDITIVE, not a replacement for NavContext above:
// several other-owned pages (Overview.tsx, ProcessAnalysis.tsx,
// AlertsPage.tsx) already call `useNav()` as a plain `(pageId) => void`
// function (`nav("process-detail")`) — changing NavContext's own value to a
// `{go, back}` object, as the spec's literal wording suggests, would break
// every one of those call sites, none of which this task owns. Report()
// (src/App.tsx) records the previous page id into this second context
// itself, transparently, on every navigation — regardless of whether it was
// triggered via useNav()'s plain setter or a nav-item click — so callers
// need no code changes to get origin-tracking; ProcessDetail (owned by
// another worker) can read `useNavOrigin()` to render a breadcrumb back to
// wherever the drill started.
export interface NavOrigin {
  /** The page id that was active immediately before the current one. */
  from: string | null;
  /** Navigate back to `from` (no-op if there is none). */
  back: () => void;
}

export const NavOriginContext = createContext<NavOrigin>({ from: null, back: () => {} });
export const useNavOrigin = () => useContext(NavOriginContext);
