/**
 * Hybrid collector: repo heuristics + imports/<plugin>/ JSON for exercise gates.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "../types.ts";
import {
  ensureDir,
  isSkippedScanRelPath,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./fs.ts";
import { withReportEvidenceTypes } from "./evidence-types.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeOrBool,
  parseMeasuredAt,
} from "./import-attest.ts";

export type ExerciseImportSpec = {
  pluginId: string;
  detectorId: string;
  relatedCheckIds: string[];
  /** Import key: false → NOT_APPLICABLE when no repo surface. */
  surfacePresentKey: string;
  /** All must be true for PASS. */
  passBoolKeys: string[];
  /** Optional coverage percents that must be >= minPct. */
  passPctKeys?: Array<{ key: string; min: number }>;
  /**
   * Minimum listed exercise/eval/trace rows (cases, results, or samples)
   * required to PASS. Numeric caseCount/runCount attestations do not count.
   * Default: passBoolKeys.length, or 1 when only passPctKeys are used.
   */
  minCases?: number;
  /** When whenKey is true, requireKey must be true to PASS. */
  conditionalBoolKeys?: Array<{ whenKey: string; requireKey: string }>;
  /**
   * deny: listed rows must be explicit deny outcomes; success ⇒ unauthorized.
   * sample: listed objects count toward the pack; unauthorizedSuccess must be explicit.
   */
  caseSemantics?: "deny" | "sample";
  repoPathPattern: RegExp;
  repoContentPattern: RegExp;
  registeredPassSignals: string[];
  registeredFailSignals: Array<{
    signal: string;
    whenFalse?: string;
    onUnauthorized?: boolean;
  }>;
  evidenceTypes: string[];
  emptyDetail: string;
};

export type ExerciseReport = {
  schemaVersion: "0.1.0";
  pluginId: string;
  detectorId: string;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    repoSurface: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    surfacePresent: boolean | null;
    flags: Record<string, boolean | number | null>;
    caseCount: number;
    /** Rows in cases/results/samples arrays — not attested caseCount. */
    listedCaseCount: number;
    unauthorizedSuccessCount: number;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
    satisfied: boolean | null;
    naReason: string | null;
    /** False when only boolean flags were imported (not an exercise pack). */
    measuredEvidence: boolean;
  };
  notes: string[];
  evidenceTypes?: string[];
};

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function listedRows(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data.cases)) return data.cases;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.samples)) return data.samples;
  return [];
}

