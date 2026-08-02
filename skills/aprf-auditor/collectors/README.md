# APRF Auditor collectors (TypeScript executors)

Shipped **local** collectors that emit `evidence-graph.json`. No StackRail backend.

## Quality gate

CI runs `npm run aprf:collectors:unused`, which fails on:

1. Unused locals / parameters / imports (`noUnusedLocals`, `noUnusedParameters`)
2. Useless non-nullish initializers overwritten on every path before read
   (e.g. `let statusHint = "not_demonstrated"` then always reassigned)

Declare locals without a dummy default when every branch assigns them:

```ts
let statusHint: Report["summary"]["statusHint"];
```

`= null` / `= undefined` sentinels are allowed (common merge/attest pattern).

## Quick start

```bash
# From APRF repo root (or any project with APRF checked out)
npm run aprf:collect -- --target . --out ./aprf-assessment

# Subset
npm run aprf:collect -- --plugins repo-filesystem,github-actions --out ./aprf-assessment
```

## Evidence without live cloud APIs

Drop exports into the assessment output dir:

```bash
mkdir -p ./aprf-assessment/imports/langsmith
cp my-traces.json ./aprf-assessment/imports/langsmith/
npm run aprf:collect -- --plugins langsmith --out ./aprf-assessment
```

### Out-of-plugin evidence (catch-all)

Any artifact without a dedicated plugin goes under `imports/custom/` → **user**-class nodes:

```bash
mkdir -p ./aprf-assessment/imports/custom
cp vendor-soc2.pdf runbook.docx weird-tool-export.json ./aprf-assessment/imports/custom/
npm run aprf:collect -- --plugins custom --out ./aprf-assessment
```

Agents map those nodes to Checks; confidence stays user-tier (cannot override higher-rank FAIL).

## Optional live APIs

```bash
APRF_AUDITOR_LIVE=1 GITHUB_TOKEN=ghp_... npm run aprf:collect -- --live --plugins github-actions
```

Live mode is **opt-in**. Default collectors only read the local repo + `imports/`.

## Executors

