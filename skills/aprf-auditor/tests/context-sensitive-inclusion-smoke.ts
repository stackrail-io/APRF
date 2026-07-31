/**
 * Smoke: context-sensitive-inclusion needs policy + ≥95% block/strip for PASS.
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
  contextSensitiveInclusionCollector,
  type ContextSensitiveInclusionReport,
} from "../collectors/context-sensitive-inclusion.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ContextSensitiveInclusionReport> {
  await contextSensitiveInclusionCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "context-sensitive-inclusion",
        "context-sensitive-inclusion-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-ctx-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "sensitive_context_inclusion_policy.md"),
      "Sensitive class inclusion policy with allow/deny for secrets and regulated data\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.ctxM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "context_data_class.md"),
      "data-class inclusion_policy allow_deny strip secrets from context\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "context-sensitive-inclusion"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "context-sensitive-inclusion", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveClassesEnumerated: true,
        allowDenyRulesPresent: true,
        blockOrStripRatePct: 97,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.ctxM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "sensitive_class.md"),
      "sensitive_class context policy deny list\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "context-sensitive-inclusion"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "context-sensitive-inclusion", "suite.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveClassesEnumerated: true,
        allowDenyRulesPresent: true,
        blockOrStripRatePct: 80,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.ctxM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }
    console.log("context-sensitive-inclusion smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
