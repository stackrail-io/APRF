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

In chat, prefer the slash command:

- **`/aprf-audit`** — full collect → assess → `REPORT.html`
- **`/aprf-collect`** / **`/aprf-report`** — individual steps

The plugin skill (`aprf-auditor`) is model-invocable background guidance and is **not** listed in the `/` menu, so it does not collide with the portable repo skill at `skills/aprf-auditor/` when this checkout is open.

```bash
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --profile core

# Framework / SDK primitive gate (not Core production readiness)
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --profile framework

# Application with capability lenses
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --profile core \
  --system-type ai-application --capabilities rag,agents

# Live collectors (AUTHN-M1 / AUTHZ-M1 / AUTHN-M2) — same flags on audit and collect.
# Set credentials in the local shell (do not pass passwords/tokens on argv):
#   APRF_ADMIN_EMAIL + APRF_ADMIN_PASSWORD  — or — APRF_ADMIN_TOKEN
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080
```

Artifacts land in `./aprf-assessment/` (`evidence-graph.json`, `assessment.json`, `REPORT.html`).

### If you see two `/aprf-auditor` entries

You almost certainly have **two installs** of the same skill name:

1. Cursor plugin (`~/.cursor/plugins/local/aprf` and/or Team Marketplace **aprf**), and
2. This repo’s portable skill at `skills/aprf-auditor/` (discovered when the APRF workspace is open).

Fix: keep **one** plugin install (local **or** marketplace, not both), reload Cursor, and use **`/aprf-audit`** for the slash entry.

## Layout

```text
plugins/aprf/
├── .cursor-plugin/plugin.json
├── assets/owl-mark.png
├── commands/          # /aprf-audit, /aprf-collect, /aprf-report
├── skills/aprf-auditor/
│   ├── SKILL.md       # CLI + ask-for-missing-evidence agent instructions
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