| Plugin | Executor | Local | Import dir | Live |
| --- | --- | --- | --- | --- |
| repo-filesystem | `repo-filesystem.ts` | yes | — | — |
| github-actions | `github-actions.ts` | workflow YAML | — | Actions runs API |
| otel | `otel.ts` | config scan | `imports/otel/` | — |
| **ai-distributed-trace-linkage** | `ai-distributed-trace-linkage.ts` | request→model→tool→outcome linkage ≥95%/24h (OBS-M1) | `imports/ai-distributed-trace-linkage/` | — |
| **ai-token-cost-attribution** | `ai-token-cost-attribution.ts` | token/cost attribution request/feature/tenant (OBS-R4) | `imports/ai-token-cost-attribution/` | — |
| **ai-trace-sensitive-redaction** | `ai-trace-sensitive-redaction.ts` | sensitive span redaction/ACL when secrets/PII in traces (OBS-M2) | `imports/ai-trace-sensitive-redaction/` | — |
| **ai-trace-replay** | `ai-trace-replay.ts` | secure failed-trace replay + RTO + ≤90d drill (OBS-R1) | `imports/ai-trace-replay/` | — |
| **ai-trace-quality-annotations** | `ai-trace-quality-annotations.ts` | quality labels on traces ≥50/90d → eval/review (OBS-R2) | `imports/ai-trace-quality-annotations/` | — |
| **ai-slo-dashboards** | `ai-slo-dashboards.ts` | named AI SLOs + latency/error/quality burn alerts (OBS-R3) | `imports/ai-slo-dashboards/` | — |
| **ai-journey-slo-catalog** | `ai-journey-slo-catalog.ts` | critical journey availability+latency SLO catalog 100% (PERF-M1) | `imports/ai-journey-slo-catalog/` | — |
| **ai-ops-metrics** | `ai-ops-metrics.ts` | latency+error+AI quality metrics available for ops (PERF-M2) | `imports/ai-ops-metrics/` | — |
| **ai-ops-dashboards** | `ai-ops-dashboards.ts` | near-real-time latency/error/throughput/resource/quality boards (PERF-R4) | `imports/ai-ops-dashboards/` | — |
| **ai-slo-burn-alerts** | `ai-slo-burn-alerts.ts` | critical-journey SLO burn alerts + notify proof (PERF-M3) | `imports/ai-slo-burn-alerts/` | — |
| **ai-error-budget-release-gate** | `ai-error-budget-release-gate.ts` | error-budget → freeze/risk acceptance + gated event ≤90d (PERF-R1) | `imports/ai-error-budget-release-gate/` | — |
| **ai-adversarial-capacity-tests** | `ai-adversarial-capacity-tests.ts` | adversarial long-prompt + agent-loop capacity ≤90d (PERF-R2) | `imports/ai-adversarial-capacity-tests/` | — |
| **ai-streaming-slis** | `ai-streaming-slis.ts` | TTFT + inter-token SLIs + alerts + ≥30d retention (PERF-R3) | `imports/ai-streaming-slis/` | — |
| **ai-timeouts-retries** | `ai-timeouts-retries.ts` | model/tool timeouts + bounded retries 100% coverage (REL-M1) | `imports/ai-timeouts-retries/` | — |
| **ai-degraded-mode** | `ai-degraded-mode.ts` | critical journey degraded mode + failover test (REL-M2) | `imports/ai-degraded-mode/` | — |
| **ai-partial-tool-failure** | `ai-partial-tool-failure.ts` | partial tool failure / no false-success via outcome tests (REL-M3) | `imports/ai-partial-tool-failure/` | — |
| **ai-continuity-options** | `ai-continuity-options.ts` | critical AI process continuity options + owners (REL-R3) | `imports/ai-continuity-options/` | — |
| **ai-control-plane-backup** | `ai-control-plane-backup.ts` | AI control-plane backup inventory + restore test (REL-M4) | `imports/ai-control-plane-backup/` | — |
| **ai-chaos-dependency** | `ai-chaos-dependency.ts` | AI-dependency chaos experiments (REL-R5) | `imports/ai-chaos-dependency/` | — |
| **ai-circuit-bulkhead** | `ai-circuit-bulkhead.ts` | circuit breakers + bulkheads on AI/provider clients (REL-R1) | `imports/ai-circuit-bulkhead/` | — |
| **ai-fallback-eval** | `ai-fallback-eval.ts` | multi-provider/multi-region fallback + quality/safety eval (REL-R2) | `imports/ai-fallback-eval/` | — |
| **ai-continuity-drill** | `ai-continuity-drill.ts` | provider-loss continuity drills + RTO/RPO results (REL-R4) | `imports/ai-continuity-drill/` | — |
| **ai-warm-standby** | `ai-warm-standby.ts` | warm standby for self-hosted inference (REL-R6) | `imports/ai-warm-standby/` | — |
| **ai-rag-provenance** | `ai-rag-provenance.ts` | factual/high-stakes RAG citation provenance (EXP-M1) | `imports/ai-rag-provenance/` | — |
| **ai-decision-path-recon** | `ai-decision-path-recon.ts` | operator decision-path reconstruction drills (EXP-M2) | `imports/ai-decision-path-recon/` | — |
| **ai-explanation-hygiene** | `ai-explanation-hygiene.ts` | explanation payload secret/PII hygiene (EXP-M3) | `imports/ai-explanation-hygiene/` | — |
| **ai-change-summary** | `ai-change-summary.ts` | change/counterfactual summaries for model/prompt promotions (EXP-R3) | `imports/ai-change-summary/` | — |
| **ai-user-rationale** | `ai-user-rationale.ts` | user-facing rationale for material automated decisions (EXP-R1) | `imports/ai-user-rationale/` | — |
| **ai-harm-policy** | `ai-harm-policy.ts` | domain-specific AI safety policy with refuse/escalate (SAF-M1) | `imports/ai-harm-policy/` | — |
| **ai-safety-eval-gates** | `ai-safety-eval-gates.ts` | automated safety eval release gates (SAF-M2) | `imports/ai-safety-eval-gates/` | — |
| **ai-interaction-disclosure** | `ai-interaction-disclosure.ts` | AI-interaction disclosure on in-scope UX (SAF-M3) | `imports/ai-interaction-disclosure/` | — |
| **ai-fairness-eval** | `ai-fairness-eval.ts` | fairness/disparity eval for high-stakes paths (SAF-M4, conditional) | `imports/ai-fairness-eval/` | — |
| **ai-safety-edge-sampling** | `ai-safety-edge-sampling.ts` | human safety edge-case sampling (SAF-R1) | `imports/ai-safety-edge-sampling/` | — |
| **ai-jailbreak-harm-redteam** | `ai-jailbreak-harm-redteam.ts` | jailbreak-to-harm red-team suite (SAF-R2) | `imports/ai-jailbreak-harm-redteam/` | — |
| **ai-explainability-matrix** | `ai-explainability-matrix.ts` | regulated-feature explainability requirements matrix (EXP-R2) | `imports/ai-explainability-matrix/` | — |
| **ai-multi-provider-continuity** | `ai-multi-provider-continuity.ts` | Level-5 multi-provider contractual + technical continuity (REL-R7) | `imports/ai-multi-provider-continuity/` | — |
| **ai-rto-rpo-catalog** | `ai-rto-rpo-catalog.ts` | business-critical AI service RTO/RPO in BCP/service-catalog/DR + tested restore/failover (REL-M5) | `imports/ai-rto-rpo-catalog/` | — |
| **http-auth-probe** | `http-auth-probe.ts` | route catalog | `imports/http-auth-probe/` | **`--base-url` probe** |
| **secrets-hygiene** | `secrets-hygiene.ts` | secrets-manager + scan + embeds (SEC2-M1) | `imports/secrets-hygiene/` | — |
| **secret-redaction** | `secret-redaction.ts` | log/trace redaction canary (SEC2-M2) | `imports/secret-redaction/` | — |
| **key-rotation-scope** | `key-rotation-scope.ts` | key inventory/scope/rotation (SEC2-M3) | `imports/key-rotation-scope/` | — |
| **precommit-ci-secret-scan** | `precommit-ci-secret-scan.ts` | pre-commit + CI secret scan ≤7d (SEC2-R1) | `imports/precommit-ci-secret-scan/` | — |
| **credential-egress-controls** | `credential-egress-controls.ts` | credential egress allowlist + deny (SEC2-R2) | `imports/credential-egress-controls/` | — |
| **dataset-secret-scan-gate** | `dataset-secret-scan-gate.ts` | dataset secret/PII publish gate (SEC2-R3) | `imports/dataset-secret-scan-gate/` | — |
| **artifact-provenance-integrity** | `artifact-provenance-integrity.ts` | cosign/SLSA/verify + block unverified (SCI-M1) | `imports/artifact-provenance-integrity/` | — |
| **ai-external-tool-inventory** | `ai-external-tool-inventory.ts` | MCP/plugin/tool inventory + pin/review (SCI-M2) | `imports/ai-external-tool-inventory/` | — |
| **ai-vuln-scan-gate** | `ai-vuln-scan-gate.ts` | vuln scan + critical promote block (SCI-M3) | `imports/ai-vuln-scan-gate/` | — |
| **ai-deploy-policy-enforcement** | `ai-deploy-policy-enforcement.ts` | deploy-path unsigned/unapproved/revoked (SCI-M4) | `imports/ai-deploy-policy-enforcement/` | — |
| **ai-verify-on-deploy** | `ai-verify-on-deploy.ts` | last-deploy verify + unsigned reject (SCI-R1) | `imports/ai-verify-on-deploy/` | — |
| **ai-model-mbom** | `ai-model-mbom.ts` | registry-linked model MBOM (SCI-R2) | `imports/ai-model-mbom/` | — |
| **tool-gateway-authz** | `tool-gateway-authz.ts` | server-side tool authz deny (TOL-M1) | `imports/tool-gateway-authz/` | — |
| **tool-allowlist** | `tool-allowlist.ts` | per-agent allowlist + unknown deny (TOL-M2) | `imports/tool-allowlist/` | — |
| **high-impact-tool-gates** | `high-impact-tool-gates.ts` | high-impact extra gates (TOL-M3) | `imports/high-impact-tool-gates/` | — |
| **tool-argument-schema** | `tool-argument-schema.ts` | tool argument schemas (TOL-M4) | `imports/tool-argument-schema/` | — |
| **signed-tool-catalog** | `signed-tool-catalog.ts` | signed MCP/agent catalogs (TOL-M5) | `imports/signed-tool-catalog/` | — |
| **destructive-tool-dry-run** | `destructive-tool-dry-run.ts` | destructive dry-run non-prod (TOL-R1) | `imports/destructive-tool-dry-run/` | — |
| **tool-rate-limits** | `tool-rate-limits.ts` | rate + blast budgets (TOL-R2) | `imports/tool-rate-limits/` | — |
| promptfoo | `promptfoo.ts` | eval configs | `imports/promptfoo/` | — |
| aws / azure / gcp | `iac-cloud.ts` | Terraform/Bicep signals | `imports/<cloud>/` | — |
| langsmith, phoenix, … | `import-ingest.ts` | — | `imports/<id>/` | — |
| **custom** | `import-ingest.ts` | — | **`imports/custom/`** | — |
| **agent-charter-inventory** | `agent-charter-inventory.ts` | inventory/charters | `imports/agent-charter-inventory/` | — |
| **agent-loop-limits** | `agent-loop-limits.ts` | agent limit config/tests | `imports/agent-loop-limits/` | — |
| **agent-kill-switch** | `agent-kill-switch.ts` | kill API / cancel tests | `imports/agent-kill-switch/` | — |
| **a2a-peer-auth** | `a2a-peer-auth.ts` | A2A handoff auth/scope | `imports/a2a-peer-auth/` | — |
| **agent-goal-policy** | `agent-goal-policy.ts` | goal-conflict plan policy | `imports/agent-goal-policy/` | — |
| **agent-sandbox-sim** | `agent-sandbox-sim.ts` | sandbox/sim before prod | `imports/agent-sandbox-sim/` | — |
| **agent-raci-ownership** | `agent-raci-ownership.ts` | agent RACI register | `imports/agent-raci-ownership/` | — |
| **human-approval-*** | `human-approval.ts` | HITL gates/audit/bypass/dual/UI/SLA | `imports/human-approval-*/` | — |
| **ai-spend-limits** | `ai-spend-limits.ts` | spend/rate hard limits | `imports/ai-spend-limits/` | — |
| **context-budget** | `context-budget.ts` | context assembly budgets (CTX-M1) | `imports/context-budget/` | — |
| **context-source-acl** | `context-source-acl.ts` | source labels + ACL inclusion (CTX-M2) | `imports/context-source-acl/` | — |
| **context-sensitive-inclusion** | `context-sensitive-inclusion.ts` | sensitive-class inclusion (CTX-M3) | `imports/context-sensitive-inclusion/` | — |
| **context-budget-monitoring** | `context-budget-monitoring.ts` | budget metrics + saturation alerts (CTX-R1) | `imports/context-budget-monitoring/` | — |
| **context-compaction-evals** | `context-compaction-evals.ts` | compaction fact retention (CTX-R2) | `imports/context-compaction-evals/` | — |
| **context-structured-blocks** | `context-structured-blocks.ts` | instruction vs data blocks (CTX-R3) | `imports/context-structured-blocks/` | — |
| **eval-suite-ci** | `eval-suite-ci.ts` | critical-journey offline evals on change (EVL-M1) | `imports/eval-suite-ci/` | — |
| **eval-release-gates** | `eval-release-gates.ts` | quality/safety numeric release gates (EVL-M2) | `imports/eval-release-gates/` | — |
| **eval-online-signals** | `eval-online-signals.ts` | online task-success + refusal metrics (EVL-M3) | `imports/eval-online-signals/` | — |
| **eval-shadow-cutover** | `eval-shadow-cutover.ts` | shadow/canary before full cutover (EVL-M4) | `imports/eval-shadow-cutover/` | — |
| **eval-track-catalog** | `eval-track-catalog.ts` | regression/adversarial/distribution-shift tracks (EVL-R1) | `imports/eval-track-catalog/` | — |
| **eval-human-review** | `eval-human-review.ts` | human preference / expert-review sampling (EVL-R2) | `imports/eval-human-review/` | — |
| **model-pin-config** | `model-pin-config.ts` | pinned model IDs; no floating aliases (MOD-M1) | `imports/model-pin-config/` | — |
| **model-inventory** | `model-inventory.ts` | model inventory with owner/residency/use (MOD-R4) | `imports/model-inventory/` | — |
| **model-promotion-eval** | `model-promotion-eval.ts` | eval evidence required before model promotion (MOD-M2) | `imports/model-promotion-eval/` | — |
| **model-deprecation-sunset** | `model-deprecation-sunset.ts` | deprecation/sunset policy for models+embeddings (MOD-R1) | `imports/model-deprecation-sunset/` | — |
| **model-capability-allowlist** | `model-capability-allowlist.ts` | per-workload model capability allowlists (MOD-R2) | `imports/model-capability-allowlist/` | — |
| **model-license-provenance** | `model-license-provenance.ts` | license+provenance review for open-weight/fine-tuned (MOD-R3) | `imports/model-license-provenance/` | — |
| **prompt-version-registry** | `prompt-version-registry.ts` | immutable prompt version IDs + owners (PRM-M1) | `imports/prompt-version-registry/` | — |
| **prompt-change-review-eval** | `prompt-change-review-eval.ts` | prompt release review + eval gate (PRM-M2) | `imports/prompt-change-review-eval/` | — |
| **prompt-rollback** | `prompt-rollback.ts` | prompt rollback without full app redeploy (PRM-M3) | `imports/prompt-rollback/` | — |
| **prompt-template-hygiene** | `prompt-template-hygiene.ts` | parameterized templates; no secrets/PII (PRM-R1) | `imports/prompt-template-hygiene/` | — |
| **prompt-lint-ci** | `prompt-lint-ci.ts` | blocking prompt lint on change PRs (PRM-R2) | `imports/prompt-lint-ci/` | — |
| **prompt-ab-shadow-eval** | `prompt-ab-shadow-eval.ts` | A/B or shadow eval for high-traffic prompt changes (PRM-R3) | `imports/prompt-ab-shadow-eval/` | — |
| **prompt-model-version-retention** | `prompt-model-version-retention.ts` | prior prompt/model-pin versions + restore dry-run (CHG-M1) | `imports/prompt-model-version-retention/` | — |
| **rollback-runbook** | `rollback-runbook.ts` | rollback runbook operable by on-call (CHG-M2) | `imports/rollback-runbook/` | — |
| **rollback-drill** | `rollback-drill.ts` | successful rollback drill within RTO (CHG-M3) | `imports/rollback-drill/` | — |
| **quality-slo-auto-rollback** | `quality-slo-auto-rollback.ts` | quality SLO burn → auto-rollback or page (CHG-R3) | `imports/quality-slo-auto-rollback/` | — |
| **one-click-ai-rollback** | `one-click-ai-rollback.ts` | one-click / single-command AI release rollback (CHG-R1) | `imports/one-click-ai-rollback/` | — |
| **agent-behavior-feature-flags** | `agent-behavior-feature-flags.ts` | feature flags for new agent behaviors (CHG-R2) | `imports/agent-behavior-feature-flags/` | — |
| **ai-artifact-promotion-path** | `ai-artifact-promotion-path.ts` | non-prod→prod promotion for prompts/models/tools (DEP-M1) | `imports/ai-artifact-promotion-path/` | — |
| **ai-artifact-change-records** | `ai-artifact-change-records.ts` | who/what/when + review-linked AI change records (DEP-M2) | `imports/ai-artifact-change-records/` | — |
| **ai-config-as-code** | `ai-config-as-code.ts` | declarative AI config + drift / live-pin match (DEP-M3) | `imports/ai-config-as-code/` | — |
| **ai-canary-progressive-delivery** | `ai-canary-progressive-delivery.ts` | canary / progressive delivery for high-traffic AI (DEP-R1) | `imports/ai-canary-progressive-delivery/` | — |
| **env-parity-model-tool-catalog** | `env-parity-model-tool-catalog.ts` | prod vs staging parity for model pins + tool catalogs (DEP-R2) | `imports/env-parity-model-tool-catalog/` | — |
| **embedding-index-migration** | `embedding-index-migration.ts` | automated embedding/index version migration (DEP-R3) | `imports/embedding-index-migration/` | — |
| **incident-playbooks** | `incident-playbooks.ts` | AI-specific incident playbooks for four scenarios (INC-M1) | `imports/incident-playbooks/` | — |
| **ai-containment-drill** | `ai-containment-drill.ts` | pause / disable tools / rollback containment drill (INC-M2) | `imports/ai-containment-drill/` | — |
| **post-incident-aprf-actions** | `post-incident-aprf-actions.ts` | post-incident APRF-pillar tracked actions (INC-R2) | `imports/post-incident-aprf-actions/` | — |
| **ai-incident-tabletop** | `ai-incident-tabletop.ts` | AI-focused incident tabletop ≤180 days (INC-R4) | `imports/ai-incident-tabletop/` | — |
| **ai-safety-quality-alerts** | `ai-safety-quality-alerts.ts` | safety/quality on-call paging ≥2 signals (INC-R1) | `imports/ai-safety-quality-alerts/` | — |
| **ai-customer-notification-criteria** | `ai-customer-notification-criteria.ts` | customer notify/no-notify criteria + sample ≤12m (INC-R3) | `imports/ai-customer-notification-criteria/` | — |
| **ai-cost-alerts** | `ai-cost-alerts.ts` | budget-burn + anomaly alerts | `imports/ai-cost-alerts/` | — |
| **ai-retry-amplification** | `ai-retry-amplification.ts` | retry/loop cost bounds | `imports/ai-retry-amplification/` | — |
| **ai-prompt-cache** | `ai-prompt-cache.ts` | prompt cache + hit-rate | `imports/ai-prompt-cache/` | — |
| **ai-model-routing** | `ai-model-routing.ts` | cheap/premium routing | `imports/ai-model-routing/` | — |
| **ai-finops-unit-economics** | `ai-finops-unit-economics.ts` | unit cost + FinOps review | `imports/ai-finops-unit-economics/` | — |
| **platform-golden-path** | `platform-golden-path.ts` | AI golden-path docs (DX-M1) | `imports/platform-golden-path/` | — |
| **platform-ai-pipeline-gates** | `platform-ai-pipeline-gates.ts` | auth/secret/eval CI gates | `imports/platform-ai-pipeline-gates/` | — |
| **platform-ownership-support** | `platform-ownership-support.ts` | AI platform owner + support (DX-R4) | `imports/platform-ownership-support/` | — |
| **platform-scaffolding-templates** | `platform-scaffolding-templates.ts` | agent/RAG/MCP scaffolds (DX-R1) | `imports/platform-scaffolding-templates/` | — |
| **platform-inner-loop-evals** | `platform-inner-loop-evals.ts` | pre-PR local eval runners (DX-R2) | `imports/platform-inner-loop-evals/` | — |
| **platform-dx-metrics** | `platform-dx-metrics.ts` | TTSP + bypass DX metrics (DX-R3) | `imports/platform-dx-metrics/` | — |
| **rag-corpus-governance** | `rag-corpus-governance.ts` | RAG corpus owner/version/cadence (DG-M1) | `imports/rag-corpus-governance/` | — |
| **dataset-provenance-governance** | `dataset-provenance-governance.ts` | eval/fine-tune dataset cards (DG-M2) | `imports/dataset-provenance-governance/` | — |
| **feedback-promotion-governance** | `feedback-promotion-governance.ts` | feedback→durable promotion gates (DG-M3) | `imports/feedback-promotion-governance/` | — |
| **corpus-freshness-metrics** | `corpus-freshness-metrics.ts` | corpus freshness SLO + alerts (DG-R1) | `imports/corpus-freshness-metrics/` | — |
| **train-serve-skew-monitor** | `train-serve-skew-monitor.ts` | train/serve skew monitors (DG-R2) | `imports/train-serve-skew-monitor/` | — |
| **dataset-cards-registry** | `dataset-cards-registry.ts` | major dataset cards (DG-R3) | `imports/dataset-cards-registry/` | — |
| **model-payload-classification** | `model-payload-classification.ts` | AI payload classification (PRI-M1) | `imports/model-payload-classification/` | — |
| **model-payload-redaction** | `model-payload-redaction.ts` | pre-model tokenization/redaction (PRI-R1) | `imports/model-payload-redaction/` | — |
| **vendor-model-terms** | `vendor-model-terms.ts` | vendor DPA/terms review (PRI-R2) | `imports/vendor-model-terms/` | — |
| **ai-deletion-export** | `ai-deletion-export.ts` | AI memory/log deletion+export (PRI-M2) | `imports/ai-deletion-export/` | — |
| **ai-residency-routing** | `ai-residency-routing.ts` | residency routing (PRI-M3) | `imports/ai-residency-routing/` | — |
| **ai-dpia** | `ai-dpia.ts` | DPIA/PIA before production (PRI-R3) | `imports/ai-dpia/` | — |
| **memory-isolation** | `memory-isolation.ts` | memory tenant/user isolation (MEM-M1) | `imports/memory-isolation/` | — |
| **memory-retention** | `memory-retention.ts` | memory retention + TTL/deletion (MEM-M2) | `imports/memory-retention/` | — |
| **memory-write-policy** | `memory-write-policy.ts` | durable memory write policy (MEM-M3) | `imports/memory-write-policy/` | — |
| **memory-integrity** | `memory-integrity.ts` | critical memory integrity/signing (MEM-M4) | `imports/memory-integrity/` | — |
| **memory-poisoning-evals** | `memory-poisoning-evals.ts` | memory poisoning evals (MEM-R1) | `imports/memory-poisoning-evals/` | — |
| **memory-promotion-architecture** | `memory-promotion-architecture.ts` | working vs durable + promotion (MEM-R3) | `imports/memory-promotion-architecture/` | — |
| **ai-obligations-register** | `ai-obligations-register.ts` | AI obligations register (CMP-M1) | `imports/ai-obligations-register/` | — |
| **ai-control-evidence-matrix** | `ai-control-evidence-matrix.ts` | control→evidence matrix (CMP-M2) | `imports/ai-control-evidence-matrix/` | — |
| **ai-control-plane-audit-logs** | `ai-control-plane-audit-logs.ts` | control-plane audit retention (CMP-M3) | `imports/ai-control-plane-audit-logs/` | — |
| **ai-control-testing** | `ai-control-testing.ts` | control testing + exceptions (CMP-R1) | `imports/ai-control-testing/` | — |
| **ai-trust-documentation** | `ai-trust-documentation.ts` | customer trust doc (CMP-R2) | `imports/ai-trust-documentation/` | — |
| **ai-independent-assessment** | `ai-independent-assessment.ts` | Level-5 independent assessment (CMP-R3) | `imports/ai-independent-assessment/` | — |
| **ai-acceptable-use-policy** | `ai-acceptable-use-policy.ts` | AI acceptable-use policy (ORG-M1) | `imports/ai-acceptable-use-policy/` | — |
| **ai-domain-ownership** | `ai-domain-ownership.ts` | critical-domain owners (ORG-R2) | `imports/ai-domain-ownership/` | — |
| **ai-risk-acceptance** | `ai-risk-acceptance.ts` | control-gap waivers (ORG-R4) | `imports/ai-risk-acceptance/` | — |
| **ai-leadership-review** | `ai-leadership-review.ts` | leadership AI risk review (ORG-R1) | `imports/ai-leadership-review/` | — |
| **ai-improvement-backlog** | `ai-improvement-backlog.ts` | continual improvement backlog (ORG-R3) | `imports/ai-improvement-backlog/` | — |
| **ai-org-aprf-sampling** | `ai-org-aprf-sampling.ts` | org-wide APRF sampling (ORG-R5) | `imports/ai-org-aprf-sampling/` | — |

