# `@stackrail-io/aprf`

Local APRF CLI — collect evidence, assess from collector `statusHint`s, render `REPORT.html`.

Pinned Check catalog via `@stackrail-io/aprf-engine`. No StackRail backend required.

## Install

```bash
npm install -g @stackrail-io/aprf
# or
npx @stackrail-io/aprf@latest version
```

Requires **Node.js ≥ 22**.

**Cursor:** install the plugin under [`plugins/aprf/`](../../plugins/aprf/) (see its README) — skill/commands call this CLI.

## Commands

```bash
# Collect evidence graph + per-plugin import reports
aprf collect --target /path/to/app --out ./aprf-assessment

# Score profile mandatories from collector statusHints (v0)
aprf assess --out ./aprf-assessment --profile core

# Render + verify HTML
aprf report --in ./aprf-assessment/assessment.json --out ./aprf-assessment/REPORT.html
aprf verify ./aprf-assessment/REPORT.html

# One shot: collect → assess → report → verify
aprf audit --target /path/to/app --profile core
```

## Assess engine (deterministic)

Aligned with auditor `scoring.yaml` / `confidence.yaml` / `evidence-precedence.yaml`:

- Status from `imports/*/…-report.json` `statusHint`, else collector detail (`CHECK status=…`)
- Evidence-graph nodes with `relatedCheckIds` attached (precedence-ranked)
- Mandatory gate: every applicable mandatory is `PASS` or `NOT_APPLICABLE`
- `NOT_APPLICABLE` is excluded (`passed: false`) — not a vanity pass
- Unscored profile Checks → `NOT_DEMONSTRATED` (blocker if mandatory)
- `recommendedScore` = severity-weighted recommended Checks only
- Optional `--lens rag,agents,voice,coding`

Agent YES/NO/DON'T KNOW attestation fills remain in [`skills/aprf-auditor`](../../skills/aprf-auditor/).

## Versions

| Package | Role |
| --- | --- |
| `@stackrail-io/aprf` | This CLI |
| `@stackrail-io/aprf-engine` | Normative Check catalog |
| `@stackrail-io/aprf-framework-definition` | Profiles / lenses |

`aprf version` prints CLI + catalog SemVer.

## License

Apache-2.0
