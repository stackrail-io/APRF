#!/usr/bin/env npx tsx
/**
 * APRF Auditor evidence collectors — local CLI (no StackRail backend).
 *
 * Usage:
 *   npx tsx skills/aprf-auditor/collectors/runner.ts --target . --out ./aprf-assessment
 *   APRF_AUDITOR_LIVE=1 GITHUB_TOKEN=... npx tsx ... --live
 *
 * Modes:
 *   - Default: local filesystem / IaC / CI YAML + imports/<plugin>/ exports
 *   - --live: optional authenticated APIs (e.g. GitHub Actions runs)
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { COLLECTORS } from "./index.ts";
import type { CollectorContext, EvidenceGraph, EvidenceNode } from "./types.ts";
import {
  clearWalkSkipAbsoluteDirs,
  configureWalkSkipForCollect,
  ensureDir,
  projectName,
  tryGitCommit,
  writeJson,
} from "./lib/fs.ts";

function parseArgs(argv: string[]) {
  const out: {
    target: string;
    outDir: string;
    live: boolean;
    plugins?: string[];
    maxFiles: number;
    baseUrl?: string;
    adminToken?: string;
    adminEmail?: string;
    adminPassword?: string;
    limitedEmail?: string;
    limitedPassword?: string;
    limitedToken?: string;
  } = {
    target: process.cwd(),
    outDir: resolve(process.cwd(), "aprf-assessment"),
    live: process.env.APRF_AUDITOR_LIVE === "1",
    maxFiles: 4000,
    baseUrl: process.env.APRF_AUTH_PROBE_BASE_URL,
    adminToken: process.env.APRF_ADMIN_TOKEN,
    adminEmail: process.env.APRF_ADMIN_EMAIL || process.env.APRF_ADMIN_USER,
    adminPassword: process.env.APRF_ADMIN_PASSWORD,
    limitedEmail:
      process.env.APRF_AUTHZ_LIMITED_EMAIL || process.env.APRF_LIMITED_EMAIL,
    limitedPassword:
      process.env.APRF_AUTHZ_LIMITED_PASSWORD ||
      process.env.APRF_LIMITED_PASSWORD,
    limitedToken: process.env.APRF_AUTHZ_LIMITED_TOKEN,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = resolve(argv[++i] ?? ".");
    else if (a === "--out") out.outDir = resolve(argv[++i] ?? out.outDir);
    else if (a === "--live") out.live = true;
    else if (a === "--base-url") out.baseUrl = argv[++i];
    else if (a === "--admin-token") out.adminToken = argv[++i];
    else if (a === "--admin-email" || a === "--admin-user")
      out.adminEmail = argv[++i];
    else if (a === "--admin-password") out.adminPassword = argv[++i];
    else if (a === "--limited-email") out.limitedEmail = argv[++i];
    else if (a === "--limited-password") out.limitedPassword = argv[++i];
    else if (a === "--limited-token") out.limitedToken = argv[++i];
    else if (a === "--plugins") {
      out.plugins = (argv[++i] ?? "").split(",").filter(Boolean);
    } else if (a === "--max-files") {
      out.maxFiles = Number(argv[++i] ?? 4000);
    } else if (a === "--help" || a === "-h") {
      console.log(`APRF Auditor collectors

Options:
  --target <path>     Project root to scan (default: cwd)
  --out <path>        Output dir (default: ./aprf-assessment)
  --plugins a,b,c     Subset of collector ids (default: all)
  --live              Allow credentialed API calls (also APRF_AUDITOR_LIVE=1)
  --base-url <url>    Running app URL (AUTHN-M1 probe / AUTHN-M2 live fetch /
                      AUTHZ-M1 limited-user denial probe)
                      (also APRF_AUTH_PROBE_BASE_URL)
  --admin-token <tok> Admin bearer token for MCP/S2S inventory live fetch
                      (also APRF_ADMIN_TOKEN) — never commit this value
  --admin-email <e>   Admin email for password sign-in (also APRF_ADMIN_EMAIL /
                      APRF_ADMIN_USER). Open WebUI uses email, not username.
  --admin-password <p> Admin password (also APRF_ADMIN_PASSWORD) — never commit
  --limited-email <e> Non-admin user for AUTHZ-M1 denial probe
                      (also APRF_AUTHZ_LIMITED_EMAIL)
  --limited-password <p> Limited-user password (APRF_AUTHZ_LIMITED_PASSWORD)
  --limited-token <t> Limited-user bearer token (APRF_AUTHZ_LIMITED_TOKEN)
  --max-files <n>     Cap filesystem walk (default: 4000)

AUTHN-M1 live probe:
  npm run aprf:auth-probe -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080

AUTHN-M2 MCP/S2S inventory:
  npm run aprf:mcp-s2s -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080 --admin-token "$APRF_ADMIN_TOKEN"
  # or sign in with email/password (obtains JWT, does not store password):
  npm run aprf:mcp-s2s -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080 \\
    --admin-email "$APRF_ADMIN_EMAIL" --admin-password "$APRF_ADMIN_PASSWORD"
  # or drop redacted JSON under imports/mcp-s2s-inventory/

AUTHZ-M1 authz entry denial:
  npm run aprf:authz-tests -- --target <app> --out <app>/aprf-assessment \\
    --base-url http://127.0.0.1:8080 \\
    --admin-email "$APRF_ADMIN_EMAIL" --admin-password "$APRF_ADMIN_PASSWORD"
  # or use an existing non-admin principal:
  #   --limited-email "$APRF_AUTHZ_LIMITED_EMAIL" --limited-password "$APRF_AUTHZ_LIMITED_PASSWORD"
  # Offline: denial tests in-repo, or imports/authz-entry-tests/*.json coverage

AGN-M1 agent charters:
  npm run aprf:agent-charters -- --target <app> --out <app>/aprf-assessment
  # PASS needs complete inventory under imports/agent-charter-inventory/

AGN-M2 agent loop limits:
  npm run aprf:agent-limits -- --target <app> --out <app>/aprf-assessment
  # PASS needs measured abort suite under imports/agent-loop-limits/

AGN-M3 agent kill switch:
  npm run aprf:agent-kill -- --target <app> --out <app>/aprf-assessment
  # PASS needs cancel suite + drill under imports/agent-kill-switch/

AGN-M4 A2A peer auth:
  npm run aprf:a2a-auth -- --target <app> --out <app>/aprf-assessment
  # PASS needs deny suite under imports/a2a-peer-auth/

AGN-R1 goal-conflict plan policy:
  npm run aprf:agent-goal-policy -- --target <app> --out <app>/aprf-assessment
  # PASS needs synthetic deny under imports/agent-goal-policy/

AGN-R2 agent sandbox / simulation:
  npm run aprf:agent-sandbox -- --target <app> --out <app>/aprf-assessment
  # PASS needs linked ≤30d sim report under imports/agent-sandbox-sim/

AGN-R3 agent RACI ownership:
  npm run aprf:agent-raci -- --target <app> --out <app>/aprf-assessment
  # PASS needs register export under imports/agent-raci-ownership/

Human approval (HUM-M1–M4, R1, R3):
  npm run aprf:human-approval -- --target <app> --out <app>/aprf-assessment
  # PASS unlocks via imports/human-approval-*/ suite JSON per Check

