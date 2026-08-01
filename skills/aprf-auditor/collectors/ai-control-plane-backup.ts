/**
 * ai-control-plane-backup — REL-M4 / repo-ai-control-plane-backup.
 *
 * Discovers AI control-plane backup inventory + restore-test signals.
 * Import controlPlaneBackupInventoryConfigured +
 * requiredArtifactClassesCovered + restoreTestSucceededWithin90Days under
 * imports/ai-control-plane-backup/ to unlock PASS (measuredAt ≤90d).
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "ai-control-plane-backup";
const RELATED = ["REL-M4"] as const;
const DETECTOR_ID = "repo-ai-control-plane-backup";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_ARTIFACT_RE =
  /\b(prompt[_-]?(registry|store|version)|policy[_-]?(store|registry|pack)|vector[_-]?(index|store|db)|embedding[_-]?index|rag[_-]?index|model[_-]?registry|control[_-]?plane)\b/i;

const BACKUP_RE =
  /\b(backup|snapshot|vault|point[_-]?in[_-]?time|pit[_-]?restore|disaster[_-]?recovery[_-]?backup)\b/i;

const RESTORE_TEST_RE =
  /\b(restore[_-]?(test|drill|verification|proof)|backup[_-]?restore[_-]?test|recovery[_-]?test)\b/i;

export interface AiControlPlaneBackupReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    backup: { found: boolean; refs: string[] };
    artifacts: { found: boolean; refs: string[] };
    restoreTest: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    controlPlaneBackupInventoryConfigured: boolean | null;
    requiredArtifactClassesCovered: boolean | null;
    restoreTestSucceededWithin90Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiArtifactSignalsPresent: boolean;
    backupSignalsPresent: boolean;
    relM4Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path);
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 16,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".md",
      ".txt",
      ".yml",
      ".yaml",
      ".json",
      ".tf",
      ".ts",
      ".py",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): AiControlPlaneBackupReport["importedResults"] {
  const sources: string[] = [];
  let controlPlaneBackupInventoryConfigured: boolean | null = null;
  let requiredArtifactClassesCovered: boolean | null = null;
  let restoreTestSucceededWithin90Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/ai-control-plane-backup-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      controlPlaneBackupInventoryConfigured =
        asBool(data.controlPlaneBackupInventoryConfigured) ??
        asBool(data.control_plane_backup_inventory_configured) ??
        asBool(data.backupInventoryConfigured) ??
        controlPlaneBackupInventoryConfigured;
      requiredArtifactClassesCovered =
        asBool(data.requiredArtifactClassesCovered) ??
        asBool(data.required_artifact_classes_covered) ??
        asBool(data.artifactsCovered) ??
        requiredArtifactClassesCovered;
      restoreTestSucceededWithin90Days =
        asBool(data.restoreTestSucceededWithin90Days) ??
        asBool(data.restore_test_succeeded_within_90_days) ??
        asBool(data.restoreTestPassed) ??
        asBool(data.restoreSucceeded) ??
        restoreTestSucceededWithin90Days;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    controlPlaneBackupInventoryConfigured,
    requiredArtifactClassesCovered,
    restoreTestSucceededWithin90Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAiControlPlaneBackupReport(opts: {
  assessedAt: string;
  backup: { found: boolean; refs: string[] };
  artifacts: { found: boolean; refs: string[] };
  restoreTest: { found: boolean; refs: string[] };
  imported: AiControlPlaneBackupReport["importedResults"];
}): AiControlPlaneBackupReport {
  const notes: string[] = [];
  const aiArtifactSignalsPresent = opts.artifacts.found;
  const backupSignalsPresent =
    opts.backup.found || opts.restoreTest.found || opts.artifacts.found;

  if (!aiArtifactSignalsPresent && !backupSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI control-plane backup signals — REL-M4 may be NOT_APPLICABLE if there are no in-scope AI control-plane artifacts.",
    );
  }
  if (opts.backup.found) {
    notes.push(`Backup refs: ${opts.backup.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.artifacts.found) {
    notes.push(
      `Control-plane artifact refs: ${opts.artifacts.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.restoreTest.found) {
    notes.push(
      `Restore-test refs: ${opts.restoreTest.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (inventory=${opts.imported.controlPlaneBackupInventoryConfigured}, artifactsCovered=${opts.imported.requiredArtifactClassesCovered}, restore=${opts.imported.restoreTestSucceededWithin90Days})`,
    );
  } else if (backupSignalsPresent) {
    notes.push(
      "Backup signals alone are PARTIAL — import controlPlaneBackupInventoryConfigured=true + requiredArtifactClassesCovered=true + restoreTestSucceededWithin90Days=true (measuredAt ≤90d) under imports/ai-control-plane-backup/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const inventoryOk =
    opts.imported.controlPlaneBackupInventoryConfigured === true;
  const artifactsOk = opts.imported.requiredArtifactClassesCovered === true;
  const restoreOk = opts.imported.restoreTestSucceededWithin90Days === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AiControlPlaneBackupReport["summary"]["statusHint"];
  let relM4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.controlPlaneBackupInventoryConfigured === false ||
      opts.imported.requiredArtifactClassesCovered === false ||
      opts.imported.restoreTestSucceededWithin90Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!aiArtifactSignalsPresent && !backupSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    relM4Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    relM4Satisfied = false;
    notes.push(
      "Imported evidence shows missing backup inventory, uncovered artifact classes, failed/absent restore test, or evidence older than 90 days — REL-M4 fail.",
    );
  } else if (
    (backupSignalsPresent || opts.imported.found) &&
    inventoryOk &&
    artifactsOk &&
    restoreOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    relM4Satisfied = true;
  } else if (backupSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    relM4Satisfied = false;
    if (opts.imported.found && !inventoryOk) {
      notes.push(
        "Import must show controlPlaneBackupInventoryConfigured=true.",
      );
    }
    if (opts.imported.found && !artifactsOk) {
      notes.push("Import must show requiredArtifactClassesCovered=true.");
    }
    if (opts.imported.found && !restoreOk) {
      notes.push("Import must show restoreTestSucceededWithin90Days=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock REL-M4 PASS.",
      );
    }
  } else if (aiArtifactSignalsPresent) {
    statusHint = "not_demonstrated";
    relM4Satisfied = null;
    notes.push(
      "AI control-plane artifact signals present but no backup/restore evidence found.",
    );
  } else {
    statusHint = "not_demonstrated";
    relM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      backup: opts.backup,
      artifacts: opts.artifacts,
      restoreTest: opts.restoreTest,
    },
    importedResults: opts.imported,
    summary: {
      aiArtifactSignalsPresent,
      backupSignalsPresent,
      relM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const aiControlPlaneBackupCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const artifactRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        AI_ARTIFACT_RE.test(path) || AI_ARTIFACT_RE.test(text),
      10,
    );
    const backupRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => {
        if (!BACKUP_RE.test(path) && !BACKUP_RE.test(text)) return false;
        return (
          AI_ARTIFACT_RE.test(path + text) ||
          BACKUP_RE.test(path) ||
          /prompt|policy|index|vector|control/i.test(path + text)
        );
      },
      10,
    );
    const restoreRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        RESTORE_TEST_RE.test(path) ||
        (/(test|spec|e2e|drill|runbook)/i.test(path) &&
          RESTORE_TEST_RE.test(text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAiControlPlaneBackupReport({
      assessedAt: ctx.assessedAt.toISOString(),
      backup: { found: backupRefs.length > 0, refs: backupRefs },
      artifacts: { found: artifactRefs.length > 0, refs: artifactRefs },
      restoreTest: { found: restoreRefs.length > 0, refs: restoreRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "ai-control-plane-backup-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/ai-control-plane-backup-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "ai-control-plane-backup",
          "rel-m4",
          DETECTOR_ID,
          ...(report.summary.relM4Satisfied ? ["rel-m4-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.backup.refs,
        ...report.signals.artifacts.refs,
        ...report.signals.restoreTest.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["ai-control-plane-backup-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `REL-M4 status=${report.summary.statusHint} signals=${report.summary.backupSignalsPresent} satisfied=${report.summary.relM4Satisfied}; report=imports/${PLUGIN_ID}/ai-control-plane-backup-report.json`,
      nodes,
    };
  },
};
