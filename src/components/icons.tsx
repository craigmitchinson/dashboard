import type { CSSProperties, ReactNode } from "react";

// Small, consistent stroke icons (24x24, currentColor) used across the
// dashboard's nav, header controls and section chrome.
interface IconProps {
  size?: number;
  style?: CSSProperties;
  strokeWidth?: number;
}

function Svg({ size = 24, style, strokeWidth = 1.8, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/* --- Journey systems ----------------------------------------------------- */
export const IconForm = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </Svg>
);

/* --- Channels & dashboard ------------------------------------------------- */
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
  </Svg>
);

export const IconLetter = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5l8.5 14.5H3.5L12 4.5z" />
    <path d="M12 10v4M12 16.6v.2" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a5 5 0 0 0-5 5v3.5l-1.8 2.7a1 1 0 0 0 .8 1.55h12a1 1 0 0 0 .8-1.55L17 11.5V8a5 5 0 0 0-5-5z" />
    <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
  </Svg>
);

export const IconPayment = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M2.5 10h19M6 14.5h4" />
  </Svg>
);

export const IconCard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.2" />
    <path d="M2.5 9.5h19M6 14.5h4" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-13.7-4.5L4 9" />
    <path d="M4 4v5h5" />
    <path d="M4 13a8 8 0 0 0 13.7 4.5L20 15" />
    <path d="M20 20v-5h-5" />
  </Svg>
);

/* --- Report navigation & visual headers ----------------------------------- */
export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.4" />
  </Svg>
);

export const IconFlow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 17l5-5 4 3 8-8" />
    <path d="M16 7h5v5" />
  </Svg>
);

export const IconBars = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V4" />
    <rect x="7" y="13" width="3.4" height="7" rx="0.6" />
    <rect x="12" y="9" width="3.4" height="11" rx="0.6" />
    <rect x="17" y="5" width="3.4" height="15" rx="0.6" />
  </Svg>
);

export const IconServer = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="6" rx="1.6" />
    <rect x="3.5" y="14" width="17" height="6" rx="1.6" />
    <path d="M7 7h.01M7 17h.01" />
  </Svg>
);

export const IconCoins = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="9" cy="7" rx="5.5" ry="2.6" />
    <path d="M3.5 7v5c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6V7" />
    <path d="M14.5 12.5c2.6.2 5 1.3 5 2.6 0 1.4-2.5 2.6-5.5 2.6-1.5 0-2.9-.3-3.9-.8" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5l7 7-7 7" />
  </Svg>
);

/* --- Clicks-to-code ------------------------------------------------------- */
export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14v2.5" />
  </Svg>
);

/* --- Agents, knowledge, graph --------------------------------------------- */
export const IconInbox = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5.5h17v13h-17z" />
    <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
  </Svg>
);

export const IconRoute = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="2.4" />
    <circle cx="18" cy="18" r="2.4" />
    <path d="M6 8.4v4a4 4 0 0 0 4 4h5.6" />
    <path d="M13 16.5l2.6 1.5-2.6 1.5" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H5z" />
    <path d="M5 4.5v12.5" />
    <path d="M17 7.5h2v12a2.5 2.5 0 0 0-2.5-2.5" />
  </Svg>
);

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9v-6L12 3z" />
    <path d="M9 12l2 2 4-4.5" />
  </Svg>
);

export const IconGraph = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <circle cx="17" cy="17.5" r="2.2" />
    <circle cx="7" cy="17" r="2.2" />
    <path d="M8 7.5l8-1M7.5 9l8.5 7M8.7 16.3l6.6.7M6.5 9.1 6.9 14.8" />
  </Svg>
);

/* --- Seasonal accent (a11y header greeting) ------------------------------ */
export const IconWinter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9" />
    <path d="M9 4.5l3 2 3-2M9 19.5l3-2 3 2M5 9.5l1 3.3-3 1M22 9.5l-1 3.3 3 1M5 14.5l1-3.3-3-1M22 14.5l-1-3.3 3-1" />
  </Svg>
);

export const IconSpring = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20v-9" />
    <path d="M12 12c0-3.5-2.5-5.5-6-5.5 0 3.5 2.5 5.5 6 5.5z" />
    <path d="M12 14c0-3.2 2.3-5 5.5-5 0 3.2-2.3 5-5.5 5z" />
  </Svg>
);

export const IconSummer = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3" />
  </Svg>
);

export const IconAutumn = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4c4.5 1 7 4.8 7 9-4.5-1-7-4.8-7-9zM12 4c-4.5 1-7 4.8-7 9 4.5-1 7-4.8 7-9z" />
    <path d="M12 4v16" />
  </Svg>
);

/* --- Accessibility (a11y header trigger) ---------------------------------- */
export const IconAccessibility = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="8.2" r="1.6" />
    <path d="M7 11.4c2.7 1 7.3 1 10 0M12 10v5.5M9.5 19.3L12 15.5l2.5 3.8" />
  </Svg>
);

/* --- Header priority-collapse (design elevation P0) ----------------------- */
export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />
  </Svg>
);

export const IconContrastCircle = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v6M12 7.2v.2" />
  </Svg>
);

export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconValue = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 16.5l5-6 4 3.5 7.5-9" />
    <path d="M15.5 4.5h4.5V9" />
  </Svg>
);

// Download / export-to-file (nav/motion P1: PageActions.tsx's ExportCsvButton)
export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4.5 19h15" />
  </Svg>
);

// Selected-state checkmark (Slicers.tsx's Option — replaces a bare "✓" text glyph)
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5 10-11" />
  </Svg>
);
