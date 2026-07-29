/**
 * Smoke: render HTML from the minimal assessment fixture.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(skillRoot, "../..");
const outDir = mkdtempSync(join(tmpdir(), "aprf-html-"));
const outHtml = join(outDir, "REPORT.html");
const fixture = join(skillRoot, "examples/minimal-assessment.json");

execFileSync(
  "npx",
  [
    "tsx",
    join(skillRoot, "scripts/render-html-report.ts"),
    "--in",
    fixture,
    "--out",
    outHtml,
  ],
  { cwd: repoRoot, stdio: "pipe" },
);

const html = readFileSync(outHtml, "utf8");
for (const needle of [
  "<!DOCTYPE html>",
  "SEC2-M1",
  "Executive summary",
  "example-project",
  "stackrail.io",
  "Visual overview",
  "Control status mix",
  "Criticality",
  "Required capability",
  "Not observed",
]) {
  if (!html.includes(needle)) {
    throw new Error(`HTML missing ${needle}`);
  }
}

console.log("aprf-auditor HTML report smoke OK");
rmSync(outDir, { recursive: true, force: true });
