/**
 * http-auth-probe — AUTHN-M1 detector executor.
 *
 * Discovers AI HTTP routes from the target repo (FastAPI prefixes, OpenAPI files,
 * or imports/http-auth-probe/routes.json). When a base URL is provided
 * (--base-url / APRF_AUTH_PROBE_BASE_URL), probes each route without credentials
 * and writes auth-probe-report.json (runtime evidence).
 *
 * Without a base URL: emits a route-catalog node and returns needs-user.
 */
import { createServer } from "node:http";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ageDays,
  ensureDir,
  listImportFiles,
  matchAny,
  mtimeDate,
  mtimeIso,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "http-auth-probe";
const RELATED = ["AUTHN-M1"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

/** Status codes that satisfy AUTHN-M1 for a protected AI route. */
const EXPECT_STATUS = new Set([401, 403]);

/** Paths that are allowed to be reachable without auth (not scored as AI APIs). */
const DEFAULT_PUBLIC_PATTERNS = [
  /^\/$/,
  /^\/health/i,
  /^\/ready/i,
  /^\/live/i,
  /^\/favicon/i,
  /^\/static\//i,
  /^\/assets\//i,
  /^\/_app\//i,
  /^\/docs/i,
  /^\/redoc/i,
  /^\/openapi\.json$/i,
  /^\/swagger/i,
  /^\/api\/v1\/auths\/(signin|signup|ldap|signout)/i,
  /^\/api\/v1\/auths\/oauth\//i,
  /^\/oauth\//i,
  /^\/manifest/i,
  /^\/robots\.txt$/i,
];

/** Prefixes treated as customer-facing AI / privileged API surfaces. */
const AI_PREFIX_HINTS = [
  "/api/v1/chats",
  "/api/v1/chat",
  "/api/v1/completions",
  "/api/v1/models",
  "/api/v1/knowledge",
  "/api/v1/retrieval",
  "/api/v1/memories",
  "/api/v1/tools",
  "/api/v1/skills",
  "/api/v1/functions",
  "/api/v1/pipelines",
  "/api/v1/tasks",
  "/api/v1/images",
  "/api/v1/audio",
  "/api/v1/prompts",
  "/api/v1/evaluations",
  "/api/v1/analytics",
  "/api/v1/terminals",
  "/api/v1/automations",
  "/api/v1/files",
  "/api/v1/configs",
  "/api/v1/users",
  "/api/v1/groups",
  "/api/v1/channels",
  "/api/v1/notes",
  "/api/v1/folders",
  "/api/v1/notifications",
  "/api/chat",
  "/v1/chat",
  "/v1/completions",
  "/ollama",
  "/openai",
  "/mcp",
];

export interface ProbeRoute {
  method: string;
  path: string;
  source: string;
  aiSurface: boolean;
  /** True when method+path came from @router.get/post/… (or OpenAPI / routes.json). */
  declaredInCode?: boolean;
  /**
   * Extra GET probe on a path that has no declared GET.
   * 405 → advisory note only (does not fail AUTHN-M1);
   * 401/403 → ok; 2xx → fail.
   */
  advisoryGet?: boolean;
}

export interface ProbeResultRow {
  method: string;
  path: string;
  url: string;
  status: number | null;
  /** Scored outcome for AUTHN-M1 (null = not scored / advisory-only). */
  ok: boolean | null;
  skipped?: boolean;
  skipReason?: string;
  advisoryGet?: boolean;
  declaredInCode?: boolean;
  note?: string;
  latencyMs?: number;
  error?: string;
  source: string;
}

export interface AuthProbeReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  probedAt: string;
  /** Alias of probedAt for hybrid measuredAt ≤90d checks. */
  measuredAt: string;
  baseUrl: string | null;
  expectStatus: number[];
  catalogSource: string[];
  routesDiscovered: number;
  routesProbed: number;
  importedScope: {
    customerFacingAiHttpApisPresent: boolean | null;
  };
  summary: {
    pass: number;
    fail: number;
    skipped: number;
    errors: number;
    advisoryGet405: number;
    probeInventoryMatchesRouteCatalog: boolean | null;
    /** true iff every scored declared route returned 401/403, catalog matched, and measuredAt fresh */
    authnM1Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  /** Soft recommendations (e.g. GET returned 405 — should also return 401/403). */
  notes: string[];
  results: ProbeResultRow[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function isPublicPath(path: string): boolean {
  const p = path.split("?")[0] || path;
  return DEFAULT_PUBLIC_PATTERNS.some((re) => re.test(p));
}

function isAiSurface(path: string): boolean {
  const p = (path.split("?")[0] || path).toLowerCase();
  if (isPublicPath(p)) return false;
  return AI_PREFIX_HINTS.some(
    (prefix) => p === prefix || p.startsWith(prefix + "/") || p.startsWith(prefix),
  );
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  // Strip FastAPI path params to a probeable stub
  return path.replace(/\{[^}]+\}/g, "probe").replace(/:([A-Za-z_][\w]*)/g, "probe");
}

function joinUrlPath(prefix: string, sub: string): string {
  const p = prefix.replace(/\/$/, "") || "";
  if (!sub || sub === "/") return normalizePath(p || "/");
  const s = sub.startsWith("/") ? sub : `/${sub}`;
  return normalizePath(`${p}${s}`);
}

function dedupeRoutes(routes: ProbeRoute[]): ProbeRoute[] {
  const seen = new Map<string, ProbeRoute>();
  for (const r of routes) {
    const method = r.method.toUpperCase();
    const path = normalizePath(r.path);
    const key = `${method} ${path}`;
    const next: ProbeRoute = {
      method,
      path,
      source: r.source,
      aiSurface: r.aiSurface ?? isAiSurface(path),
      declaredInCode: r.declaredInCode ?? false,
      advisoryGet: r.advisoryGet ?? false,
    };
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, next);
      continue;
    }
    // Prefer declared code routes over advisory / seeds
    if (next.declaredInCode && !prev.declaredInCode) seen.set(key, next);
    else if (next.declaredInCode === prev.declaredInCode && !next.advisoryGet) {
      seen.set(key, { ...prev, ...next, advisoryGet: false });
    }
  }
  return [...seen.values()];
}

