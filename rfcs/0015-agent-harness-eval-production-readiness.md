# APRF-RFC-0015: Agent, Harness, and Evaluation Production Readiness

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail |
| Created | 2026-11-13 |
| SemVer impact | MINOR |
| Index summary | Extends APRF 1.x with a versioned agent inventory, an evidence-backed capability graph, a small set of new Checks, Agents-lens applicability, and composed agent threats—without a new Agent profile, readiness scores, or Cognitive Assurance (COG). |

## Problem

APRF already gates tool-using agents through Core/Regulated plus `aprf-lens-agents` (charters, step budgets, tool mediation, human approval, kill switches). That is not the same as proving **which agents exist**, **what they can transitively do**, whether the **harness actually enforces** declared policy, or whether the organization has a **credible agent evaluation system**.

Gaps after Phase 0 (architecture assessment):

1. Inventory is charter-centric (`AGN-M1`) and does not merge declared / discovered / runtime-observed / independently verified agents with full operational attributes.
2. Evidence-graph edges are provenance-only and currently unused (`edges: []`). There is no Agent Capability Graph, so indirect MCP → tool → API → data access is invisible.
3. Checks already *require* runtime deny evidence, but there is no harness-integrity Check distinct from `HUM-M3` (approval bypass) and no first-class transitive confused-deputy Check.
4. Agents lens does not add durable-memory / retrieved-context Checks (`MEM-M2`, `MEM-M3`, `CTX-M2`); an agent with memory but without the RAG capability may only see Core `MEM-M1`.
5. Evaluation Checks cover suites, thresholds, and CI (`EVL-M1`/`M2`) but not independent task-success criteria, tool-use eval, or LLM-as-judge constraints.
6. Observability (`OBS-M1`) measures request→model→tool linkage coverage, not reconstructable agent-run attributes.
7. Reliability (`REL-M1`/`M3`) bounds retries and false-success but does not classify non-idempotent / irreversible tool replay.
8. Threat composition is a Shadow Agents pilot (`THR-shadow-agents` only).
9. Architectural invariant tests do not yet lock the gate/threat split, inferred-vs-behavioral floors, or “no duplicated Check-ID lists.”

This RFC must **not** invent a parallel agent standard, readiness percentages, eval quality scores, or RFC-0012 COG Checks.

## Proposal

### Non-goals (normative)

- No fourth production profile (`aprf-profile-agents`). Production claims remain Core or Regulated ∪ lenses.
- No `applicationCapabilities` named `agent_autonomy`, `agent_harness`, `agent_memory`, etc. That registry only maps product shape → **lenses**.
- No Check PASS/FAIL from graph traversal, threat exposure, collector success, or agent self-attestation alone.
- No `COG-*` IDs (RFC-0012 remains a future experimental extension).
- Do not reuse vacated Check IDs (`REL-M6`/`M7`/`M8` per [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md)).

### Binding Phase 0 decisions

| ID | Decision |
| --- | --- |
| D1 | Core/Regulated + existing Agents (and RAG/coding) lenses. |
| D2 | Applicability via capability graph + Check N/A, not new capability flags, except where a flag must change lens union (none required in this RFC). |
| D3 | Capability graph is **operational**; emits signals only. |
| D4 | Do not put capability relations on evidence-graph `rel` (closed enum: `supports` \| `contradicts` \| `derived-from` \| `implements`). Optional later: evidence-graph `derived-from` from graph artifacts to evidence nodes. |
| D5 | Few new Checks; reuse AGN/TOL/HUM/MEM/CTX/EVL/OBS/REL. |
| D6 | Inventory is an operational schema feeding `AGN-M1`, not a new Check family. |
| D7 | SignalDefs before `THR-*`. Only `behavioral`/`exercise` confirm threats. |
| D8 | Collectors stay in `skills/aprf-auditor`; CLI stays orchestration. |
| D9 | `resolveAssessmentTarget()` remains the only Check-ID selector. |
| D10 | RFC-0012 unused. |

### Coupling invariant (unchanged)

> Threats never participate in gate computation. Checks never participate in signal composition. The only coupling is that threats may cite Checks as mitigations.

Inferred graph paths **must not** silently satisfy Checks whose `evidencePolicy.minimumTier` or `acceptableEvidence` require behavioral/exercise evidence.

---

## 1. Agent inventory schema

**Authority (draft):** [`schemas/aprf-agent-inventory-0.1.json`](../schemas/aprf-agent-inventory-0.1.json)

