/**
 * mcp-s2s-inventory — AUTHN-M2 detector executor.
 *
 * Builds / scores an MCP + AI S2S connection inventory:
 * - Code scan: auth_type allow-lists / defaults (policy signals)
 * - Import: aprf-assessment/imports/mcp-s2s-inventory/*.json
 * - Live: GET {baseUrl}/api/v1/configs/tool_servers with admin bearer token
 *
 * Pass when every production connection has a named machine identity and none
 * are anonymous or shared long-lived static keys.
 */
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

const PLUGIN_ID = "mcp-s2s-inventory";
const RELATED = ["AUTHN-M2"] as const;
const DETECTOR_ID = "mcp-s2s-inventory";
const IMPORT_MAX_AGE_DAYS = 90;

/** Auth types that count as strong machine / federated identity. */
const STRONG_AUTH = new Set([
  "oauth_2.1",
  "oauth_2.1_static",
  "system_oauth",
  "azure_ad",
  "microsoft_entra_id",
  "mtls",
  "workload_identity",
  "oidc",
]);

/** Explicit anonymous / no credentials. */
const ANON_AUTH = new Set(["none", "anonymous", "noauth", ""]);

export interface S2SConnection {
  id?: string;
  name?: string;
  url?: string;
  type?: string;
  auth_type?: string | null;
  key?: string | null;
  source: string;
  raw?: Record<string, unknown>;
}

export interface ScoredConnection {
  id: string;
  name: string;
  url: string;
  type: string;
  auth_type: string;
  hasStaticKey: boolean;
  namedIdentity: boolean;
  ok: boolean;
  reason: string;
  source: string;
}

