// ---------------------------------------------------------------------------
// tests/help-markdown.test.ts
// ---------------------------------------------------------------------------
// src/help/markdown.ts — the light-markdown parser the help drawer renders
// catalogue item bodies with: **bold**, `code`, blank-line paragraphs and
// "- " bullets (see docs/feature-catalogue.data.mjs's own header comment for
// the exact subset this needs to support).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { parseInline, parseMarkdown } from "../src/help/markdown";

describe("parseInline", () => {
  it("returns a single text run for plain text", () => {
    expect(parseInline("plain text")).toEqual([{ kind: "text", text: "plain text" }]);
  });

  it("extracts a bold run", () => {
    expect(parseInline("The header always shows **Data to {date}**.")).toEqual([
      { kind: "text", text: "The header always shows " },
      { kind: "bold", text: "Data to {date}" },
      { kind: "text", text: "." },
    ]);
  });

  it("extracts a code run", () => {
    expect(parseInline("`completed ÷ attempts` · Up is good")).toEqual([
      { kind: "code", text: "completed ÷ attempts" },
      { kind: "text", text: " · Up is good" },
    ]);
  });

  it("handles bold and code mixed in one line", () => {
    expect(parseInline("**Breach** vs `warning` band")).toEqual([
      { kind: "bold", text: "Breach" },
      { kind: "text", text: " vs " },
      { kind: "code", text: "warning" },
      { kind: "text", text: " band" },
    ]);
  });
});

describe("parseMarkdown", () => {
  it("treats a blank line as a paragraph break", () => {
    const blocks = parseMarkdown("First paragraph.\n\nSecond paragraph.");
    expect(blocks).toEqual([
      { kind: "p", inline: [{ kind: "text", text: "First paragraph." }] },
      { kind: "p", inline: [{ kind: "text", text: "Second paragraph." }] },
    ]);
  });

  it("joins wrapped lines within the same paragraph with a space", () => {
    const blocks = parseMarkdown("Line one\nstill line one.");
    expect(blocks).toEqual([{ kind: "p", inline: [{ kind: "text", text: "Line one still line one." }] }]);
  });

  it("collects consecutive '- ' lines into one bullet list", () => {
    const blocks = parseMarkdown("Intro line.\n\n- First\n- Second\n- Third");
    expect(blocks).toEqual([
      { kind: "p", inline: [{ kind: "text", text: "Intro line." }] },
      {
        kind: "ul",
        items: [[{ kind: "text", text: "First" }], [{ kind: "text", text: "Second" }], [{ kind: "text", text: "Third" }]],
      },
    ]);
  });

  it("a bullet list ends a paragraph even with no blank line between them", () => {
    const blocks = parseMarkdown("Some intro\n- one\n- two");
    expect(blocks).toEqual([
      { kind: "p", inline: [{ kind: "text", text: "Some intro" }] },
      { kind: "ul", items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]] },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
  });
});
