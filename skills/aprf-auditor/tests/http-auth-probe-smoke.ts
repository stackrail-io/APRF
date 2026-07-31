/**
 * Smoke: http-auth-probe discovers declared FastAPI methods, treats GET 405 as
 * advisory (GET should also return 401/403), and PASSes when declared methods reject.
 */
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  httpAuthProbeCollector,
  startFixtureAuthServer,
  type AuthProbeReport,
} from "../collectors/http-auth-probe.ts";
import type { CollectorContext } from "../collectors/types.ts";

const outDir = mkdtempSync(join(tmpdir(), "aprf-auth-probe-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-auth-target-"));

async function main() {
  mkdirSync(join(targetDir, "routers"), { recursive: true });
  writeFileSync(
    join(targetDir, "main.py"),
    `
app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])
app.include_router(openai.router, prefix='/openai', tags=['openai'])
app.include_router(auths.router, prefix='/api/v1/auths', tags=['auths'])
`,
    "utf8",
  );
  // Only POST declared — GET becomes advisory
  writeFileSync(
    join(targetDir, "routers", "chats.py"),
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
    join(targetDir, "routers", "openai.py"),
    `
from fastapi import APIRouter
router = APIRouter()

@router.get('/')
@router.post('/v1/chat/completions')
async def openai_routes():
    return {}
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "routers", "auths.py"),
    `
from fastapi import APIRouter
router = APIRouter()

@router.post('/signin')
async def signin():
    return {}
`,
    "utf8",
  );

  const assessedAt = new Date();
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outDir,
    assessedAt,
    live: false,
    maxFiles: 100,
  };

  const offline = await httpAuthProbeCollector.collect(baseCtx);
  if (offline.status !== "needs-user") {
    throw new Error(
      `expected needs-user without base URL, got ${offline.status}: ${offline.detail}`,
    );
  }

  const fixture = await startFixtureAuthServer();
  try {
    const live = await httpAuthProbeCollector.collect({
      ...baseCtx,
      baseUrl: fixture.baseUrl,
    });
    if (live.status !== "ran") {
      throw new Error(
        `expected ran with base URL, got ${live.status}: ${live.detail}`,
      );
    }
    const reportPath = join(
      outDir,
      "imports",
      "http-auth-probe",
      "auth-probe-report.json",
    );
    const report = JSON.parse(
      readFileSync(reportPath, "utf8"),
    ) as AuthProbeReport;
    if (report.summary.authnM1Satisfied !== true) {
      throw new Error(
        `expected authnM1Satisfied=true, got ${JSON.stringify(report.summary)} results=${JSON.stringify(report.results)}`,
      );
    }
    if ((report.summary.advisoryGet405 ?? 0) < 1) {
      throw new Error(
        `expected advisoryGet405 >= 1, got ${report.summary.advisoryGet405}`,
      );
    }
    if (!report.notes?.some((n) => /GET should also return 401\/403/i.test(n))) {
      throw new Error(`expected GET hardening note, got ${JSON.stringify(report.notes)}`);
    }
    if (!live.nodes.some((n) => n.signals?.includes("authn-m1-pass-signal"))) {
      throw new Error("missing authn-m1-pass-signal on report node");
    }

    const out2 = mkdtempSync(join(tmpdir(), "aprf-auth-probe2-"));
    mkdirSync(join(out2, "imports", "http-auth-probe"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "http-auth-probe", "auth-probe-report.json"),
      JSON.stringify(report, null, 2),
    );
    const ingested = await httpAuthProbeCollector.collect({
      targetPath: targetDir,
      outputDir: out2,
      assessedAt,
      live: false,
    });
    if (ingested.status !== "ran") {
      throw new Error(`ingest prior report expected ran, got ${ingested.status}`);
    }
    rmSync(out2, { recursive: true, force: true });
  } finally {
    await fixture.close();
  }

  console.log("aprf-auditor http-auth-probe smoke OK");
  rmSync(outDir, { recursive: true, force: true });
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