export interface McpS2sReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  measuredAt: string | null;
  baseUrl: string | null;
  inventorySource: string[];
  codePolicy: {
    allowsAnonymousAuthType: boolean;
    authTypesMentioned: string[];
    refs: string[];
  };
  importedScope: {
    productionMcpOrAiS2sConnectionsPresent: boolean | null;
  };
  connections: ScoredConnection[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    /** true when inventory has connections, all ok, and measuredAt fresh */
    authnM2Satisfied: boolean | null;
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

function resolveBaseUrl(ctx: CollectorContext): string | undefined {
  const u = ctx.baseUrl?.trim() || process.env.APRF_AUTH_PROBE_BASE_URL?.trim();
  return u ? u.replace(/\/$/, "") : undefined;
}

function resolveAdminToken(ctx: CollectorContext): string | undefined {
  return (
    ctx.adminToken?.trim() ||
    process.env.APRF_ADMIN_TOKEN?.trim() ||
    process.env.APRF_AUTH_PROBE_ADMIN_TOKEN?.trim() ||
    undefined
  );
}

function resolveAdminEmail(ctx: CollectorContext): string | undefined {
  return (
    ctx.adminEmail?.trim() ||
    process.env.APRF_ADMIN_EMAIL?.trim() ||
    process.env.APRF_ADMIN_USER?.trim() ||
    undefined
  );
}

function resolveAdminPassword(ctx: CollectorContext): string | undefined {
  return (
    ctx.adminPassword?.trim() ||
    process.env.APRF_ADMIN_PASSWORD?.trim() ||
    undefined
  );
}

/**
 * Open WebUI-style password login → JWT bearer token.
 * POST /api/v1/auths/signin { email, password } → { token }
 */
export async function signInForAdminToken(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ token?: string; error?: string }> {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/auths/signin`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "aprf-auditor-mcp-s2s-inventory/0.2",
      },
      body: JSON.stringify({ email, password }),
    });
    clearTimeout(t);
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {
        error: `signin HTTP ${res.status}: non-JSON body`,
      };
    }
    if (!res.ok) {
      const detail =
        (data.detail as string) ||
        (typeof data.detail === "object" ? JSON.stringify(data.detail) : "") ||
        text.slice(0, 200);
      return { error: `signin HTTP ${res.status}: ${detail}` };
    }
    const token =
      (data.token as string) ||
      (data.access_token as string) ||
      ((data.data as Record<string, unknown> | undefined)?.token as string);
    if (!token) {
      return { error: "signin succeeded but response had no token field" };
    }
    return { token };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function resolveLiveAdminToken(
  ctx: CollectorContext,
  baseUrl: string,
): Promise<{ token?: string; error?: string; via: "token" | "password" | "none" }> {
  const existing = resolveAdminToken(ctx);
  if (existing) return { token: existing, via: "token" };

  const email = resolveAdminEmail(ctx);
  const password = resolveAdminPassword(ctx);
  if (email && password) {
    const signed = await signInForAdminToken(baseUrl, email, password);
    if (signed.token) return { token: signed.token, via: "password" };
    return { error: signed.error, via: "password" };
  }
  return { via: "none" };
}

function connectionName(c: S2SConnection, index: number): string {
  return (
    c.name ||
    c.id ||
    (c.raw?.info as { id?: string; name?: string } | undefined)?.id ||
    (c.raw?.info as { id?: string; name?: string } | undefined)?.name ||
    c.url ||
    `connection-${index + 1}`
  );
}

function scoreConnection(c: S2SConnection, index: number): ScoredConnection {
  const auth = String(c.auth_type ?? "none").toLowerCase().trim();
  const name = connectionName(c, index);
  const id =
    c.id ||
    (c.raw?.info as { id?: string } | undefined)?.id ||
    name;
  const hasStaticKey = Boolean(c.key && String(c.key).length > 0);
  const namedIdentity = Boolean(
    c.id ||
      c.name ||
      (c.raw?.info as { id?: string; name?: string } | undefined)?.id ||
      (c.raw?.info as { id?: string; name?: string } | undefined)?.name,
  );

  let ok = false;
  let reason = "";

  if (ANON_AUTH.has(auth) || auth === "null" || auth === "undefined") {
    ok = false;
    reason = `auth_type=${auth || "none"} — anonymous / unauthenticated S2S or MCP connection`;
  } else if (auth === "bearer" || auth === "api_key" || auth === "static") {
    ok = false;
    reason =
      "shared long-lived static key (bearer/api_key) — not strong machine identity; use OAuth/OIDC/mTLS/workload identity";
  } else if (auth === "session") {
    ok = false;
    reason =
      "auth_type=session uses end-user session, not a named machine identity for S2S/MCP";
  } else if (STRONG_AUTH.has(auth)) {
    if (namedIdentity) {
      ok = true;
      reason = `auth_type=${auth} with named identity "${name}"`;
    } else {
      ok = false;
      reason = `auth_type=${auth} but connection lacks a named identity (id/name)`;
    }
  } else {
    ok = false;
    reason = `unknown auth_type=${auth} — treat as non-conforming until documented as machine identity`;
  }

  return {
    id: String(id),
    name: String(name),
    url: String(c.url ?? ""),
    type: String(c.type ?? "unknown"),
    auth_type: auth || "none",
    hasStaticKey,
    namedIdentity: Boolean(namedIdentity),
    ok,
    reason,
    source: c.source,
  };
}

/** Scan repo for auth_type literals / defaults (policy signal). */
function scanCodePolicy(
  targetPath: string,
  maxFiles: number,
): McpS2sReport["codePolicy"] {
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".js", ".tsx", ".jsx"],
  });
  const authTypes = new Set<string>();
  const refs: string[] = [];
  let allowsAnonymous = false;

  for (const file of files) {
    const r = rel(targetPath, file);
    if (!matchAny(r, ["mcp", "tool_server", "tools", "oauth", "terminal", "openai", "config"])) {
      continue;
    }
    const text = readText(file, 120_000) ?? "";
    if (!/auth_type/i.test(text)) continue;

    if (
      /auth_type['\"\s:=\)]*(none|anonymous)/i.test(text) ||
      /get\(\s*['\"]auth_type['\"]\s*,\s*['\"]none['\"]/i.test(text) ||
      /auth_type\s*==\s*['\"]none['\"]/i.test(text)
    ) {
      allowsAnonymous = true;
      if (refs.length < 12) refs.push(r);
    }

    const lit = text.matchAll(/auth_type['\"\s:=\)]*['\"]([a-z0-9_.-]+)['\"]/gi);
    for (const m of lit) authTypes.add(m[1].toLowerCase());
    const def = text.matchAll(
      /get\(\s*['\"]auth_type['\"]\s*,\s*['\"]([a-z0-9_.-]+)['\"]/gi,
    );
    for (const m of def) authTypes.add(m[1].toLowerCase());
  }

  return {
    allowsAnonymousAuthType: allowsAnonymous,
    authTypesMentioned: [...authTypes].sort(),
    refs,
  };
}

function normalizeInventoryPayload(
  data: unknown,
  source: string,
): S2SConnection[] {
  const out: S2SConnection[] = [];

  const pushConn = (raw: Record<string, unknown>, src: string) => {
    const info = (raw.info as Record<string, unknown> | undefined) ?? undefined;
    out.push({
      id: (raw.id as string) || (info?.id as string) || undefined,
      name: (raw.name as string) || (info?.name as string) || undefined,
      url: raw.url as string | undefined,
      type: (raw.type as string) || (raw.server_type as string) || "openapi",
      auth_type: (raw.auth_type as string | null | undefined) ?? "none",
      key: raw.key as string | null | undefined,
      source: src,
      raw,
    });
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object") {
        pushConn(item as Record<string, unknown>, source);
      }
    }
    return out;
  }

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of [
      "TOOL_SERVER_CONNECTIONS",
      "tool_server.connections",
      "TERMINAL_SERVER_CONNECTIONS",
      "terminal_server.connections",
      "connections",
      "mcpServers",
      "mcp_servers",
      "servers",
    ]) {
      const v = obj[key];
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object") {
            pushConn(item as Record<string, unknown>, `${source}:${key}`);
          }
        }
      }
    }
    // mcp.json style: { mcpServers: { name: { url, headers } } }
    if (obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)) {
      for (const [name, cfg] of Object.entries(
        obj.mcpServers as Record<string, Record<string, unknown>>,
      )) {
        const headers = cfg.headers as Record<string, string> | undefined;
        const hasAuthHeader = Boolean(
          headers &&
            Object.keys(headers).some((h) => /authorization/i.test(h)),
        );
        pushConn(
          {
            name,
            url: (cfg.url as string) || (cfg.serverUrl as string),
            type: "mcp",
            auth_type: hasAuthHeader
              ? "bearer"
              : cfg.auth_type || "none",
            key: hasAuthHeader ? "[redacted-header]" : cfg.key,
            info: { id: name, name },
          },
          `${source}:mcpServers`,
        );
      }
    }
  }
  return out;
}

function loadImportInventories(ctx: CollectorContext): {
  connections: S2SConnection[];
  sources: string[];
  measuredAt: string | null;
  productionMcpOrAiS2sConnectionsPresent: boolean | null;
} {
  const files = listImportFiles(ctx.outputDir, PLUGIN_ID).filter(
    (f) =>
      /\.json$/i.test(f) &&
      !/mcp-s2s-inventory-report\.json$/i.test(f),
  );
  const connections: S2SConnection[] = [];
  const sources: string[] = [];
  let measuredAt: string | null = null;
  let productionMcpOrAiS2sConnectionsPresent: boolean | null = null;
  for (const file of files) {
    const text = readText(file, 2_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const src = rel(ctx.outputDir, file);
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      productionMcpOrAiS2sConnectionsPresent =
        asBool(data.productionMcpOrAiS2sConnectionsPresent) ??
        asBool(data.production_mcp_or_ai_s2s_connections_present) ??
        asBool(data.hasProductionMcpOrAiS2sConnections) ??
        productionMcpOrAiS2sConnectionsPresent;
      const normalized = normalizeInventoryPayload(data, src);
      if (normalized.length > 0) {
        connections.push(...normalized);
        sources.push(src);
      } else if (
        productionMcpOrAiS2sConnectionsPresent !== null ||
        parseMeasuredAt(data)
      ) {
        // Scope/attest-only import still counts as an inventory source for N/A.
        sources.push(src);
      } else {
        // Empty connection file still proves an inventory export was provided.
        sources.push(src);
      }
    } catch {
      /* skip invalid json */
    }
  }
  return {
    connections,
    sources,
    measuredAt,
    productionMcpOrAiS2sConnectionsPresent,
  };
}

async function fetchLiveInventory(
  baseUrl: string,
  adminToken: string,
): Promise<{ connections: S2SConnection[]; sources: string[]; error?: string }> {
  const paths = [
    "/api/v1/configs/tool_servers",
    "/api/v1/configs/terminal_servers",
  ];
  const connections: S2SConnection[] = [];
  const sources: string[] = [];
  const errors: string[] = [];

  for (const path of paths) {
    const url = `${baseUrl}${path}`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${adminToken}`,
          "User-Agent": "aprf-auditor-mcp-s2s-inventory/0.2",
        },
      });
      clearTimeout(t);
      if (res.status === 401 || res.status === 403) {
        errors.push(`${path} → ${res.status} (admin token rejected)`);
        continue;
      }
      if (!res.ok) {
        errors.push(`${path} → HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as unknown;
      connections.push(
        ...normalizeInventoryPayload(data, `live:${path}`),
      );
      sources.push(`live:${path}`);
    } catch (err) {
      errors.push(
        `${path} → ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    connections,
    sources,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

function redactConnectionForReport(c: ScoredConnection): ScoredConnection {
  return {
    ...c,
    // never echo secrets
    hasStaticKey: c.hasStaticKey,
  };
}

export function buildReport(
  ctx: CollectorContext,
  opts: {
    connections: S2SConnection[];
    inventorySource: string[];
    codePolicy: McpS2sReport["codePolicy"];
    baseUrl: string | null;
    measuredAt?: string | null;
    productionMcpOrAiS2sConnectionsPresent?: boolean | null;
  },
): McpS2sReport {
  const scored = opts.connections.map((c, i) =>
    redactConnectionForReport(scoreConnection(c, i)),
  );
  const pass = scored.filter((c) => c.ok).length;
  const fail = scored.filter((c) => !c.ok).length;
  const notes: string[] = [];
  const measuredAt =
    opts.measuredAt ??
    (opts.inventorySource.length > 0 ? ctx.assessedAt.toISOString() : null);
  const importFresh = measuredAtFresh(
    measuredAt,
    ctx.assessedAt,
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent = opts.productionMcpOrAiS2sConnectionsPresent === false;
  const scope = {
    productionMcpOrAiS2sConnectionsPresent:
      opts.productionMcpOrAiS2sConnectionsPresent ?? null,
  };

  if (opts.codePolicy.allowsAnonymousAuthType) {
    notes.push(
      "Code allows auth_type=none (or defaults to none) for MCP/tool servers — production configs must not use anonymous connections.",
    );
  }
  if (opts.inventorySource.length > 0) {
    notes.push(
      `Inventory sources: ${opts.inventorySource.join(", ")} (connections=${scored.length}, measuredAt=${measuredAt}, scopePresent=${scope.productionMcpOrAiS2sConnectionsPresent})`,
    );
  }
  if (scored.length === 0 && opts.inventorySource.length > 0 && !scopeAbsent) {
    notes.push(
      "Inventory is empty (no MCP/S2S connections). AUTHN-M2 remains not demonstrated until connections are listed or productionMcpOrAiS2sConnectionsPresent=false is imported for NOT_APPLICABLE.",
    );
  }
  if (fail > 0) {
    notes.push(
      `${fail} connection(s) fail strong machine-identity requirements (anonymous, session, or static shared keys).`,
    );
  }

  let authnM2Satisfied: boolean | null = null;
  let statusHint: McpS2sReport["summary"]["statusHint"];

  if (scopeAbsent && opts.inventorySource.length > 0) {
    statusHint = "not_applicable";
    authnM2Satisfied = null;
    notes.push(
      "Imported productionMcpOrAiS2sConnectionsPresent=false — AUTHN-M2 NOT_APPLICABLE.",
    );
  } else if (opts.inventorySource.length === 0 && scored.length === 0) {
    statusHint = "not_demonstrated";
    authnM2Satisfied = null;
  } else if (fail > 0) {
    statusHint = "fail";
    authnM2Satisfied = false;
  } else if (scored.length > 0 && fail === 0 && importFresh) {
    statusHint = "pass";
    authnM2Satisfied = true;
  } else if (opts.inventorySource.length > 0 || scored.length > 0) {
    statusHint = "partial";
    authnM2Satisfied = false;
    if (scored.length === 0) {
      notes.push(
        "Empty inventory without N/A attest cannot unlock PASS — import productionMcpOrAiS2sConnectionsPresent=false if none exist in production.",
      );
    }
    if (scored.length > 0 && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AUTHN-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authnM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: ctx.assessedAt.toISOString(),
    measuredAt,
    baseUrl: opts.baseUrl,
    inventorySource: opts.inventorySource,
    codePolicy: opts.codePolicy,
    importedScope: scope,
    connections: scored,
    summary: {
      total: scored.length,
      pass,
      fail,
      authnM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const mcpS2sInventoryCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const codePolicy = scanCodePolicy(ctx.targetPath, ctx.maxFiles ?? 4000);
    const imported = loadImportInventories(ctx);
    const baseUrl = resolveBaseUrl(ctx);

    const nodes: EvidenceNode[] = [];
    const inventorySource = [...imported.sources];
    let connections = [...imported.connections];
    let measuredAt = imported.measuredAt;
    let productionMcpOrAiS2sConnectionsPresent =
      imported.productionMcpOrAiS2sConnectionsPresent;
    let liveError: string | undefined;
    let authVia: string | undefined;

    // Code policy node always
    nodes.push({
      id: `${PLUGIN_ID}:code-policy`,
      class: "code",
      ref: "mcp-s2s-inventory:code-policy",
      excerpt: redact(
        JSON.stringify(
          {
            allowsAnonymousAuthType: codePolicy.allowsAnonymousAuthType,
            authTypesMentioned: codePolicy.authTypesMentioned.slice(0, 20),
            refs: codePolicy.refs.slice(0, 8),
          },
          null,
          2,
        ).slice(0, 500),
      ),
      pluginId: PLUGIN_ID,
      gitCommit: ctx.gitCommit,
      evidenceAgeDays: 0,
      signals: [
        "mcp-s2s-inventory",
        "authn-m2",
        ...(codePolicy.allowsAnonymousAuthType ? ["auth-type-none"] : []),
      ],
      relatedCheckIds: [...RELATED],
    });

    let adminToken: string | undefined;
    if (baseUrl) {
      const auth = await resolveLiveAdminToken(ctx, baseUrl);
      authVia = auth.via;
      adminToken = auth.token;
      if (!adminToken && auth.via === "password" && auth.error) {
        liveError = `password login failed: ${auth.error}`;
      } else if (!adminToken && auth.via === "none") {
        /* needs-user below */
      }
    }

    if (baseUrl && adminToken) {
      const live = await fetchLiveInventory(baseUrl, adminToken);
      // Record sources even when the inventory is empty — proves we fetched live config.
      connections = [...connections, ...live.connections];
      inventorySource.push(...live.sources);
      measuredAt = ctx.assessedAt.toISOString();
      if (live.error) {
        liveError = liveError
          ? `${liveError}; ${live.error}`
          : live.error;
      }
    }

    // Ingest prior report file as evidence if present
    const reportExisting = join(importDir(ctx), "mcp-s2s-inventory-report.json");
    if (existsSync(reportExisting) && inventorySource.length === 0) {
      try {
        const prev = JSON.parse(
          readFileSync(reportExisting, "utf8"),
        ) as McpS2sReport;
        if (prev.connections?.length) {
          connections = prev.connections.map((c) => ({
            id: c.id,
            name: c.name,
            url: c.url,
            type: c.type,
            auth_type: c.auth_type,
            key: c.hasStaticKey ? "[redacted]" : null,
            source: "imports/mcp-s2s-inventory/mcp-s2s-inventory-report.json",
          }));
          inventorySource.push(
            "imports/mcp-s2s-inventory/mcp-s2s-inventory-report.json",
          );
          measuredAt =
            prev.measuredAt ??
            parseMeasuredAt(prev as unknown as Record<string, unknown>) ??
            prev.assessedAt ??
            measuredAt;
          productionMcpOrAiS2sConnectionsPresent =
            prev.importedScope?.productionMcpOrAiS2sConnectionsPresent ??
            productionMcpOrAiS2sConnectionsPresent;
        }
      } catch {
        /* ignore */
      }
    }

    const hasCreds =
      Boolean(resolveAdminToken(ctx)) ||
      Boolean(resolveAdminEmail(ctx) && resolveAdminPassword(ctx));

    if (inventorySource.length === 0 && !(baseUrl && hasCreds)) {
      return {
        pluginId: PLUGIN_ID,
        status: "needs-user",
        detail: `No MCP/S2S inventory yet. Code ${codePolicy.allowsAnonymousAuthType ? "ALLOWS auth_type=none" : "scanned"}. Provide imports/mcp-s2s-inventory/*.json, or --base-url with --admin-token / APRF_ADMIN_TOKEN, or --admin-email + --admin-password (APRF_ADMIN_EMAIL / APRF_ADMIN_PASSWORD) to sign in and GET /api/v1/configs/tool_servers. Set productionMcpOrAiS2sConnectionsPresent=false for NOT_APPLICABLE.${liveError ? ` (${liveError})` : ""}`,
        nodes,
      };
    }

    if (inventorySource.length === 0 && baseUrl && hasCreds && !adminToken) {
      return {
        pluginId: PLUGIN_ID,
        status: "needs-user",
        detail: `Could not obtain admin token (${liveError ?? "unknown"}). Check email/password or paste a bearer token via --admin-token.`,
        nodes,
      };
    }

    if (inventorySource.length === 0 && baseUrl && adminToken && liveError) {
      return {
        pluginId: PLUGIN_ID,
        status: "needs-user",
        detail: `Live inventory fetch failed: ${liveError}. Export tool_server.connections JSON to imports/mcp-s2s-inventory/ instead.`,
        nodes,
      };
    }

    const report = buildReport(ctx, {
      connections,
      inventorySource,
      codePolicy,
      baseUrl: baseUrl ?? null,
      measuredAt,
      productionMcpOrAiS2sConnectionsPresent,
    });
    if (authVia) {
      report.notes.push(
        `Admin auth via ${authVia === "password" ? "email/password sign-in" : authVia} (token not stored in report).`,
      );
    }

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "mcp-s2s-inventory-report.json");
    // Strip any accidental secrets from raw before write — report already redacted
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

    const satisfied = report.summary.authnM2Satisfied;
    nodes.push({
      id: `${PLUGIN_ID}:report`,
      class: "runtime",
      ref: rel(ctx.outputDir, reportPath),
      excerpt: redact(
        `AUTHN-M2 inventory: status=${report.summary.statusHint} total=${report.summary.total} pass=${report.summary.pass} fail=${report.summary.fail} satisfied=${satisfied}; sources=${inventorySource.join(",")}`,
      ),
      pluginId: PLUGIN_ID,
      lastModified: new Date().toISOString(),
      gitCommit: ctx.gitCommit,
      evidenceAgeDays: 0,
      signals: [
        "mcp-s2s-inventory",
        "authn-m2",
        "machine-identity",
        ...(satisfied === true ? ["authn-m2-pass-signal"] : []),
      ],
      relatedCheckIds: [...RELATED],
    });

    // Also attach import file nodes
    for (const [i, file] of listImportFiles(ctx.outputDir, PLUGIN_ID)
      .filter((f) => /\.json$/i.test(f))
      .entries()) {
      const mt = mtimeDate(file);
      nodes.push({
        id: `${PLUGIN_ID}:import:${i}`,
        class: "runtime",
        ref: rel(ctx.outputDir, file),
        excerpt: redact((readText(file, 400) ?? "").slice(0, 200)),
        pluginId: PLUGIN_ID,
        lastModified: mtimeIso(file),
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: ageDays(ctx.assessedAt, mt),
        signals: ["mcp-s2s-inventory", "import-export", "authn-m2"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHN-M2 status=${report.summary.statusHint} total=${report.summary.total} pass=${report.summary.pass} fail=${report.summary.fail} satisfied=${satisfied}; report=${rel(ctx.outputDir, reportPath)}`,
      nodes,
    };
  },
};
