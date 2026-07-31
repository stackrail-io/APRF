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
