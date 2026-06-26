import type { Org, OrgField } from "../types";
import { fonts, type } from "../theme";
import { useTheme } from "../theme-context";
import { useTeams } from "../teams-context";
import { EditableText } from "./EditableText";
import { TeamPicker } from "./TeamPicker";

interface Props {
  org: Org;
  onEdit: (field: OrgField, text: string) => void;
}

// The shared org identity, top-right on every slide: Platform > Lab > Team.
// Platform and Lab are global text; the Team is the active-team selection, so
// switching it changes which team's content the slide shows.
export function OrgIdentity({ org, onEdit }: Props) {
  const theme = useTheme();
  const { activeTeam, setActiveTeam } = useTeams();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        flex: "none",
        textAlign: "right",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "flex-end",
          gap: 6,
          fontFamily: fonts.mono,
          fontSize: type.slideKicker,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: theme.inkSoft,
          marginBottom: 4,
        }}
      >
        <EditableText
          value={org.platform}
          onCommit={(t) => onEdit("platform", t)}
          placeholder="Platform"
          ariaLabel="Platform"
        />
        <span aria-hidden style={{ opacity: 0.6 }}>
          &rsaquo;
        </span>
        <EditableText
          value={org.lab}
          onCommit={(t) => onEdit("lab", t)}
          placeholder="Lab"
          ariaLabel="Lab"
        />
      </div>
      <TeamPicker
        value={activeTeam}
        onChange={setActiveTeam}
        includeAll
        align="right"
        ariaLabel="Team"
        triggerStyle={{
          fontFamily: fonts.display,
          fontSize: type.team,
          fontWeight: 600,
          lineHeight: 1.1,
          color: theme.ink,
        }}
      />
    </div>
  );
}
