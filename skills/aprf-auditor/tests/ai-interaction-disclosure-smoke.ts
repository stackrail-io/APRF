/**
 * Smoke: ai-interaction-disclosure needs inventory + 100% coverage + 0 critical misses.
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
  aiInteractionDisclosureCollector,
  type AiInteractionDisclosureReport,
} from "../collectors/ai-interaction-disclosure.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiInteractionDisclosureReport> {
  await aiInteractionDisclosureCollector.collect({
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
        "ai-interaction-disclosure",
        "ai-interaction-disclosure-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-saf-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "ai-disclosure.md"),
      "You are chatting with an AI. powered_by_ai disclosure notice\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.safM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "ux"), { recursive: true });
    writeFileSync(
      join(t2, "ux", "disclosure-ux-inventory.md"),
      "disclosure_ux_inventory surface_audit critical_surface checklist\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-interaction-disclosure"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-interaction-disclosure", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        disclosureUxInventoryConfigured: true,
        inScopeSurfacesWithAiDisclosurePct: 100,
        criticalSurfacesMissingDisclosure: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.safM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "bot-disclosure.md"),
      "chatbot_disclosure ai_disclaimer incomplete audit\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-interaction-disclosure"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-interaction-disclosure", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        disclosureUxInventoryConfigured: true,
        inScopeSurfacesWithAiDisclosurePct: 100,
        criticalSurfacesMissingDisclosure: 2,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.safM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-interaction-disclosure smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
