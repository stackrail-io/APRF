/**
 * Smoke: model-capability-allowlist needs full coverage + deny evidence for PASS.
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
  modelCapabilityAllowlistCollector,
  type ModelCapabilityAllowlistReport,
} from "../collectors/model-capability-allowlist.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelCapabilityAllowlistReport> {
  await modelCapabilityAllowlistCollector.collect({
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
        "model-capability-allowlist",
        "model-capability-allowlist-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mod-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "config"), { recursive: true });
    writeFileSync(
      join(t1, "config", "capability-allowlist.yml"),
      "workloads:\n  support:\n    allowed_capabilities: [vision]\n    deny_browsing: true\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.modR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "gateway"), { recursive: true });
    writeFileSync(
      join(t2, "gateway", "model-capabilities.md"),
      "capability allowlist per workload\nallowed: vision\ndenied capability attempt recorded\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-capability-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "model-capability-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        workloadsMissingCapabilityAllowlist: 0,
        deniedCapabilityAttemptRecorded: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.modR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "config"), { recursive: true });
    writeFileSync(
      join(t3, "config", "caps.yaml"),
      "model_capabilities:\n  code_execution: false\n  vision: true\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-capability-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "model-capability-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        workloadsMissingCapabilityAllowlist: 2,
        deniedCapabilityAttemptRecorded: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.modR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    // Regression: explicit false must not block a positive deny count.
    const t4 = join(root, "t4");
    mkdirSync(join(t4, "config"), { recursive: true });
    writeFileSync(
      join(t4, "config", "capability-allowlist.yml"),
      "allowed_capabilities: [vision]\ndenied_capability_attempt: true\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "model-capability-allowlist"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "model-capability-allowlist", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        workloadsMissingCapabilityAllowlist: 0,
        deniedCapabilityAttemptRecorded: false,
        deniedCapabilityAttemptsInLast90Days: 3,
      }),
    );
    const r4 = await run(t4, out4);
    if (
      r4.summary.statusHint !== "pass" ||
      r4.summary.modR2Satisfied !== true ||
      r4.importedResults.deniedCapabilityAttemptRecorded !== true
    ) {
      throw new Error(
        `count should override false: ${JSON.stringify(r4.summary)} ${JSON.stringify(r4.importedResults)}`,
      );
    }

    console.log("model-capability-allowlist smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
