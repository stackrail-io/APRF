export type {
  CapabilityLevel,
  CriticalityTier,
  Severity,
  RuleGate,
  RuleStatus,
  DetectionCapability,
  Technology,
  RuleReference,
  DetectorRef,
  RuleDetection,
  RuleApplicability,
  EvidenceTier,
  RuleEvidencePolicy,
  AprfRule,
  CategoryDef,
  DomainDef,
  PillarDef,
  RuleIndex,
  AprfCheckProjection,
} from "./types.js";

export { TECHNOLOGIES, SEVERITY_WEIGHT, EVIDENCE_TIERS } from "./types.js";

export {
  CLASS_TO_TIER,
  CLASS_TO_EVIDENCE_TYPES,
  defaultMinimumTier,
  resolveMinimumTier,
  parseEvidenceTier,
  tierRank,
  maxTier,
  tierMeetsFloor,
  tierFromEvidenceClass,
  classifyAchievedTier,
  verificationFor,
  matchedEvidenceTypes,
} from "./evidence-tiers.js";
export type {
  EvidenceVerification,
  EvidenceClassLike,
  ControlEvidenceTier,
} from "./evidence-tiers.js";

export {
  buildRuleIndex,
  ruleToCheckProjection,
  checksForCategory,
  getRuleById,
} from "./index-builder.js";

export type {
  GeneratedCatalog,
  CrosswalkDef,
  CrosswalkControlDef,
  CrosswalkMappingDef,
  CrosswalkRelation,
  ThreatIntelDef,
} from "./catalog-types.js";
export type { CheckCrosswalk } from "./catalog.js";
export {
  getGeneratedCatalog,
  getGeneratedRuleIndex,
  getCrosswalksForCheck,
  getThreatIntelForCheck,
} from "./catalog.js";

export {
  createDetectorRegistry,
  listRegisteredDetectorIds,
  listCatalogDetectorIds,
  listCatalogDetectorIdsForValidation,
} from "./detectors/registry.js";
export { CATALOG_DETECTOR_IDS } from "./detectors/catalog-ids.js";
export type { CatalogDetectorId } from "./detectors/catalog-ids.js";
export type {
  Detector,
  DetectorContext,
  DetectorResult,
  DetectorRegistry,
} from "./detectors/types.js";

export {
  selectApplicableRules,
  evaluateRules,
  findingsToCheckOutcomes,
} from "./evaluate.js";
export type {
  EvaluationContext,
  RuleFinding,
  RuleOutcomeStatus,
  AttestedOutcome,
} from "./evaluate.js";
