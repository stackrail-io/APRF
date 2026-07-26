# Adversarial architecture review

Panel simulation: AWS · Google Cloud · Anthropic · OpenAI · Microsoft · OWASP · CNCF · HashiCorp · GitHub · Snyk · Wiz.

**Subject:** APRF five-layer design (Pillars → Requirements → Checks → Detections → Evidence + engines).  
**Goal:** Destroy weak parts; keep only what can become an industry standard.  
**Outcome:** Critiques below are **accepted** into [ARCHITECTURE.md](ARCHITECTURE.md) (hardened design).

---

## Round 1 — Fatal and major findings

### 1. Taxonomy depth will kill adoption (OWASP, AWS WA)

**Criticism:** Practitioners will not navigate Pillar → Requirement → Check → Detection → Evidence. OWASP Top 10 and WA succeed with **shallow** public surfaces. A mandatory L2 Requirements layer duplicates Check prose and creates contributor bikeshedding (“is this a Requirement or a Check?”).

**Improved design:** Public normative surface is **Pillar → Check**. Requirements become **optional grouping labels** (`requirementId` on Checks), not a mandatory hierarchy depth. RFCs may still define Requirement principles for documentation, but gate evaluation never requires Requirement IDs.

### 2. Axis explosion (Microsoft, AWS)

**Criticism:** Maturity floor × criticality × mandatory/recommended × severity × scoringWeight × lenses × profiles is more configuration than most enterprises will operationalize. Buyers will invent their own “APRF Lite.”

**Improved design:** Freeze **two axes** for gates: (1) Check `gateClass` mandatory|recommended, (2) system `criticality` + `maturityFloor`. Severity orders remediations only. **Remove scoringWeight from mandatory Checks.** Lenses/profiles remain **Check-set selectors**, not new axes.

### 3. Rule / Check explosion (GitHub, Snyk, CIS)

**Criticism:** 500+ Checks × 5,000+ Detections without budgets becomes unmaintainable (CodeQL + SCA overlap problem). Every new agent framework will lobby for new Checks instead of Detections.

**Improved design:**
- **Check budget:** soft cap ~25–40 Checks per Pillar; new Checks require RFC proving no existing Check covers the principle.
- **Detection namespaces:** `infra.*` vs `ai-runtime.*` vs `scm.*` — never promote platform novelty into new Checks.
- **Release quota:** max N new Checks per MINOR without MAJOR stewardship vote.

### 4. “Immutable Evidence” at cloud scale (Google, Wiz)

**Criticism:** Retaining every Terraform plan, OTel trace, and repo snapshot forever is cost-prohibitive and a data-residency/PII landmine. Immutability without tiers is aspirational.

**Improved design:** Evidence **tiers**:
- `ephemeral` — raw blobs, TTL (e.g. 7–90 days)
- `digest` — content hash + metadata retained long-term
- `attested` — human-uploaded evidence packs with explicit retention

Immutability applies to **digests and attested packs**, not necessarily full raw payloads.

### 5. Deterministic Detection vs LLM judges (Anthropic, OpenAI)

**Criticism:** Prompt/safety “detections” that call models are non-deterministic; claiming Detection Engine determinism will be false advertising and contested in audits.

**Improved design:** Split Detection kinds:
- `deterministic` — same Evidence + version ⇒ same finding
- `stochastic` — allowed only for `recommended` Checks or with pinned seed/model/version + recorded judge provenance; **cannot alone satisfy mandatory gates** unless paired with deterministic corroboration or human attestation

### 6. Marketplace certification confusion (Microsoft, AWS, Snyk)

**Criticism:** Enterprises will treat “certified plugin” as “system is production-ready.” Same failure mode as vendor CIS “certified” marketing.

**Improved design:** Ban the word **certified** for plugins in APRF vocabulary. Use **`reviewed` | `signed` | `reference`**. Only **assessments** produce gate pass/fail. Normative docs must say: plugin listing ≠ APRF conformance.

### 7. Vendor lock-in via StackRail engines (CNCF, HashiCorp)

**Criticism:** Engines 1–7 described as one pipeline looks like a single-vendor product architecture dressed as a standard (WA vs AWS Console).

**Improved design:** Normative artifacts are only: **catalog (Pillars/Checks), profiles, attestation schema, Check↔Detection mapping *schema*** (not proprietary mapping DB). Engines are **reference roles**; any vendor may implement. Mapping graph for *reference* detections may live in products; the standard defines the **edge schema**, not the edge inventory.

### 8. Compliance gravity well (OWASP, Wiz)

**Criticism:** Crosswalks + Compliance pillar + “Evidence” invites auditors to treat APRF as SOC 2/ISO substitute. You say you’re not a compliance scanner while building one.

