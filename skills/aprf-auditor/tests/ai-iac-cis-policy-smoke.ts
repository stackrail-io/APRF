/**
 * Smoke: ai-iac-cis-policy needs production-AI IaC + CIS-on-apply/PR + fresh report.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  aiIacCisPolicyCollector,
  type AiIacCisPolicyReport,
} from "../collectors/ai-iac-cis-policy.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiIacCisPolicyReport> {
  await aiIacCisPolicyCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-iac-cis-policy", "ai-iac-cis-policy-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inf-r3-"));
  try {
    // Sample Terraform alone → PARTIAL (no production-AI coverage).
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "infra"), { recursive: true });
    writeFileSync(
      join(t1, "infra", "main.tf"),
      'resource "aws_s3_bucket" "logs" { bucket = "example" }\n',
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.infR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    // Production-AI IaC + perfect import → PASS.
    const t2 = join(root, "t2");
    mkdirSync(join(t2, "infra", "prod-ai"), { recursive: true });
    writeFileSync(
      join(t2, "infra", "prod-ai", "sagemaker.tf"),
      "production_ai model_serving sagemaker terraform\n",
    );
    mkdirSync(join(t2, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t2, ".github", "workflows", "iac-policy.yml"),
      "on:\n  pull_request:\njobs:\n  checkov:\n    runs-on: ubuntu-latest\n    steps:\n      - run: checkov -d infra\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-iac-cis-policy"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-iac-cis-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiInfrastructurePresent: true,
        iacCoversProductionAiInfrastructure: true,
        cisAlignedPolicyChecksOnEveryApplyOrPr: true,
        policyScanReportPresent: true,
        openCriticalFindingsUnwaived: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.infR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    // Open critical findings → FAIL.
    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "cis-benchmark.md"),
      "cis_benchmark checkov policy_as_code\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-iac-cis-policy"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-iac-cis-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiInfrastructurePresent: true,
        iacCoversProductionAiInfrastructure: true,
        cisAlignedPolicyChecksOnEveryApplyOrPr: true,
        policyScanReportPresent: true,
        openCriticalFindingsUnwaived: 2,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.infR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    // No production AI infra → N/A.
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-iac-cis-policy"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "ai-iac-cis-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiInfrastructurePresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // Policy-scan docs alone must not block present=false N/A.
    const tPolicyOnly = join(root, "t-policy-only");
    mkdirSync(join(tPolicyOnly, "docs"), { recursive: true });
    writeFileSync(
      join(tPolicyOnly, "docs", "checkov.md"),
      "checkov tfsec cis_benchmark\n",
    );
    const outPolicyOnly = join(root, "o-policy-only");
    mkdirSync(join(outPolicyOnly, "imports", "ai-iac-cis-policy"), {
      recursive: true,
    });
    writeFileSync(
      join(outPolicyOnly, "imports", "ai-iac-cis-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiInfrastructurePresent: false,
      }),
    );
    const rPolicyOnly = await run(tPolicyOnly, outPolicyOnly);
    if (rPolicyOnly.summary.statusHint !== "not_applicable") {
      throw new Error(
        `policy-scan without prod-AI IaC must allow N/A: ${JSON.stringify(rPolicyOnly.summary)}`,
      );
    }

    // Sample IaC + perfect metrics without prod-AI inventory → PARTIAL.
    const tSample = join(root, "t-sample");
    mkdirSync(join(tSample, "infra"), { recursive: true });
    writeFileSync(
      join(tSample, "infra", "main.tf"),
      "terraform {\n  required_version = \">= 1.0\"\n}\n",
    );
    const outSample = join(root, "o-sample");
    mkdirSync(join(outSample, "imports", "ai-iac-cis-policy"), {
      recursive: true,
    });
    writeFileSync(
      join(outSample, "imports", "ai-iac-cis-policy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        cisAlignedPolicyChecksOnEveryApplyOrPr: true,
        policyScanReportPresent: true,
        openCriticalFindingsUnwaived: 0,
      }),
    );
    const rSample = await run(tSample, outSample);
    if (rSample.summary.statusHint !== "partial") {
      throw new Error(
        `sample IaC without prod-AI inventory expected partial: ${JSON.stringify(rSample.summary)}`,
      );
    }

    console.log("aprf-auditor ai-iac-cis-policy smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
