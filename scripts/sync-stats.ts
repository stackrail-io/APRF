/**
 * Recompute and write spec/aprf-spec.json `stats` from catalog + spec.
 * Run from repo root: npm run aprf:sync-stats
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getGeneratedCatalog } from "../packages/aprf-engine/src/catalog.ts";
import { computeSpecStats } from "./lib/spec-stats.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "spec", "aprf-spec.json");

function main() {
  const specText = readFileSync(specPath, "utf8");
  const spec = JSON.parse(specText) as {
    crosswalks?: Array<{ mappings?: unknown[] }>;
    profiles?: unknown[];
    lenses?: Array<{ additionalMandatoryCheckIds?: string[] }>;
    stats?: unknown;
  };

  const stats = computeSpecStats(getGeneratedCatalog(), spec);

  const start = specText.indexOf('  "stats": {');
  if (start < 0) throw new Error("spec/aprf-spec.json: missing top-level stats object");
  const afterKey = start + '  "stats": '.length;
  let depth = 0;
  let end = -1;
  for (let i = afterKey; i < specText.length; i++) {
    const ch = specText[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("spec/aprf-spec.json: unterminated stats object");

  const statsJson = JSON.stringify(stats, null, 2)
    .split("\n")
    .map((line, idx) => (idx === 0 ? line : `  ${line}`))
    .join("\n");

  writeFileSync(specPath, specText.slice(0, afterKey) + statsJson + specText.slice(end));
  console.log(
    `OK: synced stats — domains=${stats.domainCount} pillars=${stats.pillarCount} ` +
      `mandatory=${stats.mandatoryCheckCount} recommended=${stats.recommendedCheckCount} ` +
      `core=${stats.coreProfileCheckCount} lenses=${stats.lensCount} lensChecks=${stats.lensCheckCount} ` +
      `crosswalks=${stats.crosswalkCount}/${stats.crosswalkMappingCount}`,
  );
}

try {
  main();
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
