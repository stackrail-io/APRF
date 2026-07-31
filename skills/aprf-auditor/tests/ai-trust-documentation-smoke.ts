/**
 * Smoke: ai-trust-documentation needs URL + topics + map + fresh last-updated for PASS.
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aiTrustDocumentationCollector,
  type AiTrustDocumentationReport,
} from "../collectors/ai-trust-documentation.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function runCollector(
  target: string,
  outDir: string,
): Promise<AiTrustDocumentationReport> {
  const ctx: CollectorContext = {
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: null,
    maxFiles: 2000,
  };
  await aiTrustDocumentationCollector.collect(ctx);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "ai-trust-documentation",
        "ai-trust-documentation-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-cmp-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "trust_center.md"),
      `# AI Trust Center
Public trust doc covering identity, safety evaluation, data handling, and incident contact.
APRF pillar mapping table links Core Profile controls.
`,
    );
    const out1 = join(root, "o1");
    const r1 = await runCollector(t1, out1);
    if (r1.summary.statusHint !== "partial" || r1.summary.cmpR2Satisfied !== false) {
      throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "security_whitepaper.md"),
      "customer-facing trust center with APRF pillar mapping\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-trust-documentation"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "ai-trust-documentation", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        publishedUrl: "https://example.com/trust",
        coversIdentity: true,
        coversSafetyEval: true,
        coversDataHandling: true,
        coversIncidentContact: true,
        pillarMappingExplicit: true,
        lastUpdatedAgeDays: 30,
      }),
    );
    const r2 = await runCollector(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.cmpR2Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "ai_trust.md"),
      "public trust doc and core profile mapping table\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "ai-trust-documentation"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "ai-trust-documentation", "attest.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        publishedUrl: "https://example.com/trust",
        coversIdentity: true,
        coversSafetyEval: false,
        coversDataHandling: true,
        coversIncidentContact: true,
        pillarMappingExplicit: true,
        lastUpdatedAgeDays: 10,
      }),
    );
    const r3 = await runCollector(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.cmpR2Satisfied !== false) {
      throw new Error(`expected fail, got ${JSON.stringify(r3.summary)}`);
    }

    console.log("ai-trust-documentation smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