function findRouterFile(
  targetPath: string,
  moduleName: string,
  pyFiles: string[],
): string | undefined {
  const needle = `${moduleName}.py`.toLowerCase();
  const hits = pyFiles.filter((f) => {
    const r = rel(targetPath, f).toLowerCase();
    return r.endsWith(`/${needle}`) || r === needle || r.endsWith(`\\${needle}`);
  });
  // Prefer routers/ paths
  hits.sort((a, b) => {
    const ar = rel(targetPath, a);
    const br = rel(targetPath, b);
    const as = /routers\//.test(ar) ? 0 : 1;
    const bs = /routers\//.test(br) ? 0 : 1;
    return as - bs || ar.localeCompare(br);
  });
  return hits[0];
}

function parseRouterDecorators(
  fileText: string,
  source: string,
  prefix: string,
): ProbeRoute[] {
  const routes: ProbeRoute[] = [];
  const decoRe =
    /@(?:router|app)\.(get|post|put|patch|delete|head|options)\(\s*['"]([^'"]*)['"]/gi;
  let m: RegExpExecArray | null;
  while ((m = decoRe.exec(fileText))) {
    const method = m[1].toUpperCase();
    const full = joinUrlPath(prefix, m[2] || "/");
    if (isPublicPath(full) && !isAiSurface(full)) continue;
    routes.push({
      method,
      path: full,
      source,
      aiSurface: isAiSurface(full) || isAiSurface(prefix),
      declaredInCode: true,
    });
  }
  return routes;
}

/**
 * FastAPI discovery: include_router → module → @router.METHOD paths.
 * Falls back to GET+POST on prefix when decorators are not found.
 * Adds advisory GET when a path has declared non-GET methods only.
 */
function discoverFastapiRoutes(
  targetPath: string,
  maxFiles: number,
): {
  routes: ProbeRoute[];
  declaredAiRoutesTruncated: boolean;
  declaredAiRouteTotal: number;
} {
  const routes: ProbeRoute[] = [];
  const includeRe =
    /include_router\s*\(\s*([A-Za-z_][\w.]*)\.router\s*,\s*prefix\s*=\s*['"]([^'"]+)['"]/g;

  const preferred = [
    "backend/open_webui/main.py",
    "backend/main.py",
    "app/main.py",
    "src/main.py",
    "main.py",
    "server.py",
    "app.py",
  ].map((p) => join(targetPath, p));

  const pyFiles = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 8000),
    extensions: [".py"],
  });
  const mainFiles = [
    ...preferred.filter((f) => existsSync(f)),
    ...pyFiles.filter((f) => {
      const r = rel(targetPath, f);
      return matchAny(r, ["main.py", "app.py", "server.py", "api.py", "asgi.py"]);
    }),
  ];
  const seenMain = new Set<string>();
  const maxDeclared = Number(process.env.APRF_AUTH_PROBE_MAX_ROUTES ?? 180);

  for (const file of mainFiles) {
    if (seenMain.has(file)) continue;
    seenMain.add(file);
    const mainRel = rel(targetPath, file);
    const text = readText(file, 400_000) ?? "";
    let m: RegExpExecArray | null;
    includeRe.lastIndex = 0;
    while ((m = includeRe.exec(text))) {
      const routerExpr = m[1]; // e.g. chats or open_webui.routers.chats
      const moduleName = routerExpr.split(".").pop()!;
      const prefix = normalizePath(m[2]);
      if (isPublicPath(prefix) && prefix !== "/" && !isAiSurface(prefix)) continue;

      const routerFile = findRouterFile(targetPath, moduleName, pyFiles);
      let declared: ProbeRoute[] = [];
      if (routerFile) {
        const routerRel = rel(targetPath, routerFile);
        const body = readText(routerFile, 500_000) ?? "";
        declared = parseRouterDecorators(body, routerRel, prefix);
      }

      if (declared.length === 0) {
        // Fallback: probe prefix with common methods
        for (const method of ["GET", "POST"]) {
          routes.push({
            method,
            path: prefix.endsWith("/") ? prefix.slice(0, -1) || "/" : prefix,
            source: mainRel,
            aiSurface: isAiSurface(prefix),
            declaredInCode: false,
          });
        }
      } else {
        routes.push(...declared);
      }
    }
  }

  // Cap declared AI routes for probe runtime — truncated catalogs cannot PASS AUTHN-M1
  const aiDeclared = routes.filter((r) => r.aiSurface && r.declaredInCode);
  const rest = routes.filter((r) => !(r.aiSurface && r.declaredInCode));
  const declaredAiRoutesTruncated = aiDeclared.length > maxDeclared;
  const capped = declaredAiRoutesTruncated
    ? aiDeclared.slice(0, maxDeclared)
    : aiDeclared;
  return {
    routes: [...capped, ...rest],
    declaredAiRoutesTruncated,
    declaredAiRouteTotal: aiDeclared.length,
  };
}

