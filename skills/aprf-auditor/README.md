# APRF Auditor Skill

Vendor-neutral, **local** assessment package for the [AI Production Readiness Framework](https://github.com/stackrail-io/APRF).

Any LLM or coding agent can load this skill, inspect a project, map evidence to APRF Checks, and emit a reproducible report — **without StackRail backends or cloud APIs**.

## Triggers

- Run an APRF assessment / APRF assessment / Do an APRF assessment
- APRF audit / aprf assess
- AI production readiness / Assess AI production readiness
- Production readiness assessment
- Compare APRF assessment / APRF assessment history

## Layout

```
aprf-auditor/
├── SKILL.md / skill.yaml / capabilities.yaml
├── architecture.md          # Collectors → graph → rules → remediation
├── system.md / workflow.md
├── evidence-map.yaml        # Search + AI-specific strategies
├── evidence-precedence.yaml # runtime > ci > iac > … > user
├── confidence.yaml          # Objective confidence scores
├── scoring.yaml
├── evidence-graph.schema.json
├── comparison.schema.json
├── output-schema.json
├── plugins/                 # Collector contracts
├── collectors/              # TypeScript executors (npm run aprf:collect)
├── adapters/
├── examples/
└── tests/
```

## Pipeline

```text
Project → Evidence Collectors (npm run aprf:collect) → Evidence Graph
        → Rule Engine (Check YAML) → Assessment → Remediation → Report
```

Local by default; drop runtime exports under `aprf-assessment/imports/<plugin>/`; live APIs only with `APRF_AUDITOR_LIVE=1`.

1. Read `capabilities.yaml` to know supported CI/cloud/frameworks and evidence classes.
2. Collect into `evidence-graph.json` (do not rescan ad hoc per Check when graph exists).
3. Apply **precedence** and **freshness**; compute **confidence** objectively.
4. Evaluate Checks; attach **remediation** (fix, example, reference, owner, effort).
5. Emit reports; optional **compare** and **history**.

### Missing evidence

Search → for each Check that would be `NOT_DEMONSTRATED`, ask **YES / NO / DON'T KNOW** → map: YES+artifact→PASS/PARTIAL, YES alone→PARTIAL (low), NO→FAIL, DON'T KNOW→`NOT_DEMONSTRATED`. Never invent FAIL from silence; never invent files from YES.

### Precedence (who wins)

runtime → ci → iac → runtime-config → policy → code → docs → user

## Quick start

Clone or vendor [APRF](https://github.com/stackrail-io/APRF) so the skill and Check catalog are on disk. Assess the **AI product repo** as the workspace when possible. On consoles / catalogs / non–GenAI tooling, the skill selects **`non-ai-platform`** (`scopes/non-ai-platform.yaml`) and banners the report as **not** an APRF Core AI claim.

Full adapter notes: [`adapters/`](adapters/).

### Cursor

```bash
cd /path/to/your-ai-app
mkdir -p .cursor/skills
ln -sf /path/to/APRF/skills/aprf-auditor .cursor/skills/aprf-auditor
```

In chat: `@aprf-auditor Run an APRF assessment` (or say explicitly to use the local **aprf-auditor** skill — not the StackRail console).

### Claude Code

Add to `CLAUDE.md` in the target project (adjust the relative path to your APRF checkout):

```markdown
## APRF Auditor
When asked to run an APRF assessment, load and follow:
- ../APRF/skills/aprf-auditor/system.md
- ../APRF/skills/aprf-auditor/workflow.md
- ../APRF/skills/aprf-auditor/evidence-map.yaml
- ../APRF/skills/aprf-auditor/scoring.yaml
Emit artifacts per output-schema.json into ./aprf-assessment/
```

Then: `Run an APRF assessment on this repository using APRF Core`

### Codex (OpenAI Codex / Codex CLI)

Place APRF next to the project. Add to `AGENTS.md` (or the session preamble):

```text
You are running the APRF Auditor skill.
Follow APRF/skills/aprf-auditor/system.md and workflow.md exactly.
Use evidence-map.yaml and scoring.yaml.
Source of truth: APRF/packages/aprf-engine/rules/**/*.yaml
Profiles: APRF/packages/framework-definition/src/profiles.ts
Outputs: ./aprf-assessment/{REPORT.md,assessment.json,assessment.sarif,issues.json}
Validate assessment.json against output-schema.json.
```

Then: `Run an APRF assessment`

### GitHub Copilot Agent

1. Check out APRF in the workspace (or as submodule `APRF/`).
2. Add `.github/copilot-instructions.md` (or repo custom instructions):

```markdown
## APRF Auditor Skill
When the user asks to run an APRF assessment:
1. Open `APRF/skills/aprf-auditor/system.md` and `workflow.md`.
2. Load Checks from `APRF/packages/aprf-engine/rules/`.
3. Follow evidence-map.yaml / scoring.yaml.
4. Write `aprf-assessment/` artifacts.
5. Missing evidence → ask YES / NO / DON'T KNOW (Phase 2b). YES alone → PARTIAL; NO → FAIL; DON'T KNOW → NOT_DEMONSTRATED.
```

In Copilot Agent chat: `Run an APRF assessment against this repository (Core profile)`

## Version

| Field | Value |
| --- | --- |
| Skill | `0.2.0` |
| Aligned APRF | `0.10.1` |

## License

Apache-2.0 (same as APRF).
