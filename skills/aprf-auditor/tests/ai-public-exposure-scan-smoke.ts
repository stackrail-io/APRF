/**
 * Smoke: ai-public-exposure-scan needs inventory + scan + 0 public unauth +
 * 0 open high + edge auth or private-only proof.
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
  aiPublicExposureScanCollector,
  type AiPublicExposureScanReport,
} from "../collectors/ai-public-exposure-scan.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiPublicExposureScanReport> {
  await aiPublicExposureScanCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-public-exposure-scan",
        "ai-public-exposure-scan-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inf-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "vector-store.md"),
      "pinecone vector_db for rag retrieval\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.infM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "infra"), { recursive: true });
    writeFileSync(
      join(t2, "infra", "edge-auth.yaml"),
      "authenticated_edge public_access_block private_endpoint\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-public-exposure-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-public-exposure-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiDataStoresOrControlPlanesPresent: true,
        publiclyReachableUnauthenticatedCount: 0,
        openHighOrCriticalFindingsUnwaived: 0,
        authenticatedEdgeControlsConfigured: true,
        cspmOrNetworkScanPresent: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.infM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "cspm-scan.md"),
      "cspm public_exposure internet_facing control_plane\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-public-exposure-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-public-exposure-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        publiclyReachableUnauthenticatedCount: 2,
        openHighOrCriticalFindingsUnwaived: 0,
        authenticatedEdgeControlsConfigured: true,
        cspmOrNetworkScanPresent: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.infM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-public-exposure-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "ai-public-exposure-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiDataStoresOrControlPlanesPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // Inventory in-repo ignores present=false N/A launder.
    const tOverride = join(root, "t-override");
    mkdirSync(join(tOverride, "docs"), { recursive: true });
    writeFileSync(
      join(tOverride, "docs", "mlflow.md"),
      "mlflow control_plane admin_console\n",
    );
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "ai-public-exposure-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outOverride, "imports", "ai-public-exposure-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiDataStoresOrControlPlanesPresent: false,
        publiclyReachableUnauthenticatedCount: 0,
        openHighOrCriticalFindingsUnwaived: 0,
        authenticatedEdgeControlsConfigured: true,
        cspmOrNetworkScanPresent: true,
      }),
    );
    const rOverride = await run(tOverride, outOverride);
    if (rOverride.summary.statusHint === "not_applicable") {
      throw new Error("in-repo control-plane must block N/A launder");
    }
    if (
      rOverride.summary.statusHint !== "pass" ||
      rOverride.summary.infM1Satisfied !== true
    ) {
      throw new Error(
        `override+metrics expected pass: ${JSON.stringify(rOverride.summary)}`,
      );
    }

    // Edge-auth/CSPM alone + metrics without inventory/present must stay PARTIAL.
    const tEdgeOnly = join(root, "t-edge-only");
    mkdirSync(join(tEdgeOnly, "infra"), { recursive: true });
    writeFileSync(
      join(tEdgeOnly, "infra", "edge-auth.yaml"),
      "authenticated_edge public_access_block private_endpoint\n",
    );
    const outEdgeOnly = join(root, "o-edge-only");
    mkdirSync(join(outEdgeOnly, "imports", "ai-public-exposure-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outEdgeOnly, "imports", "ai-public-exposure-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        publiclyReachableUnauthenticatedCount: 0,
        openHighOrCriticalFindingsUnwaived: 0,
        authenticatedEdgeControlsConfigured: true,
        cspmOrNetworkScanPresent: true,
      }),
    );
    const rEdgeOnly = await run(tEdgeOnly, outEdgeOnly);
    if (rEdgeOnly.summary.statusHint !== "partial") {
      throw new Error(
        `edge-only without inventory expected partial: ${JSON.stringify(rEdgeOnly.summary)}`,
      );
    }

    // Private-only path (no edge auth flag) with inventory + scan metrics.
    const tPrivate = join(root, "t-private");
    mkdirSync(join(tPrivate, "docs"), { recursive: true });
    writeFileSync(
      join(tPrivate, "docs", "weaviate.md"),
      "weaviate vector_db private network\n",
    );
    const outPrivate = join(root, "o-private");
    mkdirSync(join(outPrivate, "imports", "ai-public-exposure-scan"), {
      recursive: true,
    });
    writeFileSync(
      join(outPrivate, "imports", "ai-public-exposure-scan", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        publiclyReachableUnauthenticatedCount: 0,
        openHighOrCriticalFindingsUnwaived: 0,
        privateOnlyExposureProvenByScan: true,
        cspmOrNetworkScanPresent: true,
      }),
    );
    const rPrivate = await run(tPrivate, outPrivate);
    if (
      rPrivate.summary.statusHint !== "pass" ||
      rPrivate.summary.infM1Satisfied !== true
    ) {
      throw new Error(
        `private-only path expected pass: ${JSON.stringify(rPrivate.summary)}`,
      );
    }

    console.log("aprf-auditor ai-public-exposure-scan smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
