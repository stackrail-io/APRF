/**
 * Unit / self-tests for @stackrail-io/aprf-engine.
 * Run: npm run test:unit -w @stackrail-io/aprf-engine
 */
import { getGeneratedCatalog, getGeneratedRuleIndex } from "../src/catalog.js";
import {
  selectApplicableRules,
  evaluateRules,
  findingsToCheckOutcomes,
} from "../src/evaluate.js";
import { createDetectorRegistry } from "../src/detectors/registry.js";
import { listCatalogDetectorIds } from "../src/detectors/catalog-ids.js";
import { getRuleById } from "../src/index-builder.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const catalog = getGeneratedCatalog();
assert(catalog.ruleCount === 178, `expected 178 rules, got ${catalog.ruleCount}`);
assert(catalog.rules.length === 178, "rules array length");
assert(
  catalog.generatedAt.startsWith("sha256:"),
  "generatedAt should be content hash",
);
assert(
  (catalog.domains?.length ?? 0) >= 9,
  `expected domains+crossCutting (>=9), got ${catalog.domains?.length}`,
);
assert(
  (catalog.pillars?.length ?? 0) === 27,
  `expected 27 pillars, got ${catalog.pillars?.length}`,
);
assert(
  catalog.pillars?.some((p) => p.id === "APRF-01" && p.slug === "ai-security"),
  "APRF-01 ai-security pillar present",
);

const ids = catalog.rules.map((r) => r.id);
assert(new Set(ids).size === ids.length, "duplicate rule ids in catalog");

const sorted = [...ids].sort((a, b) => a.localeCompare(b));
assert(
  JSON.stringify(ids) === JSON.stringify(sorted),
  "catalog rules must be sorted by id (deterministic)",
);

for (const rule of catalog.rules) {
  if (
    rule.detection.capability === "automated" ||
    rule.detection.capability === "hybrid"
  ) {
    const dets = rule.detection.detectors ?? [];
    assert(
      dets.some((d) => d.id !== "manual-attest"),
      `${rule.id}: ${rule.detection.capability} without non-manual detector`,
    );
  }
}

const index = getGeneratedRuleIndex();
assert(index.byId.size === 178, "index size");
assert(getRuleById(index, "SEC-M1")?.id === "SEC-M1", "getRuleById SEC-M1");

const allowlist = new Set(listCatalogDetectorIds());
assert(allowlist.has("manual-attest"), "manual-attest in allowlist");
assert(allowlist.size >= 40, "detector allowlist size");
assert(!allowlist.has("gha-permissions-scoped"), "unused detector id removed");

const registry = createDetectorRegistry();
assert(registry.ids().length === 1, "default registry is attestation-only");
assert(registry.has("manual-attest"), "manual-attest present");

const sample = catalog.rules.slice(0, 5);
const selected = selectApplicableRules(sample, {
  criticality: 3,
  capabilityLevel: 5,
});
assert(
  selected.length ===
    sample.filter((r) => r.status !== "draft" && r.status !== "deprecated" && !r.deprecated)
      .length,
  "select all active",
);

const deprecated = catalog.rules.filter(
  (r) => r.status === "deprecated" || r.deprecated === true,
);
assert(deprecated.length >= 1, "catalog has deprecated rules");
const noDeprecated = selectApplicableRules(deprecated, {
  criticality: 5,
  capabilityLevel: 5,
});
assert(noDeprecated.length === 0, "deprecated rules are not selected");

const gated = selectApplicableRules(catalog.rules, {
  criticality: 3,
  capabilityLevel: 5,
  gateRuleIds: ["AUTHN-M1", "SEC-M1"],
});
assert(gated.map((r) => r.id).sort().join(",") === "AUTHN-M1,SEC-M1", "gateRuleIds");

const findings = await evaluateRules(catalog.rules, {
  criticality: 2,
  capabilityLevel: 3,
  gateRuleIds: ["AUTHN-M1", "OBS-M1"],
}, {
  attested: [
    { ruleId: "AUTHN-M1", passed: true, evidenceRef: "ev-1" },
    {
      ruleId: "OBS-M1",
      passed: false,
      notApplicable: true,
      naReason: "No production traffic",
    },
  ],
});

