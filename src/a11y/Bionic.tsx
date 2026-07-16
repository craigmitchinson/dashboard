// ---------------------------------------------------------------------------
// Bionic reading text wrapper
// ---------------------------------------------------------------------------
// Self-gating contract: callers should wrap prose text UNCONDITIONALLY with
// <Bionic>...</Bionic> — this component itself checks prefs.bionicReading
// (via useDisplayPrefs()) and no-ops back to the plain, unmodified string
// when the preference is off. Callers never need to branch on the pref
// themselves.
//
// WARNING: never use this on chart axis ticks, legends, or numeric values —
// bolding partial characters inside numbers/labels breaks legibility and
// alignment. That restriction is enforced by call-site discipline elsewhere
// in the codebase (e.g. viz.tsx, DataModel.tsx should only wrap descriptive
// prose, not data), not by any check inside this component.
import { useDisplayPrefs } from "./prefs-context";

export function Bionic({ children }: { children: string }): JSX.Element {
  const { prefs } = useDisplayPrefs();

  if (!prefs.bionicReading) {
    return <>{children}</>;
  }

  const tokens = children.split(/(\s+)/);

  return (
    <>
      {tokens.map((token, i) => {
        if (token === "" || /^\s+$/.test(token)) {
          return token;
        }
        const boldLength = Math.ceil(token.length * 0.4);
        const prefix = token.slice(0, boldLength);
        const rest = token.slice(boldLength);
        return (
          <span key={i}>
            <strong>{prefix}</strong>
            {rest}
          </span>
        );
      })}
    </>
  );
}
