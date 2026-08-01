/**
 * authz-entry-tests — AUTHZ-M1 detector executor.
 *
 * Inventories AI HTTP entry points, detects server-side authz guards in code,
 * and scores whether automated tests deny authenticated-but-unauthorized callers.
 * Code guards alone ≠ PASS — passCondition requires server-side enforcement AND
 * an authz suite with 0 successful unauthorized (authenticated) accesses.
 */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import { discoverRoutes, type ProbeRoute } from "./http-auth-probe.ts";
import {
  asBool,
  measuredAtFresh,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "authz-entry-tests";
const RELATED = ["AUTHZ-M1"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

const GUARD_RE =
  /\b(get_verified_user|get_admin_user|get_current_user|get_current_user_by_api_key|has_permission|has_access|has_connection_access|has_folder_access|has_access_to_file|require_permission|Depends\s*\(\s*get_)/;

const DENIAL_RE =
  /\b(401|403|unauthorized|forbidden|HTTP_401|HTTP_403|status_code\s*=\s*40[13]|toBe\(\s*40[13]\s*\)|assert.*40[13])/i;

const TEST_FILE_RE =
  /(^|[/\\])(tests?|__tests__|spec)([/\\]|$)|[._-](test|spec)\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;

export interface AuthzEntryPoint {
  method: string;
  path: string;
  source: string;
  declaredInCode: boolean;
  hasServerGuard: boolean;
  guardRefs: string[];
  hasDenialTest: boolean;
  /** true when denial coverage for this route comes only from imported coveredPaths */
  denialFromImport: boolean;
  testRefs: string[];
  ok: boolean;
}

export interface AuthzEntryReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  measuredAt: string | null;
  catalogSource: string[];
  codeGuardsFound: boolean;
  guardSampleRefs: string[];
  privilegedAiFeatureToolOrRetrievalEntryPointsPresent: boolean | null;
  entryPoints: AuthzEntryPoint[];
  summary: {
    total: number;
    withServerGuard: number;
    withDenialTest: number;
    pass: number;
    fail: number;
    /** true iff every AI entry point has guard+denial coverage, suite non-empty, measuredAt fresh. */
    authzM1Satisfied: boolean | null;
    coveragePct: number;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function pathTokens(path: string): string[] {
  return path
    .toLowerCase()
    .split("/")
    .filter((t) => t && t !== "api" && t !== "v1" && t !== "probe" && t.length > 2);
}

function loadImportedCoverage(ctx: CollectorContext): {
  coveredPaths: string[];
  sources: string[];
  measuredAt: string | null;
  privilegedAiFeatureToolOrRetrievalEntryPointsPresent: boolean | null;
} {
  const coveredPaths: string[] = [];
  const sources: string[] = [];
  let measuredAt: string | null = null;
  let privilegedAiFeatureToolOrRetrievalEntryPointsPresent: boolean | null =
    null;
  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (!/\.json$/i.test(file)) continue;
    if (/authz-entry-report\.json$/i.test(file)) continue;
    const text = readText(file, 2_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      privilegedAiFeatureToolOrRetrievalEntryPointsPresent = mergeOrBool(
        privilegedAiFeatureToolOrRetrievalEntryPointsPresent,
        asBool(data.privilegedAiFeatureToolOrRetrievalEntryPointsPresent) ??
          asBool(
            data.privileged_ai_feature_tool_or_retrieval_entry_points_present,
          ) ??
          asBool(data.privilegedAiEntryPointsPresent),
      );
      const paths = [
        ...((data.coveredPaths as string[]) || []),
        ...((data.covered_paths as string[]) || []),
        ...((data.entryPoints as Array<{ path?: string; hasDenialTest?: boolean }>) || [])
          .filter((e) => e.hasDenialTest && e.path)
          .map((e) => e.path as string),
      ];
      if (Array.isArray(data.tests)) {
        for (const t of data.tests as Array<{ path?: string; url?: string }>) {
          if (t.path) paths.push(t.path);
          if (t.url) paths.push(t.url);
        }
      }
      for (const p of paths) {
        if (typeof p === "string" && p.trim()) coveredPaths.push(p.trim());
      }
      const hasPresentAttest =
        asBool(data.privilegedAiFeatureToolOrRetrievalEntryPointsPresent) !==
          null ||
        asBool(
          data.privileged_ai_feature_tool_or_retrieval_entry_points_present,
        ) !== null ||
        asBool(data.privilegedAiEntryPointsPresent) !== null;
      if (paths.length || hasPresentAttest || parseMeasuredAt(data)) {
        sources.push(rel(ctx.outputDir, file));
      }
    } catch {
      /* skip */
    }
  }
  return {
    coveredPaths,
    sources,
    measuredAt,
    privilegedAiFeatureToolOrRetrievalEntryPointsPresent,
  };
}

function collectTestFiles(targetPath: string, maxFiles: number): string[] {
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  });
  return files.filter((f) => TEST_FILE_RE.test(f));
}

function scanGuardsInRepo(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[] } {
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".js"],
  });
  const refs: string[] = [];
  for (const f of files) {
    const text = readText(f, 200_000);
    if (!text || !GUARD_RE.test(text)) continue;
    refs.push(rel(targetPath, f));
    if (refs.length >= 12) break;
  }
  return { found: refs.length > 0, refs };
}