### AGN-M1 — agent charters

```bash
npm run aprf:agent-charters -- --target /path/to/app --out /path/to/app/aprf-assessment
# PASS unlock — complete inventory export (0 missing fields):
# imports/agent-charter-inventory/inventory.json
```

### AGN-M2 — agent loop limits

```bash
npm run aprf:agent-limits -- --target /path/to/app --out /path/to/app/aprf-assessment
# Optional PASS unlock — measured abort-on-exceed suite:
# imports/agent-loop-limits/suite.json
```

### AGN-M3 — agent kill switch

```bash
npm run aprf:agent-kill -- --target /path/to/app --out /path/to/app/aprf-assessment
# Optional PASS unlock — cancellation suite + ≤90-day drill:
# imports/agent-kill-switch/suite.json
```

### AGN-M4 — A2A peer auth

```bash
npm run aprf:a2a-auth -- --target /path/to/app --out /path/to/app/aprf-assessment
# Optional PASS unlock — 100% deny suite (unauth / forged / over-scoped):
# imports/a2a-peer-auth/suite.json
```

### AGN-R1 — goal-conflict plan policy

```bash
npm run aprf:agent-goal-policy -- --target /path/to/app --out /path/to/app/aprf-assessment
# Optional PASS unlock — synthetic conflict deny ≤90d:
# imports/agent-goal-policy/suite.json
```

