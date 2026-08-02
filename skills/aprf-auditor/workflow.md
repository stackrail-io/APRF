# APRF Auditor — Assessment Workflow

Follow phases **in order**. Prefer the **evidence-graph path** (`architecture.md`). Do not invent evidence.

**Modes:** `assess` (default) | `compare` | `history-append`  
**Triggers:** APRF assessment, AI production readiness, etc. (`skill.yaml`).

Read first: `capabilities.yaml`, `evidence-precedence.yaml`, `confidence.yaml`.

## Phase 0 — Resolve APRF + scope

1. Locate APRF source of truth (Check YAML is primary; `spec/aprf-spec.json` is published ID/`passCondition` mirror).
2. Confirm SemVer (`skill.yaml` → `aprfVersion` or spec `governance.version`).
3. **Classify system type** (required before profile):

   | `systemType` | Meaning | Default profile / scope |
   | --- | --- | --- |
   | `ai-application` | Customer/partner-facing GenAI product (models, agents, RAG, tools in prod) | `aprf-profile-core` (or regulated) |
   | `non-ai-platform` | Console, control plane, framework catalog, admin/tooling — **not** an AI product | `scopes/non-ai-platform.yaml` |
   | `unknown` | Ambiguous | Ask the user; do not assume Core |

   Detection hints for `non-ai-platform`: assessment console / cloudOps-style product, APRF catalog repo, no product prompts/agents/RAG/eval harness. Confirm with the user when unsure.

