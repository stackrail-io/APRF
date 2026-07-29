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

**Out-of-plugin evidence:** place any customer artifact under `aprf-assessment/imports/custom/` → ingested as `user` nodes (catch-all; not a FAIL if empty).

**Live APIs (optional):** `APRF_AUDITOR_LIVE=1` + credentials (e.g. `GITHUB_TOKEN`). Never enable live by default.

### Phase 2b — Attest missing Checks (required before finalizing NOT_DEMONSTRATED)

After repo search, build the list of in-scope Checks that would otherwise be **`NOT_DEMONSTRATED`** (insufficient evidence). **Do not finalize the report until you ask** (batch; mandatory / critical first).

For **each** such Check, ask in this exact shape (customer answers only one of three):

```text
APRF Check <CHECK-ID> — <title>
Required to pass: <evidenceRequired / passCondition summary>

Do you have this control / evidence today?
  A) YES — we have it (optional: paste path or add under aprf-assessment/imports/custom/)
  B) NO — we do not have it
  C) DON'T KNOW / unsure
```

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

**Confidence:** compute `confidenceScore` then `confidence` via `confidence.yaml` (class base × freshness decay + corroboration). Emit both.

**Remediation** (required on FAIL / PARTIAL / NOT_DEMONSTRATED):

| Field | Content |
| --- | --- |
| `fix` | Concrete change |
| `example` | Snippet, pattern, or link to in-repo golden path |
| `reference` | APRF Check id + optional external doc URL from Check YAML |
| `owner` | CODEOWNERS / team if known, else `unassigned` |
| `priority` | P0–P3 |
| `estimatedEffort` | `S` (\<1d) / `M` (1–3d) / `L` (1–2w) / `XL` |

## Phase 4 — Score & gate

Use `scoring.yaml`. Gate PASS iff every applicable mandatory is `PASS` or `NOT_APPLICABLE`. Domain + recommended scores are non-certification.

## Phase 5 — Controls & Findings packs

Group findings packs into tags on each control: Production blocker · Critical · High · Medium · Low · Quick win. Emit a single **Controls & Findings** section — tags on the listing, full control detail below (not separate pack subsections).

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
