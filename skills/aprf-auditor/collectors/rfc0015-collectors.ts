import { exerciseImportCollector } from "./lib/exercise-import-collector.ts";

export const harnessIntegrityCollector = exerciseImportCollector({
  pluginId: "harness-integrity",
  detectorId: "repo-harness-integrity",
  relatedCheckIds: ["AGN-M5"],
  surfacePresentKey: "toolOrMcpSideEffectsPresent",
  passBoolKeys: [
    "outOfBandInvokeDenied",
    "unregisteredToolDenied",
    "disabledMiddlewareDenied",
    "dynamicRegistrationDenied",
    "toolSubstitutionDenied",
  ],
  repoPathPattern:
    /\b(tool[_-]?gateway|mcp[_-]?gateway|harness[_-]?(middleware|gateway)|policy[_-]?engine)\b/i,
  repoContentPattern:
    /\b(tool[_-]?gateway|harness[_-]?middleware|mcp[_-]?proxy|deny[_-]?unregistered[_-]?tool)\b/i,
  registeredPassSignals: [
    "harness.bypass.attempt_denied",
    "tool.dynamic_register.denied",
  ],
  minCases: 5,
  registeredFailSignals: ["harness.bypass.attempt_succeeded"],
  evidenceTypes: ["harness_exercise_report", "repo_signal"],
  emptyDetail:
    "Repo harness signals are PARTIAL — import ≥5 deny cases (cases[]) plus deny flags under imports/harness-integrity/ (measuredAt ≤90d) to PASS.",
});

export const transitiveToolAccessCollector = exerciseImportCollector({
  pluginId: "transitive-tool-access",
  detectorId: "repo-transitive-tool-access",
  relatedCheckIds: ["TOL-M6"],
  surfacePresentKey: "toolsMcpOrDelegationPresent",
  passBoolKeys: [
    "capabilityGraphPresent",
    "charterScopeMapped",
    "unauthorizedEffectivePathsDenied",
  ],
  repoPathPattern:
    /\b(mcp[_-]?server|tool[_-]?allowlist|capability[_-]?graph)\b/i,
  repoContentPattern:
    /\b(mcp[_-]?server|tool[_-]?allowlist|capability[_-]?graph|unauthorized[_-]?effective[_-]?path)\b/i,
  minCases: 1,
  registeredPassSignals: [
    "agent.graph.path_transitive_exercised",
    "tool.unauthorized.denied",
  ],
  registeredFailSignals: ["tool.unauthorized.succeeded"],
  evidenceTypes: [
    "agent_capability_graph",
    "harness_exercise_report",
    "repo_signal",
  ],
  emptyDetail:
    "Signals alone are PARTIAL — import ≥1 deny case plus capabilityGraphPresent, charterScopeMapped, unauthorizedEffectivePathsDenied=true under imports/transitive-tool-access/.",
});

export const approvalReplayCollector = exerciseImportCollector({
  pluginId: "approval-replay",
  detectorId: "repo-approval-replay",
  relatedCheckIds: ["HUM-M5"],
  surfacePresentKey: "highImpactApprovalsPresent",
  passBoolKeys: ["replayDenied", "expiryDenied", "selfApprovalDenied"],
  repoPathPattern:
    /\b(approval[_-]?token|hitl[_-]?gate|human[_-]?approval)\b/i,
  repoContentPattern:
    /\b(approval[_-]?token|replay[_-]?protect|self[_-]?approv)\b/i,
  minCases: 3,
  registeredPassSignals: ["approval.replay.denied", "approval.self.denied"],
  registeredFailSignals: ["approval.replay.succeeded"],
  evidenceTypes: ["harness_exercise_report", "repo_signal"],
  emptyDetail:
    "Repo approval signals are PARTIAL — import replayDenied, expiryDenied, selfApprovalDenied=true under imports/approval-replay/.",
});

export const evalMethodologyCollector = exerciseImportCollector({
  pluginId: "eval-methodology",
  detectorId: "repo-eval-methodology",
  relatedCheckIds: ["EVL-M5"],
  surfacePresentKey: "productionAgentsPresent",
  passBoolKeys: [
    "datasetsVersioned",
    "runsLinkedToAgentVersion",
    "successNotSelfReported",
    "securityCasesNotLlmJudgeOnly",
  ],
  conditionalBoolKeys: [
    { whenKey: "toolsPresent", requireKey: "toolUseCasesPresent" },
  ],
  minCases: 1,
  repoPathPattern: /\b(eval[_-]?dataset|eval[_-]?suite|tool[_-]?use[_-]?eval)\b/i,
  repoContentPattern:
    /\b(eval[_-]?dataset|llm[_-]?as[_-]?judge|tool[_-]?use[_-]?eval)\b/i,
  registeredPassSignals: [
    "eval.dataset.versioned",
    "eval.run.linked_to_agent_version",
  ],
  registeredFailSignals: ["eval.security.llm_judge_only"],
  evidenceTypes: [
    "eval_dataset_manifest",
    "eval_run_report",
    "harness_exercise_report",
  ],
  emptyDetail:
    "Repo eval signals are PARTIAL — import versioned datasets, agent-version-linked runs, independent success, and non-LLM security oracles under imports/eval-methodology/.",
});

export const agentTraceAttributesCollector = exerciseImportCollector({
  pluginId: "agent-trace-attributes",
  detectorId: "repo-agent-trace-attributes",
  relatedCheckIds: ["OBS-M3"],
  surfacePresentKey: "productionAgentRequestPathPresent",
  passBoolKeys: ["redactionConsistentWithSensitiveFieldPolicy"],
  passPctKeys: [{ key: "reconstructableAttributeCoveragePct", min: 95 }],
  minCases: 1,
  repoPathPattern:
    /\b(agent[_-]?trace|span[_-]?processor|otel[_-]?genai)\b/i,
  repoContentPattern:
    /\b(reconstructable[_-]?attribute|agent[_-]?run[_-]?span|termination[_-]?reason|span[_-]?processor)\b/i,
  registeredPassSignals: ["obs.agent_run.attributes_complete"],
  registeredFailSignals: [],
  evidenceTypes: ["agent_trace_sample", "repo_signal"],
  emptyDetail:
    "Repo trace signals are PARTIAL — import ≥1 trace sample plus reconstructableAttributeCoveragePct>=95 under imports/agent-trace-attributes/.",
});

export const nonIdempotentRetryCollector = exerciseImportCollector({
  pluginId: "non-idempotent-retry",
  detectorId: "repo-non-idempotent-retry",
  relatedCheckIds: ["REL-M9"],
  surfacePresentKey: "nonIdempotentOrIrreversibleToolsPresent",
  passBoolKeys: [
    "toolsClassified",
    "noDuplicateCommitWithoutSafeguard",
  ],
  minCases: 1,
  repoPathPattern:
    /\b(idempotency[_-]?key|non[_-]?idempotent|irreversible[_-]?tool)\b/i,
  repoContentPattern:
    /\b(idempotency[_-]?key|non[_-]?idempotent|irreversible[_-]?tool)\b/i,
  registeredPassSignals: [],
  registeredFailSignals: ["rel.non_idempotent.duplicate_commit"],
  evidenceTypes: ["idempotency_exercise_report", "repo_signal"],
  emptyDetail:
    "Repo retry signals are PARTIAL — import toolsClassified + noDuplicateCommitWithoutSafeguard=true under imports/non-idempotent-retry/.",
});
