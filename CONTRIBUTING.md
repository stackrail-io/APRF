# Contributing to APRF

Thank you for helping evolve the AI Production Readiness Framework.

## What belongs here

This repository is the **normative public home** for APRF:

- Check YAML under `packages/aprf-engine/rules/`
- Profiles and lenses in `@stackrail-io/aprf-framework-definition`
- Published mirror `spec/aprf-spec.json` and JSON Schemas
- Architecture / RFCs / governance docs

**Do not** add product detectors, collectors, or cloud API clients here — those belong in product/plugin repos and map evidence to Check IDs.

## Before you open a PR

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) and [rfcs/0000-template.md](rfcs/0000-template.md).
2. For substantive normative changes (new Pillars, gate semantics, ID renumbers), open an RFC first.
3. For Check edits: follow the schema in `packages/aprf-engine/rules/_schema/rule.schema.json`.
4. Never reuse a published Check ID — deprecate with `replacedBy` instead.

## Local checks

Requires Node.js 22+.

```bash
npm install
npm run validate   # rules + catalog + integrity + unit tests
npm run build      # publishable dist/
npm run publish:packages   # requires npm login to @stackrail-io org
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
