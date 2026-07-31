/**
 * platform-ai-pipeline-gates — DX-M2 / repo-ai-pipeline-gates detector executor.
 *
 * Discovers auth + secret-scan + basic eval gates in default AI CI/local
 * pipelines. Import blocking proof under imports/platform-ai-pipeline-gates/
 * to unlock PASS.
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

const PLUGIN_ID = "platform-ai-pipeline-gates";
const RELATED = ["DX-M2"] as const;
const DETECTOR_ID = "repo-ai-pipeline-gates";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|genai|ai[_-]?feature|promptfoo)/i;

const PIPELINE_PATH_RE =
  /(\.github\/workflows|Makefile|makefile|package\.json|pre-commit|azure-pipelines|Jenkinsfile|\.gitlab-ci|turbo\.json|nx\.json)/i;

const AUTH_GATE_RE =
  /\b(auth[_-]?(check|test|smoke|gate)|authn[_-]?(test|check)|oidc[_-]?test|login[_-]?smoke|http-auth-probe)\b/i;

const SECRET_SCAN_RE =
  /\b(secret[_-]?scan|gitleaks|trufflehog|detect[_-]?secrets|git[_-]?secrets|secretscann)\b/i;

const EVAL_GATE_RE =
  /\b(promptfoo|eval[_-]?(suite|gate|ci|check)|basic[_-]?eval|quality[_-]?gate|llm[_-]?eval)\b/i;

const BLOCKING_RE =
  /\b(required[_-]?check|blocks?[_-]?(merge|promote|pr)|blocking|fail[_-]?closed|protection[_-]?rule|statusCheck)\b/i;

export interface PlatformAiPipelineGatesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  gates: {
    auth: { found: boolean; refs: string[] };
    secretScan: { found: boolean; refs: string[] };
    evals: { found: boolean; refs: string[] };
    blockingSignals: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    authGatePresent: boolean | null;
    secretScanPresent: boolean | null;
    evalGatePresent: boolean | null;
    blockingOnFail: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    allThreeGatesPresent: boolean;
    dxM2Satisfied: boolean | null;
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
      ".toml",
      ".md",
      ".sh",
      ".ts",
      ".js",
      ".py",
    ],
  });
  // Also scan extensionless CI files by name via walk without filter — include Makefile etc.
  const named = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
  }).filter((f) => PIPELINE_PATH_RE.test(rel(targetPath, f)));

  const all = [...new Set([...files, ...named])];
  for (const f of all) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 100_000) || "";
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
        /\b(ChatCompletion|openai|anthropic|bedrock|generateContent|litellm|promptfoo)\b/i.test(
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
): PlatformAiPipelineGatesReport["importedResults"] {
  const sources: string[] = [];
  let authGatePresent: boolean | null = null;
  let secretScanPresent: boolean | null = null;
  let evalGatePresent: boolean | null = null;
  let blockingOnFail: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/platform-ai-pipeline-gates-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      authGatePresent =
        asBool(data.authGatePresent) ??
        asBool(data.authCheck) ??
        asBool(data.hasAuthGate) ??
        authGatePresent;
      secretScanPresent =
        asBool(data.secretScanPresent) ??
        asBool(data.secretScan) ??
        asBool(data.hasSecretScan) ??
        secretScanPresent;
      evalGatePresent =
        asBool(data.evalGatePresent) ??
        asBool(data.basicEval) ??
        asBool(data.hasEvalGate) ??
        evalGatePresent;
      blockingOnFail =
        asBool(data.blockingOnFail) ??
        asBool(data.blocksMergeOrPromote) ??
        asBool(data.requiredChecks) ??
        blockingOnFail;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const gates = Array.isArray(data.gates)
        ? (data.gates as Array<Record<string, unknown>>)
        : [];
      for (const g of gates) {
        const kind = String(g.kind || g.type || "").toLowerCase();
        const ok = g.present === true || g.passed === true || g.blocking === true;
        if (kind.includes("auth") && ok) authGatePresent = true;
        if ((kind.includes("secret") || kind.includes("gitleaks")) && ok) {
          secretScanPresent = true;
        }
        if ((kind.includes("eval") || kind.includes("promptfoo")) && ok) {
          evalGatePresent = true;
        }
        if (g.blocking === true) blockingOnFail = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    authGatePresent,
    secretScanPresent,
    evalGatePresent,
    blockingOnFail,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPlatformAiPipelineGatesReport(opts: {
  assessedAt: string;
  gates: PlatformAiPipelineGatesReport["gates"];
  aiSignals: boolean;
  imported: PlatformAiPipelineGatesReport["importedResults"];
}): PlatformAiPipelineGatesReport {
  const notes: string[] = [];
  const allThreeFromRepo =
    opts.gates.auth.found &&
    opts.gates.secretScan.found &&
    opts.gates.evals.found;
  const allThreeFromImport =
    opts.imported.authGatePresent === true &&
    opts.imported.secretScanPresent === true &&
    opts.imported.evalGatePresent === true;
  const allThreeGatesPresent = allThreeFromRepo || allThreeFromImport;

  if (
    !opts.aiSignals &&
    !allThreeGatesPresent &&
    !opts.gates.blockingSignals.found &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI/pipeline-gate signals — DX-M2 may be NOT_APPLICABLE if there is no AI build/promote surface.",
    );
  }
  if (opts.gates.auth.found) {
    notes.push(`Auth-gate refs: ${opts.gates.auth.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No auth check/gate signals found in CI/local pipelines.");
  }
  if (opts.gates.secretScan.found) {
    notes.push(
      `Secret-scan refs: ${opts.gates.secretScan.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No secret-scan signals found.");
  }
  if (opts.gates.evals.found) {
    notes.push(`Eval-gate refs: ${opts.gates.evals.refs.slice(0, 3).join(", ")}`);
  } else {
    notes.push("No basic eval gate signals found.");
  }
  if (opts.gates.blockingSignals.found) {
    notes.push(
      `Blocking signals: ${opts.gates.blockingSignals.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (auth=${opts.imported.authGatePresent}, secrets=${opts.imported.secretScanPresent}, eval=${opts.imported.evalGatePresent}, blocking=${opts.imported.blockingOnFail}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (allThreeGatesPresent || opts.gates.blockingSignals.found) {
    notes.push(
      "Gate config alone is PARTIAL — import blockingOnFail=true (≤90d) under imports/platform-ai-pipeline-gates/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const blockingOk = opts.imported.blockingOnFail === true && ageOk;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const passOk = allThreeGatesPresent && blockingOk && importFresh;

  let statusHint: PlatformAiPipelineGatesReport["summary"]["statusHint"] =
    "not_demonstrated";
  let dxM2Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.authGatePresent === false ||
      opts.imported.secretScanPresent === false ||
      opts.imported.evalGatePresent === false ||
      opts.imported.blockingOnFail === false ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.gates.auth.found &&
    !opts.gates.secretScan.found &&
    !opts.gates.evals.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dxM2Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dxM2Satisfied = false;
    notes.push(
      "Imported results show missing gates or non-blocking pipeline, or evidence older than 90 days — DX-M2 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dxM2Satisfied = true;
  } else if (
    opts.gates.auth.found ||
    opts.gates.secretScan.found ||
    opts.gates.evals.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dxM2Satisfied = false;
    if (opts.imported.found && !allThreeGatesPresent) {
      notes.push(
        "Need authGatePresent, secretScanPresent, and evalGatePresent=true (repo and/or import).",
      );
    }
    if (opts.imported.found && !blockingOk) {
      notes.push(
        "Import must show blockingOnFail=true with ageDays ≤90.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock DX-M2 PASS.",
      );
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    dxM2Satisfied = null;
    notes.push(
      "AI signals present but no auth/secret-scan/eval pipeline gates found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dxM2Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    gates: opts.gates,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      allThreeGatesPresent,
      dxM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const platformAiPipelineGatesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const inPipelineContext = (path: string, text: string) =>
      PIPELINE_PATH_RE.test(path) ||
      AI_PATH_RE.test(path) ||
      AI_PATH_RE.test(text) ||
      /\b(ci|workflow|pipeline|pre-commit|golden[_-]?path)\b/i.test(path);

    const authRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AUTH_GATE_RE.test(path) || AUTH_GATE_RE.test(text)) &&
        inPipelineContext(path, text),
    );
    const secretRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SECRET_SCAN_RE.test(path) || SECRET_SCAN_RE.test(text)) &&
        inPipelineContext(path, text),
    );
    const evalRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (EVAL_GATE_RE.test(path) || EVAL_GATE_RE.test(text)) &&
        inPipelineContext(path, text),
    );
    const blockingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (BLOCKING_RE.test(path) || BLOCKING_RE.test(text)) &&
        inPipelineContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPlatformAiPipelineGatesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      gates: {
        auth: { found: authRefs.length > 0, refs: authRefs },
        secretScan: { found: secretRefs.length > 0, refs: secretRefs },
        evals: { found: evalRefs.length > 0, refs: evalRefs },
        blockingSignals: {
          found: blockingRefs.length > 0,
          refs: blockingRefs,
        },
      },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "platform-ai-pipeline-gates-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/platform-ai-pipeline-gates-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "platform-ai-pipeline-gates",
          "dx-m2",
          DETECTOR_ID,
          ...(report.summary.allThreeGatesPresent
            ? ["auth-secret-eval-gates"]
            : []),
          ...(report.summary.dxM2Satisfied ? ["dx-m2-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...authRefs.slice(0, 2),
        ...secretRefs.slice(0, 2),
        ...evalRefs.slice(0, 2),
        ...blockingRefs.slice(0, 2),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "ci",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["platform-ai-pipeline-gates-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DX-M2 status=${report.summary.statusHint} gates=${report.summary.allThreeGatesPresent} satisfied=${report.summary.dxM2Satisfied}; report=imports/${PLUGIN_ID}/platform-ai-pipeline-gates-report.json`,
      nodes,
    };
  },
};
