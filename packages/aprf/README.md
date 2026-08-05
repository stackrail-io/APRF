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

# Score profile mandatories only (39 for core). Use --full for the whole catalog.
aprf assess --out ./aprf-assessment --profile core

# Render + verify HTML
aprf report --in ./aprf-assessment/assessment.json --out ./aprf-assessment/REPORT.html
aprf verify ./aprf-assessment/REPORT.html

# One shot: collect → assess → report → verify
aprf audit --target . --out ./aprf-assessment --profile core
```

### Live credentials (collect / audit)

Same flags on `collect` and `audit`. Providing `--base-url` or admin/limited creds auto-enables live mode (no separate `--live` required). Passwords/tokens are never written to reports.

```bash
npx @stackrail-io/aprf audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080 \
  --admin-email "$APRF_ADMIN_EMAIL" \
  --admin-password "$APRF_ADMIN_PASSWORD"
```

| Flag | Env | Used by |
| --- | --- | --- |
| `--base-url` | `APRF_AUTH_PROBE_BASE_URL` | AUTHN-M1, AUTHZ-M1, AUTHN-M2 |
| `--admin-token` | `APRF_ADMIN_TOKEN` | AUTHN-M2, AUTHZ-M1 (temp user) |
| `--admin-email` | `APRF_ADMIN_EMAIL` | sign-in → JWT |
| `--admin-password` | `APRF_ADMIN_PASSWORD` | sign-in → JWT |
| `--limited-email` | `APRF_AUTHZ_LIMITED_EMAIL` | AUTHZ-M1 denial probe |
| `--limited-password` | `APRF_AUTHZ_LIMITED_PASSWORD` | AUTHZ-M1 denial probe |
| `--limited-token` | `APRF_AUTHZ_LIMITED_TOKEN` | AUTHZ-M1 denial probe |

Other collector evidence: drop measured JSON under `./aprf-assessment/imports/<pluginId>/`, or set collector-specific env (e.g. `GITHUB_TOKEN` with live mode for github-actions).

## Assess engine (deterministic)

Aligned with auditor `scoring.yaml` / `confidence.yaml` / `evidence-precedence.yaml`:

- Status from `imports/*/…-report.json` `statusHint`, else collector detail (`CHECK status=…`)
- Evidence-graph nodes with `relatedCheckIds` attached (precedence-ranked)
- Mandatory gate: every applicable mandatory is `PASS` or `NOT_APPLICABLE`
- `NOT_APPLICABLE` is excluded (`passed: false`) — not a vanity pass
- Default assess scores **profile mandatories only** (collector hints outside the gate are ignored). `--full` scores the non-deprecated catalog.
- Unscored profile Checks → `NOT_DEMONSTRATED` (blocker if mandatory)
- `recommendedScore` = severity-weighted recommended Checks only (`null` / n/a under default profile assess; use `--full` to score recommended)
- `audit` without `--plugins` / `--full` collects only plugins that map to the profile gate
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
