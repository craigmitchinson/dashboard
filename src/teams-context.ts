import { createContext, useContext } from "react";

// A single global list of teams, shared across the pack, plus the active team
// selection. The org team and each delivery highlight pick from this list, so
// team names stay consistent everywhere.
export interface TeamsApi {
  teams: string[];
  addTeam: (team: string) => void;
  removeTeam: (team: string) => void;
  activeTeam: string;
  setActiveTeam: (team: string) => void;
}

const TeamsContext = createContext<TeamsApi>({
  teams: [],
  addTeam: () => {},
  removeTeam: () => {},
  activeTeam: "",
  setActiveTeam: () => {},
});

export const TeamsProvider = TeamsContext.Provider;
export const useTeams = (): TeamsApi => useContext(TeamsContext);
