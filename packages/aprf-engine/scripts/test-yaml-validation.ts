/**
 * Unit tests for Check YAML lint (schema-adjacent + spec mapping) plus a full
 * by-domain catalog sweep (same checks as validate.ts).
 * Run: npm run test:yaml -w @stackrail-io/aprf-engine
 */
import { parse as parseYaml } from "yaml";
import {
  buildSpecCheckIndex,
  lintCategoryNotEchoedInProse,
  lintEvidencePolicy,
  lintForbiddenProse,
  lintFixedEnums,
  lintIdGateConvention,
  lintOwnIdNotRepeated,
  lintTitleObligation,
  lintYamlRule,
  missingMandatoryFields,
  lintRawYamlNoEllipsis,
  type SpecCheckRef,
  type YamlLintContext,
} from "../src/yaml-lint.js";
import { validateAllByDomainYaml } from "./validate-catalog.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertIncludes(errors: string[], fragment: string, msg: string) {
  assert(
    errors.some((e) => e.includes(fragment)),
    `${msg}\n  errors: ${errors.join(" | ") || "(none)"}`,
  );
}

function assertNone(errors: string[], msg: string) {
  assert(errors.length === 0, `${msg}\n  errors: ${errors.join(" | ")}`);
}

const baseRule = {
  id: "SEC-M1",
  category: "ai-security",
  title: "Untrusted input must never authorize privileged actions alone",
  description:
    "Untrusted input shall never authorize privileged actions without server-side policy",
  whyItMatters:
    "Prompt injection must not become privilege escalation; policy belongs outside the model.",
  severity: "critical",
  weight: 4,
  gate: "mandatory",
  passCondition:
    "≥95% of corpus cases that attempt privilege escalation via untrusted input are denied",
  evidenceRequired: ["Injection corpus + CI gate report"],
  detection: { capability: "manual", detectors: [{ id: "manual-attest" }] },
  manualVerification: "Review corpus deny rates and privileged tool-call logs.",
  falsePositiveGuidance: "Do not waive on prompt-only mitigations.",
  recommendedFixes: ["Add server-side privilege policy before tool dispatch"],
  references: [{ title: "OWASP LLM01", url: "https://owasp.org/" }],
  relatedRules: ["SEC-M2"],
  tags: ["ai-security", "mandatory"],
  applicability: { minCriticality: 2, requiredFromLevel: 3 },
  status: "active",
};

const specById = new Map<string, SpecCheckRef>([
  [
    "SEC-M1",
    {
      id: "SEC-M1",
      gate: "mandatory",
      pillarSlug: "ai-security",
      pillarId: "APRF-01",
      pillarSeverity: "critical",
      domain: "security",
      method: "manual",
      requiredFromLevel: 3,
      minCriticality: 2,
      passCondition: baseRule.passCondition,
      requirement: baseRule.description,
    },
  ],
  [
    "SEC-R1",
    {
      id: "SEC-R1",
      gate: "recommended",
      pillarSlug: "ai-security",
      pillarId: "APRF-01",
      pillarSeverity: "critical",
      domain: "security",
      method: "manual",
      requiredFromLevel: 4,
      minCriticality: 2,
      passCondition: "suite passes",
      requirement: "Red-team suite",
    },
  ],
]);

const ctx: YamlLintContext = {
  pillarSlugs: new Set(["ai-security", "authentication"]),
  specById,
};

// 1) Mandatory fields
assertIncludes(
  missingMandatoryFields({ id: "X" }),
  "missing mandatory field",
  "incomplete doc reports missing fields",
);
assertNone(missingMandatoryFields(baseRule), "complete fixture has all fields");

// 2) Fixed enum sets (severity / gate / status / capability) — "governance" fixed sets
assertIncludes(
  lintFixedEnums({ ...baseRule, severity: "urgent" }),
  'severity "urgent"',
  "severity must be from fixed set",
);
assertIncludes(
  lintFixedEnums({ ...baseRule, gate: "optional" }),
  'gate "optional"',
  "gate must be from fixed set",
);
assertIncludes(
  lintFixedEnums({
    ...baseRule,
    detection: { capability: "magic" },
  }),
  'detection.capability "magic"',
  "capability must be from fixed set",
);

// 3) id maps to spec
assertIncludes(
  lintYamlRule({ ...baseRule, id: "NOPE-M1", gate: "mandatory" }, ctx),
  "does not map to any Check in aprf-spec.json",
  "unknown id fails",
);