**Runtime path (Phase 2):** `aprf-assessment/agent-inventory.json` (plus retained `history[]`).

**Reuse:** Extend [`agent-charter-inventory`](../skills/aprf-auditor/collectors/agent-charter-inventory.ts) and the existing charter template [`agent-charter.spec.yaml`](../skills/aprf-auditor/examples/agent-charter/agent-charter.spec.yaml). Do not create a second inventory plugin family.

### Discovery classes (orthogonal, multi-valued)

| Class | Meaning | Typical signal kind |
| --- | --- | --- |
| `declared` | Named in charter/manifest/CMDB | artifact / config |
| `discovered` | Found in code, deps, MCP/IaC without charter | artifact / config / inferred |
| `runtime-observed` | Seen in logs/traces/registry | behavioral |
| `independently-verified` | External/assessor pack corroborates existence | exercise / E5 |

Source-code heuristics **never** claim complete discovery. Completeness for `AGN-M1` still requires runtime registry, deployment manifest, CMDB, platform registry, or approved attestation (existing passCondition).

### Required record attributes

`agentId` (stable), name, agentVersion, framework, runtime, modelProvider, modelIdentifier, modelVersion, deploymentEnvironment, executionIdentity, owningApplication, owningTeam, purpose, autonomyClassification[], tools, mcpServers, connectedDataSources, memorySystems, humanApprovalRequired, executionEntryPoints, delegationCapabilities, configurationSource, lastObservedExecution, discovery.{classes,sources}, provenance[] (evidence-graph node ids).

Missing attributes are **empty/omitted**, not invented. Charter completeness remains `AGN-M1`; inventory presence of a row without charter fields is `agent.charter.absent` (existing).

### Provenance and freshness

Every record carries `provenance[]` with `evidenceNodeId`, collector identity/version, collection vs observation timestamps. Inventory `history[]` stores prior digests so assessments retain discovery history without rewriting evidence-graph schemaVersion 0.2.0.

---

## 2. Agent capability graph schema

**Authority (draft):** [`schemas/aprf-agent-capability-graph-0.1.json`](../schemas/aprf-agent-capability-graph-0.1.json)

**Runtime path (Phase 2):** `aprf-assessment/agent-capability-graph.json`

### Node types

Agent, Model, Tool, MCPServer, API, Database, MemoryStore, FileSystem, ExternalService, HumanApproval, ExecutionEnvironment, Identity, Secret, DataSource.

### Direct relations

`agent_uses_model`, `agent_invokes_tool`, `agent_connects_to_mcp`, `agent_reads_data`, `agent_writes_data`, `agent_delegates_to`, `agent_shares_memory`, `agent_assumes_identity`, `agent_accesses_secret`, `tool_invokes_api`, `tool_accesses_database`, `agent_executes_in`, `agent_requires_approval`.

Each edge: `accessKind` (`direct` \| `transitive` \| `delegated` \| `shared_credential` \| `cross_agent`), `signalKind`, `evidenceNodeIds` (min 1), optional confidence.

### Transitive analysis

`derivedPaths[]` materializes hops such as Agent → MCPServer → Tool → API → Database. **Default `signalKind` for a derived path is `inferred`** unless every constituent edge is `behavioral` or `exercise`. Inferred paths may **indicate** threats (`THR-confused-deputy-mcp`, etc.) but cannot confirm them and cannot meet E4/E5 Check floors.

Outputs for assessors (informative mappings, not gates): agent-to-tool, agent-to-data, delegation, high-risk paths.

---

## 3. Capability taxonomy (not applicationCapabilities)

Use these **only** as graph/applicability tags and documentation groupings. Do **not** add them to [`applicationCapabilities.ts`](../packages/framework-definition/src/applicationCapabilities.ts).

| Tag | Drives N/A / extra Checks |
| --- | --- |
| `agent_tools` | TOL-*; N/A if no tools |
| `agent_delegation` | AGN-M4; N/A if no handoffs |
| `agent_harness` | AGN-M5; N/A if no mediated tool/runtime (single-shot chat) |
| `agent_memory` | MEM-M2/M3, MEM-R1-as-lens-mandatory; N/A if no retained AI memory |
| `agent_evaluation` | EVL-M5; N/A if no production agent versions |
| `agent_observability` | OBS-M3; N/A if no production agent request path |
| `agent_recovery` | REL-M9; N/A if no non-idempotent/irreversible tools |

