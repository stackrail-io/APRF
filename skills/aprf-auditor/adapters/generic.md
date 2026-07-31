# Adapter — Generic (Gemini CLI, Roo, OpenHands, others)

## Minimal bootstrap prompt

```text
Load and obey the APRF Auditor skill at <APRF>/skills/aprf-auditor/:
- system.md (invariants)
- workflow.md (phases)
- evidence-map.yaml (search strategies)
- scoring.yaml (gate + scores)
- output-schema.json (emit contract)

Normative Checks: <APRF>/packages/aprf-engine/rules/by-domain/**/*.yaml
Domains / pillars: <APRF>/packages/aprf-engine/rules/_index/{domains,pillars}.yaml
Profiles: <APRF>/packages/framework-definition/src/profiles.ts

Assess project at <TARGET>.
Default profile: aprf-profile-core, criticality 2, no lenses.
Missing evidence => ask YES / NO / DON'T KNOW per Check (workflow Phase 2b). YES alone → PARTIAL; NO → FAIL; DON'T KNOW → NOT_DEMONSTRATED. Never hallucinate evidence.
Write: <TARGET>/aprf-assessment/REPORT.md, assessment.json, assessment.sarif, issues.json
```

## Gemini CLI

Paste the bootstrap into the session system instruction or a `GEMINI.md` project file with absolute paths.

## Roo Code / OpenHands

Attach the `skills/aprf-auditor` directory as read-only context; set write scope to `aprf-assessment/`.

## Verification checklist

- [ ] Every control row cites a real Check ID from the catalog
- [ ] No `passed: true` with `notApplicable: true`
- [ ] Gate FAIL if any mandatory is FAIL/PARTIAL/NOT_DEMONSTRATED
- [ ] `assessment.json` validates against `output-schema.json`