function isPlainObject(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function rowCountsTowardPack(
  c: Record<string, unknown>,
  semantics: "deny" | "sample",
): boolean {
  if (semantics === "deny") {
    if (c.unauthorizedSuccess === true) return false;
    return (
      c.denied === true || c.outcome === "denied" || c.success === false
    );
  }
  return (
    typeof c.id === "string" ||
    "denied" in c ||
    "outcome" in c ||
    "success" in c ||
    "unauthorizedSuccess" in c ||
    "attributes" in c
  );
}

function rowUnauthorized(
  c: Record<string, unknown>,
  semantics: "deny" | "sample",
): boolean {
  if (c.unauthorizedSuccess === true) return true;
  if (semantics === "sample") return false;
  const denied =
    c.denied === true || c.outcome === "denied" || c.success === false;
  const succeeded =
    c.denied === false || c.outcome === "success" || c.success === true;
  return succeeded && !denied;
}

function olderIso(a: string, b: string): string {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  return ta <= tb ? a : b;
}

function loadImported(
  ctx: CollectorContext,
  spec: ExerciseImportSpec,
): ExerciseReport["importedResults"] {
  const sources: string[] = [];
  const flags: Record<string, boolean | number | null> = {};
  let surfacePresent: boolean | null = null;
  let measuredAt: string | null = null;
  let found = false;
  let listedCaseCount = 0;
  let unauthorizedSuccessCount = 0;
  const semantics = spec.caseSemantics ?? "deny";

  for (const f of listImportFiles(ctx.outputDir, spec.pluginId)) {
    if (f.endsWith(`${spec.pluginId}-report.json`)) continue;
    const text = readText(f);
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    const data = parsed;
    found = true;
    sources.push(rel(ctx.outputDir, f));
    const fileAt = parseMeasuredAt(data);
    const fileFresh = measuredAtFresh(fileAt);
    if (!fileFresh) continue;
    const sp = asBool(data[spec.surfacePresentKey]);
    if (sp !== null) {
      surfacePresent = surfacePresent === null ? sp : surfacePresent || sp;
    }
    if (fileAt) measuredAt = measuredAt ? olderIso(measuredAt, fileAt) : fileAt;
    const whenKeys = new Set(
      (spec.conditionalBoolKeys ?? []).map((c) => c.whenKey),
    );
    const boolKeys = [
      ...spec.passBoolKeys,
      ...(spec.conditionalBoolKeys ?? []).flatMap((c) => [
        c.whenKey,
        c.requireKey,
      ]),
    ];
    for (const k of boolKeys) {
      const v = asBool(data[k]);
      if (v === null) continue;
      const prev = typeof flags[k] === "boolean" ? flags[k] : null;
      flags[k] = whenKeys.has(k)
        ? mergeOrBool(prev, v)
        : mergeAndBool(prev, v);
    }
    for (const p of spec.passPctKeys ?? []) {
      const v = asNum(data[p.key]);
      if (v === null) continue;
      const prev = typeof flags[p.key] === "number" ? (flags[p.key] as number) : null;
      flags[p.key] = prev === null ? v : Math.min(prev, v);
    }
    for (const raw of listedRows(data)) {
      if (!isPlainObject(raw)) continue;
      if (rowUnauthorized(raw, semantics)) unauthorizedSuccessCount += 1;
      if (!rowCountsTowardPack(raw, semantics)) continue;
      listedCaseCount += 1;
    }
    const explicitFail = asNum(data.unauthorizedSuccessCount);
    if (explicitFail !== null) {
      unauthorizedSuccessCount = Math.max(unauthorizedSuccessCount, explicitFail);
    }
  }
  return {
    found,
    surfacePresent,
    flags,
    caseCount: listedCaseCount,
    listedCaseCount,
    unauthorizedSuccessCount,
    measuredAt,
    sources,
  };
}

function collectRefs(
  targetPath: string,
  maxFiles: number,
  spec: ExerciseImportSpec,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 2000),
    extensions: [".py", ".ts", ".js", ".tsx", ".yml", ".yaml", ".json", ".md"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
    const text = readText(f, 80_000) || "";
    if (spec.repoPathPattern.test(r) || spec.repoContentPattern.test(text)) {
      refs.push(r);
    }
    if (refs.length >= 16) break;
  }
  return [...new Set(refs)];
}

