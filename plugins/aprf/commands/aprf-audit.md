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
2. **Before the first run (AI apps):** ask for a running **base URL**, and either an MCP inventory path or confirmation that admin/limited **email+password** or **bearer token** env vars are set locally (`APRF_ADMIN_*` / `APRF_AUTHZ_*`). **Never ask the user to paste passwords or tokens into chat.** If none, say you will run code-only and live Checks will stay undemonstrated.
3. Shell (offline / code-only) when no URL yet:

```bash
npx @stackrail-io/aprf@0.1.4 audit --target . --out ./aprf-assessment --profile core
```

4. When the user provides a running app and confirms credential env vars are available (auto-enables live collectors; secrets never persisted). Prefer **env vars** set outside chat (secret manager or non-echoing prompt) — the CLI reads them without `--*-password` / `--*-token` flags:

```bash
# Prerequisites already set in the local shell (do not paste secrets into chat):
#   Email/password: APRF_ADMIN_EMAIL + APRF_ADMIN_PASSWORD
#   — or — token-only: APRF_ADMIN_TOKEN
# Optional AUTHZ-M1: APRF_AUTHZ_LIMITED_EMAIL + APRF_AUTHZ_LIMITED_PASSWORD
#   — or — APRF_AUTHZ_LIMITED_TOKEN
npx @stackrail-io/aprf@0.1.4 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080
```

Do **not** pass `--admin-password`, `--limited-password`, `--admin-token`, or `--limited-token` on the command line (argv is visible to process lists / CI logs). Equivalent flags exist for tooling but are discouraged for secrets.

5. If the user asked for regulated / lenses, adjust flags (`--profile regulated`, `--lens rag,agents`).
6. Other collector evidence: drop measured JSON under `./aprf-assessment/imports/<pluginId>/` (or set env like `GITHUB_TOKEN`).
7. Open/summarize `./aprf-assessment/assessment.json` and confirm `REPORT.html` has `stackrail.io` + `Visual overview`.
8. List gate result, blocker count, and top P0/P1 findings.
9. **Ask for missing evidence** (batched, mandatory/critical first): convert `NOT_DEMONSTRATED` / `PARTIAL` / `needs-user` gaps into concrete questions (base URL, whether credential env is set, import path, canary harness, inventory export). When they answer with a URL, confirm credentials/tokens are available, a path, or an import, re-run collect → assess → report → verify (or full `audit`) with those inputs. Never invent PASS from chat-only YES. For SEC2-M2, offer `NOT_APPLICABLE` only when scope evidence shows logging/tracing are out of scope; otherwise keep `PARTIAL` / `NOT_DEMONSTRATED`.

## Do not

- Use StackRail console, Assessments UI, or `localhost:3001`.
- Hand-write `REPORT.html`.
- Invent evidence for missing Checks.
- Ask users to paste passwords or tokens into chat.
- End with only a gap list when a direct question would unblock a Check.
