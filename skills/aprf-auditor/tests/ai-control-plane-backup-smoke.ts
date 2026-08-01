/**
 * Smoke: ai-control-plane-backup needs inventory + artifact coverage + restore test.
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
  aiControlPlaneBackupCollector,
  type AiControlPlaneBackupReport,
} from "../collectors/ai-control-plane-backup.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiControlPlaneBackupReport> {
  await aiControlPlaneBackupCollector.collect({
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
        "ai-control-plane-backup",
        "ai-control-plane-backup-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-m4-backup-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "ops"), { recursive: true });
    writeFileSync(
      join(t1, "ops", "backup.md"),
      "Backup inventory includes prompt registry and vector index\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relM4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ops"), { recursive: true });
    writeFileSync(
      join(t2, "ops", "control-plane-backup.yaml"),
      "backup:\n  include: [prompt_registry, policy_store, vector_index]\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-control-plane-backup"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-control-plane-backup", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        controlPlaneBackupInventoryConfigured: true,
        requiredArtifactClassesCovered: true,
        restoreTestSucceededWithin90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relM4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "restore_test.md"),
      "restore test for prompt registry sample\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-control-plane-backup"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-control-plane-backup", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        controlPlaneBackupInventoryConfigured: true,
        requiredArtifactClassesCovered: true,
        restoreTestSucceededWithin90Days: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relM4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-control-plane-backup smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
