# Adapter — GitHub Copilot Agent

## Install

1. Check out APRF in the workspace or as a submodule `APRF/`.
2. Add `.github/copilot-instructions.md` (or repo custom instructions):

```markdown
## APRF Auditor Skill
When the user asks to run an APRF assessment:
1. Open `APRF/skills/aprf-auditor/system.md` and `workflow.md`.
2. Load Checks from `APRF/packages/aprf-engine/rules/`.
3. Follow evidence-map.yaml / scoring.yaml.
4. Write `aprf-assessment/` artifacts.
5. Missing evidence → ask YES / NO / DON'T KNOW per Check (workflow Phase 2b). YES alone → PARTIAL; NO → FAIL; DON'T KNOW → NOT_DEMONSTRATED. Never invent evidence.
```

## Invoke

In Copilot Agent chat:

> Run an APRF assessment against this repository (Core profile)

## Issues export

After `issues.json` is written, ask Copilot to open GitHub issues **only if the user confirms**.
