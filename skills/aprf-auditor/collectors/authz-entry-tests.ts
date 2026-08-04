/**
 * authz-entry-tests — AUTHZ-M1 detector executor.
 *
 * Inventories privileged AI HTTP entry points, detects server-side authz guards
 * (admin / permission / access — not mere get_verified_user), scores denial-test
 * coverage, and optionally runs a live authenticated-but-unauthorized probe when
 * --base-url + limited/admin credentials are provided.
 *
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
import {
  deleteUserBestEffort,
  resolveBaseUrl,
  resolveLiveAdminToken,
  resolveLimitedUserToken,
} from "./lib/live-auth.ts";

const PLUGIN_ID = "authz-entry-tests";
const RELATED = ["AUTHZ-M1"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

/** Authn-only helpers — supporting evidence, not AUTHZ-M1 privilege gates. */
const AUTHN_GUARD_RE =
  /\b(get_verified_user|get_current_user|get_current_user_by_api_key|Depends\s*\(\s*get_verified_user|Depends\s*\(\s*get_current_user)/;

/** True server-side authorization (permission / admin / access). */
const AUTHZ_GUARD_RE =
  /\b(get_admin_user|has_permission|has_access|has_connection_access|has_folder_access|has_access_to_file|require_permission|Depends\s*\(\s*get_admin_user)/;

const DENIAL_RE =
  /\b(401|403|unauthorized|forbidden|HTTP_401|HTTP_403|status_code\s*=\s*40[13]|toBe\(\s*40[13]\s*\)|assert.*40[13])/i;

const TEST_FILE_RE =
  /(^|[/\\])(tests?|__tests__|spec)([/\\]|$)|[._-](test|spec)\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;

const EXPECT_DENIAL = new Set([401, 403]);

export interface AuthzEntryPoint {
  method: string;
  path: string;
  source: string;
  declaredInCode: boolean;
  /** True authz guard (admin/permission/access) on the route source. */
  hasServerGuard: boolean;
  /** Authn helper present (get_verified_user) — not sufficient alone for AUTHZ-M1. */
  hasAuthnGuard: boolean;
  guardKind: "authz" | "authn" | "none";
  guardRefs: string[];
  hasDenialTest: boolean;
  /** true when denial coverage for this route comes only from imported coveredPaths */
  denialFromImport: boolean;
  /** true when denial coverage comes from a live limited-user probe */
  denialFromLive: boolean;
  liveStatus?: number | null;
  liveError?: string;
  testRefs: string[];
  ok: boolean;
}

export interface AuthzLiveProbeMeta {
  baseUrl: string;
  via: "token" | "password" | "admin-create" | "none";
  probed: number;
  denied: number;
  bypass: number;
  errors: number;
  error?: string;
}

export interface AuthzEntryReport {
  schemaVersion: "0.3.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  measuredAt: string | null;
  catalogSource: string[];
  codeGuardsFound: boolean;
  authzGuardsFound: boolean;
  guardSampleRefs: string[];
  privilegedAiFeatureToolOrRetrievalEntryPointsPresent: boolean | null;
  /** Authn-only AI routes discovered but not scored as privileged AUTHZ-M1 surfaces. */
  authnOnlyAiEntryPointCount: number;
  entryPoints: AuthzEntryPoint[];
  liveProbe: AuthzLiveProbeMeta | null;
  summary: {
    total: number;
    withServerGuard: number;
    withDenialTest: number;
    pass: number;
    fail: number;
    /** true iff every privileged AI entry point has guard+denial coverage, suite non-empty, measuredAt fresh. */
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
  /** Typed gaps surfaced as "Evidence still required" in REPORT.html */
  gapNotes: string[];
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
        ...((
          data.entryPoints as Array<{
            path?: string;
            method?: string;
            hasDenialTest?: boolean;
          }>
        ) || [])
          .filter((e) => e.hasDenialTest && e.path)
          .map((e) =>
            e.method
              ? `${String(e.method).toUpperCase()} ${e.path}`
              : (e.path as string),
          ),
      ];
      if (Array.isArray(data.tests)) {
        for (const t of data.tests as Array<{
          path?: string;
          url?: string;
          method?: string;
        }>) {
          const p = t.path || t.url;
          if (!p) continue;
          paths.push(
            t.method ? `${String(t.method).toUpperCase()} ${p}` : p,
          );
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
): { found: boolean; authzFound: boolean; refs: string[]; authzRefs: string[] } {
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".js"],
  });
  const refs: string[] = [];
  const authzRefs: string[] = [];
  for (const f of files) {
    const text = readText(f, 200_000);
    if (!text) continue;
    const hasAuthz = AUTHZ_GUARD_RE.test(text);
    const hasAuthn = AUTHN_GUARD_RE.test(text);
    if (!hasAuthz && !hasAuthn) continue;
    const r = rel(targetPath, f);
    if (hasAuthz) {
      authzRefs.push(r);
      if (authzRefs.length <= 12) refs.push(r);
    } else if (refs.length < 12) {
      refs.push(r);
    }
    if (authzRefs.length >= 12 && refs.length >= 12) break;
  }
  return {
    found: refs.length > 0,
    authzFound: authzRefs.length > 0,
    refs: authzRefs.length ? authzRefs.slice(0, 12) : refs.slice(0, 12),
    authzRefs: authzRefs.slice(0, 12),
  };
}

type GuardHit = {
  hasAuthz: boolean;
  hasAuthn: boolean;
  refs: string[];
};

type HandlerGuard = {
  method: string;
  /** Decorator path, normalized (e.g. /list/user/{user_id}) */
  decoratorPath: string;
  hasAuthz: boolean;
  hasAuthn: boolean;
};

/**
 * Parse FastAPI @router.METHOD('path') handlers and classify Depends() on the
 * bound function signature. Stacked decorators (multiple @router on one def)
 * share that def's Depends — windows never bleed into the next function.
 */
function parseHandlerGuards(text: string): HandlerGuard[] {
  const out: HandlerGuard[] = [];
  const re =
    /@router\.(get|post|put|patch|delete|head|options)\s*\(\s*['"]([^'"]*)['"]/gi;
  const starts: Array<{ index: number; method: string; path: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let decoratorPath = m[2] || "/";
    if (!decoratorPath.startsWith("/")) decoratorPath = `/${decoratorPath}`;
    if (decoratorPath.length > 1 && decoratorPath.endsWith("/")) {
      decoratorPath = decoratorPath.slice(0, -1);
    }
    starts.push({
      index: m.index,
      method: m[1].toUpperCase(),
      path: decoratorPath,
    });
  }

  const defRe = /(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/g;
  const defs: number[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = defRe.exec(text)) !== null) defs.push(dm.index);

  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i]!;
    const defIdx = defs.find((d) => d >= cur.index);
    let window: string;
    if (defIdx !== undefined) {
      // Signature + small body; stop before the next top-level def when possible.
      const nextDef = defs.find((d) => d > defIdx) ?? text.length;
      const sigEnd = Math.min(defIdx + 900, nextDef);
      window = text.slice(cur.index, sigEnd);
    } else {
      const end = starts[i + 1]?.index ?? Math.min(text.length, cur.index + 800);
      window = text.slice(cur.index, end);
    }
    out.push({
      method: cur.method,
      decoratorPath: cur.path,
      hasAuthz: AUTHZ_GUARD_RE.test(window),
      hasAuthn: AUTHN_GUARD_RE.test(window),
    });
  }
  return out;
}

/** True when `full` equals `dec` or ends with `dec` on a path-segment boundary. */
function pathEndsWithDecorator(full: string, dec: string): boolean {
  if (dec === "/" || dec === "") return false;
  if (full === dec) return true;
  if (!full.endsWith(dec)) return false;
  const idx = full.length - dec.length;
  if (idx === 0) return true;
  // Decorator paths usually start with `/` (e.g. `/config` on `/api/v1/chats/config`);
  // that leading slash is the segment boundary.
  if (dec.startsWith("/")) return true;
  return full[idx - 1] === "/";
}

/**
 * Pick the best @router handler for a discovered route. Prefer the longest
 * non-root decorator suffix; fall back to `@router.METHOD('/')` for mount roots
 * like prefix `/api/v1/chats` + decorator `/`.
 */
function findHandlerForRoute(
  handlers: HandlerGuard[],
  route: ProbeRoute,
): HandlerGuard | undefined {
  const method = route.method.toUpperCase();
  const full = normalizeAuthzPath(route.path);
  const candidates = handlers.filter((h) => h.method === method);
  if (!candidates.length) return undefined;

  let best: HandlerGuard | undefined;
  let bestLen = -1;
  for (const h of candidates) {
    const dec = normalizeAuthzPath(h.decoratorPath);
    if (dec === "/") continue;
    if (pathEndsWithDecorator(full, dec) && dec.length > bestLen) {
      best = h;
      bestLen = dec.length;
    }
  }
  if (best) return best;
  return candidates.find((h) => normalizeAuthzPath(h.decoratorPath) === "/");
}

type FileGuardIndex = {
  fileAuthz: boolean;
  fileAuthn: boolean;
  handlers: HandlerGuard[];
};

/** Map route → per-handler authz/authn when possible; else file-level fallback. */
function routeHasGuard(
  targetPath: string,
  route: ProbeRoute,
  fileGuardCache: Map<string, FileGuardIndex>,
): GuardHit {
  const refs: string[] = [];
  const src = route.source.split(":")[0] || "";
  const candidates = [
    join(targetPath, src),
    src.startsWith("/") ? src : "",
  ].filter(Boolean);

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
    let cached = fileGuardCache.get(c);
    if (cached === undefined) {
      const text = readText(c, 400_000) || "";
      cached = {
        fileAuthz: AUTHZ_GUARD_RE.test(text),
        fileAuthn: AUTHN_GUARD_RE.test(text),
        handlers: parseHandlerGuards(text),
      };
      fileGuardCache.set(c, cached);
    }
    const matched = findHandlerForRoute(cached.handlers, route);
    if (matched) {
      refs.push(rel(targetPath, c));
      return {
        hasAuthz: matched.hasAuthz,
        hasAuthn: matched.hasAuthn,
        refs,
      };
    }
    // No handler match — fall back to file-level only when a single kind exists.
    if (cached.fileAuthz || cached.fileAuthn) {
      refs.push(rel(targetPath, c));
      // Mixed files: do not launder file-level authz onto unmatched handlers.
      if (cached.handlers.length > 0) {
        return {
          hasAuthz: false,
          hasAuthn: cached.fileAuthn && !cached.fileAuthz ? true : cached.fileAuthn,
          refs,
        };
      }
      return {
        hasAuthz: cached.fileAuthz,
        hasAuthn: cached.fileAuthn,
        refs,
      };
    }
  }
  return { hasAuthz: false, hasAuthn: false, refs };
}

