/**
 * Smoke: RFC-0015 exercise collectors + capability graph.
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
  agentTraceAttributesCollector,
  evalMethodologyCollector,
  harnessIntegrityCollector,
} from "../collectors/rfc0015-collectors.ts";
import { agentCapabilityGraphCollector } from "../collectors/agent-capability-graph.ts";
import type { CollectorContext } from "../collectors/types.ts";

function deniedCases(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    denied: true,
    outcome: "denied",
  }));
}

const ctxBase = {
  assessedAt: new Date(),
  live: false,
  maxFiles: 500,
};

async function collect(
  c: typeof harnessIntegrityCollector,
  target: string,
  outDir: string,
) {
  return c.collect({
    targetPath: target,
    outputDir: outDir,
    ...ctxBase,
  } as CollectorContext);
}

function report(outDir: string, plugin: string) {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", plugin, `${plugin}-report.json`),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-rfc0015-"));
  try {
    const empty = join(root, "empty");
    mkdirSync(empty);
    const o0 = join(root, "o0");
    mkdirSync(o0);
    await collect(harnessIntegrityCollector, empty, o0);
    const r0 = report(o0, "harness-integrity");
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`empty expected not_demonstrated: ${r0.summary.statusHint}`);
    }

    const t1 = join(root, "t1");
    mkdirSync(join(t1, "src"), { recursive: true });
    writeFileSync(
      join(t1, "src", "tool_gateway.py"),
      "def tool_gateway():\n  deny_unregistered_tool()\n",
    );
    const o1 = join(root, "o1");
    mkdirSync(o1);
    await collect(harnessIntegrityCollector, t1, o1);
    const r1 = report(o1, "harness-integrity");
    if (r1.summary.statusHint !== "partial") {
      throw new Error(`repo-only expected partial: ${JSON.stringify(r1.summary)}`);
    }

    const oBool = join(root, "oBool");
    mkdirSync(join(oBool, "imports", "harness-integrity"), { recursive: true });
    writeFileSync(
      join(oBool, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
      }),
    );
    await collect(harnessIntegrityCollector, t1, oBool);
    const rBool = report(oBool, "harness-integrity");
    if (
      rBool.summary.statusHint !== "partial" ||
      rBool.summary.measuredEvidence !== false
    ) {
      throw new Error(
        `boolean-only must be partial, measuredEvidence=false: ${JSON.stringify(rBool.summary)}`,
      );
    }

    const o2 = join(root, "o2");
    mkdirSync(join(o2, "imports", "harness-integrity"), { recursive: true });
    writeFileSync(
      join(o2, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: deniedCases(5),
      }),
    );
    await collect(harnessIntegrityCollector, t1, o2);
    const r2 = report(o2, "harness-integrity");
    if (
      r2.summary.statusHint !== "pass" ||
      r2.summary.measuredEvidence !== true
    ) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const oCount = join(root, "oCount");
    mkdirSync(join(oCount, "imports", "harness-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(oCount, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        caseCount: 5,
        runCount: 5,
      }),
    );
    await collect(harnessIntegrityCollector, t1, oCount);
    const rCount = report(oCount, "harness-integrity");
    if (
      rCount.summary.statusHint !== "partial" ||
      rCount.summary.measuredEvidence !== false
    ) {
      throw new Error(
        `numeric caseCount must not PASS: ${JSON.stringify(rCount.summary)}`,
      );
    }

    const oEmpty = join(root, "oEmpty");
    mkdirSync(join(oEmpty, "imports", "harness-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(oEmpty, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: [0, 0, 0, 0, 0, {}, "x"],
      }),
    );
    await collect(harnessIntegrityCollector, t1, oEmpty);
    const rEmpty = report(oEmpty, "harness-integrity");
    if (
      rEmpty.summary.statusHint !== "partial" ||
      rEmpty.summary.measuredEvidence !== false
    ) {
      throw new Error(
        `empty/non-object cases must not PASS: ${JSON.stringify(rEmpty.summary)}`,
      );
    }

    const oObs = join(root, "oObs");
    mkdirSync(join(oObs, "imports", "agent-trace-attributes"), {
      recursive: true,
    });
    writeFileSync(
      join(oObs, "imports", "agent-trace-attributes", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentRequestPathPresent: true,
        redactionConsistentWithSensitiveFieldPolicy: true,
        reconstructableAttributeCoveragePct: 99,
      }),
    );
    await agentTraceAttributesCollector.collect({
      targetPath: empty,
      outputDir: oObs,
      ...ctxBase,
    } as CollectorContext);
    const rObs = report(oObs, "agent-trace-attributes");
    if (
      rObs.summary.statusHint !== "partial" ||
      rObs.summary.measuredEvidence !== false
    ) {
      throw new Error(
        `OBS-M3 pct-only must be partial: ${JSON.stringify(rObs.summary)}`,
      );
    }

    const oObsOk = join(root, "oObsOk");
    mkdirSync(join(oObsOk, "imports", "agent-trace-attributes"), {
      recursive: true,
    });
    writeFileSync(
      join(oObsOk, "imports", "agent-trace-attributes", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentRequestPathPresent: true,
        redactionConsistentWithSensitiveFieldPolicy: true,
        reconstructableAttributeCoveragePct: 99,
        samples: [
          { id: "s1", outcome: "success" },
          { id: "s2", success: true },
        ],
      }),
    );
    await agentTraceAttributesCollector.collect({
      targetPath: empty,
      outputDir: oObsOk,
      ...ctxBase,
    } as CollectorContext);
    const rObsOk = report(oObsOk, "agent-trace-attributes");
    if (
      rObsOk.summary.statusHint !== "pass" ||
      rObsOk.summary.measuredEvidence !== true
    ) {
      throw new Error(
        `OBS-M3 sample success must PASS not FAIL: ${JSON.stringify(rObsOk.summary)}`,
      );
    }

    const o3 = join(root, "o3");
    mkdirSync(join(o3, "imports", "harness-integrity"), { recursive: true });
    writeFileSync(
      join(o3, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: false,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: deniedCases(5),
      }),
    );
    await collect(harnessIntegrityCollector, t1, o3);
    const r3 = report(o3, "harness-integrity");
    if (r3.summary.statusHint !== "fail") {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const o4 = join(root, "o4");
    mkdirSync(join(o4, "imports", "harness-integrity"), { recursive: true });
    writeFileSync(
      join(o4, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: false,
      }),
    );
    await collect(harnessIntegrityCollector, empty, o4);
    const r4 = report(o4, "harness-integrity");
    if (r4.summary.statusHint !== "not_applicable" || !r4.summary.naReason) {
      throw new Error(`na expected with reason: ${JSON.stringify(r4.summary)}`);
    }

    const og = join(root, "og");
    mkdirSync(og);
    writeFileSync(
      join(og, "agent-inventory.json"),
      JSON.stringify({
        schemaVersion: "0.1.0",
        inventoryId: "inv-test",
        generatedAt: ctxBase.assessedAt.toISOString(),
        agents: [
          {
            agentId: "a1",
            tools: ["search"],
            mcpServers: ["kb"],
          },
        ],
      }),
    );
    const g1 = await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: og,
      ...ctxBase,
    } as CollectorContext);
    const graph = JSON.parse(
      readFileSync(join(og, "agent-capability-graph.json"), "utf8"),
    );
    if (!graph.edges?.length) {
      throw new Error("expected graph edges from inventory");
    }
    if (g1.nodes[0]?.signals?.includes("mcp.confused_deputy.path")) {
      throw new Error("sibling tool+mcp must not emit confused deputy");
    }

    const og2 = join(root, "og2");
    mkdirSync(join(og2, "imports", "agent-capability-graph"), {
      recursive: true,
    });
    writeFileSync(
      join(og2, "imports", "agent-capability-graph", "graph.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "mcp:kb", type: "MCPServer", evidenceNodeIds: ["imp"] },
          { id: "api:crm", type: "API", evidenceNodeIds: ["imp"] },
          { id: "db:cust", type: "Database", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "e1",
            from: "agent:a1",
            to: "mcp:kb",
            rel: "agent_connects_to_mcp",
            accessKind: "direct",
            signalKind: "config",
            evidenceNodeIds: ["imp"],
          },
          {
            id: "e2",
            from: "mcp:kb",
            to: "api:crm",
            rel: "tool_invokes_api",
            accessKind: "transitive",
            signalKind: "inferred",
            evidenceNodeIds: ["imp"],
          },
          {
            id: "e3",
            from: "api:crm",
            to: "db:cust",
            rel: "tool_accesses_database",
            accessKind: "transitive",
            signalKind: "inferred",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    const g2 = await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: og2,
      ...ctxBase,
      maxFiles: 50,
    } as CollectorContext);
    const graph2 = JSON.parse(
      readFileSync(join(og2, "agent-capability-graph.json"), "utf8"),
    );
    if (
      !graph2.derivedPaths?.some(
        (p: { edgeIds: string[] }) => p.edgeIds.length >= 3,
      )
    ) {
      throw new Error("expected depth>2 derived path Agent→MCP→API→DB");
    }
    if (!g2.nodes[0]?.signals?.includes("mcp.confused_deputy.path")) {
      throw new Error(
        `expected confused deputy on MCP→API→DB: ${JSON.stringify(g2.nodes[0]?.signals)}`,
      );
    }

    const og3 = join(root, "og3");
    mkdirSync(join(og3, "imports", "agent-capability-graph"), {
      recursive: true,
    });
    writeFileSync(
      join(og3, "imports", "agent-capability-graph", "graph.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "api:crm", type: "API", evidenceNodeIds: ["imp"] },
          { id: "mcp:kb", type: "MCPServer", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "r1",
            from: "agent:a1",
            to: "api:crm",
            rel: "tool_invokes_api",
            accessKind: "direct",
            signalKind: "config",
            evidenceNodeIds: ["imp"],
          },
          {
            id: "r2",
            from: "api:crm",
            to: "mcp:kb",
            rel: "agent_connects_to_mcp",
            accessKind: "transitive",
            signalKind: "inferred",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    const g3 = await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: og3,
      ...ctxBase,
      maxFiles: 50,
    } as CollectorContext);
    if (g3.nodes[0]?.signals?.includes("mcp.confused_deputy.path")) {
      throw new Error(
        `API then MCP must not emit confused deputy: ${JSON.stringify(g3.nodes[0]?.signals)}`,
      );
    }

    const oMix = join(root, "oMix");
    mkdirSync(join(oMix, "imports", "harness-integrity"), { recursive: true });
    writeFileSync(
      join(oMix, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: [...deniedCases(5), { outcome: "success" }],
      }),
    );
    await collect(harnessIntegrityCollector, t1, oMix);
    const rMix = report(oMix, "harness-integrity");
    if (rMix.summary.statusHint !== "fail") {
      throw new Error(
        `mixed deny+success must FAIL: ${JSON.stringify(rMix.summary)}`,
      );
    }

    const oNull = join(root, "oNull");
    mkdirSync(join(oNull, "imports", "harness-integrity"), { recursive: true });
    writeFileSync(
      join(oNull, "imports", "harness-integrity", "null.json"),
      "null",
    );
    await collect(harnessIntegrityCollector, empty, oNull);
    const rNull = report(oNull, "harness-integrity");
    if (rNull.summary.statusHint !== "not_demonstrated") {
      throw new Error(
        `null JSON import must skip: ${JSON.stringify(rNull.summary)}`,
      );
    }

    const oTools = join(root, "oTools");
    mkdirSync(join(oTools, "imports", "eval-methodology"), { recursive: true });
    writeFileSync(
      join(oTools, "imports", "eval-methodology", "a.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsPresent: true,
        datasetsVersioned: true,
        runsLinkedToAgentVersion: true,
        successNotSelfReported: true,
        securityCasesNotLlmJudgeOnly: true,
        toolsPresent: true,
        toolUseCasesPresent: false,
        cases: [{ id: "e1", outcome: "success" }],
      }),
    );
    writeFileSync(
      join(oTools, "imports", "eval-methodology", "b.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentsPresent: true,
        datasetsVersioned: true,
        runsLinkedToAgentVersion: true,
        successNotSelfReported: true,
        securityCasesNotLlmJudgeOnly: true,
        toolsPresent: false,
        toolUseCasesPresent: true,
        cases: [{ id: "e2", outcome: "success" }],
      }),
    );
    await evalMethodologyCollector.collect({
      targetPath: empty,
      outputDir: oTools,
      ...ctxBase,
    } as CollectorContext);
    const rTools = report(oTools, "eval-methodology");
    if (rTools.summary.statusHint !== "fail") {
      throw new Error(
        `toolsPresent true from any file must still require tool-use: ${JSON.stringify(rTools.summary)}`,
      );
    }

    const ogMerge = join(root, "ogMerge");
    mkdirSync(join(ogMerge, "imports", "agent-capability-graph"), {
      recursive: true,
    });
    writeFileSync(
      join(ogMerge, "imports", "agent-capability-graph", "a.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "mcp:kb", type: "MCPServer", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "m1",
            from: "agent:a1",
            to: "mcp:kb",
            rel: "agent_connects_to_mcp",
            accessKind: "direct",
            signalKind: "config",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    writeFileSync(
      join(ogMerge, "imports", "agent-capability-graph", "b.json"),
      JSON.stringify({
        nodes: [
          { id: "api:crm", type: "API", evidenceNodeIds: ["imp"] },
          { id: "db:cust", type: "Database", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "m2",
            from: "mcp:kb",
            to: "api:crm",
            rel: "tool_invokes_api",
            accessKind: "transitive",
            signalKind: "inferred",
            evidenceNodeIds: ["imp"],
          },
          {
            id: "m3",
            from: "api:crm",
            to: "db:cust",
            rel: "tool_accesses_database",
            accessKind: "transitive",
            signalKind: "inferred",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: ogMerge,
      ...ctxBase,
      maxFiles: 50,
    } as CollectorContext);
    const graphMerge = JSON.parse(
      readFileSync(join(ogMerge, "agent-capability-graph.json"), "utf8"),
    );
    if (
      !graphMerge.derivedPaths?.some(
        (p: { edgeIds: string[] }) => p.edgeIds.length >= 3,
      )
    ) {
      throw new Error("expected merged overlays Agent→MCP→API→DB");
    }

    const ogStale = join(root, "ogStale");
    mkdirSync(ogStale);
    writeFileSync(
      join(ogStale, "agent-inventory.json"),
      JSON.stringify({
        schemaVersion: "0.1.0",
        inventoryId: "inv-stale",
        generatedAt: "2020-01-01T00:00:00.000Z",
        agents: [
          { agentId: "stale", tools: ["search"], mcpServers: ["kb"] },
        ],
      }),
    );
    await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: ogStale,
      ...ctxBase,
    } as CollectorContext);
    const graphStale = JSON.parse(
      readFileSync(join(ogStale, "agent-capability-graph.json"), "utf8"),
    );
    if (graphStale.edges?.length) {
      throw new Error("stale inventory must not seed graph edges");
    }

    const oConflict = join(root, "oConflict");
    mkdirSync(join(oConflict, "imports", "harness-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(oConflict, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: [
          ...deniedCases(4),
          { denied: true, unauthorizedSuccess: true },
        ],
      }),
    );
    await collect(harnessIntegrityCollector, t1, oConflict);
    const rConflict = report(oConflict, "harness-integrity");
    if (rConflict.summary.statusHint !== "fail") {
      throw new Error(
        `denied+unauthorizedSuccess must FAIL: ${JSON.stringify(rConflict.summary)}`,
      );
    }

    const oStaleNa = join(root, "oStaleNa");
    mkdirSync(join(oStaleNa, "imports", "harness-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(oStaleNa, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: "2020-01-01T00:00:00.000Z",
        toolOrMcpSideEffectsPresent: false,
      }),
    );
    await collect(harnessIntegrityCollector, empty, oStaleNa);
    const rStaleNa = report(oStaleNa, "harness-integrity");
    if (rStaleNa.summary.statusHint === "not_applicable") {
      throw new Error(
        `stale surface=false must not N/A: ${JSON.stringify(rStaleNa.summary)}`,
      );
    }

    const ogDup = join(root, "ogDup");
    mkdirSync(join(ogDup, "imports", "agent-capability-graph"), {
      recursive: true,
    });
    writeFileSync(
      join(ogDup, "imports", "agent-capability-graph", "a.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "mcp:kb", type: "MCPServer", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "e1",
            from: "agent:a1",
            to: "mcp:kb",
            rel: "agent_connects_to_mcp",
            accessKind: "direct",
            signalKind: "config",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    writeFileSync(
      join(ogDup, "imports", "agent-capability-graph", "b.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "api:crm", type: "API", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "e1",
            from: "agent:a1",
            to: "api:crm",
            rel: "tool_invokes_api",
            accessKind: "direct",
            signalKind: "inferred",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: ogDup,
      ...ctxBase,
      maxFiles: 50,
    } as CollectorContext);
    const graphDup = JSON.parse(
      readFileSync(join(ogDup, "agent-capability-graph.json"), "utf8"),
    );
    const hops = (graphDup.edges ?? []).map(
      (e: { from: string; to: string }) => `${e.from}->${e.to}`,
    );
    if (
      !hops.includes("agent:a1->mcp:kb") ||
      !hops.includes("agent:a1->api:crm")
    ) {
      throw new Error(
        `reused edge id must keep both hops: ${JSON.stringify(hops)}`,
      );
    }
    const dupIds = (graphDup.edges ?? []).map((e: { id: string }) => e.id);
    if (new Set(dupIds).size !== dupIds.length) {
      throw new Error(`derived-path edge ids must stay unique: ${dupIds}`);
    }

    const oMixArr = join(root, "oMixArr");
    mkdirSync(join(oMixArr, "imports", "harness-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(oMixArr, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: deniedCases(5),
        results: [{ unauthorizedSuccess: true }],
      }),
    );
    await collect(harnessIntegrityCollector, t1, oMixArr);
    const rMixArr = report(oMixArr, "harness-integrity");
    if (rMixArr.summary.statusHint !== "fail") {
      throw new Error(
        `unauthorized in results[] must FAIL: ${JSON.stringify(rMixArr.summary)}`,
      );
    }

    const oDenySuccess = join(root, "oDenySuccess");
    mkdirSync(join(oDenySuccess, "imports", "harness-integrity"), {
      recursive: true,
    });
    writeFileSync(
      join(oDenySuccess, "imports", "harness-integrity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrMcpSideEffectsPresent: true,
        outOfBandInvokeDenied: true,
        unregisteredToolDenied: true,
        disabledMiddlewareDenied: true,
        dynamicRegistrationDenied: true,
        toolSubstitutionDenied: true,
        cases: [...deniedCases(4), { denied: true, outcome: "success" }],
      }),
    );
    await collect(harnessIntegrityCollector, t1, oDenySuccess);
    const rDenySuccess = report(oDenySuccess, "harness-integrity");
    if (rDenySuccess.summary.statusHint !== "fail") {
      throw new Error(
        `denied+outcome success must FAIL: ${JSON.stringify(rDenySuccess.summary)}`,
      );
    }

    const ogDel = join(root, "ogDel");
    mkdirSync(join(ogDel, "imports", "agent-capability-graph"), {
      recursive: true,
    });
    writeFileSync(
      join(ogDel, "imports", "agent-capability-graph", "a.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "mcp:kb", type: "MCPServer", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "d1",
            from: "agent:a1",
            to: "mcp:kb",
            rel: "agent_connects_to_mcp",
            accessKind: "direct",
            signalKind: "config",
            evidenceNodeIds: ["imp"],
          },
        ],
      }),
    );
    writeFileSync(
      join(ogDel, "imports", "agent-capability-graph", "b.json"),
      JSON.stringify({
        nodes: [
          { id: "agent:a1", type: "Agent", evidenceNodeIds: ["imp"] },
          { id: "mcp:kb", type: "MCPServer", evidenceNodeIds: ["imp"] },
        ],
        edges: [
          {
            id: "d1",
            from: "agent:a1",
            to: "mcp:kb",
            rel: "agent_connects_to_mcp",
            accessKind: "delegated",
            signalKind: "inferred",
            evidenceNodeIds: ["imp2"],
          },
        ],
      }),
    );
    const gDel = await agentCapabilityGraphCollector.collect({
      targetPath: empty,
      outputDir: ogDel,
      ...ctxBase,
      maxFiles: 50,
    } as CollectorContext);
    if (!gDel.nodes[0]?.signals?.includes("agent.graph.edge_delegated")) {
      throw new Error(
        `delegated overlay on same hop must emit: ${JSON.stringify(gDel.nodes[0]?.signals)}`,
      );
    }

    console.log("rfc0015-collectors smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