COST-M1 AI spend / rate limits:
  npm run aprf:spend-limits -- --target <app> --out <app>/aprf-assessment
  # PASS needs enforce-on-exceed under imports/ai-spend-limits/

CTX-M1 context assembly max size / priority budgets:
  npm run aprf:context-budget -- --target <app> --out <app>/aprf-assessment
  # PASS needs buildersMissingBudget=0 + silentOverflowCount=0 under imports/context-budget/

CTX-M2 source labels + ACL on retrieved/tool context:
  npm run aprf:context-source-acl -- --target <app> --out <app>/aprf-assessment
  # PASS needs unauthorizedChunksIncluded=0 + unlabeledIncludedCount=0 under imports/context-source-acl/

CTX-M3 sensitive context-class inclusion policy:
  npm run aprf:context-sensitive-inclusion -- --target <app> --out <app>/aprf-assessment
  # PASS needs enumerated classes + allow/deny + blockOrStripRatePct≥95 under imports/context-sensitive-inclusion/

CTX-R1 context budget monitoring + saturation alerts:
  npm run aprf:context-budget-monitoring -- --target <app> --out <app>/aprf-assessment
  # PASS needs emitCoveragePct≥99 + saturationAlertConfigured + alertNotifyProven under imports/context-budget-monitoring/

CTX-R2 compaction critical-fact retention evals:
  npm run aprf:context-compaction-evals -- --target <app> --out <app>/aprf-assessment
  # PASS needs retentionMeetsThreshold + regressionsBlockRelease + lastRunAgeDays≤90 under imports/context-compaction-evals/

CTX-R3 structured instruction vs data context blocks:
  npm run aprf:context-structured-blocks -- --target <app> --out <app>/aprf-assessment
  # PASS needs structuredSectionsEmitted + instructionOverwriteBlocked under imports/context-structured-blocks/

EVL-M1 critical-journey offline eval suites on change:
  npm run aprf:eval-suite-ci -- --target <app> --out <app>/aprf-assessment
  # PASS needs criticalJourneysMissingSuite=0 + relevantChangesMissingTriggerOrWaiver=0 under imports/eval-suite-ci/

EVL-M2 numeric quality/safety release gates:
  npm run aprf:eval-release-gates -- --target <app> --out <app>/aprf-assessment
  # PASS needs journeysMissingQualityMetric=0 + journeysMissingSafetyMetric=0 + failingGateBlocksDeploy under imports/eval-release-gates/

EVL-M3 online task-success and safety-refusal signals:
  npm run aprf:eval-online-signals -- --target <app> --out <app>/aprf-assessment
  # PASS needs both metric classes + cadence + dashboardFreshnessHours≤24 under imports/eval-online-signals/

EVL-M4 shadow/canary eval comparison before full cutover:
  npm run aprf:eval-shadow-cutover -- --target <app> --out <app>/aprf-assessment
  # PASS needs highRiskCutoversMissingShadowComparison=0 + promotionCriteriaMetBeforeFullTraffic under imports/eval-shadow-cutover/
  # highRiskCutoverCount=0 → NOT_APPLICABLE

EVL-R1 separate regression/adversarial/distribution-shift eval tracks:
  npm run aprf:eval-track-catalog -- --target <app> --out <app>/aprf-assessment
  # PASS needs missingTracks=0 + missingOwners=0 + tracksNotRunOnLastPromotion=0 under imports/eval-track-catalog/

EVL-R2 human preference / expert-review sampling cadence:
  npm run aprf:eval-human-review -- --target <app> --out <app>/aprf-assessment
  # PASS needs cadenceAndSampleSizeDefined + lastSampleAgeDays≤90 + productionLikeCoverage + disagreementsMissingAdjudication=0 under imports/eval-human-review/

MOD-M1 pinned model IDs (no floating aliases):
  npm run aprf:model-pin-config -- --target <app> --out <app>/aprf-assessment
  # PASS needs floatingAliasCountOnCriticalPaths=0 + criticalPathsMissingPinnedModelId=0 + lintOrCiRejectsLatest under imports/model-pin-config/

MOD-R4 model inventory (owner / residency / intended use):
  npm run aprf:model-inventory -- --target <app> --out <app>/aprf-assessment
  # PASS needs incompleteInventoryRows=0 under imports/model-inventory/

MOD-M2 model promotion requires eval evidence:
  npm run aprf:model-promotion-eval -- --target <app> --out <app>/aprf-assessment
  # PASS needs promotionsMissingEvalArtifact=0 + promoteWithoutEvalBlocked under imports/model-promotion-eval/

MOD-R1 model/embedding deprecation and sunset:
  npm run aprf:model-deprecation-sunset -- --target <app> --out <app>/aprf-assessment
  # PASS needs policyDefinesNoticeAndForcedSunset + supersededWithSunsetDateCount≥1 + undocumentedPinsPastSunset=0 under imports/model-deprecation-sunset/

MOD-R2 per-workload model capability allowlists:
  npm run aprf:model-capability-allowlist -- --target <app> --out <app>/aprf-assessment
  # PASS needs workloadsMissingCapabilityAllowlist=0 + deniedCapabilityAttemptRecorded under imports/model-capability-allowlist/

MOD-R3 license/provenance review for open-weight and fine-tuned models:
  npm run aprf:model-license-provenance -- --target <app> --out <app>/aprf-assessment
  # PASS needs openWeightOrFineTunedMissingReview=0 + reviewsOlderThan12Months=0 + blockedLicensesMissingException=0 under imports/model-license-provenance/

