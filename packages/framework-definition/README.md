# `@stackrail-io/aprf-framework-definition`

APRF **Framework Definition**: Profiles (Core / Regulated), Lenses (RAG / Agents / Voice / Coding), Policy (Check overlays only), and Check applicability types.

> Published under the [@stackrail-io](https://www.npmjs.com/org/stackrail-io) npm org.

Policy never mutates Requirements — overlays touch Checks only.

```bash
# from APRF repo root
npm run test:unit -w @stackrail-io/aprf-framework-definition
```

Product / marketing repos **re-export** profile and lens IDs from this package; do not redefine mandatory Check lists elsewhere.

Assessment gate for a claimed lens:

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