### AGN-R2 — agent sandbox / simulation

```bash
npm run aprf:agent-sandbox -- --target /path/to/app --out /path/to/app/aprf-assessment
# Optional PASS unlock — linked sim ≤30 days before release:
# imports/agent-sandbox-sim/suite.json
```

### AGN-R3 — agent RACI ownership

```bash
npm run aprf:agent-raci -- --target /path/to/app --out /path/to/app/aprf-assessment
# Optional PASS unlock — register export with orphanCount=0:
# imports/agent-raci-ownership/register.json
```

### AUTHN-M1 — live auth probe

The Check requires an **automated auth probe report**, not code review alone.

```bash
# Start the target app yourself, then:
npm run aprf:collect -- \
  --plugins http-auth-probe \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment \
  --base-url http://127.0.0.1:8080
```

Writes `imports/http-auth-probe/auth-probe-report.json`. Every discovered AI route must return **401/403** without credentials for AUTHN-M1 to be satisfiable. If the app is not running, the collector returns `needs-user` and still emits a route catalog.

### AUTHN-M2 — MCP / S2S inventory

```bash
# Option A: live fetch with bearer token (do not commit)
export APRF_ADMIN_TOKEN='...'
npm run aprf:mcp-s2s -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment \
  --base-url http://127.0.0.1:8080 \
  --admin-token "$APRF_ADMIN_TOKEN"

# Option A2: live fetch via email/password sign-in (Open WebUI)
# Uses POST /api/v1/auths/signin → JWT; password is never written to reports.
export APRF_ADMIN_EMAIL='admin@example.com'
export APRF_ADMIN_PASSWORD='...'
npm run aprf:mcp-s2s -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment \
  --base-url http://127.0.0.1:8080 \
  --admin-email "$APRF_ADMIN_EMAIL" \
  --admin-password "$APRF_ADMIN_PASSWORD"

# Option B: drop a redacted export
mkdir -p ./aprf-assessment/imports/mcp-s2s-inventory
cp tool_servers.json ./aprf-assessment/imports/mcp-s2s-inventory/
npm run aprf:mcp-s2s -- --target /path/to/app --out ./aprf-assessment
```

