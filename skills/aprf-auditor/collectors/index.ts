import type { Collector } from "./types.ts";
import { repoFilesystemCollector } from "./repo-filesystem.ts";
import { githubActionsCollector } from "./github-actions.ts";
import { otelCollector } from "./otel.ts";
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
