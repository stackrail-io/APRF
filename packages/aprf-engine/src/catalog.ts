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
  /** Peer control IDs in other frameworks this control bridges to (e.g. aisvs:C2.1). */
  relatedPeerControlIds?: string[];
  /** Human-readable related peer refs (e.g. "AISVS C2.1") for reports. */
  relatedPeerRefs?: string[];
}

let crosswalkIndex: Map<string, CheckCrosswalk[]> | null = null;

function buildCrosswalkIndex(): Map<string, CheckCrosswalk[]> {
  const catalog = getGeneratedCatalog();
  // Check YAML `category` is the pillar slug; pillar-only mappings expand through it.
  const rulesByPillar = new Map<string, string[]>();
  for (const rule of catalog.rules) {
    const list = rulesByPillar.get(rule.category) ?? [];
    list.push(rule.id);
    rulesByPillar.set(rule.category, list);
  }

  // Resolve relatedPeerControlIds → "AISVS C2.1" labels across all frameworks.
  const peerLabelById = new Map<string, string>();
  for (const framework of catalog.crosswalks ?? []) {
    const shortName =
      framework.id === "aisvs"
        ? "AISVS"
        : framework.id === "asvs"
          ? "ASVS"
          : framework.id === "owasp-llm-top-10"
            ? "OWASP LLM"
            : framework.id === "opencre"
              ? "OpenCRE"
              : framework.id === "maestro"
                ? "MAESTRO"
                : framework.id === "fiasse"
                  ? "FIASSE"
                  : framework.name;
    for (const c of framework.controls ?? []) {
      peerLabelById.set(c.id, `${shortName} ${c.ref}`);
    }
  }

  const index = new Map<string, CheckCrosswalk[]>();
  for (const framework of catalog.crosswalks ?? []) {
    const controls = new Map(framework.controls.map((c) => [c.id, c]));
    for (const mapping of framework.mappings ?? []) {
      const control = controls.get(mapping.peerControlId);
      if (!control) continue;

      // Union explicit Check IDs with every Check under named pillars so
      // pillar-only rows in aprf-spec.json are not silently dropped.
      const checkIds = new Set<string>(mapping.aprfCheckIds ?? []);
      for (const slug of mapping.aprfPillarSlugs ?? []) {
        for (const id of rulesByPillar.get(slug) ?? []) checkIds.add(id);
      }

      const relatedPeerControlIds = control.relatedPeerControlIds?.filter(
        (id) => peerLabelById.has(id),
      );
      const relatedPeerRefs = relatedPeerControlIds?.map(
        (id) => peerLabelById.get(id)!,
      );

      const entry: CheckCrosswalk = {
        frameworkId: framework.id,
        framework: framework.name,
        peerVersion: framework.peerVersion,
        url: framework.url,
        disclaimer: framework.disclaimer,
        controlRef: control.ref,
        controlTitle: control.title,
        relation: mapping.relation,
        ...(relatedPeerControlIds?.length
          ? { relatedPeerControlIds, relatedPeerRefs }
          : {}),
      };
      for (const checkId of checkIds) {
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