PRM-M1 prompt immutable version IDs + owners:
  npm run aprf:prompt-version-registry -- --target <app> --out <app>/aprf-assessment
  # PASS needs unversionedProductionPrompts=0 + productionPromptsMissingOwner=0 under imports/prompt-version-registry/

PRM-M2 prompt release review + eval gate:
  npm run aprf:prompt-change-review-eval -- --target <app> --out <app>/aprf-assessment
  # PASS needs releasesMissingReviewOrEval=0 + promoteWithoutReviewAndEvalBlocked under imports/prompt-change-review-eval/

PRM-M3 prompt rollback without full app redeploy:
  npm run aprf:prompt-rollback -- --target <app> --out <app>/aprf-assessment
  # PASS needs priorPromptRestoredWithinRto + rollbackWithoutFullAppRedeploy under imports/prompt-rollback/

PRM-R1 parameterized templates; no secrets/PII:
  npm run aprf:prompt-template-hygiene -- --target <app> --out <app>/aprf-assessment
  # PASS needs templatesMissingParameters=0 + hardcodedSecretsInTemplates=0 + hardcodedPiiInTemplates=0 under imports/prompt-template-hygiene/

PRM-R2 blocking prompt lint on change PRs:
  npm run aprf:prompt-lint-ci -- --target <app> --out <app>/aprf-assessment
  # PASS needs promptChangePrsMissingLint=0 + blockingPromptLintRulesPresent + lastFailingLintExampleRetained under imports/prompt-lint-ci/

PRM-R3 A/B or shadow eval for high-traffic prompt changes:
  npm run aprf:prompt-ab-shadow-eval -- --target <app> --out <app>/aprf-assessment
  # PASS needs lastHighTrafficPromptChangeUsedAbOrShadow + preRegisteredMetricsPresent + promotionRequiredNonInferiority under imports/prompt-ab-shadow-eval/

CHG-M1 prior prompt/model-pin versions retained + restore dry-run:
  npm run aprf:prompt-model-version-retention -- --target <app> --out <app>/aprf-assessment
  # PASS needs retainedPriorProductionVersions≥2 + immediatePriorRestoreDryRunPassed under imports/prompt-model-version-retention/

CHG-M2 rollback runbook operable by on-call:
  npm run aprf:rollback-runbook -- --target <app> --out <app>/aprf-assessment
  # PASS needs runbookHasCommandsAndOwners + onCallWalkthroughOrDrillCompleted under imports/rollback-runbook/

CHG-M3 successful rollback drill within RTO:
  npm run aprf:rollback-drill -- --target <app> --out <app>/aprf-assessment
  # PASS needs successfulRollbacksLast90Days≥1 + measuredTimeToRestoreWithinRto under imports/rollback-drill/

CHG-R3 quality SLO burn → auto-rollback or page:
  npm run aprf:quality-slo-auto-rollback -- --target <app> --out <app>/aprf-assessment
  # PASS needs qualitySloBurnWiredToRollbackOrPage + testOrDrillOccurredLast90Days (+ auto rollback or measured MTTA) under imports/quality-slo-auto-rollback/

CHG-R1 one-click / single-command AI release rollback:
  npm run aprf:one-click-ai-rollback -- --target <app> --out <app>/aprf-assessment
  # PASS needs singleCommandOrActionRollbackDocumented + exerciseOrRealRollbackWithinRtoLast90Days under imports/one-click-ai-rollback/

CHG-R2 feature flags for new agent behaviors:
  npm run aprf:agent-behavior-feature-flags -- --target <app> --out <app>/aprf-assessment
  # PASS needs newAgentBehaviorsBehindFlags + flagStateChangesAudited + killDisablePathTestedLast90Days under imports/agent-behavior-feature-flags/

DEP-M1 non-prod→prod promotion path for prompts/models/tools:
  npm run aprf:ai-artifact-promotion-path -- --target <app> --out <app>/aprf-assessment
  # PASS needs promotionPathDocumented + releasesThroughPromotionPathPct=100 + productionHotEditsWithoutChangeRecord=0 under imports/ai-artifact-promotion-path/

DEP-M2 who/what/when + review-linked AI artifact change records:
  npm run aprf:ai-artifact-change-records -- --target <app> --out <app>/aprf-assessment
  # PASS needs changesWithWhoWhatWhenAndReviewLinkPct=100 (or changesMissingWhoWhatWhenOrReviewLink=0) under imports/ai-artifact-change-records/

DEP-M3 declarative AI config + drift / live-pin match:
  npm run aprf:ai-config-as-code -- --target <app> --out <app>/aprf-assessment
  # PASS needs unmanagedProductionAiConfigResources=0 + livePinsMatchDeclaredPct=100 under imports/ai-config-as-code/

DEP-R1 canary / progressive delivery for high-traffic AI changes:
  npm run aprf:ai-canary-progressive-delivery -- --target <app> --out <app>/aprf-assessment
  # PASS needs canaryOrProgressiveConfigured + automatedRollbackCriteriaPresent + lastHighTrafficReleaseHasCanaryMetricsLink under imports/ai-canary-progressive-delivery/

DEP-R2 prod vs staging parity for model pins and tool catalogs:
  npm run aprf:env-parity-model-tool-catalog -- --target <app> --out <app>/aprf-assessment
  # PASS needs lastParityScanWithin30Days + unexplainedParityDrifts=0 under imports/env-parity-model-tool-catalog/

DEP-R3 automated embedding/index version migration:
  npm run aprf:embedding-index-migration -- --target <app> --out <app>/aprf-assessment
  # PASS needs automatedMigrationWithValidationGates + lastUpgradeWithin12Months + lastUpgradeSucceededWithoutDualWriteGaps under imports/embedding-index-migration/

INC-M1 AI-specific incident playbooks (abuse/leakage/bad actions/provider outage):
  npm run aprf:incident-playbooks -- --target <app> --out <app>/aprf-assessment
  # PASS needs fourPlaybooksPresent + allPlaybooksHaveOwner + allPlaybooksReviewedWithin12Months under imports/incident-playbooks/

INC-M2 AI containment drill (pause / disable tools / rollback):
  npm run aprf:ai-containment-drill -- --target <app> --out <app>/aprf-assessment
  # PASS needs pauseAgentsDemonstrated + disableToolsDemonstrated + rollbackPromptOrModelDemonstrated + withinDocumentedTimeBudgets under imports/ai-containment-drill/

