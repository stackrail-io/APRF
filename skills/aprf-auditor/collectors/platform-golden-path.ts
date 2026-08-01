/**
 * platform-golden-path — DX-M1 / repo-golden-path-docs detector executor.
 *
 * Discovers golden-path / paved-road AI deploy docs. Import review attestation
 * (≤12 months) under imports/platform-golden-path/ to unlock PASS.
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

const PLUGIN_ID = "platform-golden-path";
const RELATED = ["DX-M1"] as const;
const DETECTOR_ID = "repo-golden-path-docs";
/** Spec: reviewed ≤12 months. */
const REVIEW_MAX_AGE_DAYS = 365;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|ai[_-]?feature|genai|mlops)/i;

const GOLDEN_PATH_RE =
  /golden[\s_-]*path|paved[\s_-]*road|platform[\s_-]*(guide|handbook|playbook)|ai[\s_-]*(deploy|platform)[\s_-]*(guide|path|docs)|deploy(?:ing)?[\s_-]*ai/i;

const AUTH_RE = /\b(authn|auths?|authentication|oidc|sso|identity)\b/i;
const SECRETS_RE =
  /\b(secrets?(?:[\s_-]?manager)?|vault|credential)\b/i;
const EVALS_RE =
  /\b(evals?|evaluation|promptfoo|quality[\s_-]?gate|regression[\s_-]?suite)\b/i;
const PROMOTE_RE =
  /\b(promot(?:e|ion)|release|deploys?|deployment|staging|production[\s_-]?(gate|promote)|change[\s_-]?mgmt)\b/i;

