# Adapter — Claude Code

## Install

```bash
git clone https://github.com/stackrail-io/APRF.git
# Point Claude Code at the skill directory via project instructions or CLAUDE.md:
```

Add to `CLAUDE.md` in the target project:

```markdown
## APRF Auditor
When asked to run an APRF assessment, load and follow:
- ../APRF/skills/aprf-auditor/system.md
- ../APRF/skills/aprf-auditor/workflow.md
- ../APRF/skills/aprf-auditor/evidence-map.yaml
- ../APRF/skills/aprf-auditor/scoring.yaml
Emit artifacts per output-schema.json into ./aprf-assessment/
```

## Invoke

> Run an APRF assessment on this repository using APRF Core

## Rules

- Catalog path: `APRF/packages/aprf-engine/rules/`
- For Checks that would be NOT_DEMONSTRATED, ask YES / NO / DON'T KNOW (workflow Phase 2b)
- YES alone → PARTIAL; NO → FAIL; DON'T KNOW → NOT_DEMONSTRATED; never invent evidence
- No StackRail backend calls
