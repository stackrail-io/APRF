/**
 * Smoke: assess from statusHints + graph → assessment.json → REPORT.html → verify.
 * Asserts scoring.yaml semantics (N/A ≠ passed, gate blockers, domain taxonomy).
 */
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { writeAssessment } from "../src/assess.ts";
import { writeAssessmentHtmlReport } from "../../../skills/aprf-auditor/scripts/render-html-report.ts";
import { verifyHtmlReport } from "../../../skills/aprf-auditor/scripts/verify-html-report.ts";

const root = join(tmpdir(), `aprf-cli-smoke-${Date.now()}`);
mkdirSync(join(root, "imports", "secrets-hygiene"), { recursive: true });
mkdirSync(join(root, "imports", "ai-harm-policy"), { recursive: true });
mkdirSync(join(root, "imports", "workload-identity-runtimes"), {
  recursive: true,
});
mkdirSync(join(root, "imports", "http-auth-probe"), { recursive: true });
mkdirSync(join(root, "imports", "model-path-egress-boundary"), {
  recursive: true,
});

mkdirSync(join(root, "imports", "aws"), { recursive: true });
writeFileSync(
  join(root, "imports", "secrets-hygiene", "secrets-hygiene-report.json"),
  JSON.stringify({
    pluginId: "secrets-hygiene",
    summary: {
      statusHint: "fail",
      sec2M1Satisfied: false,
      severityHint: "medium",
    },
    gapNotes: ["gap-from-secrets-hygiene"],
  }),
);
writeFileSync(
  join(root, "imports", "aws", "aws-report.json"),
  JSON.stringify({
    pluginId: "aws",
    summary: {
      statusHint: "fail",
      sec2M1Satisfied: false,
      severityHint: "critical",
    },
    gapNotes: ["gap-from-aws"],
  }),
);

writeFileSync(
  join(root, "imports", "ai-harm-policy", "ai-harm-policy-report.json"),
  JSON.stringify({
    pluginId: "ai-harm-policy",
    summary: { statusHint: "not_applicable", safM1Satisfied: false },
  }),
);

writeFileSync(
  join(
    root,
    "imports",
    "workload-identity-runtimes",
    "workload-identity-runtimes-report.json",
  ),
  JSON.stringify({
    pluginId: "workload-identity-runtimes",
    summary: { statusHint: "partial", authnR2Satisfied: false },
    signals: {
      runtimes: { found: true, refs: ["deploy/vllm.yaml", "backend/main.py"] },
      workloadIdentity: { found: false, refs: [] },
      staticKeys: { found: false, refs: [] },
      traces: { found: false, refs: [] },
    },
    notes: [
      "Self-hosted runtime refs: deploy/vllm.yaml",
      "Signals alone are PARTIAL — import selfHostedModelRuntimesWithWorkloadIdentityPct=100 under imports/workload-identity-runtimes/ to PASS.",
    ],
    gapNotes: [
      "We found self-hosted model runtime signals, but still need recent measured evidence (within 90 days) under imports/workload-identity-runtimes/ showing 100% workload identity coverage, zero static shared keys in the inventory, and sample authenticated calls.",
    ],
  }),
);

// Collector wrongly claims PASS with only repo signals / no measuredAt import.
// Assess must coerce to PARTIAL + UNVERIFIED (Evidence Assurance Tier floor).
writeFileSync(
  join(
    root,
    "imports",
    "model-path-egress-boundary",
    "model-path-egress-boundary-report.json",
  ),
  JSON.stringify({
    pluginId: "model-path-egress-boundary",
    summary: { statusHint: "pass", secM4Satisfied: true },
    signals: {
      trustBoundary: { found: true, refs: ["docs/trust-boundary.md"] },
      egressAllowlist: { found: true, refs: ["infra/network-policy.yaml"] },
    },
    notes: ["Signals alone should not PASS — missing measured import."],
  }),
);

writeFileSync(
  join(root, "imports", "http-auth-probe", "auth-probe-report.json"),
  JSON.stringify({
    pluginId: "http-auth-probe",
    summary: {
      statusHint: "fail",
      authnM1Satisfied: false,
      pass: 1,
      fail: 1,
      probeInventoryMatchesRouteCatalog: true,
    },
    signals: {
      unauthenticatedDeclaredRoutes: {
        found: true,
        refs: [
          "GET /api/v1/chats [backend/open_webui/routers/chats.py] → HTTP 200",
        ],
      },
      declaredRouteCatalog: { found: false, refs: [] },
    },
    gapNotes: [
      "GET /api/v1/chats [backend/open_webui/routers/chats.py] → HTTP 200 without credentials — must reject with 401/403",
    ],
    notes: [
      "GET /api/v1/chats [backend/open_webui/routers/chats.py] → HTTP 200 without credentials — must reject with 401/403",
    ],
    results: [],
  }),
);

