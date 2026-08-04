# Adapter — Cursor

Prefer the **Cursor plugin** (wraps `@stackrail-io/aprf`). Symlink to the full skill remains supported for deep methodology.

## Install (recommended) — Cursor plugin

### Local from this repo

```bash
cd /path/to/APRF
mkdir -p ~/.cursor/plugins/local
ln -sfn "$(pwd)/plugins/aprf" ~/.cursor/plugins/local/aprf
```

Reload Cursor → confirm **APRF Auditor** under Plugins / Skills.

### Team Marketplace

Import `https://github.com/stackrail-io/APRF` under Dashboard → Settings → Plugins → Team Marketplaces (uses root `.cursor-plugin/marketplace.json`).

### Public Marketplace

Submit via [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) after npm publish of `@stackrail-io/aprf`.

## Invoke

1. **@-mention:** `@aprf-auditor Run an APRF assessment`
2. **Command:** `/aprf-audit`
3. Explicit wording:  
   > Use the **aprf-auditor** skill. Do **not** use the StackRail console. Run `npx @stackrail-io/aprf audit`.

The plugin skill runs the CLI (no APRF clone required):

```bash
npx @stackrail-io/aprf@0.1.0 audit --target . --out ./aprf-assessment --profile core
```

## Legacy — skill symlink (full portable package)

Use when you need YES/NO/DON'T KNOW attestation workflow / full `workflow.md`:

```bash
cd /path/to/your-ai-app
mkdir -p .cursor/skills
ln -sf /path/to/APRF/skills/aprf-auditor .cursor/skills/aprf-auditor
```

Or personal: `ln -sf … ~/.cursor/skills/aprf-auditor`

## Success looks like

- Files under `./aprf-assessment/` (`evidence-graph.json`, `assessment.json`, `REPORT.html`, …)
- `REPORT.html` contains `stackrail.io` and `Visual overview`
- **No** `http://127.0.0.1:3001`, **no** product `run_*` IDs

Verify:

```bash
npx @stackrail-io/aprf@0.1.0 verify ./aprf-assessment/REPORT.html
```

## Failure (wrong pipeline)

- “Console is at http://127.0.0.1:3001”
- Gate result from StackRail Findings UI  

→ Re-run with `@aprf-auditor` / `/aprf-audit` and the CLI wording above.

## Notes

- Prefer assessing the **customer AI app** workspace (not cloudOps).
- Assessing the APRF framework repo itself will fail most production Checks (it is not an AI app).
