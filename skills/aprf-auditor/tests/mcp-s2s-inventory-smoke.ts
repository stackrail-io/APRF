/**
 * Smoke: mcp-s2s-inventory scores connections and needs-user without inventory.
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
  buildReport,
  mcpS2sInventoryCollector,
  type McpS2sReport,
} from "../collectors/mcp-s2s-inventory.ts";
import type { CollectorContext } from "../collectors/types.ts";

const outDir = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-mcp-target-"));

async function main() {
  writeFileSync(
    join(targetDir, "tools.py"),
    `
# auth_type == "none": no Authorization header
auth_type = connection.get('auth_type', 'none')
if auth_type == 'oauth_2.1':
    pass
if auth_type == 'bearer':
    pass
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

  const offline = await mcpS2sInventoryCollector.collect(baseCtx);
  if (offline.status !== "needs-user") {
    throw new Error(
      `expected needs-user without inventory, got ${offline.status}: ${offline.detail}`,
    );
  }
  if (!offline.detail?.includes("auth_type=none")) {
    throw new Error(`expected code policy mention of auth_type=none: ${offline.detail}`);
  }

  // Import inventory with one bad + one good connection
  const imp = join(outDir, "imports", "mcp-s2s-inventory");
  mkdirSync(imp, { recursive: true });
  writeFileSync(
    join(imp, "tool_servers.json"),
    JSON.stringify({
      measuredAt: assessedAt.toISOString(),
      TOOL_SERVER_CONNECTIONS: [
        {
          url: "http://mcp.local/anon",
          type: "mcp",
          auth_type: "none",
          info: { id: "anon-mcp", name: "anon-mcp" },
        },
        {
          url: "http://mcp.local/oauth",
          type: "mcp",
          auth_type: "oauth_2.1",
          info: { id: "payments-mcp", name: "payments-mcp" },
        },
        {
          url: "http://tools.local/api",
          type: "openapi",
          auth_type: "bearer",
          key: "sk-should-be-redacted",
          info: { id: "static-tool", name: "static-tool" },
        },
      ],
    }),
    "utf8",
  );

  const ran = await mcpS2sInventoryCollector.collect(baseCtx);
  if (ran.status !== "ran") {
    throw new Error(`expected ran, got ${ran.status}: ${ran.detail}`);
  }
  const reportPath = join(imp, "mcp-s2s-inventory-report.json");
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as McpS2sReport;
  if (report.summary.total !== 3) {
    throw new Error(`expected 3 connections, got ${report.summary.total}`);
  }
  if (report.summary.pass !== 1 || report.summary.fail !== 2) {
    throw new Error(`expected pass=1 fail=2, got ${JSON.stringify(report.summary)}`);
  }
  if (
    report.summary.authnM2Satisfied !== false ||
    report.summary.statusHint !== "fail"
  ) {
    throw new Error(`expected fail, got ${JSON.stringify(report.summary)}`);
  }
  if (ran.nodes.some((n) => n.signals?.includes("authn-m2-fail-or-incomplete"))) {
    throw new Error("fail-or-incomplete signal should not be emitted");
  }
  const dumped = readFileSync(reportPath, "utf8");
  if (dumped.includes("sk-should-be-redacted")) {
    throw new Error("secret key leaked into report");
  }

  // OAuth/OIDC with an embedded static key must fail
  const oauthKeyOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-oauth-key-"));
  mkdirSync(join(oauthKeyOut, "imports", "mcp-s2s-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(oauthKeyOut, "imports", "mcp-s2s-inventory", "oauth-key.json"),
    JSON.stringify({
      measuredAt: assessedAt.toISOString(),
      TOOL_SERVER_CONNECTIONS: [
        {
          url: "http://mcp.local/oauth",
          type: "mcp",
          auth_type: "oauth_2.1",
          key: "sk-still-static",
          info: { id: "oauth-with-key", name: "oauth-with-key" },
        },
      ],
    }),
  );
  const oauthKeyRan = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: oauthKeyOut,
    assessedAt,
    live: false,
    maxFiles: 100,
  });
  // Do not interpolate collector/report objects into Error messages — inventory
  // imports carry static keys and CodeQL flags clear-text logging via catch.
  if (oauthKeyRan.status !== "ran") {
    throw new Error("oauth+static key collect expected status ran");
  }
  const oauthKeyReport = JSON.parse(
    readFileSync(
      join(
        oauthKeyOut,
        "imports",
        "mcp-s2s-inventory",
        "mcp-s2s-inventory-report.json",
      ),
      "utf8",
    ),
  ) as McpS2sReport;
  const oauthKeyFailed =
    oauthKeyReport.summary.statusHint === "fail" &&
    oauthKeyReport.summary.authnM2Satisfied === false &&
    oauthKeyReport.summary.pass === 0;
  if (!oauthKeyFailed) {
    throw new Error("oauth+static key must fail AUTHN-M2 (expected fail, pass=0)");
  }
  rmSync(oauthKeyOut, { recursive: true, force: true });

  // Empty inventory without N/A → partial (not vacuous PASS)
  const emptyReport = buildReport(baseCtx, {
    connections: [],
    inventorySource: ["imports/mcp-s2s-inventory/empty.json"],
    codePolicy: {
      allowsAnonymousAuthType: false,
      authTypesMentioned: [],
      refs: [],
    },
    baseUrl: null,
    measuredAt: assessedAt.toISOString(),
  });
  if (
    emptyReport.summary.statusHint !== "partial" ||
    emptyReport.summary.authnM2Satisfied !== false
  ) {
    throw new Error(
      `empty inventory without N/A should be partial, got ${JSON.stringify(emptyReport.summary)}`,
    );
  }

  // Explicit N/A
  const naReport = buildReport(baseCtx, {
    connections: [],
    inventorySource: ["imports/mcp-s2s-inventory/scope.json"],
    codePolicy: {
      allowsAnonymousAuthType: false,
      authTypesMentioned: [],
      refs: [],
    },
    baseUrl: null,
    measuredAt: assessedAt.toISOString(),
    productionMcpOrAiS2sConnectionsPresent: false,
  });
  if (naReport.summary.statusHint !== "not_applicable") {
    throw new Error(`n/a expected: ${JSON.stringify(naReport.summary)}`);
  }

  // All-good inventory → PASS
  const passReport = buildReport(baseCtx, {
    connections: [
      {
        id: "ok",
        name: "ok",
        url: "http://mcp.local/oauth",
        type: "mcp",
        auth_type: "oauth_2.1",
        source: "test",
      },
    ],
    inventorySource: ["imports/mcp-s2s-inventory/good.json"],
    codePolicy: {
      allowsAnonymousAuthType: false,
      authTypesMentioned: [],
      refs: [],
    },
    baseUrl: null,
    measuredAt: assessedAt.toISOString(),
  });
  if (
    passReport.summary.statusHint !== "pass" ||
    passReport.summary.authnM2Satisfied !== true
  ) {
    throw new Error(`pass expected: ${JSON.stringify(passReport.summary)}`);
  }

  // Password sign-in → live tool_servers (mock Open WebUI)
  const { createServer } = await import("node:http");
  const mock = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.includes("/auths/signin")) {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body) as { email?: string; password?: string };
        if (parsed.email === "admin@test.local" && parsed.password === "secret") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ token: "mock-jwt", token_type: "Bearer" }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Invalid credentials" }));
        }
      });
      return;
    }
    if (
      req.method === "GET" &&
      url.includes("/configs/tool_servers") &&
      req.headers.authorization === "Bearer mock-jwt"
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          TOOL_SERVER_CONNECTIONS: [
            {
              url: "http://mcp.local/oauth",
              type: "mcp",
              auth_type: "oauth_2.1",
              info: { id: "live-oauth", name: "live-oauth" },
            },
          ],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const addr = mock.address();
  if (!addr || typeof addr === "string") throw new Error("no mock port");
  const liveOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-live-"));
  const liveCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: liveOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    adminEmail: "admin@test.local",
    adminPassword: "secret",
  };
  const liveRan = await mcpS2sInventoryCollector.collect(liveCtx);
  mock.close();
  if (liveRan.status !== "ran") {
    throw new Error(
      `password login live expected ran, got ${liveRan.status}: ${liveRan.detail}`,
    );
  }
  const liveReport = JSON.parse(
    readFileSync(
      join(liveOut, "imports", "mcp-s2s-inventory", "mcp-s2s-inventory-report.json"),
      "utf8",
    ),
  ) as McpS2sReport;
  if (
    liveReport.summary.statusHint !== "pass" ||
    liveReport.summary.authnM2Satisfied !== true
  ) {
    throw new Error("live password login report unexpected (expected pass)");
  }
  const liveDump = readFileSync(
    join(liveOut, "imports", "mcp-s2s-inventory", "mcp-s2s-inventory-report.json"),
    "utf8",
  );
  if (liveDump.includes('"secret"')) {
    throw new Error("password leaked into report");
  }
  rmSync(liveOut, { recursive: true, force: true });

  // Live fetch must not launder a stale imported measuredAt
  const staleLiveOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-stale-live-"));
  mkdirSync(join(staleLiveOut, "imports", "mcp-s2s-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(staleLiveOut, "imports", "mcp-s2s-inventory", "stale.json"),
    JSON.stringify({
      measuredAt: "2020-01-01T00:00:00.000Z",
      TOOL_SERVER_CONNECTIONS: [
        {
          url: "http://mcp.local/oauth",
          type: "mcp",
          auth_type: "oauth_2.1",
          info: { id: "imported", name: "imported" },
        },
      ],
    }),
  );
  const staleMock = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.includes("/auths/signin")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: "stale-jwt" }));
      return;
    }
    if (req.method === "GET" && url.includes("/configs/")) {
      const key = url.includes("terminal")
        ? "TERMINAL_SERVER_CONNECTIONS"
        : "TOOL_SERVER_CONNECTIONS";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          [key]:
            key === "TOOL_SERVER_CONNECTIONS"
              ? [
                  {
                    url: "http://live.local/oauth",
                    path: "",
                    type: "mcp",
                    auth_type: "oauth_2.1",
                    info: { id: "live", name: "live" },
                  },
                ]
              : [],
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) =>
    staleMock.listen(0, "127.0.0.1", resolve),
  );
  const staleAddr = staleMock.address();
  if (!staleAddr || typeof staleAddr === "string") {
    throw new Error("no stale mock port");
  }
  const staleLive = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: staleLiveOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
    baseUrl: `http://127.0.0.1:${staleAddr.port}`,
    adminEmail: "admin@test.local",
    adminPassword: "secret",
  });
  staleMock.close();
  if (staleLive.status !== "ran") {
    throw new Error(
      `stale+live expected ran: ${staleLive.status} ${staleLive.detail}`,
    );
  }
  const staleLiveReport = JSON.parse(
    readFileSync(
      join(
        staleLiveOut,
        "imports",
        "mcp-s2s-inventory",
        "mcp-s2s-inventory-report.json",
      ),
      "utf8",
    ),
  ) as McpS2sReport;
  if (staleLiveReport.measuredAt !== "2020-01-01T00:00:00.000Z") {
    throw new Error(
      `live fetch must keep oldest measuredAt, got ${staleLiveReport.measuredAt}`,
    );
  }
  if (
    staleLiveReport.summary.statusHint !== "partial" ||
    staleLiveReport.summary.authnM2Satisfied !== false
  ) {
    throw new Error(
      `stale import + live must not PASS: ${JSON.stringify(staleLiveReport.summary)}`,
    );
  }
  rmSync(staleLiveOut, { recursive: true, force: true });

  // Empty live inventory → partial (not vacuous PASS)
  const emptyMock = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url.includes("/auths/signin")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token: "empty-jwt" }));
      return;
    }
    if (req.method === "GET" && url.includes("/configs/")) {
      const key = url.includes("terminal")
        ? "TERMINAL_SERVER_CONNECTIONS"
        : "TOOL_SERVER_CONNECTIONS";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ [key]: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => emptyMock.listen(0, "127.0.0.1", resolve));
  const emptyAddr = emptyMock.address();
  if (!emptyAddr || typeof emptyAddr === "string") throw new Error("no empty mock port");
  const emptyOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-empty-"));
  const emptyLive = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: emptyOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
    baseUrl: `http://127.0.0.1:${emptyAddr.port}`,
    adminEmail: "admin@test.local",
    adminPassword: "secret",
  });
  emptyMock.close();
  if (emptyLive.status !== "ran") {
    throw new Error(`empty live expected ran: ${emptyLive.status} ${emptyLive.detail}`);
  }
  const emptyLiveReport = JSON.parse(
    readFileSync(
      join(emptyOut, "imports", "mcp-s2s-inventory", "mcp-s2s-inventory-report.json"),
      "utf8",
    ),
  ) as McpS2sReport;
  if (emptyLiveReport.inventorySource.length === 0) {
    throw new Error("empty live fetch should still record inventorySource");
  }
  if (emptyLiveReport.summary.statusHint !== "partial") {
    throw new Error(
      `empty live without N/A should be partial, got ${JSON.stringify(emptyLiveReport.summary)}`,
    );
  }
  rmSync(emptyOut, { recursive: true, force: true });

  // Collector N/A via import
  const naOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-na-"));
  mkdirSync(join(naOut, "imports", "mcp-s2s-inventory"), { recursive: true });
  writeFileSync(
    join(naOut, "imports", "mcp-s2s-inventory", "scope.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      productionMcpOrAiS2sConnectionsPresent: false,
    }),
  );
  const naRan = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: naOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
  });
  if (naRan.status !== "ran") {
    throw new Error(`n/a collect expected ran: ${naRan.status}`);
  }
  const naCollectorReport = JSON.parse(
    readFileSync(
      join(naOut, "imports", "mcp-s2s-inventory", "mcp-s2s-inventory-report.json"),
      "utf8",
    ),
  ) as McpS2sReport;
  if (naCollectorReport.summary.statusHint !== "not_applicable") {
    throw new Error(
      `collector n/a expected: ${JSON.stringify(naCollectorReport.summary)}`,
    );
  }
  rmSync(naOut, { recursive: true, force: true });

  // Later false must not wipe earlier true (no vacuous N/A)
  const scopeOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-scope-"));
  mkdirSync(join(scopeOut, "imports", "mcp-s2s-inventory"), { recursive: true });
  writeFileSync(
    join(scopeOut, "imports", "mcp-s2s-inventory", "a-present.json"),
    JSON.stringify({
      measuredAt: "2020-01-01T00:00:00.000Z",
      productionMcpOrAiS2sConnectionsPresent: true,
      TOOL_SERVER_CONNECTIONS: [
        {
          url: "http://mcp.local/oauth",
          type: "mcp",
          auth_type: "oauth_2.1",
          info: { id: "ok", name: "ok" },
        },
      ],
    }),
  );
  writeFileSync(
    join(scopeOut, "imports", "mcp-s2s-inventory", "z-absent.json"),
    JSON.stringify({
      measuredAt: assessedAt.toISOString(),
      productionMcpOrAiS2sConnectionsPresent: false,
    }),
  );
  const scopeRan = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: scopeOut,
    assessedAt,
    live: false,
    maxFiles: 100,
  });
  if (scopeRan.status !== "ran") {
    throw new Error(`scope merge expected ran: ${scopeRan.status}`);
  }
  const scopeReport = JSON.parse(
    readFileSync(
      join(
        scopeOut,
        "imports",
        "mcp-s2s-inventory",
        "mcp-s2s-inventory-report.json",
      ),
      "utf8",
    ),
  ) as McpS2sReport;
  if (scopeReport.summary.statusHint === "not_applicable") {
    throw new Error("present=true must win over later false — should not N/A");
  }
  if (scopeReport.measuredAt !== "2020-01-01T00:00:00.000Z") {
    throw new Error(
      `expected oldest measuredAt, got ${scopeReport.measuredAt}`,
    );
  }
  if (
    scopeReport.summary.statusHint !== "partial" ||
    scopeReport.summary.authnM2Satisfied !== false
  ) {
    throw new Error(
      `stale oldest measuredAt should block PASS: ${JSON.stringify(scopeReport.summary)}`,
    );
  }
  rmSync(scopeOut, { recursive: true, force: true });

  // Import inventory without measuredAt must not invent freshness / PASS
  const noMtOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-nomt-"));
  mkdirSync(join(noMtOut, "imports", "mcp-s2s-inventory"), { recursive: true });
  writeFileSync(
    join(noMtOut, "imports", "mcp-s2s-inventory", "oauth.json"),
    JSON.stringify({
      TOOL_SERVER_CONNECTIONS: [
        {
          url: "http://mcp.local/oauth",
          type: "mcp",
          auth_type: "oauth_2.1",
          info: { id: "oauth-only", name: "oauth-only" },
        },
      ],
    }),
  );
  const noMtRan = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: noMtOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
  });
  if (noMtRan.status !== "ran") {
    throw new Error("missing measuredAt collect expected ran");
  }
  const noMtReport = JSON.parse(
    readFileSync(
      join(
        noMtOut,
        "imports",
        "mcp-s2s-inventory",
        "mcp-s2s-inventory-report.json",
      ),
      "utf8",
    ),
  ) as McpS2sReport;
  if (noMtReport.measuredAt !== null) {
    throw new Error("missing import measuredAt must stay null (not assessedAt)");
  }
  if (
    noMtReport.summary.statusHint !== "partial" ||
    noMtReport.summary.authnM2Satisfied !== false
  ) {
    throw new Error("missing measuredAt must block AUTHN-M2 PASS");
  }
  rmSync(noMtOut, { recursive: true, force: true });

  // Prior N/A report with empty connections must stay N/A (not needs-user)
  const priorNaOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-prior-na-"));
  mkdirSync(join(priorNaOut, "imports", "mcp-s2s-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(
      priorNaOut,
      "imports",
      "mcp-s2s-inventory",
      "mcp-s2s-inventory-report.json",
    ),
    JSON.stringify({
      schemaVersion: "0.2.0",
      pluginId: "mcp-s2s-inventory",
      assessedAt: assessedAt.toISOString(),
      measuredAt: assessedAt.toISOString(),
      connections: [],
      importedScope: { productionMcpOrAiS2sConnectionsPresent: false },
      summary: {
        total: 0,
        pass: 0,
        fail: 0,
        authnM2Satisfied: null,
        statusHint: "not_applicable",
      },
      notes: [],
      inventorySource: [],
      codePolicy: {
        allowsAnonymousAuthType: false,
        authTypesMentioned: [],
        refs: [],
      },
      baseUrl: null,
    }),
  );
  const priorNaRan = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: priorNaOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
  });
  if (priorNaRan.status !== "ran") {
    throw new Error(
      `prior N/A report must stay ran/N/A, got ${priorNaRan.status}`,
    );
  }
  const priorNaReport = JSON.parse(
    readFileSync(
      join(
        priorNaOut,
        "imports",
        "mcp-s2s-inventory",
        "mcp-s2s-inventory-report.json",
      ),
      "utf8",
    ),
  ) as McpS2sReport;
  if (priorNaReport.summary.statusHint !== "not_applicable") {
    throw new Error(
      `prior empty N/A report must stay not_applicable: ${priorNaReport.summary.statusHint}`,
    );
  }
  rmSync(priorNaOut, { recursive: true, force: true });

  // Prior report without measuredAt must not launder assessedAt into PASS
  const priorNoMtOut = mkdtempSync(join(tmpdir(), "aprf-mcp-s2s-prior-nomt-"));
  mkdirSync(join(priorNoMtOut, "imports", "mcp-s2s-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(
      priorNoMtOut,
      "imports",
      "mcp-s2s-inventory",
      "mcp-s2s-inventory-report.json",
    ),
    JSON.stringify({
      schemaVersion: "0.2.0",
      pluginId: "mcp-s2s-inventory",
      assessedAt: assessedAt.toISOString(),
      measuredAt: null,
      connections: [
        {
          id: "oauth-only",
          name: "oauth-only",
          url: "http://mcp.local/oauth",
          type: "mcp",
          auth_type: "oauth_2.1",
          hasStaticKey: false,
          ok: true,
          reason: "ok",
        },
      ],
      importedScope: { productionMcpOrAiS2sConnectionsPresent: true },
      summary: {
        total: 1,
        pass: 1,
        fail: 0,
        authnM2Satisfied: true,
        statusHint: "pass",
      },
      notes: [],
      inventorySource: ["prior"],
      codePolicy: {
        allowsAnonymousAuthType: false,
        authTypesMentioned: [],
        refs: [],
      },
      baseUrl: null,
    }),
  );
  const priorNoMtRan = await mcpS2sInventoryCollector.collect({
    targetPath: targetDir,
    outputDir: priorNoMtOut,
    assessedAt: new Date(),
    live: false,
    maxFiles: 100,
  });
  if (priorNoMtRan.status !== "ran") {
    throw new Error("prior report without measuredAt expected ran");
  }
  const priorNoMtReport = JSON.parse(
    readFileSync(
      join(
        priorNoMtOut,
        "imports",
        "mcp-s2s-inventory",
        "mcp-s2s-inventory-report.json",
      ),
      "utf8",
    ),
  ) as McpS2sReport;
  if (priorNoMtReport.measuredAt !== null) {
    throw new Error("prior report must not invent measuredAt from assessedAt");
  }
  if (
    priorNoMtReport.summary.statusHint === "pass" ||
    priorNoMtReport.summary.authnM2Satisfied === true
  ) {
    throw new Error("prior report without measuredAt must not PASS");
  }
  rmSync(priorNoMtOut, { recursive: true, force: true });

  console.log("aprf-auditor mcp-s2s-inventory smoke OK");
  rmSync(outDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
}

main().catch((e: unknown) => {
  // Never log the raw Error object — it may carry inventory-tainted report text.
  console.error(e instanceof Error ? e.message : String(e));
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
