## Summary

<!-- What does this PR change, and why? -->

## Type

- [ ] Check / catalog content
- [ ] Schema
- [ ] Package / engine code
- [ ] Docs / RFC
- [ ] CI

## Checklist

- [ ] `npm run validate` passes locally
- [ ] If YAML Checks changed, `packages/aprf-engine/src/generated/catalog.ts` is updated
- [ ] No reused Check IDs; deprecations use `replacedBy`
- [ ] `[Unreleased]` in `CHANGELOG.md` updated when user-visible
- [ ] Platform-specific detection logic stays out of this normative repo
