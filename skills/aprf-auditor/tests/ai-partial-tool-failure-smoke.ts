/**
 * Smoke: ai-partial-tool-failure needs handling + outcome tests + 100% no-false-success.
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
  aiPartialToolFailureCollector,
  type AiPartialToolFailureReport,
} from "../collectors/ai-partial-tool-failure.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiPartialToolFailureReport> {
  await aiPartialToolFailureCollector.collect({
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
        "ai-partial-tool-failure",
        "ai-partial-tool-failure-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rel-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "agent_tools.py"),
      "def handle_partial_failure(tool_result):\n  if tool_result.partial_failure: raise\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.relM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "src"), { recursive: true });
    mkdirSync(join(t2, "tests"), { recursive: true });
    writeFileSync(
      join(t2, "src", "tool_call.py"),
      "def execute_tool():\n  compensate_on_partial_failure()\n",
    );
    writeFileSync(
      join(t2, "tests", "test_partial_tool_failure_e2e.py"),
      "def test_partial_success_then_fail_no_false_success():\n  assert not false_success\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-partial-tool-failure"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-partial-tool-failure", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        partialFailureHandlingConfigured: true,
        testEvidenceShowsNoFalseSuccess: true,
        noFalseSuccessWithoutRemediationPct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.relM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "test_chaos_partial_failure.py"),
      "def test_chaos_partial_failure():\n  assert agent_continues\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-partial-tool-failure"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-partial-tool-failure", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        partialFailureHandlingConfigured: true,
        testEvidenceShowsNoFalseSuccess: true,
        noFalseSuccessWithoutRemediationPct: 40,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.relM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-partial-tool-failure smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