INC-R2 post-incident reviews with APRF-pillar tracked actions:
  npm run aprf:post-incident-aprf-actions -- --target <app> --out <app>/aprf-assessment
  # PASS needs sevEligibleIncidentCount>0 + reviewsWithTrackedActionOrRationalePct=100 (or reviewsMissingTrackedActionOrRationale=0) under imports/post-incident-aprf-actions/

INC-R4 AI-focused incident tabletop ≤180 days:
  npm run aprf:ai-incident-tabletop -- --target <app> --out <app>/aprf-assessment
  # PASS needs aiFocusedTabletopCompletedWithin180Days + retainedActionsWithOwners under imports/ai-incident-tabletop/

INC-R1 AI safety/quality on-call paging (≥2 non-infra signals):
  npm run aprf:ai-safety-quality-alerts -- --target <app> --out <app>/aprf-assessment
  # PASS needs atLeastTwoNonInfraPagingSignals + eachSignalHasThresholdAndOwner + policyReviewedWithin90Days under imports/ai-safety-quality-alerts/

INC-R3 AI customer notification criteria (notify/no-notify + followed sample ≤12m):
  npm run aprf:ai-customer-notification-criteria -- --target <app> --out <app>/aprf-assessment
  # PASS needs criteriaMapEventTypesToNotifyDecision + lastDrillOrIncidentFollowedCriteriaWithin12Months + timestampsPresent under imports/ai-customer-notification-criteria/

OBS-M1 request→model→tool→outcome distributed trace linkage (≥95% / 24h):
  npm run aprf:ai-distributed-trace-linkage -- --target <app> --out <app>/aprf-assessment
  # PASS needs linkedTracePct≥95 + sampleWindowHours≥24 + coversModelToolOutcome under imports/ai-distributed-trace-linkage/

OBS-R4 token/cost attribution per request/feature/tenant (≥95% / 24h):
  npm run aprf:ai-token-cost-attribution -- --target <app> --out <app>/aprf-assessment
  # PASS needs attributedBilledCallPct≥95 + sampleWindowHours≥24 + coversRequestFeatureTenant under imports/ai-token-cost-attribution/

OBS-M2 sensitive fields in traces (conditional mandatory):
  npm run aprf:ai-trace-sensitive-redaction -- --target <app> --out <app>/aprf-assessment
  # PASS needs tracesContainSecretsOrSensitiveData=true + syntheticSensitiveFieldRedactionOrAclPct=100
  # N/A when tracesContainSecretsOrSensitiveData=false under imports/ai-trace-sensitive-redaction/

OBS-R1 secure failed-AI-trace replay (restricted env + RTO + ≤90d drill):
  npm run aprf:ai-trace-replay -- --target <app> --out <app>/aprf-assessment
  # PASS needs restrictedReplayEnvironmentConfigured + replayWithinDocumentedRto + lastDrillOrRealReplayWithin90Days under imports/ai-trace-replay/

OBS-R2 trace quality annotations (≥50/90d feeding eval or review):
  npm run aprf:ai-trace-quality-annotations -- --target <app> --out <app>/aprf-assessment
  # PASS needs qualityAnnotationToolingConfigured + annotationsLast90Days≥50 + annotationsFeedEvalOrReviewLoop under imports/ai-trace-quality-annotations/

OBS-R3 AI SLO dashboards (latency/error/quality burn + alerts):
  npm run aprf:ai-slo-dashboards -- --target <app> --out <app>/aprf-assessment
  # PASS needs namedSloTargetsForCriticalAiJourneys + coversLatencyErrorAndQualityBurn + burnRateAlertConfigured under imports/ai-slo-dashboards/

PERF-M1 critical AI journey SLO catalog (availability + latency, 100% coverage):
  npm run aprf:ai-journey-slo-catalog -- --target <app> --out <app>/aprf-assessment
  # PASS needs sloCatalogConfigured + criticalAiJourneyCount≥1 + journeysWithAvailabilityAndLatencyTargetsPct=100 under imports/ai-journey-slo-catalog/

PERF-M2 AI ops metrics (latency + error + AI quality, available for monitoring):
  npm run aprf:ai-ops-metrics -- --target <app> --out <app>/aprf-assessment
  # PASS needs latencyMetricsCollected + errorRateMetricsCollected + aiQualityOrTaskSuccessMetricCollected + metricsAvailableForOperationalMonitoring under imports/ai-ops-metrics/

PERF-R4 near-real-time AI ops dashboards (latency/error/throughput/resource/quality):
  npm run aprf:ai-ops-dashboards -- --target <app> --out <app>/aprf-assessment
  # PASS needs dashboardCoversLatencyErrorThroughput + dashboardCoversResourceUtilization + dashboardCoversAiQuality + nearRealtimeRefreshConfigured under imports/ai-ops-dashboards/

PERF-M3 critical-journey SLO burn alerts (coverage + notify proof):
  npm run aprf:ai-slo-burn-alerts -- --target <app> --out <app>/aprf-assessment
  # PASS needs alertPoliciesCoverCriticalJourneySlos + notificationPathProvenByTestOrDocumentedFire under imports/ai-slo-burn-alerts/

PERF-R1 error-budget release gates (freeze/risk acceptance + gated event ≤90d):
  npm run aprf:ai-error-budget-release-gate -- --target <app> --out <app>/aprf-assessment
  # PASS needs errorBudgetPolicyLinksAiSlosToReleaseFreezeOrRiskAcceptance + gatedEventOrDrillWithin90Days under imports/ai-error-budget-release-gate/

PERF-R2 adversarial capacity tests (long-prompt + agent-loop + SLO under concurrency ≤90d):
  npm run aprf:ai-adversarial-capacity-tests -- --target <app> --out <app>/aprf-assessment
  # PASS needs capacityTestIncludesAdversarialLongPrompts + capacityTestIncludesMultiStepAgentLoops + p95LatencyAndErrorRateWithinSloUnderDocumentedConcurrency + lastCapacityTestWithin90Days under imports/ai-adversarial-capacity-tests/

PERF-R3 streaming SLIs (TTFT + inter-token + alerts + ≥30d retention):
  npm run aprf:ai-streaming-slis -- --target <app> --out <app>/aprf-assessment
  # PASS needs ttftSliConfiguredForStreamingSurfaces + interTokenLatencySliConfiguredForStreamingSurfaces + streamingSliAlertsConfigured + streamingSeriesRetainedAtLeast30Days under imports/ai-streaming-slis/

