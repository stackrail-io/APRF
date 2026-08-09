/**
 * Hybrid collector factory: import ingest + local repo path/content scan.
 * Used for vendor observability plugins that previously were import-only stubs.
 */
import type {
  Collector,
  CollectorContext,
  EvidenceClass,
  EvidenceNode,
} from "../types.ts";
import {
  ageDays,
  matchAny,
  mtimeDate,
  mtimeIso,
  readText,
  redact,
  rel,
  walkFiles,
} from "./fs.ts";
import { importIngestCollector } from "../import-ingest.ts";

export type RepoImportCollectorSpec = {
  id: string;
  /** Path substrings (case-insensitive via matchAny) */
  pathHints: string[];
  /** Content must match to emit a repo node */
  contentPattern: RegExp;
  /**
   * Also content-scan these extensions even when pathHints miss
   * (finds SDK refs in src/*.ts etc.).
   */
  contentScanExtensions?: string[];
  signals: string[];
  relatedCheckIds: string[];
  /** Class for repo-scanned nodes (imports keep import-ingest class). */
  evidenceClass?: EvidenceClass | ((relPath: string, text: string) => EvidenceClass);
  extensions?: string[];
  maxFiles?: number;
  readBytes?: number;
  emptyDetail: string;
};

function resolveClass(
  spec: RepoImportCollectorSpec,
  relPath: string,
  text: string,
): EvidenceClass {
  if (typeof spec.evidenceClass === "function") {
    return spec.evidenceClass(relPath, text);
  }
  return spec.evidenceClass ?? "runtime-config";
}

function withRelatedChecks(
  nodes: EvidenceNode[],
  relatedCheckIds: string[],
): EvidenceNode[] {
  if (!relatedCheckIds.length) return nodes;
  return nodes.map((n) => {
    const existing = n.relatedCheckIds ?? [];
    const merged = [...existing];
    for (const id of relatedCheckIds) {
      if (!merged.includes(id)) merged.push(id);
    }
    return { ...n, relatedCheckIds: merged };
  });
}

export function repoImportCollector(spec: RepoImportCollectorSpec): Collector {
  return {
    id: spec.id,
    async collect(ctx: CollectorContext) {
      const ingest = await importIngestCollector(spec.id).collect(ctx);
      const files = walkFiles(ctx.targetPath, {
        maxFiles: spec.maxFiles ?? ctx.maxFiles ?? 4000,
        extensions: spec.extensions,
      });
      const nodes: EvidenceNode[] = withRelatedChecks(
        [...ingest.nodes],
        spec.relatedCheckIds,
      );
      let i = 0;
      const contentExts = (spec.contentScanExtensions ?? []).map((e) =>
        e.startsWith(".") ? e.toLowerCase() : `.${e.toLowerCase()}`,
      );
      for (const file of files) {
        const r = rel(ctx.targetPath, file);
        const pathHit = matchAny(r, spec.pathHints);
        const ext = r.includes(".")
          ? `.${r.split(".").pop()!.toLowerCase()}`
          : "";
        const contentCandidate =
          !pathHit && contentExts.length > 0 && contentExts.includes(ext);
        if (!pathHit && !contentCandidate) continue;
        const text = readText(file, spec.readBytes ?? 12_000) ?? "";
        // Always require content match (no path-only emission).
        if (!spec.contentPattern.test(text)) continue;
        const mt = mtimeDate(file);
        nodes.push({
          id: `${spec.id}:repo:${i++}:${r}`,
          class: resolveClass(spec, r, text),
          ref: r,
          excerpt: redact(text.slice(0, 400)),
          pluginId: spec.id,
          lastModified: mtimeIso(file),
          gitCommit: ctx.gitCommit,
          evidenceAgeDays: ageDays(ctx.assessedAt, mt),
          signals: [...spec.signals],
          relatedCheckIds: [...spec.relatedCheckIds],
        });
      }
      if (nodes.length === 0) {
        return {
          pluginId: spec.id,
          status: "needs-user",
          detail: spec.emptyDetail,
          nodes: [],
        };
      }
      return {
        pluginId: spec.id,
        status: "ran",
        detail: `Found ${nodes.length} ${spec.id}-related node(s)`,
        nodes,
      };
    },
  };
}
