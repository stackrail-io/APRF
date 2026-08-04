/**
 * Smoke: authz-entry-tests requires denial tests for privileged AI entry points;
 * authn-only guards are not AUTHZ-M1 privilege gates; live limited-user probe
 * can supply denial coverage; N/A + measuredAt hygiene.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
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
from open_webui.utils.auth import get_admin_user
router = APIRouter()

@router.post('/')
async def create_chat(user=Depends(get_admin_user)):
    return {}
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "routers", "knowledge.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_admin_user
router = APIRouter()

@router.get('/')
async def list_kb(user=Depends(get_admin_user)):
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
  if (!report1.authzGuardsFound) {
    throw new Error("expected authz guards detected");
  }
  if (!report1.gapNotes?.some((n) => /denial|suite|live/i.test(n))) {
    throw new Error(
      `expected gapNotes about denial suite, got ${JSON.stringify(report1.gapNotes)}`,
    );
  }
  // Evidence excerpt on graph node should be valid JSON for REPORT pretty-print
  const reportNode = noTests.nodes.find((n) => n.id.endsWith(":report"));
  if (!reportNode?.excerpt) throw new Error("missing report excerpt");
  JSON.parse(reportNode.excerpt);

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
  if (report2.gapNotes.length !== 0) {
    throw new Error(`pass report should have empty gapNotes, got ${report2.gapNotes}`);
  }

  // Authn-only guards must not score as privileged AUTHZ-M1 entry points.
  // Mixed file: admin on one handler must not launder authz onto authn-only handlers.
  const authnOnlyTarget = mkdtempSync(join(tmpdir(), "aprf-authz-authn-"));
  mkdirSync(join(authnOnlyTarget, "routers"), { recursive: true });
  writeFileSync(
    join(authnOnlyTarget, "main.py"),
    `app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])\n`,
    "utf8",
  );
  writeFileSync(
    join(authnOnlyTarget, "routers", "chats.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_verified_user, get_admin_user
router = APIRouter()
@router.post('/')
async def create_chat(user=Depends(get_verified_user)):
    return {}
@router.get('/config')
async def get_config(user=Depends(get_admin_user)):
    return {}
`,
    "utf8",
  );
  const outAuthn = mkdtempSync(join(tmpdir(), "aprf-authz-authn-out-"));
  await authzEntryTestsCollector.collect({
    targetPath: authnOnlyTarget,
    outputDir: outAuthn,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportAuthn = JSON.parse(
    readFileSync(
      join(outAuthn, "imports", "authz-entry-tests", "authz-entry-report.json"),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (reportAuthn.summary.total !== 1) {
    throw new Error(
      `expected only /config as privileged, total=${reportAuthn.summary.total} eps=${JSON.stringify(reportAuthn.entryPoints)}`,
    );
  }
  if (!reportAuthn.entryPoints[0]?.path.includes("config")) {
    throw new Error(
      `expected privileged path to be config, got ${reportAuthn.entryPoints[0]?.path}`,
    );
  }
  if (reportAuthn.authnOnlyAiEntryPointCount < 1) {
    throw new Error("expected authnOnlyAiEntryPointCount >= 1");
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
  if (reportUnguarded.entryPoints.some((e) => e.hasServerGuard)) {
    throw new Error("unguarded router must not report hasServerGuard");
  }

  // Loose substring coveredPaths must not launder denial coverage.
  const looseOut = mkdtempSync(join(tmpdir(), "aprf-authz-loose-"));
  mkdirSync(join(looseOut, "imports", "authz-entry-tests"), { recursive: true });
  writeFileSync(
    join(looseOut, "imports", "authz-entry-tests", "coverage.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coveredPaths: ["chats", "/api"], // substring / prefix — too loose
    }),
    "utf8",
  );
  const looseTarget = mkdtempSync(join(tmpdir(), "aprf-authz-loose-target-"));
  mkdirSync(join(looseTarget, "routers"), { recursive: true });
  writeFileSync(
    join(looseTarget, "main.py"),
    `app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])\n`,
    "utf8",
  );
  writeFileSync(
    join(looseTarget, "routers", "chats.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_admin_user
router = APIRouter()
@router.post('/')
async def create_chat(user=Depends(get_admin_user)):
    return {}
`,
    "utf8",
  );
  await authzEntryTestsCollector.collect({
    targetPath: looseTarget,
    outputDir: looseOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportLoose = JSON.parse(
    readFileSync(
      join(looseOut, "imports", "authz-entry-tests", "authz-entry-report.json"),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (reportLoose.summary.statusHint === "pass") {
    throw new Error("substring/prefix coveredPaths must not PASS AUTHZ-M1");
  }
  if (reportLoose.entryPoints.some((e) => e.hasDenialTest || e.denialFromImport)) {
    throw new Error(
      `loose coveredPaths must not set hasDenialTest; got ${JSON.stringify(reportLoose.entryPoints)}`,
    );
  }

  // Exact import path covers the route; stale measuredAt blocks PASS even when
  // a sibling route has fresh in-repo denial tests.
  const mixedTarget = mkdtempSync(join(tmpdir(), "aprf-authz-mixed-"));
  mkdirSync(join(mixedTarget, "routers"), { recursive: true });
  mkdirSync(join(mixedTarget, "tests"), { recursive: true });
  writeFileSync(
    join(mixedTarget, "main.py"),
    `
app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])
app.include_router(knowledge.router, prefix='/api/v1/knowledge', tags=['knowledge'])
`,
    "utf8",
  );
  writeFileSync(
    join(mixedTarget, "routers", "chats.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_admin_user
router = APIRouter()
@router.post('/')
async def create_chat(user=Depends(get_admin_user)):
    return {}
`,
    "utf8",
  );
  writeFileSync(
    join(mixedTarget, "routers", "knowledge.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_admin_user
router = APIRouter()
@router.get('/')
async def list_kb(user=Depends(get_admin_user)):
    return []
`,
    "utf8",
  );
  writeFileSync(
    join(mixedTarget, "tests", "test_authz_chats.py"),
    `
def test_chats_unauthorized():
    r = client.post('/api/v1/chats/')
    assert r.status_code == 401
`,
    "utf8",
  );
  const mixedOutStale = mkdtempSync(join(tmpdir(), "aprf-authz-mixed-stale-"));
  mkdirSync(join(mixedOutStale, "imports", "authz-entry-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(mixedOutStale, "imports", "authz-entry-tests", "coverage.json"),
    JSON.stringify({
      measuredAt: "2020-01-01T00:00:00.000Z",
      coveredPaths: ["GET /api/v1/knowledge"],
    }),
    "utf8",
  );
  await authzEntryTestsCollector.collect({
    targetPath: mixedTarget,
    outputDir: mixedOutStale,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportStaleImport = JSON.parse(
    readFileSync(
      join(
        mixedOutStale,
        "imports",
        "authz-entry-tests",
        "authz-entry-report.json",
      ),
      "utf8",
    ),
  ) as AuthzEntryReport;
  const knowledgeEp = reportStaleImport.entryPoints.find((e) =>
    e.path.includes("knowledge"),
  );
  if (!knowledgeEp?.denialFromImport) {
    throw new Error(
      `expected knowledge denialFromImport=true, got ${JSON.stringify(knowledgeEp)}`,
    );
  }
  if (reportStaleImport.summary.statusHint === "pass") {
    throw new Error(
      "stale import measuredAt must block PASS when any route is import-backed",
    );
  }

  // Exact fresh import coverage unlocks PASS for the import-backed route.
  const mixedOutFresh = mkdtempSync(join(tmpdir(), "aprf-authz-mixed-fresh-"));
  mkdirSync(join(mixedOutFresh, "imports", "authz-entry-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(mixedOutFresh, "imports", "authz-entry-tests", "coverage.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coveredPaths: ["GET /api/v1/knowledge/"],
    }),
    "utf8",
  );
  await authzEntryTestsCollector.collect({
    targetPath: mixedTarget,
    outputDir: mixedOutFresh,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportFreshImport = JSON.parse(
    readFileSync(
      join(
        mixedOutFresh,
        "imports",
        "authz-entry-tests",
        "authz-entry-report.json",
      ),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (
    reportFreshImport.summary.statusHint !== "pass" ||
    reportFreshImport.summary.authzM1Satisfied !== true
  ) {
    throw new Error(
      `exact fresh import coverage expected pass, got ${JSON.stringify(reportFreshImport.summary)} notes=${reportFreshImport.notes.join("; ")}`,
    );
  }

  // Path-only coveredPaths must not cover every HTTP method on that path.
  const methodMismatchOut = mkdtempSync(
    join(tmpdir(), "aprf-authz-method-mismatch-"),
  );
  mkdirSync(join(methodMismatchOut, "imports", "authz-entry-tests"), {
    recursive: true,
  });
  writeFileSync(
    join(methodMismatchOut, "imports", "authz-entry-tests", "coverage.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      coveredPaths: ["/api/v1/chats", "GET /api/v1/chats"],
    }),
    "utf8",
  );
  const methodMismatchTarget = mkdtempSync(
    join(tmpdir(), "aprf-authz-method-mismatch-target-"),
  );
  mkdirSync(join(methodMismatchTarget, "routers"), { recursive: true });
  writeFileSync(
    join(methodMismatchTarget, "main.py"),
    `app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])\n`,
    "utf8",
  );
  writeFileSync(
    join(methodMismatchTarget, "routers", "chats.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_admin_user
router = APIRouter()
@router.post('/')
async def create_chat(user=Depends(get_admin_user)):
    return {}
`,
    "utf8",
  );
  await authzEntryTestsCollector.collect({
    targetPath: methodMismatchTarget,
    outputDir: methodMismatchOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportMethodMismatch = JSON.parse(
    readFileSync(
      join(
        methodMismatchOut,
        "imports",
        "authz-entry-tests",
        "authz-entry-report.json",
      ),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (
    reportMethodMismatch.entryPoints.some(
      (e) => e.hasDenialTest || e.denialFromImport,
    )
  ) {
    throw new Error(
      `path-only/wrong-method coveredPaths must not set hasDenialTest; got ${JSON.stringify(reportMethodMismatch.entryPoints)}`,
    );
  }

  // include_router prefix fallbacks (declaredInCode=false) must still be classified.
  const fallbackTarget = mkdtempSync(join(tmpdir(), "aprf-authz-fallback-"));
  const fallbackOut = mkdtempSync(join(tmpdir(), "aprf-authz-fallback-out-"));
  writeFileSync(
    join(fallbackTarget, "main.py"),
    `app.include_router(missing_mod.router, prefix='/api/v1/knowledge', tags=['knowledge'])\n`,
    "utf8",
  );
  await authzEntryTestsCollector.collect({
    targetPath: fallbackTarget,
    outputDir: fallbackOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  });
  const reportFallback = JSON.parse(
    readFileSync(
      join(
        fallbackOut,
        "imports",
        "authz-entry-tests",
        "authz-entry-report.json",
      ),
      "utf8",
    ),
  ) as AuthzEntryReport;
  // Without resolvable router, routes are authn/none — not privileged; must not vacuous PASS.
  if (reportFallback.summary.statusHint === "pass") {
    throw new Error("prefix-fallback-only must not vacuous PASS AUTHZ-M1");
  }

  // Live limited-user probe supplies denial coverage.
  const liveTarget = mkdtempSync(join(tmpdir(), "aprf-authz-live-target-"));
  mkdirSync(join(liveTarget, "routers"), { recursive: true });
  writeFileSync(
    join(liveTarget, "main.py"),
    `app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])\n`,
    "utf8",
  );
  writeFileSync(
    join(liveTarget, "routers", "chats.py"),
    `
from fastapi import APIRouter, Depends
from open_webui.utils.auth import get_admin_user
router = APIRouter()
@router.post('/')
async def create_chat(user=Depends(get_admin_user)):
    return {}
`,
    "utf8",
  );
  const liveServer = createServer((req, res) => {
    const auth = req.headers.authorization || "";
    if (req.url === "/api/v1/auths/signin" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: "limited-jwt", role: "user" }));
      return;
    }
    if (auth === "Bearer limited-jwt") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Forbidden" }));
      return;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Unauthorized" }));
  });
  await new Promise<void>((resolve) => liveServer.listen(0, "127.0.0.1", () => resolve()));
  const addr = liveServer.address();
  if (!addr || typeof addr === "string") throw new Error("no listen addr");
  const liveOut = mkdtempSync(join(tmpdir(), "aprf-authz-live-out-"));
  await authzEntryTestsCollector.collect({
    targetPath: liveTarget,
    outputDir: liveOut,
    assessedAt: new Date(),
    live: true,
    maxFiles: 200,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    limitedEmail: "user@test.local",
    limitedPassword: "secret",
  });
  const reportLive = JSON.parse(
    readFileSync(
      join(liveOut, "imports", "authz-entry-tests", "authz-entry-report.json"),
      "utf8",
    ),
  ) as AuthzEntryReport;
  if (reportLive.summary.statusHint !== "pass") {
    throw new Error(
      `live denial probe expected pass, got ${JSON.stringify(reportLive.summary)} notes=${reportLive.notes.join("; ")}`,
    );
  }
  if (!reportLive.entryPoints.every((e) => e.denialFromLive)) {
    throw new Error(
      `expected denialFromLive on entry points, got ${JSON.stringify(reportLive.entryPoints)}`,
    );
  }
  if (!reportLive.liveProbe || reportLive.liveProbe.denied < 1) {
    throw new Error(`expected liveProbe.denied>=1, got ${JSON.stringify(reportLive.liveProbe)}`);
  }
  liveServer.close();

  console.log("aprf-auditor authz-entry-tests smoke OK");
  for (const d of [
    outDir,
    out2,
    outNa,
    emptyTarget,
    targetDir,
    authnOnlyTarget,
    outAuthn,
    unguardedTarget,
    outUnguarded,
    looseOut,
    looseTarget,
    mixedTarget,
    mixedOutStale,
    mixedOutFresh,
    methodMismatchOut,
    methodMismatchTarget,
    fallbackTarget,
    fallbackOut,
    liveTarget,
    liveOut,
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
