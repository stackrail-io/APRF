# APRF Assessment Report (excerpt)

**APRF:** 0.10.1 · **Skill:** 0.1.0 · **Profile:** Core · **Gate:** FAIL

## Executive Summary

| Field | Value |
| --- | --- |
| Overall Score (recommended, non-gate) | 0 |
| Overall Grade | F |
| Risk Level | high |
| Assessment Confidence | low |

Illustrative fixture: SEC2-M1 NOT_DEMONSTRATED; AGN-M1 NOT_APPLICABLE.

## Domain Scores

| Domain | Score | Mandatory gate |
| --- | --- | --- |
| Security | 0 | FAIL |
| Agent Safety | 100 | PASS (N/A satisfied exclusion) |

## Controls & Findings (sample)

| Check | Title | Domain | Status | Confidence | Tags | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| SEC2-M1 | Production secrets must live in a secrets manager… | Security | NOT_DEMONSTRATED | low | Production blocker · Critical | P1 |

### SEC2-M1 — Production secrets must live in a secrets manager…

| Field | Value |
| --- | --- |
| Status | NOT_DEMONSTRATED |
| Evidence Found | _(none)_ |
| Reasoning | No secrets-manager configuration or CI secret-scan report found. |
| Confidence | low |
| Recommended Action | Wire secrets manager + CI secret scanning; re-assess. |
| Priority | P1 |

**Evidence required to pass:** Secrets-manager config + CI/repo secret-scan report including prompt and fixture paths.
