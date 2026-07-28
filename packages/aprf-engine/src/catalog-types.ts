import type { AprfRule, CategoryDef } from "./types.js";

/** Serializable catalog written by build-catalog (browser-safe). */
export interface GeneratedCatalog {
  generatedAt: string;
  ruleCount: number;
  categories: CategoryDef[];
  rules: AprfRule[];
}
