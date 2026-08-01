/**
 * abuse-injection-release-gate — SEC-M3 / repo-abuse-injection-release-gate.
 *
 * Discovers abuse/jailbreak/injection security suites + blocking release gates.
 * Import abuseJailbreakInjectionSuiteConfigured +
 * productionReleasesWithSecuritySuiteGatePassPct=100 +
 * coverageWindowDays=30 +
 * failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d under
 * imports/abuse-injection-release-gate/ to unlock PASS (measuredAt ≤90d).
 * Optional `releases[]` rows are checked against the last 30 days and waiver
 * owner/expiry ≤30d metadata.
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

const PLUGIN_ID = "abuse-injection-release-gate";
const RELATED = ["SEC-M3"] as const;
const DETECTOR_ID = "repo-abuse-injection-release-gate";
const IMPORT_MAX_AGE_DAYS = 90;
const RELEASE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const SUITE_RE =
  /\b(abuse[_-]?(eval|suite|test|gate)|jailbreak[_-]?(eval|suite|test|redteam)|prompt[_-]?injection[_-]?(eval|suite|test|corpus)|injection[_-]?(eval|suite|test|corpus)|adversarial[_-]?(security|eval|suite)|security[_-]?(redteam|suite|eval))\b/i;

const CASE_CLASS_RE =
  /\b(abuse|jailbreak|prompt[_-]?injection|injection)(.{0,40})(case|fixture|scenario|class|corpus)\b|\b(case|fixture|scenario).{0,40}(abuse|jailbreak|prompt[_-]?injection)\b/i;

const GATE_RE =
  /\b((abuse|jailbreak|injection|adversarial|security)[_-]?(release|deploy|ci)[_-]?gate|block[_-]?(promote|deploy|merge|release)|required[_-]?check|fail[_-]?the[_-]?build)\b/i;

const WAIVER_RE =
  /\b(waiver|exception|time[_-]?boxed|expiry|expires[_-]?(at|on)|gate[_-]?bypass)\b/i;

export interface AbuseInjectionReleaseGateReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    suite: { found: boolean; refs: string[] };
    caseClasses: { found: boolean; refs: string[] };
    gate: { found: boolean; refs: string[] };
    waiver: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    customerFacingAiReleasesPresent: boolean | null;
    abuseJailbreakInjectionSuiteConfigured: boolean | null;
    productionReleasesWithSecuritySuiteGatePassPct: number | null;
    coverageWindowDays: number | null;
    failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: boolean | null;
    releaseRowsInWindow: number | null;
    invalidWaiverCount: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    secM3Satisfied: boolean | null;
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

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}

function waiverValid(
  waiver: Record<string, unknown> | null | undefined,
  releasedAt: Date | null,
): boolean {
  if (!waiver) return false;
  const owner =
    asStr(waiver.owner) ??
    asStr(waiver.ownedBy) ??
    asStr(waiver.ownerEmail) ??
    asStr(waiver.approver);
  if (!owner) return false;

  const expiryDays =
    asNum(waiver.expiryDays) ??
    asNum(waiver.expiry_days) ??
    asNum(waiver.maxExpiryDays);
  if (expiryDays !== null) return expiryDays <= RELEASE_WINDOW_DAYS;

  const expiresAtRaw =
    asStr(waiver.expiresAt) ??
    asStr(waiver.expires_at) ??
    asStr(waiver.expiry);
  if (!expiresAtRaw || !releasedAt) return false;
  const expiresAt = new Date(expiresAtRaw);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return daysBetween(expiresAt, releasedAt) <= RELEASE_WINDOW_DAYS;
}

function analyzeReleaseRows(
  rows: unknown,
  asOf: Date,
): {
  inWindow: number;
  passPct: number;
  invalidWaiverCount: number;
} | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let inWindow = 0;
  let covered = 0;
  let invalidWaiverCount = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const releasedRaw =
      asStr(r.releasedAt) ??
      asStr(r.released_at) ??
      asStr(r.date) ??
      asStr(r.promotedAt) ??
      asStr(r.promoted_at);
    if (!releasedRaw) continue;
    const releasedAt = new Date(releasedRaw);
    if (Number.isNaN(releasedAt.getTime())) continue;
    if (daysBetween(asOf, releasedAt) > RELEASE_WINDOW_DAYS) continue;
    if (daysBetween(asOf, releasedAt) < 0) continue;

    inWindow += 1;
    const gateRaw = String(r.gate ?? r.status ?? r.result ?? "").toLowerCase();
    const gatePass =
      r.gatePass === true ||
      r.gate_pass === true ||
      gateRaw === "pass" ||
      gateRaw === "passed" ||
      gateRaw === "success";

    const waiver =
      r.waiver && typeof r.waiver === "object"
        ? (r.waiver as Record<string, unknown>)
        : null;
    if (gatePass) {
      covered += 1;
      continue;
    }
    if (waiver) {
      if (waiverValid(waiver, releasedAt)) covered += 1;
      else invalidWaiverCount += 1;
    }
  }

  if (inWindow === 0) {
    return { inWindow: 0, passPct: 100, invalidWaiverCount };
  }
  return {
    inWindow,
    passPct: (covered / inWindow) * 100,
    invalidWaiverCount,
  };
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
): AbuseInjectionReleaseGateReport["importedResults"] {
  const sources: string[] = [];
  let customerFacingAiReleasesPresent: boolean | null = null;
  let abuseJailbreakInjectionSuiteConfigured: boolean | null = null;
  let productionReleasesWithSecuritySuiteGatePassPct: number | null = null;
  let coverageWindowDays: number | null = null;
  let failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: boolean | null =
    null;
  let releaseRowsInWindow: number | null = null;
  let invalidWaiverCount: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/abuse-injection-release-gate-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      coverageWindowDays =
        asNum(data.coverageWindowDays) ??
        asNum(data.coverage_window_days) ??
        asNum(data.releaseWindowDays) ??
        asNum(data.windowDays) ??
        coverageWindowDays;
      customerFacingAiReleasesPresent =
        asBool(data.customerFacingAiReleasesPresent) ??
        asBool(data.customer_facing_ai_releases_present) ??
        asBool(data.hasCustomerFacingAiReleases) ??
        customerFacingAiReleasesPresent;
      abuseJailbreakInjectionSuiteConfigured =
        asBool(data.abuseJailbreakInjectionSuiteConfigured) ??
        asBool(data.abuse_jailbreak_injection_suite_configured) ??
        asBool(data.suiteIncludesAbuseJailbreakInjectionCaseClasses) ??
        asBool(data.securityAbuseSuiteConfigured) ??
        abuseJailbreakInjectionSuiteConfigured;
      productionReleasesWithSecuritySuiteGatePassPct =
        asNum(data.productionReleasesWithSecuritySuiteGatePassPct) ??
        asNum(data.production_releases_with_security_suite_gate_pass_pct) ??
        asNum(data.securitySuiteGateCoveragePct) ??
        asNum(data.releaseCoveragePct) ??
        productionReleasesWithSecuritySuiteGatePassPct;
      failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d =
        asBool(
          data.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d,
        ) ??
        asBool(
          data.failing_gate_blocks_promote_unless_owned_waiver_expiry_30d,
        ) ??
        asBool(data.failingGateBlocksPromote) ??
        asBool(data.blockingGateWithOwnedWaivers) ??
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d;

      const asOf = measuredAt ? new Date(measuredAt) : ctx.assessedAt;
      const analyzed = analyzeReleaseRows(
        data.releases ?? data.productionReleases ?? data.releaseReports,
        asOf,
      );
      if (analyzed) {
        coverageWindowDays = RELEASE_WINDOW_DAYS;
        releaseRowsInWindow = analyzed.inWindow;
        invalidWaiverCount =
          (invalidWaiverCount ?? 0) + analyzed.invalidWaiverCount;
        productionReleasesWithSecuritySuiteGatePassPct = analyzed.passPct;
      }

      const waivers = data.waivers ?? data.ownedWaivers;
      if (Array.isArray(waivers)) {
        for (const w of waivers) {
          if (!w || typeof w !== "object") continue;
          if (!waiverValid(w as Record<string, unknown>, asOf)) {
            invalidWaiverCount = (invalidWaiverCount ?? 0) + 1;
          }
        }
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    customerFacingAiReleasesPresent,
    abuseJailbreakInjectionSuiteConfigured,
    productionReleasesWithSecuritySuiteGatePassPct,
    coverageWindowDays,
    failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d,
    releaseRowsInWindow,
    invalidWaiverCount,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildAbuseInjectionReleaseGateReport(opts: {
  assessedAt: string;
  suite: { found: boolean; refs: string[] };
  caseClasses: { found: boolean; refs: string[] };
  gate: { found: boolean; refs: string[] };
  waiver: { found: boolean; refs: string[] };
  imported: AbuseInjectionReleaseGateReport["importedResults"];
}): AbuseInjectionReleaseGateReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.suite.found ||
    opts.caseClasses.found ||
    opts.gate.found ||
    opts.waiver.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No abuse/jailbreak/injection release-gate signals — SEC-M3 remains not demonstrated until suite/gate evidence or an explicit N/A attest (customerFacingAiReleasesPresent=false) is imported.",
    );
  }
  if (opts.suite.found) {
    notes.push(`Suite refs: ${opts.suite.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.caseClasses.found) {
    notes.push(
      `Case-class refs: ${opts.caseClasses.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.gate.found) {
    notes.push(`Gate refs: ${opts.gate.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (suite=${opts.imported.abuseJailbreakInjectionSuiteConfigured}, coveragePct=${opts.imported.productionReleasesWithSecuritySuiteGatePassPct}, windowDays=${opts.imported.coverageWindowDays}, releasesInWindow=${opts.imported.releaseRowsInWindow}, invalidWaivers=${opts.imported.invalidWaiverCount}, blocking=${opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Gate signals alone are PARTIAL — import abuseJailbreakInjectionSuiteConfigured=true + productionReleasesWithSecuritySuiteGatePassPct=100 + coverageWindowDays=30 + failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d=true (measuredAt ≤90d) under imports/abuse-injection-release-gate/ to PASS. Prefer a releases[] report for the last 30 days. Set customerFacingAiReleasesPresent=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const suiteOk = opts.imported.abuseJailbreakInjectionSuiteConfigured === true;
  const coverageOk =
    opts.imported.productionReleasesWithSecuritySuiteGatePassPct === 100;
  const windowOk = opts.imported.coverageWindowDays === RELEASE_WINDOW_DAYS;
  const blockingOk =
    opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d === true;
  const waiversOk =
    opts.imported.invalidWaiverCount === null ||
    opts.imported.invalidWaiverCount === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const scopeAbsent = opts.imported.customerFacingAiReleasesPresent === false;

  let statusHint: AbuseInjectionReleaseGateReport["summary"]["statusHint"];
  let secM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    (opts.imported.abuseJailbreakInjectionSuiteConfigured === false ||
      (opts.imported.productionReleasesWithSecuritySuiteGatePassPct !==
        null &&
        opts.imported.productionReleasesWithSecuritySuiteGatePassPct < 100) ||
      opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d ===
        false ||
      (opts.imported.coverageWindowDays !== null &&
        opts.imported.coverageWindowDays !== RELEASE_WINDOW_DAYS) ||
      (opts.imported.invalidWaiverCount !== null &&
        opts.imported.invalidWaiverCount > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    secM3Satisfied = null;
    notes.push(
      "Imported customerFacingAiReleasesPresent=false — SEC-M3 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    secM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing suite/case classes, coverage <100% in the last 30 days, non-blocking fails, invalid/owned-waiver expiry >30d, wrong coverage window, or attest older than 90 days — SEC-M3 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    suiteOk &&
    coverageOk &&
    windowOk &&
    blockingOk &&
    waiversOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    secM3Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    secM3Satisfied = false;
    if (opts.imported.found && !suiteOk) {
      notes.push(
        "Import must show abuseJailbreakInjectionSuiteConfigured=true.",
      );
    }
    if (opts.imported.found && !coverageOk) {
      notes.push(
        "Import must show productionReleasesWithSecuritySuiteGatePassPct=100 for the last 30 days (or provide releases[] covering that window).",
      );
    }
    if (opts.imported.found && !windowOk) {
      notes.push(
        "Import must set coverageWindowDays=30 (or include releases[] dated within the last 30 days) — aggregate coverage without a 30-day window cannot unlock PASS.",
      );
    }
    if (opts.imported.found && !blockingOk) {
      notes.push(
        "Import must show failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d=true.",
      );
    }
    if (opts.imported.found && !waiversOk) {
      notes.push(
        "One or more waivers lack owner or expiry ≤30 days — required by SEC-M3.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SEC-M3 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    secM3Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      suite: opts.suite,
      caseClasses: opts.caseClasses,
      gate: opts.gate,
      waiver: opts.waiver,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      secM3Satisfied,
      statusHint,
    },
    notes,
  };
}

export const abuseInjectionReleaseGateCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const suiteRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SUITE_RE.test(path) || SUITE_RE.test(text),
      10,
    );
    const caseClassRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => CASE_CLASS_RE.test(path) || CASE_CLASS_RE.test(text),
      10,
    );
    const gateRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => GATE_RE.test(path) || GATE_RE.test(text),
      10,
    );
    const waiverRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        WAIVER_RE.test(path) ||
        ((SUITE_RE.test(path) || GATE_RE.test(path)) && WAIVER_RE.test(text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildAbuseInjectionReleaseGateReport({
      assessedAt: ctx.assessedAt.toISOString(),
      suite: { found: suiteRefs.length > 0, refs: suiteRefs },
      caseClasses: { found: caseClassRefs.length > 0, refs: caseClassRefs },
      gate: { found: gateRefs.length > 0, refs: gateRefs },
      waiver: { found: waiverRefs.length > 0, refs: waiverRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "abuse-injection-release-gate-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/abuse-injection-release-gate-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "abuse-injection-release-gate",
          "sec-m3",
          DETECTOR_ID,
          ...(report.summary.secM3Satisfied ? ["sec-m3-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.suite.refs,
        ...report.signals.caseClasses.refs,
        ...report.signals.gate.refs,
        ...report.signals.waiver.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["abuse-injection-release-gate-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SEC-M3 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.secM3Satisfied}; report=imports/${PLUGIN_ID}/abuse-injection-release-gate-report.json`,
      nodes,
    };
  },
};
