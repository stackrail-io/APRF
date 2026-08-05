# APRF CLI reference

Package: `@stackrail-io/aprf` (Node ≥ 22)

## Commands

| Command | Purpose |
| --- | --- |
| `aprf audit` | collect → assess → report → verify |
| `aprf collect` | Write `evidence-graph.json` + `imports/*` |
| `aprf assess` | Score `assessment.json` from statusHints |
| `aprf report` | Render `REPORT.html` from `assessment.json` |
| `aprf verify` | Check official HTML markers |
| `aprf version` | CLI + catalog SemVer |

## Common flags

| Flag | Applies to | Meaning |
| --- | --- | --- |
| `--target <dir>` | collect, audit | Project root (default: cwd) |
| `--out <dir>` | collect, assess, audit | Output dir (default: `./aprf-assessment`) |
| `--profile core\|regulated` | assess, audit | Gate profile |
| `--lens rag,agents,voice,coding` | assess, audit | Extra mandatories |
| `--full` | assess, audit | Entire catalog |
| `--plugins a,b` | collect, audit | Subset of collectors |
| `--live` | collect, audit | Allow credentialed APIs (auto-on with base-url/creds) |
| `--base-url <url>` | collect, audit | Running app URL (AUTHN-M1, AUTHZ-M1, AUTHN-M2) |
| `--admin-token <tok>` | collect, audit | Admin bearer (`APRF_ADMIN_TOKEN`) |
| `--admin-email <e>` | collect, audit | Admin sign-in email |
| `--admin-password <p>` | collect, audit | Admin sign-in password (never persisted) |
| `--limited-email <e>` | collect, audit | Non-admin user for AUTHZ-M1 denial probe |
| `--limited-password <p>` | collect, audit | Limited-user password |
| `--limited-token <t>` | collect, audit | Limited-user bearer token |

## Live audit example

```bash
npx @stackrail-io/aprf@0.1.2 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080 \
  --admin-email "$APRF_ADMIN_EMAIL" \
  --admin-password "$APRF_ADMIN_PASSWORD"
```

Other evidence: `./aprf-assessment/imports/<pluginId>/*.json`, or env such as `GITHUB_TOKEN`.

## npm

```bash
npx @stackrail-io/aprf@0.1.2 <command> …
# or after publish:
npm install -g @stackrail-io/aprf
aprf audit --target . --profile core
```

## Related packages

| Package | Role |
| --- | --- |
| `@stackrail-io/aprf` | This CLI |
| `@stackrail-io/aprf-engine` | Check catalog |
| `@stackrail-io/aprf-framework-definition` | Profiles / lenses |

Spec / RFCs: https://github.com/stackrail-io/APRF
