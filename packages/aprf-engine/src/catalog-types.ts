import type { AprfRule, CategoryDef, DomainDef, PillarDef } from "./types.js";

/** How an APRF Check relates to a peer-framework control (informative only). */
export type CrosswalkRelation =
  | "supports"
  | "aligns-with"
  | "partial"
  | "evidence-for";

/** A single peer-framework control (e.g. NIST AI RMF GOVERN). */
export interface CrosswalkControlDef {
  id: string;
  ref: string;
  title: string;
  summary?: string;
  /**
   * Optional bridges to controls in other published crosswalks
   * (e.g. OWASP LLM01 → aisvs:v1.0-C2.1). Informative only.
   */
  relatedPeerControlIds?: string[];
}

/** Peer control ↔ APRF Checks / pillars, as published in spec/aprf-spec.json. */
export interface CrosswalkMappingDef {
  peerControlId: string;
  aprfPillarSlugs?: string[];
  aprfCheckIds?: string[];
  relation: CrosswalkRelation;
}

/**
 * Informative alignment to a peer framework. Never evidence of certification —
 * see each framework's `disclaimer`.
 */
export interface CrosswalkDef {
  id: string;
  name: string;
  peerVersion?: string;
  url?: string;
  disclaimer?: string;
  controls: CrosswalkControlDef[];
  mappings: CrosswalkMappingDef[];
}

/**
 * Why a Check exists and what it defends against, from spec/aprf-threat-map.yaml.
 * Additive context only: it never affects scoring, gating, or evidence.
 */
export interface ThreatIntelDef {
  /** One sentence stating the security objective. */
  securityIntent: string;
  /** Human-readable threats, from the map's closed vocabulary. */
  threats: string[];
  /** Protected assets, from the map's closed vocabulary. */
  protects: string[];
  mitre: {
    /** MITRE ATLAS technique IDs; empty when no defensible mapping exists. */
    atlas: string[];
    /** MITRE ATT&CK technique IDs; empty when no defensible mapping exists. */
    attack: string[];
  };
  /** Why the control mitigates these threats (max 3 sentences). */
  mappingRationale: string;
}

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
  /** Informative peer-framework crosswalks (spec crosswalks[]). */
  crosswalks: CrosswalkDef[];
  /** Threat context keyed by Check ID (spec/aprf-threat-map.yaml). */
  threatIntel: Record<string, ThreatIntelDef>;
}
