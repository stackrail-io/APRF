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
| **http-auth-probe** | `http-auth-probe.ts` | route catalog | `imports/http-auth-probe/` | **`--base-url` probe** |
| promptfoo | `promptfoo.ts` | eval configs | `imports/promptfoo/` | — |
| aws / azure / gcp | `iac-cloud.ts` | Terraform/Bicep signals | `imports/<cloud>/` | — |
| langsmith, phoenix, … | `import-ingest.ts` | — | `imports/<id>/` | — |
| **custom** | `import-ingest.ts` | — | **`imports/custom/`** | — |
| **agent-charter-inventory** | `agent-charter-inventory.ts` | inventory/charters | `imports/agent-charter-inventory/` | — |
| **agent-loop-limits** | `agent-loop-limits.ts` | agent limit config/tests | `imports/agent-loop-limits/` | — |
| **agent-kill-switch** | `agent-kill-switch.ts` | kill API / cancel tests | `imports/agent-kill-switch/` | — |
| **a2a-peer-auth** | `a2a-peer-auth.ts` | A2A handoff auth/scope | `imports/a2a-peer-auth/` | — |

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

Detects secrets-manager refs, CI secret-scan config, and high-confidence embedded secrets (values never stored). Writes `imports/secrets-hygiene/secrets-hygiene-report.json`.

### SEC2-M2 — Log/trace secret redaction

```bash
npm run aprf:secret-redaction -- \
  --target /path/to/app \
  --out /path/to/app/aprf-assessment
```

Detects redaction config and canary tests; PASS needs measured 100% detection. Writes `imports/secret-redaction/secret-redaction-report.json`.

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
