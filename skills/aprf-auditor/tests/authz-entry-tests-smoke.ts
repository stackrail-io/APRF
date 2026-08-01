/**
 * Smoke: authz-entry-tests requires denial tests for AI entry points;
 * code guards alone do not satisfy AUTHZ-M1; N/A + measuredAt hygiene.
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
  authzEntryTestsCollector,
  type AuthzEntryReport,
} from "../collectors/authz-entry-tests.ts";
import type { CollectorContext } from "../collectors/types.ts";

const outDir = mkdtempSync(join(tmpdir(), "aprf-authz-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-authz-target-"));

async function main() {
  mkdirSync(join(targetDir, "routers"), { recursive: true });
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "main.py"),
    `
app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])
app.include_router(knowledge.router, prefix='/api/v1/knowledge', tags=['knowledge'])
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "routers", "chats.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_verified_user
router = APIRouter()

@router.post('/')
async def create_chat(user=Depends(get_verified_user)):
    return {}
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "routers", "knowledge.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_verified_user
router = APIRouter()

@router.get('/')
async def list_kb(user=Depends(get_verified_user)):
    return []
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

  const noTests = await authzEntryTestsCollector.collect(baseCtx);
  if (noTests.status !== "ran") {
    throw new Error(`expected ran, got ${noTests.status}`);
  }
  const report1 = JSON.parse(
    readFileSync(
      join(outDir, "imports", "authz-entry-tests", "authz-entry-report.json"),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (report1.summary.authzM1Satisfied !== false) {
    throw new Error(
      `without tests expected satisfied=false, got ${report1.summary.authzM1Satisfied}`,
    );
  }
  if (report1.summary.statusHint !== "fail") {
    throw new Error(
      `without tests expected statusHint=fail, got ${report1.summary.statusHint}`,
    );
  }
  if (!report1.codeGuardsFound) {
    throw new Error("expected code guards detected");
  }

  // Add denial tests for both entry points
  writeFileSync(
    join(targetDir, "tests", "test_authz_chats.py"),
    `
def test_chats_unauthorized():
    r = client.post('/api/v1/chats/')
    assert r.status_code == 401
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "tests", "test_authz_knowledge.py"),
    `
def test_knowledge_forbidden():
    r = client.get('/api/v1/knowledge/')
    assert r.status_code == 403
`,
    "utf8",
  );

  const out2 = mkdtempSync(join(tmpdir(), "aprf-authz2-"));
  const withTests = await authzEntryTestsCollector.collect({
    ...baseCtx,
    outputDir: out2,
  });
  if (withTests.status !== "ran") {
    throw new Error(`expected ran with tests: ${withTests.status}`);
  }
  const report2 = JSON.parse(
    readFileSync(
      join(out2, "imports", "authz-entry-tests", "authz-entry-report.json"),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (report2.summary.authzM1Satisfied !== true) {
    throw new Error(
      `with denial tests expected satisfied=true, got ${JSON.stringify(report2.summary)}`,
    );
  }
  if (report2.summary.statusHint !== "pass") {
    throw new Error(
      `expected statusHint=pass, got ${report2.summary.statusHint}`,
    );
  }
  if (report2.summary.coveragePct !== 100) {
    throw new Error(`expected 100% coverage, got ${report2.summary.coveragePct}`);
  }
  if (!report2.measuredAt) {
    throw new Error("expected measuredAt on pass report");
  }

  // N/A: empty target + explicit attest
  const emptyTarget = mkdtempSync(join(tmpdir(), "aprf-authz-empty-"));
  const outNa = mkdtempSync(join(tmpdir(), "aprf-authz-na-"));
  mkdirSync(join(outNa, "imports", "authz-entry-tests"), { recursive: true });
  writeFileSync(
    join(outNa, "imports", "authz-entry-tests", "na.json"),
    JSON.stringify({
      privilegedAiFeatureToolOrRetrievalEntryPointsPresent: false,
      measuredAt: new Date().toISOString(),
    }),
    "utf8",
  );
  const naRun = await authzEntryTestsCollector.collect({
    targetPath: emptyTarget,
    outputDir: outNa,
    assessedAt: new Date(),
    live: false,
    maxFiles: 50,
  });
  if (naRun.status !== "ran") {
    throw new Error(`expected ran for N/A, got ${naRun.status}`);
  }
  const reportNa = JSON.parse(
    readFileSync(
      join(outNa, "imports", "authz-entry-tests", "authz-entry-report.json"),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (reportNa.summary.statusHint !== "not_applicable") {
    throw new Error(
      `expected not_applicable, got ${reportNa.summary.statusHint} notes=${reportNa.notes.join("; ")}`,
    );
  }

  // Global helper alone must not launder hasServerGuard onto unguarded routes.
  const unguardedTarget = mkdtempSync(join(tmpdir(), "aprf-authz-unguarded-"));
  mkdirSync(join(unguardedTarget, "routers"), { recursive: true });
  mkdirSync(join(unguardedTarget, "utils"), { recursive: true });
  mkdirSync(join(unguardedTarget, "tests"), { recursive: true });
  writeFileSync(
    join(unguardedTarget, "main.py"),
    `app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])\n`,
    "utf8",
  );
  writeFileSync(
    join(unguardedTarget, "utils", "auth.py"),
    `def has_permission(user, perm):\n    return True\n`,
    "utf8",
  );
  writeFileSync(
    join(unguardedTarget, "routers", "chats.py"),
    `
from fastapi import APIRouter
router = APIRouter()

@router.post('/')
async def create_chat():
    return {}
`,
    "utf8",
  );
  writeFileSync(
    join(unguardedTarget, "tests", "test_authz_chats.py"),
    `
def test_chats_unauthorized():
    r = client.post('/api/v1/chats/')
    assert r.status_code == 401
`,
    "utf8",
  );
  const outUnguarded = mkdtempSync(join(tmpdir(), "aprf-authz-unguarded-out-"));
  await authzEntryTestsCollector.collect({
    targetPath: unguardedTarget,
    outputDir: outUnguarded,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportUnguarded = JSON.parse(
    readFileSync(
      join(
        outUnguarded,
        "imports",
        "authz-entry-tests",
        "authz-entry-report.json",
      ),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (reportUnguarded.summary.statusHint === "pass") {
    throw new Error(
      "global has_permission must not PASS unguarded routes with denial tests only",
    );
  }
  if (reportUnguarded.summary.authzM1Satisfied === true) {
    throw new Error("unguarded route expected satisfied≠true");
  }
  if (!reportUnguarded.codeGuardsFound) {
    throw new Error("expected global codeGuardsFound=true for has_permission helper");
  }
  if (reportUnguarded.entryPoints.some((e) => e.hasServerGuard)) {
    throw new Error("unguarded router must not report hasServerGuard");
  }

  console.log("aprf-auditor authz-entry-tests smoke OK");
  rmSync(outDir, { recursive: true, force: true });
  rmSync(out2, { recursive: true, force: true });
  rmSync(outNa, { recursive: true, force: true });
  rmSync(emptyTarget, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  rmSync(unguardedTarget, { recursive: true, force: true });
  rmSync(outUnguarded, { recursive: true, force: true });
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
