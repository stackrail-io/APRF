/** Capability maturity level (L1–L5). */
export type CapabilityLevel = 1 | 2 | 3 | 4 | 5;

/** Blast-radius / business-impact tier. */
export type CriticalityTier = 0 | 1 | 2 | 3;

export type Severity = "critical" | "high" | "medium" | "low";

export type RuleGate = "mandatory" | "recommended";

export type RuleStatus = "active" | "deprecated" | "draft";

export type DetectionCapability = "automated" | "manual" | "hybrid" | "none";

/** Controlled technology surfaces for applicability filters. */
export type Technology =
  | "github"
  | "terraform"
  | "docker"
  | "kubernetes"
  | "github-actions"
  | "azure-devops"
  | "aws"
  | "gcp"
  | "azure"
  | "prompt-templates"
  | "rag-pipelines"
  | "vector-databases"
  | "mcp"
  | "a2a"
  | "openapi"
  | "cicd";

export const TECHNOLOGIES: readonly Technology[] = [
  "github",
  "terraform",
  "docker",
  "kubernetes",
  "github-actions",
  "azure-devops",
  "aws",
  "gcp",
  "azure",
  "prompt-templates",
  "rag-pipelines",
  "vector-databases",
  "mcp",
  "a2a",
  "openapi",
  "cicd",
] as const;

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface RuleReference {
  title: string;
  url?: string;
}

export interface DetectorRef {
  id: string;
  params?: Record<string, unknown>;
}

export interface RuleDetection {
  capability: DetectionCapability;
  detectors?: DetectorRef[];
}

export interface RuleApplicability {
  /** Empty = technology-agnostic. */
  technologies?: Technology[];
  minCriticality: CriticalityTier;
  requiredFromLevel: CapabilityLevel;
  profiles?: string[];
  lenses?: string[];
}

/**
 * Normative APRF rule. Source of truth is YAML under packages/aprf-engine/rules/.
 */
export interface AprfRule {
  id: string;
  category: string;
  title: string;
  description: string;
  whyItMatters: string;
  severity: Severity;
  weight: number;
  gate: RuleGate;
  passCondition: string;
  evidenceRequired: string[];
  detection: RuleDetection;
  manualVerification: string;
  falsePositiveGuidance: string;
  recommendedFixes: string[];
  references: RuleReference[];
  relatedRules: string[];
  tags: string[];
  applicability: RuleApplicability;
  status: RuleStatus;
  deprecated?: boolean;
  replacedBy?: string;
  deprecationNote?: string;
  introducedIn?: string;
}

export interface CategoryDef {
  id: string;
  /** Pillar slug used by the marketing site. */
  pillarSlug: string;
  domain: string | null;
  name: string;
  summary?: string;
}

export interface RuleIndex {
  rules: AprfRule[];
  byId: Map<string, AprfRule>;
  byCategory: Map<string, AprfRule[]>;
  byTag: Map<string, AprfRule[]>;
  byTechnology: Map<Technology, AprfRule[]>;
  bySeverity: Map<Severity, AprfRule[]>;
  byGate: Map<RuleGate, AprfRule[]>;
  categories: CategoryDef[];
  categoryById: Map<string, CategoryDef>;
}

/** Projection of AprfRule onto the legacy AprfCheck shape used by marketing scoring. */
export interface AprfCheckProjection {
  id: string;
  requirement: string;
  artifact: string;
  passCondition: string;
  method: "automated" | "manual" | "hybrid";
  requiredFromLevel: CapabilityLevel;
  minCriticality: CriticalityTier;
  deprecated?: boolean;
  replacedBy?: string;
  deprecationNote?: string;
}
