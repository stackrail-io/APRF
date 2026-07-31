/**
 * Smoke: ai-artifact-change-records needs 100% who/what/when+review coverage for PASS.
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
  aiArtifactChangeRecordsCollector,
  type AiArtifactChangeRecordsReport,
} from "../collectors/ai-artifact-change-records.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiArtifactChangeRecordsReport> {
  await aiArtifactChangeRecordsCollector.collect({
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
        "ai-artifact-change-records",
        "ai-artifact-change-records-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-dep-m2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "prompt-changelog.md"),
      "AI artifact change log with who what when and review link\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.depM2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "model-change-log.md"),
      "changelog for model pins: changed_by, timestamp, approval_id, pull request\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-artifact-change-records"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-artifact-change-records", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        changesWithWhoWhatWhenAndReviewLinkPct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.depM2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "ops"), { recursive: true });
    writeFileSync(
      join(t3, "ops", "tool-changelog.md"),
      "tool catalog change log with actor and ticket export\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-artifact-change-records"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-artifact-change-records", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        changesMissingWhoWhatWhenOrReviewLink: 2,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.depM2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-artifact-change-records smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
