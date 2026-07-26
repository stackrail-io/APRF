# AI Production Readiness Framework (APRF)

**Status:** working-draft **v0.10.0**  
**Publisher:** [StackRail](https://stackrail.io) (working-draft publisher)  
**Site:** [https://stackrail.io/aprf/](https://stackrail.io/aprf/)  
**Question:** Can this AI application safely operate in production?

APRF is a vendor-neutral working draft for engineering readiness of AI systems. It uses **gated pass/fail** mandatory checks — not a vanity readiness percentage. Self-assessment is **not** third-party certification.

## Architecture

Three planes (hardened after adversarial review):

| Plane | Contents | In this repo? |
| --- | --- | --- |
| **Normative** | Pillars → Checks (Requirement labels optional); profiles/lenses | Yes |
| **Binding** | Criticality, maturity floor, profile scope, N/A | Assessment-time |
| **Operational** | Evidence (tiered), Detections, engine roles | **No** — plugins / products |

Gates stay binary (no org-wide readiness %). Platform names belong in Detections, not Checks. See **[ARCHITECTURE.md](ARCHITECTURE.md)** and the critique trail **[ARCHITECTURE-REVIEW.md](ARCHITECTURE-REVIEW.md)**.

## This repository

This is the **normative public home** for APRF releases (Layers 1–3 + governance):

| Path | Contents |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Five-layer architecture and runtime component design |
| [`spec/aprf-spec.json`](spec/aprf-spec.json) | Machine-readable catalog (pillars, profiles, lenses, crosswalks, stewardship) |
| [`schemas/`](schemas/) | JSON Schemas for the spec document and self-attestation exports |
| [`rfcs/`](rfcs/) | RFC template and open/historical RFCs |
| [`CHANGELOG.md`](CHANGELOG.md) | SemVer history |

**Framework SemVer** (e.g. v0.10.0) versions the catalog and gate semantics. **Schema path versions** (e.g. [spec-schema/0.7](https://stackrail.io/aprf/spec-schema/0.7)) version document *shape* independently — do not equate them.

The StackRail site hosts human-readable pillar pages, How APRF works, and the reference [Core / Regulated assessment](https://stackrail.io/aprf/assess/).

Until a full TypeScript extract lands here, pillar sources are edited in the StackRail site repo and published into this repository on each framework release (`npm run aprf:spec` → copy `spec/aprf-spec.json`).

## Quick links

- Overview: https://stackrail.io/aprf/
- How it works: https://stackrail.io/aprf/how/
- Spec JSON (site mirror): https://stackrail.io/aprf/spec/
- Stewardship & RFCs: https://stackrail.io/aprf/rfc/
- Assess: https://stackrail.io/aprf/assess/
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)

## Contributing

1. Read [`rfcs/0000-template.md`](rfcs/0000-template.md) and [ARCHITECTURE.md](ARCHITECTURE.md) (what belongs in RFCs vs plugins).
2. Open an issue or PR against this repository for L1–L3 / governance, or follow [/aprf/rfc/](https://stackrail.io/aprf/rfc/).
3. Interim contact: see stewardship contact on the site (transfers with steward).

## License

Copyright © StackRail contributors. Licensed under the [Apache License 2.0](LICENSE).