Existing `applicationCapabilities`: `agents`, `mcp-server`, `multi-agent-a2a` continue to select **`aprf-lens-agents`**. Finer N/A stays on Checks (e.g. AGN-M4 when no A2A). Do not split MCP into a new lens.

---

## 4. Check catalog

### 4.1 Existing Checks (reuse — do not duplicate)

| ID | Status | Role in this extension |
| --- | --- | --- |
| AGN-M1 | existing | Charter + inventory completeness; consume new inventory schema |
| AGN-M2 | existing | Step/time/delegation-depth budgets |
| AGN-M3 | existing | Kill/pause |
| AGN-M4 | existing | A2A auth + scoped capabilities |
| TOL-M1..M5 | existing | Server-side authz, allowlist, high-impact gates, schema, signed MCP catalogs |
| HUM-M1..M4 | existing | Approval inventory, logs, alternate-path bypass, dual control (M4 regulated) |
| INF-M3 | existing | Authorized dependencies / egress |
| MEM-M1 | existing Core | Tenant/user isolation attack suite |
| MEM-M2, MEM-M3 | existing | Retention/deletion; write policy — **add to Agents lens** |
| MEM-M4 | existing regulated | Memory integrity |
| MEM-R1 | existing recommended | Poisoning suite — **Agents lens additional mandatory** (YAML `gate` stays recommended; assess treats lens IDs as mandatory) |
| CTX-M2 | existing | Retrieved/tool content labeled + access-checked — **add to Agents lens** |
| CTX-M1, CTX-M3 | existing | Size/priority; sensitive inclusion — remain RAG-lens / catalog |
| EVL-M1, EVL-M2 | existing Core | Offline suites + numeric release gates |
| EVL-M3, EVL-M4 | existing | Online signals; shadow cutover (M4 regulated) |
| EVL-R1 | existing recommended | Distinct regression/adversarial/shift tracks — **Agents lens additional mandatory** |
| OBS-M1, OBS-M2 | existing | Trace linkage %; sensitive redaction |
| REL-M1, REL-M3 | existing | Timeouts/retries; partial-failure false-success |
| SEC-M1 | existing | Injection must not authorize privileged tools |
| AUTHN-M2, AUTHZ-M3 | existing | MCP/S2S identity; least-privilege agent roles |
| COST-M3 | existing | Loop spend amplification |

Lens mechanism: [`assess.ts`](../packages/aprf/src/assess.ts) sets `gate: mandatory` when `checkId ∈ effectiveCheckIds`, independent of YAML `gate`. Putting `MEM-R1` / `EVL-R1` on the Agents lens is the intended way to raise them for agent product shapes **without** promoting them for all Core chatbots.

### 4.2 Proposed new Checks

IDs confirmed unused in the 178-Check catalog. Do not use vacated `REL-M6`.

Each Check: hybrid detection, `minimumTier` E4 where enforcement/exercise is required, N/A with a formal applicability reason, missing evidence → `NOT_DEMONSTRATED` (blocker if in the effective set).

---

#### AGN-M5 — Harness integrity (proposed, **new**)

| Field | Value |
| --- | --- |
| **Proposed ID** | `AGN-M5` (new) |
| **Requirement** | Every production tool/MCP/side-effect path used by in-scope agents SHALL execute only through the declared harness (gateway, middleware, or runtime policy engine). Alternate entry points SHALL be denied. |
| **Rationale** | Distinct from HUM-M3 (approval bypass) and TOL-M1 (per-call authz when the call hits the gateway). A correct gateway is useless if agents or operators can invoke tools beside it. |
| **Severity** | critical |
| **Mandatory** | YAML `gate: mandatory`; **Agents lens** additional ID (not Core — single-shot chat without a tool harness is N/A) |
| **Applicability** | Production agents/workloads that invoke tools or MCP. N/A if no tool/MCP side effects (document reason). |
| **Evidence required** | Entry-point inventory; harness/middleware config; exercise results for: direct tool invocation outside harness, disabled/missing middleware, unauthorized dynamic tool registration, inconsistent enforcement across entry points (`measuredAt` ≤90d) |
| **Verification** | Exercise: unregistered tool, out-of-band invoke, policy-disabled path, tool substitution/spoofing — 100% deny. Config/docs alone → below floor (PARTIAL). |
| **Failure** | Any successful out-of-band side effect, or no exercise pack. |
| **Remediation** | Fail-closed unique execution path; disable raw SDK tool calls in production identities; register all entry points. |