// Legacy shape: top-level {found,refs} without a signals{} wrapper (AGN-M2 older reports).
mkdirSync(join(root, "imports", "agent-loop-limits"), { recursive: true });
writeFileSync(
  join(root, "imports", "agent-loop-limits", "agent-loop-limits-report.json"),
  JSON.stringify({
    pluginId: "agent-loop-limits",
    summary: {
      statusHint: "partial",
      agnM2Satisfied: false,
      agentSignalsPresent: true,
      allThreeLimitsPresent: false,
    },
    maxSteps: {
      found: true,
      refs: [
        "backend/open_webui/routers/configs.py",
        "backend/open_webui/utils/subagents.py",
      ],
    },
    wallClock: { found: false, refs: [] },
    spawnDepth: { found: false, refs: [] },
    enforcementTests: { found: false, refs: [] },
    notes: ["max-steps signals: backend/open_webui/routers/configs.py"],
  }),
);

writeFileSync(
  join(root, "evidence-graph.json"),
  JSON.stringify({
    schemaVersion: "0.2.0",
    assessedAt: new Date().toISOString(),
    subject: { path: root, name: "smoke" },
    collectors: [
      {
        pluginId: "secrets-hygiene",
        status: "ran",
        detail: "SEC2-M1 status=fail",
      },
      {
        pluginId: "ai-harm-policy",
        status: "ran",
        detail: "SAF-M1 status=not_applicable",
      },
      {
        pluginId: "http-auth-probe",
        status: "ran",
        detail: "AUTHN-M1 status=fail",
      },
      {
        pluginId: "workload-identity-runtimes",
        status: "ran",
        detail: "AUTHN-R2 status=partial signals=true satisfied=false",
      },
      {
        pluginId: "model-path-egress-boundary",
        status: "ran",
        detail: "SEC-M4 status=pass signals=true satisfied=true",
      },
    ],
    nodes: [
      {
        id: "secrets-hygiene:report",
        class: "ci",
        ref: "imports/secrets-hygiene/secrets-hygiene-report.json",
        pluginId: "secrets-hygiene",
        relatedCheckIds: ["SEC2-M1"],
        signals: ["sec2-m1"],
        excerpt: "statusHint=fail",
      },
      {
        id: "model-path-egress-boundary:ref:docs/trust-boundary.md",
        class: "code",
        ref: "docs/trust-boundary.md",
        pluginId: "model-path-egress-boundary",
        relatedCheckIds: ["SEC-M4"],
        signals: ["model-path-egress-boundary-ref"],
        excerpt: "trust boundary docs (repo signal only)",
      },
    ],
    edges: [],
  }),
);

const { path: assessmentPath } = writeAssessment({
  outDir: root,
  profileId: "core",
});

const a = JSON.parse(readFileSync(assessmentPath, "utf8")) as {
  executiveSummary: {
    overallGatePassed: boolean;
    criticalityName: string;
    recommendedScore: number | null;
  };
  scope?: { checkIds?: string[]; profileId?: string };
  controls: Array<{
    checkId: string;
    status: string;
    passed: boolean;
    notApplicable?: boolean;
    domain: string;
    severity?: string;
    evidenceFound: unknown[];
    requiredEvidenceMissing?: string[];
    evidenceTier?: {
      minimum: string;
      achieved: string;
      acceptable: string[];
      matched: string[];
      verification: string;
    };
    crosswalks?: Array<{
      framework: string;
      frameworkId?: string;
      controlRef: string;
      relation: string;
      url?: string;
      relatedPeerControlIds?: string[];
      relatedPeerRefs?: string[];
    }>;
    threatIntel?: {
      securityIntent: string;
      threats: string[];
      protects: string[];
      mitre: { atlas: string[]; attack: string[] };
      mappingRationale: string;
    };
    gate: string;
  }>;
};

const byId = new Map(a.controls.map((c) => [c.checkId, c]));

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error("ASSERT", msg);
    process.exit(1);
  }
}

const CORE_MANDATORY_COUNT = 39;

