---
name: aprf-auditor
# Slash entry is /aprf-audit (commands/). Keep this skill model-usable but off the
# / menu so it does not duplicate the portable repo skill or the audit command.
user-invocable: false
description: >-
  Local APRF assessment via @stackrail-io/aprf CLI (no StackRail console, no
  localhost:3001, no run_* IDs). Prefer `npx @stackrail-io/aprf@0.1.5 audit`.
  Writes aprf-assessment/ with evidence-graph.json, assessment.json, REPORT.html.
  Ask the user for missing runtime inputs and import evidence; do not only
  summarize gaps. Use for "Run an APRF assessment", "APRF audit", "AI production
  readiness". Prefer slash command /aprf-audit. Do NOT use the StackRail product
  Assessments UI.
---

# APRF Auditor (Cursor plugin)

Runs the **open APRF CLI** against the current workspace. Catalog is pinned by
`@stackrail-io/aprf-engine` — **do not** require cloning the APRF repo.

The CLI scores deterministically. **You (the agent) must still ask** for missing
runtime URLs, credentials, and import paths — never finish with gap lists alone.

## Invariants

1. **No StackRail backend / console / `localhost:3001` / product `run_*` IDs.**
2. Never invent evidence. Unscored Checks stay `NOT_DEMONSTRATED`.
3. **`REPORT.html` must come from the CLI** (`aprf report` / `aprf audit`) — never hand-write HTML.
4. Write all artifacts under **`./aprf-assessment/`** in the target project.
5. **Ask before concluding.** When evidence is missing, ask concrete questions in chat (batched). Do not only dump “Evidence still required” from the report.

## Before the first audit (required)

**Classify the target — ask if unsure.** Do **not** start `audit`/`assess` until `systemType` is confirmed:
`ai-application` | `ai-framework` | `non-ai-platform`.

If ambiguous, ask in chat first, e.g.  
*“Is this (A) a customer-facing AI app, (B) an AI framework/SDK, or (C) a non-AI platform/console?”*  
Then dry-run: `npx @stackrail-io/aprf@0.1.5 resolve-target --system-type … --capabilities … --json`.

For an AI app, **also ask up front** (do not wait until after a code-only run):

1. **Running base URL?** (e.g. `http://127.0.0.1:8080`) — needed for AUTHN-M1 / live probes.
2. If tools/MCP look present: **MCP/S2S inventory path** under `./aprf-assessment/imports/mcp-s2s-inventory/`, or confirm live fetch via env (`APRF_ADMIN_TOKEN`, or `APRF_ADMIN_EMAIL` + `APRF_ADMIN_PASSWORD`) for AUTHN-M2.
3. Optional for AUTHZ-M1: confirm limited-user env (`APRF_AUTHZ_LIMITED_*`) is set (or say you’ll use admin-created temp user).

**Never ask the user to paste passwords or tokens into chat.** Ask only whether the needed `APRF_ADMIN_*` / `APRF_AUTHZ_*` vars are already set in the local shell (secret manager or non-echoing prompt). Do not invent PASS for live Checks when there is no runnable instance.

When they confirm a URL and/or that credential env vars are available, re-run with live inputs (CLI reads env; secrets never persisted in artifacts; avoid `--*-password` / `--*-token` on argv).

## Preferred path (one command)

Requires **Node.js ≥ 22**. Resolve the CLI in this order:

1. **APRF checkout** (workspace has `packages/aprf/package.json`):

```bash
npm run build -w @stackrail-io/aprf
node packages/aprf/dist/cli.js audit --target . --out ./aprf-assessment --system-type ai-application --profile core
```

2. **Published npm** (any other project):

```bash
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --system-type ai-application --profile core
```

Variants (same flags on either binary):

```bash
# Live collectors (AUTHN-M1 / AUTHZ-M1 / AUTHN-M2) — auto-enables live mode
# Prerequisites (set OUTSIDE chat via secret manager / non-echoing prompt — do not paste secrets here):
#   APRF_ADMIN_EMAIL + APRF_ADMIN_PASSWORD  — or —  APRF_ADMIN_TOKEN
# Optional AUTHZ-M1: APRF_AUTHZ_LIMITED_EMAIL + APRF_AUTHZ_LIMITED_PASSWORD  — or —  APRF_AUTHZ_LIMITED_TOKEN
# Avoid --*-password / --*-token on argv
… audit --target . --out ./aprf-assessment --system-type ai-application --profile core \
  --base-url http://127.0.0.1:8080

# Regulated profile
… audit --target . --profile regulated

# Framework / SDK primitive gate (not Core)
… audit --target . --profile framework

# Application capabilities (additive lenses)
… audit --target . --system-type ai-application --profile core --capabilities rag,agents

# Extra lenses
… audit --target . --system-type ai-application --profile core --lens rag,agents

# Full catalog (ai-application only)
… audit --target . --full
```

