# APRF Changelog

All notable changes to the AI Production Readiness Framework are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is SemVer
(`APRF_GOVERNANCE.version`). JSON Schema path versions (`spec-schema/0.7`,
`attestation-schema/0.6`) are independent — see `governance.schemaVersioning`.

## [Unreleased]

### Changed
- Rewrote **incident-readiness** **INC-M1**–**INC-M2** and **INC-R1**/**INC-R3**; demoted **INC-M3 → INC-R2** and **INC-M4 → INC-R4** (regulated 56→55, tier3-only 17→16); hybrid collectors; synced `aprf-spec.json`.
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
