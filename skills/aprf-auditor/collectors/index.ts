import type { Collector } from "./types.ts";
import { repoFilesystemCollector } from "./repo-filesystem.ts";
import { githubActionsCollector } from "./github-actions.ts";
import { otelCollector } from "./otel.ts";
import { aiDistributedTraceLinkageCollector } from "./ai-distributed-trace-linkage.ts";
import { aiTokenCostAttributionCollector } from "./ai-token-cost-attribution.ts";
import { aiTraceSensitiveRedactionCollector } from "./ai-trace-sensitive-redaction.ts";
import { aiTraceReplayCollector } from "./ai-trace-replay.ts";
import { aiTraceQualityAnnotationsCollector } from "./ai-trace-quality-annotations.ts";
import { aiSloDashboardsCollector } from "./ai-slo-dashboards.ts";
import { aiJourneySloCatalogCollector } from "./ai-journey-slo-catalog.ts";
import { aiOpsMetricsCollector } from "./ai-ops-metrics.ts";
import { aiOpsDashboardsCollector } from "./ai-ops-dashboards.ts";
import { aiSloBurnAlertsCollector } from "./ai-slo-burn-alerts.ts";
import { aiErrorBudgetReleaseGateCollector } from "./ai-error-budget-release-gate.ts";
import { aiAdversarialCapacityTestsCollector } from "./ai-adversarial-capacity-tests.ts";
import { aiStreamingSlisCollector } from "./ai-streaming-slis.ts";
import { aiRtoRpoCatalogCollector } from "./ai-rto-rpo-catalog.ts";
import { aiTimeoutsRetriesCollector } from "./ai-timeouts-retries.ts";
import { aiDegradedModeCollector } from "./ai-degraded-mode.ts";
import { aiPartialToolFailureCollector } from "./ai-partial-tool-failure.ts";
import { aiContinuityOptionsCollector } from "./ai-continuity-options.ts";
import { aiControlPlaneBackupCollector } from "./ai-control-plane-backup.ts";
import { aiChaosDependencyCollector } from "./ai-chaos-dependency.ts";
import { aiMultiProviderContinuityCollector } from "./ai-multi-provider-continuity.ts";
import { aiCircuitBulkheadCollector } from "./ai-circuit-bulkhead.ts";
import { aiFallbackEvalCollector } from "./ai-fallback-eval.ts";
import { aiContinuityDrillCollector } from "./ai-continuity-drill.ts";
import { aiWarmStandbyCollector } from "./ai-warm-standby.ts";
import { promptfooCollector } from "./promptfoo.ts";
import { httpAuthProbeCollector } from "./http-auth-probe.ts";
import { mcpS2sInventoryCollector } from "./mcp-s2s-inventory.ts";
import { authzEntryTestsCollector } from "./authz-entry-tests.ts";
import { crossTenantTestsCollector } from "./cross-tenant-tests.ts";
import { secretsHygieneCollector } from "./secrets-hygiene.ts";
import { secretRedactionCollector } from "./secret-redaction.ts";
import { injectionPolicyGateCollector } from "./injection-policy-gate.ts";
import { agentLoopLimitsCollector } from "./agent-loop-limits.ts";
import { a2aPeerAuthCollector } from "./a2a-peer-auth.ts";
import { agentCharterInventoryCollector } from "./agent-charter-inventory.ts";
import { agentGoalPolicyCollector } from "./agent-goal-policy.ts";
import { agentKillSwitchCollector } from "./agent-kill-switch.ts";
import { agentSandboxSimCollector } from "./agent-sandbox-sim.ts";
import { agentRaciOwnershipCollector } from "./agent-raci-ownership.ts";
import {
  humanApprovalAuditCollector,
  humanApprovalBypassCollector,
  humanApprovalGatesCollector,
  humanApprovalSlaCollector,
  humanApprovalUiCollector,
  humanDualControlCollector,
} from "./human-approval.ts";
import { aiSpendLimitsCollector } from "./ai-spend-limits.ts";
import { contextBudgetCollector } from "./context-budget.ts";
import { contextSourceAclCollector } from "./context-source-acl.ts";
import { contextSensitiveInclusionCollector } from "./context-sensitive-inclusion.ts";
import { contextBudgetMonitoringCollector } from "./context-budget-monitoring.ts";
import { contextCompactionEvalsCollector } from "./context-compaction-evals.ts";
import { contextStructuredBlocksCollector } from "./context-structured-blocks.ts";
import { evalSuiteCiCollector } from "./eval-suite-ci.ts";
import { evalReleaseGatesCollector } from "./eval-release-gates.ts";
import { evalOnlineSignalsCollector } from "./eval-online-signals.ts";
import { evalShadowCutoverCollector } from "./eval-shadow-cutover.ts";
import { evalTrackCatalogCollector } from "./eval-track-catalog.ts";
import { evalHumanReviewCollector } from "./eval-human-review.ts";
import { modelPinConfigCollector } from "./model-pin-config.ts";
import { modelInventoryCollector } from "./model-inventory.ts";
import { modelPromotionEvalCollector } from "./model-promotion-eval.ts";
import { modelDeprecationSunsetCollector } from "./model-deprecation-sunset.ts";
import { modelCapabilityAllowlistCollector } from "./model-capability-allowlist.ts";
import { modelLicenseProvenanceCollector } from "./model-license-provenance.ts";
import { promptVersionRegistryCollector } from "./prompt-version-registry.ts";
import { promptChangeReviewEvalCollector } from "./prompt-change-review-eval.ts";
import { promptRollbackCollector } from "./prompt-rollback.ts";
import { promptTemplateHygieneCollector } from "./prompt-template-hygiene.ts";
import { promptLintCiCollector } from "./prompt-lint-ci.ts";
import { promptAbShadowEvalCollector } from "./prompt-ab-shadow-eval.ts";
import { promptModelVersionRetentionCollector } from "./prompt-model-version-retention.ts";
import { rollbackRunbookCollector } from "./rollback-runbook.ts";
import { rollbackDrillCollector } from "./rollback-drill.ts";
import { qualitySloAutoRollbackCollector } from "./quality-slo-auto-rollback.ts";
import { oneClickAiRollbackCollector } from "./one-click-ai-rollback.ts";
import { agentBehaviorFeatureFlagsCollector } from "./agent-behavior-feature-flags.ts";
import { aiArtifactPromotionPathCollector } from "./ai-artifact-promotion-path.ts";
import { aiArtifactChangeRecordsCollector } from "./ai-artifact-change-records.ts";
import { aiConfigAsCodeCollector } from "./ai-config-as-code.ts";
import { aiCanaryProgressiveDeliveryCollector } from "./ai-canary-progressive-delivery.ts";
import { envParityModelToolCatalogCollector } from "./env-parity-model-tool-catalog.ts";
import { embeddingIndexMigrationCollector } from "./embedding-index-migration.ts";
import { incidentPlaybooksCollector } from "./incident-playbooks.ts";
import { aiContainmentDrillCollector } from "./ai-containment-drill.ts";
import { postIncidentAprfActionsCollector } from "./post-incident-aprf-actions.ts";
import { aiIncidentTabletopCollector } from "./ai-incident-tabletop.ts";
import { aiSafetyQualityAlertsCollector } from "./ai-safety-quality-alerts.ts";
import { aiCustomerNotificationCriteriaCollector } from "./ai-customer-notification-criteria.ts";
import { aiCostAlertsCollector } from "./ai-cost-alerts.ts";
import { aiRetryAmplificationCollector } from "./ai-retry-amplification.ts";
import { aiPromptCacheCollector } from "./ai-prompt-cache.ts";
import { aiModelRoutingCollector } from "./ai-model-routing.ts";
import { aiFinopsUnitEconomicsCollector } from "./ai-finops-unit-economics.ts";
import { platformGoldenPathCollector } from "./platform-golden-path.ts";
import { platformAiPipelineGatesCollector } from "./platform-ai-pipeline-gates.ts";
import { platformOwnershipSupportCollector } from "./platform-ownership-support.ts";
import { platformScaffoldingTemplatesCollector } from "./platform-scaffolding-templates.ts";
import { platformInnerLoopEvalsCollector } from "./platform-inner-loop-evals.ts";
import { platformDxMetricsCollector } from "./platform-dx-metrics.ts";
import { ragCorpusGovernanceCollector } from "./rag-corpus-governance.ts";
import { datasetProvenanceGovernanceCollector } from "./dataset-provenance-governance.ts";
import { feedbackPromotionGovernanceCollector } from "./feedback-promotion-governance.ts";
import { corpusFreshnessMetricsCollector } from "./corpus-freshness-metrics.ts";
import { trainServeSkewMonitorCollector } from "./train-serve-skew-monitor.ts";
import { datasetCardsRegistryCollector } from "./dataset-cards-registry.ts";
import { modelPayloadClassificationCollector } from "./model-payload-classification.ts";
import { modelPayloadRedactionCollector } from "./model-payload-redaction.ts";
import { vendorModelTermsCollector } from "./vendor-model-terms.ts";
import { aiDeletionExportCollector } from "./ai-deletion-export.ts";
import { aiResidencyRoutingCollector } from "./ai-residency-routing.ts";
import { aiDpiaCollector } from "./ai-dpia.ts";
import { memoryIsolationCollector } from "./memory-isolation.ts";
import { memoryRetentionCollector } from "./memory-retention.ts";
import { memoryWritePolicyCollector } from "./memory-write-policy.ts";
import { memoryIntegrityCollector } from "./memory-integrity.ts";
import { memoryPoisoningEvalsCollector } from "./memory-poisoning-evals.ts";
import { memoryPromotionArchitectureCollector } from "./memory-promotion-architecture.ts";
import { aiObligationsRegisterCollector } from "./ai-obligations-register.ts";
import { aiControlEvidenceMatrixCollector } from "./ai-control-evidence-matrix.ts";
import { aiControlPlaneAuditLogsCollector } from "./ai-control-plane-audit-logs.ts";
import { aiControlTestingCollector } from "./ai-control-testing.ts";
import { aiTrustDocumentationCollector } from "./ai-trust-documentation.ts";
import { aiIndependentAssessmentCollector } from "./ai-independent-assessment.ts";
import { aiAcceptableUsePolicyCollector } from "./ai-acceptable-use-policy.ts";
import { aiDomainOwnershipCollector } from "./ai-domain-ownership.ts";
import { aiRiskAcceptanceCollector } from "./ai-risk-acceptance.ts";
import { aiLeadershipReviewCollector } from "./ai-leadership-review.ts";
import { aiImprovementBacklogCollector } from "./ai-improvement-backlog.ts";
import { aiOrgAprfSamplingCollector } from "./ai-org-aprf-sampling.ts";
import {
  awsCollector,
  azureCollector,
  gcpCollector,
} from "./iac-cloud.ts";
import { importIngestCollector, customImportCollector } from "./import-ingest.ts";

