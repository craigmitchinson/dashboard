// Builds docs/FEATURE-CATALOGUE.md from docs/feature-catalogue.data.mjs.
// Never hand-edit the output. Run: node tools/build-feature-catalogue.mjs
// Then convert to Word with tools/build-feature-catalogue-docx.py.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOGUE_META as M, SECTIONS } from "../docs/feature-catalogue.data.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- shared: numbering -------------------------------------------------------
const numbered = SECTIONS.map((s, i) => ({ ...s, n: i + 1, items: s.items.map((it, j) => ({ ...it, n: `${i + 1}.${j + 1}` })) }));
const itemCount = numbered.reduce((a, s) => a + s.items.length, 0);

// --- markdown ---------------------------------------------------------------
const mdTable = (t) => ["| " + t.headers.join(" | ") + " |", "| " + t.headers.map(() => "---").join(" | ") + " |", ...t.rows.map((r) => "| " + r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ") + " |")].join("\n");
const md = [];
md.push("<!-- GENERATED FILE — do not hand-edit. Edit docs/feature-catalogue.data.mjs and run \"node tools/build-feature-catalogue.mjs\" to regenerate. -->", "");
md.push(`# ${M.title}`, "", `## ${M.subtitle}`, "", `Version ${M.version} · ${M.dated}`, "", `**Audience:** ${M.audience}`, "", M.purpose, "", "### How to review", "", ...M.howToReview.map((l) => `- ${l}`), "", "## Contents", "");
for (const s of numbered) md.push(`- ${s.n}. ${s.title}`);
md.push("");
for (const s of numbered) {
  md.push(`## ${s.n}. ${s.title}`, "");
  if (s.intro) md.push(s.intro, "");
  for (const it of s.items) {
    md.push(`### ${it.n} ${it.title}`, "");
    if (it.body) md.push(it.body, "");
    if (it.table) md.push(mdTable(it.table), "");
  }
}
md.push(`---`, ``, `${numbered.length} sections, ${itemCount} reviewable items.`, "");
writeFileSync(join(root, "docs", "FEATURE-CATALOGUE.md"), md.join("\n"), "utf8");
console.log(`docs/FEATURE-CATALOGUE.md written (${numbered.length} sections, ${itemCount} items)`);
