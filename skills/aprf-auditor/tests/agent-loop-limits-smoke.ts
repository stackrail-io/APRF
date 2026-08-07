/**
 * Smoke: agent-loop-limits / AGN-M2 execution bounds.
 * Covers scope N/A, spawn-conditional bounds, measured abort gates, and FAIL paths.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentLoopLimitsCollector,
  type AgentLoopLimitsReport,
} from "../collectors/agent-loop-limits.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AgentLoopLimitsReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "agent-loop-limits", "agent-loop-limits-report.json"),
      "utf8",
    ),
  ) as AgentLoopLimitsReport;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeSuite(
  outDir: string,
  suite: Record<string, unknown>,
  name = "suite.json",
): void {
  mkdirSync(join(outDir, "imports", "agent-loop-limits"), { recursive: true });
  writeFileSync(
    join(outDir, "imports", "agent-loop-limits", name),
    JSON.stringify(suite),
    "utf8",
  );
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function collect(
  base: CollectorContext,
  targetPath: string,
  outputDir: string,
): Promise<AgentLoopLimitsReport> {
  await agentLoopLimitsCollector.collect({ ...base, targetPath, outputDir });
  return readReport(outputDir);
}

async function main() {
  const emptyTarget = tmp("aprf-agn2-empty-t-");
  const baseCtx: CollectorContext = {
    targetPath: emptyTarget,
    outputDir: tmp("aprf-agn2-empty-o-"),
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  // --- Empty repo → N/A + catalog scope lists ---
  {
    const r = await collect(baseCtx, emptyTarget, baseCtx.outputDir);
    assert(
      r.summary.statusHint === "not_applicable" && r.summary.inScope === false,
      `empty: expected N/A inScope=false, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.summary.naReason && /NOT_APPLICABLE/i.test(r.summary.naReason),
      `empty: expected naReason, got ${r.summary.naReason}`,
    );
    assert(
      (r.summary.appliesTo?.length ?? 0) > 0 &&
        (r.summary.notApplicableTo?.length ?? 0) > 0,
      `empty: expected appliesTo/notApplicableTo from AGN-M2 catalog, got ${JSON.stringify({
        appliesTo: r.summary.appliesTo,
        notApplicableTo: r.summary.notApplicableTo,
      })}`,
    );
    assert(
      r.summary.appliesTo.some((s) => /agent frameworks/i.test(s)) &&
        r.summary.notApplicableTo.some((s) => /embeddings/i.test(s)),
      `empty: catalog scope lists look wrong: ${JSON.stringify({
        appliesTo: r.summary.appliesTo,
        notApplicableTo: r.summary.notApplicableTo,
      })}`,
    );
  }

  // --- Embeddings-only → N/A ---
  {
    const target = tmp("aprf-agn2-emb-t-");
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(
      join(target, "src", "embed.py"),
      "def run():\n    return client.embeddings.create(model='text-embedding-3')\n",
      "utf8",
    );
    const r = await collect(baseCtx, target, tmp("aprf-agn2-emb-o-"));
    assert(
      r.summary.statusHint === "not_applicable" && !r.summary.inScope,
      `embeddings: expected N/A, got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- Generic HTTP timeout outside agentish files must not count ---
  {
    const target = tmp("aprf-agn2-http-t-");
    mkdirSync(join(target, "src"), { recursive: true });
    writeFileSync(
      join(target, "src", "http_client.py"),
      "def fetch(url):\n    return requests.get(url, timeout=30)\n",
      "utf8",
    );
    const r = await collect(baseCtx, target, tmp("aprf-agn2-http-o-"));
    assert(
      r.summary.statusHint === "not_applicable" && !r.summary.inScope,
      `http-timeout: expected N/A, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.wallClock.found !== true && r.signals.wallClock.found !== true,
      `http-timeout: bare timeout outside agentish files must not count as duration bound, got ${JSON.stringify(r.wallClock)}`,
    );
  }

  // --- Agent signals, no bound configs → not_demonstrated ---
  {
    const target = tmp("aprf-agn2-nd-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  framework: langgraph\n  name: planner\n",
      "utf8",
    );
    const r = await collect(baseCtx, target, tmp("aprf-agn2-nd-o-"));
    assert(
      r.summary.statusHint === "not_demonstrated" && r.summary.inScope === true,
      `signals-only: expected not_demonstrated inScope, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      !r.summary.requiredBoundsPresent,
      `signals-only: expected no required bounds, got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- Import productionAgentRuntimesPresent=false → N/A (overrides agent tree) ---
  {
    const target = tmp("aprf-agn2-scope-false-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  framework: langgraph\n  max_iterations: 10\n  timeout: 60\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-scope-false-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      productionAgentRuntimesPresent: false,
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "not_applicable" && r.summary.inScope === false,
      `import-absent: expected N/A, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      /productionAgentRuntimesPresent=false/i.test(r.summary.naReason ?? ""),
      `import-absent: naReason should cite import, got ${r.summary.naReason}`,
    );
  }

  // --- No spawn: iteration + bare timeout: → PASS; README multi-agent ignored ---
  {
    const target = tmp("aprf-agn2-ns-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      `
agent:
  max_iterations: 25
  timeout: 120
  framework: langgraph
`,
      "utf8",
    );
    writeFileSync(
      join(target, "README.md"),
      "# Our multi-agent platform can delegate work across teams.\n",
      "utf8",
    );
    mkdirSync(join(target, "tests"), { recursive: true });
    writeFileSync(
      join(target, "tests", "test_agent_limits.py"),
      `
def test_abort_on_max_iterations_exceeded():
    """enforcement: run aborts when max_iterations exceeded (fail closed)"""
    assert abort_on_exceed(max_iterations=1)

def test_abort_on_timeout():
    assert abort_on_exceed(timeout=1)
`,
      "utf8",
    );
    const out = tmp("aprf-agn2-ns-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "lg1",
          abortedOnExceed: true,
          promptOnly: false,
          continuesAfterAbort: false,
        },
      ],
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.spawnDepthApplicable === false,
      `no-spawn: expected spawnDepthApplicable=false, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.summary.requiredBoundsPresent && r.summary.statusHint === "pass",
      `no-spawn: expected pass, got ${JSON.stringify(r.summary)} notes=${JSON.stringify(r.notes)}`,
    );
  }

  // --- Spawn capability without recursion bound → PARTIAL ---
  {
    const target = tmp("aprf-agn2-spawn-miss-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      `
agent:
  max_iterations: 25
  timeout: 120
  framework: langgraph
  allow_sub_agent_spawn: true
`,
      "utf8",
    );
    const r = await collect(baseCtx, target, tmp("aprf-agn2-spawn-miss-o-"));
    assert(
      r.summary.spawnDepthApplicable === true,
      `spawn-miss: expected spawn applicable, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.summary.requiredBoundsPresent === false &&
        r.summary.statusHint === "partial",
      `spawn-miss: expected PARTIAL without recursion bound, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.gapNotes?.some((n) => /recursion|delegation|spawn/i.test(n)),
      `spawn-miss: expected gapNotes about recursion/spawn, got ${JSON.stringify(r.gapNotes)}`,
    );
  }

  // --- Spawn + all bounds, no measured suite → PARTIAL; no aprf-assessment laundering ---
  {
    const target = tmp("aprf-agn2-spawn-partial-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      `
agent:
  max_steps: 25
  wall_clock_timeout_seconds: 120
  spawn_depth: 2
  orchestration: langgraph
  allow_sub_agent_spawn: true
`,
      "utf8",
    );
    mkdirSync(join(target, "tests"), { recursive: true });
    writeFileSync(
      join(target, "tests", "test_agent_limits.py"),
      `
def test_abort_on_max_steps_exceeded():
    """enforcement: run aborts when max_steps exceeded (fail closed)"""
    assert abort_on_exceed(max_steps=1)

def test_abort_on_timeout():
    assert abort_on_exceed(wall_clock_timeout=1)

def test_abort_on_spawn_depth():
    assert abort_on_exceed(spawn_depth=0)
`,
      "utf8",
    );
    mkdirSync(join(target, "aprf-assessment", "imports", "agent-loop-limits"), {
      recursive: true,
    });
    writeFileSync(
      join(target, "aprf-assessment", "assessment.json"),
      JSON.stringify({
        notes: ["max_steps wall_clock_timeout spawn_depth abort enforcement"],
      }),
      "utf8",
    );
    writeFileSync(
      join(
        target,
        "aprf-assessment",
        "imports",
        "agent-loop-limits",
        "agent-loop-limits-report.json",
      ),
      JSON.stringify({
        maxSteps: { found: true },
        wallClock: { found: true },
        spawnDepth: { found: true },
        notes: ["max_steps wall_clock spawn_depth"],
      }),
      "utf8",
    );

    const out = join(target, "aprf-assessment");
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "partial" &&
        r.summary.requiredBoundsPresent &&
        r.summary.spawnDepthApplicable,
      `spawn-partial: expected partial with required bounds, got ${JSON.stringify(r.summary)}`,
    );
    for (const key of ["maxSteps", "wallClock", "spawnDepth"] as const) {
      const bad = r[key].refs.filter((ref) => ref.includes("aprf-assessment"));
      assert(
        bad.length === 0,
        `${key} must not cite aprf-assessment output, got ${bad}`,
      );
    }
    assert(
      r.maxSteps.refs.some((ref) => ref.includes("agents/runtime.yaml")),
      `spawn-partial: expected runtime.yaml in maxSteps refs, got ${JSON.stringify(r.maxSteps.refs)}`,
    );
    assert(
      r.signals?.maxSteps?.found === true,
      `spawn-partial: expected signals.maxSteps.found, got ${JSON.stringify(r.signals)}`,
    );
    assert(
      r.gapNotes?.some((n) => /enforcement|abort/i.test(n)),
      `spawn-partial: expected gapNotes about enforcement/abort, got ${JSON.stringify(r.gapNotes)}`,
    );

    // Measured suite → PASS
    const outPass = tmp("aprf-agn2-spawn-pass-o-");
    writeSuite(outPass, {
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "a1",
          abortedOnExceed: true,
          promptOnly: false,
          continuesAfterAbort: false,
        },
        {
          agent: "a2",
          abortedOnExceed: true,
          failClosed: true,
          continuesAfterAbort: false,
        },
      ],
    });
    const rPass = await collect(baseCtx, target, outPass);
    assert(
      rPass.summary.statusHint === "pass" && rPass.summary.agnM2Satisfied === true,
      `spawn-pass: expected pass, got ${JSON.stringify(rPass.summary)}`,
    );
  }

  // --- Omit continuesAfterAbort (null) → not PASS ---
  {
    const target = tmp("aprf-agn2-null-cont-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  max_iterations: 10\n  timeout: 30\n  framework: langgraph\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-null-cont-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      limitsEnforcedAbort: true,
      promptOnlyLimits: 0,
      // continuesAfterAbort intentionally omitted → null
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.importedResults.continuesAfterAbort === null,
      `null-cont: expected continuesAfterAbort=null, got ${r.importedResults.continuesAfterAbort}`,
    );
    assert(
      r.summary.statusHint !== "pass",
      `null-cont: omit continuesAfterAbort must not PASS, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.gapNotes?.some((n) => /continuesAfterAbort=false/i.test(n)),
      `null-cont: expected gapNotes requiring continuesAfterAbort=false, got ${JSON.stringify(r.gapNotes)}`,
    );
  }

  // --- Stale measuredAt (>90d) → PARTIAL ---
  {
    const target = tmp("aprf-agn2-stale-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  max_iterations: 10\n  timeout: 30\n  framework: langgraph\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-stale-o-");
    writeSuite(out, {
      measuredAt: daysAgo(120),
      results: [
        {
          agent: "a1",
          abortedOnExceed: true,
          promptOnly: false,
          continuesAfterAbort: false,
        },
      ],
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "partial",
      `stale: expected PARTIAL for measuredAt>90d, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.notes.some((n) => /≤90|90 days|measuredAt/i.test(n)),
      `stale: expected freshness note, got ${JSON.stringify(r.notes)}`,
    );
  }

  // --- promptOnly → FAIL ---
  {
    const target = tmp("aprf-agn2-prompt-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  max_iterations: 10\n  timeout: 30\n  framework: langgraph\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-prompt-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "a1",
          abortedOnExceed: true,
          promptOnly: true,
          continuesAfterAbort: false,
        },
      ],
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "fail",
      `promptOnly: expected FAIL, got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- limitsEnforcedAbort=false → FAIL ---
  {
    const target = tmp("aprf-agn2-noabort-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  max_iterations: 10\n  timeout: 30\n  framework: langgraph\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-noabort-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      limitsEnforcedAbort: false,
      continuesAfterAbort: false,
      promptOnlyLimits: 0,
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "fail",
      `no-abort: expected FAIL, got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- continue-after-abort → FAIL ---
  {
    const target = tmp("aprf-agn2-cont-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  max_iterations: 10\n  timeout: 30\n  framework: langgraph\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-cont-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "bad",
          abortedOnExceed: true,
          continuesAfterAbort: true,
        },
      ],
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "fail",
      `continue-after-abort: expected FAIL, got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- backgroundTasksContinued → FAIL ---
  {
    const target = tmp("aprf-agn2-bg-t-");
    mkdirSync(join(target, "agents"), { recursive: true });
    writeFileSync(
      join(target, "agents", "runtime.yaml"),
      "agent:\n  max_iterations: 10\n  timeout: 30\n  framework: langgraph\n",
      "utf8",
    );
    const out = tmp("aprf-agn2-bg-o-");
    writeSuite(out, {
      measuredAt: new Date().toISOString(),
      results: [
        {
          agent: "bad",
          abortedOnExceed: true,
          backgroundTasksContinued: true,
        },
      ],
    });
    const r = await collect(baseCtx, target, out);
    assert(
      r.summary.statusHint === "fail" &&
        r.importedResults.continuesAfterAbort === true,
      `backgroundTasksContinued: expected FAIL continuesAfterAbort=true, got ${JSON.stringify(r.summary)} imported=${JSON.stringify(r.importedResults)}`,
    );
  }

  console.log("agent-loop-limits smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