export function exerciseImportCollector(spec: ExerciseImportSpec): Collector {
  return {
    id: spec.pluginId,
    async collect(ctx: CollectorContext): Promise<CollectorResult> {
      const refs = collectRefs(ctx.targetPath, ctx.maxFiles ?? 4000, spec);
      const imported = loadImported(ctx, spec);
      const notes: string[] = [];
      const repoFound = refs.length > 0;
      if (repoFound) notes.push(`Repo surface: ${refs.slice(0, 4).join(", ")}`);
      if (imported.found) {
        notes.push(`Imported: ${imported.sources.join(", ")}`);
      } else {
        notes.push(spec.emptyDetail);
      }

      let statusHint: ExerciseReport["summary"]["statusHint"] = "not_demonstrated";
      let satisfied: boolean | null = null;
      let naReason: string | null = null;
      const minCases =
        spec.minCases ??
        (spec.passPctKeys?.length && spec.passBoolKeys.length === 0
          ? 1
          : spec.passBoolKeys.length);
      const condOk = (spec.conditionalBoolKeys ?? []).every((c) => {
        if (imported.flags[c.whenKey] !== true) return true;
        return imported.flags[c.requireKey] === true;
      });
      const condFail = (spec.conditionalBoolKeys ?? []).some((c) => {
        return (
          imported.flags[c.whenKey] === true &&
          imported.flags[c.requireKey] === false
        );
      });
      const boolOk =
        spec.passBoolKeys.every((k) => imported.flags[k] === true) && condOk;
      const pctOk = (spec.passPctKeys ?? []).every((p) => {
        const v = imported.flags[p.key];
        return typeof v === "number" && v >= p.min;
      });
      const pctPresent = (spec.passPctKeys ?? []).every((p) => {
        const v = imported.flags[p.key];
        return typeof v === "number";
      });
      const packMeasured =
        imported.listedCaseCount >= minCases &&
        (spec.passPctKeys?.length ? pctPresent : true);
      const measuredEvidence =
        imported.found &&
        measuredAtFresh(imported.measuredAt) &&
        packMeasured;

      if (imported.unauthorizedSuccessCount > 0) {
        statusHint = "fail";
        satisfied = false;
        notes.push(
          `Exercise unauthorizedSuccessCount=${imported.unauthorizedSuccessCount}.`,
        );
      } else if (imported.surfacePresent === false && !repoFound) {
        statusHint = "not_applicable";
        naReason = `${spec.surfacePresentKey}=false and no repo surface — Check N/A.`;
        notes.push(naReason);
      } else if (imported.found && imported.surfacePresent === false && repoFound) {
        statusHint = "partial";
        notes.push(
          "Import attested surface absent but repo signals exist — cannot N/A.",
        );
      } else if (imported.found && measuredAtFresh(imported.measuredAt)) {
        const boolFail =
          spec.passBoolKeys.some((k) => imported.flags[k] === false) ||
          condFail;
        const pctFail = (spec.passPctKeys ?? []).some((p) => {
          const v = imported.flags[p.key];
          return typeof v === "number" && v < p.min;
        });
        if (boolFail || pctFail) {
          statusHint = "fail";
          satisfied = false;
        } else if (boolOk && pctOk && packMeasured) {
          statusHint = "pass";
          satisfied = true;
        } else {
          statusHint = "partial";
          satisfied = false;
          if (!packMeasured) {
            notes.push(
              `Boolean/config import is not an exercise pack — need ≥${minCases} cases/results/samples (not numeric caseCount) with measuredAt ≤90d.`,
            );
          }
        }
      } else if (repoFound || imported.found) {
        statusHint = "partial";
        satisfied = false;
      }

      const passSignals =
        statusHint === "pass" ? spec.registeredPassSignals : [];
      const failSignals =
        statusHint === "fail"
          ? spec.registeredFailSignals
              .filter((s) => {
                if (s.onUnauthorized && imported.unauthorizedSuccessCount > 0) {
                  return true;
                }
                if (s.whenFalse && imported.flags[s.whenFalse] === false) {
                  return true;
                }
                return false;
              })
              .map((s) => s.signal)
          : [];

      const report = withReportEvidenceTypes(
        {
          schemaVersion: "0.1.0" as const,
          pluginId: spec.pluginId,
          detectorId: spec.detectorId,
          relatedCheckIds: [...spec.relatedCheckIds],
          assessedAt: ctx.assessedAt.toISOString(),
          signals: { repoSurface: { found: repoFound, refs } },
          importedResults: imported,
          summary: { statusHint, satisfied, naReason, measuredEvidence },
          notes,
        } satisfies ExerciseReport,
        spec.evidenceTypes,
      );

      const importDir = join(ctx.outputDir, "imports", spec.pluginId);
      ensureDir(importDir);
      writeFileSync(
        join(importDir, `${spec.pluginId}-report.json`),
        JSON.stringify(report, null, 2) + "\n",
        "utf8",
      );

      const checkId = spec.relatedCheckIds[0] ?? spec.pluginId;
      const nodes: EvidenceNode[] = [
        {
          id: `${spec.pluginId}:report`,
          class: measuredEvidence
            ? "runtime"
            : imported.found
              ? "ci"
              : "code",
          ref: `imports/${spec.pluginId}/${spec.pluginId}-report.json`,
          excerpt: redact(JSON.stringify(report.summary).slice(0, 800)),
          pluginId: spec.pluginId,
          gitCommit: ctx.gitCommit,
          evidenceAgeDays: 0,
          signals: [
            spec.pluginId,
            checkId.toLowerCase(),
            spec.detectorId,
            ...passSignals,
            ...failSignals,
          ],
          relatedCheckIds: [...spec.relatedCheckIds],
        },
      ];

      return {
        pluginId: spec.pluginId,
        status: "ran",
        detail: `${checkId} status=${statusHint}; report=imports/${spec.pluginId}/${spec.pluginId}-report.json`,
        nodes,
      };
    },
  };
}