assert(a.executiveSummary.criticalityName === "Production", "criticality name");
assert(a.executiveSummary.overallGatePassed === false, "gate must fail");
assert(
  a.controls.length === CORE_MANDATORY_COUNT,
  `core profile must score ${CORE_MANDATORY_COUNT} Checks, got ${a.controls.length}`,
);
assert(
  a.controls.every((c) => c.gate === "mandatory"),
  "core profile assess must not expand into recommended Checks from collector hints",
);
assert(
  a.executiveSummary.recommendedScore === null,
  `core profile recommendedScore must be null (not scored), got ${a.executiveSummary.recommendedScore}`,
);
assert(
  /recommendedScore=n\/a/i.test(a.executiveSummary.narrative),
  `narrative must say recommendedScore=n/a; got ${a.executiveSummary.narrative}`,
);
assert(
  !byId.has("AUTHN-R2"),
  "AUTHN-R2 is not a core mandatory — must require --full",
);

// Crosswalks are informative peer-framework alignment from spec/aprf-spec.json.
const agnCrosswalks = byId.get("AGN-M2")?.crosswalks ?? [];
assert(
  agnCrosswalks.some(
    (x) => /NIST/i.test(x.framework) && x.controlRef === "MANAGE",
  ),
  `AGN-M2 must carry spec crosswalks; got ${JSON.stringify(agnCrosswalks)}`,
);
assert(
  agnCrosswalks.every((x) =>
    ["supports", "aligns-with", "partial", "evidence-for"].includes(x.relation),
  ),
  `crosswalk relations must come from the spec vocabulary; got ${JSON.stringify(agnCrosswalks)}`,
);
// AUTHN-M3 is not listed by Check ID, but authentication is a pillar-only
// mapping — expand through category so pillar rows are not silently dropped.
assert(
  (byId.get("AUTHN-M3")?.crosswalks ?? []).some((x) =>
    /NIST/i.test(x.framework),
  ),
  `AUTHN-M3 must inherit pillar-only NIST crosswalks; got ${JSON.stringify(byId.get("AUTHN-M3")?.crosswalks)}`,
);

// Fine-grained peer frameworks (AISVS / MAESTRO) on core agent Check AGN-M2.
assert(
  agnCrosswalks.some(
    (x) =>
      (x.frameworkId === "aisvs" || /AISVS/i.test(x.framework)) &&
      /(?:^|-)C9\./.test(x.controlRef),
  ),
  `AGN-M2 must carry AISVS C9.* crosswalks; got ${JSON.stringify(agnCrosswalks.filter((x) => /AISVS/i.test(x.framework) || x.frameworkId === "aisvs"))}`,
);
assert(
  agnCrosswalks.some(
    (x) => x.frameworkId === "maestro" || /MAESTRO/i.test(x.framework),
  ),
  `AGN-M2 must carry MAESTRO crosswalks; got ${JSON.stringify(agnCrosswalks.filter((x) => /MAESTRO/i.test(x.framework) || x.frameworkId === "maestro"))}`,
);

// OWASP LLM Top 10 → AISVS related-peer bridges surface on mapped Checks.
const secM1Crosswalks = byId.get("SEC-M1")?.crosswalks ?? [];
const llm01 = secM1Crosswalks.find(
  (x) =>
    (x.frameworkId === "owasp-llm-top-10" || /LLM Top 10/i.test(x.framework)) &&
    x.controlRef === "LLM01",
);
assert(
  llm01?.relatedPeerRefs?.some((r) => /AISVS v1\.0-C2\.1/.test(r)) ||
    llm01?.relatedPeerControlIds?.includes("aisvs:v1.0-C2.1"),
  `SEC-M1 LLM01 must bridge to AISVS v1.0-C2.1; got ${JSON.stringify(llm01)}`,
);

// Threat intel is informative context from spec/aprf-threat-map.yaml.
const withoutIntel = [...byId.entries()].filter(
  ([, c]) =>
    !c.threatIntel?.securityIntent ||
    !c.threatIntel?.mappingRationale?.trim() ||
    !c.threatIntel.threats?.length ||
    !c.threatIntel.protects?.length ||
    !Array.isArray(c.threatIntel.mitre?.atlas) ||
    !Array.isArray(c.threatIntel.mitre?.attack),
);
assert(
  withoutIntel.length === 0,
  `every control needs threat intel with a rationale, threats, protects, and mitre arrays; missing on ${withoutIntel
    .map(([id]) => id)
    .join(", ")}`,
);

