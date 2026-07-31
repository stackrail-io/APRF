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
  if (report.summary.authnM2Satisfied !== false) {
    throw new Error("expected authnM2Satisfied=false");
  }
  if (!ran.nodes.some((n) => n.signals?.includes("authn-m2-fail-or-incomplete"))) {
    throw new Error("missing fail signal");
  }
  const dumped = readFileSync(reportPath, "utf8");
  if (dumped.includes("sk-should-be-redacted")) {
    throw new Error("secret key leaked into report");
  }

  // Vacuous empty inventory
  const emptyReport = buildReport(baseCtx, {
    connections: [],
    inventorySource: ["imports/mcp-s2s-inventory/empty.json"],
    codePolicy: {
      allowsAnonymousAuthType: false,
      authTypesMentioned: [],
      refs: [],
    },
    baseUrl: null,
  });
  if (emptyReport.summary.authnM2Satisfied !== true) {
    throw new Error("empty inventory should vacuously satisfy");
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
  if (liveReport.summary.total < 1 || liveReport.summary.pass < 1) {
    throw new Error(`live password login report unexpected: ${JSON.stringify(liveReport.summary)}`);
  }
  if (JSON.stringify(liveReport).includes("secret")) {
    throw new Error("password leaked into report");
  }
  rmSync(liveOut, { recursive: true, force: true });

  // Empty live inventory still records sources → vacuous pass
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
  if (emptyLiveReport.summary.authnM2Satisfied !== true) {
    throw new Error(
      `empty live inventory should vacuously satisfy, got ${emptyLiveReport.summary.authnM2Satisfied}`,
    );
  }
  rmSync(emptyOut, { recursive: true, force: true });

  console.log("aprf-auditor mcp-s2s-inventory smoke OK");
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