/** Map route source path → whether that file (or sibling router) has a guard. */
function routeHasGuard(
  targetPath: string,
  route: ProbeRoute,
  fileGuardCache: Map<string, boolean>,
): { has: boolean; refs: string[] } {
  const refs: string[] = [];
  // source looks like "routers/chats.py:@router.post" or rel path
  const src = route.source.split(":")[0] || "";
  const candidates = [
    join(targetPath, src),
    src.startsWith("/") ? src : "",
  ].filter(Boolean);

  // Also try open_webui routers by last path segment
  const tokens = pathTokens(route.path);
  const last = tokens[tokens.length - 1];
  if (last) {
    candidates.push(
      join(targetPath, "backend", "open_webui", "routers", `${last}.py`),
      join(targetPath, "open_webui", "routers", `${last}.py`),
      join(targetPath, "routers", `${last}.py`),
    );
  }

  for (const c of candidates) {
    if (!c || !existsSync(c)) continue;
    let has = fileGuardCache.get(c);
    if (has === undefined) {
      const text = readText(c, 400_000) || "";
      has = GUARD_RE.test(text);
      fileGuardCache.set(c, has);
    }
    if (has) {
      refs.push(rel(targetPath, c));
      return { has: true, refs };
    }
  }
  return { has: false, refs };
}

function pathMentionedInTest(text: string, path: string): boolean {
  const lower = text.toLowerCase();
  const p = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (lower.includes(p)) return true;
  // Last meaningful segment as a path fragment: '/chats' or "/chats"
  const tokens = pathTokens(path);
  const last = tokens[tokens.length - 1];
  if (!last || last.length < 4) return false;
  const re = new RegExp(`['"\`/]${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(['"\`/?\\s]|$)`, "i");
  return re.test(text);
}

function findDenialTestsForPath(
  path: string,
  testFiles: string[],
  targetPath: string,
  contentCache: Map<string, string>,
): string[] {
  const hits: string[] = [];

  for (const f of testFiles) {
    let text = contentCache.get(f);
    if (text === undefined) {
      text = readText(f, 400_000) || "";
      contentCache.set(f, text);
    }
    if (!text || !DENIAL_RE.test(text)) continue;
    if (!pathMentionedInTest(text, path)) continue;

    hits.push(rel(targetPath, f));
    if (hits.length >= 5) break;
  }
  return hits;
}

function normalizeAuthzPath(raw: string): string {
  let s = raw.trim();
  // Allow "METHOD /path" coverage entries.
  const methodPath = /^([A-Za-z]+)\s+(\S+)$/.exec(s);
  if (methodPath && methodPath[2].includes("/")) s = methodPath[2];
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch {
    /* keep s */
  }
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf("#");
  if (h >= 0) s = s.slice(0, h);
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s.toLowerCase();
}

/**
 * Exact route-path match only (after normalization). Substring / prefix
 * matches are too loose and can launder AUTHZ-M1 denial coverage.
 */
function importedCoversPath(
  path: string,
  covered: string[],
  method?: string,
): boolean {
  const p = normalizeAuthzPath(path);
  const wantMethod = (method || "").toUpperCase();
  return covered.some((c) => {
    const raw = c.trim();
    if (!raw) return false;
    const methodPath = /^([A-Za-z]+)\s+(\S+)$/.exec(raw);
    if (methodPath && methodPath[2].includes("/")) {
      const cm = methodPath[1].toUpperCase();
      const cp = normalizeAuthzPath(methodPath[2]);
      if (wantMethod && cm !== wantMethod) return false;
      return cp === p;
    }
    return normalizeAuthzPath(raw) === p;
  });
}

