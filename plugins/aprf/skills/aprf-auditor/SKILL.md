---
name: aprf-auditor
description: >-
  Local APRF assessment via @stackrail-io/aprf CLI (no StackRail console, no
  localhost:3001, no run_* IDs). Prefer `npx @stackrail-io/aprf@0.1.0 audit`.
  Writes aprf-assessment/ with evidence-graph.json, assessment.json, REPORT.html.
  Use for "Run an APRF assessment", "APRF audit", "AI production readiness",
  or "@aprf-auditor". Do NOT use the StackRail product Assessments UI.
---

# APRF Auditor (Cursor plugin)

Runs the **open APRF CLI** against the current workspace. Catalog is pinned by
`@stackrail-io/aprf-engine` — **do not** require cloning the APRF repo.

## Invariants

1. **No StackRail backend / console / `localhost:3001` / product `run_*` IDs.**
2. Never invent evidence. Unscored Checks stay `NOT_DEMONSTRATED`.
3. **`REPORT.html` must come from the CLI** (`aprf report` / `aprf audit`) — never hand-write HTML.
4. Write all artifacts under **`./aprf-assessment/`** in the target project.

## Preferred path (one command)

Requires **Node.js ≥ 22**. Resolve the CLI in this order:

1. **APRF checkout** (workspace has `packages/aprf/package.json`):

```bash
npm run build -w @stackrail-io/aprf
node packages/aprf/dist/cli.js audit --target . --out ./aprf-assessment --profile core
```

2. **Published npm** (any other project):

```bash
npx @stackrail-io/aprf@0.1.0 audit --target . --out ./aprf-assessment --profile core
```

Variants (same flags on either binary):

```bash
# Regulated profile
… audit --target . --profile regulated

# Lenses (extra mandatories)
… audit --target . --profile core --lens rag,agents

# Full catalog
… audit --target . --full
```
## Step-by-step (when not using `audit`)

```bash
npx @stackrail-io/aprf@0.1.0 collect --target . --out ./aprf-assessment
npx @stackrail-io/aprf@0.1.0 assess  --out ./aprf-assessment --profile core
npx @stackrail-io/aprf@0.1.0 report  --in ./aprf-assessment/assessment.json --out ./aprf-assessment/REPORT.html
npx @stackrail-io/aprf@0.1.0 verify  ./aprf-assessment/REPORT.html
```

## After the run

1. Confirm files exist: `evidence-graph.json`, `assessment.json`, `REPORT.html`.
2. Confirm `REPORT.html` contains `stackrail.io` and `Visual overview`.
3. Summarize for the user: gate PASS/FAIL, blocker count, critical blockers, top P0/P1 findings from `assessment.json`.
4. For `needs-user` collectors (langsmith, etc.): explain optional `aprf-assessment/imports/<plugin>/` drops — not failures.
5. Offer to dig into specific Check IDs or add import evidence and re-run `assess` + `report`.

## Assess limits (be honest)

CLI assess is **deterministic** from collector `statusHint`s + evidence-graph nodes:

- Scored Checks → `PASS` / `FAIL` / `PARTIAL` / `NOT_APPLICABLE`
- Unscored profile mandatories → `NOT_DEMONSTRATED` (gate blockers)
- Not a StackRail attestation; not YES/NO/DON'T KNOW human fills

For deeper agent methodology (attestation Phase 2b, full workflow), see the portable skill in the APRF repo: `skills/aprf-auditor/` on [github.com/stackrail-io/APRF](https://github.com/stackrail-io/APRF).

## Wrong pipeline (abort and restart)

If you find yourself opening StackRail Assessments UI, `http://127.0.0.1:3001`, or inventing `run_*` IDs — **stop**. Re-run with this skill and `npx @stackrail-io/aprf@0.1.0 audit`.

## Non-AI / platform repos

If the workspace is a console, catalog, or non–GenAI platform (not a customer AI app), say so in the summary and prefer `--profile core` without claiming full AI production readiness. Optional scope docs live in the APRF repo under `skills/aprf-auditor/scopes/`.
