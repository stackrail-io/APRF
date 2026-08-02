# APRF Changelog

All notable changes to the AI Production Readiness Framework are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is SemVer
(`APRF_GOVERNANCE.version`). JSON Schema path versions (`spec-schema/0.7`,
`attestation-schema/0.6`) are independent — see `governance.schemaVersioning`.

## [Unreleased]

### Changed
- Rewrote **tool-safety** **TOL-M1**–**TOL-M5** and **TOL-R1**–**TOL-R2** (hybrid; measuredAt ≤90d; N/A when out of scope; cleared `technologies`; synced `aprf-spec.json`) and collectors (`tool-gateway-authz`, `tool-allowlist`, `high-impact-tool-gates`, `tool-argument-schema`, `signed-tool-catalog`, `destructive-tool-dry-run`, `tool-rate-limits`): **M1** server-side per-call authz with 100% path coverage + deny + no model-output bypass (not entry-point allowlists); **M2** `agentsInventoriedPct=100` + allowlist 100% + unknown-tool deny + runtime invent-reject (deny suite without inventory ≠ PASS); **M3** `highImpactToolsInventoriedPct=100` + gates 100% + ungated impossible (bypass suite without inventory ≠ PASS; shared inventory key with **R2**); **M4** tool inventory 100% + argument schema 100% + contract reject 100% (reject suite without inventory ≠ PASS); **M5** Level-5 catalog inventory 100% + reject-unsigned + review ≤90d (reject/review without inventory ≠ PASS); **R1** destructive-tool inventory 100% + dry-run non-prod 100% + promotion evidence ≤90d (promotion without inventory ≠ PASS); **R2** `highImpactToolsInventoriedPct=100` + per-tool rate + blast budgets 100% + ≤30d enforcement (enforcement without inventory ≠ PASS). **Importer note:** TOL PASS imports now require these inventory/coverage fields; older two-field PASS payloads become PARTIAL/FAIL.
- Rewrote **supply-chain** **SCI-M1**–**SCI-M4** and **SCI-R1**–**SCI-R2** (hybrid; measuredAt ≤90d; N/A when out of scope; cleared `technologies`; synced `aprf-spec.json`) and collectors (`artifact-provenance-integrity`, `ai-external-tool-inventory`, `ai-vuln-scan-gate`, `ai-deploy-policy-enforcement`, `ai-verify-on-deploy`, `ai-model-mbom`): **M1** provenance/integrity verify+block (`repo-artifact-provenance-integrity`; no vacuous PASS from digest pins); **M2** external AI tool / MCP / plugin / integration inventory+pin+review ≤180d (`repo-ai-external-tool-inventory`); **M3** vuln-scan gates for deps, containers/serverless, and model-serving runtimes with org-policy critical block (not hardcoded CVSS ≥9; `repo-ai-vuln-scan-gate`); **M4** Level-5 deploy-path policy blocking unsigned/unapproved/revoked artifacts—not K8s-only (`repo-ai-deploy-policy-enforcement`; regulated/`requiredFromLevel: 5`); **R1** Level-4 verify-on-deploy (`repo-ai-verify-on-deploy`); **R2** registry-linked MBOM per model pin (`repo-ai-model-mbom`; container-only SBOM insufficient).
- Rewrote **secrets** + collectors; synced `aprf-spec.json`.
- Rewrote **infrastructure** **INF-M1**–**INF-M4** (hybrid; inventory-gated PASS; measuredAt ≤90d; sibling distinctions; cleared `technologies`) and collectors (`ai-public-exposure-scan`, `ai-runtime-patching`, `agent-tool-connectivity`, `shared-accelerator-isolation`); M1 private-only path; M2 org-documented SLA (not fixed 14d); M3 vs SEC-M4 sharpened; M4 N/A for managed-API/CPU-only/single-tenant/dedicated GPU; synced `aprf-spec.json`.
- Rewrote **infrastructure** **INF-R3** (manual IaC + CIS-aligned policy checks with N/A + measuredAt ≤90d); cleaned deprecated **INF-R1** stub toward SCI-R1; cleared `technologies`; synced `aprf-spec.json`.
- Added CI gate `npm run aprf:collectors:unused` (TypeScript `noUnusedLocals`/`noUnusedParameters` + path-sensitive useless non-nullish initializers) so collector dead defaults like `statusHint = "not_demonstrated"` fail the build; removed those dead initializers across collectors.
- Rewrote **authorization** + collectors; synced `aprf-spec.json`.
- Added **AUTHN-M3** to Core and Regulated profiles (core 38→39, regulated 50→51); aligned AUTHN-M1/M2/M3 `passCondition` N/A clauses and AUTHN-R2 sample-call requirement with collectors; tightened AUTHN-M2 sibling distinction vs M4/R2; reduced AUTHN-R1↔SEC2-M1 substitute risk in evidence-map + SEC2-M1 FP guidance; minor consistency (http-auth-probe `detectorIds`, M1 advisory-GET wording, R1 30d vs 90d exception windows, relatedRules / M3–M4 sibling prose).
- Fixed Bugbot findings on authentication collectors: documented-service subjects no longer counted as anonymous hops (AUTHN-M4); FastAPI route-cap truncation blocks catalog PASS; prior auth-probe ingest requires `probeInventoryMatchesRouteCatalog`; AUTHN-R1 honors `ownedExceptionsWithin30Days=false`.
- Fixed follow-up Bugbot findings: conservative multi-file import merges for AUTHN-M3/M4/R1/R2; AUTHN-R2 requires imported `sampleAuthenticatedCallsPresent`; evaluate alternate `probe*.json` reports; pass `assessedAt` into `measuredAtFresh`.
- Fixed more Bugbot findings: AUTHN-M1/M2 scope imports use mergeOrBool (true wins); catalog match requires path/method set coverage; AUTHN-M2 keeps oldest measuredAt across imports.
- Fixed Bugbot findings: live MCP fetch no longer launders stale import measuredAt; runtime/connection inventory clears a prior N/A present=false; drop unused http-auth-probe import.
- Fixed Bugbot findings: AUTHN-M2 fails OAuth/OIDC connections that still embed a static key; AUTHN-M4 does not double-count anonymous hops when a file has both a scalar and samples.
- Rewrote **authentication** **AUTHN-R2** (hybrid workload identity for self-hosted model runtimes; `workload-identity-runtimes` collector + measuredAt ≤90d; N/A when no self-hosted runtimes); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **authentication** **AUTHN-R1** (hybrid short-lived agent/tool credentials + 0 long-lived static keys in prompts; `short-lived-agent-tokens` collector + measuredAt ≤90d; replaced mismatched `mcp-no-secrets-in-env`/`secrets-not-embedded` detectors); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **authentication** **AUTHN-M4** (hybrid AI-native identity propagation through agent/tool/workflow chains; `identity-propagation` collector + measuredAt ≤90d; N/A when no tools/agents/workflows/delegated actions); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **authentication** **AUTHN-M3** (hybrid AI control-plane admin MFA + bounded monitored break-glass; `ai-admin-mfa` collector + measuredAt ≤90d; N/A via `aiControlPlaneAdminAccessPresent=false`); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **authentication** **AUTHN-M2** (hybrid MCP/AI S2S machine-identity inventory; aligned with `mcp-s2s-inventory` + measuredAt ≤90d; empty inventory no longer vacuous PASS — explicit `productionMcpOrAiS2sConnectionsPresent=false` for N/A); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **authentication** **AUTHN-M1** (hybrid unauthenticated probe of customer-facing AI HTTP/RPC routes; aligned with `http-auth-probe` + measuredAt ≤90d; explicit N/A via `customerFacingAiHttpApisPresent=false`); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **ai-security** **SEC-R2** (hybrid multimodal pre-ingest content-safety/malware scan; `multimodal-input-scan` collector + measuredAt ≤90d); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **ai-security** **SEC-R1** (hybrid multi-turn + indirect RAG/MCP injection red-team; `multi-turn-indirect-injection-redteam` collector + measuredAt ≤90d); cleared `technologies`; synced `aprf-spec.json`.
- Demoted **ai-security** former **SEC-M5 → SEC-R3** (recommended exfiltration detection for sensitive AI contexts; canaries optional among DLP/SIEM/UEBA/equivalents) per [APRF-RFC-0009](rfcs/0009-adversarial-security-sec-m5-to-recommended.md) (regulated 51→50, tier3-only 13→12); vacated `SEC-M5`; synced `aprf-spec.json`.
- Rewrote **ai-security** **SEC-M4** (hybrid model-path egress/trust boundary; `model-path-egress-boundary` collector + measuredAt ≤90d; distinct from INF-M3); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **ai-security** **SEC-M3** (hybrid abuse/jailbreak/injection release gate; `abuse-injection-release-gate` collector + measuredAt ≤90d); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **ai-security** **SEC-M2** (hybrid high-risk output schema/policy gate before side effects; `high-risk-output-gate` collector + measuredAt ≤90d); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **ai-security** **SEC-M1** (hybrid injection/privilege-escalation policy gate; aligned with `injection-policy-gate` collector + measuredAt ≤90d); cleared `technologies`; synced `aprf-spec.json`.
- Reframed **SAF-M1** around a **domain-specific AI safety policy** (harm categories + refuse/escalate as policy contents, not a standalone “harm taxonomy”); synced `aprf-spec.json`.
- Rewrote **safety-responsible-ai** former **SAF-R3 → SAF-R1** (hybrid human safety edge-case sampling); vacated `SAF-R3` under pre-release exception in `id-gaps.md`; synced `aprf-spec.json`.
- Rewrote **safety-responsible-ai** **SAF-R2** (hybrid jailbreak-to-harm red-team, distinct from SEC-M1); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **safety-responsible-ai** **SAF-M4** as **conditionally mandatory** hybrid fairness/disparity eval for high-stakes decision paths (N/A when none; cleared `technologies`); synced `aprf-spec.json`.
- Rewrote **safety-responsible-ai** **SAF-M3** (hybrid AI-interaction disclosure on in-scope user surfaces); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **safety-responsible-ai** **SAF-M2** (hybrid automated safety evaluation release gates); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **safety-responsible-ai** **SAF-M1** (hybrid harm taxonomy + refusal/escalation policy); cleared `technologies`; synced `aprf-spec.json`.
- Demoted **explainability** former **EXP-M4 → EXP-R3** (recommended change/counterfactual summaries for material model/prompt promotions) per [APRF-RFC-0008](rfcs/0008-explainability-exp-m4-to-recommended.md) (regulated 52→51, tier3-only 14→13); vacated `EXP-M4` under pre-release exception in `id-gaps.md`; synced `aprf-spec.json`.
- Rewrote **explainability** former **EXP-R3 → EXP-R2** (hybrid regulated-feature explainability requirements matrix); vacated `EXP-R3` under pre-release exception in `id-gaps.md`; synced `aprf-spec.json`.
- Rewrote **explainability** **EXP-R1** (hybrid user-facing rationale for material automated decisions); synced `aprf-spec.json`.
- Rewrote **explainability** **EXP-M4** (hybrid change/counterfactual summaries for material model/prompt promotions); synced `aprf-spec.json`.
- Rewrote **explainability** **EXP-M3** (hybrid explanation payload secret/PII hygiene); synced `aprf-spec.json`.
- Rewrote **explainability** **EXP-M2** (hybrid operator decision-path reconstruction drills); synced `aprf-spec.json`.
- Rewrote **explainability** **EXP-M1** (hybrid factual/high-stakes RAG provenance citations); synced `aprf-spec.json`.
- Rewrote **reliability-continuity** **REL-R4** (hybrid provider-loss continuity drills with RTO/RPO results); cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Rewrote **reliability-continuity** **REL-R6** (hybrid warm standby for self-hosted inference); cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Rewrote **reliability-continuity** **REL-R2** (hybrid multi-provider/multi-region fallback with quality/safety eval coverage); cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Rewrote **reliability-continuity** **REL-R1** (hybrid circuit breakers + bulkheads on AI/provider clients); cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Renumbered **reliability-continuity** former **REL-M6 → REL-M5** (business-critical AI service RTO/RPO) into vacated mandatory slot; recorded in `id-gaps.md`; synced `aprf-spec.json`.
- Demoted **reliability-continuity** former **REL-M8 → REL-R7** (recommended Level-5 multi-provider continuity) per [APRF-RFC-0007](rfcs/0007-reliability-continuity-rel-m8-to-recommended.md) (regulated 53→52, tier3-only 15→14); hybrid `ai-multi-provider-continuity` collector; vacated `REL-M8` under pre-release exception in `id-gaps.md`.
- Demoted **reliability-continuity** former **REL-M7 → REL-R5** (recommended AI-dependency chaos) per [APRF-RFC-0006](rfcs/0006-reliability-continuity-rel-m7-to-recommended.md) (regulated 54→53, tier3-only 16→15); hybrid `ai-chaos-dependency` collector; vacated `REL-M7` under pre-release exception in `id-gaps.md`.
- Rewrote former **REL-M5** AI control-plane backups as hybrid **REL-M4** (reused vacated mandatory slot per pre-release exception in `id-gaps.md`); added `ai-control-plane-backup` collector; synced `aprf-spec.json`.
- Demoted **reliability-continuity** former **REL-M4 → REL-R3** (recommended process continuity options with owners) per [APRF-RFC-0005](rfcs/0005-reliability-continuity-rel-m4-to-recommended.md); vacated `REL-M4` under pre-release exception in `id-gaps.md`.
- Rewrote **reliability-continuity** **REL-M1** (hybrid model/tool timeouts + bounded retries), **REL-M2** (hybrid critical-journey degraded mode), **REL-M3** (hybrid partial tool failure / no false-success; outcome-based test evidence, not injection-only), and **REL-M5** (hybrid business-critical AI service RTO/RPO in BCP/service-catalog/DR docs); cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Rewrote **performance-slo** **PERF-M1**–**PERF-M3** and **PERF-R1**–**PERF-R4** hybrid collectors; split former dashboard stub into mandatory **PERF-M2** (ops metrics) + recommended **PERF-R4** (near-real-time dashboards) per [APRF-RFC-0004](rfcs/0004-performance-slo-perf-m2-dashboards-to-recommended.md); cleared `technologies`; synced `aprf-spec.json`.
- Rewrote **observability** **OBS-M1** (hybrid trace linkage); demoted former token/cost attribution **OBS-M2 → OBS-R4** per [APRF-RFC-0003](rfcs/0003-observability-obs-m2-to-recommended.md) (core 39→38, regulated 55→54); renumbered sensitive-field redaction **OBS-M3 → OBS-M2** (conditionally mandatory); rewrote **OBS-R1**/**OBS-R2**/**OBS-R3** hybrid collectors; cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Rewrote **incident-readiness** **INC-M1**–**INC-M2** and **INC-R1**/**INC-R3**; demoted **INC-M3 → INC-R2** and **INC-M4 → INC-R4** per [APRF-RFC-0002](rfcs/0002-incident-readiness-mandatory-to-recommended.md) (regulated 56→55, tier3-only 17→16; pre-release ID-removal exception in `id-gaps.md`); hybrid collectors; synced `aprf-spec.json`.
- Rewrote **change management** from template stub to hybrid Check + collectors; cleared `technologies` filter; synced `aprf-spec.json`.
- Rewrote **prompt-engineering** from template stub to hybrid Check + collectors; cleared `technologies` filter; synced `aprf-spec.json`.
- Rewrote **model-governance** from template stub to hybrid Check + collector; cleared cloud-only `technologies`; synced `aprf-spec.json`.
- Rewrote **evaluation** from template stub to hybrid Check + collectors; synced `aprf-spec.json`.
- Rewrote **context-engineering** from template stub to hybrid Check + collectors; synced `aprf-spec.json`.
- Rewrote **data-privacy** from template stub to hybrid Check collector; synced `aprf-spec.json`.
- Tightened data-privacy prose: rewrote stub **PRI-R1** (pre-model tokenization/redaction) to hybrid + `model-payload-redaction` collector; aligned severity/weight with other recommended privacy Checks; trimmed sibling-control listing from PRI-R3 `whyItMatters`.
- Rewrote **memory-management** from template stub to hybrid Check + collectors; synced `aprf-spec.json`.
- Tightened memory-management prose: standalone `whyItMatters` on MEM-M3/M4/R1/R3 (no sibling-control roll-ups); clarified MEM-M2 title for AI memory scope.
- Rewrote **compliance** (AI obligations identified and owned) from template stub to hybrid Check + `ai-obligations-register` collector; synced `aprf-spec.json`.
- Tightened compliance prose: clarified **CMP-R3** Level 5 as APRF capability maturity (Optimizing), not criticality tier; linked maturity docs.
- Rewrote **Organizational-governance** from template stub to hybrid Check + collector; synced `aprf-spec.json`.
- Tightened Agents domain prose: removed sibling Check IDs from AGN-R3/HUM-M4/HUM-R3 `whyItMatters`; aligned AGN-M4, AGN-R3, HUM-M1/M3/M4 `passCondition` with collector `measuredAt` ≤90d.
- Tightened Cost domain prose: removed sibling Check IDs from COST-M2/M3 `whyItMatters`; aligned COST-M1–M3 `passCondition`/attest hints with collector `measuredAt` ≤90d.
- `spec/aprf-spec.json` agent-governance mandatory Checks **AGN-M1–M4** aligned to catalog SoT: methods (M1 automated, M3/M4 hybrid), owner in M1, cancel-suite + operator authz in M3, forged-peer in M4.
- AGN auditor collectors harden PASS unlocks: `measuredAt` ≤90d (M1–M4), `coversAllProductionAgents` (M1), operator authz + numeric SLO + `architectureReviewOk` (M3), all three deny cases (M4).
- Rewrote **agent-governance** pillar (goal-conflict plan policy) from template stub to hybrid Check + collector; synced `aprf-spec.json` method to hybrid.
- Rewrote **human-approval** Checks **HUM-M1–M4, HUM-R1, HUM-R3** from template stubs to hybrid catalog quality; added `human-approval*` collectors; synced `aprf-spec.json` human-approval pillar.
- Rewrote **cost-optimization** from template stub to hybrid Check + collectors; synced `aprf-spec.json` method to hybrid.
- Rewrote **cross-cutting** platform-engineering Checks (**DX-M1–M2**, **DX-R1–R4**; former DX-M3 demoted to DX-R4) from template stubs to hybrid quality with collectors; synced `aprf-spec.json`.
- Rewrote **data-governance** from template stub to hybrid Check + collectors; synced `aprf-spec.json` passCondition freshness.

### Added
- Portable **APRF Auditor** skill under [`skills/aprf-auditor/`](skills/aprf-auditor/): vendor-neutral local assessment package (`system.md`, `workflow.md`, evidence map, scoring, output schema, adapters for Cursor/Claude/Codex/Copilot/MCP). No StackRail backend required.
- Auditor skill **v0.2.0**: evidence precedence, objective confidence + freshness, capability manifest, evidence-graph / comparison schemas, collector `plugins/`, remediation fields, compare/history modes, AI-specific evidence strategies.
- Auditor **TypeScript collectors** (`skills/aprf-auditor/collectors/`): local CI/IaC/repo scanners, `imports/` ingest for runtime exports, optional live GitHub Actions via `APRF_AUDITOR_LIVE=1`; `npm run aprf:collect`.
- Auditor reports: Discovery splits **notObserved** vs **requiredEvidenceMissing**; executive summary leads with Criticality tier + required Capability maturity ([how/#maturity](https://stackrail.io/aprf/how/#maturity)); Grade/Risk are secondary.
- Auditor **Phase 2b attestation**: for Checks that would be `NOT_DEMONSTRATED`, ask the customer **YES / NO / DON'T KNOW** before finalizing; map YES (no artifact)→PARTIAL, NO→FAIL, DON'T KNOW→NOT_DEMONSTRATED; persist `userAttestation` on controls.

### Fixed
- Secrets / SCI-M1 collectors: N/A surface overrides key inventory/client-key (SEC2-M3) and corpus-publish/scan-gate (SEC2-R3); contradicting fail metrics (e.g. privileged findings > 0) beat `present=false` N/A while vacuous control=false fields do not; SEC2-R1 counts root `gitleaks.toml` and ignores `generatedAt` for ≤7d freshness; SEC2-M2 requires measured canary `cases`/`results`; accurate SEC2-M1 N/A-override notes.
- `@stackrail-io/aprf-engine` no longer advertises a published disk loader; `src/loader.ts` remains repo-script tooling only. Moved `ajv` / `ajv-formats` / `yaml` to `devDependencies` (patch **0.10.1**).
- Attestation schema 0.6: N/A is not a pass (`passed` must be `false` when `notApplicable` is true); removed “gate-satisfied” wording that contradicted evaluate helpers.
- Package README `validate` script description now matches root `package.json` (includes both packages’ `test:unit`).
- Root `package.json` declares `engines.node: >=22` (aligned with packages and README).
- CI asserts `schemas/aprf-rule-1.0.json` matches `packages/aprf-engine/rules/_schema/rule.schema.json`.
- npm packages ship `NOTICE` alongside `LICENSE` (`aprf-engine` / `aprf-framework-definition` **0.10.1**).

## [0.10.0] — 2026-07-28

Public normative monorepo release: Check YAML catalog, publishable npm packages, and CI integrity gates.
Published on npm as `@stackrail-io/aprf-engine@0.10.0` and `@stackrail-io/aprf-framework-definition@0.10.0`.

### Added
- GitHub Actions [`.github/workflows/ci.yml`](.github/workflows/ci.yml): rule schema validation, generated catalog drift check, unit tests, integrity, and published-spec structure checks.
- `npm run aprf:integrity` (`scripts/check-integrity.ts`).
- `@stackrail-io/aprf-engine` self-tests (`scripts/self-test.ts`) covering catalog sort, attestation evaluate, and N/A ≠ pass.
- Expanded root `README.md` (packages, Check model, how to add a Check, CI).
- `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `NOTICE`.
- `packages/aprf-engine/rules/_index/id-gaps.md` documenting intentional Check ID holes.
- `schemas/aprf-rule-1.0.json` mirror of the Check / rule JSON Schema.
- GitHub `CODEOWNERS` (placeholder), issue templates, and PR template.
- Normative catalog mirrored from the StackRail site era: Core (40) / Regulated (61), lenses, crosswalks, N/A for AGN/HUM/TOL/MEM, Check deprecation fields.

### Fixed
- Removed retired personal email and product API endpoints from published `spec/aprf-spec.json`; stewardship `emailHint` required.
- Normative engine no longer ships stub detectors; `evaluateRules` defaults to attestation-only.
- Packages emit `dist/` with NodeNext exports, `engines`, `files`, and SemVer aligned to **0.10.0**.
- Deterministic YAML catalog load order (sorted paths + rule IDs).
- CI integrity gate: YAML catalog ↔ published spec Check IDs, profiles ⊆ catalog, lenses resolve.
- `ARCHITECTURE.md` no longer claims a shipped Evidence Type Registry; documents shipped YAML schema vs target RFC fields.
- Checks that claimed `automated`/`hybrid` with only `manual-attest` downgraded; loader enforces capability honesty.
- Per-Check `whyItMatters`, `manualVerification`, `recommendedFixes`, and `falsePositiveGuidance` specialized (177 unique each).
- Rule schema `$id` now `https://stackrail.io/aprf/rule-schema/1.0` (hosted on stackrail.io; legacy `rule.schema.json` redirects).
- Lenses (RAG / Agents / Voice / Coding) exported from `@stackrail-io/aprf-framework-definition` and locked to `spec.lenses` in integrity CI.
- Check `title` now differs from `description`; loader enforces title ≠ description.
- Renamed npm packages to `@stackrail-io/aprf-engine` and `@stackrail-io/aprf-framework-definition`.
- Check titles rewritten from descriptions (`shall` → `must`); unused detector allowlist ID `gha-permissions-scoped` removed.
- `findingsToCheckOutcomes` preserves `status` / `error` (N/A and detector errors no longer look like bare fails only).
- Package builds wipe `dist/` and omit source maps; orphan `loader` artifacts no longer linger after build.
- `ARCHITECTURE-REVIEW.md` marked historical and aligned on Evidence Type Registry = planned.

### Removed
- `.github/workflows/validate-spec.yml` (superseded by `ci.yml`).
- Stub detector runtimes from `@stackrail-io/aprf-engine` (catalog detector ID allowlist retained for YAML validation).
- Deprecated aliases `PROFILE_CORE_SHELL`, `PROFILE_REGULATED_SHELL`, `PROFILE_SHELLS`, `getProfileShellById`.

## [0.9.x] — 2026-07-25 (historical)

Catalog prose rewrites and early profile/lens work (including former 0.9.0–0.9.6 patches and companion-site Assess packaging) authored during the site publishing era. Retained as a SemVer bookmark; see git history for per-patch detail.

## [0.8.x] — 2026-07 (historical)

Early RFC-0001 / coding-agent lens / Assess packaging notes from the companion site era.
