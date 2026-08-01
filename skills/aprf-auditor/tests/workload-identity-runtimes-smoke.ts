/**
 * Smoke: workload-identity-runtimes needs 100% WI coverage + 0 static keys + sample.
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
  workloadIdentityRuntimesCollector,
  type WorkloadIdentityRuntimesReport,
} from "../collectors/workload-identity-runtimes.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<WorkloadIdentityRuntimesReport> {
  await workloadIdentityRuntimesCollector.collect({
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
        "workload-identity-runtimes",
        "workload-identity-runtimes-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authn-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "deploy"), { recursive: true });
    writeFileSync(
      join(t1, "deploy", "vllm.yaml"),
      "self_hosted vllm inference_server with service_account annotation\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.authnR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "infra"), { recursive: true });
    writeFileSync(
      join(t2, "infra", "spiffe.md"),
      "workload_identity spiffe binding for model_server sample_harness authenticated_call\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "workload-identity-runtimes"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "workload-identity-runtimes", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        selfHostedModelRuntimesWithWorkloadIdentityPct: 100,
        staticSharedKeysInRuntimeInventory: 0,
        sampleAuthenticatedCallsPresent: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authnR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "workload-identity-runtimes"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "workload-identity-runtimes", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        selfHostedModelRuntimesWithWorkloadIdentityPct: 100,
        staticSharedKeysInRuntimeInventory: 2,
        sampleAuthenticatedCallsPresent: true,
      }),
    );
    const rFail = await run(t2, outFail);
    if (
      rFail.summary.statusHint !== "fail" ||
      rFail.summary.authnR2Satisfied !== false
    ) {
      throw new Error(`fail expected: ${JSON.stringify(rFail.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "workload-identity-runtimes"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "workload-identity-runtimes", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        selfHostedModelRuntimesPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    console.log("workload-identity-runtimes smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