Scores each connection: `auth_type=none` / static bearer keys fail; named OAuth/OIDC/mTLS pass. Writes `imports/mcp-s2s-inventory/mcp-s2s-inventory-report.json`.

### AUTHZ-M1 — Authz entry-point denial tests

```bash
npm run aprf:authz-tests -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Inventories AI routes, detects server-side guards, and scores whether tests assert 401/403 for those paths. Writes `imports/authz-entry-tests/authz-entry-report.json`. Code guards alone ≠ PASS.

### AUTHZ-M2 — Cross-tenant attack tests

```bash
npm run aprf:cross-tenant -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Looks for tenant isolation in code and scores cross-tenant attack tests (≥10 cases, 0 unauthorized successes). Writes `imports/cross-tenant-tests/cross-tenant-report.json`.

### SEC2-M1 — Secrets manager + secret scan

```bash
npm run aprf:secrets -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects secrets-manager refs, CI secret-scan config, and high-confidence embedded secrets (values never stored). PASS needs explicit coverage import (`privilegedSecrets…=0`, 100% resolve, prompts covered, measuredAt ≤90d) — empty SARIF alone ≠ clean scan. Writes `imports/secrets-hygiene/secrets-hygiene-report.json`.

### SEC2-M2 — Log/trace secret redaction

```bash
npm run aprf:secret-redaction -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects redaction config and canary tests; PASS needs non-empty `cases`/`results` at 100% detection (bare `detectionRatePct` alone ≠ PASS). Writes `imports/secret-redaction/secret-redaction-report.json`.