/** Load OpenAPI/Swagger path+method pairs from repo files. */
function discoverOpenApiFiles(targetPath: string, maxFiles: number): ProbeRoute[] {
  const files = walkFiles(targetPath, { maxFiles });
  const routes: ProbeRoute[] = [];
  for (const file of files) {
    const r = rel(targetPath, file);
    if (!matchAny(r, ["openapi", "swagger"]) || !/\.(json|yaml|yml)$/i.test(r)) {
      continue;
    }
    const text = readText(file, 500_000);
    if (!text) continue;
    try {
      const doc = JSON.parse(text) as {
        paths?: Record<string, Record<string, unknown>>;
      };
      if (!doc.paths) continue;
      for (const [path, methods] of Object.entries(doc.paths)) {
        for (const method of Object.keys(methods)) {
          if (!/^(get|post|put|patch|delete|head)$/i.test(method)) continue;
          routes.push({
            method: method.toUpperCase(),
            path: normalizePath(path),
            source: r,
            aiSurface: isAiSurface(path),
            declaredInCode: true,
          });
        }
      }
    } catch {
      // YAML OpenAPI not parsed here — JSON only for determinism without deps
    }
  }
  return routes;
}

function loadRoutesOverride(ctx: CollectorContext): ProbeRoute[] {
  const file = join(importDir(ctx), "routes.json");
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      routes?: Array<{ method?: string; path: string; aiSurface?: boolean }>;
    };
    return (raw.routes ?? []).map((r) => ({
      method: (r.method ?? "GET").toUpperCase(),
      path: normalizePath(r.path),
      source: "imports/http-auth-probe/routes.json",
      aiSurface: r.aiSurface ?? isAiSurface(r.path),
      declaredInCode: true,
    }));
  } catch {
    return [];
  }
}

/** Built-in AI surface seeds when discovery finds little. */
function seedAiRoutes(): ProbeRoute[] {
  return AI_PREFIX_HINTS.map((path) => ({
    method: "GET",
    path,
    source: "builtin-ai-prefix-hints",
    aiSurface: true,
    declaredInCode: false,
  }));
}

/** For AI paths with declared methods but no GET, add advisory GET probe. */
function addAdvisoryGets(routes: ProbeRoute[]): ProbeRoute[] {
  const out = [...routes];
  const byPath = new Map<string, ProbeRoute[]>();
  for (const r of routes) {
    if (!r.aiSurface) continue;
    const list = byPath.get(r.path) ?? [];
    list.push(r);
    byPath.set(r.path, list);
  }
  for (const [path, list] of byPath) {
    const hasGet = list.some((r) => r.method === "GET");
    const hasDeclared = list.some((r) => r.declaredInCode);
    if (hasGet || !hasDeclared) continue;
    out.push({
      method: "GET",
      path,
      source: "advisory-get",
      aiSurface: true,
      declaredInCode: false,
      advisoryGet: true,
    });
  }
  return out;
}

