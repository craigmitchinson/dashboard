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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, lineHeight: 1.25 }}>
      <div
        style={{
          fontFamily: fonts.body,
          fontSize: 13.5,
          fontWeight: 600,
          color: t.ink,
        }}
      >
        {greeting}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: fonts.body, fontSize: 11, color: t.inkSoft }}>{dateStr}</span>
        {season && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: fonts.mono,
              fontSize: 10.5,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: t.inkSoft,
            }}
          >
            <season.Icon size={15} />
            {season.label}
          </span>
        )}
      </div>
    </div>
  );
}