---

#### TOL-M6 — Transitive tool and data access (proposed, **new**)

| Field | Value |
| --- | --- |
| **Proposed ID** | `TOL-M6` (new) |
| **Requirement** | Effective (including transitive and delegated) data/API access of each production agent SHALL be inventoried from the capability graph and SHALL NOT exceed the charter data scope. Unauthorized effective paths SHALL be denied in exercise. |
| **Rationale** | TOL-M2 allowlists declared tools; they do not prove Agent → MCP → Tool → Internal API → Customer DB is in charter. Graph is evidence, not the gate. |
| **Severity** | critical |
| **Mandatory** | YAML mandatory; Agents lens |
| **Applicability** | Agents with tools, MCP, or delegation. N/A if no tools/MCP/delegation. |
| **Evidence required** | Capability graph with provenance; charter data-scope mapping; exercise or reachability deny on at least one unauthorized transitive path per high-risk class present (`measuredAt` ≤90d) |
| **Verification** | Direct edges may be config/artifact. **PASS requires** exercise/behavioral deny on unauthorized transitive paths. Graph-only or inferred-only paths indicate threat; they do not PASS. |
| **Failure** | Unchartered high-risk derived path without deny evidence; graph missing with tools present → NOT_DEMONSTRATED. |
| **Remediation** | Narrow MCP/tool grants; charter the effective scope; add deny tests on data stores. |

---

#### HUM-M5 — Approval replay and self-approval resistance (proposed, **new**)

| Field | Value |
| --- | --- |
| **Proposed ID** | `HUM-M5` (new) |
| **Requirement** | Human approval for high-impact actions SHALL be bound to actor, action, arguments, expiry, and a non-replayable token. The agent (or its identity) SHALL NOT approve its own restricted action. |
| **Rationale** | HUM-M2 is audit logging; HUM-M3 is alternate-path bypass. Neither requires replay protection, expiry, or separation of duties against self-approval. |
| **Severity** | critical |
| **Mandatory** | YAML mandatory; Agents lens (N/A if HUM-M1 N/A) |
| **Applicability** | Same surface as HUM-M1. N/A if no high-impact actions. |
| **Evidence required** | Approval token/schema; SoD policy; exercise: replayed approval denied, expired approval denied, agent-identity self-approval denied (`measuredAt` ≤90d) |
| **Verification** | Exercise suite; attestation alone cannot PASS (minimumTier E4). |
| **Failure** | Successful replay or self-approval; missing suite. |
| **Remediation** | Nonce + expiry; distinct human IdP; bind args hash to token. |

---

#### EVL-M5 — Agent evaluation methodology and tool-use cases (proposed, **new**)

| Field | Value |
| --- | --- |
| **Proposed ID** | `EVL-M5` (new) |
| **Requirement** | Each production agent version SHALL be linked to versioned eval datasets and runs covering: independently verifiable task-success criteria (not agent self-report); tool-use correctness (selection, args, order, unauthorized attempts); and, where model-based judging is used, an explicit rubric, versioned judge prompt, model id, calibration/human sample, and **prohibition** of LLM-as-judge as the sole evidence for access-control or security enforcement. |
| **Rationale** | EVL-M1/M2 prove suites and numeric gates exist. They do not prove agent-specific methodology. No overall eval score. |
| **Severity** | high |
| **Mandatory** | YAML mandatory; Agents lens (not Core chatbots without agents) |
| **Applicability** | Production agent versions. N/A if no production agents (AGN-M1 N/A). |
| **Evidence required** | Dataset manifests with versions/owners/provenance; run reports tied to agentVersion; tool-use cases; if LLM-judge used: rubric pack + human sample; security/authz cases MUST use deterministic/schema/exercise oracles |
| **Verification** | Artifact + process (CI) for linkage; security cases require exercise/deterministic — inferred/LLM-judge-only → PARTIAL/FAIL. |
| **Failure** | Success = agent self-report; no versioned datasets; security evals only LLM-judge; no tool-use cases when tools exist. |
| **Remediation** | Version datasets; independent oracles; split security vs quality judges. |

---

#### OBS-M3 — Reconstructable agent-run traces (proposed, **new**)