export function buildAuthzReport(
  ctx: CollectorContext,
  opts: {
    routes: ProbeRoute[];
    catalogSource: string[];
    codeGuards: { found: boolean; refs: string[] };
    testFiles: string[];
    importedCovered: string[];
    importedSources: string[];
    importedMeasuredAt: string | null;
    privilegedAiFeatureToolOrRetrievalEntryPointsPresent: boolean | null;
  },
): AuthzEntryReport {
  const fileGuardCache = new Map<string, boolean>();
  const contentCache = new Map<string, string>();
  const notes: string[] = [];

  // Prefer declared AI routes only — seed/OpenAPI hints must not invent entry
  // points (vacuous FAIL) or block explicit N/A attests.
  let ai = opts.routes.filter(
    (r) => r.aiSurface && !r.advisoryGet && r.declaredInCode,
  );

  // Dedupe by METHOD+path for scoring
  const seen = new Set<string>();
  const entryPoints: AuthzEntryPoint[] = [];

  for (const r of ai) {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const guard = routeHasGuard(ctx.targetPath, r, fileGuardCache);
    const testRefs = findDenialTestsForPath(
      r.path,
      opts.testFiles,
      ctx.targetPath,
      contentCache,
    );
    const coveredByImport = importedCoversPath(
      r.path,
      opts.importedCovered,
      r.method,
    );
    // In-repo denial tests win; otherwise require an exact imported path match.
    const denialFromImport = testRefs.length === 0 && coveredByImport;
    const hasDenialTest = testRefs.length > 0 || coveredByImport;

    // AUTHZ-M1: per-route server-side guard + unauthorized-caller denial coverage.
    // Global codeGuards.found is supporting evidence only — do not launder onto every route.
    const ok = guard.has && hasDenialTest;
    entryPoints.push({
      method: r.method,
      path: r.path,
      source: r.source,
      declaredInCode: Boolean(r.declaredInCode),
      hasServerGuard: guard.has,
      guardRefs: guard.refs,
      hasDenialTest,
      denialFromImport,
      testRefs: hasDenialTest
        ? testRefs.length
          ? testRefs
          : opts.importedSources.slice(0, 3)
        : [],
      ok,
    });
  }

  const withServerGuard = entryPoints.filter((e) => e.hasServerGuard).length;
  const withDenialTest = entryPoints.filter((e) => e.hasDenialTest).length;
  const pass = entryPoints.filter((e) => e.ok).length;
  const fail = entryPoints.length - pass;
  const coveragePct =
    entryPoints.length === 0
      ? 0
      : Math.round((withDenialTest / entryPoints.length) * 1000) / 10;

  if (!opts.codeGuards.found) {
    notes.push(
      "No server-side authz guard patterns found (get_verified_user / has_permission / …).",
    );
  } else {
    notes.push(
      `Server-side authz helpers present (e.g. ${opts.codeGuards.refs.slice(0, 3).join(", ")}); code alone does not satisfy AUTHZ-M1.`,
    );
  }

  if (opts.testFiles.length === 0 && opts.importedCovered.length === 0) {
    notes.push(
      "No automated authz suite matched (*test*/__tests__/*_test.py). AUTHZ-M1 requires authenticated-but-unauthorized callers denied on privileged AI entry points.",
    );
  } else if (fail > 0) {
    notes.push(
      `${fail}/${entryPoints.length} AI entry point(s) lack server-side authz guard and/or unauthorized-caller denial coverage.`,
    );
  }

  if (opts.importedSources.length) {
    notes.push(`Imported coverage from: ${opts.importedSources.join(", ")}`);
  }

  // Live in-repo denial tests are measured at assessment time. Any route that
  // relies solely on imported coveredPaths requires import measuredAt ≤90d —
  // do not keep assessment-time freshness when other routes are import-backed.
  const importBackedDenial = entryPoints.some((e) => e.denialFromImport);
  let measuredAt: string | null = ctx.assessedAt.toISOString();
  if (importBackedDenial) {
    measuredAt = opts.importedMeasuredAt;
    if (!opts.importedMeasuredAt) {
      notes.push(
        "Imported denial coverage lacks measuredAt — required to unlock AUTHZ-M1 PASS.",
      );
    }
  }

  const fresh = measuredAtFresh(
    measuredAt,
    ctx.assessedAt,
    IMPORT_MAX_AGE_DAYS,
  );

  let presentAttest = opts.privilegedAiFeatureToolOrRetrievalEntryPointsPresent;
  if (entryPoints.length > 0 && presentAttest === false) {
    notes.push(
      "Imported privilegedAiFeatureToolOrRetrievalEntryPointsPresent=false ignored — declared AI entry points prove the surface exists.",
    );
    presentAttest = true;
  }

  let statusHint: AuthzEntryReport["summary"]["statusHint"];
  let authzM1Satisfied: boolean | null = null;

  if (entryPoints.length === 0 && presentAttest === false) {
    statusHint = "not_applicable";
    authzM1Satisfied = null;
    notes.push(
      "Imported privilegedAiFeatureToolOrRetrievalEntryPointsPresent=false — AUTHZ-M1 NOT_APPLICABLE.",
    );
  } else if (entryPoints.length === 0) {
    statusHint = "not_demonstrated";
    authzM1Satisfied = null;
    notes.push(
      "No privileged AI feature/tool/retrieval entry points discovered — AUTHZ-M1 remains not demonstrated until entry points are found or an explicit N/A attest (privilegedAiFeatureToolOrRetrievalEntryPointsPresent=false) is imported.",
    );
  } else if (fail > 0) {
    statusHint = "fail";
    authzM1Satisfied = false;
  } else if (
    fail === 0 &&
    withDenialTest === entryPoints.length &&
    withServerGuard === entryPoints.length &&
    fresh
  ) {
    statusHint = "pass";
    authzM1Satisfied = true;
  } else {
    statusHint = "partial";
    authzM1Satisfied = false;
    if (!fresh) {
      notes.push(
        "Authz evidence measuredAt older than 90 days (or missing) — required to unlock AUTHZ-M1 PASS.",
      );
    }
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: ctx.assessedAt.toISOString(),
    measuredAt,
    catalogSource: opts.catalogSource,
    codeGuardsFound: opts.codeGuards.found,
    guardSampleRefs: opts.codeGuards.refs,
    privilegedAiFeatureToolOrRetrievalEntryPointsPresent: presentAttest,
    entryPoints,
    summary: {
      total: entryPoints.length,
      withServerGuard,
      withDenialTest,
      pass,
      fail,
      authzM1Satisfied,
      coveragePct,
      statusHint,
    },
    notes,
  };
}

