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
| `--live` | collect, audit | Allow credentialed APIs |
| `--base-url <url>` | collect, audit | Live HTTP probe (AUTHN-M1) |

## npm

```bash
npx @stackrail-io/aprf@0.1.0 <command> …
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