| Field | Value |
| --- | --- |
| **Proposed ID** | `OBS-M3` (new) |
| **Requirement** | Sampled production (or canary) traces SHALL allow reconstruction of an agent run without unnecessary sensitive prompt/customer payload: agent ID, agent version, run ID, parent run ID, model identifier, prompt/config version, tool invocation, tool args (redacted per OBS-M2), tool results (redacted), authorization decision, human approval ref, memory retrieval ref, duration, token consumption, error, termination reason. |
| **Rationale** | OBS-M1 is linkage coverage %. Do not rewrite OBS-M1 (Core compatibility). Additive Check. |
| **Severity** | high |
| **Mandatory** | YAML mandatory; Agents lens |
| **Applicability** | Production agent request path. N/A if OBS-M1 N/A. |
| **Evidence required** | Trace schema/convention; canary/sampled traces (`measuredAt` ≤90d) showing required attributes present on ≥95% of in-scope canary runs; redaction consistent with OBS-M2 |
| **Verification** | Behavioral/import traces, not config-only. |
| **Failure** | Cannot reconstruct run; missing authz/approval/termination fields on tool-using agents. |
| **Remediation** | Semantic conventions on agent spans; drop raw prompts in default retention. |

---

#### REL-M9 — Non-idempotent and irreversible tool replay safeguards (proposed, **new**)

| Field | Value |
| --- | --- |
| **Proposed ID** | `REL-M9` (new; skip vacated REL-M6/M7/M8) |
| **Requirement** | The harness SHALL classify in-scope tools as read-only, idempotent, non-idempotent, or irreversible. Retries, recovery, and workflow resume SHALL NOT repeat non-idempotent or irreversible actions without an idempotency key, compensation, or human approval. |
| **Rationale** | REL-M1 requires bounded retries; REL-M3 forbids false-success. Neither stops duplicate payments on retry. |
| **Severity** | high |
| **Mandatory** | YAML mandatory; Agents lens |
| **Applicability** | Tool-using agents. N/A if all tools are read-only/idempotent (must be classified in evidence). |
| **Evidence required** | Classification inventory; retry/resume policy; exercise: duplicate non-idempotent call does not commit twice, or is detected/compensated (`measuredAt` ≤90d) |
| **Verification** | Exercise on at least each irreversible/non-idempotent class present. |
| **Failure** | Unclassified side-effect tools; successful duplicate commit in test. |
| **Remediation** | Idempotency keys; outbox; disable auto-retry on irreversible tools. |

---

### 4.3 Explicitly not proposed as new Checks

| Topic | Handling |
| --- | --- |
| Isolation/sandbox | INF-M3, AGN-R2, coding INF-M2; import/exercise packs — no INF-M5 unless Phase 2 shows a hole after AGN-M5 |
| Loop/token/time budgets | AGN-M2, COST-M3 |
| Kill switch | AGN-M3 |
| Memory isolation/deletion/write | MEM-M1..M3; poisoning via MEM-R1 on Agents lens |
| Context overflow / instruction isolation | CTX-M1, CTX-M2, CTX-R3 (remain recommended except CTX-M2 on Agents lens) |
| Eval release CI | EVL-M1/M2; adversarial tracks EVL-R1 on Agents lens |
| LLM-as-judge exclusive for authz | Folded into EVL-M5 |
| Agent identity/credential lifecycle | AUTHN-M2, AUTHZ-M3, existing secrets Checks |
| Readiness %, eval scores, maturity composites | Forbidden |

---

## 5. Profile and lens impact

### Profiles

| Profile | Change |
| --- | --- |
| `aprf-profile-core` | **No new IDs** (backward compatible Core gate) |
| `aprf-profile-regulated` | **No new IDs** (inherits Core; new agent Checks arrive via Agents lens) |
| `aprf-profile-framework` | **No new IDs** (SDK primitives unchanged) |

### `aprf-lens-agents` additional IDs (additive)

Existing lens IDs remain. **Add:**

`AGN-M5`, `TOL-M6`, `HUM-M5`, `EVL-M5`, `OBS-M3`, `REL-M9`, `MEM-M2`, `MEM-M3`, `CTX-M2`, `MEM-R1`, `EVL-R1`

N/A remains collector/attestation-driven with a written reason (existing pattern). Example: no durable memory → MEM-M2/M3/MEM-R1 `NOT_APPLICABLE`; no A2A → AGN-M4 N/A; no high-impact actions → HUM-* N/A.

### Other lenses

- **RAG:** unchanged; overlap with MEM/CTX is fine (union).
- **Coding:** unchanged; coding agents that also set `agents` get Agents lens via capabilities.
- **Voice:** unchanged.