**Improved design:**
- Rename Compliance pillar framing to **Organizational Governance / Evidence Hygiene** (or keep Compliance but forbid Check IDs that assert “SOC 2 control X satisfied”).
- Crosswalks remain **informative only**; attestation schema forbids `certifiedAgainst: ["soc2"]` claims.
- Authoring gate: Checks may not encode CVE IDs or “patch CVSS≥X” as readiness gates.

### 9. Naming / ID migration (everyone)

**Criticism:** Speculative `SEC-001` vs existing `SEC-M1` / `AUTHN-M1` will fork the ecosystem. Industry standards that renumber fail (see early CIS churn).

**Improved design:** **Preserve current Check ID namespace** (`{PREFIX}-M#` / `{PREFIX}-R#`). Do not introduce parallel `SEC-001` in the standard. Requirements (if used) are `APRF-R-*` documentation IDs only.

### 10. Governance can’t scale contributions (CNCF, GitHub)

**Criticism:** Every Detection PR hitting a central steward won’t scale to 100 plugins. Central RFC for Detections contradicts “Detections not in public framework.”

**Improved design:** Stewardship owns **only L1/L3 (+ optional Requirement labels)**. Detection repos are federated. Normative CI validates that published *reference* mappings only cite live Check IDs — stewards do not review Detection logic by default.

### 11. Graph without cardinality rules (HashiCorp)

**Criticism:** Many-to-many without “sufficiency” rules allows one weak Detection to “cover” a Check, or requires all Detections (impossible).

**Improved design:** Per Check, declare **satisfaction policy**:
- `anyOf` — one passing Detection (or attestation) suffices
- `allOf` — rare; listed Detection classes must all pass
- `attestationOnly` — no automated Detection may alone pass (high-judgment Checks)

Default: `anyOf` among Detections that declare `assurance: gate-eligible`.

### 12. Enterprise adoption blockers (AWS, Microsoft, Google)

**Criticism:** No SSO/tenant model, no air-gap story, no “what is the minimum artifact I show an auditor” one-pager. Architecture is eng-complete, buyer-incomplete.

**Improved design:** Normative **Conformance Pack** (documentation): (1) pinned `aprfVersion`, (2) profile ID, (3) gate result, (4) blocker list, (5) evidence index of digests. Optional product features (SSO, multi-tenant) stay out of the standard.

### 13. Future AI framework churn (Anthropic, OpenAI, CNCF)

**Criticism:** Listing LangChain/CrewAI/MCP as Detection examples invites perpetual Check RFCs (“CrewAI memory Check”).

**Improved design:** Authoring rule: **platform names never appear in Check titles**. Checks state principles (“durable memory writes are policy-gated”). Platforms appear only in Detection `targetPlatform`.

### 14. ScoringWeight is a vanity score in disguise (OWASP, WA)

**Criticism:** Even if mandatory is binary, publishing weighted “posture scores” will become the board metric.

**Improved design:** Recommended posture may emit **per-Pillar** recommended completion (count or %), never a single org-wide readiness %. Spec forbids naming it “readiness score.” Prefer “recommended backlog remaining.”

### 15. Maintenance of Mapping Engine as normative (Snyk)

**Criticism:** If Mapping Engine owns the graph of 5,000 edges centrally, it becomes the product moat and a single point of rot.

**Improved design:** Each plugin **declares** its `checkIds[]` and `assurance`. Mapping Engine **aggregates** declarations + validates against catalog. No central hand-maintained edge table in the standard.

---

## Round 2 — Residual issues after Round 1 fixes

| Issue | Resolution |
| --- | --- |
| Still need principle docs without L2 hierarchy | **Requirement labels** + pillar narrative pages |
| Stochastic evals still needed for AI quality | Allowed for recommended / with corroboration rules |
| Who defines Evidence type registry? | **Evidence Type Registry** in this repo (IDs + schemas only), versioned like OTel semantic conventions |
| Air-gapped enterprises | Catalog + schemas are offline-friendly files; collectors optional |
| Fork risk if StackRail dominates RFCs | Existing stewardship phases + interim advisory; architecture docs reaffirm transfer intent |

## Round 3 — Stop criteria

No remaining **major** architectural weaknesses for a standards track if:

1. Public normative depth is Pillar → Check (Requirements optional labels)
2. Gate axes are capped; no org-wide vanity score
3. Check/Detection budgets and platform-name ban exist
4. Evidence is tiered; stochastic cannot solo-gate mandatory
5. Plugins are signed/reviewed, never “certified as ready”
6. Engines are roles; mapping is declared by plugins
7. Check IDs preserve current namespace
8. Conformance Pack is the enterprise artifact

Further work is **catalog content and RFC process**, not layering.

