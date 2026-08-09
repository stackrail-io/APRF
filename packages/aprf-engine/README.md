# `@stackrail-io/aprf-engine`

Normative **APRF Check catalog**: YAML rules, JSON Schema, generated TypeScript catalog (Checks + informative crosswalks + threat intel), index, and evaluate helpers.

Part of the public [APRF](https://github.com/stackrail-io/APRF) standard. Reference collectors ship in-repo under `skills/aprf-auditor/`; product-specific detectors may live elsewhere and must map evidence to these Check IDs.

`evaluateRules` is **attestation-only by default**. Pass `runDetectors: true` with a product `DetectorRegistry` to execute real detectors. This package ships only `manual-attest` plus a catalog allowlist of detector IDs for YAML validation.

The on-disk YAML loader (`src/loader.ts`) is **repo tooling only** (validate / build-catalog). It is not part of the published `dist/` API — consumers use `getGeneratedCatalog()` / `getGeneratedRuleIndex()`.

## Layout

| Path | Role |
|------|------|
| `rules/_index/domains.yaml` | Domains (id, name, summary, pillarSlugs) — mirrors [stackrail.io/aprf](https://stackrail.io/aprf/) |
| `rules/_index/pillars.yaml` | Pillars (APRF-NN id, slug, domain) — e.g. APRF-01 / `ai-security` |
| `rules/_index/categories.yaml` | Compat: category id == pillar slug (Check YAML `category`) |
| `rules/by-domain/<domain>/<pillar-slug>/**/*.yaml` | Check source of truth (also shipped in the npm tarball) |
| `rules/_schema/rule.schema.json` | Rule document schema |
| `src/` | Types, index builder, catalog accessors, evaluate API |
| `src/loader.ts` | Node-only YAML loader for repo scripts (not published) |
| `dist/` | Published JS + declarations (`npm run build`) |
| `scripts/validate.ts` | Schema + referential + YAML lint (spec mapping, no ellipsis, fixed enums) |
| `scripts/test-yaml-validation.ts` | Fixture unit tests for YAML lint rules |
| `src/yaml-lint.ts` | Shared Check-YAML lint helpers |
| `scripts/build-catalog.ts` | Generates `src/generated/catalog.ts` (embeds `spec` crosswalks + `aprf-threat-map.yaml`) |

### Generated catalog extras

`getGeneratedCatalog()` includes:

- `rules` — normative Checks  
- `crosswalks` — peer-framework alignments from `spec/aprf-spec.json` (informative)  
- `threatIntel` — per-Check threat context from `spec/aprf-threat-map.yaml` (informative)

Helpers: `getCrosswalksForCheck(id)`, `getThreatIntelForCheck(id)`. Neither field affects evaluate/gate math.

## Commands

From the APRF repo root:

```bash
npm install
npm run aprf:validate    # schema + referential + YAML lint vs aprf-spec.json
npm run aprf:catalog     # regenerate src/generated/catalog.ts — commit if changed
npm run aprf:integrity         # YAML ↔ published spec ↔ profiles ↔ stats
npm run aprf:detector-bridge   # Check detectors ↔ plugin.detectorIds + join maps
npm run aprf:threat-map        # threat-map coverage, vocabularies, pinned MITRE IDs
npm run test:unit        # aprf-engine + framework-definition + CLI smokes
npm run test:yaml -w @stackrail-io/aprf-engine  # YAML lint fixtures only
npm run validate         # full local CI-equivalent chain
npm run build            # emit dist/ for npm consumers
```

`aprf:validate` enforces: valid YAML; schema mandatory fields; severity/gate/status/capability from fixed sets; category from pillar set; Check `id`/`gate`/`category`/levels map to `spec/aprf-spec.json`; no `…`/`...`/TODO/FIXME/TBD placeholders; title uses `must`/`must have` (mandatory) or `should`/`should have` (recommended); Check `id` appears only in the `id` field (not in prose); no `(category-slug):` or `(Name, mandatory|recommended):` echoes in prose; path `by-domain/<domain>/<pillar>/<ID>.yaml` matches id/category/domain; `-M#`/`-R#` matches gate.
CI (`.github/workflows/ci.yml`) runs the same checks on every PR and fails if the generated catalog or threat map is out of date.

## Add a Check

1. Copy an existing file under `rules/by-domain/<domain>/<pillar-slug>/`.
2. Use a new stable ID (`PREFIX-M#` / `PREFIX-R#`); never reuse deprecated IDs.
3. Set `category` to the pillar slug (e.g. `authentication`), not the domain id.
4. Fill all required schema fields (`rules/_schema/rule.schema.json`).
5. Add a row for the Check ID in repo-root [`spec/aprf-threat-map.yaml`](../../spec/aprf-threat-map.yaml) (MITRE optional).
6. Run `npm run validate` and commit any catalog diff.

See also [`rules/_index/id-gaps.md`](rules/_index/id-gaps.md) before allocating new IDs.

## Consumers

Product / marketing repos depend on this package (npm publish or local `file:` link) and must not redefine Check IDs or normative prose. The open CLI (`@stackrail-io/aprf`) and in-repo auditor collectors consume this catalog; external detectors map evidence to the same Check IDs.
