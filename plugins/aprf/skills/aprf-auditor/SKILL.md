---
name: aprf-auditor
# Slash entry is /aprf-audit (commands/). Keep this skill model-usable but off the
# / menu so it does not duplicate the portable repo skill or the audit command.
user-invocable: false
description: >-
  Local APRF assessment via @stackrail-io/aprf CLI (no StackRail console, no
  localhost:3001, no run_* IDs). Prefer `npx @stackrail-io/aprf@0.1.3 audit`.
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

Classify the target (`ai-application` vs `non-ai-platform`). For an AI app, **ask up front** (do not wait until after a code-only run):

1. **Running base URL?** (e.g. `http://127.0.0.1:8080`) — needed for AUTHN-M1 / live probes.
2. If tools/MCP look present: **MCP/S2S inventory path** under `imports/mcp-s2s-inventory/`, or admin token/email+password for live fetch (AUTHN-M2).
3. Optional for AUTHZ-M1: admin + limited-user creds (or say you’ll use admin-created temp user).

If the user has no runnable instance, say so and continue offline — do **not** invent PASS for live Checks.

When they provide a URL/creds, re-run with live flags (passwords never persisted in artifacts).

## Preferred path (one command)

Requires **Node.js ≥ 22**. Resolve the CLI in this order:

1. **APRF checkout** (workspace has `packages/aprf/package.json`):

```bash
npm run build -w @stackrail-io/aprf
node packages/aprf/dist/cli.js audit --target . --out ./aprf-assessment --profile core
```

2. **Published npm** (any other project):

```bash
npx @stackrail-io/aprf@0.1.3 audit --target . --out ./aprf-assessment --profile core
```

Variants (same flags on either binary):

```bash
# Live collectors (AUTHN-M1 / AUTHZ-M1 / AUTHN-M2) — auto-enables live mode
… audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080 \
  --admin-email "$APRF_ADMIN_EMAIL" \
  --admin-password "$APRF_ADMIN_PASSWORD"

# Regulated profile
… audit --target . --profile regulated

# Lenses (extra mandatories)
… audit --target . --profile core --lens rag,agents

# Full catalog
… audit --target . --full
```

Optional: `--limited-email` / `--limited-password` for AUTHZ-M1; other evidence via `aprf-assessment/imports/<plugin>/` or env (`GITHUB_TOKEN`, …).

## Step-by-step (when not using `audit`)

```bash
npx @stackrail-io/aprf@0.1.3 collect --target . --out ./aprf-assessment
npx @stackrail-io/aprf@0.1.3 assess  --out ./aprf-assessment --profile core
npx @stackrail-io/aprf@0.1.3 report  --in ./aprf-assessment/assessment.json --out ./aprf-assessment/REPORT.html
npx @stackrail-io/aprf@0.1.3 verify  ./aprf-assessment/REPORT.html
```

## After the run (summarize, then ask)

1. Confirm files exist: `evidence-graph.json`, `assessment.json`, `REPORT.html`.
2. Confirm `REPORT.html` contains `stackrail.io` and `Visual overview`.
3. Summarize: gate PASS/FAIL, blocker count, critical blockers, top P0/P1 from `assessment.json`.
4. **Ask for missing evidence** — do not stop at a gap list. From `NOT_DEMONSTRATED`, `PARTIAL`, and `needs-user` collectors, batch concrete questions (mandatory / critical first). Prefer short asks tied to Check IDs, e.g.:
   - AUTHN-M1: “What’s the running app base URL to probe?”
   - AUTHN-M2: “Can you drop a redacted MCP/S2S inventory under `aprf-assessment/imports/mcp-s2s-inventory/`, or share admin creds for live fetch?”
   - SEC2-M2 (PARTIAL with config only): “Do you have a ≤90d canary harness JSON for `imports/secret-redaction/` (cases + detectionRatePct=100), or should we mark logging/tracing N/A?”
   - Other hybrid Checks: ask for the specific `imports/<plugin>/` file or env the collector names in `requiredEvidenceMissing` / collector notes.
5. When the user answers with a URL, path, or import, re-run collect/assess/report (or full `audit`) with those inputs. Never invent PASS from chat-only YES.

Optional runtime exports (langsmith, etc.) that are truly out of scope can stay “optional import — not a failure,” but still **ask once** whether they have an export rather than assuming silence means skip.

## Assess limits (be honest)

CLI assess is **deterministic** from collector `statusHint`s + evidence-graph nodes:

- Scored Checks → `PASS` / `FAIL` / `PARTIAL` / `NOT_APPLICABLE`
- Unscored profile mandatories → `NOT_DEMONSTRATED` (gate blockers)
- Chat YES without an artifact → keep `PARTIAL` / do not upgrade to PASS
- The CLI does **not** interview; **you must** ask in chat for URLs, creds, and import paths

For full YES/NO/DON'T KNOW attestation methodology, see the portable skill in the APRF repo: `skills/aprf-auditor/` on [github.com/stackrail-io/APRF](https://github.com/stackrail-io/APRF).

## Wrong pipeline (abort and restart)

If you find yourself opening StackRail Assessments UI, `http://127.0.0.1:3001`, or inventing `run_*` IDs — **stop**. Re-run with this skill and `npx @stackrail-io/aprf@0.1.3 audit`.

## Non-AI / platform repos

If the workspace is a console, catalog, or non–GenAI platform (not a customer AI app), say so in the summary and prefer `--profile core` without claiming full AI production readiness. Optional scope docs live in the APRF repo under `skills/aprf-auditor/scopes/`. Skip live base-URL asks when there is no customer-facing HTTP AI API.
