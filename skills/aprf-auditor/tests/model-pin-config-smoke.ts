/**
 * Smoke: model-pin-config needs zero floating aliases + full pins + reject rule for PASS.
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
  modelPinConfigCollector,
  type ModelPinConfigReport,
} from "../collectors/model-pin-config.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelPinConfigReport> {
  await modelPinConfigCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "model-pin-config", "model-pin-config-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mod-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "config"), { recursive: true });
    writeFileSync(
      join(t1, "config", "models.yml"),
      "model_id: gpt-4o-2024-08-06\npinned_model: true\nforbid_latest: true\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.modM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "config"), { recursive: true });
    writeFileSync(
      join(t2, "config", "llm.yaml"),
      "openai:\n  model_id: gpt-4o-2024-08-06\nlint:\n  reject_latest: true\n  no_latest_alias: true\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-pin-config"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "model-pin-config", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        floatingAliasCountOnCriticalPaths: 0,
        criticalPathsMissingPinnedModelId: 0,
        lintOrCiRejectsLatest: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.modM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "config"), { recursive: true });
    writeFileSync(
      join(t3, "config", "prod.env"),
      'MODEL_ID="latest"\nforbid_latest check\n',
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-pin-config"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "model-pin-config", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        floatingAliasCountOnCriticalPaths: 2,
        criticalPathsMissingPinnedModelId: 0,
        lintOrCiRejectsLatest: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.modM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("model-pin-config smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
