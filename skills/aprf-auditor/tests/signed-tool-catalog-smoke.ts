/**
 * Smoke: signed-tool-catalog needs reject unsigned + review + measuredAt ≤90d.
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
  signedToolCatalogCollector,
  type SignedToolCatalogReport,
} from "../collectors/signed-tool-catalog.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<SignedToolCatalogReport> {
  await signedToolCatalogCollector.collect({
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
        "signed-tool-catalog",
        "signed-tool-catalog-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    productionToolCatalogsPresent: true,
    unsignedOrUnapprovedCatalogsRejected: true,
    supplyChainReviewWithin90DaysOrSinceLastChange: true,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-tol-m5-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tSig = join(root, "t-sig");
    mkdirSync(tSig, { recursive: true });
    writeFileSync(
      join(tSig, "catalog.yaml"),
      "signed_catalog: true\nverify_on_load: reject_unsigned\nmcp_catalog_sign: enabled\n",
    );
    const r1 = await run(tSig, join(root, "o1"));
    if (r1.summary.statusHint !== "partial" || !r1.summary.surfaceProvedForNaOverride) {
      throw new Error(`expected partial with surface: ${JSON.stringify(r1.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "signed-tool-catalog", "coverage.json"),
      coverage({ unsignedOrUnapprovedCatalogsRejected: false }),
    );
    const r2 = await run(tSig, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "signed-tool-catalog", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tSig, outAged);
    if (
      rAged.summary.statusHint !== "partial" ||
      rAged.summary.tolM5Satisfied !== false
    ) {
      throw new Error(
        `over-age measuredAt expected partial: ${JSON.stringify(rAged.summary)}`,
      );
    }

    const outNoMeasured = join(root, "o-no-measured");
    mkdirSync(join(outNoMeasured, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(outNoMeasured, "imports", "signed-tool-catalog", "coverage.json"),
      JSON.stringify({
        productionToolCatalogsPresent: true,
        unsignedOrUnapprovedCatalogsRejected: true,
        supplyChainReviewWithin90DaysOrSinceLastChange: true,
      }),
    );
    const rNoMeasured = await run(tSig, outNoMeasured);
    if (rNoMeasured.summary.statusHint !== "partial") {
      throw new Error(
        `missing measuredAt expected partial: ${JSON.stringify(rNoMeasured.summary)}`,
      );
    }

    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "signed-tool-catalog", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tSig, outPass);
    if (r3.summary.tolM5Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "signed-tool-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionToolCatalogsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    const outSigNa = join(root, "o-sig-na");
    mkdirSync(join(outSigNa, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(outSigNa, "imports", "signed-tool-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionToolCatalogsPresent: false,
      }),
    );
    const rSigNa = await run(tSig, outSigNa);
    if (rSigNa.summary.statusHint === "not_applicable") {
      throw new Error("signed/verify signals must block N/A launder");
    }

    const outFailNa = join(root, "o-fail-na");
    mkdirSync(join(outFailNa, "imports", "signed-tool-catalog"), {
      recursive: true,
    });
    writeFileSync(
      join(outFailNa, "imports", "signed-tool-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionToolCatalogsPresent: false,
        supplyChainReviewWithin90DaysOrSinceLastChange: false,
      }),
    );
    const rFailNa = await run(tEmpty, outFailNa);
    if (rFailNa.summary.statusHint !== "fail") {
      throw new Error(
        `failing review flag must beat N/A: ${JSON.stringify(rFailNa.summary)}`,
      );
    }

    console.log("aprf-auditor signed-tool-catalog smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
