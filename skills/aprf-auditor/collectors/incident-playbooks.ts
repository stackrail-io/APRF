/**
 * incident-playbooks — INC-M1 / repo-incident-playbooks.
 *
 * Discovers AI-specific incident playbooks for abuse, leakage, bad actions,
 * and provider outage. Import fourPlaybooksPresent + allPlaybooksHaveOwner +
 * allPlaybooksReviewedWithin12Months under imports/incident-playbooks/
 * to unlock PASS (measuredAt ≤90d).
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

const PLUGIN_ID = "incident-playbooks";
const RELATED = ["INC-M1"] as const;
const DETECTOR_ID = "repo-incident-playbooks";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const PLAYBOOK_RE =
  /\b(playbook|runbook|incident[\s_-]*response|ir[\s_-]*plan)\b/i;

const ABUSE_RE =
  /\b(abuse|prompt[\s_-]*injection|jailbreak|adversarial[\s_-]*use|misuse)\b/i;

const LEAKAGE_RE =
  /\b(leak(?:age)?|data[\s_-]*exfil|pii[\s_-]*expos|secret[\s_-]*expos|confidential[\s_-]*disclos)\b/i;

const BAD_ACTIONS_RE =
  /\b(bad[\s_-]*action|harmful[\s_-]*action|unsafe[\s_-]*tool|rogue[\s_-]*agent|unintended[\s_-]*action|tool[\s_-]*misuse)\b/i;

const PROVIDER_OUTAGE_RE =
  /\b(provider[\s_-]*outage|model[\s_-]*outage|llm[\s_-]*outage|api[\s_-]*outage|vendor[\s_-]*outage|openai[\s_-]*down|bedrock[\s_-]*outage)\b/i;

const OWNER_RE =
  /\b(owner|owned[\s_-]*by|playbook[\s_-]*owner|on[\s_-]*call[\s_-]*owner|responsible)\b/i;

const REVIEW_RE =
  /\b(reviewed?[\s_-]*(on|at|date)|last[\s_-]*review|review[\s_-]*date|next[\s_-]*review)\b/i;

export interface IncidentPlaybooksReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    abuse: { found: boolean; refs: string[] };
    leakage: { found: boolean; refs: string[] };
    badActions: { found: boolean; refs: string[] };
    providerOutage: { found: boolean; refs: string[] };
    ownerOrReview: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    fourPlaybooksPresent: boolean | null;
    allPlaybooksHaveOwner: boolean | null;
    allPlaybooksReviewedWithin12Months: boolean | null;
    missingPlaybookCount: number | null;
    playbooksMissingOwner: number | null;
    playbooksWithStaleReview: number | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    playbookSignalsPresent: boolean;
    scenarioCoverageCount: number;
    incM1Satisfied: boolean | null;
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
      ".html",
      ".rst",
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

function scenarioRefs(
  targetPath: string,
  maxFiles: number,
  scenarioRe: RegExp,
): string[] {
  return collectRefs(
    targetPath,
    maxFiles,
    (path, text) =>
      (PLAYBOOK_RE.test(path) || PLAYBOOK_RE.test(text)) &&
      (scenarioRe.test(path) || scenarioRe.test(text)),
    8,
  );
}

function loadImported(
  ctx: CollectorContext,
): IncidentPlaybooksReport["importedResults"] {
  const sources: string[] = [];
  let fourPlaybooksPresent: boolean | null = null;
  let allPlaybooksHaveOwner: boolean | null = null;
  let allPlaybooksReviewedWithin12Months: boolean | null = null;
  let missingPlaybookCount: number | null = null;
  let playbooksMissingOwner: number | null = null;
  let playbooksWithStaleReview: number | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/incident-playbooks-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
      fourPlaybooksPresent =
        asBool(data.fourPlaybooksPresent) ??
        asBool(data.four_playbooks_present) ??
        fourPlaybooksPresent;
      allPlaybooksHaveOwner =
        asBool(data.allPlaybooksHaveOwner) ??
        asBool(data.all_playbooks_have_owner) ??
        allPlaybooksHaveOwner;
      allPlaybooksReviewedWithin12Months =
        asBool(data.allPlaybooksReviewedWithin12Months) ??
        asBool(data.all_playbooks_reviewed_within_12_months) ??
        allPlaybooksReviewedWithin12Months;
      missingPlaybookCount =
        asNum(data.missingPlaybookCount) ??
        asNum(data.missing_playbook_count) ??
        missingPlaybookCount;
      playbooksMissingOwner =
        asNum(data.playbooksMissingOwner) ??
        asNum(data.playbooks_missing_owner) ??
        playbooksMissingOwner;
      playbooksWithStaleReview =
        asNum(data.playbooksWithStaleReview) ??
        asNum(data.playbooks_with_stale_review) ??
        playbooksWithStaleReview;

      const coverage = asNum(data.playbookCoverageCount) ??
        asNum(data.playbook_coverage_count);
      if (coverage !== null) {
        fourPlaybooksPresent = fourPlaybooksPresent ?? coverage >= 4;
        missingPlaybookCount =
          missingPlaybookCount ?? Math.max(0, 4 - coverage);
      }
      if (missingPlaybookCount !== null) {
        fourPlaybooksPresent =
          fourPlaybooksPresent ?? missingPlaybookCount === 0;
      }
      if (playbooksMissingOwner !== null) {
        allPlaybooksHaveOwner =
          allPlaybooksHaveOwner ?? playbooksMissingOwner === 0;
      }
      if (playbooksWithStaleReview !== null) {
        allPlaybooksReviewedWithin12Months =
          allPlaybooksReviewedWithin12Months ??
          playbooksWithStaleReview === 0;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    fourPlaybooksPresent,
    allPlaybooksHaveOwner,
    allPlaybooksReviewedWithin12Months,
    missingPlaybookCount,
    playbooksMissingOwner,
    playbooksWithStaleReview,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildIncidentPlaybooksReport(opts: {
  assessedAt: string;
  abuse: { found: boolean; refs: string[] };
  leakage: { found: boolean; refs: string[] };
  badActions: { found: boolean; refs: string[] };
  providerOutage: { found: boolean; refs: string[] };
  ownerOrReview: { found: boolean; refs: string[] };
  imported: IncidentPlaybooksReport["importedResults"];
}): IncidentPlaybooksReport {
  const notes: string[] = [];
  const scenarioCoverageCount = [
    opts.abuse.found,
    opts.leakage.found,
    opts.badActions.found,
    opts.providerOutage.found,
  ].filter(Boolean).length;
  const playbookSignalsPresent =
    scenarioCoverageCount > 0 || opts.ownerOrReview.found;

  if (!playbookSignalsPresent && !opts.imported.found) {
    notes.push(
      "No AI incident-playbook signals — INC-M1 may be NOT_APPLICABLE if no production AI system is in scope.",
    );
  }
  if (opts.abuse.found) {
    notes.push(`Abuse refs: ${opts.abuse.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.leakage.found) {
    notes.push(`Leakage refs: ${opts.leakage.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.badActions.found) {
    notes.push(
      `Bad-actions refs: ${opts.badActions.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.providerOutage.found) {
    notes.push(
      `Provider-outage refs: ${opts.providerOutage.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (four=${opts.imported.fourPlaybooksPresent}, owners=${opts.imported.allPlaybooksHaveOwner}, reviewed12m=${opts.imported.allPlaybooksReviewedWithin12Months})`,
    );
  } else if (playbookSignalsPresent) {
    notes.push(
      "Playbook signals alone are PARTIAL — import fourPlaybooksPresent=true + allPlaybooksHaveOwner=true + allPlaybooksReviewedWithin12Months=true (measuredAt ≤90d) under imports/incident-playbooks/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const fourOk =
    opts.imported.fourPlaybooksPresent === true ||
    opts.imported.missingPlaybookCount === 0;
  const ownersOk =
    opts.imported.allPlaybooksHaveOwner === true ||
    opts.imported.playbooksMissingOwner === 0;
  const reviewOk =
    opts.imported.allPlaybooksReviewedWithin12Months === true ||
    opts.imported.playbooksWithStaleReview === 0;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);

  let statusHint: IncidentPlaybooksReport["summary"]["statusHint"] ;
  let incM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    (opts.imported.fourPlaybooksPresent === false ||
      opts.imported.allPlaybooksHaveOwner === false ||
      opts.imported.allPlaybooksReviewedWithin12Months === false ||
      (typeof opts.imported.missingPlaybookCount === "number" &&
        opts.imported.missingPlaybookCount > 0) ||
      (typeof opts.imported.playbooksMissingOwner === "number" &&
        opts.imported.playbooksMissingOwner > 0) ||
      (typeof opts.imported.playbooksWithStaleReview === "number" &&
        opts.imported.playbooksWithStaleReview > 0) ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (!playbookSignalsPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    incM1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    incM1Satisfied = false;
    notes.push(
      "Imported evidence shows missing playbooks, missing owners, stale reviews (>12 months), or evidence older than 90 days — INC-M1 fail.",
    );
  } else if (
    (playbookSignalsPresent || opts.imported.found) &&
    fourOk &&
    ownersOk &&
    reviewOk &&
    ageOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    incM1Satisfied = true;
  } else if (playbookSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    incM1Satisfied = false;
    if (opts.imported.found && !fourOk) {
      notes.push(
        "Import must show fourPlaybooksPresent=true (or missingPlaybookCount=0).",
      );
    }
    if (opts.imported.found && !ownersOk) {
      notes.push(
        "Import must show allPlaybooksHaveOwner=true (or playbooksMissingOwner=0).",
      );
    }
    if (opts.imported.found && !reviewOk) {
      notes.push(
        "Import must show allPlaybooksReviewedWithin12Months=true (or playbooksWithStaleReview=0).",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock INC-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    incM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      abuse: opts.abuse,
      leakage: opts.leakage,
      badActions: opts.badActions,
      providerOutage: opts.providerOutage,
      ownerOrReview: opts.ownerOrReview,
    },
    importedResults: opts.imported,
    summary: {
      playbookSignalsPresent,
      scenarioCoverageCount,
      incM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const incidentPlaybooksCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const abuse = scenarioRefs(ctx.targetPath, maxFiles, ABUSE_RE);
    const leakage = scenarioRefs(ctx.targetPath, maxFiles, LEAKAGE_RE);
    const badActions = scenarioRefs(ctx.targetPath, maxFiles, BAD_ACTIONS_RE);
    const providerOutage = scenarioRefs(
      ctx.targetPath,
      maxFiles,
      PROVIDER_OUTAGE_RE,
    );
    const ownerOrReview = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (PLAYBOOK_RE.test(path) || PLAYBOOK_RE.test(text)) &&
        (OWNER_RE.test(text) || REVIEW_RE.test(text)),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildIncidentPlaybooksReport({
      assessedAt: ctx.assessedAt.toISOString(),
      abuse: { found: abuse.length > 0, refs: abuse },
      leakage: { found: leakage.length > 0, refs: leakage },
      badActions: { found: badActions.length > 0, refs: badActions },
      providerOutage: {
        found: providerOutage.length > 0,
        refs: providerOutage,
      },
      ownerOrReview: {
        found: ownerOrReview.length > 0,
        refs: ownerOrReview,
      },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "incident-playbooks-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/incident-playbooks-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "incident-playbooks",
          "inc-m1",
          DETECTOR_ID,
          ...(report.summary.incM1Satisfied ? ["inc-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.abuse.refs,
        ...report.signals.leakage.refs,
        ...report.signals.badActions.refs,
        ...report.signals.providerOutage.refs,
        ...report.signals.ownerOrReview.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["incident-playbooks-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `INC-M1 status=${report.summary.statusHint} scenarios=${report.summary.scenarioCoverageCount}/4 satisfied=${report.summary.incM1Satisfied}; report=imports/${PLUGIN_ID}/incident-playbooks-report.json`,
      nodes,
    };
  },
};
