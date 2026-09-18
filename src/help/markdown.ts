// ---------------------------------------------------------------------------
// help/markdown.ts
// ---------------------------------------------------------------------------
// A tiny, pure parser for the "light markdown" the feature catalogue's item
// bodies use (see docs/feature-catalogue.data.mjs's own file-header comment):
// **bold**, `code`, a blank line starting a new paragraph, and "- " bullets.
// Tables are NOT markdown text in the catalogue — they're already structured
// data ({headers, rows}) on the item itself — so there's no table syntax
// here; MarkdownTable in MarkdownBody.tsx renders those directly.
//
// Pure, DOM-free and React-free so it's unit testable on its own — see
// tests/help-markdown.test.ts. MarkdownBody.tsx is the render layer.
// ---------------------------------------------------------------------------

export type MdInline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "code"; text: string };

export type MdBlock = { kind: "p"; inline: MdInline[] } | { kind: "ul"; items: MdInline[][] };

const INLINE_RE = /\*\*(.+?)\*\*|`(.+?)`/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    last = INLINE_RE.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.split("\n");
  const blocks: MdBlock[] = [];
  let paraLines: string[] = [];
  let listItems: string[] = [];

  const flushPara = () => {
    if (paraLines.length) {
      blocks.push({ kind: "p", inline: parseInline(paraLines.join(" ")) });
      paraLines = [];
    }
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ kind: "ul", items: listItems.map(parseInline) });
      listItems = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    paraLines.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
