import type { AprfRule, CategoryDef, DomainDef, PillarDef } from "./types.js";

/** Serializable catalog written by build-catalog (browser-safe). */
export interface GeneratedCatalog {
  generatedAt: string;
  ruleCount: number;
  /** Taxonomy domains (spec taxonomy.domains + crossCutting). */
  domains: DomainDef[];
  /** Pillars with stable APRF-NN ids (spec pillars[]). */
  pillars: PillarDef[];
  /**
   * Compatibility: category id == pillar slug (Check YAML `category`).
   * Prefer `domains` + `pillars`.
   */
  categories: CategoryDef[];
  rules: AprfRule[];
}