4. Ask (or infer with stated defaults):
   - **Criticality tier (0–3):** Sandbox / Internal / Production / Mission Critical — map to `scope.criticality` and copy names into `executiveSummary` per `scoring.yaml` → `criticalityTiers` ([maturity model](https://stackrail.io/aprf/how/#maturity))
   - **Required capability level:** from that tier (L1–L4 floor; Regulated often targets L5)
   - **Profile / scope:** Core | Regulated | full-catalog | **non-ai-platform subset**
   - **Lenses:** none unless `ai-application` (RAG | Agents | Voice | Coding)
   - **Target path** (+ optional **baseline** git ref for compare mode)
   - **Live base URL (required for `ai-application` before collect finishes):** ask up front —
     *“Is there a running instance I can probe (local/staging URL)?”*
     - If **yes** → record as `APRF_AUTH_PROBE_BASE_URL` / `--base-url` and run `http-auth-probe` during Phase 2
     - If **not yet** → ask them to start the app (or paste URL when ready); do **not** PASS AUTHN-M1 from code alone; you may continue repo discovery but keep AUTHN-M1 open until probe or explicit Phase 2b
     - If **no runnable instance** (library-only / docs-only) → document that; AUTHN-M1 stays NOT_DEMONSTRATED or N/A with justified `naReason` (no customer-facing HTTP API)
   - **MCP/S2S inventory (AUTHN-M2, when the app has tools/MCP):** ask with the live URL —
     *“Can you export tool-server/MCP connection config (redact secrets), or provide an admin token for inventory fetch?”*
     - Prefer `imports/mcp-s2s-inventory/*.json`, or `--base-url` with `--admin-token` / `APRF_ADMIN_TOKEN`, or `--admin-email` + `--admin-password` (sign-in → JWT)
     - Never commit tokens; never store raw API keys in reports
5. Load in-scope Check IDs:
   - `ai-application` → profile ∪ lenses
   - `non-ai-platform` → **only** `scopes/non-ai-platform.yaml` → `mandatoryCheckIds` (do **not** evaluate excluded AI Checks as blockers; list them under `scope.excludedCheckIds` with reasons)
6. Set report labels:
   - `scope.systemType`
   - `scope.assessmentKind`: `aprf-core` | `aprf-regulated` | `full-catalog` | `non-ai-platform-subset`
   - `executiveSummary.criticalityTier` / `criticalityName` / `requiredCapabilityLevel` / `requiredCapabilityName` / `maturityUrl`
   - `overallGrade` / `riskLevel` are **secondary** only (optional communication)
   - For subset: copy `claimLanguage.reportBanner` into executive summary + disclaimer (**forbidden** to claim Core/Regulated AI production readiness)

## Phase 1 — Discover + select collectors

Inventory paths (sorted) per class table below. Read `capabilities.yaml` and enable matching `plugins/`.

| Class | Typical paths / globs |
| --- | --- |
| VCS | `.git/`, `README*`, `SECURITY*` |
| App source | `src/`, `app/`, `apps/`, `packages/`, `lib/` |
| Containers | `Dockerfile*`, `docker-compose*.yml` |
| K8s / Helm | `**/k8s/**`, `**/helm/**`, `**/*deployment*.yaml` |
| IaC | `**/*.tf`, `**/terraform/**`, `**/pulumi/**`, `**/cdk/**` |
| CI/CD | `.github/workflows/**`, `.gitlab-ci.yml`, `Jenkinsfile`, … |
| Secrets / env | `.env*`, sealed-secrets, cloud secret manager IaC |
| Prompts / MCP | `**/prompts/**`, `**/mcp*.json`, tool manifests |
| Models / flags | model pins, feature-flag configs |
| Observability | OTel, Grafana, Prometheus, Datadog-as-code |
| Eval | `**/eval/**`, promptfoo, CI eval jobs |
| Policies | OPA/Rego, Cedar, org AI policy |
| Runtime imports | `aprf-assessment/imports/<pluginId>/` |

Emit **Project Discovery** with three buckets (do not conflate):

| Bucket | Meaning |
| --- | --- |
| **Found** | Observed artifacts (paths/plugins) |
| **Not observed** | Common optional tech not present (k8s/helm, SBOM, …). **Not a defect** unless a Check requires it |
| **Required evidence missing** | Still needed for **in-scope** Checks after search (+ user ask). Gate-relevant |

Also note which plugins ran vs need user input.

## Phase 2 — Collect into Evidence Graph

1. **Prefer the shipped runner** (deterministic, no LLM inventiveness):

   ```bash
   npm run aprf:collect -- --target <project> --out ./aprf-assessment
   ```

   Or from a checkout of APRF: `npx tsx skills/aprf-auditor/collectors/runner.ts --target …`

2. Run enabled plugins (`plugins/*.yaml` → `collectors/*.ts`) → nodes.
3. Apply `evidence-map.yaml` (category defaults, Check overrides, `aiSpecificStrategies`) when agents enrich the graph manually.
4. For each node record: `class`, `ref`, optional `excerpt`, `lastModified`, `gitCommit`, `buildId`, `evidenceAgeDays`, `relatedCheckIds`, `signals`.
5. Write/confirm `evidence-graph.json` conforming to `evidence-graph.schema.json`.
6. **Precedence:** when multiple nodes support one Check, pick PRIMARY per `evidence-precedence.yaml` (runtime → ci → iac → runtime-config → policy → code → docs → user). Docs/user cannot override FAIL from higher ranks.

**Runtime evidence without live cloud:** place exports under `aprf-assessment/imports/<pluginId>/` then re-run collectors.

**AUTHN-M1 (http-auth-probe):** code review of auth middleware is **not** sufficient to PASS. Prefer a live probe:

```bash
# User starts the app, then:
npm run aprf:auth-probe -- \
  --target <project> --out <project>/aprf-assessment \
  --base-url http://127.0.0.1:8080
```

Writes `imports/http-auth-probe/auth-probe-report.json`. PASS only when every probed AI route returns 401/403 without credentials. If the app cannot be started, ask for a base URL or an exported probe report — do not invent PASS.

**AUTHN-M2 (mcp-s2s-inventory):** OAuth support in code is **not** sufficient to PASS. Prefer an inventory:

```bash
npm run aprf:mcp-s2s -- \
  --target <project> --out <project>/aprf-assessment \
  --base-url http://127.0.0.1:8080 --admin-token "$APRF_ADMIN_TOKEN"
  # or: --admin-email "$APRF_ADMIN_EMAIL" --admin-password "$APRF_ADMIN_PASSWORD"
# or: imports/mcp-s2s-inventory/tool_servers.json (redact secrets)
```

**AUTHZ-M1 (authz-entry-tests):** server-side `has_permission` / `Depends(get_verified_user)` is **supporting** evidence only. Prefer:

```bash
npm run aprf:authz-tests -- \
  --target <project> --out <project>/aprf-assessment
# or drop coveredPaths JSON under imports/authz-entry-tests/
```

PASS only when automated tests cover 100% of AI feature/tool/retrieval entry points with unauthenticated/unauthorized denial.

**AUTHZ-M2 (cross-tenant-tests):** `user_id` / `access_grants` filters are **supporting** only. Prefer:

```bash
npm run aprf:cross-tenant -- \
  --target <project> --out <project>/aprf-assessment
# or drop suite JSON under imports/cross-tenant-tests/
```

PASS only with ≥10 automated cross-tenant attack cases and 0 successful unauthorized reads/writes on AI data/memory paths.

**SEC2-M1 (secrets-hygiene):** CI `${{ secrets.* }}` is **not** a production secrets manager. Prefer:

```bash
npm run aprf:secrets -- \
  --target <project> --out <project>/aprf-assessment
# or drop coverage JSON under imports/secrets-hygiene/
# (explicit privilegedSecretsInReposPromptsOrClientBundles=0; empty SARIF alone ≠ clean scan)
```

PASS only with secrets-manager runtime wiring AND a clean secret-scan import (0 privileged secrets in repos, prompt registries, and client bundles — include fixtures when present; measuredAt ≤90d). Heuristic embeds fail even when `productionRuntimeSecretsPresent=false`.

**SEC2-M2 (secret-redaction):** log scrubbers in code are **supporting** only. Prefer:

```bash
npm run aprf:secret-redaction -- \
  --target <project> --out <project>/aprf-assessment
# or drop canary harness JSON under imports/secret-redaction/
```

PASS only with redaction config + non-empty canary `cases`/`results` showing 100% detection of synthetic API/bearer/AWS-key patterns in persisted logs/traces (measuredAt ≤90d). Bare `detectionRatePct=100` without cases is not a PASS.

**SEC2-M3 (key-rotation-scope):** rotation calendars alone are **supporting** only. Prefer:

```bash
npm run aprf:key-rotation-scope -- \
  --target <project> --out <project>/aprf-assessment
# or drop inventory/coverage JSON under imports/key-rotation-scope/
```

PASS only with a production key inventory + 100% documented least-privilege scope + 100% within rotation policy (or provider short-lived credentials) + 0 privileged keys in client apps (measuredAt ≤90d).

**SEC2-R1 (precommit-ci-secret-scan):** scanner config alone is **supporting** only. Prefer:

```bash
npm run aprf:precommit-ci-secret-scan -- \
  --target <project> --out <project>/aprf-assessment
# or drop green-scan coverage JSON under imports/precommit-ci-secret-scan/
```

PASS only with pre-commit + CI secret scanning covering prompts/fixtures, blocking on high-confidence secrets, and a green main-branch or PR-merge scan ≤7 days (`measuredAt` ≤7d — `generatedAt` is ignored). Root `gitleaks.toml` alone is PARTIAL, not not_demonstrated. SEC2-M1 ≤90d content scans do not satisfy this freshness gate.

**SEC2-R2 (credential-egress-controls):** allowlist docs alone are **supporting** only. Prefer:

```bash
npm run aprf:credential-egress-controls -- \
  --target <project> --out <project>/aprf-assessment
# or drop deny-event coverage JSON under imports/credential-egress-controls/
```

PASS only with egress allowlist/policy for credential-holding runtimes + documented destinations + ≥1 deny event proving enforcement (measuredAt ≤90d). SEC-M4 model-path probes do not substitute.

**SEC2-R3 (dataset-secret-scan-gate):** dataset cards alone are **supporting** only. Prefer:

```bash
npm run aprf:dataset-secret-scan-gate -- \
  --target <project> --out <project>/aprf-assessment
# or drop linked-scan coverage JSON under imports/dataset-secret-scan-gate/
```

PASS only with a secret/PII scan gate before fine-tune/eval publish + blocking on critical findings + 100% linked scan reports for corpora published in the last 90 days (measuredAt ≤90d). SEC2-R1 code/prompt scanners and DG dataset cards do not substitute.

**SCI-M1 (artifact-provenance-integrity):** Dockerfile digest pins alone are **supporting** only. Prefer:

```bash
npm run aprf:artifact-provenance-integrity -- \
  --target <project> --out <project>/aprf-assessment
# or drop verify/block coverage JSON under imports/artifact-provenance-integrity/
```

PASS only with cosign/Notation/SLSA/OCI/checksum verification configured + 100% of production model/container pulls verified + unverified pulls blocked (measuredAt ≤90d).

**SEC-M1 (injection-policy-gate):** content-filter warnings are **supporting** only. Prefer:

```bash
npm run aprf:injection-gate -- \
  --target <project> --out <project>/aprf-assessment
# or drop corpus/CI results under imports/injection-policy-gate/
```

PASS only with server-side policy + versioned injection/privilege-escalation corpus + CI gate showing ≥95% deny and 0 model-text privilege grants.

**Out-of-plugin evidence:** place any customer artifact under `aprf-assessment/imports/custom/` → ingested as `user` nodes (catch-all; not a FAIL if empty).

**Live APIs (optional):** `APRF_AUDITOR_LIVE=1` + credentials (e.g. `GITHUB_TOKEN`). Never enable live by default.

### Phase 2b — Attest missing Checks (required before finalizing NOT_DEMONSTRATED)

After repo search, build the list of in-scope Checks that would otherwise be **`NOT_DEMONSTRATED`** (insufficient evidence). **Do not finalize the report until you ask** (batch; mandatory / critical first).

**Verbatim catalog only — never paraphrase Phase 2b text.**

For each Check, open its YAML under `packages/aprf-engine/rules/` and copy **exactly**:

| Ask field | Source |
| --- | --- |
| Check id | YAML `id` |
| Title line | YAML `title` **character-for-character** (full sentence; no shorten, no “beyond …”, no rewrite) |
| Required to pass | YAML `evidenceRequired` items joined, and/or full `passCondition` — not a summary |

**Forbidden examples** (do not do this):

```text
# BAD — paraphrased
1. SEC2-M1 — Production secrets in a secrets manager (not repos/prompts)
11. PRI-M2 — Deletion/export covering AI memory/logs (beyond delete_investigation)
```

**Required shape** (do this):

```text
Phase 2b — need your answers (A / B / C per Check)

A) YES — we have it (optional: path under aprf-assessment/imports/custom/)
B) NO — we do not have it
C) DON'T KNOW / unsure

1. SEC2-M1 — Production secrets must live in a secrets manager and not in prompts, repos, or prod notebooks
   Required to pass: Secrets-manager / sealed-secrets / cloud secret-ref wiring for production runtime; CI/repo secret-scan config covering prompts and fixtures; latest secret-scan report with 0 privileged findings (measuredAt ≤90 days); attest or inventory showing 100% of production runtime secrets resolve from the secrets manager
   Pass condition: Secrets-manager wiring covers production runtime secrets; 100% of those secrets resolve from the secrets manager; the latest secret scan covering repos, prompt registries, and client bundles finds 0 privileged production secrets (measuredAt ≤90 days). If no production runtime secrets exist, score NOT_APPLICABLE.
2. …
```

Batch in one message; allow replies like `all C`, `SEC2-M1:A`, or a full A/B/C map. Optional path under `aprf-assessment/imports/custom/`.

**How does a `detection.capability: manual` Check ever PASS?**

`manual` means **no automated detector can fully prove the passCondition** — not “chat YES = PASS.” The Check still needs the **artifacts** named in `evidenceRequired` / `passCondition` (runbook, test record, screenshot, signed verification note, export under `imports/custom/`, etc.). The assessor (human or agent) **reads** those artifacts per `manualVerification`.

| Situation | Status |
| --- | --- |
| Artifacts satisfy `passCondition` (in-repo or supplied under `imports/custom/`) | **`PASS`** — even when `capability: manual` |
| User says YES but supplies no artifact | **`PARTIAL`** (attestation only) |
| User says NO | **`FAIL`** |
| Don't know / nothing found | **`NOT_DEMONSTRATED`** |

Same bar for `automated` / `hybrid`: chat YES alone never upgrades to PASS. SEC2-M1 is `hybrid` — it expects secrets-manager + scan/import evidence (detectors + `evidenceRequired`), not a verbal attestation.

**Answer → status mapping** (record on the control as `userAttestation`):

| Answer | Status | Notes |
| --- | --- | --- |
| **YES** + path/paste that satisfies passCondition | `PASS` (or `PARTIAL` if incomplete) | Read artifacts; confidence from evidence class |
| **YES** without path/artifact | `PARTIAL` | Customer asserts present; `confidence: low`; `primaryEvidenceClass: user`; ask once for path — if still none, keep PARTIAL, do not invent PASS |
| **NO** | `FAIL` | Demonstrated absence of the control (not NOT_DEMONSTRATED) |
| **DON'T KNOW** / no reply after ask | `NOT_DEMONSTRATED` | Gate blocker for mandatories; list `requiredEvidenceMissing` |

Rules:

- Never invent files because they said YES.
- YES cannot override a **FAIL** already proven by higher-rank evidence (code/CI showing violation).
- Batch all questions in one message when possible; allow per-Check A/B/C replies.
- Persist attestation on each control:

```json
"userAttestation": {
  "answer": "yes" | "no" | "unknown",
  "detail": "optional free text / path",
  "askedAt": "<ISO-8601>"
}
```

### Progress reporting (required — never go silent)

After the user answers Phase 2b (or anytime a phase will take more than a few seconds), **stream short progress in chat**. Do **not** sit on one opaque line like “Generating the full assessment…” with no updates.

**Right after attestations**, post this checklist then tick it as you go:

```text
Building assessment from evidence + your answers
(YES without artifacts → PARTIAL; repo-proven FAILs unchanged)

1/6 Apply attestations (YES→PARTIAL, NO→FAIL, DON'T KNOW→NOT_DEMONSTRATED) …
2/6 Evaluate remaining Checks by domain …
3/6 Score gate + domain scores …
4/6 Write assessment.json …
5/6 Write REPORT.md …
6/6 Render + verify REPORT.html …
```

**While working**, emit a one-liner at each boundary (examples):

- `1/6 Applied attestations: 14 PARTIAL (YES), 3 FAIL (NO), 2 NOT_DEMONSTRATED`
- `2/6 Security 8/12 · Observability 3/9 …` (or per domain as you finish)
- `3/6 Gate: FAIL · blockers: 5 (critical: 2)`
- `4/6 Wrote aprf-assessment/assessment.json`
- `5/6 Wrote aprf-assessment/REPORT.md`
- `6/6 REPORT.html rendered + verified`

Rules:

- Prefer **many short updates** over one long silent generation.
- Write artifacts **as soon as ready** (don't buffer everything until the end).
- If a step stalls (large domain, renderer), say what you're doing *now* (`Evaluating AUTH* Checks…`, `Running aprf:report-html…`).
- Never leave the user without a progress line for an entire multi-domain evaluation + report write.

## Phase 3 — Evaluate Checks against the graph

For each in-scope Check (query graph; do not blindly rescan):

```
IF system type excludes control → NOT_APPLICABLE (+ naReason)
ELSE IF evidence shows passCondition violated → FAIL
ELSE IF passCondition met with repo/runtime evidence → PASS
ELSE IF partial repo evidence → PARTIAL
ELSE IF queued for attestation → apply Phase 2b answer map (YES / NO / DON'T KNOW)
ELSE → NOT_DEMONSTRATED (+ requiredEvidenceMissing)
```

Never invent FAIL from “best practice.” **NO** from the customer is an explicit FAIL. **DON'T KNOW** stays NOT_DEMONSTRATED.

**Copy the Check verbatim from catalog YAML** into each control (never paraphrase or shorten):

| Control field | Source in Check YAML |
| --- | --- |
| `title` | `title` **exactly** |
| `description` | `description` **exactly** — show in report |
| `whyItMatters` | `whyItMatters` **exactly** — show in report |
| `references` | `references` **exactly** — show in report |
| `passCondition` | `passCondition` |
| `evidenceRequired` | `evidenceRequired` (full list) |
| `recommendedFixes` | `recommendedFixes` (full list — **required**) |
| `manualVerification` | `manualVerification` |
| `falsePositiveGuidance` | `falsePositiveGuidance` |
| `category` | Check YAML `category` (pillar id, e.g. `data-privacy`) — **not** the same as domain |
| `domain` | From `domains.yaml` / pillar mapping (`data-privacy` → `data`). Report shows **Category** (pillar name) and domain as grouping. |
| `gate` / `severity` | same fields |

**Map catalog → report wording** (do not invent shorter substitutes):

| Report field | How to populate |
| --- | --- |
| `recommendedAction` | Join **all** `recommendedFixes` (numbered or bulleted). Do not rewrite. |
| `remediation.fix` | First `recommendedFixes[0]` verbatim (or the join if a single string is required). |
| `remediation.example` | Optional **repo-specific** path/snippet only (additive). |
| `remediation.reference` | Check id + first catalog `references[].url` when present. |
| `reasoning` | Start from catalog: quote `passCondition` and what evidence showed vs it. Append `manualVerification` when status is FAIL/PARTIAL/NOT_DEMONSTRATED. Assessment-only extras (file paths) come **after** the catalog text. |

Assessment-only fields (`status`, `evidenceFound`, `userAttestation`, owner/effort) are additive — they must not replace catalog text.

**Emit every in-scope Check** in `controls[]` — including **`PASS`** and **`NOT_APPLICABLE`**. Do not drop PASSes from `assessment.json` / the Controls & Findings table. Findings packs tag gaps; they do not replace the full control list.

**Attestation vs PASS:** YES without an artifact is **`PARTIAL`**, not PASS. **`detection.capability: manual` does not change that** — manual Checks PASS when `evidenceRequired` artifacts exist and satisfy `passCondition` (agent/human verifies via `manualVerification`). Only bare chat YES is insufficient for any capability.

**Confidence:** compute `confidenceScore` then `confidence` via `confidence.yaml` (class base × freshness decay + corroboration). Emit both.

**Remediation** (required on FAIL / PARTIAL / NOT_DEMONSTRATED):

| Field | Content |
| --- | --- |
| `fix` | **Verbatim** from Check YAML `recommendedFixes` (prefer full list or `[0]`) — not a paraphrased one-liner |
| `example` | Optional in-repo path/snippet only |
| `reference` | Check id + optional URL from Check YAML `references` |
| `owner` | CODEOWNERS / team if known, else `unassigned` |
| `priority` | P0–P3 |
| `estimatedEffort` | `S` (\<1d) / `M` (1–3d) / `L` (1–2w) / `XL` |

## Phase 4 — Score & gate

Use `scoring.yaml`. Gate PASS iff every applicable mandatory is `PASS` or `NOT_APPLICABLE`. Domain + recommended scores are non-certification.

## Phase 5 — Controls & Findings packs

Group findings packs into tags on each control: Production blocker · Critical · High · Medium · Low · Quick win. Emit a single **Controls & Findings** section — **HTML:** table listing + detail flyout; **Markdown:** table + detail sections (not separate Controls + Findings).

## Phase 6 — Roadmaps

30 / 90 / long-term from priorities and remediation effort.

## Phase 7 — Emit artifacts

Default dir: `./aprf-assessment/`

| File | Format |
| --- | --- |
| `evidence-graph.json` | Evidence graph |
| `REPORT.md` | Human report (Markdown) |
| `REPORT.html` | **Must** be produced by `npm run aprf:report-html` (or `npx tsx …/render-html-report.ts`). **Do not** invent HTML in the chat. |

After writing `assessment.json`, **always** run:

```bash
# cwd = APRF repository root (the one that vendors this skill)
npm run aprf:report-html -- \
  --in /absolute/path/to/target/aprf-assessment/assessment.json \
  --out /absolute/path/to/target/aprf-assessment/REPORT.html
```

If APRF is only available via the skill symlink, resolve the real path:

```bash
npx tsx "$(realpath .cursor/skills/aprf-auditor)/scripts/render-html-report.ts" \
  --in ./aprf-assessment/assessment.json \
  --out ./aprf-assessment/REPORT.html
```

**Acceptance check (required before finishing):**

```bash
# From APRF repo root:
npm run aprf:verify-html -- /absolute/path/to/target/aprf-assessment/REPORT.html

# Or via skill symlink from the assessed app:
npx tsx "$(realpath .cursor/skills/aprf-auditor)/scripts/verify-html-report.ts" \
  ./aprf-assessment/REPORT.html
```

## Phase 8 — Human summary

Gate, top blockers, confidence, paths to `REPORT.md` **and** `REPORT.html`. State explicitly: “REPORT.html rendered via render-html-report.ts (verified).” Offer issues only if asked.

For **`non-ai-platform-subset`**, the chat summary **must** start with:

```text
NON-AI / PLATFORM SUBSET — not an APRF Core AI production-readiness claim.
Subset gate: PASS|FAIL · in-scope Checks: N · excluded AI Checks: M
```

Then list subset blockers only. Suggest re-running on the AI product repo with `systemType=ai-application` if they want Core.

---

## Mode: compare

When user asks to compare branches/refs (e.g. `main` vs feature):

1. Assess baseline and candidate (or load prior `assessment.json`).
2. Emit `comparison.json` per `comparison.schema.json`.
3. Summarize: newly passed, regressions, new blockers, resolved blockers, gate change.

Example chat summary:

```text
+4 controls newly PASS
-1 regression (SEC-M1 PASS → FAIL)
2 new blockers
Gate: FAIL → FAIL
```

## Mode: history-append

Append a compact entry under `aprf-assessment/history/`:

- `assessedAt`, `gitCommit`, `profileId`, `overallGatePassed`, `overallGrade`, `blockerCount`, `topBlockers[]`

If prior history exists, include a short **Assessment History** section in `REPORT.md` (month/gate/reason).
