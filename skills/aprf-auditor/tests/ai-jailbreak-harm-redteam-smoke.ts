/**
 * Smoke: ai-jailbreak-harm-redteam needs distinct suite + categories + thresholds + backlog.
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
  aiJailbreakHarmRedteamCollector,
  type AiJailbreakHarmRedteamReport,
} from "../collectors/ai-jailbreak-harm-redteam.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiJailbreakHarmRedteamReport> {
  await aiJailbreakHarmRedteamCollector.collect({
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
        "ai-jailbreak-harm-redteam",
        "ai-jailbreak-harm-redteam-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-saf-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "jailbreak-to-harm.md"),
      "jailbreak_to_harm red_team_suite refusal_threshold\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.safR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "redteam"), { recursive: true });
    writeFileSync(
      join(t2, "redteam", "safety-red-team.yml"),
      "harm_red_team suite with safety_backlog finding_owner\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-jailbreak-harm-redteam"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-jailbreak-harm-redteam", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        jailbreakToHarmSuiteDistinctFromSecurityInjection: true,
        suiteCoversDocumentedHarmCategories: true,
        latestRunWithin90DaysMeetsRefusalSafetyThresholds: true,
        findingsFeedSafetyBacklogWithOwners: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.safR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "jailbreak-suite.md"),
      "jailbreak_suite reused security injection corpus\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-jailbreak-harm-redteam"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-jailbreak-harm-redteam", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        jailbreakToHarmSuiteDistinctFromSecurityInjection: false,
        suiteCoversDocumentedHarmCategories: true,
        latestRunWithin90DaysMeetsRefusalSafetyThresholds: true,
        findingsFeedSafetyBacklogWithOwners: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.safR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-jailbreak-harm-redteam smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