const agnIntel = byId.get("AGN-M2")?.threatIntel;
assert(
  agnIntel?.threats.includes("Excessive Agency") &&
    agnIntel.mitre.atlas.includes("AML.T0034.002"),
  `AGN-M2 must map agentic resource consumption; got ${JSON.stringify(agnIntel)}`,
);

const badTechniqueIds = [...byId.values()].flatMap((c) => [
  ...(c.threatIntel?.mitre.atlas ?? []).filter(
    (t) => !/^AML\.T\d{4}(\.\d{3})?$/.test(t),
  ),
  ...(c.threatIntel?.mitre.attack ?? []).filter(
    (t) => !/^T\d{4}(\.\d{3})?$/.test(t),
  ),
]);
assert(
  badTechniqueIds.length === 0,
  `MITRE technique IDs must be well-formed; got ${JSON.stringify(badTechniqueIds)}`,
);

// Governance and assurance Checks stay unmapped rather than being forced onto a
// technique, so an all-mapped report would mean the conservative bar slipped.
assert(
  [...byId.values()].some(
    (c) =>
      c.threatIntel?.mitre.atlas.length === 0 &&
      c.threatIntel.mitre.attack.length === 0,
  ),
  "some Checks must stay intentionally unmapped to MITRE",
);

const sec2 = byId.get("SEC2-M1");
assert(sec2?.status === "FAIL", "SEC2-M1 FAIL from statusHint");
assert(sec2?.passed === false, "SEC2-M1 passed=false");
assert((sec2?.evidenceFound?.length ?? 0) >= 1, "SEC2-M1 has evidence");
assert(
  sec2?.domain && sec2.domain !== "secrets",
  `SEC2-M1 domain should be taxonomy name, got ${sec2?.domain}`,
);
assert(
  sec2?.requiredEvidenceMissing?.includes("gap-from-secrets-hygiene") &&
    sec2?.requiredEvidenceMissing?.includes("gap-from-aws"),
  `equal-status merge must keep both gapNotes; got ${JSON.stringify(sec2?.requiredEvidenceMissing)}`,
);
assert(
  sec2?.severity === "critical",
  `equal-status merge must keep worse severityHint; got ${sec2?.severity}`,
);

const saf = byId.get("SAF-M1");
assert(saf?.status === "NOT_APPLICABLE", "SAF-M1 N/A");
assert(saf?.passed === false, "N/A must not set passed=true (scoring.yaml)");
assert(saf?.notApplicable === true, "notApplicable flag");

const authnM3 = byId.get("AUTHN-M3");
assert(
  authnM3?.status === "NOT_DEMONSTRATED",
  `AUTHN-M3 expected NOT_DEMONSTRATED without MFA imports, got ${authnM3?.status}`,
);
assert(
  authnM3?.evidenceFound?.some(
    (e) =>
      typeof e === "object" &&
      e &&
      "ref" in e &&
      (e as { ref: string }).ref === "not-demonstrated" &&
      /No evidence demonstrated yet/i.test(
        String((e as { excerpt?: string }).excerpt ?? ""),
      ),
  ),
  `NOT_DEMONSTRATED must use default Evidence found message; got ${JSON.stringify(authnM3?.evidenceFound)}`,
);
assert(
  !authnM3?.evidenceFound?.some(
    (e) =>
      typeof e === "object" &&
      e &&
      "ref" in e &&
      /ai-admin-mfa-report\.json/i.test(String((e as { ref: string }).ref)),
  ),
  "NOT_DEMONSTRATED must not list empty collector reports as Evidence found",
);

const agnM2 = byId.get("AGN-M2");
assert(agnM2?.status === "PARTIAL", "AGN-M2 PARTIAL from legacy top-level found/refs");
assert(
  agnM2?.evidenceFound?.some(
    (e) =>
      typeof e === "object" &&
      e &&
      "ref" in e &&
      String((e as { ref: string }).ref).includes(
        "backend/open_webui/routers/configs.py",
      ),
  ),
  `AGN-M2 Evidence found must surface maxSteps refs from legacy report shape; got ${JSON.stringify(agnM2?.evidenceFound)}`,
);

