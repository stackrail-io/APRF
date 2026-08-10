/**
 * Load YAML rules and write a browser-safe generated TypeScript catalog.
 * Run: npm run build-catalog -w @stackrail-io/aprf-engine
 *
 * `generatedAt` is a content hash (not wall-clock) so CI drift checks stay stable
 * when rule bodies are unchanged.
 */
import { createHash } from "crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import type { CrosswalkDef, ThreatIntelDef } from "../src/catalog-types";
import { loadRulesFromDisk, rulesRootDir } from "../src/loader";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "src", "generated", "catalog.ts");

function contentStamp(
  domains: unknown,
  pillars: unknown,
  categories: unknown,
  rules: unknown,
  crosswalks: unknown,
  threatIntel: unknown,
): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        domains,
        pillars,
        categories,
        rules,
        crosswalks,
        threatIntel,
      }),
    )
    .digest("hex");
  return `sha256:${digest}`;
}

function findRepoRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "spec", "aprf-spec.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return from;
}

/** Crosswalks are published in spec/aprf-spec.json; embed them so the catalog ships offline. */
function loadCrosswalks(rulesRoot: string): CrosswalkDef[] {
  const specPath = join(findRepoRoot(rulesRoot), "spec", "aprf-spec.json");
  if (!existsSync(specPath)) return [];
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as {
    crosswalks?: CrosswalkDef[];
  };
  return spec.crosswalks ?? [];
}

/** Threat context lives in spec/aprf-threat-map.yaml; embed it so the catalog ships offline. */
function loadThreatIntel(rulesRoot: string): Record<string, ThreatIntelDef> {
  const mapPath = join(findRepoRoot(rulesRoot), "spec", "aprf-threat-map.yaml");
  if (!existsSync(mapPath)) return {};
  const doc = parseYaml(readFileSync(mapPath, "utf8")) as {
    rules?: Record<string, ThreatIntelDef>;
  };
  return doc.rules ?? {};
}

function main() {
  const root = rulesRootDir();
  const { rules, domains, pillars, categories, errors } = loadRulesFromDisk(root);

  if (errors.length > 0) {
    console.error("aprf-engine build-catalog refused — validation errors:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const crosswalks = loadCrosswalks(root);
  const ruleIds = new Set(rules.map((r) => r.id));
  const allPeerControlIds = new Set<string>();
  for (const cw of crosswalks) {
    for (const c of cw.controls ?? []) allPeerControlIds.add(c.id);
  }
  const danglingRelated: string[] = [];
  const crosswalkErrors: string[] = [];
  for (const cw of crosswalks) {
    const peerControlIds = new Set((cw.controls ?? []).map((c) => c.id));
    const mappedPeerIds = new Set<string>();
    for (const c of cw.controls ?? []) {
      for (const relatedId of c.relatedPeerControlIds ?? []) {
        if (!allPeerControlIds.has(relatedId)) {
          danglingRelated.push(`${cw.id} / ${c.id} → ${relatedId}`);
        }
      }
    }
    for (const m of cw.mappings ?? []) {
      // buildCrosswalkIndex skips mappings whose peer control is unknown, so an
      // unvalidated typo would silently drop crosswalks from reports.
      if (!peerControlIds.has(m.peerControlId)) {
        crosswalkErrors.push(
          `${cw.id} maps unknown peer control ${m.peerControlId}`,
        );
      }
      mappedPeerIds.add(m.peerControlId);
      for (const id of m.aprfCheckIds ?? []) {
        if (!ruleIds.has(id)) {
          crosswalkErrors.push(`${cw.id} maps unknown Check ${id}`);
        }
      }
    }
    // Every published peer control must have a mapping row or it never appears
    // on Checks / REPORT.html despite shipping in the catalog.
    const unmapped = [...peerControlIds].filter((id) => !mappedPeerIds.has(id));
    if (unmapped.length > 0) {
      crosswalkErrors.push(
        `${cw.id} has ${unmapped.length} control(s) with no mappings: ${unmapped.join(", ")}`,
      );
    }
  }
  if (danglingRelated.length > 0) {
    console.error(
      `aprf-engine build-catalog refused — ${danglingRelated.length} relatedPeerControlIds reference unknown peer controls:`,
    );
    for (const d of danglingRelated) console.error(`  - ${d}`);
    process.exit(1);
  }
  if (crosswalkErrors.length > 0) {
    console.error(
      `aprf-engine build-catalog refused — ${crosswalkErrors.length} crosswalk error(s):`,
    );
    for (const e of crosswalkErrors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const threatIntel = loadThreatIntel(root);
  for (const id of Object.keys(threatIntel)) {
    if (!ruleIds.has(id)) {
      console.error(
        `aprf-engine build-catalog refused — threat map describes unknown Check ${id}`,
      );
      process.exit(1);
    }
  }
  // Once the map exists it must stay complete, so a new Check cannot ship without
  // threat context. An absent map is tolerated for bootstrap builds.
  if (Object.keys(threatIntel).length > 0) {
    const missing = rules.map((r) => r.id).filter((id) => !threatIntel[id]);
    if (missing.length > 0) {
      console.error(
        `aprf-engine build-catalog refused — threat map missing ${missing.length} Check(s): ${missing.join(", ")}`,
      );
      process.exit(1);
    }
  }

  const catalog = {
    generatedAt: contentStamp(
      domains,
      pillars,
      categories,
      rules,
      crosswalks,
      threatIntel,
    ),
    ruleCount: rules.length,
    domains,
    pillars,
    categories,
    rules,
    crosswalks,
    threatIntel,
  };

  const body = `/* eslint-disable */
/**
 * AUTO-GENERATED by scripts/build-catalog.ts — do not edit by hand.
 * Source: packages/aprf-engine/rules/
 */
import type { GeneratedCatalog } from "../catalog-types.js";

export const GENERATED_CATALOG: GeneratedCatalog = ${JSON.stringify(catalog, null, 2)} as GeneratedCatalog;
`;

  if (existsSync(outPath)) {
    const prev = readFileSync(outPath, "utf8");
    if (prev === body) {
      console.log(`Unchanged ${outPath} (${rules.length} rules)`);
      return;
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, body);
  console.log(`Wrote ${outPath} (${rules.length} rules, ${catalog.generatedAt})`);
}

main();
