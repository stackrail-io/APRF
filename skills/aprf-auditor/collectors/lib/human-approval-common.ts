/**
 * Shared helpers for human-approval (HUM-*) collectors.
 */
import { join, basename } from "node:path";
import { writeFileSync } from "node:fs";
import type {
  CollectorContext,
  CollectorResult,
  EvidenceClass,
  EvidenceNode,
} from "../types.ts";
import {
  ensureDir,
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  SCAN_EXTENSIONS,
  walkFiles,
} from "./fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./import-attest.ts";

export const AGENT_OR_APPROVAL_PATH_RE =
  /(agent|orchestr|approv|hitl|human.?in.?the.?loop|tool.?gate|high.?impact)/i;

export function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 16,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [...SCAN_EXTENSIONS],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

export function detectApprovalSignals(
  targetPath: string,
  maxFiles: number,
): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AGENT_OR_APPROVAL_PATH_RE.test(path) ||
        /\b(human.?approval|approval.?gate|requireApproval|hitl|dual.?control|four.?eyes)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

export function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

export { asBool, measuredAtFresh, parseMeasuredAt, basename, join, writeFileSync, ensureDir, listImportFiles, readText, redact };

export type StatusHint =
  | "pass"
  | "partial"
  | "fail"
  | "not_demonstrated"
  | "not_applicable";

export function writeReportAndNodes(opts: {
  ctx: CollectorContext;
  pluginId: string;
  related: readonly string[];
  reportFile: string;
  report: unknown;
  summary: Record<string, unknown>;
  statusHint: StatusHint;
  satisfiedKey: string;
  satisfied: boolean | null;
  nodeClass: EvidenceClass;
  signals: string[];
  codeRefs: string[];
  detail: string;
}): CollectorResult {
  const dir = join(opts.ctx.outputDir, "imports", opts.pluginId);
  ensureDir(dir);
  writeFileSync(
    join(dir, opts.reportFile),
    JSON.stringify(opts.report, null, 2) + "\n",
    "utf8",
  );
  const nodes: EvidenceNode[] = [
    {
      id: `${opts.pluginId}:report`,
      class: opts.nodeClass,
      ref: `imports/${opts.pluginId}/${opts.reportFile}`,
      excerpt: redact(JSON.stringify(opts.summary)),
      pluginId: opts.pluginId,
      gitCommit: opts.ctx.gitCommit,
      evidenceAgeDays: 0,
      relatedCheckIds: [...opts.related],
      signals: opts.signals,
    },
  ];
  for (const r of opts.codeRefs.slice(0, 6)) {
    nodes.push({
      id: `${opts.pluginId}:ref:${r}`,
      class: "code",
      ref: r,
      pluginId: opts.pluginId,
      gitCommit: opts.ctx.gitCommit,
      evidenceAgeDays: 0,
      relatedCheckIds: [...opts.related],
      signals: [`${opts.pluginId}-ref`],
    });
  }
  return {
    pluginId: opts.pluginId,
    status: "ran",
    detail: opts.detail,
    nodes,
  };
}
