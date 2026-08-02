/**
 * Smoke: artifact-provenance-integrity needs verification + 100% verified
 * pulls + blocked unverified + measuredAt ≤90d; digest pins alone ≠ PASS.
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
  artifactProvenanceIntegrityCollector,
  type ArtifactProvenanceIntegrityReport,
} from "../collectors/artifact-provenance-integrity.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ArtifactProvenanceIntegrityReport> {
  await artifactProvenanceIntegrityCollector.collect({
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
        "artifact-provenance-integrity",
        "artifact-provenance-integrity-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionModelOrContainerArtifactsPresent: true,
    provenanceOrIntegrityVerificationConfigured: true,
    productionPullsVerifiedAgainstDigestOrSignaturePct: 100,
    unverifiedPullsBlocked: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sci-m1-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    // Digest pin alone → PARTIAL, not verificationPresent
    const tPin = join(root, "t-pin");
    mkdirSync(join(tPin, "deploy"), { recursive: true });
    writeFileSync(
      join(tPin, "deploy", "image.yaml"),
      "image: ghcr.io/org/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n",
    );
    const rPin = await run(tPin, join(root, "o-pin"));
    if (
      rPin.summary.statusHint !== "partial" ||
      rPin.summary.verificationPresent
    ) {
      throw new Error(
        `digest pin alone expected partial without verification: ${JSON.stringify(rPin.summary)}`,
      );
    }
    if (!rPin.summary.detectorHits.includes("docker-image-digest-pinned")) {
      throw new Error(`expected digest detector hit: ${rPin.summary.detectorHits}`);
    }

    const tCosign = join(root, "t-cosign");
    mkdirSync(join(tCosign, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(tCosign, ".github", "workflows", "cosign-verify.yml"),
      `
name: cosign-verify
on: [push]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: cosign verify --key cosign.pub $IMAGE
`,
    );
    const r1 = await run(tCosign, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      !r1.summary.verificationPresent ||
      !r1.summary.detectorHits.includes("cosign-verification")
    ) {
      throw new Error(
        `expected partial with cosign, got ${JSON.stringify(r1.summary)}`,
      );
    }

    // Fail: verified pct < 100
    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "artifact-provenance-integrity", "coverage.json"),
      coverage({ productionPullsVerifiedAgainstDigestOrSignaturePct: 90 }),
    );
    const r2 = await run(tCosign, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    // Without measuredAt → PARTIAL
    const outStale = join(root, "o-stale");
    mkdirSync(join(outStale, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(outStale, "imports", "artifact-provenance-integrity", "coverage.json"),
      JSON.stringify({
        productionModelOrContainerArtifactsPresent: true,
        provenanceOrIntegrityVerificationConfigured: true,
        productionPullsVerifiedAgainstDigestOrSignaturePct: 100,
        unverifiedPullsBlocked: true,
      }),
    );
    const rStale = await run(tCosign, outStale);
    if (rStale.summary.statusHint !== "partial") {
      throw new Error(
        `without measuredAt expected partial: ${JSON.stringify(rStale.summary)}`,
      );
    }

    // Over-age measuredAt must not PASS.
    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "artifact-provenance-integrity", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tCosign, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(
        `over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`,
      );
    }

    // PASS
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "artifact-provenance-integrity", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tCosign, outPass);
    if (r3.summary.sciM1Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    // N/A
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "artifact-provenance-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // Digest pin + present=false must not N/A-launder.
    const outPinNa = join(root, "o-pin-na");
    mkdirSync(join(outPinNa, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(outPinNa, "imports", "artifact-provenance-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsPresent: false,
      }),
    );
    const rPinNa = await run(tPin, outPinNa);
    if (rPinNa.summary.statusHint === "not_applicable") {
      throw new Error("digest pin must block N/A launder");
    }

    // Block-unverified policy text + present=false must not N/A-launder.
    const tBlock = join(root, "t-block");
    mkdirSync(join(tBlock, "policy"), { recursive: true });
    writeFileSync(
      join(tBlock, "policy", "admission.md"),
      "ClusterImagePolicy must block_unverified pulls for production images.\n",
    );
    const outBlockNa = join(root, "o-block-na");
    mkdirSync(join(outBlockNa, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outBlockNa,
        "imports",
        "artifact-provenance-integrity",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsPresent: false,
      }),
    );
    const rBlockNa = await run(tBlock, outBlockNa);
    if (rBlockNa.summary.statusHint === "not_applicable") {
      throw new Error("block-unverified policy must block N/A launder");
    }

    // Failing verifiedPct beats N/A with no in-repo surface.
    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "artifact-provenance-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outFailNa,
        "imports",
        "artifact-provenance-integrity",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionModelOrContainerArtifactsPresent: false,
        productionPullsVerifiedAgainstDigestOrSignaturePct: 50,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing verifiedPct must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor artifact-provenance-integrity smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
