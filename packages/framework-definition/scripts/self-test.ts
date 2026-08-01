import {
  PROFILE_ID_CORE,
  PROFILE_CORE,
  PROFILE_REGULATED,
  buildPolicyDigest,
  withPolicyDigest,
  resolveCheckApplicability,
  policyTouchesRequirements,
  getTier3OnlyMandatoryIds,
  APRF_LENSES,
  LENS_RAG,
  getLensById,
  unionProfileAndLenses,
  LENS_ID_RAG,
  type AprfPolicy,
} from "../src/index.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(PROFILE_ID_CORE === "aprf-profile-core", "core id");
assert(PROFILE_CORE.targetCriticality === 2, "tier 2");
assert(PROFILE_CORE.mandatoryCheckIds.length === 38, "core has 38 mandatories");
assert(
  PROFILE_REGULATED.mandatoryCheckIds.length === 54,
  "regulated has 54 mandatories",
);
assert(
  PROFILE_REGULATED.mandatoryCheckIds.includes("AUTHN-M1"),
  "regulated includes core",
);
assert(getTier3OnlyMandatoryIds().length === 16, "tier3-only count");

assert(
  resolveCheckApplicability("AUTHN-M1", PROFILE_CORE) === "mandatory",
  "profile mandatory",
);
assert(
  resolveCheckApplicability("OTHER-M1", PROFILE_CORE) === "recommended",
  "default recommended",
);

const policy: AprfPolicy = {
  id: "policy-demo",
  name: "Demo",
  aprfVersion: "0.10.0",
  profileIds: [PROFILE_ID_CORE],
  checkOverlays: [
    {
      checkId: "OBS-M1",
      applicability: "not_applicable",
      naJustification: "No production traffic yet",
    },
  ],
};

assert(
  resolveCheckApplicability("OBS-M1", PROFILE_CORE, policy) === "not_applicable",
  "policy overlay wins",
);
assert(!policyTouchesRequirements(policy), "check overlays only");

const digested = withPolicyDigest(policy);
assert(digested.policyDigest?.length === 64, "sha256 digest");
assert(
  buildPolicyDigest(policy.checkOverlays) === digested.policyDigest,
  "digest stable",
);

assert(APRF_LENSES.length === 4, "four lenses");
assert(getLensById(LENS_ID_RAG)?.id === LENS_ID_RAG, "getLensById");
assert(LENS_RAG.additionalMandatoryCheckIds.includes("DG-M1"), "RAG has DG-M1");

const union = unionProfileAndLenses(PROFILE_CORE.mandatoryCheckIds, [
  LENS_ID_RAG,
]);
assert(union.includes("AUTHN-M1"), "union keeps profile");
assert(union.includes("DG-M1"), "union adds lens");
assert(
  union.length === new Set(union).size,
  "union dedupes",
);

console.log("framework-definition self-test OK");
console.log(
  `  digest=${digested.policyDigest?.slice(0, 12)}… core=${PROFILE_CORE.mandatoryCheckIds.length} regulated=${PROFILE_REGULATED.mandatoryCheckIds.length} lenses=${APRF_LENSES.length}`,
);