REL-M1 model/tool timeouts + bounded retries (100% call-site coverage + static/integration verify):
  npm run aprf:ai-timeouts-retries -- --target <app> --out <app>/aprf-assessment
  # PASS needs timeoutsConfigured + retriesBounded + callSitesCoveredPct=100 + verifiedByStaticOrIntegrationTest under imports/ai-timeouts-retries/

REL-M2 critical journey degraded mode when AI unavailable (docs + failover test):
  npm run aprf:ai-degraded-mode -- --target <app> --out <app>/aprf-assessment
  # PASS needs degradedModeDocumented + criticalJourneyCount≥1 + criticalJourneysWithDegradedModePct=100 + failoverTestShowsSafeFallback under imports/ai-degraded-mode/

REL-M3 partial tool failure / no false-success (handling + outcome test evidence):
  npm run aprf:ai-partial-tool-failure -- --target <app> --out <app>/aprf-assessment
  # PASS needs partialFailureHandlingConfigured + testEvidenceShowsNoFalseSuccess + noFalseSuccessWithoutRemediationPct=100 under imports/ai-partial-tool-failure/

REL-R3 critical AI process continuity options (docs + named owners):
  npm run aprf:ai-continuity-options -- --target <app> --out <app>/aprf-assessment
  # PASS needs continuityOptionsDocumented + criticalAiProcessCount≥1 + criticalAiProcessesWithOwnedContinuityOptionPct=100 under imports/ai-continuity-options/

REL-M4 AI control-plane backup inventory + restore test:
  npm run aprf:ai-control-plane-backup -- --target <app> --out <app>/aprf-assessment
  # PASS needs controlPlaneBackupInventoryConfigured + requiredArtifactClassesCovered + restoreTestSucceededWithin90Days under imports/ai-control-plane-backup/

REL-R5 AI-dependency chaos experiments (plan + ≤180d exercise + retained actions):
  npm run aprf:ai-chaos-dependency -- --target <app> --out <app>/aprf-assessment
  # PASS needs chaosPlanCoversAiDependencies + aiDependencyChaosExerciseCompletedWithin180Days + afterActionRetainedWithActions under imports/ai-chaos-dependency/

REL-R1 circuit breakers + bulkheads on AI/provider clients (config + trip evidence):
  npm run aprf:ai-circuit-bulkhead -- --target <app> --out <app>/aprf-assessment
  # PASS needs circuitBreakerConfigured + bulkheadLimitsConcurrentCalls + breakerTripEvidenceWithin90Days under imports/ai-circuit-bulkhead/

REL-R2 multi-provider/multi-region fallback with quality/safety eval:
  npm run aprf:ai-fallback-eval -- --target <app> --out <app>/aprf-assessment
  # PASS needs fallbackPathConfigured + fallbackExercisedWithin90Days + fallbackEvalMeetsQualitySafetyBars under imports/ai-fallback-eval/

REL-R4 provider-loss continuity drills (calendar + RTO/RPO results):
  npm run aprf:ai-continuity-drill -- --target <app> --out <app>/aprf-assessment
  # PASS needs continuityDrillCalendarConfigured + providerLossDrillCompletedWithin90Days + rtoRpoMetOrOwnedExceptions under imports/ai-continuity-drill/

REL-R6 warm standby for self-hosted inference (architecture + RTO failover + capacity):
  npm run aprf:ai-warm-standby -- --target <app> --out <app>/aprf-assessment
  # PASS needs warmStandbyArchitectureDocumented + failoverWithinRtoWithin90Days + standbyCapacityCoversDeclaredPeak under imports/ai-warm-standby/

REL-R7 Level-5 multi-provider contractual + technical continuity:
  npm run aprf:ai-multi-provider-continuity -- --target <app> --out <app>/aprf-assessment
  # PASS needs alternateProviderPathDocumented + failoverTestSucceededWithin180Days under imports/ai-multi-provider-continuity/

REL-M5 business-critical AI service RTO/RPO (BCP/service-catalog/DR + tested restore/failover):
  npm run aprf:ai-rto-rpo-catalog -- --target <app> --out <app>/aprf-assessment
  # PASS needs continuityDocumentationConfigured + businessCriticalAiServiceCount≥1 + businessCriticalAiServicesWithNumericRtoRpoPct=100 + linkedToTestedRestoreOrFailoverProcedure under imports/ai-rto-rpo-catalog/

COST-M2 AI cost budget-burn / anomaly alerts:
  npm run aprf:cost-alerts -- --target <app> --out <app>/aprf-assessment
  # PASS needs notify proof under imports/ai-cost-alerts/

COST-M3 AI retry / loop cost amplification:
  npm run aprf:retry-amplification -- --target <app> --out <app>/aprf-assessment
  # PASS needs amplificationBounded under imports/ai-retry-amplification/

COST-R1 AI prompt/response cache:
  npm run aprf:prompt-cache -- --target <app> --out <app>/aprf-assessment
  # PASS needs ≥30-day hit-rate/savings under imports/ai-prompt-cache/

COST-R2 AI cheap-vs-premium model routing:
  npm run aprf:model-routing -- --target <app> --out <app>/aprf-assessment
  # PASS needs eval + misroute under imports/ai-model-routing/

COST-R3 AI FinOps unit economics:
  npm run aprf:finops-unit-economics -- --target <app> --out <app>/aprf-assessment
  # PASS needs quarterly metrics + review under imports/ai-finops-unit-economics/

DX-M1 AI golden-path documentation:
  npm run aprf:golden-path -- --target <app> --out <app>/aprf-assessment
  # PASS needs review attestation under imports/platform-golden-path/

DX-M2 AI pipeline auth/secret-scan/eval gates:
  npm run aprf:ai-pipeline-gates -- --target <app> --out <app>/aprf-assessment
  # PASS needs blockingOnFail under imports/platform-ai-pipeline-gates/

DX-R4 AI platform ownership + support:
  npm run aprf:platform-ownership -- --target <app> --out <app>/aprf-assessment
  # PASS needs owner+channel+(pingWithinSla|onCallListed) under imports/platform-ownership-support/

DX-R1 agent/RAG/MCP scaffolding templates:
  npm run aprf:scaffolding-templates -- --target <app> --out <app>/aprf-assessment
  # PASS needs three templates + defaults + adoption under imports/platform-scaffolding-templates/

