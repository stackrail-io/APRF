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
      "Signals alone are PARTIAL — import selfHostedModelRuntimesWithWorkloadIdentityPct=100 + staticSharedKeysInRuntimeInventory=0 + sampleAuthenticatedCallsPresent=true (measuredAt ≤90d) under imports/workload-identity-runtimes/ to PASS. Set selfHostedModelRuntimesPresent=false for NOT_APPLICABLE.",
    ],
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
        detail: "AUTHN-M1 status=partial",
      },
      {
        pluginId: "workload-identity-runtimes",
        status: "ran",
        detail: "AUTHN-R2 status=partial signals=true satisfied=false",
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
    recommendedScore: number;
  };
  controls: Array<{
    checkId: string;
    status: string;
    passed: boolean;
    notApplicable?: boolean;
    domain: string;
    severity?: string;
    evidenceFound: unknown[];
    requiredEvidenceMissing?: string[];
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

assert(a.executiveSummary.criticalityName === "Production", "criticality name");
assert(a.executiveSummary.overallGatePassed === false, "gate must fail");

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

const authn = byId.get("AUTHN-M1");
assert(
  authn?.status === "PARTIAL",
  "AUTHN-M1 PARTIAL from collector detail fallback",
);

const authnR2 = byId.get("AUTHN-R2");
assert(authnR2?.status === "PARTIAL", "AUTHN-R2 PARTIAL from statusHint");
assert(
  authnR2?.requiredEvidenceMissing?.some((n) =>
    /Signals alone are PARTIAL/i.test(n),
  ),
  `AUTHN-R2 Evidence still required must use collector gapNotes, not YAML dump; got ${JSON.stringify(authnR2?.requiredEvidenceMissing)}`,
);
assert(
  !authnR2?.requiredEvidenceMissing?.some((n) =>
    /Inventory of self-hosted model runtimes/i.test(n),
  ),
  "AUTHN-R2 must not dump normative evidenceRequired when gapNotes exist",
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

const htmlPath = resolve(root, "REPORT.html");
writeAssessmentHtmlReport(assessmentPath, htmlPath);
const verify = verifyHtmlReport(htmlPath);
assert(verify.ok, `html verify: ${JSON.stringify(verify)}`);

console.log(`aprf assess engine smoke OK → ${htmlPath}`);
rmSync(root, { recursive: true, force: true });
