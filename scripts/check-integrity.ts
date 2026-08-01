/**
 * Integrity gate: YAML catalog ↔ published spec ↔ profiles.
 * Run from repo root: npm run aprf:integrity
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getGeneratedCatalog } from "../packages/aprf-engine/src/catalog.ts";
import {
  PROFILE_CORE,
  PROFILE_REGULATED,
  getTier3OnlyMandatoryIds,
  APRF_LENSES,
  getLensById,
  unionProfileAndLenses,
  LENS_ID_RAG,
} from "../packages/framework-definition/src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

const catalog = getGeneratedCatalog();
const catalogIds = new Set(catalog.rules.map((r) => r.id));
assert(catalog.ruleCount === catalog.rules.length, "ruleCount mismatch");
assert(catalogIds.size === catalog.rules.length, "duplicate catalog IDs");

const spec = JSON.parse(
  readFileSync(join(root, "spec", "aprf-spec.json"), "utf8"),
) as {
  governance?: { version?: string };
  pillars?: Array<{
    mandatoryChecks?: Array<{ id: string }>;
    recommendedChecks?: Array<{ id: string }>;
  }>;
  profiles?: Array<{ id: string; mandatoryCheckIds?: string[] }>;
  lenses?: Array<{ id: string; additionalMandatoryCheckIds?: string[] }>;
  stewardship?: {
    participation?: { contact?: Record<string, unknown> };
  };
};

const specText = readFileSync(join(root, "spec", "aprf-spec.json"), "utf8");
const contact = spec.stewardship?.participation?.contact ?? {};
const emailHint = String(
  (contact as { emailHint?: string }).emailHint ?? "",
);
assert(
  /anu\.v\.apps@gmail\.com/i.test(emailHint),
  "stewardship.participation.contact.emailHint must include anu.v.apps@gmail.com",
);
assert(
  !/prasoonanand@/i.test(specText),
  "published spec must not contain retired personal email addresses",
);
assert(
  !/POST\s*\/api\/aprf\/submit/i.test(specText),
  "published spec must not embed product API endpoints",
);

const specIds = new Set<string>();
for (const pillar of spec.pillars ?? []) {
  for (const c of pillar.mandatoryChecks ?? []) specIds.add(c.id);
  for (const c of pillar.recommendedChecks ?? []) specIds.add(c.id);
}

const onlyInCatalog = [...catalogIds].filter((id) => !specIds.has(id)).sort();
const onlyInSpec = [...specIds].filter((id) => !catalogIds.has(id)).sort();
assert(
  onlyInCatalog.length === 0 && onlyInSpec.length === 0,
  `YAML catalog ↔ spec Check ID drift.\n  only in YAML: ${onlyInCatalog.join(", ") || "(none)"}\n  only in spec: ${onlyInSpec.join(", ") || "(none)"}`,
);

assert(
  PROFILE_CORE.mandatoryCheckIds.length === 39,
  `Core profile expected 39, got ${PROFILE_CORE.mandatoryCheckIds.length}`,
);
assert(
  PROFILE_REGULATED.mandatoryCheckIds.length === 51,
  `Regulated profile expected 51, got ${PROFILE_REGULATED.mandatoryCheckIds.length}`,
);
assert(getTier3OnlyMandatoryIds().length === 12, "tier3-only count");

for (const id of PROFILE_REGULATED.mandatoryCheckIds) {
  assert(catalogIds.has(id), `profile Check missing from YAML catalog: ${id}`);
}

const specProfiles = new Map(
  (spec.profiles ?? []).map((p) => [p.id, p.mandatoryCheckIds ?? []]),
);
const coreSpec = specProfiles.get("aprf-profile-core") ?? [];
const regSpec = specProfiles.get("aprf-profile-regulated") ?? [];
assert(
  JSON.stringify(coreSpec) === JSON.stringify(PROFILE_CORE.mandatoryCheckIds),
  "framework-definition Core profile ≠ spec.profiles Core mandatoryCheckIds",
);
assert(
  JSON.stringify(regSpec) ===
    JSON.stringify(PROFILE_REGULATED.mandatoryCheckIds),
  "framework-definition Regulated profile ≠ spec.profiles Regulated mandatoryCheckIds",
);

for (const lens of spec.lenses ?? []) {
  for (const id of lens.additionalMandatoryCheckIds ?? []) {
    assert(
      catalogIds.has(id),
      `lens ${lens.id} references missing Check ${id}`,
    );
  }
  const pkg = getLensById(lens.id);
  assert(pkg, `spec lens ${lens.id} missing from framework-definition`);
  assert(
    JSON.stringify(pkg.additionalMandatoryCheckIds) ===
      JSON.stringify(lens.additionalMandatoryCheckIds ?? []),
    `framework-definition lens ${lens.id} ≠ spec.lenses additionalMandatoryCheckIds`,
  );
}

assert(APRF_LENSES.length === (spec.lenses?.length ?? 0), "lens count mismatch");

const union = unionProfileAndLenses(PROFILE_CORE.mandatoryCheckIds, [
  LENS_ID_RAG,
]);
assert(
  union.length >= PROFILE_CORE.mandatoryCheckIds.length,
  "profile∪lens should be at least profile size",
);
assert(union.includes("DG-M1"), "RAG lens adds DG-M1");

console.log(
  `aprf:integrity OK — catalog=${catalogIds.size} spec=${specIds.size} core=${PROFILE_CORE.mandatoryCheckIds.length} regulated=${PROFILE_REGULATED.mandatoryCheckIds.length} lenses=${APRF_LENSES.length} version=${spec.governance?.version}`,
);
