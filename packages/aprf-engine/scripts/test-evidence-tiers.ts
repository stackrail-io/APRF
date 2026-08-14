/**
 * Unit tests for Evidence Assurance Tiers (APRF-RFC-0011).
 */
import assert from "node:assert/strict";
import {
  classifyAchievedTier,
  defaultMinimumTier,
  matchedEvidenceTypes,
  resolveMinimumTier,
  tierMeetsFloor,
  verificationFor,
} from "../src/evidence-tiers.js";

assert.equal(defaultMinimumTier("manual"), "E1");
assert.equal(defaultMinimumTier("hybrid"), "E3");
assert.equal(defaultMinimumTier("automated"), "E4");
assert.equal(
  resolveMinimumTier({ minimumTier: "E4" }, "hybrid"),
  "E4",
);
assert.equal(resolveMinimumTier(undefined, "hybrid"), "E3");

assert.equal(
  classifyAchievedTier({ evidenceClasses: [], repoSignalsPresent: false }),
  "E0",
);
assert.equal(
  classifyAchievedTier({
    evidenceClasses: ["code"],
    repoSignalsPresent: true,
  }),
  "E2",
);
assert.equal(
  classifyAchievedTier({
    evidenceClasses: ["iac"],
    repoSignalsPresent: true,
  }),
  "E3",
);
assert.equal(
  classifyAchievedTier({
    evidenceClasses: ["iac"],
    measuredImportPresent: true,
  }),
  "E4",
);
assert.equal(
  classifyAchievedTier({
    evidenceClasses: ["runtime"],
    independentVerification: true,
  }),
  "E5",
);

// statusHint=pass must NOT be modeled as measuredImportPresent here — callers
// must pass measuredImportPresent from import packs only.
assert.equal(
  classifyAchievedTier({
    evidenceClasses: ["code"],
    repoSignalsPresent: true,
    measuredImportPresent: false,
  }),
  "E2",
);

// emitsEvidenceTier must not boost signal-only scans to E3+.
assert.equal(
  classifyAchievedTier({
    evidenceClasses: [],
    repoSignalsPresent: true,
    pluginEmitsTier: "E3",
  }),
  "E2",
);

assert.equal(tierMeetsFloor("E2", "E3"), false);
assert.equal(tierMeetsFloor("E4", "E3"), true);

assert.equal(
  verificationFor({
    status: "PARTIAL",
    achieved: "E2",
    minimum: "E3",
  }),
  "UNVERIFIED",
);
assert.equal(
  verificationFor({
    status: "PARTIAL",
    achieved: "E3",
    minimum: "E3",
  }),
  "NONE",
  "floor-met PARTIAL is metrics-incomplete, not below-floor UNVERIFIED",
);
assert.equal(
  verificationFor({
    status: "PASS",
    achieved: "E4",
    minimum: "E3",
  }),
  "VERIFIED",
);
assert.equal(
  verificationFor({
    status: "NOT_DEMONSTRATED",
    achieved: "E0",
    minimum: "E3",
  }),
  "NONE",
);
assert.equal(
  verificationFor({
    status: "NOT_APPLICABLE",
    achieved: "E0",
    minimum: "E3",
  }),
  "NOT_APPLICABLE",
);

assert.deepEqual(
  matchedEvidenceTypes({
    evidenceClasses: ["code"],
    acceptable: ["patching_sla_report", "repo_signal"],
    repoSignalsPresent: true,
  }),
  ["repo_signal"],
);
assert.deepEqual(
  matchedEvidenceTypes({
    evidenceClasses: ["iac"],
    acceptable: ["patching_sla_report", "repo_signal", "iac_module"],
    repoSignalsPresent: true,
  }),
  ["iac_module"],
  "iac class only implies iac_module without collector provenance",
);
assert.deepEqual(
  matchedEvidenceTypes({
    evidenceClasses: ["runtime"],
    acceptable: ["reachability_probe", "network_policy"],
  }),
  [],
  "bare runtime class must not claim every runtime evidence type",
);
assert.deepEqual(
  matchedEvidenceTypes({
    evidenceClasses: [],
    acceptable: ["reachability_probe", "network_policy"],
    observedEvidenceTypes: ["reachability_probe"],
  }),
  ["reachability_probe"],
  "imported type with provenance matches acceptable",
);
assert.deepEqual(
  matchedEvidenceTypes({
    evidenceClasses: [],
    acceptable: ["reachability_probe", "network_policy"],
    observedEvidenceTypes: ["patching_sla_report"],
  }),
  [],
  "unrelated imported type must not match acceptable",
);

console.log("aprf-engine evidence-tiers tests OK");
