---
name: aprf-collect
description: Collect APRF evidence-graph and import reports via @stackrail-io/aprf collect
---

# /aprf-collect

```bash
npx @stackrail-io/aprf@0.1.1 collect --target . --out ./aprf-assessment
```

Optional: `--plugins secrets-hygiene,http-auth-probe`, `--live`, `--base-url http://127.0.0.1:8080`, `--admin-email` / `--admin-password`, `--limited-email` / `--limited-password`.

Then tell the user `evidence-graph.json` was written and offer `/aprf-audit` or `assess` + `report`.
