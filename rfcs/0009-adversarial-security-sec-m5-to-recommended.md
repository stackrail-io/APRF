# APRF-RFC-0009: Demote adversarial-security SEC-M5 to recommended (SEC-R3)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-01 |
| SemVer impact | MINOR |
| Related | [APRF-RFC-0008](0008-explainability-exp-m4-to-recommended.md) (pre-release M→R pattern) |

## Problem

**SEC-M5** required **canary tokens or tripwires** as a **Regulated mandatory** (`must`, `minCriticality: 3`, `requiredFromLevel: 5`). That mandates a **specific detection technology** rather than a **security outcome**.

Production-ready systems commonly detect AI-context exfiltration via DLP, SIEM/UEBA, CloudTrail/GuardDuty-class monitoring, Purview/Insider Risk, prompt/completion egress alerts, or other controls—**without** honeytokens. Failing Regulated solely for missing canaries creates false fails for banks, SaaS, and enterprise document-AI stacks that already meet the real objective:

> Sensitive AI contexts have mechanisms to detect data exfiltration attempts.

| Stronger / adjacent control | What it already proves |
| --- | --- |
| **SEC-M1** | Injection cannot authorize privileged tools without server-side policy |
| **SEC-M4** | Model/tool identity cannot freely proxy to internal admin/data stores |
| **SEC-M3** | Abuse/jailbreak/injection suites gate customer-facing releases |
| **PRI / SCI / INF** | Classification, egress, and runtime boundaries reduce exfil surface |

Canaries remain an excellent implementation; they must not be the only path to PASS.

## Proposal

1. **Demote** SEC-M5 → **SEC-R3** (recommended `should` language).
2. **Reframe** the Check around **exfiltration-detection outcome** for sensitive AI contexts. Acceptable mechanisms include canary/honeytokens **or** equivalent DLP/SIEM/UEBA/egress-monitoring controls with validation evidence.
3. **Remove** SEC-M5 from Regulated `mandatoryCheckIds` (Regulated 51→50; tier3-only 13→12). Core unchanged (38).
4. **Remove** SEC-M5 from ai-security **mandatoryChecks** in `aprf-spec.json`; add SEC-R3 under **recommendedChecks**.
5. Keep **SEC-M1–M4** as the adversarial-security mandatory spine.

## Alternatives considered

- Soften passCondition but keep Regulated mandatory — rejected; still blocks Tier-3 for a technology choice.
- Demote in place (`gate: recommended` on SEC-M5) — rejected; recommended Checks use the `*-R*` namespace.
- Conditional mandatory (only when canaries are “feasible”) — rejected; still centers the technology rather than the outcome.
- Merge into SEC-M4 / PRI — rejected; egress boundaries and classification reduce surface but do not prove **detection** of exfil attempts.

## Compatibility

| Change | Impact |
| --- | --- |
| SEC-M5 removed; SEC-R3 added | Catalog mandatory −1; recommended +1; total Checks unchanged (178) |
| Core | Unchanged (38) |
| Regulated | 51→50 (SEC-M5 removed) |
| Crosswalk / relatedRules | Remapped SEC-M5 → SEC-R3 |
| Collector / plugin | `ai-exfil-detection` maps to SEC-R3 |

SemVer: **MINOR** — profile gate set and Check ID remapping while still on working-draft `0.10.x`.

**Pre-release exception:** no tagged release yet — SEC-M5 YAML removed rather than deprecated stub. Recorded in [`id-gaps.md`](../packages/aprf-engine/rules/_index/id-gaps.md). After first tagged release, future demotions must use `deprecated` + `replacedBy`.

## Security considerations

No weakening of injection mediation, release gates, or model-path egress boundaries. Residual risk is slower or less targeted detection of prompt/tool exfil in sensitive contexts when operators skip both canaries **and** equivalent monitoring; mitigated by high-severity SEC-R3 plus SEC-M4/PRI siblings.

## Open questions

- Should Regulated later re-include a **conditional** mandatory when the system handles regulated personal data or secrets in prompts/tools and lacks any exfil-detection class?
- Should synthetic “0 silent misses” suites be required when the mechanism is SIEM/DLP-only (alert-rule review) vs canary-only (injection test)?

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
