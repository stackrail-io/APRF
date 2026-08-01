/**
 * Smoke: shared-accelerator-isolation needs isolation design + passing capacity/isolation test.
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
  sharedAcceleratorIsolationCollector,
  type SharedAcceleratorIsolationReport,
} from "../collectors/shared-accelerator-isolation.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<SharedAcceleratorIsolationReport> {
  await sharedAcceleratorIsolationCollector.collect({
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
        "shared-accelerator-isolation",
        "shared-accelerator-isolation-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inf-m4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "gpu-cluster.md"),
      "shared_gpu multi_tenant_inference nvidia_mig\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.infM4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "gpu-isolation.md"),
      "gpu_isolation tenant_qos resource_quotas\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "shared-accelerator-isolation"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "shared-accelerator-isolation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sharedAiAcceleratorInfrastructurePresent: true,
        isolationControlsDocumented: true,
        isolationOrCapacityTestMeetsStatedLimits: true,
        tenantQosOrSchedulingPolicyPresent: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.infM4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "capacity-test.md"),
      "capacity_test isolation_test noisy_neighbor_bench\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "shared-accelerator-isolation"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "shared-accelerator-isolation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        isolationControlsDocumented: true,
        isolationOrCapacityTestMeetsStatedLimits: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.infM4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    // Managed-API / no shared accelerators → N/A
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "shared-accelerator-isolation"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "shared-accelerator-isolation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sharedAiAcceleratorInfrastructurePresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // Isolation + test docs alone must not block present=false N/A.
    const tIsoTest = join(root, "t-iso-test");
    mkdirSync(join(tIsoTest, "docs"), { recursive: true });
    writeFileSync(
      join(tIsoTest, "docs", "gpu-isolation.md"),
      "gpu_isolation tenant_qos resource_quotas\n",
    );
    writeFileSync(
      join(tIsoTest, "docs", "capacity-test.md"),
      "capacity_test isolation_test\n",
    );
    const outIsoTest = join(root, "o-iso-test");
    mkdirSync(join(outIsoTest, "imports", "shared-accelerator-isolation"), {
      recursive: true,
    });
    writeFileSync(
      join(outIsoTest, "imports", "shared-accelerator-isolation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sharedAiAcceleratorInfrastructurePresent: false,
      }),
    );
    const rIsoTest = await run(tIsoTest, outIsoTest);
    if (rIsoTest.summary.statusHint !== "not_applicable") {
      throw new Error(
        `isolation+test without inventory must allow N/A: ${JSON.stringify(rIsoTest.summary)}`,
      );
    }

    // Isolation-only + perfect metrics without inventory/present → PARTIAL.
    const tIsoOnly = join(root, "t-iso-only");
    mkdirSync(join(tIsoOnly, "ops"), { recursive: true });
    writeFileSync(
      join(tIsoOnly, "ops", "gpu-isolation.md"),
      "gpu_isolation tenant_qos\n",
    );
    const outIsoOnly = join(root, "o-iso-only");
    mkdirSync(join(outIsoOnly, "imports", "shared-accelerator-isolation"), {
      recursive: true,
    });
    writeFileSync(
      join(outIsoOnly, "imports", "shared-accelerator-isolation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        isolationControlsDocumented: true,
        isolationOrCapacityTestMeetsStatedLimits: true,
      }),
    );
    const rIsoOnly = await run(tIsoOnly, outIsoOnly);
    if (rIsoOnly.summary.statusHint !== "partial") {
      throw new Error(
        `isolation-only without inventory expected partial: ${JSON.stringify(rIsoOnly.summary)}`,
      );
    }

    console.log("aprf-auditor shared-accelerator-isolation smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
