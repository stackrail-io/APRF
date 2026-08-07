/**
 * Browser-safe catalog access.
 * Populated by `npm run build-catalog -w @stackrail-io/aprf-engine`.
 * Until the first generate, returns an empty catalog.
 */
import type {
  CrosswalkRelation,
  GeneratedCatalog,
  ThreatIntelDef,
} from "./catalog-types.js";
import type { RuleIndex } from "./types.js";
import { buildRuleIndex } from "./index-builder.js";
import { GENERATED_CATALOG } from "./generated/catalog.js";

export function getGeneratedCatalog(): GeneratedCatalog {
  return GENERATED_CATALOG;
}

/** One peer-framework control a Check maps to (informative alignment only). */
export interface CheckCrosswalk {
  frameworkId: string;
  framework: string;
  peerVersion?: string;
  url?: string;
  disclaimer?: string;
  controlRef: string;
  controlTitle: string;
  relation: CrosswalkRelation;
}

let crosswalkIndex: Map<string, CheckCrosswalk[]> | null = null;

function buildCrosswalkIndex(): Map<string, CheckCrosswalk[]> {
  const index = new Map<string, CheckCrosswalk[]>();
  for (const framework of getGeneratedCatalog().crosswalks ?? []) {
    const controls = new Map(framework.controls.map((c) => [c.id, c]));
    for (const mapping of framework.mappings ?? []) {
      const control = controls.get(mapping.peerControlId);
      if (!control) continue;
      for (const checkId of mapping.aprfCheckIds ?? []) {
        const entry: CheckCrosswalk = {
          frameworkId: framework.id,
          framework: framework.name,
          peerVersion: framework.peerVersion,
          url: framework.url,
          disclaimer: framework.disclaimer,
          controlRef: control.ref,
          controlTitle: control.title,
          relation: mapping.relation,
        };
        const list = index.get(checkId);
        if (list) list.push(entry);
        else index.set(checkId, [entry]);
      }
    }
  }
  return index;
}

/**
 * Peer-framework controls mapped to a Check, from spec crosswalks.
 * Informative alignment only — never proof of certification or compliance.
 */
export function getCrosswalksForCheck(checkId: string): CheckCrosswalk[] {
  crosswalkIndex ??= buildCrosswalkIndex();
  return crosswalkIndex.get(checkId) ?? [];
}

/**
 * Why a Check exists and what it defends against, from the published threat map.
 * Informative context only — it never affects status, score, or gating.
 * Returns null for Checks with no published threat context.
 */
export function getThreatIntelForCheck(checkId: string): ThreatIntelDef | null {
  return getGeneratedCatalog().threatIntel?.[checkId] ?? null;
}

export function getGeneratedRuleIndex(): RuleIndex {
  const catalog = getGeneratedCatalog();
  return buildRuleIndex(
    catalog.rules,
    catalog.categories,
    catalog.domains ?? [],
    catalog.pillars ?? [],
  );
}
