# Adapter — OpenAI Codex / Codex CLI

## Install

Place APRF next to the project under assessment. In the agent instructions (AGENTS.md or session preamble):

```text
You are running the APRF Auditor skill.
Follow APRF/skills/aprf-auditor/system.md and workflow.md exactly.
Use evidence-map.yaml and scoring.yaml.
Source of truth: APRF/packages/aprf-engine/rules/**/*.yaml
Profiles: APRF/packages/framework-definition/src/profiles.ts
Outputs: ./aprf-assessment/{REPORT.md,assessment.json,assessment.sarif,issues.json}
Validate assessment.json against output-schema.json.
```

## Invoke

> Run an APRF assessment

## Tips

- Use repository tools to glob and read files; do not summarize without citations.
- Sort globs for deterministic evidence lists.
