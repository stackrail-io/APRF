## Summary

<!-- 1–3 bullets: what changed and why (not a file list). -->

-

## Type

Select all that apply:

- [ ] Check / catalog YAML (`packages/aprf-engine/rules/`)
- [ ] Published spec (`spec/aprf-spec.json`) or JSON schemas
- [ ] Engine / framework package code
- [ ] Auditor skill (`skills/aprf-auditor/`)
- [ ] Docs / RFC / governance
- [ ] CI / tooling

## Test plan

<!-- How you verified. Check what you ran. -->

- [ ] `npm run validate`
- [ ] `npm run build`
- [ ] Other: <!-- e.g. `npm run test:yaml`, collector smoke, manual assessment -->

## Checklist

**Always**

- [ ] CI-equivalent checks pass locally (`npm run validate` at minimum)
- [ ] Focused PR (one concern when practical); RFC linked if normative semantics change
- [ ] `[Unreleased]` in `CHANGELOG.md` updated when user-visible

**If Check YAML changed**

- [ ] Regenerated and committed `packages/aprf-engine/src/generated/catalog.ts` (`npm run aprf:catalog`)
- [ ] Spec synced where catalog is SoT (`spec/aprf-spec.json` method / requirement / passCondition as needed)
- [ ] Threat map updated for new/changed Check IDs (`spec/aprf-threat-map.yaml`; `npm run aprf:threat-map`)
- [ ] New/changed Check detectors claimed in owning plugin `detectorIds` (`npm run aprf:detector-bridge`)
- [ ] No reused Check IDs; deprecations use `replacedBy`
- [ ] Titles keep obligation language (`must` / `should` / `must have` / `should have`); no `...` / `…` truncation

**If RFCs or profile/catalog counts changed**

- [ ] `npm run aprf:sync-rfcs` and/or `npm run aprf:sync-stats` committed when applicable

**Scope**

- [ ] Product-only / cloud-vendor detectors and live API clients stay out of normative Check YAML (portable auditor collectors under `skills/aprf-auditor/` are OK)
