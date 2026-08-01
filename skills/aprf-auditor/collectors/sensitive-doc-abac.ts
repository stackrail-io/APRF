/**
 * sensitive-doc-abac — AUTHZ-M4 detector executor.
 *
 * Discovers sensitive document-class / ABAC policy signals. Import coverage
 * under imports/sensitive-doc-abac/ to unlock PASS (measuredAt ≤90d).
 * Policy docs alone ≠ PASS.
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
  mergeAndBool,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "sensitive-doc-abac";
const RELATED = ["AUTHZ-M4"] as const;
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const CLASS_INVENTORY_RE =
  /\b(sensitive[_-]?(document|doc|class|corpus|label)|document[_-]?class(ification)?|data[_-]?classification|confidential|restricted[_-]?corpus|pii[_-]?class)\b/i;

const ABAC_POLICY_RE =
  /\b(abac|attribute[_-]?based|cedar|opa|open[_-]?policy|subject[_-]?attribute|resource[_-]?attribute|policy[_-]?as[_-]?code)\b/i;

const DENY_TEST_RE =
  /\b(deny|forbidden|unauthorized|class[_-]?access|abac[_-]?test|policy[_-]?test|assert.*40[13])\b/i;

export interface SensitiveDocAbacReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    classInventory: { found: boolean; refs: string[] };
    abacPolicy: { found: boolean; refs: string[] };
    denyTests: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    sensitiveDocumentClassesPresent: boolean | null;
    sensitiveDocumentClassesEnumerated: boolean | null;
    inventoryMatchesProductionClasses: boolean | null;
    unauthorizedClassAccessDeniedInTests: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authzM4Satisfied: boolean | null;
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
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".rego",
      ".cedar",
      ".toml",
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
): SensitiveDocAbacReport["importedResults"] {
  const sources: string[] = [];
  let sensitiveDocumentClassesPresent: boolean | null = null;
  let sensitiveDocumentClassesEnumerated: boolean | null = null;
  let inventoryMatchesProductionClasses: boolean | null = null;
  let unauthorizedClassAccessDeniedInTests: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/sensitive-doc-abac-report\.json$/i.test(f)) continue;
    if (!/\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const fileMeasuredAt = parseMeasuredAt(data);
      const present =
        asBool(data.sensitiveDocumentClassesPresent) ??
        asBool(data.sensitive_document_classes_present) ??
        asBool(data.hasSensitiveDocumentClasses);
      const enumerated =
        asBool(data.sensitiveDocumentClassesEnumerated) ??
        asBool(data.sensitive_document_classes_enumerated) ??
        asBool(data.classesEnumerated);
      const inventoryMatches =
        asBool(data.inventoryMatchesProductionClasses) ??
        asBool(data.inventory_matches_production_classes) ??
        asBool(data.inventoryMatchesProduction);
      const denyTests =
        asBool(data.unauthorizedClassAccessDeniedInTests) ??
        asBool(data.unauthorized_class_access_denied_in_tests) ??
        asBool(data.denyTestsPass);
      measuredAt = mergeOldestMeasuredAt(measuredAt, fileMeasuredAt);
      sensitiveDocumentClassesPresent = mergeOrBool(
        sensitiveDocumentClassesPresent,
        present,
      );
      sensitiveDocumentClassesEnumerated = mergeAndBool(
        sensitiveDocumentClassesEnumerated,
        enumerated,
      );
      inventoryMatchesProductionClasses = mergeAndBool(
        inventoryMatchesProductionClasses,
        inventoryMatches,
      );
      unauthorizedClassAccessDeniedInTests = mergeAndBool(
        unauthorizedClassAccessDeniedInTests,
        denyTests,
      );
      if (
        present !== null ||
        enumerated !== null ||
        inventoryMatches !== null ||
        denyTests !== null ||
        fileMeasuredAt !== null
      ) {
        sources.push(basename(f));
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    sensitiveDocumentClassesPresent,
    sensitiveDocumentClassesEnumerated,
    inventoryMatchesProductionClasses,
    unauthorizedClassAccessDeniedInTests,
    measuredAt,
    sources,
  };
}

export function buildSensitiveDocAbacReport(opts: {
  assessedAt: string;
  classInventory: { found: boolean; refs: string[] };
  abacPolicy: { found: boolean; refs: string[] };
  denyTests: { found: boolean; refs: string[] };
  imported: SensitiveDocAbacReport["importedResults"];
}): SensitiveDocAbacReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.classInventory.found ||
    opts.abacPolicy.found ||
    opts.denyTests.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No sensitive-document ABAC signals — AUTHZ-M4 remains not demonstrated until class inventory + ABAC deny-test evidence or an explicit N/A attest (sensitiveDocumentClassesPresent=false) is imported.",
    );
  }
  if (opts.classInventory.found) {
    notes.push(
      `Sensitive-class inventory refs: ${opts.classInventory.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.abacPolicy.found) {
    notes.push(
      `ABAC/policy refs: ${opts.abacPolicy.refs.slice(0, 3).join(", ")}; policy docs alone do not satisfy AUTHZ-M4.`,
    );
  }
  if (opts.denyTests.found) {
    notes.push(
      `Deny/policy-test refs: ${opts.denyTests.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.sensitiveDocumentClassesPresent}, enumerated=${opts.imported.sensitiveDocumentClassesEnumerated}, inventoryMatch=${opts.imported.inventoryMatchesProductionClasses}, denyTests=${opts.imported.unauthorizedClassAccessDeniedInTests}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import sensitiveDocumentClassesEnumerated=true + inventoryMatchesProductionClasses=true + unauthorizedClassAccessDeniedInTests=true (measuredAt ≤90d) under imports/sensitive-doc-abac/ to PASS. Set sensitiveDocumentClassesPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const scopeAbsent =
    opts.imported.sensitiveDocumentClassesPresent === false &&
    !gateSignalsPresent;
  const scopePresent = opts.imported.sensitiveDocumentClassesPresent === true;
  const surfaceOk = gateSignalsPresent || scopePresent;

  const enumeratedOk =
    opts.imported.sensitiveDocumentClassesEnumerated === true;
  const inventoryOk = opts.imported.inventoryMatchesProductionClasses === true;
  const denyOk = opts.imported.unauthorizedClassAccessDeniedInTests === true;

  let statusHint: SensitiveDocAbacReport["summary"]["statusHint"];
  let authzM4Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.sensitiveDocumentClassesEnumerated === false ||
      opts.imported.inventoryMatchesProductionClasses === false ||
      opts.imported.unauthorizedClassAccessDeniedInTests === false);

  if (
    opts.imported.found &&
    opts.imported.sensitiveDocumentClassesPresent === false &&
    !gateSignalsPresent
  ) {
    statusHint = "not_applicable";
    authzM4Satisfied = null;
    notes.push(
      "Imported sensitiveDocumentClassesPresent=false — AUTHZ-M4 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.sensitiveDocumentClassesPresent === false &&
    gateSignalsPresent
  ) {
    notes.push(
      "Imported sensitiveDocumentClassesPresent=false ignored — in-repo class/ABAC/deny-test signals prove the surface exists.",
    );
    if (explicitFail) {
      statusHint = "fail";
      authzM4Satisfied = false;
    } else if (enumeratedOk && inventoryOk && denyOk && importFresh) {
      statusHint = "pass";
      authzM4Satisfied = true;
    } else {
      statusHint = "partial";
      authzM4Satisfied = false;
      if (!importFresh && opts.imported.found) {
        notes.push(
          "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-M4 PASS.",
        );
      }
    }
  } else if (explicitFail) {
    statusHint = "fail";
    authzM4Satisfied = false;
    if (opts.imported.sensitiveDocumentClassesEnumerated === false) {
      notes.push("sensitiveDocumentClassesEnumerated=false.");
    }
    if (opts.imported.inventoryMatchesProductionClasses === false) {
      notes.push("inventoryMatchesProductionClasses=false.");
    }
    if (opts.imported.unauthorizedClassAccessDeniedInTests === false) {
      notes.push("unauthorizedClassAccessDeniedInTests=false.");
    }
  } else if (
    surfaceOk &&
    enumeratedOk &&
    inventoryOk &&
    denyOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authzM4Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authzM4Satisfied = false;
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import measuredAt older than 90 days (or missing) — required to unlock AUTHZ-M4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authzM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      classInventory: opts.classInventory,
      abacPolicy: opts.abacPolicy,
      denyTests: opts.denyTests,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authzM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const sensitiveDocAbacCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;
    const classRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => CLASS_INVENTORY_RE.test(p) || CLASS_INVENTORY_RE.test(t),
    );
    const abacRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => ABAC_POLICY_RE.test(p) || ABAC_POLICY_RE.test(t),
    );
    const denyRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        (DENY_TEST_RE.test(p) || DENY_TEST_RE.test(t)) &&
        (CLASS_INVENTORY_RE.test(t) ||
          ABAC_POLICY_RE.test(t) ||
          /test/i.test(p)),
    );
    const imported = loadImported(ctx);

    const report = buildSensitiveDocAbacReport({
      assessedAt: ctx.assessedAt.toISOString(),
      classInventory: { found: classRefs.length > 0, refs: classRefs },
      abacPolicy: { found: abacRefs.length > 0, refs: abacRefs },
      denyTests: { found: denyRefs.length > 0, refs: denyRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "sensitive-doc-abac-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/sensitive-doc-abac-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              imported: {
                enumerated:
                  report.importedResults.sensitiveDocumentClassesEnumerated,
                inventoryMatch:
                  report.importedResults.inventoryMatchesProductionClasses,
                denyTests:
                  report.importedResults.unauthorizedClassAccessDeniedInTests,
                measuredAt: report.importedResults.measuredAt,
              },
            },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "sensitive-doc-abac",
          "authz-m4",
          `authz-m4-${report.summary.statusHint}`,
          ...(report.summary.authzM4Satisfied
            ? ["authz-m4-satisfied"]
            : ["authz-m4-fail-or-incomplete"]),
          ...(report.signals.abacPolicy.found ? ["abac"] : []),
          ...(report.signals.classInventory.found
            ? ["document-classification"]
            : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHZ-M4 status=${report.summary.statusHint} satisfied=${report.summary.authzM4Satisfied}; report=imports/${PLUGIN_ID}/sensitive-doc-abac-report.json`,
      nodes,
    };
  },
};
