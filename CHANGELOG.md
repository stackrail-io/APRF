# APRF Changelog

All notable changes to the AI Production Readiness Framework are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/). Versioning is SemVer
(`APRF_GOVERNANCE.version`). JSON Schema path versions (`spec-schema/0.7`,
`attestation-schema/0.6`) are independent — see `governance.schemaVersioning`.

## [0.10.0] — 2026-07-25

### Added
- `CHANGELOG.md` and `npm run aprf:validate` (lenses + crosswalks).
- GitHub Action `.github/workflows/aprf-validate.yml` (validate + spec drift check).
- Assess UI profile choice: **Core** (40) or **Regulated** (61 Tier‑3).
- Machine-readable crosswalks: **AWS Well-Architected** and **SLSA**.
- Formal N/A for **TOL** and **MEM** gates (in addition to AGN/HUM).
- `AprfCheck` deprecation fields (`deprecated`, `replacedBy`, `deprecationNote`).
- Deprecation example: `INF-R1` → `SCI-R1`.

### Changed
- `write-aprf-spec` refuses to write when validation fails.
- `build` runs `aprf:spec` (validate + write).
- Quiz helpers accept `profileId` / Regulated criticality.

## [0.9.6] — 2026-07-25

### Changed
- Hand-rewrote remaining cadence-shell recommended checks (6).

## [0.9.5] — 2026-07-25

### Changed
- Hand-rewrote named-owner recommended shells (6).

## [0.9.4] — 2026-07-25

### Changed
- Hand-rewrote versioned-suite recommended checks (18).

## [0.9.3] — 2026-07-25

### Changed
- Hand-rewrote dated-artifact recommended checks (32).

## [0.9.2] — 2026-07-25

### Changed
- Hand-rewrote P0 dashboard paste recommended stubs (DG/CTX/INC/DX).

## [0.9.1] — 2026-07-25

### Added
- Client attestation JSON download; submit API returns full attestation.
- Formal N/A for AGN/HUM; interim advisory open call; RFCs embedded in spec;
  `governance.schemaVersioning`.

## [0.9.0] — 2026-07-24

### Added
- Regulated profile (Core + 21 Tier‑3-only mandatories).
- Measurable recommended-check pass conditions (generator upgrade from empty stubs).

## [0.8.x] — 2026-07

### Added
- Coding-agent lens; Open RFC-0001; Assess lens wiring; SEO/AI citation packaging.
