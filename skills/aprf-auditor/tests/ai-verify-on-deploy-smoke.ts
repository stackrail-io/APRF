/**
 * Smoke: ai-verify-on-deploy needs lastDeployVerified + unsigned reject +
 * measuredAt ≤90d; CI signing alone ≠ PASS.
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
  aiVerifyOnDeployCollector,
  type AiVerifyOnDeployReport,
} from "../collectors/ai-verify-on-deploy.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiVerifyOnDeployReport> {
  await aiVerifyOnDeployCollector.collect({
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
        "ai-verify-on-deploy",
        "ai-verify-on-deploy-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionModelOrContainerArtifactsDeployed: true,
    lastDeployVerified: true,
    unsignedRejectedInTestOrCanary: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sci-r1-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tVerify = join(root, "t-verify");
    mkdirSync(join(tVerify, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(tVerify, ".github", "workflows", "verify-on-deploy.yml"),
      "name: verify-on-deploy\non: [push]\njobs:\n  v:\n    runs-on: ubuntu-latest\n    steps:\n      - run: cosign verify $IMAGE || reject_unsigned\n",
    );
    const r1 = await run(tVerify, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with verify surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "ai-verify-on-deploy"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "ai-verify-on-deploy", "coverage.json"),
      coverage({ lastDeployVerified: false }),
    );
    const r2 = await run(tVerify, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "ai-verify-on-deploy"), { recursive: true });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "ai-verify-on-deploy", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tVerify, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(`over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`);
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "ai-verify-on-deploy"), { recursive: true });
    writeFileSync(
      join(outPass, "imports", "ai-verify-on-deploy", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tVerify, outPass);
    if (r3.summary.sciR1Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-verify-on-deploy"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "ai-verify-on-deploy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsDeployed: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outVerifyNa = join(root, "o-verify-na");
    mkdirSync(join(outVerifyNa, "imports", "ai-verify-on-deploy"), {
      recursive: true,
    });
    writeFileSync(
      join(outVerifyNa, "imports", "ai-verify-on-deploy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsDeployed: false,
      }),
    );
    const rVerifyNa = await run(tVerify, outVerifyNa);
    if (rVerifyNa.summary.statusHint === "not_applicable") {
      throw new Error("verify-on-deploy signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "ai-verify-on-deploy"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "ai-verify-on-deploy", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsDeployed: false,
        unsignedRejectedInTestOrCanary: false,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing unsigned-reject must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor ai-verify-on-deploy smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
