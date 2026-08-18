import {
  PROFILE_ID_CORE,
  PROFILE_ID_FRAMEWORK,
  PROFILE_CORE,
  PROFILE_REGULATED,
  PROFILE_FRAMEWORK,
  APRF_PROFILES,
  buildPolicyDigest,
  withPolicyDigest,
  resolveCheckApplicability,
  policyTouchesRequirements,
  getTier3OnlyMandatoryIds,
  getProfileById,
  APRF_LENSES,
  LENS_RAG,
  getLensById,
  unionProfileAndLenses,
  LENS_ID_RAG,
  resolveAssessmentTarget,
  type AprfPolicy,
} from "../src/index.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(PROFILE_ID_CORE === "aprf-profile-core", "core id");
assert(PROFILE_ID_FRAMEWORK === "aprf-profile-framework", "framework id");
assert(PROFILE_CORE.targetCriticality === 2, "tier 2");
assert(PROFILE_CORE.mandatoryCheckIds.length === 39, "core has 39 mandatories");
assert(
  PROFILE_REGULATED.mandatoryCheckIds.length === 51,
  "regulated has 51 mandatories",
);
assert(
  PROFILE_FRAMEWORK.mandatoryCheckIds.length === 7,
  "framework has 7 mandatories",
);
assert(
  JSON.stringify(PROFILE_FRAMEWORK.mandatoryCheckIds) ===
    JSON.stringify([
      "AGN-M2",
      "TOL-M2",
      "TOL-M4",
      "SEC-M1",
      "SEC2-M1",
      "SEC2-M2",
      "SCI-M2",
    ]),
  "framework exact Check set",
);
assert(APRF_PROFILES.length === 3, "three profiles");
assert(
  getProfileById(PROFILE_ID_FRAMEWORK)?.id === PROFILE_ID_FRAMEWORK,
  "#6 getProfileById framework",
);
assert(
  PROFILE_REGULATED.mandatoryCheckIds.includes("AUTHN-M1"),
  "regulated includes core",
);
assert(getTier3OnlyMandatoryIds().length === 12, "tier3-only count");

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
  aprfVersion: "0.11.0",
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
assert(union.length === new Set(union).size, "union dedupes");

const chatbot = resolveAssessmentTarget({
  systemType: "ai-application",
  capabilities: ["chatbot"],
});
assert(chatbot.effectiveCheckIds.includes("AGN-M2"), "#4 keeps AGN-M2");
assert(chatbot.effectiveCheckIds.includes("TOL-M1"), "#4 keeps TOL-M1");
assert(chatbot.assessmentKind === "aprf-core", "chatbot core kind");

let threw = false;
try {
  resolveAssessmentTarget({
    systemType: "ai-applicaton" as never,
  });
} catch {
  threw = true;
}
assert(threw, "typo systemType throws");

threw = false;
try {
  resolveAssessmentTarget({
    systemType: "ai-framework",
    profileId: "core",
  });
} catch {
  threw = true;
}
assert(threw, "#5 framework+core throws");

threw = false;
try {
  resolveAssessmentTarget({
    systemType: "ai-framework",
    fullCatalog: true,
  });
} catch {
  threw = true;
}
assert(threw, "#5 framework+full throws");

const fwLens = resolveAssessmentTarget({
  systemType: "ai-framework",
  explicitLensIds: ["agents"],
});
assert(fwLens.lensIds.length === 0, "#5 framework lenses empty");
assert(
  fwLens.warnings.some((w) => /lenses ignored/i.test(w)),
  "#5 lens warning",
);
assert(fwLens.assessmentKind === "aprf-framework", "framework kind");
assert(
  fwLens.effectiveCheckIds.length === PROFILE_FRAMEWORK.mandatoryCheckIds.length,
  "framework gate size",
);

const emptyCaps = resolveAssessmentTarget({ systemType: "ai-application" });
assert(
  emptyCaps.warnings.some((w) => w.includes("No applicationCapabilities")),
  "#7 empty caps warning",
);
assert(
  emptyCaps.effectiveCheckIds.length === PROFILE_CORE.mandatoryCheckIds.length,
  "#7 empty caps = Core size",
);

const otherCap = resolveAssessmentTarget({
  systemType: "ai-application",
  capabilities: ["other"],
});
assert(otherCap.lensIds.length === 0, "#7 other adds no lenses");
assert(
  otherCap.effectiveCheckIds.length === PROFILE_CORE.mandatoryCheckIds.length,
  "#7 other = Core only",
);
assert(
  otherCap.applicationCapabilities.includes("other"),
  "#7 other recorded on scope",
);
assert(
  !otherCap.warnings.some((w) => w.includes("No applicationCapabilities")),
  "#7 other ≠ empty omit",
);

const regRag = resolveAssessmentTarget({
  systemType: "ai-application",
  profileId: "regulated",
  capabilities: ["rag"],
});
assert(regRag.assessmentKind === "aprf-regulated", "#8 regulated kind");
assert(regRag.lensIds.includes(LENS_ID_RAG), "#8 rag lens");
assert(regRag.effectiveCheckIds.includes("DG-M1"), "#8 rag adds DG");
assert(regRag.effectiveCheckIds.includes("REL-M5"), "#8 keeps regulated");

threw = false;
try {
  resolveAssessmentTarget({
    systemType: "ai-application",
    capabilities: ["not-a-cap"],
  });
} catch {
  threw = true;
}
assert(threw, "G7 invalid capability throws");

const nonAi = resolveAssessmentTarget({ systemType: "non-ai-platform" });
assert(nonAi.assessmentKind === "non-ai-platform-subset", "non-ai kind");
assert(nonAi.effectiveCheckIds.length === 0, "non-ai empty checks");
assert(
  nonAi.profile.id === "aprf-scope-non-ai-platform",
  "non-ai placeholder profile id",
);
assert(nonAi.profile.id !== PROFILE_ID_CORE, "non-ai must not surface Core id");
assert(
  nonAi.warnings.some((w) => w.includes("use-legacy-non-ai-scope")),
  "non-ai legacy warning",
);

console.log("framework-definition self-test OK");
console.log(
  `  digest=${digested.policyDigest?.slice(0, 12)}… core=${PROFILE_CORE.mandatoryCheckIds.length} regulated=${PROFILE_REGULATED.mandatoryCheckIds.length} framework=${PROFILE_FRAMEWORK.mandatoryCheckIds.length} lenses=${APRF_LENSES.length}`,
);
