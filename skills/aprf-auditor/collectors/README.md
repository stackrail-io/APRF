# APRF Auditor collectors (TypeScript executors)

Shipped **local** collectors that emit `evidence-graph.json`. No StackRail backend.

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
| promptfoo | `promptfoo.ts` | eval configs | `imports/promptfoo/` | — |
| aws / azure / gcp | `iac-cloud.ts` | Terraform/Bicep signals | `imports/<cloud>/` | — |
| langsmith, phoenix, … | `import-ingest.ts` | — | `imports/<id>/` | — |
| **custom** | `import-ingest.ts` | — | **`imports/custom/`** | — |

Plugin YAML under `../plugins/` remains the contract; `executor` points here.

## Agent workflow

1. Run collectors → `evidence-graph.json`
2. Evaluate APRF Checks against the graph (`workflow.md`)
3. Ask user only for missing/weak evidence