export function discoverRoutes(ctx: CollectorContext): {
  routes: ProbeRoute[];
  sources: string[];
  declaredAiRoutesTruncated: boolean;
  declaredAiRouteTotal: number;
} {
  const sources: string[] = [];
  let routes: ProbeRoute[] = [];
  let declaredAiRoutesTruncated = false;
  let declaredAiRouteTotal = 0;

  const override = loadRoutesOverride(ctx);
  if (override.length) {
    routes = override;
    sources.push("imports/http-auth-probe/routes.json");
  } else {
    const fastapi = discoverFastapiRoutes(ctx.targetPath, ctx.maxFiles ?? 4000);
    if (fastapi.routes.length) {
      routes.push(...fastapi.routes);
      sources.push("fastapi-router-methods");
      declaredAiRoutesTruncated = fastapi.declaredAiRoutesTruncated;
      declaredAiRouteTotal = fastapi.declaredAiRouteTotal;
    }
    const openapi = discoverOpenApiFiles(ctx.targetPath, ctx.maxFiles ?? 4000);
    if (openapi.length) {
      routes.push(...openapi);
      sources.push("openapi-json");
    }
    if (routes.filter((r) => r.aiSurface).length < 3) {
      routes.push(...seedAiRoutes());
      sources.push("builtin-ai-prefix-hints");
    }
  }

  routes = addAdvisoryGets(dedupeRoutes(routes));
  routes = dedupeRoutes(routes);
  const ai = routes.filter((r) => r.aiSurface);
  const publicSample = routes.filter((r) => !r.aiSurface).slice(0, 5);
  return {
    routes: [...ai, ...publicSample],
    sources,
    declaredAiRoutesTruncated,
    declaredAiRouteTotal,
  };
}

