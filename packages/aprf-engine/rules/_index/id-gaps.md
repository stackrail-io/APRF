# Check ID numbering

APRF Check IDs are **immutable once published** in a MINOR+. Gaps in `M#` / `R#` sequences are **intentional** — never renumber to “fill holes,” and never reuse a retired ID.

## Known gaps (v0.10.0 catalog)

These recommended (or historical) slots are unused in the current YAML catalog:

| Missing ID | Notes |
| --- | --- |
| `EXP-R2` | Skipped; use `EXP-R1` / `EXP-R3` |
| `HUM-R2` | Skipped; use `HUM-R1` / `HUM-R3` |
| `INC-R2` | Skipped; use `INC-R1` / `INC-R3` |
| `INF-R2` | Skipped; `INF-R1` is deprecated → `SCI-R1` |
| `MEM-R2` | Skipped; use `MEM-R1` / `MEM-R3` |
| `ORG-R2` | Skipped; use `ORG-R1` / `ORG-R3` |
| `REL-R3` | Skipped; use nearby `REL-R*` |
| `REL-R5` | Skipped; use nearby `REL-R*` |
| `SAF-R1` | Skipped; recommended safety Checks start at `SAF-R2` |

## Namespace notes

| Prefix | Category |
| --- | --- |
| `SEC-*` | Adversarial / AI security (`ai-security`) |
| `SEC2-*` | Secrets pillar (`secrets`) — distinct from `SEC-*` |
| `DEP-*` | Lives under change-management (deployment-related Checks) |

When adding a Check, pick the next unused ID in that prefix’s gate class (`M` or `R`) **or** document a deliberate skip in this file and the PR description.
