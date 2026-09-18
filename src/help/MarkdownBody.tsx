import { fonts } from "../theme";
import type { ThemeTokens } from "../theme";
import { parseMarkdown } from "./markdown";
import type { MdInline } from "./markdown";

// ---------------------------------------------------------------------------
// help/MarkdownBody.tsx
// ---------------------------------------------------------------------------
// Render layer over help/markdown.ts's pure parser — paragraphs, "- "
// bullets, **bold** and `code`, styled with the same theme tokens/fonts as
// the rest of the app (no new CSS classes). MarkdownTable renders a
// catalogue item's structured {headers, rows} table directly (never
// markdown text — see markdown.ts's header comment).
// ---------------------------------------------------------------------------

function Inline({ parts, t }: { parts: MdInline[]; t: ThemeTokens }) {
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "bold") {
          return (
            <strong key={i} style={{ fontWeight: 700, color: t.ink }}>
              {p.text}
            </strong>
          );
        }
        if (p.kind === "code") {
          return (
            <code
              key={i}
              style={{
                fontFamily: fonts.mono,
                fontSize: "0.92em",
                background: t.themeBand,
                border: `1px solid ${t.ruleSoft}`,
                borderRadius: 4,
                padding: "1px 5px",
              }}
            >
              {p.text}
            </code>
          );
        }
        return <span key={i}>{p.text}</span>;
      })}
    </>
  );
}

export function MarkdownBody({ text, t }: { text: string; t: ThemeTokens }) {
  const blocks = parseMarkdown(text);
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "ul" ? (
          <ul key={i} style={{ margin: "4px 0 8px", paddingLeft: 18 }}>
            {b.items.map((item, j) => (
              <li key={j} style={{ fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, marginBottom: 2, lineHeight: 1.5 }}>
                <Inline parts={item} t={t} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: "0 0 8px", fontFamily: fonts.body, fontSize: 12.5, color: t.inkSoft, lineHeight: 1.5 }}>
            <Inline parts={b.inline} t={t} />
          </p>
        ),
      )}
    </>
  );
}

export function MarkdownTable({ table, t }: { table: { headers: string[]; rows: (string | number)[][] }; t: ThemeTokens }) {
  return (
    <div style={{ overflowX: "auto", margin: "4px 0 10px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body, fontSize: 12 }}>
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  padding: "5px 8px",
                  borderBottom: `1px solid ${t.ruleSoft}`,
                  color: t.inkSoft,
                  fontWeight: 700,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: "5px 8px", borderBottom: `1px solid ${t.ruleSoft}`, color: t.ink }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
