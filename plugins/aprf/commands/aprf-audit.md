---
name: aprf-audit
description: Run a full local APRF assessment (collect → assess → REPORT.html) via @stackrail-io/aprf
---

# /aprf-audit

Run a **local** APRF assessment on the current workspace using the open CLI.

## Do this

1. Ensure Node.js ≥ 22 is available.
2. Shell:

```bash
npx @stackrail-io/aprf@0.1.0 audit --target . --out ./aprf-assessment --profile core
```

3. If the user asked for regulated / lenses, adjust flags (`--profile regulated`, `--lens rag,agents`).
4. Open/summarize `./aprf-assessment/assessment.json` and confirm `REPORT.html` has `stackrail.io` + `Visual overview`.
5. List gate result, blocker count, and top P0/P1 findings.

## Do not

- Use StackRail console, Assessments UI, or `localhost:3001`.
- Hand-write `REPORT.html`.
- Invent evidence for missing Checks.
