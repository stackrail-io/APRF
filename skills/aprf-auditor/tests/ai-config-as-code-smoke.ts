/**
 * Smoke: ai-config-as-code needs unmanaged=0 + livePinsMatchDeclaredPct=100 for PASS.
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
  aiConfigAsCodeCollector,
  type AiConfigAsCodeReport,
} from "../collectors/ai-config-as-code.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiConfigAsCodeReport> {
  await aiConfigAsCodeCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-config-as-code", "ai-config-as-code-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-dep-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "infra"), { recursive: true });
    writeFileSync(
      join(t1, "infra", "model-pins.tf"),
      'resource "aws_ssm_parameter" "model_pin" {\n  name = "/ai/model-pin"\n}\n# terraform declarative config for model pins\n',
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.depM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "config"), { recursive: true });
    writeFileSync(
      join(t2, "config", "ai-gateway.yaml"),
      "ai_gateway:\n  model_pins:\n    - gpt-4o\n  tool_catalog: tools.yaml\n# declarative config as code\n",
    );
    writeFileSync(
      join(t2, "config", "drift-check.md"),
      "drift check for unmanaged resource and live pin vs declared version\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-config-as-code"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-config-as-code", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        unmanagedProductionAiConfigResources: 0,
        livePinsMatchDeclaredPct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.depM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "prompts"), { recursive: true });
    writeFileSync(
      join(t3, "prompts", "iac-prompts.md"),
      "prompts managed as code via helm declarative config\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-config-as-code"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "ai-config-as-code", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        unmanagedProductionAiConfigResources: 3,
        livePinsMatchDeclaredPct: 100,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.depM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-config-as-code smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
