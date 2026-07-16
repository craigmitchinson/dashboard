// ---------------------------------------------------------------------------
// build-playbook-md.mjs
// ---------------------------------------------------------------------------
// Regenerates PLAYBOOK.md at the repo root from the single content module
// src/pages/playbook-content.ts — the same module the in-app Playbook page
// (src/pages/Playbook.tsx) renders. There is exactly one place the prose
// lives; this script and the page just render it two different ways.
//
// src/pages/playbook-content.ts is deliberately pure data (no React, no JSX)
// so a plain Node script can import it directly with a dynamic import() of
// the .ts path — Node 22.6+ supports stripping simple type annotations from
// .ts files (stable, no flag needed, since Node 23.6); this repo's installed
// Node (checked via `node --version`) imports it with zero flags. If your
// Node is older than 22.6, run this script with:
//   node --experimental-strip-types tools/build-playbook-md.mjs
//
// Run: npm run docs:playbook
// ---------------------------------------------------------------------------
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_PATH = join(root, "src", "pages", "playbook-content.ts");
const OUT_PATH = join(root, "PLAYBOOK.md");

const { PLAYBOOK_SECTIONS } = await import(pathToFileUrl(CONTENT_PATH));

function pathToFileUrl(p) {
  return "file://" + p.replaceAll("\\", "/");
}

// --- markdown table rendering (GitHub-flavoured) ----------------------------
function mdTable(headers, rows) {
  const esc = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
  const head = `| ${headers.map(esc).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

// --- render a single block --------------------------------------------------
function renderBlock(block) {
  switch (block.kind) {
    case "heading": {
      const hashes = "#".repeat(block.level ?? 3);
      return `${hashes} ${block.text}`;
    }
    case "prose":
      return block.text ?? "";
    case "list":
      return (block.items ?? []).map((it, i) => (block.ordered ? `${i + 1}. ${it}` : `- ${it}`)).join("\n");
    case "checklist":
      return (block.items ?? []).map((it) => `- [ ] ${it}`).join("\n");
    case "table":
      return mdTable(block.headers ?? [], block.rows ?? []);
    case "code":
      return "```" + (block.lang ?? "") + "\n" + (block.code ?? "") + "\n```";
    case "callout": {
      const tag = block.tone === "warn" ? "**Note:**" : "**Info:**";
      return `> ${tag} ${block.text}`;
    }
    default:
      return "";
  }
}

function renderSection(section) {
  const lines = [`## ${section.title}`, ""];
  for (const block of section.blocks) {
    lines.push(renderBlock(block));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// --- assemble the document --------------------------------------------------
const header = "<!-- GENERATED FILE — do not hand-edit. Edit src/pages/playbook-content.ts (or its data module) and run \"npm run docs:playbook\" to regenerate. -->";
const title = "# Operational Playbook — Intelligent Automation — Performance";
const intro = "How to run, extend and troubleshoot this dashboard, in plain English. Every section below also renders as an in-app page (Playbook, in the Reference group) — both come from the same content module, so they never drift apart.";

const toc = ["## Contents", ""].concat(
  PLAYBOOK_SECTIONS.map((s) => {
    const anchor = s.title
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    return `- [${s.title}](#${anchor})`;
  })
);

const doc = [header, "", title, "", intro, "", toc.join("\n"), "", ...PLAYBOOK_SECTIONS.map(renderSection).join("\n\n").split("\n")].join("\n");

writeFileSync(OUT_PATH, doc.trimEnd() + "\n", "utf8");
console.log(`PLAYBOOK.md written (${PLAYBOOK_SECTIONS.length} sections) -> ${OUT_PATH}`);
