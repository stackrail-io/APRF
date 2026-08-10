# APRF-RFC-0010: Fine-grained peer crosswalks (AISVS, ASVS, OpenCRE, MAESTRO, FIASSE)

| Field | Value |
| --- | --- |
| Status | accepted |
| Author(s) | StackRail (working-draft publisher) |
| Created | 2026-08-10 |
| SemVer impact | MINOR |
| Index summary | Adds informative section-level crosswalks for OWASP AISVS 1.0 (`aisvs:v1.0-C*.*`), ASVS, OpenCRE, MAESTRO, and FIASSE; enriches OWASP LLM Top 10 controls with AISVS `relatedPeerControlIds` bridges. |

## Problem

APRF already ships informative peer maps for NIST AI RMF, ISO/IEC 42001, OWASP LLM Top 10, SOC 2, AWS Well-Architected, and SLSA. Assessors and auditors who already work from OWASP AISVS / ASVS, OpenCRE, CSA MAESTRO, or FIASSE cannot see those alignments on Checks or in `REPORT.html`.

The LLM Top 10 crosswalk exists, but it does not surface the AISVS section bridges that accompany each LLM risk in OWASP AISVS practice.

## Proposal

1. Add five informative frameworks under `spec/aprf-spec.json` → `crosswalks[]`:
   - **aisvs** — OWASP AISVS **1.0** section inventory (`aisvs:v1.0-C*.*`, sourced from the locked `1.0/en` tree)
   - **asvs** — 80 ASVS 5.0 sections (`V*.*`)
   - **opencre** — 13 CWE peer controls (CRE IDs in `summary`)
   - **maestro** — 7 MAESTRO layers + 5 extended multi-agent threats
   - **fiasse** — 61 FIASSE / SSEM sections
2. Extend peer control shape with optional `relatedPeerControlIds` and populate OWASP LLM Top 10 controls with official AISVS 1.0 IDs (e.g. LLM01 → `aisvs:v1.0-C2.1`, …).
3. Validate related peer IDs at catalog build time; surface them on assessment controls / HTML as informative related-peer meta.
4. Group the HTML “Framework crosswalk” block by framework so fine-grained maps stay readable.
5. Update `metadata.compatibility.crosswalks` and stats. **No** gate, scoring, Check YAML, profile, or lens changes.

Crosswalks remain **informative alignment only** — not certification or proof of compliance. Full peer markdown corpora are **not** vendored into APRF. AISVS authoring reads a local [OWASP/AISVS](https://github.com/OWASP/AISVS) checkout via `--aisvs-root`; ASVS / OpenCRE / FIASSE draft from compact ID/title/summary inventories under `scripts/peer-crosswalk-inventories/`.

## Alternatives considered

- Vendor full peer markdown corpora — rejected for this RFC; APRF keeps ID/title/summary maps only.
- Chapter-only (coarse) maps — rejected; assessors need section-level refs matching AISVS/ASVS practice.
- Peer-to-peer graph as a separate artifact — rejected; `relatedPeerControlIds` on LLM controls is enough for the AISVS bridges without a new runtime model.

## Compatibility

| Change | Impact |
| --- | --- |
| New `crosswalks[]` entries | Additive; consumers may show more peer refs per Check |
| `relatedPeerControlIds` on controls | Additive optional field; older catalogs ignore it |
| Gates / Check IDs / profiles | Unchanged |
| SemVer | **MINOR** (new compatibility surfaces) |

## Security considerations

Crosswalk metadata must not be treated as evidence of compliance. Disclaimers remain on each framework. Related-peer bridges are informative only.

## Open questions

None for this ship; future RFCs may add MASVS/MASTG or richer peer-to-peer edges if demand appears.

## Checklist

- [x] Problem and affected parties
- [x] Proposed change stated
- [x] SemVer impact justified
- [x] Compatibility / deprecation plan
- [x] Checks remain measurable (N/A — no Check changes)
- [x] Crosswalk impact noted
- [x] Security / safety considered
- [x] Open questions listed
