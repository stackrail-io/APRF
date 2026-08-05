/**
 * Smoke: http-auth-probe discovers declared FastAPI methods, treats undeclared
 * GET (405 or SPA 2xx) as hardening-only, and PASSes when declared methods reject.
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
    if (report.summary.authnM1Satisfied !== true || report.summary.statusHint !== "pass") {
      throw new Error(
        `expected pass/authnM1Satisfied=true, got ${JSON.stringify(report.summary)} results=${JSON.stringify(report.results)}`,
      );
    }
    if (report.summary.probeInventoryMatchesRouteCatalog !== true) {
      throw new Error(
        `expected catalog match, got ${report.summary.probeInventoryMatchesRouteCatalog}`,
      );
    }
    if (!report.measuredAt) {
      throw new Error("expected measuredAt on report");
    }
    if ((report.summary.advisoryGetOpen ?? 0) < 1) {
      throw new Error(
        `expected advisoryGetOpen >= 1 (SPA-like GET 200), got ${report.summary.advisoryGetOpen}`,
      );
    }
    if (
      !report.notes?.some((n) =>
        /undeclared GET probe|Not scored for AUTHN-M1/i.test(n),
      )
    ) {
      throw new Error(
        `expected advisory GET hardening note, got ${JSON.stringify(report.notes)}`,
      );
    }
    if ((report.gapNotes?.length ?? 0) !== 0) {
      throw new Error(
        `pass report should have empty gapNotes, got ${JSON.stringify(report.gapNotes)}`,
      );
    }
    if (report.signals?.unauthenticatedDeclaredRoutes?.found !== false) {
      throw new Error(
        `pass should not flag unauthenticatedDeclaredRoutes, got ${JSON.stringify(report.signals)}`,
      );
    }
    if (report.notes?.some((n) => /APRF_AUTH_PROBE_MAX_ROUTES/i.test(n))) {
      throw new Error("customer notes must not mention APRF_AUTH_PROBE_MAX_ROUTES");
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
    const ingestedReport = JSON.parse(
      readFileSync(
        join(out2, "imports", "http-auth-probe", "auth-probe-report.json"),
        "utf8",
      ),
    ) as AuthProbeReport;
    if (
      ingestedReport.summary.authnM1Satisfied !== true ||
      ingestedReport.summary.statusHint !== "pass"
    ) {
      throw new Error(
        `prior report with catalog match should stay pass: ${JSON.stringify(ingestedReport.summary)}`,
      );
    }

    const outNoCatalog = mkdtempSync(join(tmpdir(), "aprf-auth-nocat-"));
    mkdirSync(join(outNoCatalog, "imports", "http-auth-probe"), {
      recursive: true,
    });
    const incomplete = {
      ...report,
      results: [],
      summary: {
        ...report.summary,
        probeInventoryMatchesRouteCatalog: false,
        authnM1Satisfied: true,
        statusHint: "pass" as const,
      },
    };
    writeFileSync(
      join(outNoCatalog, "imports", "http-auth-probe", "auth-probe-report.json"),
      JSON.stringify(incomplete, null, 2),
    );
    const downgraded = await httpAuthProbeCollector.collect({
      targetPath: targetDir,
      outputDir: outNoCatalog,
      assessedAt,
      live: false,
    });
    if (downgraded.status !== "ran") {
      throw new Error(
        `incomplete catalog prior report expected ran, got ${downgraded.status}`,
      );
    }
    const downReport = JSON.parse(
      readFileSync(
        join(outNoCatalog, "imports", "http-auth-probe", "auth-probe-report.json"),
        "utf8",
      ),
    ) as AuthProbeReport;
    if (
      downReport.summary.authnM1Satisfied !== false ||
      downReport.summary.statusHint !== "partial"
    ) {
      throw new Error(
        `prior PASS without catalog match must downgrade: ${JSON.stringify(downReport.summary)}`,
      );
    }
    rmSync(outNoCatalog, { recursive: true, force: true });

    // Prior PASS must downgrade when new declared AI routes appear after the probe
    const outStaleCatalog = mkdtempSync(join(tmpdir(), "aprf-auth-stale-cat-"));
    mkdirSync(join(outStaleCatalog, "imports", "http-auth-probe"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outStaleCatalog,
        "imports",
        "http-auth-probe",
        "auth-probe-report.json",
      ),
      JSON.stringify(report, null, 2),
    );
    writeFileSync(
      join(targetDir, "routers", "embeddings.py"),
      `
from fastapi import APIRouter
router = APIRouter()

@router.post('/v1/embeddings')
async def embeddings():
    return {}
`,
    );
    writeFileSync(
      join(targetDir, "main.py"),
      `
app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])
app.include_router(openai.router, prefix='/openai', tags=['openai'])
app.include_router(auths.router, prefix='/api/v1/auths', tags=['auths'])
app.include_router(embeddings.router, prefix='/openai', tags=['embeddings'])
`,
    );
    const staleCatalog = await httpAuthProbeCollector.collect({
      targetPath: targetDir,
      outputDir: outStaleCatalog,
      assessedAt,
      live: false,
    });
    if (staleCatalog.status !== "ran") {
      throw new Error(
        `stale catalog prior report expected ran, got ${staleCatalog.status}`,
      );
    }
    const staleReport = JSON.parse(
      readFileSync(
        join(
          outStaleCatalog,
          "imports",
          "http-auth-probe",
          "auth-probe-report.json",
        ),
        "utf8",
      ),
    ) as AuthProbeReport;
    if (
      staleReport.summary.authnM1Satisfied !== false ||
      staleReport.summary.statusHint !== "partial" ||
      staleReport.summary.probeInventoryMatchesRouteCatalog !== false
    ) {
      throw new Error(
        `new declared routes must downgrade prior PASS: ${JSON.stringify(staleReport.summary)}`,
      );
    }
    // Restore original target catalog for subsequent smokes
    writeFileSync(
      join(targetDir, "main.py"),
      `
app.include_router(chats.router, prefix='/api/v1/chats', tags=['chats'])
app.include_router(openai.router, prefix='/openai', tags=['openai'])
app.include_router(auths.router, prefix='/api/v1/auths', tags=['auths'])
`,
    );
    rmSync(join(targetDir, "routers", "embeddings.py"), { force: true });
    rmSync(outStaleCatalog, { recursive: true, force: true });
    rmSync(out2, { recursive: true, force: true });

    const outAlt = mkdtempSync(join(tmpdir(), "aprf-auth-alt-"));
    mkdirSync(join(outAlt, "imports", "http-auth-probe"), { recursive: true });
    writeFileSync(
      join(outAlt, "imports", "http-auth-probe", "probe-results.json"),
      JSON.stringify(report, null, 2),
    );
    const alt = await httpAuthProbeCollector.collect({
      targetPath: targetDir,
      outputDir: outAlt,
      assessedAt,
      live: false,
    });
    if (alt.status !== "ran") {
      throw new Error(`alternate probe*.json expected ran, got ${alt.status}`);
    }
    const altReport = JSON.parse(
      readFileSync(
        join(outAlt, "imports", "http-auth-probe", "auth-probe-report.json"),
        "utf8",
      ),
    ) as AuthProbeReport;
    if (
      altReport.summary.authnM1Satisfied !== true ||
      altReport.summary.statusHint !== "pass"
    ) {
      throw new Error(
        `probe*.json prior report should evaluate to pass: ${JSON.stringify(altReport.summary)}`,
      );
    }
    rmSync(outAlt, { recursive: true, force: true });

    const emptyTarget = mkdtempSync(join(tmpdir(), "aprf-auth-empty-"));
    const outNa = mkdtempSync(join(tmpdir(), "aprf-auth-na-"));
    mkdirSync(join(outNa, "imports", "http-auth-probe"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "http-auth-probe", "scope.json"),
      JSON.stringify({ customerFacingAiHttpApisPresent: false }),
    );
    const na = await httpAuthProbeCollector.collect({
      targetPath: emptyTarget,
      outputDir: outNa,
      assessedAt,
      live: false,
    });
    if (na.status !== "ran") {
      throw new Error(`n/a expected ran, got ${na.status}`);
    }
    const naReport = JSON.parse(
      readFileSync(
        join(outNa, "imports", "http-auth-probe", "auth-probe-report.json"),
        "utf8",
      ),
    ) as AuthProbeReport;
    if (naReport.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(naReport.summary)}`);
    }
    rmSync(outNa, { recursive: true, force: true });

    // Declared AI routes must override present=false N/A
    const declaredTarget = mkdtempSync(join(tmpdir(), "aprf-auth-declared-"));
    mkdirSync(join(declaredTarget, "routers"), { recursive: true });
    writeFileSync(
      join(declaredTarget, "main.py"),
      "app.include_router(openai.router, prefix='/openai', tags=['openai'])\n",
    );
    writeFileSync(
      join(declaredTarget, "routers", "openai.py"),
      `
from fastapi import APIRouter
router = APIRouter()

@router.post('/v1/chat/completions')
async def chat():
    return {}
`,
    );
    const outDeclaredNa = mkdtempSync(join(tmpdir(), "aprf-auth-declared-na-"));
    mkdirSync(join(outDeclaredNa, "imports", "http-auth-probe"), {
      recursive: true,
    });
    writeFileSync(
      join(outDeclaredNa, "imports", "http-auth-probe", "scope.json"),
      JSON.stringify({ customerFacingAiHttpApisPresent: false }),
    );
    const declaredNa = await httpAuthProbeCollector.collect({
      targetPath: declaredTarget,
      outputDir: outDeclaredNa,
      assessedAt,
      live: false,
    });
    if (declaredNa.status === "ran") {
      const declaredNaReport = JSON.parse(
        readFileSync(
          join(
            outDeclaredNa,
            "imports",
            "http-auth-probe",
            "auth-probe-report.json",
          ),
          "utf8",
        ),
      ) as AuthProbeReport;
      if (declaredNaReport.summary.statusHint === "not_applicable") {
        throw new Error(
          `declared AI routes must override present=false N/A: ${JSON.stringify(declaredNaReport.summary)}`,
        );
      }
    } else if (declaredNa.status !== "needs-user") {
      throw new Error(
        `declared+present=false expected needs-user or non-N/A ran, got ${declaredNa.status}`,
      );
    }
    rmSync(outDeclaredNa, { recursive: true, force: true });
    rmSync(declaredTarget, { recursive: true, force: true });

    const outScope = mkdtempSync(join(tmpdir(), "aprf-auth-scope-"));
    mkdirSync(join(outScope, "imports", "http-auth-probe"), { recursive: true });
    writeFileSync(
      join(outScope, "imports", "http-auth-probe", "a-present.json"),
      JSON.stringify({ customerFacingAiHttpApisPresent: true }),
    );
    writeFileSync(
      join(outScope, "imports", "http-auth-probe", "z-absent.json"),
      JSON.stringify({ customerFacingAiHttpApisPresent: false }),
    );
    const scopeMerge = await httpAuthProbeCollector.collect({
      targetPath: emptyTarget,
      outputDir: outScope,
      assessedAt,
      live: false,
    });
    if (scopeMerge.status === "ran") {
      const scopeReport = JSON.parse(
        readFileSync(
          join(outScope, "imports", "http-auth-probe", "auth-probe-report.json"),
          "utf8",
        ),
      ) as AuthProbeReport;
      if (scopeReport.summary.statusHint === "not_applicable") {
        throw new Error(
          "present=true must win over later false — should not N/A",
        );
      }
    }
    rmSync(outScope, { recursive: true, force: true });
    rmSync(emptyTarget, { recursive: true, force: true });
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
