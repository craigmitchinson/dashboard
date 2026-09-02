import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { SPOKE_INFO } from "../rpaData";

// Consistent, quiet spoke-colour identity used across process/exception/alert
// rows so a spoke's processes read as visually grouped without a colour
// flood: a small swatch (never a text-background fill), optionally paired
// with the spoke's short code as text. Colour is never the only signal — the
// swatch always carries an aria-label (when unlabelled) or sits next to the
// visible short/full name text (when labelled), and always keeps a 1px
// currentColor ring so it stays visible under forced-colors/high-contrast
// overrides that can strip background fills.

export function spokeColorFor(spoke: string, mode: "light" | "dark"): string | undefined {
  return SPOKE_INFO[spoke]?.[mode];
}

interface SpokeSwatchProps {
  spoke: string;
  size?: "sm" | "md";
  /** Render the spoke's short code as visible text beside the swatch. When
   *  false (default), the swatch stands alone with an aria-label + tooltip. */
  label?: boolean;
  /** The spoke's name is already visible as adjacent text (e.g. right after
   *  the swatch in a table cell) — mark it aria-hidden instead of giving it
   *  its own aria-label, so screen readers don't hear the spoke twice. */
  decorative?: boolean;
}

export function SpokeSwatch({ spoke, size = "sm", label = false, decorative = false }: SpokeSwatchProps) {
  const t = useTheme();
  const info = SPOKE_INFO[spoke];
  const color = info?.[t.mode === "dark" ? "dark" : "light"] ?? t.inkSoft;
  const dim = size === "md" ? 12 : 10;

  const dot = (
    <span
      {...(label || decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": `Spoke: ${spoke}`, title: spoke })}
      style={{
        display: "inline-block",
        flex: "0 0 auto",
        width: dim,
        height: dim,
        borderRadius: 3,
        background: color,
        border: "1px solid currentColor",
        color,
        boxSizing: "border-box",
      }}
    />
  );

  if (!label) return dot;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 }}>
      {dot}
      <span
        style={{
          fontFamily: fonts.mono,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.02em",
          color: t.inkSoft,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {info?.short ?? spoke}
      </span>
    </span>
  );
}
