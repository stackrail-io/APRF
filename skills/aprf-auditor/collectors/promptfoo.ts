import type { Collector, CollectorContext, EvidenceNode } from "./types.ts";
import {
  ageDays,
  matchAny,
  mtimeDate,
  mtimeIso,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import { importIngestCollector } from "./import-ingest.ts";

export const promptfooCollector: Collector = {
  id: "promptfoo",
  async collect(ctx: CollectorContext) {
    const ingest = await importIngestCollector("promptfoo").collect(ctx);
    const files = walkFiles(ctx.targetPath, { maxFiles: ctx.maxFiles ?? 4000 });
    const nodes: EvidenceNode[] = [...ingest.nodes];
    let i = 0;
    for (const file of files) {
      const r = rel(ctx.targetPath, file);
      if (!matchAny(r, ["promptfoo", "/eval/", "/evals/", "redteam"])) continue;
      const text = readText(file, 12_000) ?? "";
      const mt = mtimeDate(file);
      nodes.push({
        id: `promptfoo:${i++}:${r}`,
        class: matchAny(r, ["result", "output", "json"]) ? "ci" : "runtime-config",
        ref: r,
        excerpt: redact(text.slice(0, 400)),
        pluginId: "promptfoo",
        lastModified: mtimeIso(file),
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: ageDays(ctx.assessedAt, mt),
        signals: ["eval-suite"],
        relatedCheckIds: ["EVL-M1", "SEC-M1"],
      });
    }
    if (nodes.length === 0) {
      return {
        pluginId: "promptfoo",
        status: ingest.status === "needs-user" ? "needs-user" : "skipped",
        detail: "No promptfoo/eval artifacts found",
        nodes: [],
      };
    }
    return {
      pluginId: "promptfoo",
      status: "ran",
      detail: `Found ${nodes.length} eval-related node(s)`,
      nodes,
    };
  },
};
