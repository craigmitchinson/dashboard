// ---------------------------------------------------------------------------
// page-labels.ts
// ---------------------------------------------------------------------------
// Single source of truth for the page id -> display label strings shared by
// App.tsx's PAGES array and the Alerts feature (src/alerts/format.ts,
// consumed by AlertsPage.tsx's "Open {label} ->" button). Kept in its own
// module with no dependency on App.tsx or src/alerts/* so both can import it
// without introducing a circular import.
// ---------------------------------------------------------------------------
export const PAGE_LABELS = {
  overview: "Overview",
  exceptions: "Exceptions",
  commercial: "Commercial Performance",
  "process-detail": "Process detail",
  capacity: "VDI & Capacity",
  alerts: "Alerts",
} as const;
