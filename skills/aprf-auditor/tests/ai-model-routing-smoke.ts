/**
 * Smoke: ai-model-routing needs policy + imported eval/misroute for PASS.
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
  aiModelRoutingCollector,
  type AiModelRoutingReport,
} from "../collectors/ai-model-routing.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): AiModelRoutingReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-model-routing",
        "ai-model-routing-report.json",
      ),
      "utf8",
    ),
  ) as AiModelRoutingReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-costr2-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-costr2-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await aiModelRoutingCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "config"), { recursive: true });
  writeFileSync(
    join(targetDir, "config", "llm_model_routing.yaml"),
    `
# openai llm model_router: low-risk task_class → cheap_model
routing:
  classify: gpt-4o-mini  # cheap_tier
  summarize: gpt-4o-mini
  complex_reasoning: gpt-4o  # premium_tier / frontier_model
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "evals"), { recursive: true });
  writeFileSync(
    join(targetDir, "evals", "routing_quality_eval.md"),
    `# Eval: cheap vs premium baseline quality_tolerance for model_router\n`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-costr2-1-"));
  await aiModelRoutingCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.routingPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-costr2-2-"));
  mkdirSync(join(out2, "imports", "ai-model-routing"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "ai-model-routing", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 7,
      routingEnabled: true,
      evalWithinTolerance: true,
      misrouteMonitored: true,
      monitorWindowDays: 30,
      results: [{ passed: true, withinTolerance: true }],
    }),
    "utf8",
  );
  await aiModelRoutingCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.costR2Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("ai-model-routing smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
