# APRF CLI reference

Package: `@stackrail-io/aprf` (Node ≥ 22)

## Commands

| Command | Purpose |
| --- | --- |
| `aprf audit` | collect → assess → report → verify |
| `aprf collect` | Write `evidence-graph.json` + `imports/*` |
| `aprf assess` | Score `assessment.json` from statusHints |
| `aprf resolve-target` | Dry-run `resolveAssessmentTarget` (`--json`) |
| `aprf report` | Render `REPORT.html` from `assessment.json` |
| `aprf verify` | Check official HTML markers |
| `aprf version` | CLI + catalog SemVer |

## Common flags

| Flag | Applies to | Meaning |
| --- | --- | --- |
| `--target <dir>` | collect, audit | Project root (default: cwd) |
| `--out <dir>` | collect, assess, audit | Output dir (default: `./aprf-assessment`) |
| `--profile core\|regulated\|framework` | assess, audit, resolve-target | Gate profile |
| `--system-type ai-application\|ai-framework\|non-ai-platform` | assess, audit, resolve-target | Target kind (default `ai-application`; `--profile framework` infers `ai-framework`) |
| `--capabilities rag,agents,…` | assess, audit, resolve-target | applicationCapabilities (ai-application; additive) |
| `--lens rag,agents,voice,coding` | assess, audit, resolve-target | Extra mandatories |
| `--full` | assess, audit | Entire catalog (`ai-application` only) |
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
# Prerequisites already set in the local shell (never pass passwords/tokens on argv):
#   APRF_ADMIN_EMAIL + APRF_ADMIN_PASSWORD  — or — APRF_ADMIN_TOKEN
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --profile core \
  --base-url http://127.0.0.1:8080
```

Framework / SDK:

```bash
npx @stackrail-io/aprf@0.1.5 audit --target . --out ./aprf-assessment --profile framework
npx @stackrail-io/aprf@0.1.5 resolve-target --system-type ai-framework --json
```

Other evidence: `./aprf-assessment/imports/<pluginId>/*.json`, or env such as `GITHUB_TOKEN`.

## npm

```bash
npx @stackrail-io/aprf@0.1.5 <command> …
# or after publish:
npm install -g @stackrail-io/aprf
aprf audit --target . --profile core
```

## Related packages

| Package | Role |
| --- | --- |
| `@stackrail-io/aprf` | This CLI |
| `@stackrail-io/aprf-engine` | Check catalog |
| `@stackrail-io/aprf-framework-definition` | Profiles / lenses / resolveAssessmentTarget |

Spec / RFCs: https://github.com/stackrail-io/APRF