export interface PlatformGoldenPathReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  docs: {
    found: boolean;
    refs: string[];
    coversAuth: boolean;
    coversSecrets: boolean;
    coversEvals: boolean;
    coversPromote: boolean;
  };
  importedResults: {
    found: boolean;
    docPresent: boolean | null;
    hasVersion: boolean | null;
    hasOwner: boolean | null;
    coversAuth: boolean | null;
    coversSecrets: boolean | null;
    coversEvals: boolean | null;
    coversPromote: boolean | null;
    reviewedWithin12Months: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    docPresent: boolean;
    sectionsComplete: boolean;
    dxM1Satisfied: boolean | null;
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
    extensions: [".md", ".mdx", ".rst", ".txt", ".yml", ".yaml", ".html"],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 120_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function detectAiSignals(targetPath: string, maxFiles: number): boolean {
  return (
    collectRefs(
      targetPath,
      Math.min(maxFiles, 2000),
      (path, text) =>
        AI_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm)\b/i.test(
          text,
        ),
      5,
    ).length > 0
  );
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function loadImported(
  ctx: CollectorContext,
): PlatformGoldenPathReport["importedResults"] {
  const sources: string[] = [];
  let docPresent: boolean | null = null;
  let hasVersion: boolean | null = null;
  let hasOwner: boolean | null = null;
  let coversAuth: boolean | null = null;
  let coversSecrets: boolean | null = null;
  let coversEvals: boolean | null = null;
  let coversPromote: boolean | null = null;
  let reviewedWithin12Months: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/platform-golden-path-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      docPresent =
        asBool(data.docPresent) ??
        asBool(data.goldenPathPresent) ??
        asBool(data.exists) ??
        docPresent;
      hasVersion =
        asBool(data.hasVersion) ??
        (typeof data.version === "string" && data.version.trim()
          ? true
          : null) ??
        hasVersion;
      hasOwner =
        asBool(data.hasOwner) ??
        (typeof data.owner === "string" && data.owner.trim() ? true : null) ??
        hasOwner;
      coversAuth = asBool(data.coversAuth) ?? asBool(data.auth) ?? coversAuth;
      coversSecrets =
        asBool(data.coversSecrets) ?? asBool(data.secrets) ?? coversSecrets;
      coversEvals =
        asBool(data.coversEvals) ?? asBool(data.evals) ?? coversEvals;
      coversPromote =
        asBool(data.coversPromote) ??
        asBool(data.promote) ??
        asBool(data.promotion) ??
        coversPromote;
      reviewedWithin12Months =
        asBool(data.reviewedWithin12Months) ??
        asBool(data.reviewedWithinYear) ??
        asBool(data.reviewFresh) ??
        reviewedWithin12Months;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    docPresent,
    hasVersion,
    hasOwner,
    coversAuth,
    coversSecrets,
    coversEvals,
    coversPromote,
    reviewedWithin12Months,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPlatformGoldenPathReport(opts: {
  assessedAt: string;
  docs: PlatformGoldenPathReport["docs"];
  aiSignals: boolean;
  imported: PlatformGoldenPathReport["importedResults"];
}): PlatformGoldenPathReport {
  const notes: string[] = [];
  const docPresent = opts.docs.found || opts.imported.docPresent === true;
  const sectionsFromRepo =
    opts.docs.coversAuth &&
    opts.docs.coversSecrets &&
    opts.docs.coversEvals &&
    opts.docs.coversPromote;
  const sectionsFromImport =
    opts.imported.coversAuth === true &&
    opts.imported.coversSecrets === true &&
    opts.imported.coversEvals === true &&
    opts.imported.coversPromote === true;
  const sectionsComplete = sectionsFromRepo || sectionsFromImport;

  if (!opts.aiSignals && !docPresent && !opts.imported.found) {
    notes.push(
      "No AI/golden-path signals — DX-M1 may be NOT_APPLICABLE if the org does not build AI features.",
    );
  }
  if (opts.docs.found) {
    notes.push(`Golden-path doc refs: ${opts.docs.refs.slice(0, 4).join(", ")}`);
    notes.push(
      `Section heuristics: auth=${opts.docs.coversAuth} secrets=${opts.docs.coversSecrets} evals=${opts.docs.coversEvals} promote=${opts.docs.coversPromote}`,
    );
  } else {
    notes.push("No golden-path / paved-road documentation signals found.");
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (doc=${opts.imported.docPresent}, version=${opts.imported.hasVersion}, owner=${opts.imported.hasOwner}, review=${opts.imported.reviewedWithin12Months}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (docPresent) {
    notes.push(
      "Doc signals alone are PARTIAL — import review attestation (version/owner/sections/≤12mo) under imports/platform-golden-path/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= REVIEW_MAX_AGE_DAYS;
  const reviewOk =
    opts.imported.reviewedWithin12Months === true && ageOk;
  const metaOk =
    opts.imported.hasVersion === true && opts.imported.hasOwner === true;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(),
    REVIEW_MAX_AGE_DAYS,
  );
  const passOk =
    (opts.imported.docPresent === true || opts.docs.found) &&
    metaOk &&
    sectionsComplete &&
    reviewOk &&
    importFresh;

  let statusHint: PlatformGoldenPathReport["summary"]["statusHint"];
  let dxM1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.docPresent === false ||
      opts.imported.hasVersion === false ||
      opts.imported.hasOwner === false ||
      opts.imported.coversAuth === false ||
      opts.imported.coversSecrets === false ||
      opts.imported.coversEvals === false ||
      opts.imported.coversPromote === false ||
      opts.imported.reviewedWithin12Months === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > REVIEW_MAX_AGE_DAYS));

  if (!opts.aiSignals && !opts.docs.found && !opts.imported.found) {
    statusHint = "not_applicable";
    dxM1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dxM1Satisfied = false;
    notes.push(
      "Imported results show missing doc/version/owner/sections or review older than 12 months — DX-M1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dxM1Satisfied = true;
  } else if (opts.docs.found || opts.imported.found) {
    statusHint = "partial";
    dxM1Satisfied = false;
    if (opts.imported.found && !metaOk) {
      notes.push("Import must show hasVersion=true and hasOwner=true.");
    }
    if (opts.imported.found && !sectionsComplete) {
      notes.push(
        "Need coversAuth, coversSecrets, coversEvals, coversPromote=true (repo and/or import).",
      );
    }
    if (opts.imported.found && !reviewOk) {
      notes.push(
        "Import must show reviewedWithin12Months=true with ageDays ≤365.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤365 days) — required to unlock DX-M1 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    dxM1Satisfied = null;
    notes.push(
      "AI signals present but no golden-path documentation or review attestation found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dxM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    docs: opts.docs,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      docPresent,
      sectionsComplete,
      dxM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const platformGoldenPathCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const docHits: {
      ref: string;
      coversAuth: boolean;
      coversSecrets: boolean;
      coversEvals: boolean;
      coversPromote: boolean;
    }[] = [];

    const files = walkFiles(ctx.targetPath, {
      maxFiles: Math.max(maxFiles, 5000),
      extensions: [".md", ".mdx", ".rst", ".txt", ".yml", ".yaml", ".html"],
    });
    for (const f of files) {
      const r = rel(ctx.targetPath, f);
      if (isSkippable(r)) continue;
      const text = readText(f, 120_000) || "";
      if (!GOLDEN_PATH_RE.test(r) && !GOLDEN_PATH_RE.test(text)) continue;
      if (
        !(
          AI_PATH_RE.test(r) ||
          AI_PATH_RE.test(text) ||
          GOLDEN_PATH_RE.test(r) ||
          /\b(scaffold|template|platform)\b/i.test(r)
        )
      ) {
        continue;
      }
      docHits.push({
        ref: r,
        coversAuth: AUTH_RE.test(text),
        coversSecrets: SECRETS_RE.test(text),
        coversEvals: EVALS_RE.test(text),
        coversPromote: PROMOTE_RE.test(text),
      });
      if (docHits.length >= 16) break;
    }

    const docRefs = docHits.map((h) => h.ref);
    const coversAuth = docHits.some((h) => h.coversAuth);
    const coversSecrets = docHits.some((h) => h.coversSecrets);
    const coversEvals = docHits.some((h) => h.coversEvals);
    const coversPromote = docHits.some((h) => h.coversPromote);

    const imported = loadImported(ctx);
    const report = buildPlatformGoldenPathReport({
      assessedAt: ctx.assessedAt.toISOString(),
      docs: {
        found: docRefs.length > 0,
        refs: docRefs,
        coversAuth,
        coversSecrets,
        coversEvals,
        coversPromote,
      },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "platform-golden-path-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/platform-golden-path-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "platform-golden-path",
          "dx-m1",
          DETECTOR_ID,
          ...(report.summary.docPresent ? ["golden-path-doc"] : []),
          ...(report.summary.dxM1Satisfied ? ["dx-m1-satisfied"] : []),
        ],
      },
    ];

    for (const r of docRefs.slice(0, 6)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "docs",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["platform-golden-path-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DX-M1 status=${report.summary.statusHint} doc=${report.summary.docPresent} sections=${report.summary.sectionsComplete} satisfied=${report.summary.dxM1Satisfied}; report=imports/${PLUGIN_ID}/platform-golden-path-report.json`,
      nodes,
    };
  },
};