const authn = byId.get("AUTHN-M1");
assert(authn?.status === "FAIL", "AUTHN-M1 FAIL from import statusHint");
assert(
  authn?.requiredEvidenceMissing?.some((n) =>
    /GET \/api\/v1\/chats.*must reject/i.test(n),
  ),
  `AUTHN-M1 Evidence still required must list declared route gapNotes; got ${JSON.stringify(authn?.requiredEvidenceMissing)}`,
);
assert(
  !authn?.requiredEvidenceMissing?.some((n) =>
    /APRF_AUTH_PROBE_MAX_ROUTES/i.test(n),
  ),
  "AUTHN-M1 Evidence still required must not expose APRF_AUTH_PROBE_MAX_ROUTES",
);
assert(
  authn?.evidenceFound?.some(
    (e) =>
      typeof e === "object" &&
      e &&
      "ref" in e &&
      /GET \/api\/v1\/chats/.test(String((e as { ref: string }).ref)),
  ),
  `AUTHN-M1 Evidence found should list unauthenticated route refs; got ${JSON.stringify(authn?.evidenceFound)}`,
);

const { path: fullPath } = writeAssessment({
  outDir: root,
  profileId: "core",
  fullCatalog: true,
});
const full = JSON.parse(readFileSync(fullPath, "utf8")) as typeof a;
const fullById = new Map(full.controls.map((c) => [c.checkId, c]));
assert(
  full.controls.length > CORE_MANDATORY_COUNT,
  `full catalog must score more than core mandatories, got ${full.controls.length}`,
);
assert(
  typeof full.executiveSummary.recommendedScore === "number",
  `full catalog must score recommended Checks; got ${full.executiveSummary.recommendedScore}`,
);
const authnR2 = fullById.get("AUTHN-R2");
assert(authnR2?.status === "PARTIAL", "AUTHN-R2 PARTIAL from statusHint");
assert(
  authnR2?.requiredEvidenceMissing?.some((n) =>
    /recent measured evidence|workload identity coverage/i.test(n),
  ),
  `AUTHN-R2 What you need next must use customer-facing gapNotes, not YAML dump; got ${JSON.stringify(authnR2?.requiredEvidenceMissing)}`,
);
assert(
  !authnR2?.requiredEvidenceMissing?.some((n) =>
    /selfHostedModelRuntimesWithWorkloadIdentityPct|Signals alone are PARTIAL|Inventory of self-hosted model runtimes/i.test(
      n,
    ),
  ),
  "AUTHN-R2 must not expose camelCase import recipes or dump normative evidenceRequired when gapNotes exist",
);
assert(
  authnR2?.evidenceFound?.some(
    (e) =>
      typeof e === "object" &&
      e &&
      "ref" in e &&
      (e as { ref: string }).ref === "deploy/vllm.yaml",
  ),
  `AUTHN-R2 Evidence found should list found=true signal refs; got ${JSON.stringify(authnR2?.evidenceFound)}`,
);
assert(
  !authnR2?.evidenceFound?.some(
    (e) =>
      typeof e === "object" &&
      e &&
      "excerpt" in e &&
      /workloadIdentity: found=true/i.test(
        String((e as { excerpt?: string }).excerpt ?? ""),
      ),
  ),
  "AUTHN-R2 Evidence found must not include found=false signals",
);
assert(
  authnR2?.evidenceTier?.minimum === "E3" &&
    authnR2?.evidenceTier?.verification === "UNVERIFIED" &&
    typeof authnR2?.evidenceTier?.achieved === "string",
  `AUTHN-R2 must emit evidenceTier with hybrid floor E3 and UNVERIFIED; got ${JSON.stringify(authnR2?.evidenceTier)}`,
);
assert(
  authnR2?.requiredEvidenceMissing?.some((n) => /UNVERIFIED|below required/i.test(n)),
  "AUTHN-R2 gaps must mention tier UNVERIFIED / below required floor",
);

// SEC-M4: collector said PASS with only code-class repo signals → coerce.
const secM4 = fullById.get("SEC-M4");
assert(
  secM4?.status === "PARTIAL" &&
    secM4?.evidenceTier?.verification === "UNVERIFIED" &&
    secM4?.evidenceTier?.achieved === "E2" &&
    secM4?.evidenceTier?.minimum === "E3" &&
    secM4?.passed === false,
  `SEC-M4 must coerce false PASS below E3 floor to PARTIAL+UNVERIFIED; got ${JSON.stringify({ status: secM4?.status, evidenceTier: secM4?.evidenceTier, passed: secM4?.passed })}`,
);
assert(
  Array.isArray(secM4?.evidenceTier?.matched) &&
    !secM4.evidenceTier.matched.includes("reachability_probe"),
  "SEC-M4 matched[] must not invent reachability_probe without measured import",
);
assert(
  secM4?.evidenceTier?.partialReason == null,
  "below-floor PARTIAL must not set partialReason=metrics_incomplete",
);
assert(
  [...fullById.values()].every(
    (c) =>
      c.evidenceTier?.partialReason !== "metrics_incomplete" ||
      (c.status === "PARTIAL" &&
        c.evidenceTier?.verification === "NONE" &&
        c.evidenceTier?.achieved !== "E0"),
  ),
  "partialReason=metrics_incomplete only on floor-met PARTIAL with substance",
);

