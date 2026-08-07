/**
 * Canonical computation for spec/aprf-spec.json `stats`.
 * domainCount excludes the cross-cutting domain; check counts skip deprecated;
 * lensCheckCount is the unique set of lens additionalMandatoryCheckIds.
 */
import type { GeneratedCatalog } from "../../packages/aprf-engine/src/catalog-types.ts";
import {
  APRF_LENSES,
  APRF_PROFILES,
  PROFILE_CORE,
} from "../../packages/framework-definition/src/index.ts";

export type SpecStats = {
  domainCount: number;
  pillarCount: number;
  mandatoryCheckCount: number;
  recommendedCheckCount: number;
  ruleEngine: {
    package: string;
    note: string;
  };
  profileCount: number;
  coreProfileCheckCount: number;
  crosswalkCount: number;
  crosswalkMappingCount: number;
  lensCount: number;
  lensCheckCount: number;
};

export const RULE_ENGINE_NOTE =
  "Normative rule bodies live in packages/aprf-engine/rules/; pillars hydrate checks at load time.";

type SpecSlice = {
  crosswalks?: Array<{ mappings?: unknown[] }>;
  profiles?: Array<{ id: string; mandatoryCheckIds?: string[] }>;
  lenses?: Array<{ additionalMandatoryCheckIds?: string[] }>;
  stats?: Partial<SpecStats>;
};

export function computeSpecStats(
  catalog: GeneratedCatalog,
  spec: SpecSlice,
): SpecStats {
  const active = catalog.rules.filter((r) => r.status !== "deprecated");
  const mandatoryCheckCount = active.filter((r) => r.gate === "mandatory").length;
  const recommendedCheckCount = active.filter(
    (r) => r.gate === "recommended",
  ).length;

  const domainCount = (catalog.domains ?? []).filter(
    (d) => !d.crossCutting,
  ).length;
  const pillarCount = (catalog.pillars ?? []).length;

  const crosswalks = spec.crosswalks ?? [];
  const crosswalkMappingCount = crosswalks.reduce(
    (n, cw) => n + (cw.mappings?.length ?? 0),
    0,
  );

  const lenses = spec.lenses ?? APRF_LENSES;
  const lensCheckIds = new Set<string>();
  for (const lens of lenses) {
    for (const id of lens.additionalMandatoryCheckIds ?? []) {
      lensCheckIds.add(id);
    }
  }

  // Count Core from the supplied spec (fallback package profiles) so sync/integrity
  // reflect the document being checked, not a stale import if the two diverge.
  const profiles = spec.profiles ?? APRF_PROFILES;
  const coreProfile = profiles.find((p) => p.id === PROFILE_CORE.id);
  if (!coreProfile) {
    throw new Error(`missing profile ${PROFILE_CORE.id}`);
  }

  return {
    domainCount,
    pillarCount,
    mandatoryCheckCount,
    recommendedCheckCount,
    ruleEngine: {
      package: "@stackrail-io/aprf-engine",
      note: RULE_ENGINE_NOTE,
    },
    profileCount: profiles.length,
    coreProfileCheckCount: coreProfile.mandatoryCheckIds?.length ?? 0,
    crosswalkCount: crosswalks.length,
    crosswalkMappingCount,
    lensCount: lenses.length,
    lensCheckCount: lensCheckIds.size,
  };
}