assert(findings.length === 2, "two findings");
const byId = Object.fromEntries(findings.map((f) => [f.ruleId, f]));
assert(byId["AUTHN-M1"]?.status === "passed", "attested pass");
assert(byId["OBS-M1"]?.status === "notApplicable", "attested N/A");

const outcomes = findingsToCheckOutcomes(findings);
const obs = outcomes.find((o) => o.checkId === "OBS-M1");
assert(obs?.passed === false, "N/A must not set passed=true");
assert(obs?.notApplicable === true, "N/A flag set");
assert(obs?.status === "notApplicable", "status preserved");

const errored = findingsToCheckOutcomes([
  {
    ruleId: "SEC-M1",
    status: "error",
    summary: "detector blew up",
  },
]);
assert(errored[0]?.passed === false, "error is not pass");
assert(errored[0]?.error === true, "error flag set");
assert(errored[0]?.status === "error", "error status preserved");

let threw = false;
try {
  await evaluateRules(sample, { criticality: 3 }, { runDetectors: true });
} catch {
  threw = true;
}
assert(threw, "runDetectors without registry must throw");

const unattested = await evaluateRules(
  [getRuleById(index, "AUTHN-M1")!],
  { criticality: 3, capabilityLevel: 5 },
  {},
);
assert(unattested[0]?.status === "failed", "no attestation → failed");
assert(
  unattested[0]?.summary.includes("No attestation"),
  "attestation-only summary",
);

const agnM1 = getRuleById(index, "AGN-M1")!;
assert(agnM1.detection.capability === "hybrid", "AGN-M1 is hybrid");
assert(
  (agnM1.detection.detectors ?? []).some((d) => d.id === "manual-attest"),
  "AGN-M1 still lists manual-attest fallback",
);
assert(
  (agnM1.detection.detectors ?? []).some((d) => d.id === "repo-agent-charter-inventory"),
  "AGN-M1 has non-manual detector",
);

const passStub = {
  id: "repo-agent-charter-inventory",
  technologies: [],
  description: "self-test stub",
  async run() {
    return { passed: true, summary: "charter inventory ok", evidenceRef: "ev-stub" };
  },
};
const hybridRegistry = createDetectorRegistry([passStub]);
const detectorFindings = await evaluateRules(
  [agnM1],
  { criticality: 3, capabilityLevel: 5 },
  { runDetectors: true, registry: hybridRegistry },
);
assert(detectorFindings[0]?.status === "passed", "hybrid detector mode can PASS");
assert(
  !detectorFindings[0]?.summary.includes("Manual attestation required"),
  "manual-attest is not AND-failed in detector mode",
);
assert(
  detectorFindings[0]?.detectorIds?.includes("repo-agent-charter-inventory") &&
    !detectorFindings[0]?.detectorIds?.includes("manual-attest"),
  "manual-attest skipped when scoring detectors",
);

const failStub = {
  id: "repo-agent-charter-inventory",
  technologies: [],
  description: "self-test fail stub",
  async run() {
    return { passed: false, summary: "charter inventory missing" };
  },
};
const failFindings = await evaluateRules(
  [agnM1],
  { criticality: 3, capabilityLevel: 5 },
  { runDetectors: true, registry: createDetectorRegistry([failStub]) },
);
assert(failFindings[0]?.status === "failed", "failing non-manual detector still fails");
assert(
  failFindings[0]?.summary.includes("charter inventory missing"),
  "fail summary comes from non-manual detector",
);
assert(
  !failFindings[0]?.summary.includes("Manual attestation required"),
  "manual-attest does not mask non-manual detector failure",
);

console.log("aprf-engine self-test OK");
console.log(
  `  rules=${catalog.ruleCount} hash=${catalog.generatedAt.slice(0, 18)}… detectors=${allowlist.size}`,
);
