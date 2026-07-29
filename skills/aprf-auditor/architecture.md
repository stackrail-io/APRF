# APRF Auditor — Target Architecture

Working-draft evolution of the portable skill. Agents MAY implement the simple path today; hosts SHOULD migrate toward the evidence-graph path.

## Current (v0.1 path)

```text
Project → Workflow search → Checks → Report
```

Works for local LLM agents. Weaknesses: rescans, unclear precedence, weak runtime coverage.

## Target (v0.2+ path)

```text
Project
  → Evidence Collectors (collectors/*.ts via npm run aprf:collect)
  → Normalized Evidence Graph (evidence-graph.json)
  → Rule Engine (APRF Check YAML + scoring.yaml)
  → Assessment (statuses)
  → Remediation pack
  → Report artifacts
```

Every Check **queries the graph** (and optional live plugin refresh) instead of ad-hoc re-globbing.

### Collector tiers (no StackRail)

| Tier | What runs | When |
| --- | --- | --- |
| **Local** | Repo walk, CI YAML, IaC regex, OTel/promptfoo config | Default |
| **Import** | Files under `aprf-assessment/imports/<plugin>/` | Drop exports (LangSmith, Phoenix, …) |
| **Live** | Opt-in APIs (e.g. GitHub Actions runs) | `APRF_AUDITOR_LIVE=1` + credentials |

## Planes

| Plane | Responsibility | Skill files |
| --- | --- | --- |
| Capability | What environments/evidence the skill knows | `capabilities.yaml` |
| Collection | Gather artifacts into graph nodes | `plugins/*`, Phase 1–2 |
| Precedence | Which node wins when multiple support a claim | `evidence-precedence.yaml` |
| Confidence | Objective score from evidence class + freshness | `confidence.yaml` |
| Normative | APRF Checks / profiles / lenses | APRF repo packages |
| Assessment | Status + gate + scores | `workflow.md`, `scoring.yaml` |
| Remediation | Fix / example / owner / effort | control `remediation` in schema |
| History / Diff | Trend and PR compare | `compare` mode, `history/` |

## Determinism rules

1. Collectors emit sorted node IDs.
2. Precedence selects a **primary** evidence node per Check claim; others are supporting.
3. Freshness decay adjusts confidence (never invents PASS).
4. Same graph + same APRF version + same profile → same assessment (modulo user attestation nodes).