DX-R2 inner-loop eval runners (pre-PR):
  npm run aprf:inner-loop-evals -- --target <app> --out <app>/aprf-assessment
  # PASS needs runner + one-command + pre-PR sample/waiver under imports/platform-inner-loop-evals/

DX-R3 DX metrics (TTSP + bypass rate):
  npm run aprf:dx-metrics -- --target <app> --out <app>/aprf-assessment
  # PASS needs formulas + ≥30d series + bypass alert/owner under imports/platform-dx-metrics/

SEC-M1 injection/privilege-escalation policy gate (≥95% deny, 0 model-text grants):
  npm run aprf:injection-gate -- --target <app> --out <app>/aprf-assessment
  # PASS needs server-side policy + corpus/CI + denyRatePct≥95 + modelTextPrivilegeGrants=0 + measuredAt ≤90d under imports/injection-policy-gate/

SEC-M2 high-risk output schema/policy gate (100% paths reject non-conforming):
  npm run aprf:high-risk-output-gate -- --target <app> --out <app>/aprf-assessment
  # PASS needs highRiskSideEffectPathInventoryComplete + highRiskPathsRejectingNonConformingOutputPct=100 + measuredAt ≤90d under imports/high-risk-output-gate/

SEC-M3 abuse/jailbreak/injection release gate (100% last 30d + ≤30d waivers):
  npm run aprf:abuse-injection-release-gate -- --target <app> --out <app>/aprf-assessment
  # PASS needs abuseJailbreakInjectionSuiteConfigured + productionReleasesWithSecuritySuiteGatePassPct=100 + failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d + measuredAt ≤90d under imports/abuse-injection-release-gate/

SEC-M4 model-path egress / trust boundary (allowlisted-only + 0 unrestricted internal routes):
  npm run aprf:model-path-egress-boundary -- --target <app> --out <app>/aprf-assessment
  # PASS needs trustBoundaryArchitectureDocumented + modelToolRuntimeEgressAllowlistConfigured + unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity=0 + probeShowsOnlyAllowlistedDestinations + measuredAt ≤90d under imports/model-path-egress-boundary/

SEC-R1 multi-turn + indirect RAG/MCP injection red-team (≥10/≥10 + scored run ≤90d):
  npm run aprf:multi-turn-indirect-injection-redteam -- --target <app> --out <app>/aprf-assessment
  # PASS needs multiTurnInjectionCaseCount≥10 + indirectRagOrMcpInjectionCaseCount≥10 + latestRunWithin90DaysMeetsPassThresholds + reportRetainedAtLeast90Days + measuredAt ≤90d under imports/multi-turn-indirect-injection-redteam/

SEC-R2 multimodal input safety/malware scan before model ingest:
  npm run aprf:multimodal-input-scan -- --target <app> --out <app>/aprf-assessment
  # PASS needs multimodalInputsAccepted=true + scannerRunsBeforeModelIngest + imageFileTypesInUseCoveredInLastReport + unscannedProductionMultimodalPaths=0 + measuredAt ≤90d under imports/multimodal-input-scan/

SEC-R3 sensitive AI exfil detection (canary optional; DLP/SIEM/UEBA OK):
  npm run aprf:ai-exfil-detection -- --target <app> --out <app>/aprf-assessment
  # PASS needs sensitiveAiContextsExfilDetectionConfigured + detectionMechanismCoversSensitiveAiPaths + latestDetectionValidationWithin90DaysWithExpectedAlertsOrZeroSilentMisses + measuredAt ≤90d under imports/ai-exfil-detection/

SAF-M1 domain-specific AI safety policy (versioned, owned, reviewed ≤12 months):
  npm run aprf:ai-harm-policy -- --target <app> --out <app>/aprf-assessment
  # PASS needs hasVersion + hasOwner + domainMinimumHarmCategoriesWithRefuseEscalateMapped + reviewAgeDays≤365 under imports/ai-harm-policy/

SAF-M2 automated safety evaluation gates on in-scope releases (100% last 30d + blocking/waivers):
  npm run aprf:ai-safety-eval-gates -- --target <app> --out <app>/aprf-assessment
  # PASS needs safetySuiteWithNumericThresholdsConfigured + inScopeReleasesWithSafetyGatePct=100 + failingGateBlocksPromoteUnlessOwnedWaiverExpiry14d under imports/ai-safety-eval-gates/

SAF-M3 AI-interaction disclosure on in-scope user surfaces (inventory + audit coverage):
  npm run aprf:ai-interaction-disclosure -- --target <app> --out <app>/aprf-assessment
  # PASS needs disclosureUxInventoryConfigured + inScopeSurfacesWithAiDisclosurePct=100 + criticalSurfacesMissingDisclosure=0 under imports/ai-interaction-disclosure/

SAF-M4 fairness/disparity eval for high-stakes paths (conditionally mandatory):
  npm run aprf:ai-fairness-eval -- --target <app> --out <app>/aprf-assessment
  # N/A if highStakesDecisionPathsPresent=false; PASS needs inventoried + latestFairnessEvalWithin90DaysWithThresholdsAndOwners under imports/ai-fairness-eval/

SAF-R1 human safety edge-case sampling (plan + review packet ≤90d):
  npm run aprf:ai-safety-edge-sampling -- --target <app> --out <app>/aprf-assessment
  # PASS needs safetyEdgeCaseSamplingPlanConfigured + lastPacketWithin90DaysWithDispositionsAndReviewers + backlogLinkedWhenNeeded under imports/ai-safety-edge-sampling/

SAF-R2 jailbreak-to-harm red-team (distinct from security injection; thresholds + owned backlog):
  npm run aprf:ai-jailbreak-harm-redteam -- --target <app> --out <app>/aprf-assessment
  # PASS needs jailbreakToHarmSuiteDistinctFromSecurityInjection + suiteCoversDocumentedHarmCategories + latestRunWithin90DaysMeetsRefusalSafetyThresholds + findingsFeedSafetyBacklogWithOwners under imports/ai-jailbreak-harm-redteam/

EXP-M1 factual/high-stakes RAG provenance (citations + resolvable source IDs):
  npm run aprf:ai-rag-provenance -- --target <app> --out <app>/aprf-assessment
  # PASS needs factualOrHighStakesRagEvalConfigured + answersWithValidCitationPct≥90 + citationsResolveToAuthorizedCorpus under imports/ai-rag-provenance/

