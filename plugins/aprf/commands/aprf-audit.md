---
name: aprf-audit
description: Run a full local APRF assessment (collect → assess → REPORT.html) via @stackrail-io/aprf
---

# /aprf-audit

Run a **local** APRF assessment on the current workspace using the open CLI.

## Do this

1. Ensure Node.js ≥ 22 is available.
2. Shell (offline / code-only):

```bash
npx @stackrail-io/aprf@0.1.1 audit --target . --out ./aprf-assessment --profile core
```

3. If a running app is available, pass live credentials (auto-enables live collectors; passwords never persisted):

```bash
npx @stackrail-io/aprf@0.1.1 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080 \
  --admin-email "$APRF_ADMIN_EMAIL" \
  --admin-password "$APRF_ADMIN_PASSWORD"
```

Optional AUTHZ-M1 limited user (otherwise admin may create a temporary non-admin user):

```bash
npx @stackrail-io/aprf@0.1.1 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080 \
  --admin-email "$APRF_ADMIN_EMAIL" \
  --admin-password "$APRF_ADMIN_PASSWORD" \
  --limited-email "$APRF_AUTHZ_LIMITED_EMAIL" \
  --limited-password "$APRF_AUTHZ_LIMITED_PASSWORD"
```

4. If the user asked for regulated / lenses, adjust flags (`--profile regulated`, `--lens rag,agents`).
5. Other collector evidence: drop measured JSON under `./aprf-assessment/imports/<pluginId>/` (or set env like `GITHUB_TOKEN`).
6. Open/summarize `./aprf-assessment/assessment.json` and confirm `REPORT.html` has `stackrail.io` + `Visual overview`.
7. List gate result, blocker count, and top P0/P1 findings.

## Do not

- Use StackRail console, Assessments UI, or `localhost:3001`.
- Hand-write `REPORT.html`.
- Invent evidence for missing Checks.