### SEC2-M3 — Provider/cloud key rotation + scope

```bash
npm run aprf:key-rotation-scope -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects key inventory, rotation/scope, and client-key risk signals; PASS needs inventory + 0 privileged client keys + 100% scope + 100% rotation (measuredAt ≤90d). Writes `imports/key-rotation-scope/key-rotation-scope-report.json`.

### SEC2-R1 — Pre-commit + CI secret scanning

```bash
npm run aprf:precommit-ci-secret-scan -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects pre-commit and CI secret-scan configs (root `gitleaks.toml` → PARTIAL); PASS needs both + prompt/fixture coverage + blocking + ≤7d green main/PR-merge scan with `measuredAt` (not `generatedAt`). Writes `imports/precommit-ci-secret-scan/precommit-ci-secret-scan-report.json`.

### SEC2-R2 — Credential egress controls

```bash
npm run aprf:credential-egress-controls -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects egress allowlist/policy for credential-holding runtimes; PASS needs allowlist + documented destinations + ≥1 deny event (measuredAt ≤90d). Writes `imports/credential-egress-controls/credential-egress-controls-report.json`.

### SEC2-R3 — Dataset secret/PII scan gate

```bash
npm run aprf:dataset-secret-scan-gate -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects dataset secret/PII scan gates before fine-tune/eval publish; PASS needs gate + blocking + 100% linked reports (measuredAt ≤90d). Writes `imports/dataset-secret-scan-gate/dataset-secret-scan-gate-report.json`.

