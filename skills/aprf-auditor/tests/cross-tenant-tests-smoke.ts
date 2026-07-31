/**
 * Smoke: cross-tenant-tests requires ≥10 attack cases with 0 leaks;
 * isolation code alone does not satisfy AUTHZ-M2.
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
  crossTenantTestsCollector,
  type CrossTenantReport,
} from "../collectors/cross-tenant-tests.ts";
import type { CollectorContext } from "../collectors/types.ts";

const outDir = mkdtempSync(join(tmpdir(), "aprf-xtenant-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-xtenant-target-"));

async function main() {
  mkdirSync(join(targetDir, "backend"), { recursive: true });
  writeFileSync(
    join(targetDir, "backend", "access.py"),
    `
def has_access(user_id, access_grants):
    return any(g.get("user_id") == user_id for g in access_grants or [])

def get_chat(chat_id, user_id):
    return Chat.query.filter(Chat.id == chat_id, Chat.user_id == user_id).first()
`,
    "utf8",
  );

  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  const noTests = await crossTenantTestsCollector.collect(baseCtx);
  if (noTests.status !== "ran") {
    throw new Error(`expected ran, got ${noTests.status}`);
  }
  const report1 = JSON.parse(
    readFileSync(
      join(outDir, "imports", "cross-tenant-tests", "cross-tenant-report.json"),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (report1.summary.authzM2Satisfied !== null) {
    throw new Error(
      `without cases expected satisfied=null, got ${report1.summary.authzM2Satisfied}`,
    );
  }
  if (!report1.isolationCodeFound) {
    throw new Error("expected isolation code detected");
  }

  // Import a passing suite (≥10 cases)
  const imp = join(outDir, "imports", "cross-tenant-tests");
  writeFileSync(
    join(imp, "suite.json"),
    JSON.stringify({
      attackCases: 12,
      unauthorizedSuccesses: 0,
    }),
    "utf8",
  );

  const out2 = mkdtempSync(join(tmpdir(), "aprf-xtenant2-"));
  mkdirSync(join(out2, "imports", "cross-tenant-tests"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: `case-${i + 1}`,
        result: "pass",
        aiDataPathHint: i % 2 ? "memories" : "chats",
      })),
    }),
    "utf8",
  );

  const withSuite = await crossTenantTestsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  if (withSuite.status !== "ran") {
    throw new Error(`expected ran with suite: ${withSuite.status}`);
  }
  const report2 = JSON.parse(
    readFileSync(
      join(out2, "imports", "cross-tenant-tests", "cross-tenant-report.json"),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (report2.summary.authzM2Satisfied !== true) {
    throw new Error(
      `with suite expected satisfied=true, got ${JSON.stringify(report2.summary)}`,
    );
  }
  if (report2.summary.attackCases < 10) {
    throw new Error(`expected ≥10 cases, got ${report2.summary.attackCases}`);
  }

  console.log("aprf-auditor cross-tenant-tests smoke OK");
  rmSync(outDir, { recursive: true, force: true });
  rmSync(out2, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    rmSync(targetDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
