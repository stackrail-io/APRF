---
name: aprf-report
description: Render and verify APRF REPORT.html from assessment.json via the CLI
---

# /aprf-report

```bash
npx @stackrail-io/aprf@0.1.6 report \
  --in ./aprf-assessment/assessment.json \
  --out ./aprf-assessment/REPORT.html
npx @stackrail-io/aprf@0.1.6 verify ./aprf-assessment/REPORT.html
```

Never hand-write HTML. If verify fails, re-run `report`.