// 4) No ellipsis / placeholders
assertIncludes(
  lintForbiddenProse({
    ...baseRule,
    whyItMatters: "truncated when excee…",
  }),
  "ellipsis",
  "unicode ellipsis rejected",
);
assertIncludes(
  lintForbiddenProse({
    ...baseRule,
    whyItMatters: "see details...",
  }),
  "ASCII ellipsis",
  "ASCII ellipsis rejected",
);
assertIncludes(
  lintRawYamlNoEllipsis("title: incomplete...\n"),
  "ASCII ellipsis",
  "raw file ASCII ellipsis rejected",
);
assertIncludes(
  lintRawYamlNoEllipsis("title: incomplete…\n"),
  "unicode ellipsis",
  "raw file unicode ellipsis rejected",
);
assertNone(
  lintRawYamlNoEllipsis("title: complete sentence.\n"),
  "raw file without ellipsis ok",
);
assertIncludes(
  lintForbiddenProse({ ...baseRule, title: "TODO fix this" }),
  "TODO",
  "TODO rejected",
);

// 5) Valid YAML parse (fixture string)
{
  let threw = false;
  try {
    parseYaml("id: [unclosed");
  } catch {
    threw = true;
  }
  assert(threw, "invalid YAML must throw on parse");
  const ok = parseYaml("id: SEC-M1\ncategory: ai-security\n");
  assert((ok as { id: string }).id === "SEC-M1", "valid YAML parses");
}

// 6) severity fixed + mandatory cannot be low
assertIncludes(
  lintYamlRule({ ...baseRule, severity: "low" }, ctx),
  'severity "low" is not allowed for mandatory',
  "mandatory+low rejected",
);

// 7) gate maps to spec
assertIncludes(
  lintYamlRule({ ...baseRule, gate: "recommended" }, ctx),
  "does not map to spec",
  "gate mismatch vs spec list",
);

// category maps to pillar set + spec slug
assertIncludes(
  lintYamlRule({ ...baseRule, category: "not-a-pillar" }, ctx),
  "not in fixed pillar/category set",
  "unknown category rejected",
);
assertIncludes(
  lintYamlRule({ ...baseRule, category: "authentication" }, ctx),
  "does not map to spec pillar slug",
  "category/spec slug mismatch",
);

// id ↔ gate letter convention
assertIncludes(
  lintIdGateConvention({ id: "SEC-M1", gate: "recommended" }),
  "uses -M# but gate is",
  "M-id requires mandatory",
);
assertIncludes(
  lintIdGateConvention({ id: "SEC-R1", gate: "mandatory" }),
  "uses -R# but gate is",
  "R-id requires recommended",
);

// applicability maps to spec
assertIncludes(
  lintYamlRule(
    {
      ...baseRule,
      applicability: { minCriticality: 2, requiredFromLevel: 5 },
    },
    ctx,
  ),
  "requiredFromLevel 5 does not map to spec",
  "level mismatch",
);

// title obligation: must / should (must have / should have)
assertIncludes(
  lintTitleObligation({
    title: "Goal conflict detection before plan execution",
    gate: "recommended",
  }),
  "obligation language",
  "title without must/should rejected",
);
assertIncludes(
  lintTitleObligation({
    title: "Systems should have goal conflict detection",
    gate: "mandatory",
  }),
  "must",
  "recommended phrasing on mandatory rejected",
);
assertIncludes(
  lintTitleObligation({
    title: "APIs must reject unauthenticated callers",
    gate: "recommended",
  }),
  "should",
  "must phrasing on recommended rejected",
);
assertNone(
  lintTitleObligation({
    title: "Every agent must have a documented charter",
    gate: "mandatory",
  }),
  "must have on mandatory ok",
);
assertNone(
  lintTitleObligation({
    title: "Systems should have goal conflict detection",
    gate: "recommended",
  }),
  "should have on recommended ok",
);

// own id must not appear outside id field
assertIncludes(
  lintOwnIdNotRepeated({
    id: "SEC-M1",
    whyItMatters: "SEC-M1 matters because injection escalates privilege",
  }),
  'must not repeat Check id "SEC-M1"',
  "own id in whyItMatters rejected",
);
assertIncludes(
  lintOwnIdNotRepeated({
    id: "SEC-M1",
    relatedRules: ["SEC-M1", "SEC-M2"],
  }),
  "must not reference this Check's own id",
  "self-relatedRules rejected",
);
assertNone(
  lintOwnIdNotRepeated({
    id: "SEC-M1",
    title: "Untrusted input must never authorize privileged actions alone",
    relatedRules: ["SEC-M2"],
  }),
  "peer relatedRules ok; title without own id ok",
);

