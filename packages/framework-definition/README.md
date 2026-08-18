# `@stackrail-io/aprf-framework-definition`

APRF **Framework Definition**: Profiles (Core / Regulated / Framework), Lenses (RAG / Agents / Voice / Coding), `applicationCapabilities`, Policy (Check overlays only), Check applicability types, and the canonical **`resolveAssessmentTarget()`** resolver ([APRF-RFC-0013](../../rfcs/0013-assessment-target-kinds.md)).

> Published under the [@stackrail-io](https://www.npmjs.com/org/stackrail-io) npm org.

Policy never mutates Requirements — overlays touch Checks only.

```bash
# from APRF repo root
npm run test:unit -w @stackrail-io/aprf-framework-definition
```

Product / marketing repos **re-export** profile and lens IDs from this package; do not redefine mandatory Check lists elsewhere. Prefer `resolveAssessmentTarget` over hand-assembling unions:

```ts
import { resolveAssessmentTarget } from "@stackrail-io/aprf-framework-definition";

const resolved = resolveAssessmentTarget({
  systemType: "ai-application",
  profileId: "core",
  capabilities: ["rag", "agents"],
});
// resolved.effectiveCheckIds, assessmentKind, claimMetadata.reportBanner, …
```

Legacy union helper (still exported):

```ts
import {
  PROFILE_CORE,
  LENS_ID_RAG,
  unionProfileAndLenses,
} from "@stackrail-io/aprf-framework-definition";

const gateIds = unionProfileAndLenses(PROFILE_CORE.mandatoryCheckIds, [
  LENS_ID_RAG,
]);
```
