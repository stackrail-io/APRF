---
name: aprf-audit
description: Run a full local APRF assessment (collect → assess → REPORT.html) via @stackrail-io/aprf
---

# /aprf-audit

Run a **local** APRF assessment on the current workspace using the open CLI.

The CLI finishes deterministically. **You must still ask** the user for missing
runtime inputs and import evidence — do not only summarize gaps.

## Do this

1. Ensure Node.js ≥ 22 is available.
2. **Before the first run (AI apps):** ask for a running **base URL** and either admin/limited **email+password**, **bearer tokens** (`APRF_ADMIN_TOKEN` / `APRF_AUTHZ_LIMITED_TOKEN`), or an MCP inventory path if relevant. If none, say you will run code-only and live Checks will stay undemonstrated.
3. Shell (offline / code-only) when no URL yet:

```bash
npx @stackrail-io/aprf@0.1.3 audit --target . --out ./aprf-assessment --profile core
```

4. When the user provides a running app, pass live credentials (auto-enables live collectors; secrets never persisted). Prefer **env vars** for passwords/tokens so they are not expanded onto argv — the CLI reads them without `--*-password` / `--*-token` flags:

```bash
# Email/password sign-in (AUTHN-M2 / AUTHZ-M1)
export APRF_ADMIN_EMAIL=admin@example.com
export APRF_ADMIN_PASSWORD='…'   # set via secret manager / prompt — not inline in chat logs
npx @stackrail-io/aprf@0.1.3 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080
```

Token-only environments (no email/password) for AUTHN-M2 / AUTHZ-M1:

```bash
export APRF_ADMIN_TOKEN='…'
# Optional AUTHZ-M1 limited user:
# export APRF_AUTHZ_LIMITED_TOKEN='…'
npx @stackrail-io/aprf@0.1.3 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080
```

Optional AUTHZ-M1 limited user via email/password (otherwise admin may create a temporary non-admin user):

```bash
export APRF_ADMIN_EMAIL=admin@example.com
export APRF_ADMIN_PASSWORD='…'
export APRF_AUTHZ_LIMITED_EMAIL=user@example.com
export APRF_AUTHZ_LIMITED_PASSWORD='…'
npx @stackrail-io/aprf@0.1.3 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080
```

Do **not** pass `--admin-password`, `--limited-password`, `--admin-token`, or `--limited-token` on the command line (argv is visible to process lists / CI logs). Equivalent flags exist for tooling but are discouraged for secrets.

5. If the user asked for regulated / lenses, adjust flags (`--profile regulated`, `--lens rag,agents`).
6. Other collector evidence: drop measured JSON under `./aprf-assessment/imports/<pluginId>/` (or set env like `GITHUB_TOKEN`).
7. Open/summarize `./aprf-assessment/assessment.json` and confirm `REPORT.html` has `stackrail.io` + `Visual overview`.
8. List gate result, blocker count, and top P0/P1 findings.
9. **Ask for missing evidence** (batched, mandatory/critical first): convert `NOT_DEMONSTRATED` / `PARTIAL` / `needs-user` gaps into concrete questions (base URL, credentials, import path, canary harness, inventory export). When they answer, re-run collect → assess → report → verify (or full `audit`) with those inputs. Never invent PASS from chat-only YES.

## Do not

- Use StackRail console, Assessments UI, or `localhost:3001`.
- Hand-write `REPORT.html`.
- Invent evidence for missing Checks.
- End with only a gap list when a direct question would unblock a Check.
