# APRF Assessment Report

**APRF version:** {{aprfVersion}}  
**Skill version:** {{skillVersion}}  
**Assessed at:** {{assessedAt}}  
**Subject:** {{subject.name}} (`{{subject.path}}`)  
**System type:** {{scope.systemType}}  
**Assessment kind:** {{scope.assessmentKind}}  
**Profile / scope:** {{scope.profileId}}{{#scope.scopeId}} (`{{scope.scopeId}}`){{/scope.scopeId}} · Tier {{scope.criticality}} · Lenses: {{scope.lensIds}}

{{#scope.reportBanner}}
> **{{scope.reportBanner}}**
{{/scope.reportBanner}}

> Self-attested / local agent assessment against the public APRF catalog.  
> **Not** third-party certification. **Not** a StackRail cloud product run.  
> If `assessmentKind` is `non-ai-platform-subset` or `aprf-framework`, this is **not** an APRF Core AI production-readiness claim.
>
> **StackRail / APRF:** [stackrail.io](https://stackrail.io) · [APRF](https://stackrail.io/aprf/) · [How it works](https://stackrail.io/aprf/how/) · [Assess](https://stackrail.io/aprf/assess/) · [GitHub](https://github.com/stackrail-io/APRF)

---

## Executive Summary

| Metric | Value |
| --- | --- |
| Overall gate | {{#executiveSummary.overallGatePassed}}**PASS**{{/executiveSummary.overallGatePassed}}{{^executiveSummary.overallGatePassed}}**FAIL**{{/executiveSummary.overallGatePassed}} |
| Criticality tier | Tier {{executiveSummary.criticalityTier}} · **{{executiveSummary.criticalityName}}** |
| Required capability | L{{executiveSummary.requiredCapabilityLevel}} · **{{executiveSummary.requiredCapabilityName}}** ([maturity model](https://stackrail.io/aprf/how/#maturity)) |
| Assessment confidence | {{executiveSummary.assessmentConfidence}} |
| Recommended score (non-gate) | {{executiveSummary.recommendedScore}} / 100 |
| Blockers | {{executiveSummary.blockerCount}} (critical: {{executiveSummary.criticalBlockerCount}}) |
| Grade (secondary) | {{executiveSummary.overallGrade}} |
| Risk (secondary) | {{executiveSummary.riskLevel}} |

{{executiveSummary.narrative}}

---

## Domain Scores

| Domain | Score | Mandatory subset gate |
| --- | --- | --- |
{{#domainScores}}
| {{domain}} | {{score}} | {{#mandatoryGatePassed}}pass{{/mandatoryGatePassed}}{{^mandatoryGatePassed}}fail{{/mandatoryGatePassed}} |
{{/domainScores}}

---

## Project Discovery

**Found:** {{#discovery.found}}`{{.}}` {{/discovery.found}}

**Not observed** (optional / tech-dependent — not a defect by itself): {{#discovery.notObserved}}`{{.}}` {{/discovery.notObserved}}

**Required evidence missing** (in-scope Checks): {{#discovery.requiredEvidenceMissing}}`{{.}}` {{/discovery.requiredEvidenceMissing}}

---

## Controls & Findings

List every in-scope control once. Tags on the listing: `Production blocker` · `Critical` · `High` · `Medium` · `Low` · `Quick win`. Sort: Production blockers → Critical → High → Medium → Low → Quick wins → other.

**HTML (`REPORT.html`):** table columns Check · Title · **Category** (Check YAML `category`, e.g. Data Privacy) with domain subtitle · Status · Confidence · Tags · Priority. Flyout leads with catalog **title, description, whyItMatters, references** (verbatim) — do not invent rule text. Domain (e.g. Data) is the APRF grouping above categories like `data-privacy`.

**Markdown (`REPORT.md`):** table listing + detail sections below.

### Listing

| Check | Title | Category | Domain | Status | Confidence | Tags | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
{{#controls}}
| {{checkId}} | {{title}} | {{category}} | {{domain}} | {{status}} | {{confidence}} | _(tags)_ | {{priority}} |
{{/controls}}

{{#controls}}
### {{checkId}} — {{title}}

| Field | Value |
| --- | --- |
| Category | {{category}} |
| Domain | {{domain}} _(APRF grouping; e.g. data-privacy → Data)_ |
| Gate | {{gate}} · {{severity}} |
| Status | **{{status}}** |
| Confidence | {{confidence}} |
| Priority | {{priority}} |

{{#description}}
**Description (catalog):** {{description}}
{{/description}}

{{#whyItMatters}}
**Why it matters (catalog):** {{whyItMatters}}
{{/whyItMatters}}

{{#references}}
**References (catalog):** {{title}} {{url}}
{{/references}}

**Evidence found**

{{#evidenceFound}}
- `{{ref}}`{{#excerpt}} — {{excerpt}}{{/excerpt}}
{{/evidenceFound}}
{{^evidenceFound}}
- _None_
{{/evidenceFound}}

{{#requiredEvidenceMissing}}
**What you need next**

Plain-English next steps for the customer (no camelCase import field names).

{{#requiredEvidenceMissing}}
- {{.}}
{{/requiredEvidenceMissing}}
{{/requiredEvidenceMissing}}

**Reasoning:** {{reasoning}}

**Recommended action:** {{#recommendedFixes}}{{.}} {{/recommendedFixes}}{{^recommendedFixes}}{{recommendedAction}}{{/recommendedFixes}}

{{#recommendedFixes}}
**Recommended fixes (catalog)**

{{#recommendedFixes}}
1. {{.}}
{{/recommendedFixes}}
{{/recommendedFixes}}

{{#passCondition}}
**Pass condition (catalog):** {{passCondition}}
{{/passCondition}}

{{#evidenceRequired}}
**Evidence required (catalog)**

{{#evidenceRequired}}
- {{.}}
{{/evidenceRequired}}
{{/evidenceRequired}}

{{#naReason}}
**N/A rationale:** {{naReason}}
{{/naReason}}

---
{{/controls}}

## Roadmaps

### 30 days
{{#roadmaps.days30}}
- {{.}}
{{/roadmaps.days30}}

### 90 days
{{#roadmaps.days90}}
- {{.}}
{{/roadmaps.days90}}

### Long term
{{#roadmaps.longTerm}}
- {{.}}
{{/roadmaps.longTerm}}

---

## Excluded Checks (non-AI subset)

{{#scope.excludedCheckIds}}
- **{{id}}** — {{reason}}
{{/scope.excludedCheckIds}}
{{^scope.excludedCheckIds}}
_None — full profile/catalog scope._
{{/scope.excludedCheckIds}}

---

## Disclaimer

{{disclaimer}}

**StackRail / APRF:** [stackrail.io](https://stackrail.io) · [APRF overview](https://stackrail.io/aprf/) · [How APRF works](https://stackrail.io/aprf/how/) · [Reference assess](https://stackrail.io/aprf/assess/) · [GitHub: stackrail-io/APRF](https://github.com/stackrail-io/APRF)
