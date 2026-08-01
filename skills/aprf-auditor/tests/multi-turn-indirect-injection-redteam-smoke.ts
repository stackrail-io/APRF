/**
 * Smoke: multi-turn-indirect-injection-redteam needs ≥10/≥10 + thresholds + retention.
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
  multiTurnIndirectInjectionRedteamCollector,
  type MultiTurnIndirectInjectionRedteamReport,
} from "../collectors/multi-turn-indirect-injection-redteam.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<MultiTurnIndirectInjectionRedteamReport> {
  await multiTurnIndirectInjectionRedteamCollector.collect({
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
        "multi-turn-indirect-injection-redteam",
        "multi-turn-indirect-injection-redteam-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "multi-turn-redteam.yml"),
      "multi_turn red_team suite with rag_inject cases\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.secR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "redteam"), { recursive: true });
    writeFileSync(
      join(t2, "redteam", "indirect-mcp.md"),
      "indirect_prompt_inject mcp_inject adversarial_suite pass_threshold\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "multi-turn-indirect-injection-redteam"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out2,
        "imports",
        "multi-turn-indirect-injection-redteam",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multiTurnInjectionCaseCount: 12,
        indirectRagOrMcpInjectionCaseCount: 15,
        latestRunWithin90DaysMeetsPassThresholds: true,
        reportRetainedAtLeast90Days: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.secR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "injection-suite.md"),
      "injection_suite multiturn conversational_inject\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "multi-turn-indirect-injection-redteam"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out3,
        "imports",
        "multi-turn-indirect-injection-redteam",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multiTurnInjectionCaseCount: 5,
        indirectRagOrMcpInjectionCaseCount: 15,
        latestRunWithin90DaysMeetsPassThresholds: true,
        reportRetainedAtLeast90Days: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.secR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    // Fail: reportRetainedAtLeast90Days=true contradicted by reportRetentionDays<90
    const t4 = join(root, "t4");
    mkdirSync(join(t4, "redteam"), { recursive: true });
    writeFileSync(
      join(t4, "redteam", "suite.md"),
      "multi_turn rag_inject red_team pass_threshold\n",
    );
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "multi-turn-indirect-injection-redteam"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out4,
        "imports",
        "multi-turn-indirect-injection-redteam",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multiTurnInjectionCaseCount: 12,
        indirectRagOrMcpInjectionCaseCount: 15,
        latestRunWithin90DaysMeetsPassThresholds: true,
        reportRetainedAtLeast90Days: true,
        reportRetentionDays: 30,
      }),
    );
    const r4 = await run(t4, out4);
    if (
      r4.summary.statusHint !== "fail" ||
      r4.importedResults.reportRetainedAtLeast90Days !== false
    ) {
      throw new Error(
        `retentionDays override fail expected: ${JSON.stringify(r4.summary)} retained=${r4.importedResults.reportRetainedAtLeast90Days}`,
      );
    }

    // Empty repo → not_demonstrated (N/A requires explicit import)
    const t5 = join(root, "t5");
    mkdirSync(t5, { recursive: true });
    const r5 = await run(t5, join(root, "o5"));
    if (r5.summary.statusHint !== "not_demonstrated") {
      throw new Error(`empty not_demonstrated expected: ${JSON.stringify(r5.summary)}`);
    }

    // Explicit N/A via import
    const out6 = join(root, "o6");
    mkdirSync(join(out6, "imports", "multi-turn-indirect-injection-redteam"), {
      recursive: true,
    });
    writeFileSync(
      join(
        out6,
        "imports",
        "multi-turn-indirect-injection-redteam",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        multiTurnRagOrMcpSurfacesPresent: false,
      }),
    );
    const r6 = await run(t5, out6);
    if (r6.summary.statusHint !== "not_applicable") {
      throw new Error(`explicit N/A expected: ${JSON.stringify(r6.summary)}`);
    }

    console.log("multi-turn-indirect-injection-redteam smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