const htmlPath = resolve(root, "REPORT.html");
writeAssessmentHtmlReport(assessmentPath, htmlPath);
const verify = verifyHtmlReport(htmlPath);
assert(verify.ok, `html verify: ${JSON.stringify(verify)}`);
const html = readFileSync(htmlPath, "utf8");
assert(
  html.includes("GET /api/v1/chats") &&
    html.includes("unauthenticated caller not rejected"),
  "REPORT.html should show declared route finding, not raw probe JSON",
);
assert(
  !html.includes("APRF_AUTH_PROBE_MAX_ROUTES"),
  "REPORT.html must not show APRF_AUTH_PROBE_MAX_ROUTES in evidence gaps",
);
assert(
  html.includes("Framework crosswalk") &&
    html.includes("informative alignment only"),
  "REPORT.html must show framework crosswalks with the informative-only caveat",
);
assert(
  /NIST AI Risk Management Framework[\s\S]{0,400}MANAGE/.test(html),
  "REPORT.html must show NIST MANAGE under its grouped framework crosswalk",
);
const secM1Panel = html.match(
  /id="detail-SEC-M1"[\s\S]*?(?=<div class="flyout-panel"|$)/,
)?.[0];
assert(
  !!secM1Panel &&
    /LLM01[\s\S]{0,400}related: AISVS v1\.0-C2\.1/.test(secM1Panel),
  "REPORT.html SEC-M1 flyout must show LLM01 related: AISVS v1.0-C2.1",
);
assert(
  html.includes("Why this control exists") &&
    html.includes("informative threat context"),
  "REPORT.html must show threat context with the informative-only caveat",
);
assert(
  html.includes("Threats mitigated") && html.includes("Protects"),
  "REPORT.html must list threats and protected assets",
);
assert(
  html.includes("https://atlas.mitre.org/techniques/AML.T"),
  "REPORT.html must deep-link mapped MITRE ATLAS techniques",
);
// ATLAS addresses sub-techniques by full dotted ID; truncating to the parent
// would silently point at the wrong technique.
assert(
  html.includes("https://atlas.mitre.org/techniques/AML.T0034.002"),
  "REPORT.html must link ATLAS sub-techniques by their full ID",
);
assert(
  html.includes("no technique mapped"),
  "REPORT.html must say so explicitly where a Check is intentionally unmapped",
);
assert(
  html.includes("Top threat exposure") &&
    html.includes("gate-blocking") &&
    html.includes("Unmet controls"),
  "REPORT.html executive summary must roll up top threats across unmet controls",
);
// The rollup must not imply an incident occurred, only unmitigated exposure.
assert(
  html.includes("not that an attack has occurred"),
  "top threat rollup must caveat that unmet means unmitigated or unproven",
);
assert(
  html.includes("Evidence coverage") &&
    html.includes("Repo collectors alone cannot produce PASS") &&
    html.includes("You will not see PASS from a code scan alone") &&
    html.includes("This assessment has 0 PASS"),
  "REPORT.html must explain hybrid evidence coverage and that repo-only collect cannot PASS",
);
assert(
  html.includes("UNVERIFIED (below floor)") &&
    html.includes("Evidence: E2 · Required: E3 · UNVERIFIED"),
  "REPORT.html must surface Evidence Assurance Tiers (achieved / required / UNVERIFIED)",
);
// Executive summary order: verification callout → Evidence coverage → Top threat exposure.
const verifyCalloutAt = html.indexOf("UNVERIFIED (below floor)");
const evidenceCoverageAt = html.indexOf("Evidence coverage");
const topThreatAt = html.indexOf("Top threat exposure");
assert(
  verifyCalloutAt >= 0 &&
    evidenceCoverageAt >= 0 &&
    topThreatAt >= 0 &&
    verifyCalloutAt < evidenceCoverageAt &&
    evidenceCoverageAt < topThreatAt,
  "REPORT.html must order verification callout, then Evidence coverage, then Top threat exposure",
);

console.log(`aprf assess engine smoke OK → ${htmlPath}`);
rmSync(root, { recursive: true, force: true });
