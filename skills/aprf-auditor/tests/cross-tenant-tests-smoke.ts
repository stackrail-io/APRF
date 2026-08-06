/**
 * Smoke: cross-tenant-tests requires ≥10 attack cases with 0 leaks + measuredAt;
 * isolation code alone does not satisfy AUTHZ-M2; N/A attest works.
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
  if (report1.summary.statusHint !== "partial") {
    throw new Error(
      `isolation without suite expected partial, got ${report1.summary.statusHint}`,
    );
  }
  if (!report1.isolationCodeFound) {
    throw new Error("expected isolation code detected");
  }

  // Import without measuredAt → partial, not PASS
  const outStale = mkdtempSync(join(tmpdir(), "aprf-xtenant-stale-"));
  mkdirSync(join(outStale, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outStale, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: `case-${i + 1}`,
        result: "pass",
        aiDataPathHint: i % 2 ? "memories" : "chats",
      })),
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    ...baseCtx,
    outputDir: outStale,
  });
  const reportStale = JSON.parse(
    readFileSync(
      join(
        outStale,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportStale.summary.statusHint !== "partial") {
    throw new Error(
      `undated import expected partial, got ${reportStale.summary.statusHint}`,
    );
  }
  if (reportStale.summary.authzM2Satisfied !== false) {
    throw new Error(
      `undated import expected satisfied=false, got ${reportStale.summary.authzM2Satisfied}`,
    );
  }

  // Import a passing suite (≥10 cases + measuredAt)
  const out2 = mkdtempSync(join(tmpdir(), "aprf-xtenant2-"));
  mkdirSync(join(out2, "imports", "cross-tenant-tests"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
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
  if (report2.summary.statusHint !== "pass") {
    throw new Error(
      `expected statusHint=pass, got ${report2.summary.statusHint}`,
    );
  }
  if (report2.summary.attackCases < 10) {
    throw new Error(`expected ≥10 cases, got ${report2.summary.attackCases}`);
  }

  // Compact summary form + measuredAt
  const outCompact = mkdtempSync(join(tmpdir(), "aprf-xtenant-compact-"));
  mkdirSync(join(outCompact, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outCompact, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      attackCases: 12,
      unauthorizedSuccesses: 0,
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    ...baseCtx,
    outputDir: outCompact,
  });
  const reportCompact = JSON.parse(
    readFileSync(
      join(
        outCompact,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportCompact.summary.statusHint !== "pass") {
    throw new Error(
      `compact suite expected pass, got ${reportCompact.summary.statusHint}`,
    );
  }

  // N/A: empty target + explicit attest
  const emptyTarget = mkdtempSync(join(tmpdir(), "aprf-xtenant-empty-"));
  const outNa = mkdtempSync(join(tmpdir(), "aprf-xtenant-na-"));
  mkdirSync(join(outNa, "imports", "cross-tenant-tests"), { recursive: true });
  writeFileSync(
    join(outNa, "imports", "cross-tenant-tests", "na.json"),
    JSON.stringify({
      multiTenantAiDataOrMemoryPathsPresent: false,
      measuredAt: new Date().toISOString(),
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    targetPath: emptyTarget,
    outputDir: outNa,
    assessedAt: new Date(),
    live: false,
    maxFiles: 50,
  });
  const reportNa = JSON.parse(
    readFileSync(
      join(outNa, "imports", "cross-tenant-tests", "cross-tenant-report.json"),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportNa.summary.statusHint !== "not_applicable") {
    throw new Error(
      `expected not_applicable, got ${reportNa.summary.statusHint} notes=${reportNa.notes.join("; ")}`,
    );
  }

  // ≥10 cases without denial assertions must not PASS.
  const outNoDenial = mkdtempSync(join(tmpdir(), "aprf-xtenant-nodenial-"));
  mkdirSync(join(outNoDenial, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outNoDenial, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: `case-${i + 1}`,
        expectsDenial: false,
        unauthorizedSuccess: false,
        aiDataPathHint: "chats",
      })),
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    ...baseCtx,
    outputDir: outNoDenial,
  });
  const reportNoDenial = JSON.parse(
    readFileSync(
      join(
        outNoDenial,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportNoDenial.summary.statusHint === "pass") {
    throw new Error(
      "cases with expectsDenial=false must not PASS AUTHZ-M2",
    );
  }
  if (reportNoDenial.summary.authzM2Satisfied === true) {
    throw new Error("expectsDenial=false suite expected satisfied≠true");
  }

  // Bare imported cases (missing result/status) must not default to denial PASS.
  const outBare = mkdtempSync(join(tmpdir(), "aprf-xtenant-bare-"));
  mkdirSync(join(outBare, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outBare, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: Array.from({ length: 12 }, (_, i) => ({ id: `case-${i + 1}` })),
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    ...baseCtx,
    outputDir: outBare,
  });
  const reportBare = JSON.parse(
    readFileSync(
      join(
        outBare,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportBare.summary.statusHint === "pass") {
    throw new Error("bare imported cases (no result/status) must not PASS");
  }
  if (reportBare.summary.authzM2Satisfied === true) {
    throw new Error("bare imported cases expected satisfied≠true");
  }

  // Explicit ok:false must not be treated as denial PASS.
  const outOkFalse = mkdtempSync(join(tmpdir(), "aprf-xtenant-okf-"));
  mkdirSync(join(outOkFalse, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outOkFalse, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: `case-${i + 1}`,
        ok: false,
      })),
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    ...baseCtx,
    outputDir: outOkFalse,
  });
  const reportOkFalse = JSON.parse(
    readFileSync(
      join(
        outOkFalse,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportOkFalse.summary.statusHint === "pass") {
    throw new Error("imported ok:false cases must not PASS AUTHZ-M2");
  }

  // Vacuous import must not mask in-repo unauthorizedSuccess leaks.
  const leakTarget = mkdtempSync(join(tmpdir(), "aprf-xtenant-leak-tgt-"));
  mkdirSync(join(leakTarget, "tests"), { recursive: true });
  writeFileSync(
    join(leakTarget, "tests", "test_cross_tenant_memory.py"),
    `
def test_cross_tenant_memory_leak():
    # attacker reads other_user memories — isolation test
    assert got_other_user_memory  # leaked
    expect(response).toHaveLength(3)
`,
    "utf8",
  );
  const outMask = mkdtempSync(join(tmpdir(), "aprf-xtenant-mask-"));
  mkdirSync(join(outMask, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outMask, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: Array.from({ length: 12 }, (_, i) => ({
        id: `case-${i + 1}`,
        result: "pass",
        aiDataPathHint: "memories",
      })),
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    targetPath: leakTarget,
    outputDir: outMask,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportMask = JSON.parse(
    readFileSync(
      join(
        outMask,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportMask.summary.statusHint === "pass") {
    throw new Error(
      "passing import must not mask in-repo cross-tenant leak evidence",
    );
  }
  if (reportMask.summary.unauthorizedSuccesses < 1) {
    throw new Error(
      `expected in-repo leak to count unauthorizedSuccesses, got ${reportMask.summary.unauthorizedSuccesses}`,
    );
  }

  // One imported case + many inferred cases must not unlock PASS.
  const padTarget = mkdtempSync(join(tmpdir(), "aprf-xtenant-pad-tgt-"));
  mkdirSync(join(padTarget, "tests"), { recursive: true });
  for (let i = 0; i < 12; i++) {
    writeFileSync(
      join(padTarget, "tests", `test_cross_tenant_iso_${i}.py`),
      `
def test_cross_tenant_isolation_${i}():
    # deny other_tenant memory read
    assert response.status_code in (401, 403)
`,
      "utf8",
    );
  }
  const outPad = mkdtempSync(join(tmpdir(), "aprf-xtenant-pad-"));
  mkdirSync(join(outPad, "imports", "cross-tenant-tests"), { recursive: true });
  writeFileSync(
    join(outPad, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: [
        {
          id: "imported-only",
          result: "pass",
          aiDataPathHint: "memories",
        },
      ],
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    targetPath: padTarget,
    outputDir: outPad,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportPad = JSON.parse(
    readFileSync(
      join(
        outPad,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportPad.summary.statusHint === "pass") {
    throw new Error(
      "one imported case plus inferred repo cases must not PASS AUTHZ-M2",
    );
  }

  // Inferred unauthorized success + unrelated import must not FAIL.
  const outInferFail = mkdtempSync(join(tmpdir(), "aprf-xtenant-infer-fail-"));
  mkdirSync(join(outInferFail, "imports", "cross-tenant-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(outInferFail, "imports", "cross-tenant-tests", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: [
        {
          id: "unrelated-pass",
          result: "pass",
          aiDataPathHint: "chats",
        },
      ],
    }),
    "utf8",
  );
  await crossTenantTestsCollector.collect({
    targetPath: leakTarget,
    outputDir: outInferFail,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportInferFail = JSON.parse(
    readFileSync(
      join(
        outInferFail,
        "imports",
        "cross-tenant-tests",
        "cross-tenant-report.json",
      ),
      "utf8",
    ),
  ) as CrossTenantReport;
  if (reportInferFail.summary.statusHint === "fail") {
    throw new Error(
      "inferred unauthorized success must not FAIL when import has no unauthorized successes",
    );
  }
  if (reportInferFail.summary.statusHint !== "partial") {
    throw new Error(
      `expected partial for mixed inferred leak + thin import, got ${reportInferFail.summary.statusHint}`,
    );
  }

  console.log("aprf-auditor cross-tenant-tests smoke OK");
  for (const d of [
    outDir,
    out2,
    outStale,
    outCompact,
    outNa,
    emptyTarget,
    targetDir,
    outNoDenial,
    outBare,
    outOkFalse,
    leakTarget,
    outMask,
    padTarget,
    outPad,
    outInferFail,
  ]) {
    rmSync(d, { recursive: true, force: true });
  }
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
