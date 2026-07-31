/**
 * Smoke: platform-scaffolding-templates needs three templates + defaults + adoption for PASS.
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
  platformScaffoldingTemplatesCollector,
  type PlatformScaffoldingTemplatesReport,
} from "../collectors/platform-scaffolding-templates.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): PlatformScaffoldingTemplatesReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "platform-scaffolding-templates",
        "platform-scaffolding-templates-report.json",
      ),
      "utf8",
    ),
  ) as PlatformScaffoldingTemplatesReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-dxr1-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-dxr1-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await platformScaffoldingTemplatesCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "templates", "agent-scaffold"), { recursive: true });
  mkdirSync(join(targetDir, "templates", "rag-scaffold"), { recursive: true });
  mkdirSync(join(targetDir, "templates", "mcp-scaffold"), { recursive: true });
  writeFileSync(
    join(targetDir, "templates", "agent-scaffold", "README.md"),
    `# Agent template scaffold
Auth via OIDC. Secrets manager for keys. Structured logging / otel enabled by default.
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "templates", "rag-scaffold", "README.md"),
    `# RAG template scaffold
Retrieval-augment pipeline. Authentication required. Secrets in vault. Logging on.
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "templates", "mcp-scaffold", "README.md"),
    `# MCP server template scaffold
Model Context Protocol starter with auth, secrets manager, and otel logging defaults.
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "README.md"),
    "# Platform templates for openai agents\n",
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-dxr1-1-"));
  await platformScaffoldingTemplatesCollector.collect({
    ...baseCtx,
    outputDir: out1,
  });
  const r1 = readReport(out1);
  if (
    r1.summary.statusHint !== "partial" ||
    !r1.summary.allThreeTemplatesPresent
  ) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-dxr1-2-"));
  mkdirSync(join(out2, "imports", "platform-scaffolding-templates"), {
    recursive: true,
  });
  writeFileSync(
    join(out2, "imports", "platform-scaffolding-templates", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      ageDays: 7,
      agentTemplatePresent: true,
      ragTemplatePresent: true,
      mcpTemplatePresent: true,
      authDefaultOn: true,
      secretsDefaultOn: true,
      loggingDefaultOn: true,
      usedInLast90Days: true,
      adoptionTargetDocumented: false,
    }),
    "utf8",
  );
  await platformScaffoldingTemplatesCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.dxR1Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("platform-scaffolding-templates smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