function pathMentionedInTest(text: string, path: string): boolean {
  const lower = text.toLowerCase();
  const p = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (lower.includes(p)) return true;
  const tokens = pathTokens(path);
  const last = tokens[tokens.length - 1];
  if (!last || last.length < 4) return false;
  const re = new RegExp(
    `['"\`/]${last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(['"\`/?\\s]|$)`,
    "i",
  );
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
    if (wantMethod) return false;
    return normalizeAuthzPath(raw) === p;
  });
}

/**
 * Score declared AI routes and code-discovered include_router prefix
 * fallbacks. Builtin seed / import-invented surfaces are excluded.
 */
function isScoredAiRoute(r: ProbeRoute): boolean {
  if (!r.aiSurface || r.advisoryGet) return false;
  if (r.declaredInCode) return true;
  const src = (r.source || "").toLowerCase();
  if (!src || src.includes("builtin") || src.startsWith("imports/")) {
    return false;
  }
  return /\.(py|ts|tsx|js|jsx)(:|$)/.test(src) || /(?:^|\/)main\./.test(src);
}

async function probeOneWithToken(
  baseUrl: string,
  method: string,
  path: string,
  token: string,
  timeoutMs: number,
): Promise<{ status: number | null; error?: string; latencyMs: number }> {
  const url = new URL(
    path.startsWith("/") ? path.slice(1) : path,
    baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
  ).toString();
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "aprf-auditor-authz-entry-tests/0.3",
        ...(method === "POST" || method === "PUT" || method === "PATCH"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        method === "POST" || method === "PUT" || method === "PATCH"
          ? "{}"
          : undefined,
    });
    return { status: res.status, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: null,
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export type LiveDenialMap = Map<
  string,
  { status: number | null; denied: boolean; error?: string }
>;

export async function runLiveAuthzDenialProbe(
  ctx: CollectorContext,
  baseUrl: string,
  privilegedRoutes: Array<{ method: string; path: string }>,
): Promise<{
  denials: LiveDenialMap;
  meta: AuthzLiveProbeMeta;
  cleanup?: () => Promise<void>;
}> {
  const timeoutMs = Number(process.env.APRF_AUTHZ_PROBE_TIMEOUT_MS ?? 8000);
  const concurrency = Math.max(
    1,
    Math.min(6, Number(process.env.APRF_AUTHZ_PROBE_CONCURRENCY ?? 4)),
  );
  const limited = await resolveLimitedUserToken(ctx, baseUrl);
  if (!limited.token) {
    return {
      denials: new Map(),
      meta: {
        baseUrl,
        via: limited.via,
        probed: 0,
        denied: 0,
        bypass: 0,
        errors: 0,
        error: limited.error,
      },
    };
  }

  const denials: LiveDenialMap = new Map();
  const queue = [...privilegedRoutes];
  let denied = 0;
  let bypass = 0;
  let errors = 0;

  async function worker() {
    while (queue.length) {
      const route = queue.shift();
      if (!route) return;
      const key = `${route.method} ${route.path}`;
      const row = await probeOneWithToken(
        baseUrl,
        route.method,
        route.path,
        limited.token!,
        timeoutMs,
      );
      if (row.error || row.status === null) {
        errors += 1;
        denials.set(key, {
          status: row.status,
          denied: false,
          error: row.error || "no status",
        });
        continue;
      }
      const isDenied = EXPECT_DENIAL.has(row.status);
      if (isDenied) denied += 1;
      else if (row.status >= 200 && row.status < 400) bypass += 1;
      else errors += 1;
      denials.set(key, { status: row.status, denied: isDenied });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  let cleanup: (() => Promise<void>) | undefined;
  if (limited.via === "admin-create" && limited.createdUserId) {
    const admin = await resolveLiveAdminToken(ctx, baseUrl);
    const userId = limited.createdUserId;
    cleanup = async () => {
      if (admin.token) {
        await deleteUserBestEffort(baseUrl, admin.token, userId);
      }
    };
  }

  return {
    denials,
    meta: {
      baseUrl,
      via: limited.via,
      probed: privilegedRoutes.length,
      denied,
      bypass,
      errors,
    },
    cleanup,
  };
}

export function buildAuthzReport(
  ctx: CollectorContext,
  opts: {
    routes: ProbeRoute[];
    catalogSource: string[];
    codeGuards: {
      found: boolean;
      authzFound: boolean;
      refs: string[];
      authzRefs: string[];
    };
    testFiles: string[];
    importedCovered: string[];
    importedSources: string[];
    importedMeasuredAt: string | null;
    privilegedAiFeatureToolOrRetrievalEntryPointsPresent: boolean | null;
    liveDenials?: LiveDenialMap;
    liveMeta?: AuthzLiveProbeMeta | null;
  },
): AuthzEntryReport {
  const fileGuardCache = new Map<string, FileGuardIndex>();
  const contentCache = new Map<string, string>();
  const notes: string[] = [];
  const gapNotes: string[] = [];

  const ai = opts.routes.filter(isScoredAiRoute);

  const seen = new Set<string>();
  const allClassified: AuthzEntryPoint[] = [];

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
    const live = opts.liveDenials?.get(key);
    const denialFromLive = Boolean(live?.denied);
    const denialFromImport =
      testRefs.length === 0 && !denialFromLive && coveredByImport;
    const hasDenialTest =
      testRefs.length > 0 || coveredByImport || denialFromLive;

    const guardKind: AuthzEntryPoint["guardKind"] = guard.hasAuthz
      ? "authz"
      : guard.hasAuthn
        ? "authn"
        : "none";
    const hasServerGuard = guard.hasAuthz;

    // Guard + denial coverage; live 2xx for a limited user is an authz bypass.
    const liveBypass =
      live != null &&
      live.status != null &&
      live.status >= 200 &&
      live.status < 400;
    const finalOk = hasServerGuard && hasDenialTest && !liveBypass;

    allClassified.push({
      method: r.method,
      path: r.path,
      source: r.source,
      declaredInCode: Boolean(r.declaredInCode),
      hasServerGuard,
      hasAuthnGuard: guard.hasAuthn,
      guardKind,
      guardRefs: guard.refs,
      hasDenialTest,
      denialFromImport,
      denialFromLive,
      liveStatus: live?.status,
      liveError: live?.error,
      testRefs: hasDenialTest
        ? testRefs.length
          ? testRefs
          : denialFromLive
            ? [`live-probe:${opts.liveMeta?.baseUrl ?? "base-url"}`]
            : opts.importedSources.slice(0, 3)
        : [],
      ok: finalOk,
    });
  }

  // Privileged = authz-gated AI surfaces. Authn-only AI routes are inventory
  // context (AUTHN-M1) and are not AUTHZ-M1 passCondition subjects.
  const entryPoints = allClassified.filter((e) => e.guardKind === "authz");
  const authnOnlyAiEntryPointCount = allClassified.filter(
    (e) => e.guardKind === "authn",
  ).length;
  const unguardedAi = allClassified.filter((e) => e.guardKind === "none");

  const withServerGuard = entryPoints.filter((e) => e.hasServerGuard).length;
  const withDenialTest = entryPoints.filter((e) => e.hasDenialTest).length;
  const pass = entryPoints.filter((e) => e.ok).length;
  const fail = entryPoints.length - pass;
  const coveragePct =
    entryPoints.length === 0
      ? 0
      : Math.round((withDenialTest / entryPoints.length) * 1000) / 10;

  if (opts.codeGuards.authzFound) {
    notes.push(
      `Server-side authz helpers present (e.g. ${opts.codeGuards.authzRefs.slice(0, 3).join(", ")}); code alone does not satisfy AUTHZ-M1 without unauthorized-caller denial coverage.`,
    );
  } else if (opts.codeGuards.found) {
    notes.push(
      "Authn helpers (get_verified_user / …) found, but no authz helpers (get_admin_user / has_permission / has_access). AUTHZ-M1 scores privilege-gated surfaces.",
    );
  } else {
    notes.push(
      "No server-side authz guard patterns found (get_admin_user / has_permission / has_access / …).",
    );
  }

  if (authnOnlyAiEntryPointCount > 0) {
    notes.push(
      `${authnOnlyAiEntryPointCount} AI route(s) use authn-only guards (get_verified_user) — inventoried but not scored as privileged AUTHZ-M1 entry points (see AUTHN-M1 for unauthenticated rejection).`,
    );
  }
  if (unguardedAi.length > 0) {
    notes.push(
      `${unguardedAi.length} AI route(s) have no authn/authz guard patterns in resolvable source files.`,
    );
  }

  if (opts.liveMeta) {
    if (opts.liveMeta.error && opts.liveMeta.probed === 0) {
      notes.push(`Live authz probe skipped: ${opts.liveMeta.error}`);
    } else {
      notes.push(
        `Live limited-user probe via=${opts.liveMeta.via} probed=${opts.liveMeta.probed} denied=${opts.liveMeta.denied} bypass=${opts.liveMeta.bypass} errors=${opts.liveMeta.errors}`,
      );
    }
  }

  if (
    opts.testFiles.length === 0 &&
    opts.importedCovered.length === 0 &&
    !(opts.liveMeta && opts.liveMeta.denied > 0)
  ) {
    notes.push(
      "No automated authz suite matched (*test*/__tests__) and no live limited-user denial probe succeeded. AUTHZ-M1 requires authenticated-but-unauthorized callers denied on privileged AI entry points.",
    );
  } else if (fail > 0) {
    notes.push(
      `${fail}/${entryPoints.length} privileged AI entry point(s) lack server-side authz guard and/or unauthorized-caller denial coverage.`,
    );
  }

  if (opts.importedSources.length) {
    notes.push(`Imported coverage from: ${opts.importedSources.join(", ")}`);
  }

  const importBackedDenial = entryPoints.some((e) => e.denialFromImport);
  const liveBackedDenial = entryPoints.some((e) => e.denialFromLive);
  let measuredAt: string | null = ctx.assessedAt.toISOString();
  if (importBackedDenial && !liveBackedDenial) {
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
      "Imported privilegedAiFeatureToolOrRetrievalEntryPointsPresent=false ignored — discovered privileged AI entry points prove the surface exists.",
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
    // AI surfaces may exist with only authn guards — not a vacuous PASS.
    if (authnOnlyAiEntryPointCount > 0) {
      statusHint = "partial";
      authzM1Satisfied = false;
      gapNotes.push(
        "AI feature/tool/retrieval routes found with authn-only guards — add permission/scope checks (get_admin_user / has_permission / …) on privileged surfaces, or attest privilegedAiFeatureToolOrRetrievalEntryPointsPresent=false if none exist.",
      );
    } else {
      statusHint = "not_demonstrated";
      authzM1Satisfied = null;
      gapNotes.push(
        "No privileged AI feature/tool/retrieval entry points discovered — find entry points with server-side authz guards, provide --base-url for live probe, or import privilegedAiFeatureToolOrRetrievalEntryPointsPresent=false for NOT_APPLICABLE.",
      );
    }
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

  // Typed gaps — only what is still missing (drives REPORT "Evidence still required").
  if (statusHint !== "pass" && statusHint !== "not_applicable") {
    if (entryPoints.length === 0 && gapNotes.length === 0) {
      gapNotes.push(
        "Inventory of privileged AI feature, tool, and retrieval entry points — none discovered with authz guards",
      );
    }
    if (entryPoints.length > 0 && withServerGuard < entryPoints.length) {
      gapNotes.push(
        `Server-side authz middleware/policy missing on ${entryPoints.length - withServerGuard}/${entryPoints.length} privileged AI entry point(s)`,
      );
    }
    if (entryPoints.length > 0 && withDenialTest < entryPoints.length) {
      gapNotes.push(
        `Authz suite / live limited-user denial missing on ${entryPoints.length - withDenialTest}/${entryPoints.length} privileged entry point(s) (measuredAt ≤90 days). Re-run with --base-url + admin or limited-user credentials, add denial tests, or import coverage under imports/authz-entry-tests/`,
      );
    }
    const liveBypasses = entryPoints.filter(
      (e) =>
        e.liveStatus != null && e.liveStatus >= 200 && e.liveStatus < 400,
    );
    if (liveBypasses.length) {
      gapNotes.push(
        `Live probe: ${liveBypasses.length} privileged route(s) returned 2xx for an authenticated limited user (authz bypass)`,
      );
    }
    if (!fresh && entryPoints.length > 0 && fail === 0) {
      gapNotes.push(
        "Authz denial evidence measuredAt older than 90 days (or missing)",
      );
    }
    if (
      !opts.liveMeta &&
      withDenialTest < entryPoints.length &&
      resolveBaseUrl(ctx) == null
    ) {
      gapNotes.push(
        "Optional: provide --base-url with --admin-email/--admin-password (or APRF_AUTHZ_LIMITED_EMAIL/PASSWORD) to live-probe authenticated-but-unauthorized denial",
      );
    }
  }

  return {
    schemaVersion: "0.3.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: ctx.assessedAt.toISOString(),
    measuredAt,
    catalogSource: opts.catalogSource,
    codeGuardsFound: opts.codeGuards.authzFound || opts.codeGuards.found,
    authzGuardsFound: opts.codeGuards.authzFound,
    guardSampleRefs: opts.codeGuards.refs,
    privilegedAiFeatureToolOrRetrievalEntryPointsPresent:
      presentAttest ?? (entryPoints.length > 0 ? true : null),
    authnOnlyAiEntryPointCount,
    entryPoints,
    liveProbe: opts.liveMeta ?? null,
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
    gapNotes: gapNotes.slice(0, 8),
  };
}

/** Compact JSON summary that stays valid after assess excerpt truncation. */
function reportExcerptJson(report: AuthzEntryReport): string {
  return JSON.stringify(
    {
      summary: report.summary,
      liveProbe: report.liveProbe
        ? {
            via: report.liveProbe.via,
            probed: report.liveProbe.probed,
            denied: report.liveProbe.denied,
            bypass: report.liveProbe.bypass,
            errors: report.liveProbe.errors,
            ...(report.liveProbe.error
              ? { error: report.liveProbe.error.slice(0, 120) }
              : {}),
          }
        : null,
      authnOnlyAiEntryPointCount: report.authnOnlyAiEntryPointCount,
      gapNotes: report.gapNotes.slice(0, 4),
      sampleGaps: report.entryPoints
        .filter((e) => !e.ok)
        .slice(0, 6)
        .map((e) => `${e.method} ${e.path}`),
    },
    null,
    2,
  );
}

export const authzEntryTestsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const { routes, sources } = discoverRoutes(ctx);
    const codeGuards = scanGuardsInRepo(ctx.targetPath, ctx.maxFiles ?? 4000);
    const testFiles = collectTestFiles(ctx.targetPath, ctx.maxFiles ?? 4000);
    const imported = loadImportedCoverage(ctx);

    // Pre-classify privileged routes for optional live probe.
    const fileGuardCache = new Map<string, FileGuardIndex>();
    const privilegedForLive: Array<{ method: string; path: string }> = [];
    const seenLive = new Set<string>();
    for (const r of routes.filter(isScoredAiRoute)) {
      const key = `${r.method} ${r.path}`;
      if (seenLive.has(key)) continue;
      seenLive.add(key);
      const g = routeHasGuard(ctx.targetPath, r, fileGuardCache);
      if (g.hasAuthz) privilegedForLive.push({ method: r.method, path: r.path });
    }

    let liveDenials: LiveDenialMap | undefined;
    let liveMeta: AuthzLiveProbeMeta | null = null;
    let cleanup: (() => Promise<void>) | undefined;
    const baseUrl = resolveBaseUrl(ctx);
    if (baseUrl && privilegedForLive.length > 0) {
      try {
        const live = await runLiveAuthzDenialProbe(
          ctx,
          baseUrl,
          privilegedForLive,
        );
        liveDenials = live.denials;
        liveMeta = live.meta;
        cleanup = live.cleanup;
      } catch (err) {
        liveMeta = {
          baseUrl,
          via: "none",
          probed: 0,
          denied: 0,
          bypass: 0,
          errors: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

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
      liveDenials,
      liveMeta,
    });

    if (cleanup) {
      await cleanup().catch(() => undefined);
    }

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "authz-entry-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    // Do not run through redact() — it collapses whitespace and caps at 200 chars,
    // which breaks REPORT.html JSON pretty-print. Summary is collector-authored.
    const excerpt = reportExcerptJson(report);

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: liveMeta && liveMeta.probed > 0 ? "runtime" : "code",
        ref: `imports/${PLUGIN_ID}/authz-entry-report.json`,
        excerpt,
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
          ...(report.authzGuardsFound ? ["authz-guard"] : []),
          ...(report.summary.fail > 0 ? ["authz-test-gap"] : []),
          ...(liveMeta && liveMeta.denied > 0 ? ["authz-live-probe"] : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    if (report.entryPoints.length > 0) {
      nodes.push({
        id: `${PLUGIN_ID}:inventory`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/authz-entry-report.json#entryPoints`,
        excerpt: JSON.stringify(
          {
            privilegedEntryPoints: report.summary.total,
            authnOnlyAiEntryPoints: report.authnOnlyAiEntryPointCount,
            sample: report.entryPoints
              .slice(0, 8)
              .map((e) => `${e.method} ${e.path} [${e.guardKind}]`),
          },
          null,
          2,
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: ["authz-inventory", "authz-m1"],
        relatedCheckIds: [...RELATED],
      });
    }

    if (codeGuards.authzFound) {
      nodes.push({
        id: `${PLUGIN_ID}:guards`,
        class: "code",
        ref: codeGuards.authzRefs[0] || codeGuards.refs[0] || "authz-guards",
        excerpt: redact(
          `Authz guard refs: ${codeGuards.authzRefs.slice(0, 8).join(", ")}`.slice(
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

    const detail = `AUTHZ-M1 status=${report.summary.statusHint} privileged=${report.summary.total} denialTests=${report.summary.withDenialTest} coverage=${report.summary.coveragePct}% satisfied=${report.summary.authzM1Satisfied}${liveMeta ? ` liveDenied=${liveMeta.denied}/${liveMeta.probed}` : ""}; report=imports/${PLUGIN_ID}/authz-entry-report.json`;

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail,
      nodes,
    };
  },
};
