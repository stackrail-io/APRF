# APRF-RFC-0014: Threat Composition from Multi-Kind Signals

| Field | Value |
| --- | --- |
| Status | draft |
| Author(s) | StackRail |
| Created | 2026-08-26 |
| SemVer impact | MINOR |
| Index summary | Adds a signal registry (production-mechanism kinds) and threat-first composition with a formal evaluator; Checks remain the sole gate unit; threats drive suspected/confirmed exposure only. |

## Problem

APRF Checks are the only normative gate unit, but threat context today is only Check-tagged labels in `spec/aprf-threat-map.yaml`. Collectors emit free-form signal strings with no vocabulary authority. Assessments cannot compose multi-kind observations (artifact, config, process, behavioral, exercise, attested, inferred) into structured threat exposure. Default collect is overwhelmingly static; behavioral and exercise evidence exist in prose and imports but are not declarative on the spec.

## Proposal

### Coupling invariant (normative)

> **Threats never participate in gate computation. Checks never participate in signal composition. The only coupling is that threats may cite Checks as mitigations.**

Conceptual stack:

```text
Evidence → Signal Observations → Threat Evaluation → Exposure Report
                                      ↓
                              Mitigation Lookup → Referenced Checks → Mandatory Gate
```

### Signal kinds (production mechanism)

Kind classifies **how evidence was produced**, orthogonal to trust (E0–E5), freshness, polarity, assurance, origin, and confidence.

| Kind | Question | confirmingEligible (registry) |
| --- | --- | --- |
| `artifact` | What exists? | false |
| `config` | What is configured? | false |
| `process` | What was executed during delivery? | false |
| `behavioral` | What actually happened? | **true** |
| `exercise` | What happened when intentionally tested? | **true** |
| `attested` | What did an authorized human state? | false |
| `inferred` | What does an analysis believe? | false |

Provenance is qualifier `origin` (`system` \| `owner` \| `external` \| `independent`), not an eighth kind.

### SignalDef vs SignalObservation

- **SignalDef** (`spec/aprf-signal-registry.yaml`): `id`, `kind`, `defaultTier`, description, emitters. Vocabulary authority.
- **SignalObservation** (emitted at assess time): `signalId`, `fired`, polarity, measuredAt, origin, assurance, confidence, evidenceNode.

Every emitted `signalId` **must resolve** to exactly one SignalDef. Unknown IDs fail validation after migration; warn during dual-emit migration.

**Kind immutability:** changing `kind` on an existing SignalDef is breaking — require a new signal ID or major-version migration.

### Threat definitions

Threat-first objects in `spec/aprf-threat-composition.yaml` with recursive indicators (`signal` \| `allOf` \| `anyOf`) and mitigations (`primary` \| `supporting`). Per-Check threat-map rows remain for REPORT chips; composition is additive.

### Formal evaluator (deterministic)

```text
indicatorSatisfied(ind):
  signal(id) → exists fired Observation with signalId = id
  allOf(xs)  → every indicatorSatisfied
  anyOf(xs)  → any indicatorSatisfied

threatIndicated  := any(indicatorSatisfied)
threatConfirmed  := indicated AND exists contributing fired Observation
                    where kinds[o.kind].confirmingEligible
threatMitigated  := every primary mitigation Check ∈ {PASS, NOT_APPLICABLE}
exposure         := indicated AND NOT mitigated

status:
  !indicated → not_indicated
  mitigated  → mitigated
  confirmed  → confirmed_exposure
  else       → suspected_exposure
```

Confirmation is computed from **observations**, not SignalDefs. Supporting mitigations affect REPORT only, never exposure. Composition uses explicit signal IDs (`present` / `missing`); no negation syntax in v1.

### Operational binding

- Collectors dual-emit registered signal IDs alongside legacy free-form tags during migration.
- Assess runs the threat evaluator after Check statuses; **mandatory gate unchanged**.
- REPORT Top threat exposure prefers structured composition results when present.

## Alternatives considered

- Gate-driving threats — rejected; breaks ARCHITECTURE hard invariant.
- Binary `static|behavioral` kinds — rejected; conflates production mechanism with trust.
- Eighth `external` kind — rejected; use `origin` qualifier.
- Per-threat `confirmingKinds` override — rejected; registry-global invariant only.
- Composition-time polarity negation — deferred; prefer explicit SignalDef IDs.

## Compatibility

- Additive: existing Checks, threat-map, and gate semantics unchanged.
- Catalog embeds signal registry + threat composition; reverse-index Check→threat IDs for REPORT.
- SemVer MINOR (new informative plane + evaluator API; no gate change).

## Security considerations

Threat exposure is informative and must not be confused with an active incident. Suspected vs confirmed labels reduce overclaiming from artifact/config-only gaps. Inferred/attested observations never confirm alone.

## Open questions

- When to end migration (unknown signalId hard-fail in assess)?
- How broadly to dual-emit registered IDs beyond the Shadow Agents pilot?
- Whether Check-local `mitigatesThreats` authoring is needed vs reverse-index only.

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable
- [x] Crosswalk impact noted (or N/A)
- [x] Security / safety considered
- [x] Open questions listed
