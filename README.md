# AI Production Readiness Framework (APRF)

**Status:** working-draft **v0.10.0**  
**Publisher:** [StackRail](https://stackrail.io) (working-draft publisher)  
**Site:** [https://stackrail.io/aprf/](https://stackrail.io/aprf/)  
**Question:** Can this AI application safely operate in production?

APRF is a vendor-neutral working draft for engineering readiness of AI systems. It uses **gated pass/fail** mandatory checks — not a vanity readiness percentage. Self-assessment is **not** third-party certification.

## This repository

This is the **normative public home** for APRF releases:

| Path | Contents |
| --- | --- |
| [`spec/aprf-spec.json`](spec/aprf-spec.json) | Machine-readable catalog (pillars, profiles, lenses, crosswalks, stewardship) |
| [`schemas/`](schemas/) | JSON Schemas for the spec document and self-attestation exports |
| [`rfcs/`](rfcs/) | RFC template and open/historical RFCs |
| [`CHANGELOG.md`](CHANGELOG.md) | SemVer history |

The StackRail site hosts the human-readable pillar pages, How APRF works, and the reference [Core / Regulated assessment](https://stackrail.io/aprf/assess/).

Until a full TypeScript extract lands here, pillar sources are edited in the StackRail site repo and published into this repository on each framework release (`npm run aprf:spec` → copy `spec/aprf-spec.json`).

## Quick links

- Overview: https://stackrail.io/aprf/
- How it works: https://stackrail.io/aprf/how/
- Spec JSON (site mirror): https://stackrail.io/aprf/spec/
- Stewardship & RFCs: https://stackrail.io/aprf/rfc/
- Assess: https://stackrail.io/aprf/assess/

## Contributing

1. Read [`rfcs/0000-template.md`](rfcs/0000-template.md).
2. Open an issue or PR against this repository, or follow the process on [/aprf/rfc/](https://stackrail.io/aprf/rfc/).
3. Interim contact: see stewardship contact on the site (transfers with steward).

## License

Copyright © StackRail contributors. Licensed under the [Apache License 2.0](LICENSE).
