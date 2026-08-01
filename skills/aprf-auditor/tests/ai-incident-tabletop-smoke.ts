/**
 * Smoke: ai-incident-tabletop needs completion ≤180d + owned actions for PASS.
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
  aiIncidentTabletopCollector,
  type AiIncidentTabletopReport,
} from "../collectors/ai-incident-tabletop.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiIncidentTabletopReport> {
  await aiIncidentTabletopCollector.collect({
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
        "ai-incident-tabletop",
        "ai-incident-tabletop-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inc-r4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai-tabletop.md"),
      "AI incident tabletop for prompt injection scenario\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.incR4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "exercises"), { recursive: true });
    writeFileSync(
      join(t2, "exercises", "tabletop-aar.md"),
      "Tabletop after-action report: LLM outage scenario; retained action with owner\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-incident-tabletop"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-incident-tabletop", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiFocusedTabletopCompletedWithin180Days: true,
        retainedActionsWithOwners: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.incR4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "war-game.md"),
      "Game day tabletop for agent abuse AI incident\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-incident-tabletop"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-incident-tabletop", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        tabletopAgeDays: 200,
        retainedActionsWithOwners: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.incR4Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-incident-tabletop smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
