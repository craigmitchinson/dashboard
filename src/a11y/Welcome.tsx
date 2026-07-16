import { useDisplayPrefs } from "./prefs-context";
import { useTheme } from "../theme-context";
import { fonts } from "../theme";
import { IconAutumn, IconSpring, IconSummer, IconWinter } from "../components/icons";

// ---------------------------------------------------------------------------
// Header greeting. Compact, sits inline alongside the title/blurb/freshness
// indicator/Views menu/Reset/theme toggle/user menu — must read lighter than
// the page <h1>, never compete with it.
// ---------------------------------------------------------------------------

function seasonFor(month: number): { label: string; Icon: typeof IconWinter } {
  // Meteorological Northern Hemisphere seasons, 0-indexed getMonth():
  // Dec(11)/Jan(0)/Feb(1) = Winter, Mar(2)/Apr(3)/May(4) = Spring,
  // Jun(5)/Jul(6)/Aug(7) = Summer, Sep(8)/Oct(9)/Nov(10) = Autumn.
  if (month === 11 || month === 0 || month === 1) return { label: "Winter", Icon: IconWinter };
  if (month >= 2 && month <= 4) return { label: "Spring", Icon: IconSpring };
  if (month >= 5 && month <= 7) return { label: "Summer", Icon: IconSummer };
  return { label: "Autumn", Icon: IconAutumn };
}

export function Welcome({
  // Production note: `name` is a stand-in for the real user's display name.
  // Swapping to Entra ID is a one-line change at the call site — pass the
  // `name` claim from the signed-in user's ID token instead of a literal.
  name,
}: {
  name: string;
}): JSX.Element {
  const { prefs } = useDisplayPrefs();
  const t = useTheme();

  const firstName = name.split(" ")[0];
  const hour = new Date().getHours();
  // Hour boundaries: hour < 12 -> morning, 12 <= hour < 17 -> afternoon,
  // hour >= 17 -> evening.
  const greeting =
    hour < 12 ? `Good morning, ${firstName}` : hour < 17 ? `Good afternoon, ${firstName}` : `Good evening, ${firstName}`;

  const dateStr = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const showSeasonal = prefs.seasonalAccent === true && prefs.theme !== "high-contrast";
  const season = showSeasonal ? seasonFor(new Date().getMonth()) : null;

  // Single line only — the header is a fixed 56px band (--header-h) and this
  // sits beside the data pill and clocks; the full date and season name live
  // in the tooltip + sr-only text rather than a second visual line.
  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
      title={`${dateStr}${season ? ` · ${season.label}` : ""}`}
    >
      {season && (
        <span style={{ display: "inline-flex", color: t.inkSoft }} aria-hidden="true">
          <season.Icon size={14} />
        </span>
      )}
      <span style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: 600, color: t.ink }}>{greeting}</span>
      <span className="sr-only">
        {dateStr}
        {season ? `, ${season.label}` : ""}
      </span>
    </div>
  );
}
