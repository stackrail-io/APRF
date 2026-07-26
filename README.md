# AI Production Readiness Framework (APRF)

**Status:** working-draft **v0.10.0**  
**Publisher:** [StackRail](https://stackrail.io) (working-draft publisher)  
**Site:** [https://stackrail.io/aprf/](https://stackrail.io/aprf/)  
**Question:** Can this AI application safely operate in production?

APRF is a vendor-neutral working draft for engineering readiness of AI systems. It uses **gated pass/fail** mandatory checks — not a vanity readiness percentage. Self-assessment is **not** third-party certification.

## Architecture

APRF separates a long-lived **public standard** from evolving **implementations**:

| Layer | Name | In this repo? |
| --- | --- | --- |
| L1 | **Pillars** — broad engineering domains (rarely change) | Yes (normative) |
| L2 | **Requirements** — stable engineering principles (“shall”) | Yes (target; today folded into checks) |
| L3 | **Checks** — measurable expectations + evidence contracts | Yes (normative) |
| L4 | **Detections** — platform-specific how-to-verify (GitHub, AWS, LangChain, MCP, …) | **No** — plugins / products |
| L5 | **Evidence** — immutable collected artifacts | **No** — collectors / products |

Detections map to Checks as a **many-to-many graph**. Mandatory Checks never average into a vanity score.

Full design (engines, SDKs, versioning, governance, diagrams): **[ARCHITECTURE.md](ARCHITECTURE.md)**.

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
