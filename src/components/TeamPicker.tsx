import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTheme } from "../theme-context";
import { useTeams } from "../teams-context";
import { ALL_TEAMS } from "../teamdata";

interface Props {
  value: string;
  onChange: (team: string) => void;
  triggerStyle?: CSSProperties;
  triggerClassName?: string;
  align?: "left" | "right";
  ariaLabel?: string;
  /** Show an "All teams" option that aggregates everyone (read-only). */
  includeAll?: boolean;
}

// A team selector: looks like text with a small caret, opens a menu to pick a
// team, add a new one, or delete existing ones (managing the shared list).
export function TeamPicker({
  value,
  onChange,
  triggerStyle,
  triggerClassName,
  align = "left",
  ariaLabel,
  includeAll = false,
}: Props) {
  const theme = useTheme();
  const { teams, addTeam, removeTeam } = useTeams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commitAdd = () => {
    const t = draft.trim();
    if (!t) return;
    addTeam(t);
    onChange(t);
    setDraft("");
    setOpen(false);
  };

  return (
    <div
      className="tpick"
      ref={ref}
      style={{ justifyContent: align === "right" ? "flex-end" : "flex-start" }}
    >
      <button
        type="button"
        className={`tpick__trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
        style={triggerStyle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {value}
        <span aria-hidden className="tpick__caret">
          &#9662;
        </span>
      </button>
      {open && (
        <div
          className="tpick__menu"
          style={{
            [align]: 0,
            background: theme.paper,
            border: `1px solid ${theme.ruleSoft}`,
            boxShadow: theme.shadow,
            color: theme.ink,
          }}
        >
          {includeAll && (
            <div className="tpick__option">
              <button
                type="button"
                className="tpick__name"
                style={{
                  color: theme.ink,
                  fontWeight: value === ALL_TEAMS ? 700 : 400,
                }}
                onClick={() => {
                  onChange(ALL_TEAMS);
                  setOpen(false);
                }}
              >
                {ALL_TEAMS}
              </button>
            </div>
          )}
          {teams.map((t) => (
            <div key={t} className="tpick__option">
              <button
                type="button"
                className="tpick__name"
                style={{ color: theme.ink, fontWeight: t === value ? 700 : 400 }}
                onClick={() => {
                  onChange(t);
                  setOpen(false);
                }}
              >
                {t}
              </button>
              {teams.length > 1 && (
                <button
                  type="button"
                  className="tpick__del"
                  title="Delete team"
                  onClick={() => removeTeam(t)}
                >
                  &times;
                </button>
              )}
            </div>
          ))}
          <div className="tpick__add">
            <input
              value={draft}
              placeholder="Add team"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitAdd();
                if (e.key === "Escape") setOpen(false);
              }}
              style={{ color: theme.ink, borderColor: theme.ruleSoft }}
            />
            <button type="button" onClick={commitAdd}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