EXP-M2 operator decision-path reconstruction (procedure + timed drill ≥3 traces):
  npm run aprf:ai-decision-path-recon -- --target <app> --out <app>/aprf-assessment
  # PASS needs reconstructionProcedureDocumented + reconstructedSampleCount≥3 + allSamplesWithinDocumentedTimeBudget under imports/ai-decision-path-recon/

EXP-M3 explanation payload secret/PII hygiene (policy + synthetic tests + sample scan):
  npm run aprf:ai-explanation-hygiene -- --target <app> --out <app>/aprf-assessment
  # PASS needs explanationRedactionPolicyConfigured + syntheticSecretPiiRedactedOrBlockedPct=100 + productionExplanationSampleSecretHits=0 under imports/ai-explanation-hygiene/

EXP-R3 change/counterfactual summaries for material model/prompt promotions:
  npm run aprf:ai-change-summary -- --target <app> --out <app>/aprf-assessment
  # PASS needs changeOrCounterfactualSummaryToolingConfigured + lastMaterialPromotionHasRetainedSummary under imports/ai-change-summary/

EXP-R1 user-facing rationale for material automated decisions (catalog + ≥20-case sample):
  npm run aprf:ai-user-rationale -- --target <app> --out <app>/aprf-assessment
  # PASS needs materialDecisionCatalogConfigured + sampleCaseCount≥20 + materialTypesWithUserRationalePct=100 + rationaleGapsTrackedWithOwners under imports/ai-user-rationale/

EXP-R2 regulated-feature explainability requirements matrix (coverage + owned review ≤12 months):
  npm run aprf:ai-explainability-matrix -- --target <app> --out <app>/aprf-assessment
  # PASS needs explainabilityMatrixConfigured + regulatedFeaturesWithExplanationRequirementPct=100 + matrixReviewedWithin12MonthsWithNamedOwner under imports/ai-explainability-matrix/

DG-M1 production RAG corpus/index ownership + cadence:
  npm run aprf:rag-corpus -- --target <app> --out <app>/aprf-assessment
  # PASS needs complete inventory under imports/rag-corpus-governance/

DG-M2 eval/fine-tune dataset provenance + quality:
  npm run aprf:dataset-provenance -- --target <app> --out <app>/aprf-assessment
  # PASS needs inventory + promotionBlockedIfMissing under imports/dataset-provenance-governance/

DG-M3 feedback/memory promotion gates:
  npm run aprf:feedback-promotion -- --target <app> --out <app>/aprf-assessment
  # PASS needs gated paths + ungatedPromotionDenied under imports/feedback-promotion-governance/

DG-R1 critical corpus freshness metrics:
  npm run aprf:corpus-freshness -- --target <app> --out <app>/aprf-assessment
  # PASS needs SLOs + ≥95% meet-rate + alert under imports/corpus-freshness-metrics/

DG-R2 train/serve skew monitoring:
  npm run aprf:train-serve-skew -- --target <app> --out <app>/aprf-assessment
  # PASS needs recent skew job + threshold + breach ticket/page under imports/train-serve-skew-monitor/

DG-R3 major eval/fine-tune dataset cards:
  npm run aprf:dataset-cards -- --target <app> --out <app>/aprf-assessment
  # PASS needs purpose/source/PII + ≤12mo cards under imports/dataset-cards-registry/

PRI-M1 model payload classification:
  npm run aprf:payload-classification -- --target <app> --out <app>/aprf-assessment
  # PASS needs scheme + sensitive rules + 100% tagged audit under imports/model-payload-classification/

PRI-R1 pre-model tokenization/redaction:
  npm run aprf:payload-redaction -- --target <app> --out <app>/aprf-assessment
  # PASS needs field inventory + fail-closed pipeline + ≥50 clean samples under imports/model-payload-redaction/

PRI-R2 vendor model terms (training use + retention):
  npm run aprf:vendor-model-terms -- --target <app> --out <app>/aprf-assessment
  # PASS needs provider inventory + ≤12mo reviews under imports/vendor-model-terms/

PRI-M2 AI memory/log deletion and export:
  npm run aprf:ai-deletion-export -- --target <app> --out <app>/aprf-assessment
  # PASS needs AI-scoped procedure + within-SLA timed test under imports/ai-deletion-export/

PRI-M3 residency-constrained routing:
  npm run aprf:ai-residency-routing -- --target <app> --out <app>/aprf-assessment
  # PASS needs labeled regulated workloads + 100% in-region sample under imports/ai-residency-routing/

PRI-R3 DPIA/PIA before production:
  npm run aprf:ai-dpia -- --target <app> --out <app>/aprf-assessment
  # PASS needs major-feature inventory + signed pre-prod DPIAs under imports/ai-dpia/

MEM-M1 memory tenant/user isolation:
  npm run aprf:memory-isolation -- --target <app> --out <app>/aprf-assessment
  # PASS needs ≥10 memory attack cases with 0 unauthorized successes under imports/memory-isolation/

MEM-M2 memory retention + TTL/deletion:
  npm run aprf:memory-retention -- --target <app> --out <app>/aprf-assessment
  # PASS needs per-class retention + job + purge test under imports/memory-retention/

MEM-M3 durable memory write policy:
  npm run aprf:memory-write-policy -- --target <app> --out <app>/aprf-assessment
  # PASS needs writers/content-class policy + 100% unauthorized deny under imports/memory-write-policy/

MEM-M4 critical memory integrity:
  npm run aprf:memory-integrity -- --target <app> --out <app>/aprf-assessment
  # PASS needs critical-class inventory + 100% verification under imports/memory-integrity/

MEM-R1 memory poisoning evals:
  npm run aprf:memory-poisoning-evals -- --target <app> --out <app>/aprf-assessment
  # PASS needs ≥5 typed scenarios + gated critical fails under imports/memory-poisoning-evals/

MEM-R3 working vs durable + promotion:
  npm run aprf:memory-promotion-architecture -- --target <app> --out <app>/aprf-assessment
  # PASS needs separation + rules + ≥10 audits + TTL-by-class under imports/memory-promotion-architecture/

CMP-M1 AI obligations register:
  npm run aprf:ai-obligations-register -- --target <app> --out <app>/aprf-assessment
  # PASS needs per-system obligations/none-in-scope with owners + reviews ≤12 months under imports/ai-obligations-register/