/** Collectors with real TypeScript executors (local and/or import ingest). */
export const COLLECTORS: Collector[] = [
  repoFilesystemCollector,
  githubActionsCollector,
  otelCollector,
  aiDistributedTraceLinkageCollector,
  aiTokenCostAttributionCollector,
  aiTraceSensitiveRedactionCollector,
  aiTraceReplayCollector,
  aiTraceQualityAnnotationsCollector,
  aiSloDashboardsCollector,
  aiJourneySloCatalogCollector,
  aiOpsMetricsCollector,
  aiOpsDashboardsCollector,
  aiSloBurnAlertsCollector,
  aiErrorBudgetReleaseGateCollector,
  aiAdversarialCapacityTestsCollector,
  aiStreamingSlisCollector,
  aiRtoRpoCatalogCollector,
  aiTimeoutsRetriesCollector,
  aiDegradedModeCollector,
  aiPartialToolFailureCollector,
  aiContinuityOptionsCollector,
  aiControlPlaneBackupCollector,
  aiChaosDependencyCollector,
  aiMultiProviderContinuityCollector,
  aiCircuitBulkheadCollector,
  aiFallbackEvalCollector,
  aiContinuityDrillCollector,
  aiWarmStandbyCollector,
  promptfooCollector,
  httpAuthProbeCollector,
  mcpS2sInventoryCollector,
  authzEntryTestsCollector,
  crossTenantTestsCollector,
  secretsHygieneCollector,
  secretRedactionCollector,
  injectionPolicyGateCollector,
  agentCharterInventoryCollector,
  agentLoopLimitsCollector,
  agentKillSwitchCollector,
  agentGoalPolicyCollector,
  agentSandboxSimCollector,
  agentRaciOwnershipCollector,
  humanApprovalGatesCollector,
  humanApprovalAuditCollector,
  humanApprovalBypassCollector,
  humanDualControlCollector,
  humanApprovalUiCollector,
  humanApprovalSlaCollector,
  aiSpendLimitsCollector,
  contextBudgetCollector,
  contextSourceAclCollector,
  contextSensitiveInclusionCollector,
  contextBudgetMonitoringCollector,
  contextCompactionEvalsCollector,
  contextStructuredBlocksCollector,
  evalSuiteCiCollector,
  evalReleaseGatesCollector,
  evalOnlineSignalsCollector,
  evalShadowCutoverCollector,
  evalTrackCatalogCollector,
  evalHumanReviewCollector,
  modelPinConfigCollector,
  modelInventoryCollector,
  modelPromotionEvalCollector,
  modelDeprecationSunsetCollector,
  modelCapabilityAllowlistCollector,
  modelLicenseProvenanceCollector,
  promptVersionRegistryCollector,
  promptChangeReviewEvalCollector,
  promptRollbackCollector,
  promptTemplateHygieneCollector,
  promptLintCiCollector,
  promptAbShadowEvalCollector,
  promptModelVersionRetentionCollector,
  rollbackRunbookCollector,
  rollbackDrillCollector,
  qualitySloAutoRollbackCollector,
  oneClickAiRollbackCollector,
  agentBehaviorFeatureFlagsCollector,
  aiArtifactPromotionPathCollector,
  aiArtifactChangeRecordsCollector,
  aiConfigAsCodeCollector,
  aiCanaryProgressiveDeliveryCollector,
  envParityModelToolCatalogCollector,
  embeddingIndexMigrationCollector,
  incidentPlaybooksCollector,
  aiContainmentDrillCollector,
  postIncidentAprfActionsCollector,
  aiIncidentTabletopCollector,
  aiSafetyQualityAlertsCollector,
  aiCustomerNotificationCriteriaCollector,
  aiCostAlertsCollector,
  aiRetryAmplificationCollector,
  aiPromptCacheCollector,
  aiModelRoutingCollector,
  aiFinopsUnitEconomicsCollector,
  platformGoldenPathCollector,
  platformAiPipelineGatesCollector,
  platformOwnershipSupportCollector,
  platformScaffoldingTemplatesCollector,
  platformInnerLoopEvalsCollector,
  platformDxMetricsCollector,
  ragCorpusGovernanceCollector,
  datasetProvenanceGovernanceCollector,
  feedbackPromotionGovernanceCollector,
  corpusFreshnessMetricsCollector,
  trainServeSkewMonitorCollector,
  datasetCardsRegistryCollector,
  modelPayloadClassificationCollector,
  modelPayloadRedactionCollector,
  vendorModelTermsCollector,
  aiDeletionExportCollector,
  aiResidencyRoutingCollector,
  aiDpiaCollector,
  memoryIsolationCollector,
  memoryRetentionCollector,
  memoryWritePolicyCollector,
  memoryIntegrityCollector,
  memoryPoisoningEvalsCollector,
  memoryPromotionArchitectureCollector,
  aiObligationsRegisterCollector,
  aiControlEvidenceMatrixCollector,
  aiControlPlaneAuditLogsCollector,
  aiControlTestingCollector,
  aiTrustDocumentationCollector,
  aiIndependentAssessmentCollector,
  aiAcceptableUsePolicyCollector,
  aiDomainOwnershipCollector,
  aiRiskAcceptanceCollector,
  aiLeadershipReviewCollector,
  aiImprovementBacklogCollector,
  aiOrgAprfSamplingCollector,
  a2aPeerAuthCollector,
  awsCollector,
  azureCollector,
  gcpCollector,
  // Export-only runtime plugins (drop files under imports/<id>/)
  importIngestCollector("langsmith"),
  importIngestCollector("phoenix"),
  importIngestCollector("helicone"),
  importIngestCollector("wandb"),
  importIngestCollector("prometheus"),
  importIngestCollector("grafana"),
  importIngestCollector("cloudwatch"),
  // Out-of-plugin customer evidence
  customImportCollector,
];

export function getCollector(id: string): Collector | undefined {
  return COLLECTORS.find((c) => c.id === id);
}
