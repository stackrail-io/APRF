# APRF-RFC-0013: Assessment Target Kinds and Framework Profile

| Field | Value |
| --- | --- |
| Status | draft |
| Author(s) | StackRail |
| Created | 2026-08-18 |
| SemVer impact | MINOR |
| Index summary | Adds systemType classification, official aprf-profile-framework, applicationCapabilities→lenses, and resolveAssessmentTarget() so assessments select Checks from framework-definition SoT without mislabeling frameworks as Core. |

## Problem

CLI assess hardcodes `systemType: ai-application` and `assessmentKind: aprf-core` (unless Regulated). Framework/SDK repositories assessed with Core produce PARTIAL floods and false production-readiness F grades. Check YAML `appliesTo`/`notApplicableTo` do not filter at assess time. Operators must know tribal `--lens` flags; the auditor must not own canonical Check ID lists.

## Proposal

### Source of truth

- **Profiles** answer: which mandatory Checks exist for this gate? (`profiles.ts`)
- **Lenses** answer: which additional Checks become applicable? (`lenses.ts`)
- **`resolveAssessmentTarget()`** is the public resolution API; CLI/skill/UI consume it. Do not hand-assemble profile ∪ lenses.

### Level 1 — `systemType`

| Value | Profile / scope | Claim |
| --- | --- | --- |
| `ai-application` | Core or Regulated ∪ capability lenses | Core / Regulated production readiness |
| `ai-framework` | `aprf-profile-framework` | Framework / SDK primitive gate only |
| `non-ai-platform` | Legacy auditor scope (v1) | Platform hygiene subset; Check IDs not yet in profiles.ts |
| `unknown` | — | Must classify before resolve (throws) |

### Level 2 — `applicationCapabilities` (ai-application only)

Orthogonal multi-select set (not exclusive subtypes): `chatbot`, `rag`, `agents`, `multi-agent-a2a`, `mcp-server`, `voice`, `coding-agent`, `other`. Map to default lens IDs in framework-definition. Capabilities are **additive** only — they never remove Core mandatories. Absent surfaces → collector `NOT_APPLICABLE`.

### Official profile `aprf-profile-framework`

Mandatory Check IDs (exact): `AGN-M2`, `TOL-M2`, `TOL-M4`, `SEC-M1`, `SEC2-M1`, `SEC2-M2`, `SCI-M2`.  
`assessmentKind`: `aprf-framework`. Claim language forbids Core/Regulated production-readiness wording.

### Normative precedence order

1. **`systemType` determines profile** (with profileId validation).
2. **Profile selects mandatory Checks** (`profiles.ts`).
3. **`applicationCapabilities` add lenses** (ai-application only).
4. **Explicit CLI `--lens` unions additional lenses** (ignored on ai-framework with warning).
5. **Collector evidence may mark Checks `NOT_APPLICABLE`** inside the resolved set; collectors never expand the gate.

Non-goals: capabilities/`--lens` never replace the profile; collectors never add Checks outside profile ∪ lenses.

### Conflict policies

- `unknown` → throw.
- `ai-framework` + Core/Regulated profile → hard error.
- `ai-application` + Framework profile → hard error.
- `ai-framework` + `--full` → hard error.
- Omit `--system-type` → CLI **asks** on a TTY; non-TTY requires the flag, `APRF_SYSTEM_TYPE`, or `--profile framework` (no silent Core default).
- `--profile framework` without systemType → infer `ai-framework`.
- Empty capabilities on application → Core/Regulated only + warning; empty ≠ `other`.
- Invalid capability ID → hard error.

### CLI

- `--system-type`, `--capabilities`, `--profile framework`
- `aprf resolve-target --json` for skill/dry-run resolution

## Alternatives considered

- Auditor-only `scopes/framework-sdk.yaml` with its own Check lists — rejected; forks SoT.
- Remap framework+core to Framework with warning — rejected; hard error for claim safety.
- Capability-driven removal of Core Checks — rejected; additive only.

## Compatibility

- Default CLI path remains Core for `ai-application` with empty capabilities.
- New profile and `assessmentKind` are additive.
- `non-ai-platform` Check lists remain in auditor scope until a follow-on profile.

## Security considerations

Framework gate must not be marketed as production readiness. REPORT banner and disclaimer carry claim boundary. Product lenses cannot expand a Framework assessment into Core.

## Open questions

1. When to promote `non-ai-platform` to an official profile.
2. Whether `AprfProfile` later embeds claimLanguage fields (v1 keeps resolver table).
3. Follow-on: machine-enforced Check `targetKinds` / `appliesTo`.

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted (N/A)
- [x] Security / safety considered
- [x] Open questions listed

---

Comment window: 14 days from `Created`. Interim contact: see `/aprf/rfc/`. Process: see stewardship in `/aprf/spec/`.
