# APRF Cursor plugin

Local [AI Production Readiness Framework](https://stackrail.io/aprf/) assessments inside Cursor.

Uses **`npx @stackrail-io/aprf`** — no StackRail backend, no clone/symlink required.

## Install

### Local (this repo / development)

```bash
mkdir -p ~/.cursor/plugins/local
ln -sfn "$(pwd)/plugins/aprf" ~/.cursor/plugins/local/aprf
```

Reload Cursor. Confirm **APRF Auditor** appears under Plugins / Skills.

### Team Marketplace

1. Push this repository (or a branch containing `.cursor-plugin/marketplace.json`).
2. Cursor Dashboard → **Settings → Plugins → Team Marketplaces → Import**.
3. Paste `https://github.com/stackrail-io/APRF` (or your fork).
4. Enable the **aprf** plugin for your access group.

### Public Marketplace

Submit at [cursor.com/marketplace/publish](https://cursor.com/marketplace/publish) once `@stackrail-io/aprf` is published on npm.

## Use

In chat:

- `@aprf-auditor Run an APRF assessment`
- Or command **`/aprf-audit`**

The skill runs:

```bash
npx @stackrail-io/aprf@0.1.0 audit --target . --out ./aprf-assessment --profile core
```

Artifacts land in `./aprf-assessment/` (`evidence-graph.json`, `assessment.json`, `REPORT.html`).

## Layout

```text
plugins/aprf/
├── .cursor-plugin/plugin.json
├── assets/logo.svg
├── commands/          # /aprf-audit, /aprf-collect, /aprf-report
├── skills/aprf-auditor/
│   ├── SKILL.md       # CLI-first agent instructions
│   └── reference.md
└── README.md
```

Root marketplace manifest: [`.cursor-plugin/marketplace.json`](../../.cursor-plugin/marketplace.json).

## Related

| Package / path | Role |
| --- | --- |
| `@stackrail-io/aprf` | CLI (collect / assess / report) |
| `@stackrail-io/aprf-engine` | Check catalog |
| `skills/aprf-auditor/` | Full portable skill (Claude, Copilot, deep methodology) |

## License

Apache-2.0