### SCI-M1 — Artifact provenance / integrity

```bash
npm run aprf:artifact-provenance-integrity -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects cosign, Notation, SLSA, OCI provenance, model-checksum, and digest-pin signals; PASS needs verification + 100% verified pulls + blocked unverified (measuredAt ≤90d). Digest pins alone ≠ PASS but block N/A launder. Writes `imports/artifact-provenance-integrity/artifact-provenance-integrity-report.json`.

### SCI-M2 — External AI tool / MCP / plugin inventory

```bash
npm run aprf:ai-external-tool-inventory -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects MCP, agent-plugin, and tool-registry signals; PASS needs `entriesWithPinOwnerReviewPct=100` + `unpinnedLatestOrFloatingEntries=0` (measuredAt ≤90d). Writes `imports/ai-external-tool-inventory/ai-external-tool-inventory-report.json`.

### SCI-M3 — Vuln-scan promote gate

```bash
npm run aprf:ai-vuln-scan-gate -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects vuln-scan / model-serving / block-promote signals; PASS needs 100% coverage + critical block + 0 skipped + retained (measuredAt ≤90d). Writes `imports/ai-vuln-scan-gate/ai-vuln-scan-gate-report.json`.

### SCI-M4 — Deploy-path policy enforcement

```bash
npm run aprf:ai-deploy-policy-enforcement -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects admission / deploy-policy / cloud-gate signals; PASS needs enforced + unsigned/unapproved/revoked blocked (measuredAt ≤90d). Writes `imports/ai-deploy-policy-enforcement/ai-deploy-policy-enforcement-report.json`.

### SCI-R1 — Verify-on-deploy

```bash
npm run aprf:ai-verify-on-deploy -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects verify-on-deploy / unsigned-reject signals; PASS needs `lastDeployVerified` + `unsignedRejectedInTestOrCanary` (measuredAt ≤90d). Writes `imports/ai-verify-on-deploy/ai-verify-on-deploy-report.json`.

### SCI-R2 — Registry-linked model MBOM

```bash
npm run aprf:ai-model-mbom -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects MBOM / model-registry / SBOM signals; PASS needs 100% linked MBOM + retention ≥90d (measuredAt ≤90d). Container-only SBOM ≠ PASS. Writes `imports/ai-model-mbom/ai-model-mbom-report.json`.

### SEC-M1 — Injection / privilege-escalation policy gate

```bash
npm run aprf:injection-gate -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects server-side tool policy, injection corpora, and CI gates; PASS needs ≥95% deny rate. Writes `imports/injection-policy-gate/injection-policy-gate-report.json`.

Plugin YAML under `../plugins/` remains the contract; `executor` points here.

## Agent workflow

1. Run collectors → `evidence-graph.json`
2. Evaluate APRF Checks against the graph (`workflow.md`)
3. Ask user only for missing/weak evidence
