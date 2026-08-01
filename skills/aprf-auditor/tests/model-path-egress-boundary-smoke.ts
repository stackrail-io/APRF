/**
 * Smoke: model-path-egress-boundary needs trust + allowlist + 0 unrestricted + probe.
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
  modelPathEgressBoundaryCollector,
  type ModelPathEgressBoundaryReport,
} from "../collectors/model-path-egress-boundary.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelPathEgressBoundaryReport> {
  await modelPathEgressBoundaryCollector.collect({
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
        "model-path-egress-boundary",
        "model-path-egress-boundary-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec-m4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "trust-boundary.md"),
      "model_path trust_boundary for tool_runtime_identity\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.secM4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "infra"), { recursive: true });
    writeFileSync(
      join(t2, "infra", "network-policy.yaml"),
      "kind: NetworkPolicy\negress_allowlist destination_allowlist\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-path-egress-boundary"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "model-path-egress-boundary", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        trustBoundaryArchitectureDocumented: true,
        modelToolRuntimeEgressAllowlistConfigured: true,
        unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity: 0,
        probeShowsOnlyAllowlistedDestinations: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.secM4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "egress-probe.md"),
      "egress_probe allowlist_probe internal_admin data_store\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-path-egress-boundary"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "model-path-egress-boundary", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        trustBoundaryArchitectureDocumented: true,
        modelToolRuntimeEgressAllowlistConfigured: true,
        unrestrictedInternalAdminOrDataStoreRoutesFromModelIdentity: 2,
        probeShowsOnlyAllowlistedDestinations: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.secM4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "model-path-egress-boundary"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "model-path-egress-boundary", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        modelToolRuntimeCanInitiateNetworkCalls: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    console.log("model-path-egress-boundary smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
