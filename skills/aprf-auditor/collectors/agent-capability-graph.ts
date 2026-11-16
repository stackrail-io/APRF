/**
 * Builds aprf-assessment/agent-capability-graph.json from inventory, repo
 * heuristics, and optional imports. Emits graph signals; does not PASS Checks.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import { withReportEvidenceTypes } from "./lib/evidence-types.ts";

const PLUGIN_ID = "agent-capability-graph";
const DETECTOR_ID = "repo-agent-capability-graph";
const RELATED = ["TOL-M6"] as const;

type GraphNode = {
  id: string;
  type: string;
  label?: string;
  agentId?: string;
  evidenceNodeIds: string[];
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  rel: string;
  accessKind: "direct" | "transitive" | "delegated" | "shared_credential" | "cross_agent";
  signalKind: "config" | "inferred" | "exercise";
  evidenceNodeIds: string[];
};

const GRAPH_EVIDENCE_ID = `${PLUGIN_ID}:graph`;
const INVENTORY_EVIDENCE_ID = "agent-charter-inventory:report";
const DATA_TYPES = new Set([
  "API",
  "Database",
  "DataSource",
  "FileSystem",
  "Secret",
  "ExternalService",
]);
const MAX_PATH_DEPTH = 4;
const MAX_PATHS = 64;

function scanRefs(targetPath: string, maxFiles: number, re: RegExp): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 2000),
    extensions: [".py", ".ts", ".js", ".yml", ".yaml", ".json", ".md"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 40_000) || "";
    if (re.test(r) || re.test(text)) refs.push(r);
    if (refs.length >= 12) break;
  }
  return [...new Set(refs)];
}

export const agentCapabilityGraphCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const inventoryPath = join(ctx.outputDir, "agent-inventory.json");
    let inventoryId: string | undefined;
    if (existsSync(inventoryPath)) {
      try {
        const inv = JSON.parse(readFileSync(inventoryPath, "utf8")) as {
          inventoryId?: string;
          agents?: Array<{
            agentId?: string;
            tools?: string[];
            mcpServers?: string[];
          }>;
        };
        inventoryId = inv.inventoryId;
        for (const a of inv.agents ?? []) {
          if (!a.agentId) continue;
          const nid = `agent:${a.agentId}`;
          nodes.push({
            id: nid,
            type: "Agent",
            agentId: a.agentId,
            evidenceNodeIds: [INVENTORY_EVIDENCE_ID],
          });
          for (const t of a.tools ?? []) {
            const tid = `tool:${t}`;
            if (!nodes.some((n) => n.id === tid)) {
              nodes.push({
                id: tid,
                type: "Tool",
                label: t,
                evidenceNodeIds: [INVENTORY_EVIDENCE_ID],
              });
            }
            edges.push({
              id: `${nid}->${tid}`,
              from: nid,
              to: tid,
              rel: "agent_invokes_tool",
              accessKind: "direct",
              signalKind: "config",
              evidenceNodeIds: [INVENTORY_EVIDENCE_ID],
            });
          }
          for (const m of a.mcpServers ?? []) {
            const mid = `mcp:${m}`;
            if (!nodes.some((n) => n.id === mid)) {
              nodes.push({
                id: mid,
                type: "MCPServer",
                label: m,
                evidenceNodeIds: [INVENTORY_EVIDENCE_ID],
              });
            }
            edges.push({
              id: `${nid}->${mid}`,
              from: nid,
              to: mid,
              rel: "agent_connects_to_mcp",
              accessKind: "direct",
              signalKind: "config",
              evidenceNodeIds: [INVENTORY_EVIDENCE_ID],
            });
          }
        }
      } catch {
        /* ignore malformed inventory */
      }
    }

    const mcpRefs = scanRefs(
      ctx.targetPath,
      ctx.maxFiles ?? 4000,
      /\bmcp[_-]?(server|config)\b/i,
    );
    const toolRefs = scanRefs(
      ctx.targetPath,
      ctx.maxFiles ?? 4000,
      /\b(tool[_-]?handler|function_call)\b/i,
    );
    let importedGraph: { nodes?: unknown; edges?: unknown } | null = null;
    for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
      if (f.endsWith(`${PLUGIN_ID}-report.json`)) continue;
      const text = readText(f);
      if (!text) continue;
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          importedGraph = parsed as { nodes?: unknown; edges?: unknown };
        }
      } catch {
        continue;
      }
    }
    if (Array.isArray(importedGraph?.nodes)) {
      for (const n of importedGraph.nodes) {
        if (!n || typeof n !== "object" || Array.isArray(n)) continue;
        const raw = n as GraphNode;
        if (typeof raw.id !== "string" || !raw.id) continue;
        const node: GraphNode = {
          ...raw,
          id: raw.id,
          type: typeof raw.type === "string" ? raw.type : "ExternalService",
          evidenceNodeIds:
            Array.isArray(raw.evidenceNodeIds) && raw.evidenceNodeIds.length > 0
              ? raw.evidenceNodeIds.filter((id) => typeof id === "string")
              : [GRAPH_EVIDENCE_ID],
        };
        if (!nodes.some((x) => x.id === node.id)) nodes.push(node);
      }
    }
    if (Array.isArray(importedGraph?.edges)) {
      for (const e of importedGraph.edges) {
        if (!e || typeof e !== "object" || Array.isArray(e)) continue;
        const raw = e as GraphEdge;
        if (
          typeof raw.id !== "string" ||
          typeof raw.from !== "string" ||
          typeof raw.to !== "string"
        ) {
          continue;
        }
        const edge: GraphEdge = {
          ...raw,
          id: raw.id,
          from: raw.from,
          to: raw.to,
          rel: typeof raw.rel === "string" ? raw.rel : "agent_invokes_tool",
          accessKind: raw.accessKind ?? "direct",
          signalKind: raw.signalKind ?? "inferred",
          evidenceNodeIds:
            Array.isArray(raw.evidenceNodeIds) && raw.evidenceNodeIds.length > 0
              ? raw.evidenceNodeIds.filter((id) => typeof id === "string")
              : [GRAPH_EVIDENCE_ID],
        };
        if (!edges.some((x) => x.id === edge.id)) edges.push(edge);
      }
    }

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const byFrom = new Map<string, GraphEdge[]>();
    for (const e of edges) {
      const list = byFrom.get(e.from) ?? [];
      list.push(e);
      byFrom.set(e.from, list);
    }
    const derivedPaths: Array<{
      id: string;
      from: string;
      to: string;
      edgeIds: string[];
      riskHint: "data_access" | "privilege_escalation" | "other";
      signalKind: "inferred";
      evidenceNodeIds: string[];
    }> = [];
    const walk = (start: string, edgeAcc: GraphEdge[], depth: number) => {
      if (derivedPaths.length >= MAX_PATHS) return;
      if (depth >= MAX_PATH_DEPTH) return;
      for (const e of byFrom.get(edgeAcc.length ? edgeAcc[edgeAcc.length - 1]!.to : start) ?? []) {
        if (edgeAcc.some((x) => x.id === e.id)) continue;
        const next = [...edgeAcc, e];
        if (next.length >= 2) {
          const terminal = nodeById.get(e.to);
          const hops = next.map((x) => nodeById.get(x.to)?.type);
          const dataHop = hops.some((t) => t != null && DATA_TYPES.has(t));
          derivedPaths.push({
            id: next.map((x) => x.id).join("=>"),
            from: next[0]!.from,
            to: e.to,
            edgeIds: next.map((x) => x.id),
            riskHint:
              dataHop || (terminal != null && DATA_TYPES.has(terminal.type))
                ? "data_access"
                : "other",
            signalKind: "inferred",
            evidenceNodeIds: [
              GRAPH_EVIDENCE_ID,
              ...next.flatMap((x) => x.evidenceNodeIds),
            ].filter((id, i, arr) => arr.indexOf(id) === i),
          });
          if (derivedPaths.length >= MAX_PATHS) return;
        }
        walk(start, next, depth + 1);
      }
    };
    for (const n of nodes.filter((x) => x.type === "Agent")) {
      walk(n.id, [], 0);
    }

    const graph = {
      schemaVersion: "0.1.0",
      graphId: `capgraph:${ctx.assessedAt.toISOString()}`,
      generatedAt: ctx.assessedAt.toISOString(),
      collectorId: PLUGIN_ID,
      collectorVersion: "0.1.0",
      ...(inventoryId ? { inventoryId } : {}),
      nodes,
      edges,
      derivedPaths,
    };
    writeFileSync(
      join(ctx.outputDir, "agent-capability-graph.json"),
      JSON.stringify(graph, null, 2) + "\n",
      "utf8",
    );

    const isMcpHop = (e: GraphEdge | undefined): boolean =>
      !!e &&
      (e.rel === "agent_connects_to_mcp" ||
        e.to.startsWith("mcp:") ||
        nodeById.get(e.to)?.type === "MCPServer");
    const isDataHop = (e: GraphEdge | undefined): boolean =>
      !!e &&
      (e.rel === "tool_invokes_api" ||
        e.rel === "tool_accesses_database" ||
        DATA_TYPES.has(nodeById.get(e.to)?.type ?? ""));
    const confusedDeputy = derivedPaths.some((p) => {
      const hops = p.edgeIds.map((id) => edges.find((x) => x.id === id));
      const mcpIdx = hops.findIndex((e) => isMcpHop(e));
      if (mcpIdx < 0) return false;
      return hops.some((e, i) => i > mcpIdx && isDataHop(e));
    });
    const memoryHop = derivedPaths.some((p) =>
      p.edgeIds.some((id) => {
        const e = edges.find((x) => x.id === id);
        return nodeById.get(e?.to ?? "")?.type === "MemoryStore";
      }),
    );
    const delegated = edges.some(
      (e) => e.rel === "agent_delegates_to" || e.accessKind === "delegated",
    );
    const highRiskPaths = derivedPaths.filter((p) => p.riskHint === "data_access");
    const signalIds = [
      ...(edges.length > 0 ? ["agent.graph.edge_direct"] : []),
      ...(highRiskPaths.length > 0 ? ["agent.graph.path_transitive"] : []),
      ...(confusedDeputy ? ["mcp.confused_deputy.path"] : []),
      ...(memoryHop ? ["agent.graph.memory_hop"] : []),
      ...(delegated ? ["agent.graph.edge_delegated"] : []),
    ];

    const report = withReportEvidenceTypes(
      {
        schemaVersion: "0.1.0",
        pluginId: PLUGIN_ID,
        detectorId: DETECTOR_ID,
        relatedCheckIds: [...RELATED],
        assessedAt: ctx.assessedAt.toISOString(),
        summary: {
          statusHint: nodes.length === 0 ? "not_demonstrated" : "partial",
          nodeCount: nodes.length,
          edgeCount: edges.length,
          derivedPathCount: derivedPaths.length,
        },
        notes: [
          "Capability graph is operational evidence. Exercise packs under imports/transitive-tool-access/ are required to PASS TOL-M6.",
          `Wrote agent-capability-graph.json (nodes=${nodes.length} edges=${edges.length} paths=${derivedPaths.length}).`,
          ...(mcpRefs.length
            ? [`MCP repo refs: ${mcpRefs.slice(0, 4).join(", ")}`]
            : []),
          ...(toolRefs.length
            ? [`Tool repo refs: ${toolRefs.slice(0, 4).join(", ")}`]
            : []),
        ],
      },
      ["agent_capability_graph", "repo_signal"],
    );

    const importDir = join(ctx.outputDir, "imports", PLUGIN_ID);
    ensureDir(importDir);
    writeFileSync(
      join(importDir, `${PLUGIN_ID}-report.json`),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const evNodes: EvidenceNode[] = [
      {
        id: GRAPH_EVIDENCE_ID,
        class: "code",
        ref: "agent-capability-graph.json",
        excerpt: redact(
          JSON.stringify({
            nodes: nodes.length,
            edges: edges.length,
            paths: derivedPaths.length,
          }),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [PLUGIN_ID, ...signalIds],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `TOL-M6 status=${report.summary.statusHint} nodes=${nodes.length} edges=${edges.length}`,
      nodes: evNodes,
    };
  },
};
