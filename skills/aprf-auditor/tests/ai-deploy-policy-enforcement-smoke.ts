/**
 * Smoke: ai-deploy-policy-enforcement needs enforced + unsigned/unapproved/
 * revoked blocked + measuredAt ≤90d; CI signing alone ≠ PASS.
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
  aiDeployPolicyEnforcementCollector,
  type AiDeployPolicyEnforcementReport,
} from "../collectors/ai-deploy-policy-enforcement.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiDeployPolicyEnforcementReport> {
  await aiDeployPolicyEnforcementCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-deploy-policy-enforcement",
        "ai-deploy-policy-enforcement-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionAiArtifactsDeployed: true,
    deploymentPolicyEnforced: true,
    unsignedBlocked: true,
    unapprovedBlocked: true,
    revokedOrUntrustedRejected: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sci-m4-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tPol = join(root, "t-pol");
    mkdirSync(join(tPol, "policy"), { recursive: true });
    writeFileSync(
      join(tPol, "policy", "kyverno-deploy-policy.yaml"),
      "apiVersion: kyverno.io/v1\nkind: ClusterPolicy\nmetadata:\n  name: verify-images\n",
    );
    const r1 = await run(tPol, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with policy surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "ai-deploy-policy-enforcement"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "ai-deploy-policy-enforcement", "coverage.json"),
      coverage({ unsignedBlocked: false }),
    );
    const r2 = await run(tPol, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "ai-deploy-policy-enforcement"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "ai-deploy-policy-enforcement", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tPol, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "ai-deploy-policy-enforcement"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "ai-deploy-policy-enforcement", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tPol, outPass);
    if (r3.summary.sciM4Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-deploy-policy-enforcement"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "ai-deploy-policy-enforcement", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiArtifactsDeployed: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outPolNa = join(root, "o-pol-na");
    mkdirSync(join(outPolNa, "imports", "ai-deploy-policy-enforcement"), {
      recursive: true,
    });
    writeFileSync(
      join(outPolNa, "imports", "ai-deploy-policy-enforcement", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiArtifactsDeployed: false,
      }),
    );
    const rPolNa = await run(tPol, outPolNa);
    if (rPolNa.summary.statusHint === "not_applicable") {
      throw new Error("deploy-policy signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "ai-deploy-policy-enforcement"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "ai-deploy-policy-enforcement", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAiArtifactsDeployed: false,
        deploymentPolicyEnforced: false,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing enforce flag must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor ai-deploy-policy-enforcement smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