Other evidence via `./aprf-assessment/imports/<plugin>/` or env (`GITHUB_TOKEN`, …).

## Step-by-step (when not using `audit`)

Carry the Phase 0 classification into every command (do **not** hard-code Core for framework/non-AI targets):

```bash
# Dry-run resolution first
npx @stackrail-io/aprf@0.1.5 resolve-target --system-type <type> --capabilities <caps> --json

# ai-application (example)
npx @stackrail-io/aprf@0.1.5 collect --target . --out ./aprf-assessment
npx @stackrail-io/aprf@0.1.5 assess  --out ./aprf-assessment --system-type ai-application --profile core
npx @stackrail-io/aprf@0.1.5 report  --in ./aprf-assessment/assessment.json --out ./aprf-assessment/REPORT.html
npx @stackrail-io/aprf@0.1.5 verify  ./aprf-assessment/REPORT.html

# ai-framework / SDK
… assess --out ./aprf-assessment --system-type ai-framework --profile framework

# non-ai-platform: CLI assess is not supported yet — use APRF Auditor skill + scopes/non-ai-platform.yaml
```

## After the run (summarize, then ask)

1. Confirm files exist: `evidence-graph.json`, `assessment.json`, `REPORT.html`.
2. Confirm `REPORT.html` contains `stackrail.io` and `Visual overview`.
3. Summarize: gate PASS/FAIL, blocker count, critical blockers, top P0/P1 from `assessment.json`.
4. **Ask for missing evidence** — do not stop at a gap list. From `NOT_DEMONSTRATED`, `PARTIAL`, and `needs-user` collectors, batch concrete questions (mandatory / critical first). Prefer short asks tied to Check IDs, e.g.:
   - AUTHN-M1: “What’s the running app base URL to probe?”
   - AUTHN-M2: “Can you drop a redacted MCP/S2S inventory under `./aprf-assessment/imports/mcp-s2s-inventory/`, or confirm `APRF_ADMIN_*` is set locally for live fetch? (Do not paste the secret here.)”
   - SEC2-M2 (PARTIAL with config only): “Do you have a ≤90d canary harness JSON for `./aprf-assessment/imports/secret-redaction/` (cases + detectionRatePct=100)?” Offer `NOT_APPLICABLE` only when scope evidence shows logging/tracing are out of scope; otherwise keep `PARTIAL` / `NOT_DEMONSTRATED` and keep requesting the canary.
   - Other hybrid Checks: ask for the specific `./aprf-assessment/imports/<plugin>/` file or env the collector names in `requiredEvidenceMissing` / collector notes.
5. When the user answers with a URL, confirms credential/token env vars, a path, or an import, re-run collect → assess → report → verify (or full `audit`) with those inputs. Never invent PASS from chat-only YES.

Optional runtime exports (langsmith, etc.) that are truly out of scope can stay “optional import — not a failure,” but still **ask once** whether they have an export rather than assuming silence means skip.

## Assess limits (be honest)

CLI assess is **deterministic** from collector `statusHint`s + evidence-graph nodes:

- Scored Checks → `PASS` / `FAIL` / `PARTIAL` / `NOT_APPLICABLE`
- Unscored profile mandatories → `NOT_DEMONSTRATED` (gate blockers)
- Chat YES without an artifact → keep `PARTIAL` / do not upgrade to PASS
- The CLI does **not** interview; **you must** ask in chat for URLs, creds, and import paths

For full YES/NO/DON'T KNOW attestation methodology, see the portable skill in the APRF repo: `skills/aprf-auditor/` on [github.com/stackrail-io/APRF](https://github.com/stackrail-io/APRF).

## Wrong pipeline (abort and restart)

If you find yourself opening StackRail Assessments UI, `http://127.0.0.1:3001`, or inventing `run_*` IDs — **stop**. Re-run with this skill and `npx @stackrail-io/aprf@0.1.5 audit`.

## Non-AI / framework repos

- **AI framework / SDK** (CrewAI, LangGraph library, …): `--profile framework` / `--system-type ai-framework`. Report `assessmentKind=aprf-framework` — **not** Core production readiness.
- **Console / catalog / non–GenAI platform:** say so in the summary; use auditor `scopes/non-ai-platform.yaml` (CLI assess does not score non-ai yet). Skip live base-URL asks when there is no customer-facing HTTP AI API.
