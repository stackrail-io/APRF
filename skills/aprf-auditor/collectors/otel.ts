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

export const otelCollector: Collector = {
  id: "otel",
  async collect(ctx: CollectorContext) {
    const ingest = await importIngestCollector("otel").collect(ctx);
    const files = walkFiles(ctx.targetPath, { maxFiles: ctx.maxFiles ?? 4000 });
    const nodes: EvidenceNode[] = [...ingest.nodes];
    let i = 0;
    for (const file of files) {
      const r = rel(ctx.targetPath, file);
      if (!matchAny(r, ["otel", "opentelemetry", "tracing"])) continue;
      const text = readText(file, 12_000) ?? "";
      const mt = mtimeDate(file);
      nodes.push({
        id: `otel:config:${i++}:${r}`,
        class: text.match(/exporter|otlp|trace/i) ? "runtime" : "runtime-config",
        ref: r,
        excerpt: redact(text.slice(0, 400)),
        pluginId: "otel",
        lastModified: mtimeIso(file),
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: ageDays(ctx.assessedAt, mt),
        signals: ["otel-config"],
        relatedCheckIds: ["OBS-M1", "OBS-M2"],
      });
    }
    if (nodes.length === 0) {
      return {
        pluginId: "otel",
        status: "needs-user",
        detail:
          "No OTel config in repo and no imports/otel/ export — provide a trace export to demonstrate runtime evidence",
        nodes: [],
      };
    }
    return {
      pluginId: "otel",
      status: "ran",
      detail: `Found ${nodes.length} OTel-related node(s)`,
      nodes,
    };
  },
};
