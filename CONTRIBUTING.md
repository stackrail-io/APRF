# Contributing to APRF

Thank you for helping evolve the AI Production Readiness Framework.

## What belongs here

This repository is the **normative public home** for APRF, plus the **reference local assessment path**:

- Check YAML under `packages/aprf-engine/rules/`
- Profiles and lenses in `@stackrail-io/aprf-framework-definition`
- Published mirror `spec/aprf-spec.json`, threat map, and JSON Schemas
- Reference collectors and scoring under `skills/aprf-auditor/`
- Open CLI `@stackrail-io/aprf` under `packages/aprf/`
- Architecture / RFCs / governance docs

**Product-specific detectors** and proprietary backends still belong outside this monorepo — they must map evidence to stable Check IDs. Adding or improving **reference collectors** in `skills/aprf-auditor/collectors/` is welcome when they stay Check-aligned and offline-first.

## Before you open a PR

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) and [rfcs/0000-template.md](rfcs/0000-template.md).
2. For substantive normative changes (new Pillars, gate semantics, ID renumbers), open an RFC first.
3. For Check edits: follow the schema in `packages/aprf-engine/rules/_schema/rule.schema.json`.
4. Never reuse a published Check ID — deprecate with `replacedBy` instead. Before the first tagged release, M→R remaps may omit deprecated stubs only when documented in an RFC and [`id-gaps.md`](packages/aprf-engine/rules/_index/id-gaps.md).

### When you add or change a Check

1. Edit / add YAML under `packages/aprf-engine/rules/`.
2. Keep `spec/aprf-spec.json` pillar Check lists / pass conditions in sync when those fields are the published SoT for the site.
3. Add or update the matching row in [`spec/aprf-threat-map.yaml`](spec/aprf-threat-map.yaml) (MITRE mapping optional — do not force-fit).
4. Run `npm run aprf:catalog` and commit `packages/aprf-engine/src/generated/catalog.ts` if it changed.
5. Run `npm run validate` (includes `aprf:threat-map` and `aprf:integrity`).

### When you add or accept an RFC

1. Author under `rfcs/NNNN-….md` with metadata table fields including **Index summary**.
2. Run `npm run aprf:sync-rfcs` to refresh `spec/aprf-spec.json` → `rfcs`.
3. If catalog/profile counts changed, run `npm run aprf:sync-stats` so `stats` stays accurate.

## Local checks

Requires Node.js 22+.

```bash
npm install
npm run validate   # rules + catalog + integrity + threat-map + collectors + tests
npm run build      # publishable dist/ (engine, framework-definition, CLI)
npm run publish:packages   # requires npm login to @stackrail-io org
# Local CLI without publish:
npm run build -w @stackrail-io/aprf && node packages/aprf/dist/cli.js audit --target . --profile core
```

If YAML Checks change, commit the regenerated:

`packages/aprf-engine/src/generated/catalog.ts`

## PR expectations

- Keep PRs focused (one concern per PR when practical).
- Use the PR template checklist (`.github/PULL_REQUEST_TEMPLATE.md`).
- Update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]` for user-visible changes.
- Ensure CI is green (`.github/workflows/ci.yml`).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
