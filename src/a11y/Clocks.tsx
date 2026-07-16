import { useEffect, useState } from "react";
import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { useDisplayPrefs } from "./prefs-context";

// ---------------------------------------------------------------------------
// Live UK / India clocks for the header. Relies on IANA tz handling via
// Intl.DateTimeFormat rather than a hardcoded UTC offset, so it stays correct
// year-round across BST/GMT and IST.
// ---------------------------------------------------------------------------

const ukFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "Europe/London",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const inFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function Clocks(): JSX.Element | null {
  const { prefs } = useDisplayPrefs();
  const t = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Align ticks to the top of the minute rather than a naive 60s interval
    // from mount time (which would drift out of phase with the real clock).
    const msToNextMinute = 60000 - (Date.now() % 60000);
    let intervalId: ReturnType<typeof setInterval> | undefined;
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60000);
    }, msToNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  if (prefs.clocks === false) return null;

  const ukTimeStr = ukFormatter.format(now);
  const inTimeStr = inFormatter.format(now);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: fonts.mono,
        fontSize: 10.5,
        letterSpacing: "0.04em",
        color: t.inkSoft,
      }}
    >
      <span aria-label={`United Kingdom time, ${ukTimeStr}`}>UK {ukTimeStr}</span>
      <span aria-hidden>·</span>
      <span aria-label={`India time, ${inTimeStr}`}>IN {inTimeStr}</span>
    </div>
  );
}