async function probeOne(
  baseUrl: string,
  route: ProbeRoute,
  timeoutMs: number,
): Promise<ProbeResultRow> {
  const url = new URL(
    route.path.startsWith("/") ? route.path.slice(1) : route.path,
    baseUrl.endsWith("/") ? baseUrl : baseUrl + "/",
  ).toString();

  const baseRow = {
    method: route.method,
    path: route.path,
    url,
    source: route.source,
    advisoryGet: route.advisoryGet ?? false,
    declaredInCode: route.declaredInCode ?? false,
  };

  if (!route.aiSurface) {
    return {
      ...baseRow,
      status: null,
      ok: null,
      skipped: true,
      skipReason: "non-ai / public surface — not scored for AUTHN-M1",
    };
  }

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: route.method,
      redirect: "manual",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "aprf-auditor-http-auth-probe/0.2",
        ...(route.method === "POST" ||
        route.method === "PUT" ||
        route.method === "PATCH"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        route.method === "POST" ||
        route.method === "PUT" ||
        route.method === "PATCH"
          ? "{}"
          : undefined,
    });
    const status = res.status;
    const latencyMs = Date.now() - started;

    // Advisory GET: 405 → note only; 401/403 → ok; 2xx → fail
    if (route.advisoryGet) {
      if (EXPECT_STATUS.has(status)) {
        return {
          ...baseRow,
          status,
          ok: true,
          latencyMs,
          note: "Advisory GET correctly rejects unauthenticated callers",
        };
      }
      if (status === 405) {
        return {
          ...baseRow,
          status,
          ok: null,
          skipped: true,
          skipReason: "advisory-get-405",
          latencyMs,
          note: `GET ${route.path} returned 405; declared methods are scored for AUTHN-M1. GET should also return 401/403 for unauthenticated callers.`,
        };
      }
      if (status !== null && status >= 200 && status < 400) {
        return {
          ...baseRow,
          status,
          ok: false,
          latencyMs,
          note: `Advisory GET ${route.path} returned ${status} without credentials — must reject with 401/403`,
        };
      }
      return {
        ...baseRow,
        status,
        ok: false,
        latencyMs,
        note: `Advisory GET ${route.path} returned ${status}; expected 401/403`,
      };
    }

    const ok = EXPECT_STATUS.has(status);
    return {
      ...baseRow,
      status,
      ok,
      latencyMs,
      note: ok
        ? undefined
        : status === 405
          ? `${route.method} ${route.path} returned 405 (method not allowed) without auth — expected 401/403 for declared method`
          : undefined,
    };
  } catch (err) {
    return {
      ...baseRow,
      status: null,
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAuthProbe(
  ctx: CollectorContext,
  baseUrl: string,
  routes: ProbeRoute[],
  sources: string[],
  scope: { customerFacingAiHttpApisPresent: boolean | null } = {
    customerFacingAiHttpApisPresent: null,
  },
  opts: {
    declaredAiRoutesTruncated?: boolean;
    declaredAiRouteTotal?: number;
  } = {},
): Promise<AuthProbeReport> {
  const timeoutMs = Number(process.env.APRF_AUTH_PROBE_TIMEOUT_MS ?? 8000);
  const concurrency = Math.max(
    1,
    Math.min(8, Number(process.env.APRF_AUTH_PROBE_CONCURRENCY ?? 4)),
  );
  const results: ProbeResultRow[] = [];
  const queue = [...routes];

  async function worker() {
    while (queue.length) {
      const route = queue.shift();
      if (!route) return;
      results.push(await probeOne(baseUrl, route, timeoutMs));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  results.sort((a, b) =>
    `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
  );

  const notes = [
    ...new Set(
      results.map((r) => r.note).filter((n): n is string => Boolean(n)),
    ),
  ];
  // Prefer surfacing the GET-should-401 guidance once as a summary note
  const get405 = results.filter(
    (r) => r.advisoryGet && r.status === 405 && r.skipReason === "advisory-get-405",
  );
  if (get405.length) {
    notes.unshift(
      `${get405.length} path(s) returned GET 405 while declared methods were probed. GET should also return 401/403 for unauthenticated callers (AUTHN-M1 hardening).`,
    );
  }

  const scored = results.filter((r) => !r.skipped && r.ok !== null);
  const pass = scored.filter((r) => r.ok === true).length;
  const fail = scored.filter((r) => r.ok === false && !r.error).length;
  const errors = results.filter((r) => Boolean(r.error)).length;
  const skipped = results.filter((r) => r.skipped).length;
  const advisoryGet405 = get405.length;
  const probedAt = ctx.assessedAt.toISOString();
  const fresh = measuredAtFresh(probedAt, ctx.assessedAt, IMPORT_MAX_AGE_DAYS);
  const aiDeclared = routes.filter((r) => r.aiSurface && !r.advisoryGet);
  const truncated = opts.declaredAiRoutesTruncated === true;
  if (truncated) {
    notes.push(
      `Declared AI route catalog truncated for probe runtime (${opts.declaredAiRouteTotal ?? "?"} > APRF_AUTH_PROBE_MAX_ROUTES) — raise the cap or supply routes.json; truncated catalogs cannot PASS AUTHN-M1.`,
    );
  }
  const catalogMatch = truncated
    ? false
    : aiDeclared.length === 0
      ? null
      : scored.filter((r) => !r.advisoryGet).length >= aiDeclared.length;
  if (catalogMatch === true) {
    notes.push(
      "Probe inventory covers declared AI routes from the discovered production route catalog.",
    );
  } else if (catalogMatch === false && !truncated) {
    notes.push(
      "Probe inventory does not fully cover declared AI routes in the production route catalog.",
    );
  }

  const scopeAbsent = scope.customerFacingAiHttpApisPresent === false;
  let authnM1Satisfied: boolean | null = null;
  let statusHint: AuthProbeReport["summary"]["statusHint"];

  if (scopeAbsent) {
    statusHint = "not_applicable";
    authnM1Satisfied = null;
    notes.push(
      "Imported customerFacingAiHttpApisPresent=false — AUTHN-M1 NOT_APPLICABLE.",
    );
  } else if (scored.length === 0) {
    statusHint = "not_demonstrated";
    authnM1Satisfied = null;
    notes.push(
      "No scored AI routes probed — AUTHN-M1 remains not demonstrated until a probe covers declared AI routes or an explicit N/A attest (customerFacingAiHttpApisPresent=false) is imported.",
    );
  } else if (fail > 0 || errors > 0) {
    statusHint = "fail";
    authnM1Satisfied = false;
  } else if (
    pass === scored.length &&
    catalogMatch === true &&
    fresh
  ) {
    statusHint = "pass";
    authnM1Satisfied = true;
  } else {
    statusHint = "partial";
    authnM1Satisfied = false;
    if (!fresh) {
      notes.push(
        "Probe measuredAt/probedAt older than 90 days — required to unlock AUTHN-M1 PASS.",
      );
    }
    if (catalogMatch !== true) {
      notes.push(
        "Catalog match incomplete — every declared AI route must be probed.",
      );
    }
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    probedAt,
    measuredAt: probedAt,
    baseUrl,
    expectStatus: [...EXPECT_STATUS],
    catalogSource: sources,
    routesDiscovered: routes.length,
    routesProbed: scored.length,
    importedScope: scope,
    summary: {
      pass,
      fail,
      skipped,
      errors,
      advisoryGet405,
      probeInventoryMatchesRouteCatalog: catalogMatch,
      authnM1Satisfied,
      statusHint,
    },
    notes,
    results,
  };
}

function loadScopeImport(
  ctx: CollectorContext,
): { customerFacingAiHttpApisPresent: boolean | null } {
  let customerFacingAiHttpApisPresent: boolean | null = null;
  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/(?:^|[/\\])(?:auth-probe-report\.json|probe[^/\\]*\.json)$/i.test(file))
      continue;
    if (!/\.json$/i.test(file)) continue;
    const text = readText(file, 200_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      customerFacingAiHttpApisPresent =
        asBool(data.customerFacingAiHttpApisPresent) ??
        asBool(data.customer_facing_ai_http_apis_present) ??
        asBool(data.hasCustomerFacingAiHttpApis) ??
        customerFacingAiHttpApisPresent;
    } catch {
      /* skip */
    }
  }
  return { customerFacingAiHttpApisPresent };
}

function evaluatePriorReport(
  ctx: CollectorContext,
  file: string,
  scope: { customerFacingAiHttpApisPresent: boolean | null },
): AuthProbeReport | null {
  const text = readText(file, 2_000_000);
  if (!text) return null;
  try {
    const data = JSON.parse(text) as AuthProbeReport;
    if (!data?.summary) return null;
    const measuredAt =
      parseMeasuredAt(data as unknown as Record<string, unknown>) ??
      (typeof data.probedAt === "string" ? data.probedAt : null) ??
      (typeof data.measuredAt === "string" ? data.measuredAt : null);
    const fresh = measuredAtFresh(
      measuredAt,
      ctx.assessedAt,
      IMPORT_MAX_AGE_DAYS,
    );
    const scopeAbsent = scope.customerFacingAiHttpApisPresent === false;
    const notes = [...(data.notes ?? [])];
    let authnM1Satisfied = data.summary.authnM1Satisfied ?? null;
    let statusHint: AuthProbeReport["summary"]["statusHint"] =
      data.summary.statusHint ??
      (authnM1Satisfied === true
        ? "pass"
        : authnM1Satisfied === false
          ? "fail"
          : "partial");

    const catalogMatch =
      data.summary.probeInventoryMatchesRouteCatalog === true;

    if (scopeAbsent) {
      statusHint = "not_applicable";
      authnM1Satisfied = null;
      notes.push(
        "Imported customerFacingAiHttpApisPresent=false — AUTHN-M1 NOT_APPLICABLE.",
      );
    } else if (authnM1Satisfied === true && !fresh) {
      statusHint = "partial";
      authnM1Satisfied = false;
      notes.push(
        "Prior auth-probe-report measuredAt/probedAt older than 90 days — re-probe to unlock AUTHN-M1 PASS.",
      );
    } else if (authnM1Satisfied === true && !catalogMatch) {
      statusHint = "partial";
      authnM1Satisfied = false;
      notes.push(
        "Prior auth-probe-report missing probeInventoryMatchesRouteCatalog=true — re-probe with full catalog coverage to unlock AUTHN-M1 PASS.",
      );
    }

    return {
      ...data,
      probedAt: measuredAt ?? data.probedAt,
      measuredAt: measuredAt ?? data.measuredAt ?? data.probedAt,
      importedScope: scope,
      summary: {
        ...data.summary,
        probeInventoryMatchesRouteCatalog:
          data.summary.probeInventoryMatchesRouteCatalog ?? null,
        authnM1Satisfied,
        statusHint,
      },
      notes,
    };
  } catch {
    return null;
  }
}

function ingestPriorReports(ctx: CollectorContext): EvidenceNode[] {
  const files = listImportFiles(ctx.outputDir, PLUGIN_ID).filter((f) =>
    /(?:^|[/\\])(?:auth-probe-report\.json|probe[^/\\]*\.json)$/i.test(f),
  );
  return files.map((file, i) => {
    const text = readText(file, 16_000) ?? "";
    const mt = mtimeDate(file);
    return {
      id: `${PLUGIN_ID}:import:${i}`,
      class: "runtime" as const,
      ref: rel(ctx.outputDir, file),
      excerpt: redact(text.slice(0, 400)),
      pluginId: PLUGIN_ID,
      lastModified: mtimeIso(file),
      gitCommit: ctx.gitCommit,
      evidenceAgeDays: ageDays(ctx.assessedAt, mt),
      signals: ["auth-probe", "import-export", "authn-m1"],
      relatedCheckIds: [...RELATED],
    };
  });
}

function resolveBaseUrl(ctx: CollectorContext): string | undefined {
  const fromCtx = ctx.baseUrl?.trim();
  if (fromCtx) return fromCtx.replace(/\/$/, "");
  const fromEnv = process.env.APRF_AUTH_PROBE_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return undefined;
}

export const httpAuthProbeCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const scope = loadScopeImport(ctx);
    const prior = ingestPriorReports(ctx);
    const {
      routes,
      sources,
      declaredAiRoutesTruncated,
      declaredAiRouteTotal,
    } = discoverRoutes(ctx);
    const baseUrl = resolveBaseUrl(ctx);
    const nodes: EvidenceNode[] = [...prior];

    // Always emit catalog discovery (code / config inventory)
    const catalogExcerpt = redact(
      JSON.stringify(
        {
          sources,
          aiRoutes: routes.filter((r) => r.aiSurface).slice(0, 40),
          total: routes.length,
        },
        null,
        2,
      ).slice(0, 600),
    );
    nodes.push({
      id: `${PLUGIN_ID}:catalog`,
      class: "code",
      ref: "http-auth-probe:route-catalog",
      excerpt: catalogExcerpt,
      pluginId: PLUGIN_ID,
      gitCommit: ctx.gitCommit,
      evidenceAgeDays: 0,
      signals: ["route-catalog", "authn-m1"],
      relatedCheckIds: [...RELATED],
    });

    if (scope.customerFacingAiHttpApisPresent === false) {
      ensureDir(importDir(ctx));
      const naReport: AuthProbeReport = {
        schemaVersion: "0.2.0",
        pluginId: PLUGIN_ID,
        relatedCheckIds: [...RELATED],
        probedAt: ctx.assessedAt.toISOString(),
        measuredAt: ctx.assessedAt.toISOString(),
        baseUrl: null,
        expectStatus: [...EXPECT_STATUS],
        catalogSource: sources,
        routesDiscovered: routes.length,
        routesProbed: 0,
        importedScope: scope,
        summary: {
          pass: 0,
          fail: 0,
          skipped: 0,
          errors: 0,
          advisoryGet405: 0,
          probeInventoryMatchesRouteCatalog: null,
          authnM1Satisfied: null,
          statusHint: "not_applicable",
        },
        notes: [
          "Imported customerFacingAiHttpApisPresent=false — AUTHN-M1 NOT_APPLICABLE.",
        ],
        results: [],
      };
      const reportPath = join(importDir(ctx), "auth-probe-report.json");
      writeFileSync(reportPath, JSON.stringify(naReport, null, 2), "utf8");
      nodes.push({
        id: `${PLUGIN_ID}:report`,
        class: "runtime",
        ref: rel(ctx.outputDir, reportPath),
        excerpt: redact(naReport.notes.join(" | ").slice(0, 400)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: ["auth-probe", "authn-m1"],
        relatedCheckIds: [...RELATED],
      });
      return {
        pluginId: PLUGIN_ID,
        status: "ran",
        detail: `AUTHN-M1 status=not_applicable (customerFacingAiHttpApisPresent=false); report=${rel(ctx.outputDir, reportPath)}`,
        nodes,
      };
    }

    if (!baseUrl) {
      if (prior.length > 0) {
        const reportFiles = listImportFiles(ctx.outputDir, PLUGIN_ID)
          .filter((f) =>
            /(?:^|[/\\])(?:auth-probe-report\.json|probe[^/\\]*\.json)$/i.test(f),
          )
          .sort((a, b) => {
            const ap = /auth-probe-report\.json$/i.test(a) ? 0 : 1;
            const bp = /auth-probe-report\.json$/i.test(b) ? 0 : 1;
            return ap - bp;
          });
        const evaluated = reportFiles
          .map((f) => evaluatePriorReport(ctx, f, scope))
          .find(Boolean);
        if (evaluated) {
          const reportPath = join(importDir(ctx), "auth-probe-report.json");
          ensureDir(importDir(ctx));
          writeFileSync(reportPath, JSON.stringify(evaluated, null, 2), "utf8");
          const satisfied = evaluated.summary.authnM1Satisfied;
          nodes.push({
            id: `${PLUGIN_ID}:report`,
            class: "runtime",
            ref: rel(ctx.outputDir, reportPath),
            excerpt: redact(
              `AUTHN-M1 prior report status=${evaluated.summary.statusHint} satisfied=${satisfied}`,
            ),
            pluginId: PLUGIN_ID,
            gitCommit: ctx.gitCommit,
            evidenceAgeDays: 0,
            signals: [
              "auth-probe",
              "authn-m1",
              ...(satisfied === true
                ? ["http-401-or-403", "authn-m1-pass-signal"]
                : []),
            ],
            relatedCheckIds: [...RELATED],
          });
        }
        return {
          pluginId: PLUGIN_ID,
          status: "ran",
          detail: `Ingested ${prior.length} prior probe report(s); no --base-url (set APRF_AUTH_PROBE_BASE_URL to re-probe). Catalog: ${routes.filter((r) => r.aiSurface).length} AI routes; status=${evaluated?.summary.statusHint ?? "partial"}`,
          nodes,
        };
      }
      return {
        pluginId: PLUGIN_ID,
        status: "needs-user",
        detail: `Discovered ${routes.filter((r) => r.aiSurface).length} AI route candidates (${sources.join(", ") || "none"}). Provide --base-url or APRF_AUTH_PROBE_BASE_URL to a running instance, or drop auth-probe-report.json under imports/http-auth-probe/. Set customerFacingAiHttpApisPresent=false for NOT_APPLICABLE.`,
        nodes,
      };
    }

    // Reachability check
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      await fetch(baseUrl + "/", { method: "GET", signal: ctrl.signal }).catch(
        () => fetch(baseUrl, { method: "GET", signal: ctrl.signal }),
      );
      clearTimeout(t);
    } catch (err) {
      return {
        pluginId: PLUGIN_ID,
        status: "needs-user",
        detail: `Base URL unreachable (${baseUrl}): ${err instanceof Error ? err.message : String(err)}. Start the app or fix the URL.`,
        nodes,
      };
    }

    const report = await runAuthProbe(ctx, baseUrl, routes, sources, scope, {
      declaredAiRoutesTruncated,
      declaredAiRouteTotal,
    });
    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "auth-probe-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    const satisfied = report.summary.authnM1Satisfied;
    nodes.push({
      id: `${PLUGIN_ID}:report`,
      class: "runtime",
      ref: rel(ctx.outputDir, reportPath),
      excerpt: redact(
        `AUTHN-M1 probe ${baseUrl}: status=${report.summary.statusHint} pass=${report.summary.pass} fail=${report.summary.fail} errors=${report.summary.errors} advisoryGet405=${report.summary.advisoryGet405} satisfied=${satisfied}`,
      ),
      pluginId: PLUGIN_ID,
      lastModified: new Date().toISOString(),
      gitCommit: ctx.gitCommit,
      evidenceAgeDays: 0,
      signals: [
        "auth-probe",
        "authn-m1",
        ...(satisfied === true
          ? ["http-401-or-403", "authn-m1-pass-signal"]
          : []),
      ],
      relatedCheckIds: [...RELATED],
    });

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `Probed ${report.routesProbed} AI routes at ${baseUrl} → status=${report.summary.statusHint} pass=${report.summary.pass} fail=${report.summary.fail} errors=${report.summary.errors} advisoryGet405=${report.summary.advisoryGet405}; report=${rel(ctx.outputDir, reportPath)}; AUTHN-M1 satisfied=${satisfied}`,
      nodes,
    };
  },
};

/** Test helper: local ephemeral server (not used by default collect). */
export function startFixtureAuthServer(
  port = 0,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const url = req.url ?? "/";
      const method = (req.method ?? "GET").toUpperCase();
      if (url.startsWith("/health")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      // Declared POST rejects; GET returns 405 (advisory — should be 401/403)
      if (url.startsWith("/api/v1/chats")) {
        if (method === "POST") {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ detail: "Unauthorized" }));
          return;
        }
        if (method === "GET") {
          res.writeHead(405, { Allow: "POST" });
          res.end();
          return;
        }
      }
      if (url.startsWith("/openai")) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "Unauthorized" }));
        return;
      }
      if (url.startsWith("/api/v1/open")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ leaked: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        resolvePromise({
          baseUrl: "http://127.0.0.1",
          close: () =>
            new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
        });
        return;
      }
      resolvePromise({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((r, j) => server.close((e) => (e ? j(e) : r()))),
      });
    });
  });
}
