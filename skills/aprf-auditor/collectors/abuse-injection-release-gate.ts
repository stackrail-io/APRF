/**
 * abuse-injection-release-gate — SEC-M3 / repo-abuse-injection-release-gate.
 *
 * Discovers abuse/jailbreak/injection security suites + blocking release gates.
 * Import abuseJailbreakInjectionSuiteConfigured +
 * productionReleasesWithSecuritySuiteGatePassPct=100 +
 * failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d under
 * imports/abuse-injection-release-gate/ to unlock PASS (measuredAt ≤90d).
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
    abuseJailbreakInjectionSuiteConfigured: boolean | null;
    productionReleasesWithSecuritySuiteGatePassPct: number | null;
    failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: boolean | null;
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
  let abuseJailbreakInjectionSuiteConfigured: boolean | null = null;
  let productionReleasesWithSecuritySuiteGatePassPct: number | null = null;
  let failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: boolean | null =
    null;
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
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    abuseJailbreakInjectionSuiteConfigured,
    productionReleasesWithSecuritySuiteGatePassPct,
    failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d,
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
      "No abuse/jailbreak/injection release-gate signals — SEC-M3 may be NOT_APPLICABLE if there are no customer-facing AI releases.",
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
      `Imported: ${opts.imported.sources.join(", ")} (suite=${opts.imported.abuseJailbreakInjectionSuiteConfigured}, coveragePct=${opts.imported.productionReleasesWithSecuritySuiteGatePassPct}, blocking=${opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Gate signals alone are PARTIAL — import abuseJailbreakInjectionSuiteConfigured=true + productionReleasesWithSecuritySuiteGatePassPct=100 + failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d=true (measuredAt ≤90d) under imports/abuse-injection-release-gate/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const suiteOk = opts.imported.abuseJailbreakInjectionSuiteConfigured === true;
  const coverageOk =
    opts.imported.productionReleasesWithSecuritySuiteGatePassPct === 100;
  const blockingOk =
    opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: AbuseInjectionReleaseGateReport["summary"]["statusHint"];
  let secM3Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.abuseJailbreakInjectionSuiteConfigured === false ||
      (opts.imported.productionReleasesWithSecuritySuiteGatePassPct !==
        null &&
        opts.imported.productionReleasesWithSecuritySuiteGatePassPct < 100) ||
      opts.imported.failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d ===
        false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    secM3Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    secM3Satisfied = false;
    notes.push(
      "Imported evidence shows missing suite/case classes, coverage <100%, non-blocking fails without owned ≤30d waivers, or attest older than 90 days — SEC-M3 fail.",
    );
  } else if (
    (gateSignalsPresent || opts.imported.found) &&
    suiteOk &&
    coverageOk &&
    blockingOk &&
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
        "Import must show productionReleasesWithSecuritySuiteGatePassPct=100 for the last 30 days.",
      );
    }
    if (opts.imported.found && !blockingOk) {
      notes.push(
        "Import must show failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d=true.",
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
