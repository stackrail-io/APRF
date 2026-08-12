/**
 * Project resolved minimumTier onto every Check row in spec/aprf-spec.json.
 * Source of truth: YAML catalog evidencePolicy + capability defaults (APRF-RFC-0011).
 * Run from repo root: npm run aprf:sync-evidence-tiers
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getGeneratedCatalog } from "../packages/aprf-engine/src/catalog.ts";
import { resolveMinimumTier } from "../packages/aprf-engine/src/evidence-tiers.ts";
import type { EvidenceTier } from "../packages/aprf-engine/src/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "spec", "aprf-spec.json");

type SpecCheck = {
  id: string;
  minimumTier?: EvidenceTier;
  [key: string]: unknown;
};

type SpecPillar = {
  mandatoryChecks?: SpecCheck[];
  recommendedChecks?: SpecCheck[];
  [key: string]: unknown;
};

function orderedCheck(check: SpecCheck, tier: EvidenceTier): SpecCheck {
  const { minimumTier: _drop, ...rest } = check;
  const out: SpecCheck = { id: check.id };
  for (const [k, v] of Object.entries(rest)) {
    if (k === "id") continue;
    out[k] = v;
    if (k === "method") out.minimumTier = tier;
  }
  if (out.minimumTier == null) out.minimumTier = tier;
  return out;
}

function main() {
  const catalog = getGeneratedCatalog();
  const byId = new Map(catalog.rules.map((r) => [r.id, r]));

  const spec = JSON.parse(readFileSync(specPath, "utf8")) as {
    pillars?: SpecPillar[];
  };

  let updated = 0;
  let unchanged = 0;
  for (const pillar of spec.pillars ?? []) {
    for (const list of [pillar.mandatoryChecks, pillar.recommendedChecks]) {
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const check = list[i]!;
        const rule = byId.get(check.id);
        if (!rule) {
          throw new Error(`spec Check ${check.id} missing from YAML catalog`);
        }
        const tier = resolveMinimumTier(
          rule.evidencePolicy,
          rule.detection.capability,
        );
        if (check.minimumTier === tier) {
          unchanged++;
          continue;
        }
        list[i] = orderedCheck(check, tier);
        updated++;
      }
    }
  }

  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
  console.log(
    `OK: synced evidence tiers — updated=${updated} unchanged=${unchanged}`,
  );
}

try {
  main();
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
