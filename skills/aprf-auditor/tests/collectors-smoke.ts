/**
 * Smoke test: local collectors + custom catch-all (imports/custom/ → user nodes).
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COLLECTORS } from "../collectors/index.ts";
import type { CollectorContext, EvidenceGraph } from "../collectors/types.ts";
import { writeJson } from "../collectors/lib/fs.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = mkdtempSync(join(tmpdir(), "aprf-collect-"));

async function main() {
  const assessedAt = new Date();
  const ctx: CollectorContext = {
    targetPath: root,
    outputDir: outDir,
    assessedAt,
    live: false,
    maxFiles: 2000,
  };

  const nodes = [];
  const collectors = [];
  for (const id of ["repo-filesystem", "github-actions"]) {
    const c = COLLECTORS.find((x) => x.id === id);
    if (!c) throw new Error(`missing collector ${id}`);
    const r = await c.collect(ctx);
    collectors.push({
      pluginId: r.pluginId,
      status: r.status,
      detail: r.detail,
    });
    nodes.push(...r.nodes);
  }

  if (nodes.length < 5) {
    throw new Error(`expected >=5 nodes, got ${nodes.length}`);
  }
  const gh = collectors.find((c) => c.pluginId === "github-actions");
  if (!gh || (gh.status !== "ran" && gh.status !== "skipped")) {
    throw new Error(`github-actions unexpected: ${JSON.stringify(gh)}`);
  }

  const custom = COLLECTORS.find((x) => x.id === "custom");
  if (!custom) throw new Error("missing collector custom");
  const empty = await custom.collect(ctx);
  if (empty.status !== "skipped" || empty.nodes.length !== 0) {
    throw new Error(`custom empty unexpected: ${JSON.stringify(empty)}`);
  }

  const customDir = join(outDir, "imports", "custom");
  mkdirSync(customDir, { recursive: true });
  writeFileSync(
    join(customDir, "vendor-evidence.txt"),
    "Customer-provided out-of-plugin evidence for SEC2-M1 secrets manager note.",
    "utf8",
  );
  const filled = await custom.collect(ctx);
  if (filled.status !== "ran" || filled.nodes.length < 1) {
    throw new Error(`custom filled unexpected: ${JSON.stringify(filled)}`);
  }
  if (filled.nodes[0].class !== "user") {
    throw new Error(
      `custom node class must be user, got ${filled.nodes[0].class}`,
    );
  }
  if (!filled.nodes[0].signals?.includes("custom-catch-all")) {
    throw new Error("custom node missing custom-catch-all signal");
  }
  collectors.push({
    pluginId: filled.pluginId,
    status: filled.status,
    detail: filled.detail,
  });
  nodes.push(...filled.nodes);

  const graph: EvidenceGraph = {
    schemaVersion: "0.2.0",
    assessedAt: assessedAt.toISOString(),
    subject: { path: root, name: "APRF" },
    collectors,
    nodes,
    edges: [],
  };
  const outPath = join(outDir, "evidence-graph.json");
  writeJson(outPath, graph);
  const parsed = JSON.parse(readFileSync(outPath, "utf8")) as EvidenceGraph;
  if (parsed.schemaVersion !== "0.2.0") throw new Error("bad schemaVersion");

  console.log(
    `aprf-auditor collectors smoke OK (${nodes.length} nodes, custom catch-all OK)`,
  );
  rmSync(outDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  try {
    rmSync(outDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