### Integrity / stats

Phase 2 must update [`lenses.ts`](../packages/framework-definition/src/lenses.ts), `spec/aprf-spec.json` lens lists, `npm run aprf:sync-stats`, and framework-definition self-test expected union counts (Core remains 39 mandatories; the union of additional IDs across all four lenses brings `lensCheckCount` to 58, while the Agents lens alone has 29 IDs).

---

## 6. Evidence mapping

### New evidence type IDs (proposed for `spec/evidence-types.yaml` in Phase 2)

| ID | Default tier | Use |
| --- | --- | --- |
| `agent_inventory_record` | E2/E3 | Normalized inventory row |
| `agent_capability_graph` | E2 | Graph artifact (inferred paths stay inferred) |
| `harness_exercise_report` | E4 | AGN-M5 / HUM-M5 / TOL-M6 deny suites |
| `eval_dataset_manifest` | E2 | Versioned datasets |
| `eval_run_report` | E3/E4 | CI/process run tied to agentVersion |
| `agent_trace_sample` | E4 | OBS-M3 canary traces |
| `idempotency_exercise_report` | E4 | REL-M9 |

Existing types continue: `repo_signal`, `cloud_configuration`, `application_logs`, `reachability_probe`, `connectivity_deny_probe`, `self_attestation`, `independent_assessment`.

### Collection vs Check success

| State | Control status |
| --- | --- |
| Not discovered / not collected | NOT_DEMONSTRATED |
| Formally N/A with reason | NOT_APPLICABLE |
| Stale (`measuredAt` >90d) | PARTIAL or fail freshness in passCondition |
| Invalid / contradictory | FAIL or PARTIAL (worse hint wins) |
| Collector `status: ran` with no metrics | not PASS |
| Inferred graph only | cannot meet E4 Checks |

---

## 7. Signal generation design

Expand [`spec/aprf-signal-registry.yaml`](../spec/aprf-signal-registry.yaml) in Phase 2. **Do not change `kind` on existing ids.** Dual-emit with legacy tags during migration.

### Proposed SignalDefs (kind in parentheses)

**Inventory / graph**

- `agent.inventory.normalized` (artifact)
- `agent.discovery.runtime_observed` (behavioral)
- `agent.discovery.unverified_only` (inferred)
- `agent.graph.edge_direct` (config)
- `agent.graph.path_transitive` (inferred)
- `agent.graph.path_transitive_exercised` (exercise)

**Harness / tools / MCP**

- `harness.bypass.attempt_denied` (exercise)
- `harness.bypass.attempt_succeeded` (exercise)
- `harness.out_of_band.invoke` (behavioral)
- `mcp.confused_deputy.path` (inferred)
- `tool.unauthorized.denied` (exercise)
- `tool.dynamic_register.denied` (exercise)

**Approval**

- `approval.replay.denied` (exercise)
- `approval.self.denied` (exercise)
- `approval.replay.succeeded` (exercise)

**Memory / eval / obs / recovery**

- `memory.poisoning.case_fail` (exercise) — existing MEM-R1 collectors
- `eval.dataset.versioned` (artifact)
- `eval.security.llm_judge_only` (artifact) — indicates methodology gap
- `eval.run.linked_to_agent_version` (process)
- `obs.agent_run.attributes_complete` (behavioral)
- `rel.non_idempotent.duplicate_commit` (exercise)

Existing `agent.*` Shadow Agents signals remain the vocabulary for `THR-shadow-agents`.

Collectors emit registered ids on `EvidenceNode.signals[]`; assess continues to use `collectSignalObservationsFromGraph`. Graph builder may also write observations from `agent-capability-graph.json` **without** using Check statuses as inputs.

---

## 8. Threat scenario catalog (informative)

Add to [`spec/aprf-threat-composition.yaml`](../spec/aprf-threat-composition.yaml) in Phase 2. Confirmation still requires a contributing `behavioral` or `exercise` observation.

