# APRF-RFC-0003: Demote observability OBS-M2 to recommended (OBS-R4)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Index summary | Demotes OBS-M2→OBS-R4 (token/cost attribution); removes from Core/Regulated mandatories; pre-release ID-removal exception. |
| Related | [APRF-RFC-0002](0002-incident-readiness-mandatory-to-recommended.md) (pre-release ID-removal exception) |

## Problem

**OBS-M2** required token/cost attribution per request/feature/tenant as a **Core mandatory**. That over-weights FinOps labeling relative to production-blocking gates (identity, injection, pinned models, containment, spend ceilings). Teams with OBS-M1 linkage and COST spend limits still failed Core when attribution labels were incomplete.

## Proposal

1. **Demote** OBS-M2 → **OBS-R4** (recommended `should` language; hybrid detection via `repo-ai-token-cost-attribution`).
2. **Remove** OBS-M2 from Core and Regulated `mandatoryCheckIds` (Core 39→38; Regulated 55→54; tier3-only unchanged).
3. Keep **OBS-M1** (trace linkage) and sensitive-field redaction as observability mandatories (redaction Check later renumbered **OBS-M3 → OBS-M2** into the vacated mandatory slot; see `id-gaps.md`).
4. Pass condition unchanged in substance: ≥95% attributed billed calls over 24h with request + feature + tenant (or equivalent) labels; attest `measuredAt` ≤90d.

## Alternatives considered

- Soften passCondition but keep mandatory — rejected; still blocks Core for a FinOps maturity control.
- Demote in place (`gate: recommended` on OBS-M2) — rejected; recommended Checks use `*-R*` namespace.

## Compatibility

| Change | Impact |
| --- | --- |
| OBS-M2 removed; OBS-R4 added | Core −1; Regulated −1; recommended +1 |
| Crosswalk / relatedRules | Remapped OBS-M2 → OBS-R4 |

**Pre-release exception:** no tagged release yet — OBS-M2 YAML removed rather than deprecated stub. Recorded in [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). After first tagged release, future demotions must use `deprecated` + `replacedBy`.

## Security considerations

No change to spend ceilings (COST-M1/M3) or trace redaction (mandatory sensitive-field Check). Residual risk is slower cost forensics; mitigated by keeping OBS-R4 high-severity recommended with hybrid collectors.

## Open questions

- Should Regulated re-include token attribution as mandatory once Level-5 FinOps guidance is ratified?

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted
- [x] Security / safety considered
- [x] Open questions listed