// category must not be echoed as "(slug):" in prose
assertIncludes(
  lintCategoryNotEchoedInProse(
    {
      category: "agent-governance",
      whyItMatters: "(agent-governance): Hard limits shall exist on agent loops",
    },
    new Set(["agent-governance"]),
  ),
  "must not echo category",
  "category slug echo rejected",
);
assertIncludes(
  lintCategoryNotEchoedInProse({
    category: "agent-governance",
    whyItMatters: "(Agent Governance, mandatory): Hard limits shall exist",
  }),
  "must not prefix prose with",
  "named gate echo rejected",
);
assertNone(
  lintCategoryNotEchoedInProse(
    {
      category: "agent-governance",
      whyItMatters: "Hard limits prevent runaway agent loops.",
    },
    new Set(["agent-governance"]),
  ),
  "clean prose without category echo ok",
);

// happy path
assertNone(lintYamlRule(baseRule, ctx), "valid fixture passes full lint");

// buildSpecCheckIndex
{
  const map = buildSpecCheckIndex({
    pillars: [
      {
        id: "APRF-01",
        slug: "ai-security",
        domain: "security",
        severity: "critical",
        mandatoryChecks: [
          {
            id: "SEC-M1",
            method: "manual",
            requiredFromLevel: 3,
            minCriticality: 2,
            passCondition: "x",
            requirement: "y",
          },
        ],
        recommendedChecks: [
          {
            id: "SEC-R1",
            method: "manual",
            requiredFromLevel: 4,
            minCriticality: 2,
            passCondition: "x",
            requirement: "y",
          },
        ],
      },
    ],
  });
  assert(map.get("SEC-M1")?.gate === "mandatory", "index mandatory");
  assert(map.get("SEC-R1")?.gate === "recommended", "index recommended");
}

// evidencePolicy (APRF-RFC-0011)
assertNone(
  lintEvidencePolicy({
    ...baseRule,
    evidencePolicy: {
      minimumTier: "E3",
      acceptableEvidence: ["network_policy", "repo_signal"],
    },
  }),
  "known evidencePolicy ids + tier ok",
);
assertIncludes(
  lintEvidencePolicy({
    ...baseRule,
    evidencePolicy: { minimumTier: "E9" },
  }),
  'evidencePolicy.minimumTier "E9"',
  "unknown minimumTier rejected",
);
assertIncludes(
  lintEvidencePolicy({
    ...baseRule,
    evidencePolicy: { minimumTtier: "E5" },
  }),
  "evidencePolicy.minimumTtier is not supported",
  "typo evidencePolicy keys rejected",
);
assertIncludes(
  lintEvidencePolicy({
    ...baseRule,
    evidencePolicy: { acceptableEvidence: ["not_a_real_type"] },
  }),
  'unknown id "not_a_real_type"',
  "unknown acceptableEvidence id rejected",
);
assertIncludes(
  lintYamlRule(
    {
      ...baseRule,
      evidencePolicy: { minimumTier: "E5" },
    },
    {
      ...ctx,
      specById: new Map([
        [
          "SEC-M1",
          { ...specById.get("SEC-M1")!, minimumTier: "E1" },
        ],
      ]),
    },
  ),
  "resolved minimumTier E5 does not map to spec.minimumTier E1",
  "evidencePolicy vs projected spec.minimumTier mismatch rejected",
);

// Full catalog: every by-domain/*.yaml (same path as npm run validate)
{
  const catalog = validateAllByDomainYaml();
  assert(
    catalog.fileCount > 0,
    `expected by-domain YAML files, got fileCount=${catalog.fileCount}`,
  );
  assert(
    catalog.errors.length === 0,
    `by-domain catalog lint failed (${catalog.errors.length}):\n  - ${catalog.errors.slice(0, 20).join("\n  - ")}${catalog.errors.length > 20 ? `\n  ... +${catalog.errors.length - 20} more` : ""}`,
  );
  assert(
    catalog.ruleCount === catalog.fileCount,
    `loader ruleCount (${catalog.ruleCount}) != by-domain fileCount (${catalog.fileCount})`,
  );
  console.log(
    `aprf-engine by-domain catalog OK (${catalog.fileCount} files, ${catalog.ruleCount} rules, spec-mapped=${catalog.specMappedCount})`,
  );
}

console.log("aprf-engine yaml-validation tests OK");