| Threat ID | Preconditions / path | Primary mitigation Checks | Supporting |
| --- | --- | --- | --- |
| THR-shadow-agents | existing | AGN-M1 | AGN-M2, AGN-M3 |
| THR-excessive-tool-privileges | broad allowlist + high-impact tools | TOL-M2, TOL-M3 | AUTHZ-M3, TOL-M6 |
| THR-confused-deputy-mcp | MCP hop to data store outside charter | TOL-M6 | TOL-M1, AGN-M1, INF-M3 |
| THR-injection-tool-exec | injection + tool invoke | SEC-M1, TOL-M1 | CTX-M2, AGN-M5 |
| THR-delegated-privilege-escalation | A2A/delegation broader than peer scope | AGN-M4 | AUTHZ-M3, TOL-M6 |
| THR-memory-poisoning | writable shared/durable memory | MEM-M3, MEM-R1 (lens-mandatory) | MEM-M1, SEC-M1 |
| THR-cross-tenant-memory | isolation fail | MEM-M1 | PRI-M1 |
| THR-harness-bypass | out-of-band tool path | AGN-M5 | HUM-M3, TOL-M1 |
| THR-agent-resource-exhaustion | unbounded loop | AGN-M2, COST-M3 | AGN-M3 |
| THR-tool-exfiltration | tool/egress to unchartered dest | TOL-M6, INF-M3, SEC-M1 | OBS-M3 |
| THR-approval-bypass | replay/self-approve/alt path | HUM-M3, HUM-M5 | HUM-M1 |
| THR-malicious-tool-result | poisoned tool output → downstream agent | AGN-M4, CTX-M2, EVL-M5 | TOL-M4 |
| THR-untrusted-a2a | unauthenticated peer | AGN-M4 | AUTHN-M2 |

A passing Check **does not** suppress a threat if indicators still fire (existing evaluator: `threatMitigated` only when **all primary** mitigations are PASS/N/A). Keep at least one primary that truly mitigates; do not list every related Check as primary.

---

## 9. Collector implementation plan (Phase 2 — not this RFC’s code)

Stay on the existing plugin contract ([`plugins/_contract.yaml`](../skills/aprf-auditor/plugins/_contract.yaml)). `mapsToChecks` generated into `plugin-check-map.json`. No business logic in CLI.

| Plugin (proposed id) | Role | Maps (approx.) | Reuse |
| --- | --- | --- | --- |
| `agent-charter-inventory` | Extend to emit normalized inventory + discovery classes | AGN-M1 | existing |
| `mcp-s2s-inventory`, `tool-allowlist`, `ai-external-tool-inventory` | Feed graph Tool/MCP/API nodes | TOL-*, AUTHN-M2 | existing |
| `agent-capability-graph` | **New** builder: merge inventory + MCP + IaC + optional trace imports; write graph JSON; emit path signals | TOL-M6 (hints only; exercises via import) | new |
| `harness-integrity` | **New** ingest `imports/harness-integrity/` exercise packs | AGN-M5 | new |
| `approval-replay` | **New** ingest | HUM-M5 | new; alongside existing approval collectors |
| `eval-methodology` | **New** dataset/run/judge rubric ingest | EVL-M5 | alongside `eval-suite-ci`, `eval-release-gates` |
| `agent-trace-attributes` | **New** / extend `otel` | OBS-M3 | `otel` remains OBS-M1 |
| `non-idempotent-retry` | **New** ingest | REL-M9 | alongside `ai-partial-tool-failure` |
| memory/eval existing | Unchanged plugins; lens now scores MEM-R1/EVL-R1 when Agents selected | MEM-R1, EVL-R1 | existing |

CLI `audit` already scopes plugins via `pluginsForCheckIds(effectiveCheckIds)` — new maps pick them up after `gen-plugin-map`.

Auditor skill: summarize inventory, graph capabilities, applicable Checks, PASS/FAIL/N/A reasons, missing evidence, threat exposure, remediation. **Do not** embed Check-ID lists in SKILL.md; point at `resolveAssessmentTarget` / report.

---

## 10. Test strategy

### A. Unit

Inventory normalization; discovery-class merge; graph edge creation; transitive path `signalKind=inferred` unless exercised; signal emission; provenance required; N/A reason required; Check evaluation fixtures for new IDs; threat composition fixtures; freshness; contradictory evidence (worse hint).

### B. Integration

Code/config/trace/eval-report → inventory/graph → signals → formal Checks; framework-definition union counts → CLI assess; existing Core without Agents lens **unchanged** blocker set.

### C. Adversarial (import fixtures)

Hidden agent; post-init tool registration; harness bypass; indirect DB access; cross-tenant memory; retrieved-doc injection; malicious tool output; delegation escalation; approval replay; infinite loop (AGN-M2); duplicate non-idempotent action; fabricated eval report (must not PASS EVL-M5).