export const authzEntryTestsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const { routes, sources } = discoverRoutes(ctx);
    const codeGuards = scanGuardsInRepo(ctx.targetPath, ctx.maxFiles ?? 4000);
    const testFiles = collectTestFiles(ctx.targetPath, ctx.maxFiles ?? 4000);
    const imported = loadImportedCoverage(ctx);

    const report = buildAuthzReport(ctx, {
      routes,
      catalogSource: sources,
      codeGuards,
      testFiles,
      importedCovered: imported.coveredPaths,
      importedSources: imported.sources,
      importedMeasuredAt: imported.measuredAt,
      privilegedAiFeatureToolOrRetrievalEntryPointsPresent:
        imported.privilegedAiFeatureToolOrRetrievalEntryPointsPresent,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "authz-entry-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/authz-entry-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              sampleGaps: report.entryPoints
                .filter((e) => !e.ok)
                .slice(0, 8)
                .map((e) => `${e.method} ${e.path}`),
            },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "authz-entry-tests",
          "authz-m1",
          `authz-m1-${report.summary.statusHint}`,
          ...(report.summary.authzM1Satisfied
            ? ["authz-m1-satisfied"]
            : ["authz-m1-fail-or-incomplete"]),
          ...(report.codeGuardsFound ? ["authz-guard"] : []),
          ...(report.summary.fail > 0 ? ["authz-test-gap"] : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    if (codeGuards.found) {
      nodes.push({
        id: `${PLUGIN_ID}:guards`,
        class: "code",
        ref: codeGuards.refs[0] || "authz-guards",
        excerpt: redact(
          `Authz guard refs: ${codeGuards.refs.slice(0, 8).join(", ")}`.slice(
            0,
            400,
          ),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: ["authz-guard", "authz-m1"],
        relatedCheckIds: [...RELATED],
      });
    }

    const detail = `AUTHZ-M1 status=${report.summary.statusHint} entryPoints=${report.summary.total} denialTests=${report.summary.withDenialTest} coverage=${report.summary.coveragePct}% satisfied=${report.summary.authzM1Satisfied}; report=imports/${PLUGIN_ID}/authz-entry-report.json`;

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail,
      nodes,
    };
  },
};