CMP-M2 control→evidence matrix:
  npm run aprf:ai-control-evidence-matrix -- --target <app> --out <app>/aprf-assessment
  # PASS needs 100% obligation→evidence coverage, 0 orphans, review ≤12 months under imports/ai-control-evidence-matrix/

CMP-M3 AI control-plane audit retention:
  npm run aprf:ai-control-plane-audit-logs -- --target <app> --out <app>/aprf-assessment
  # PASS needs retention ≥ policy min + ≤5 min synthetic appearance + queryable smoke under imports/ai-control-plane-audit-logs/

CMP-R1 control testing + exceptions:
  npm run aprf:ai-control-testing -- --target <app> --out <app>/aprf-assessment
  # PASS needs on-schedule cycle (≤90d) + openExceptionsIncomplete=0 under imports/ai-control-testing/

CMP-R2 customer-facing trust documentation:
  npm run aprf:ai-trust-documentation -- --target <app> --out <app>/aprf-assessment
  # PASS needs published URL + identity/safety/data/incident + pillar map + last-updated ≤12m under imports/ai-trust-documentation/

CMP-R3 Level-5 independent assessment:
  npm run aprf:ai-independent-assessment -- --target <app> --out <app>/aprf-assessment
  # PASS needs coversAllLevel5Systems + sampled Check IDs + remediation owners + assessment ≤12m under imports/ai-independent-assessment/

ORG-M1 AI acceptable-use / prohibited-applications policy:
  npm run aprf:ai-acceptable-use-policy -- --target <app> --out <app>/aprf-assessment
  # PASS needs version + owner + both sections + review ≤12m under imports/ai-acceptable-use-policy/

ORG-R2 critical APRF domain owners:
  npm run aprf:ai-domain-ownership -- --target <app> --out <app>/aprf-assessment
  # PASS needs coversAllProductionAiSystems + systemsMissingRequiredDomainOwners=0 under imports/ai-domain-ownership/

ORG-R4 control-gap risk acceptance:
  npm run aprf:ai-risk-acceptance -- --target <app> --out <app>/aprf-assessment
  # PASS needs openWaiversIncomplete=0 + expiredWaiversWithoutEscalation=0 under imports/ai-risk-acceptance/

ORG-R1 leadership AI risk / APRF maturity review:
  npm run aprf:ai-leadership-review -- --target <app> --out <app>/aprf-assessment
  # PASS needs reviewAgeDays≤90 + openActionsIncomplete=0 under imports/ai-leadership-review/

ORG-R3 continual improvement backlog:
  npm run aprf:ai-improvement-backlog -- --target <app> --out <app>/aprf-assessment
  # PASS needs linkageRatePct≥80 + closedOrPlannedRatePct≥50 under imports/ai-improvement-backlog/

ORG-R5 org-wide APRF evidence sampling:
  npm run aprf:ai-org-aprf-sampling -- --target <app> --out <app>/aprf-assessment
  # PASS needs assessmentAgeDays≤365 + sampledCheckIdCount>0 + findingsListed under imports/ai-org-aprf-sampling/

Import runtime evidence without live APIs:
  mkdir -p <out>/imports/langsmith && cp traces.json <out>/imports/langsmith/
`);
      process.exit(0);
    }
  }
  return out;
}

export type CollectOptions = {
  target: string;
  outDir: string;
  live: boolean;
  plugins?: string[];
  maxFiles: number;
  baseUrl?: string;
  adminToken?: string;
  adminEmail?: string;
  adminPassword?: string;
  limitedEmail?: string;
  limitedPassword?: string;
  limitedToken?: string;
  /** When false, suppress per-collector console lines (default true). */
  log?: boolean;
};

/** Run selected collectors and write `evidence-graph.json` under `outDir`. */
export async function runCollectors(
  args: CollectOptions,
): Promise<EvidenceGraph> {
  const target = resolve(args.target);
  const outDir = resolve(args.outDir);
  if (outDir === target) {
    throw new Error(
      `--out must not equal --target (would skip the whole repository from evidence walks); use a subdirectory such as ./aprf-assessment`,
    );
  }

  ensureDir(outDir);
  ensureDir(resolve(outDir, "imports"));

  const assessedAt = new Date();
  const gitCommit = tryGitCommit(target);
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt,
    gitCommit,
    live: args.live,
    maxFiles: args.maxFiles,
    baseUrl: args.baseUrl,
    adminToken: args.adminToken,
    adminEmail: args.adminEmail,
    adminPassword: args.adminPassword,
    limitedEmail: args.limitedEmail,
    limitedPassword: args.limitedPassword,
    limitedToken: args.limitedToken,
  };

  const selected = args.plugins
    ? COLLECTORS.filter((c) => args.plugins!.includes(c.id))
    : COLLECTORS;

  const collectorsMeta: EvidenceGraph["collectors"] = [];
  const nodes: EvidenceNode[] = [];
  const log = args.log !== false;

  // Never treat assessment output under the target as repo evidence.
  configureWalkSkipForCollect(target, outDir);
  try {
    for (const c of selected) {
      // Re-assert after each collector in case a collect path mutated module skips.
      configureWalkSkipForCollect(target, outDir);
      const result = await c.collect(ctx);
      collectorsMeta.push({
        pluginId: result.pluginId,
        status: result.status,
        detail: result.detail,
      });
      nodes.push(...result.nodes);
      if (log) {
        console.log(
          `[${result.status}] ${result.pluginId}: ${result.detail ?? ""} (${result.nodes.length} nodes)`,
        );
      }
    }
  } finally {
    clearWalkSkipAbsoluteDirs();
  }

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  collectorsMeta.sort((a, b) => a.pluginId.localeCompare(b.pluginId));

  const graph: EvidenceGraph = {
    schemaVersion: "0.2.0",
    assessedAt: assessedAt.toISOString(),
    subject: {
      path: args.target,
      name: projectName(args.target),
      gitCommit,
    },
    collectors: collectorsMeta,
    nodes,
    edges: [],
  };

  const outPath = resolve(args.outDir, "evidence-graph.json");
  writeJson(outPath, graph);
  if (log) console.log(`\nWrote ${outPath} (${nodes.length} nodes)`);
  return graph;
}

async function main() {
  await runCollectors(parseArgs(process.argv));
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
const isMain =
  /(?:^|[/\\])runner\.(?:ts|js|mjs)$/.test(entry) &&
  import.meta.url === pathToFileURL(entry).href;

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}