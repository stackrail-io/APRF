# APRF Auditor — Architecture

Shipped path for local assessment. Prefer the open CLI (`@stackrail-io/aprf`) so collect → assess → report stay deterministic; the skill orchestrates that CLI and asks for missing evidence.

## Shipped path

```text
Project
  → Evidence Collectors (collectors/*.ts via `aprf collect` / `npm run aprf:collect`)
  → Normalized Evidence Graph (evidence-graph.json) + per-plugin statusHints
  → Assess engine (`aprf assess` — profile/lens gate from statusHints + imports)
  → Assessment JSON (statuses, crosswalks, threatIntel)
  → REPORT.html (`aprf report` — discovery, domain scores, per-control detail, top threat exposure)
```

Every Check is decided from collector `statusHint`s and graph evidence (plus optional imports / live probes), not ad-hoc re-globbing in the model.

### Legacy ad-hoc path (avoid for gate claims)

```text
Project → Workflow search → Checks → Report
```

Still useful for exploratory chat, but weak on rescans, precedence, and runtime coverage. Do not invent PASS from chat-only answers.

### Collector tiers (no StackRail)

| Tier | What runs | When |
| --- | --- | --- |
| **Local** | Repo walk, CI YAML, IaC regex, OTel/promptfoo config | Default |
| **Import** | Files under `aprf-assessment/imports/<plugin>/` | Drop exports (LangSmith, Phoenix, …) |
| **Live** | Opt-in APIs (auth probes, GitHub Actions, …) | Base URL + credential **env vars** (never paste secrets into chat) |

## Planes

| Plane | Responsibility | Skill / package files |
| --- | --- | --- |
| Capability | What environments/evidence the skill knows | `capabilities.yaml` |
| Collection | Gather artifacts into graph nodes | `collectors/*`, `plugins/*` |
| Precedence | Which node wins when multiple support a claim | `evidence-precedence.yaml` |
| Confidence | Objective score from evidence class + freshness | `confidence.yaml` |
| Normative | APRF Checks / profiles / lenses / threat map / crosswalks | `@stackrail-io/aprf-engine`, framework-definition, `spec/` |
| Assessment | Status + gate + scores | CLI assess engine, `scoring.yaml` |
| Remediation | Fix / example / owner / effort | control `remediation` in schema |
| Reporting | HTML + discovery + threat exposure rollup | `scripts/render-html-report.ts` |
| History / Diff | Trend and PR compare | `compare` mode, `history/` (when used) |

## Determinism rules

1. Collectors emit sorted node IDs.
2. Precedence selects a **primary** evidence node per Check claim; others are supporting.
3. Freshness decay adjusts confidence (never invents PASS).
4. Same graph + same APRF version + same profile → same assessment outcomes for the same evidence payloads (modulo user attestation nodes). Freshness windows that read `measuredAt` / import timestamps can change a Check from PASS to PARTIAL/FAIL when wall-clock time moves — treat those as inputs, not as non-determinism in the scorer.
5. Crosswalks and threat intel are **informative only** — they decorate reports and never flip a gate.
