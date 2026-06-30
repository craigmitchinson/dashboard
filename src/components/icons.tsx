import type { CSSProperties, ReactNode } from "react";

// Small, consistent stroke icons (24x24, currentColor) used across the deck so
// the journey systems and architecture layers read at a glance.
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
export const IconContact = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <rect x="2.5" y="13" width="4" height="6" rx="1.4" />
    <rect x="17.5" y="13" width="4" height="6" rx="1.4" />
    <path d="M20 19a3 3 0 0 1-3 3h-3" />
  </Svg>
);

export const IconAutomation = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="8" width="14" height="11" rx="2.5" />
    <path d="M12 8V4M9 4h6" />
    <circle cx="9.5" cy="13" r="1.2" />
    <circle cx="14.5" cy="13" r="1.2" />
    <path d="M2.5 12.5v3M21.5 12.5v3" />
  </Svg>
);

export const IconForm = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="2.5" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);

export const IconApps = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </Svg>
);

export const IconPerson = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </Svg>
);

/* --- Architecture layers -------------------------------------------------- */
export const IconOrigin = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="12" r="8" opacity="0.5" />
    <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
  </Svg>
);

export const IconEmit = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2" />
    <path d="M7.5 7.5a6 6 0 0 0 0 9M16.5 7.5a6 6 0 0 1 0 9" />
    <path d="M4.5 4.5a10 10 0 0 0 0 15M19.5 4.5a10 10 0 0 1 0 15" opacity="0.55" />
  </Svg>
);

export const IconStream = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h12M3 12h16M3 17h10" />
    <path d="M16 4.5L19 7l-3 2.5M16 14.5L19 17l-3 2.5" />
  </Svg>
);

export const IconCollect = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5L3.5 5z" />
  </Svg>
);

export const IconObserve = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);

/* --- Channels & dashboard ------------------------------------------------- */
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
  </Svg>
);

export const IconDesktop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </Svg>
);

export const IconLetter = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3.5 7l8.5 6 8.5-6" />
  </Svg>
);

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.5 2" />
  </Svg>
);

export const IconCost = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 6.5H10a3 3 0 0 0-3 3c0 4 .5 5-2 7.5h9.5" />
    <path d="M6.5 12.5h6" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5l8.5 14.5H3.5L12 4.5z" />
    <path d="M12 10v4M12 16.6v.2" />
  </Svg>
);

export const IconPulse = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12h4l2-5 3 11 2.5-7 1.5 3h6" />
  </Svg>
);

export const IconPayment = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M2.5 10h19M6 14.5h4" />
  </Svg>
);

export const IconQueue = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
    <circle cx="7" cy="7" r="0.4" />
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

export const IconFilter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 5.5h17l-6.5 8v5l-4 2v-7z" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 5l7 7-7 7" />
  </Svg>
);

export const IconExpand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6" />
  </Svg>
);

export const IconDots = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

/* --- Clicks-to-code ------------------------------------------------------- */
export const IconWindow = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    <path d="M12 14v2.5" />
  </Svg>
);

export const IconApi = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 7.5L4.5 12 9 16.5M15 7.5L19.5 12 15 16.5" />
    <path d="M13 5l-2 14" />
  </Svg>
);

export const IconService = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M12 3v18M4 7.5l8 4.5 8-4.5" />
  </Svg>
);

export const IconReuse = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="6" r="2.4" />
    <circle cx="5.5" cy="18" r="2.4" />
    <circle cx="18.5" cy="18" r="2.4" />
    <path d="M12 8.4v3.6M11 13l-4 3M13 13l4 3" />
  </Svg>
);

export const IconWrench = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15.5 4.5a4.5 4.5 0 0 0-5.9 5.6l-5.3 5.3a1.6 1.6 0 0 0 2.3 2.3l5.3-5.3a4.5 4.5 0 0 0 5.6-5.9l-2.6 2.6-2.2-2.2 2.8-2.4z" />
  </Svg>
);

export const IconGauge = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 16a8 8 0 1 1 16 0" />
    <path d="M12 16l4-4" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
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

export const IconBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2.5 5 13.5h5l-1 8 8-11h-5l1-8z" />
  </Svg>
);

export const IconQuestion = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.8.3-1.4 1-1.4 1.9v.4" />
    <path d="M11.5 17v.2" />
  </Svg>
);

export const IconBook = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4.5h9a3 3 0 0 1 3 3v12a2.5 2.5 0 0 0-2.5-2.5H5z" />
    <path d="M5 4.5v12.5" />
    <path d="M17 7.5h2v12a2.5 2.5 0 0 0-2.5-2.5" />
  </Svg>
);

export const IconQuote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a2 2 0 0 1-2 2" />
    <path d="M19 6h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v1a2 2 0 0 1-2 2" />
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

export const IconBrain = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5.5a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0-1 4.8A2.5 2.5 0 0 0 7 17.5a2.3 2.3 0 0 0 2.5 1.5V5.5z" />
    <path d="M15 5.5a2.5 2.5 0 0 1 2.5 2.5 2.5 2.5 0 0 1 1 4.8A2.5 2.5 0 0 1 17 17.5a2.3 2.3 0 0 1-2.5 1.5V5.5z" />
  </Svg>
);
