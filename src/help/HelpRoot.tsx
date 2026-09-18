import { Suspense, lazy, useEffect, useSyncExternalStore } from "react";
import { subscribeHelp, getHelpSnapshot, stopTour, closeHelpDrawer, setTourStepIndex, startTour } from "./help-store";
import { hasTourRun, markTourDone } from "./tour-storage";
import { TourOverlay } from "./TourOverlay";

// ---------------------------------------------------------------------------
// help/HelpRoot.tsx
// ---------------------------------------------------------------------------
// The single lazy-mounted root App.tsx renders inside the Report tree (see
// that file's own comment at the mount site). Two independent chunks:
//  - TourOverlay is imported directly above, so it ships in THIS chunk
//    (HelpRoot itself is already lazy from App.tsx's point of view) — small,
//    no catalogue data.
//  - HelpDrawer is lazy() a second time, from here, specifically so the
//    feature-catalogue module (sizeable — it's the whole hub-review text) is
//    only ever fetched once someone actually opens the drawer, never merely
//    because the tour ran or the app booted.
// ---------------------------------------------------------------------------

const HelpDrawer = lazy(() => import("./HelpDrawer").then((m) => ({ default: m.HelpDrawer })));

export interface HelpRootProps {
  pageId: string;
  userId: string | undefined;
  isAdmin: boolean;
  go: (id: string) => void;
}

export function HelpRoot({ pageId, userId, isAdmin, go }: HelpRootProps) {
  const state = useSyncExternalStore(subscribeHelp, getHelpSnapshot, getHelpSnapshot);

  // First-run auto-launch, once per signed-in user (bp-tour-v1::{userId}).
  // Navigates to Overview first so the filter-bar step always has a live
  // target the very first time someone sees it, regardless of which page
  // they landed on at sign-in.
  useEffect(() => {
    if (!userId) return;
    if (hasTourRun(userId)) return;
    go("overview");
    startTour();
    markTourDone(userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <>
      {state.tourActive && <TourOverlay stepIndex={state.tourStepIndex} onStepChange={setTourStepIndex} onFinish={stopTour} />}
      {state.drawerOpen && (
        <Suspense fallback={null}>
          <HelpDrawer pageId={pageId} isAdmin={isAdmin} onClose={closeHelpDrawer} go={go} />
        </Suspense>
      )}
    </>
  );
}
