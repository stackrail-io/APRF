# APRF-RFC-0008: Demote explainability EXP-M4 to recommended (EXP-R3)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Related | [APRF-RFC-0007](0007-reliability-continuity-rel-m8-to-recommended.md) (pre-release M→R pattern) |

## Problem

**EXP-M4** required material model/prompt promotions to retain a change or counterfactual summary as a **Regulated mandatory** (`must`, `minCriticality: 3`, `requiredFromLevel: 5`). That over-weights **promotion narrative documentation** relative to production-blocking explainability gates:

| Stronger / adjacent control | What it already proves |
| --- | --- |
| **EXP-M1** | Factual/high-stakes RAG answers carry resolvable citations |
| **EXP-M2** | Operators reconstruct decision paths within a documented budget |
| **EXP-M3** | Explanation payloads redact/block secrets and unauthorized data |
| **PRM-M2** | Prompt changes link to review/eval evidence |
| **CHG-M1** | AI artifact change records / registry retention |
| **EVL-M4** | Shadow/A-B or cutover evaluation for promotions |

Change/counterfactual summaries remain valuable Level-5 explainability maturity, but failing Regulated for a missing promotion narrative when citation provenance, path reconstruction, and explanation hygiene already hold creates false fails for teams with staged promotion UX and eval-gated releases.

## Proposal

1. **Demote** EXP-M4 → **EXP-R3** (recommended `should` language; hybrid detection via `repo-ai-change-summary` / `ai-change-summary` collector). Reuses the recommended slot vacated when the regulated explainability matrix was renumbered to **EXP-R2**.
2. **Remove** EXP-M4 from Regulated `mandatoryCheckIds` (Regulated 52→51; tier3-only 14→13). Core unchanged (38).
3. **Remove** EXP-M4 from explainability **mandatoryChecks** in `aprf-spec.json`; add EXP-R3 under **recommendedChecks**.
4. Pass condition unchanged in substance: last material model/prompt promotion retains a change or counterfactual summary; attest `measuredAt` ≤90d.
5. Keep **EXP-M1–M3** as the explainability mandatory spine (citations, path reconstruction, explanation hygiene).

## Alternatives considered

- Soften passCondition but keep Regulated mandatory — rejected; still blocks Tier-3 for promotion-narrative maturity.
- Demote in place (`gate: recommended` on EXP-M4) — rejected; recommended Checks use the `*-R*` namespace.
- Merge into PRM-M2 / CHG-M1 — rejected; those prove review/eval linkage and registry retention, not a human-readable change/counterfactual narrative.
- Merge into EXP-R1 — rejected; EXP-R1 centers on user-facing rationale for material decisions, not version-to-version promotion summaries.

## Compatibility

| Change | Impact |
| --- | --- |
| EXP-M4 removed; EXP-R3 added | Catalog mandatory −1; recommended +1; total Checks unchanged (178) |
| Core | Unchanged (38) |
| Regulated | 52→51 (EXP-M4 removed) |
| Crosswalk / relatedRules | Remapped EXP-M4 → EXP-R3 |
| Collector / plugin | `ai-change-summary` maps to EXP-R3 |

SemVer: **MINOR** — profile gate set and Check ID remapping while still on working-draft `0.10.x`.

**Pre-release exception:** no tagged release yet — EXP-M4 YAML removed rather than deprecated stub. Recorded in [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). After first tagged release, future demotions must use `deprecated` + `replacedBy`.

## Security considerations

No weakening of citation provenance, decision-path reconstruction, or explanation secret/PII hygiene. Residual risk is slower incident/dispute explanation of what changed in the last model/prompt promotion; mitigated by high-severity EXP-R3 plus PRM-M2/CHG-M1/EVL-M4 siblings.

## Open questions

- Should Regulated later re-include promotion change summaries as additional mandatory once Level-5 release-explainability maturity is ratified?
- Should empty “N/A” summaries for non-behavioral promotions be an explicit named-exception path rather than fail?

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created` (working-draft quorum applies). Interim contact: see `/aprf/rfc/`.
