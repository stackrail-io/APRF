/**
 * Browser-safe catalog access.
 * Populated by `npm run build-catalog -w @stackrail-io/aprf-engine`.
 * Until the first generate, returns an empty catalog.
 */
import type { GeneratedCatalog } from "./catalog-types.js";
import type { RuleIndex } from "./types.js";
import { buildRuleIndex } from "./index-builder.js";
import { GENERATED_CATALOG } from "./generated/catalog.js";

export function getGeneratedCatalog(): GeneratedCatalog {
  return GENERATED_CATALOG;
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
