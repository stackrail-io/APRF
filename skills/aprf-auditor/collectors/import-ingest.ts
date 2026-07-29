/**
 * Generic ingest: any files under aprf-assessment/imports/<pluginId>/
 * become evidence nodes for that plugin (runtime class by default).
 *
 * Special case: pluginId "custom" → always class "user" (out-of-plugin catch-all).
 * Empty custom/ is skipped (optional), not needs-user.
 */
import type {
  Collector,
  CollectorContext,
  EvidenceClass,
  EvidenceNode,
} from "./types.ts";
import {
  ageDays,
  listImportFiles,
  mtimeDate,
  mtimeIso,
  readText,
  redact,
  rel,
} from "./lib/fs.ts";

const RUNTIME_PLUGINS = new Set([
  "langsmith",
  "phoenix",
  "helicone",
  "otel",
  "prometheus",
  "grafana",
  "wandb",
  "cloudwatch",
]);

function evidenceClass(pluginId: string): EvidenceClass {
  if (pluginId === "custom") return "user";
  if (pluginId === "promptfoo") return "ci";
  if (pluginId === "aws" || pluginId === "azure" || pluginId === "gcp") {
    return "iac";
  }
  if (RUNTIME_PLUGINS.has(pluginId)) return "runtime";
  return "user";
}

export function importIngestCollector(pluginId: string): Collector {
  return {
    id: pluginId,
    async collect(ctx: CollectorContext) {
      const files = listImportFiles(ctx.outputDir, pluginId);
      if (files.length === 0) {
        if (pluginId === "custom") {
          return {
            pluginId,
            status: "skipped",
            detail:
              "No files in imports/custom/ (optional catch-all for out-of-plugin evidence)",
            nodes: [],
          };
        }
        return {
          pluginId,
          status: "needs-user",
          detail: `No exports in imports/${pluginId}/ — drop a JSON/CSV/YAML export there or enable live mode if supported`,
          nodes: [],
        };
      }
      const nodes: EvidenceNode[] = files.map((file, i) => {
        const text = readText(file, 16_000) ?? "";
        const mt = mtimeDate(file);
        const signals =
          pluginId === "custom"
            ? [
                "import-export",
                "user-provided-artifact",
                "out-of-plugin",
                "custom-catch-all",
              ]
            : ["import-export", "user-provided-artifact"];
        return {
          id: `${pluginId}:import:${i}`,
          class: evidenceClass(pluginId),
          ref: rel(ctx.outputDir, file),
          excerpt: redact(text.slice(0, 400)),
          pluginId,
          lastModified: mtimeIso(file),
          gitCommit: ctx.gitCommit,
          evidenceAgeDays: ageDays(ctx.assessedAt, mt),
          signals,
        };
      });
      return {
        pluginId,
        status: "ran",
        detail:
          pluginId === "custom"
            ? `Ingested ${files.length} out-of-plugin file(s) from imports/custom/ as user evidence`
            : `Ingested ${files.length} file(s) from imports/${pluginId}/`,
        nodes,
      };
    },
  };
}

/** Catch-all: aprf-assessment/imports/custom/ → user-class evidence nodes. */
export const customImportCollector = importIngestCollector("custom");
