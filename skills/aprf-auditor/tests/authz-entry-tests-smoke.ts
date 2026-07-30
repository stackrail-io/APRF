/**
 * Smoke: authz-entry-tests requires denial tests for AI entry points;
 * code guards alone do not satisfy AUTHZ-M1.
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
  if (report2.summary.coveragePct !== 100) {
    throw new Error(`expected 100% coverage, got ${report2.summary.coveragePct}`);
  }

  console.log("aprf-auditor authz-entry-tests smoke OK");
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
