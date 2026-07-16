import { fonts } from "../theme";
import { useTheme } from "../theme-context";
import { VisualCard, PageGrid, Row, useViz } from "../components/viz";
import { Bionic } from "../a11y/Bionic";
import { PLAYBOOK_SECTIONS } from "./playbook-content";
import type { PlaybookBlock } from "./playbook-content";

// Operational playbook: renders the single content module shared with
// tools/build-playbook-md.mjs (which emits PLAYBOOK.md from the same data) —
// edit src/pages/playbook-content.ts, never this file's prose, and never
// PLAYBOOK.md directly.

function anchorFor(id: string) {
  return `sec-${id}`;
}

function Block({ block }: { block: PlaybookBlock }) {
  const t = useTheme();
  switch (block.kind) {
    case "heading": {
      // VisualCard's own title renders as an h3 — nest section sub-headings
      // one level below that (h4 for level 3, h5 for level 4).
      const Tag = (block.level ?? 3) === 4 ? "h5" : "h4";
      return (
        <Tag style={{ margin: "4px 0 0", fontFamily: fonts.display, fontSize: Tag === "h5" ? 13.5 : 14.5, fontWeight: 700, color: t.ink }}>
          {block.text}
        </Tag>
      );
    }
    case "prose":
      return (
        <p style={{ margin: 0, fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.55 }}>
          <Bionic>{block.text ?? ""}</Bionic>
        </p>
      );
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {(block.items ?? []).map((it, i) => (
            <li key={i} style={{ fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.5 }}>
              <Bionic>{it}</Bionic>
            </li>
          ))}
        </ListTag>
      );
    }
    case "checklist":
      return (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
          {(block.items ?? []).map((it, i) => (
            <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input type="checkbox" disabled checked={false} readOnly style={{ marginTop: 3, flex: "0 0 auto" }} aria-hidden />
              <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.5 }}>
                <Bionic>{it}</Bionic>
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div style={{ overflow: "auto", border: `1px solid ${t.ruleSoft}`, borderRadius: 9 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fonts.body }}>
            <thead>
              <tr>
                {(block.headers ?? []).map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      fontFamily: fonts.mono,
                      fontSize: 10.5,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: t.inkSoft,
                      fontWeight: 700,
                      borderBottom: `1px solid ${t.ruleSoft}`,
                      background: t.themeBand,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(block.rows ?? []).map((r, ri) => (
                <tr key={ri} style={{ background: ri % 2 ? t.themeBand : "transparent" }}>
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      style={{
                        textAlign: "left",
                        padding: "8px 12px",
                        fontSize: 12.5,
                        color: t.ink,
                        borderBottom: `1px solid ${t.ruleSoft}`,
                        verticalAlign: "top",
                      }}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${t.ruleSoft}`,
            background: t.themeBand,
            overflow: "auto",
            fontFamily: fonts.mono,
            fontSize: 12,
            color: t.ink,
          }}
        >
          <code>{block.code}</code>
        </pre>
      );
    case "callout": {
      const v = block.tone === "warn";
      return (
        <div
          style={{
            display: "flex",
            gap: 9,
            alignItems: "flex-start",
            border: `1px solid ${t.ruleSoft}`,
            borderLeft: `3px solid ${v ? "#D55E00" : t.accent}`,
            borderRadius: 8,
            padding: "9px 12px",
            background: t.themeBand,
          }}
        >
          <span style={{ fontWeight: 700, color: v ? "#D55E00" : t.accent, flex: "0 0 auto" }}>{v ? "!" : "i"}</span>
          <span style={{ fontFamily: fonts.body, fontSize: 13, color: t.ink, lineHeight: 1.5 }}>
            <Bionic>{block.text ?? ""}</Bionic>
          </span>
        </div>
      );
    }
    default:
      return null;
  }
}

export function Playbook() {
  const v = useViz();

  return (
    <PageGrid>
      {/* jump nav */}
      <Row cols="1fr" grow={false}>
        <VisualCard title="Jump to a section" subtitle="Operational playbook — also generated as PLAYBOOK.md via npm run docs:playbook">
          <nav aria-label="Playbook sections" style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", paddingTop: 2 }}>
            {PLAYBOOK_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${anchorFor(s.id)}`}
                style={{ fontFamily: fonts.body, fontSize: 12.5, fontWeight: 600, color: v.accent, textDecoration: "none" }}
              >
                {s.title}
              </a>
            ))}
          </nav>
        </VisualCard>
      </Row>

      {PLAYBOOK_SECTIONS.map((s) => (
        <div key={s.id} id={anchorFor(s.id)}>
          <Row cols="1fr" grow={false}>
            <VisualCard title={s.title}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 2 }}>
                {s.blocks.map((b, i) => (
                  <Block key={i} block={b} />
                ))}
              </div>
            </VisualCard>
          </Row>
        </div>
      ))}
    </PageGrid>
  );
}