### D. Architectural invariant tests (mandatory)

Implement in Phase 2 as named tests (engine `test-threat-composition.ts`, `packages/aprf/scripts/smoke.ts`, new `scripts/check-agent-extension-invariants.ts` as needed):

1. Mutating `threatExposure` cannot change `overallGatePassed` / control statuses.
2. Check statuses are not inputs to `evaluateThreatComposition` indicators (only mitigations lookup).
3. Missing evidence cannot yield PASS (no hint → NOT_DEMONSTRATED).
4. Inferred-only observations cannot satisfy a Check with `minimumTier` E4 or `acceptableEvidence` limited to exercise/runtime types.
5. N/A requires a collector/import reason (reject empty N/A).
6. Profile/lens selectors live only in `framework-definition` (+ spec mirror via integrity).
7. CLI and auditor skill contain no duplicated normative Check-ID arrays (grep/integrity).
8. Agent self-attestation (`class: user` / attested signals) cannot establish independent verification (E5) or confirming threat status.
9. Collector `status: ran` without pass metrics ≠ Check PASS.
10. PASS on a primary mitigation Check does not delete fired threat indicators; status may become `mitigated` but composition still recorded; supporting-only PASS does not clear exposure.

Do **not** weaken existing collector smokes or integrity tests.

Phase 3: `npm run validate`, typecheck, lint, unit, integration, invariants, full APRF regression.

---

## Alternatives considered

1. **New Agent profile** — Duplicates Core ∪ Agents lens; breaks “profiles = gate kinds.” Rejected (D1).
2. **New applicationCapabilities per harness/memory/eval** — Wrong layer; would force lens explosion. Rejected (D2).
3. **Capability relations on evidence-graph `rel`** — Breaking closed enum; mixes provenance with authorization topology. Rejected (D4).
4. **Rewrite OBS-M1 / REL-M1 instead of OBS-M3 / REL-M9** — Changes Core semantics for non-agent apps. Rejected for backward compatibility.
5. **Promote MEM-R1/EVL-R1 to YAML `gate: mandatory` globally** — Would hit Core chatbots without agents. Rejected; lens additional IDs instead.
6. **Implement COG now** — Out of scope (RFC-0012).

## Compatibility

- New Checks are **additive** (MINOR).
- Existing Check IDs and Core/Regulated lists unchanged.
- New Agents-lens IDs change Core+`agents` effective set (expected; document in CHANGELOG when implemented).
- Inventory and capability-graph schemas are compiled in `aprf:agent-invariants` (`npm run validate`).
- Dual-emit signals until unknown `signalId` hard-fail (RFC-0014 migration).

## Security considerations

- Inventory and traces will contain tool args and data-store names — retain OBS-M2 redaction; default excerpts redacted in collectors.
- Graph inferred paths can over-claim access; kind=`inferred` prevents silent confirmation and E4 PASS.
- Exercise packs must not be production-destructive; document dry-run for irreversible tools (TOL-R1 remains recommended).

## Open questions

1. Should `HUM-M5` apply whenever HUM-M1 applies even without the Agents lens (Core already has HUM-M1/M3)? **Proposal:** Agents lens only in v1; revisit if non-agent apps show replay bugs.
2. Hard-fail unknown signal IDs in the same MINOR as this RFC, or keep warn? **Proposal:** keep warn until dual-emit covers new ids, then fail (RFC-0014).
3. Persist inventory history in-repo vs only under `aprf-assessment/`? **Proposal:** assessment outputs + optional import of previous `agent-inventory.json`.
4. Framework/SDK assessments: AGN-M5 N/A by existing framework claim rules (lenses ignored for `ai-framework`). Confirm in Phase 2 self-test.

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted (or N/A) — new Checks get threat-map + crosswalk rows in Phase 2; no peer-framework requirement in this draft
- [x] Security / safety considered
- [x] Open questions listed

## Implementation sequence (after this RFC is accepted)

Phase 2: inventory + graph schemas wired, collectors, SignalDefs, THR-* rows, Check YAML, Agents lens, plugin maps, auditor copy that points at resolver.

Phase 3: validate + invariant tests + regression.

Phase 4: ARCHITECTURE.md, check docs, evidence specs, collector docs, examples, CHANGELOG (implementation notes).

**Status:** accepted. Catalog YAML, Agents-lens IDs, SignalDefs, composed threats, and reference collectors ship in the same change set.
