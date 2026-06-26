import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { fonts, type } from "../theme";
import { useTheme } from "../theme-context";
import type { Quarter } from "../quarters";
import {
  currentQuarter,
  qbrKicker,
  quarterOptions,
  sameQuarter,
  shortQuarter,
} from "../quarters";

interface Props {
  quarter: Quarter;
  onChange: (q: Quarter) => void;
}

// The QBR eyebrow doubles as a quarter selector. It looks like plain eyebrow
// text (no select chrome or arrow); clicking it opens a small menu of quarters.
export function QuarterPicker({ quarter, onChange }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const eyebrow: CSSProperties = {
    fontFamily: fonts.mono,
    fontSize: type.slideKicker,
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color: theme.accentSoft,
  };

  const options = quarterOptions(quarter);
  const now = currentQuarter();

  return (
    <div className="qpick" ref={ref}>
      <button
        type="button"
        className="qpick__trigger"
        style={eyebrow}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {qbrKicker(quarter)}
      </button>
      {open && (
        <div
          className="qpick__menu"
          role="listbox"
          style={{
            background: theme.paper,
            border: `1px solid ${theme.ruleSoft}`,
            boxShadow: theme.shadow,
          }}
        >
          {options.map((o) => {
            const selected = sameQuarter(o, quarter);
            const isNow = sameQuarter(o, now);
            return (
              <button
                key={`${o.year}-${o.q}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`qpick__option${selected ? " is-selected" : ""}${
                  isNow ? " is-now" : ""
                }`}
                style={{
                  color: theme.ink,
                  background: selected ? theme.themeBand : "transparent",
                }}
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                }}
              >
                {shortQuarter(o)}
                {isNow && (
                  <span className="qpick__now" style={{ color: theme.accentSoft }}>
                    Now
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
