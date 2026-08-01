/**
 * a2a-peer-auth — AGN-M4 / repo-a2a-config detector executor.
 *
 * Finds A2A / multi-agent handoff config (auth + capability scope signals)
 * and negative-test refs. Import deny-suite results under imports/a2a-peer-auth/
 * to unlock PASS. No multi-agent signals → not_applicable hint.
 */
import { writeFileSync, existsSync } from "node:fs";
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
import { measuredAtFresh, parseMeasuredAt } from "./lib/import-attest.ts";

const PLUGIN_ID = "a2a-peer-auth";
const RELATED = ["AGN-M4"] as const;
const DETECTOR_ID = "repo-a2a-config";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const A2A_PATH_RE =
  /(a2a|agent.?to.?agent|multi.?agent|handoff|peer.?agent|supervisor|sub.?agent)/i;

const AUTH_RE =
  /\b(mTLS|mutual.?tls|workload.?identity|peer.?auth|authenticate.?peer|agent.?identity|jwt|oidc|capability.?token|signed.?token|spiffe|service.?account)\b/i;

const SCOPE_RE =
  /\b(capability|scope[ds]?|allowlist|least.?privilege|permission|grant|claims|tool.?scope|data.?scope)\b/i;

const NEGATIVE_TEST_RE =
  /\b(unauth|forged|over.?scoped|deny|negative|unauthorized|spoof|invalid.?token)\b/i;

const TEST_PATH_RE = /(test|spec|e2e|fixture|__tests__)/i;

export interface A2aPeerAuthReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  handoffPaths: { found: boolean; refs: string[] };
  peerAuth: { found: boolean; refs: string[] };
  scopedCapabilities: { found: boolean; refs: string[] };
  negativeTests: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    pathCount: number | null;
    denyRatePct: number | null;
    unauthenticatedDenied: boolean | null;
    forgedDenied: boolean | null;
    overScopedDenied: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    multiAgentPresent: boolean;
    authAndScopePresent: boolean;
    negativeTestsPresent: boolean;
    agnM4Satisfied: boolean | null;
    statusHint: "pass" | "partial" | "fail" | "not_demonstrated" | "not_applicable";
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
      ".py",
      ".ts",
      ".js",
      ".tsx",
      ".yml",
      ".yaml",
      ".json",
      ".toml",
      ".md",
      ".proto",
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

function loadImported(ctx: CollectorContext): A2aPeerAuthReport["importedResults"] {
  const sources: string[] = [];
  let pathCount: number | null = null;
  let denyRatePct: number | null = null;
  let unauthenticatedDenied: boolean | null = null;
  let forgedDenied: boolean | null = null;
  let overScopedDenied: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/a2a-peer-auth-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      if (typeof data.pathCount === "number") pathCount = data.pathCount;
      if (typeof data.denyRatePct === "number") denyRatePct = data.denyRatePct;
      if (typeof data.unauthenticatedDenied === "boolean") {
        unauthenticatedDenied = data.unauthenticatedDenied;
      }
      if (typeof data.forgedDenied === "boolean") {
        forgedDenied = data.forgedDenied;
      }
      if (typeof data.overScopedDenied === "boolean") {
        overScopedDenied = data.overScopedDenied;
      }
      const cases = Array.isArray(data.cases)
        ? (data.cases as Array<Record<string, unknown>>)
        : Array.isArray(data.results)
          ? (data.results as Array<Record<string, unknown>>)
          : [];
      if (cases.length) {
        pathCount = (pathCount ?? 0) + cases.length;
        const denied = cases.filter((c) => {
          const r = String(c.result || c.status || "").toLowerCase();
          return (
            c.denied === true ||
            r === "deny" ||
            r === "denied" ||
            r === "pass" ||
            r === "blocked"
          );
        }).length;
        const rate = (denied / cases.length) * 100;
        denyRatePct =
          denyRatePct === null ? rate : Math.min(denyRatePct, rate);

        const byKind = (kind: string) =>
          cases.filter(
            (c) =>
              String(c.kind || c.attack || c.caseType || "")
                .toLowerCase()
                .includes(kind),
          );
        const allDenied = (subset: typeof cases) =>
          subset.length > 0 &&
          subset.every((c) => {
            const r = String(c.result || c.status || "").toLowerCase();
            return (
              c.denied === true ||
              r === "deny" ||
              r === "denied" ||
              r === "pass" ||
              r === "blocked"
            );
          });

        const unauth = byKind("unauth");
        const forged = byKind("forge");
        const over = byKind("scope");
        if (unauth.length) unauthenticatedDenied = allDenied(unauth);
        if (forged.length) forgedDenied = allDenied(forged);
        if (over.length) overScopedDenied = allDenied(over);
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    pathCount,
    denyRatePct,
    unauthenticatedDenied,
    forgedDenied,
    overScopedDenied,
    measuredAt,
    sources,
  };
}

export function buildA2aPeerAuthReport(opts: {
  assessedAt: string;
  handoffPaths: { found: boolean; refs: string[] };
  peerAuth: { found: boolean; refs: string[] };
  scopedCapabilities: { found: boolean; refs: string[] };
  negativeTests: { found: boolean; refs: string[] };
  imported: A2aPeerAuthReport["importedResults"];
}): A2aPeerAuthReport {
  const notes: string[] = [];
  const multiAgentPresent = opts.handoffPaths.found;
  const authAndScopePresent =
    opts.peerAuth.found && opts.scopedCapabilities.found;
  const negativeTestsPresent =
    opts.negativeTests.found || opts.imported.found;

  if (!multiAgentPresent) {
    notes.push(
      "No A2A / multi-agent handoff path signals found — AGN-M4 may be NOT_APPLICABLE.",
    );
  } else {
    notes.push(
      `Handoff path refs: ${opts.handoffPaths.refs.slice(0, 4).join(", ")}`,
    );
  }
  if (opts.peerAuth.found) {
    notes.push(`Peer auth signals: ${opts.peerAuth.refs.slice(0, 3).join(", ")}`);
  } else if (multiAgentPresent) {
    notes.push("Multi-agent paths found but no peer authentication signals.");
  }
  if (opts.scopedCapabilities.found) {
    notes.push(
      `Scoped capability signals: ${opts.scopedCapabilities.refs.slice(0, 3).join(", ")}`,
    );
  } else if (multiAgentPresent) {
    notes.push("No scoped capability / least-privilege handoff signals found.");
  }
  if (opts.negativeTests.found) {
    notes.push(
      `Negative test refs: ${opts.negativeTests.refs.slice(0, 3).join(", ")}`,
    );
  } else if (multiAgentPresent && !opts.imported.found) {
    notes.push(
      "No negative auth/scope deny tests found — import suite JSON to PASS.",
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (denyRate=${opts.imported.denyRatePct}, unauth=${opts.imported.unauthenticatedDenied}, forged=${opts.imported.forgedDenied}, overScoped=${opts.imported.overScopedDenied})`,
    );
  }

  let statusHint: A2aPeerAuthReport["summary"]["statusHint"];
  let agnM4Satisfied: boolean | null = null;

  const denyOk =
    opts.imported.denyRatePct !== null && opts.imported.denyRatePct >= 100;
  const threeDeny =
    opts.imported.unauthenticatedDenied === true &&
    opts.imported.forgedDenied === true &&
    opts.imported.overScopedDenied === true;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const measuredFail =
    (opts.imported.denyRatePct !== null && opts.imported.denyRatePct < 100) ||
    opts.imported.unauthenticatedDenied === false ||
    opts.imported.forgedDenied === false ||
    opts.imported.overScopedDenied === false;

  if (!multiAgentPresent && !opts.imported.found) {
    statusHint = "not_applicable";
    agnM4Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    agnM4Satisfied = false;
    notes.push("Imported negative tests did not deny all abuse cases at 100%.");
  } else if (
    multiAgentPresent &&
    authAndScopePresent &&
    negativeTestsPresent &&
    threeDeny &&
    (denyOk || opts.imported.denyRatePct === null) &&
    importFresh
  ) {
    statusHint = "pass";
    agnM4Satisfied = true;
  } else if (
    multiAgentPresent ||
    opts.peerAuth.found ||
    opts.scopedCapabilities.found ||
    negativeTestsPresent
  ) {
    statusHint = "partial";
    agnM4Satisfied = false;
    if (authAndScopePresent && !opts.imported.found) {
      notes.push(
        "Auth + scope config present but no measured 100% deny suite — drop JSON under imports/a2a-peer-auth/.",
      );
    }
    if (opts.imported.found && !threeDeny) {
      notes.push(
        "Import must show unauthenticated, forged-peer, and over-scoped cases denied.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AGN-M4 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    agnM4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    handoffPaths: opts.handoffPaths,
    peerAuth: opts.peerAuth,
    scopedCapabilities: opts.scopedCapabilities,
    negativeTests: opts.negativeTests,
    importedResults: opts.imported,
    summary: {
      multiAgentPresent,
      authAndScopePresent,
      negativeTestsPresent,
      agnM4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const a2aPeerAuthCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 4000;

    const handoffRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => A2A_PATH_RE.test(path) || A2A_PATH_RE.test(text),
    );
    const handoffPaths = {
      found: handoffRefs.length > 0,
      refs: handoffRefs,
    };

    const peerAuthRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (A2A_PATH_RE.test(path) || A2A_PATH_RE.test(text)) && AUTH_RE.test(text),
    );
    const peerAuth = {
      found: peerAuthRefs.length > 0,
      refs: peerAuthRefs,
    };

    const scopeRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (A2A_PATH_RE.test(path) || A2A_PATH_RE.test(text)) && SCOPE_RE.test(text),
    );
    const scopedCapabilities = {
      found: scopeRefs.length > 0,
      refs: scopeRefs,
    };

    const negRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (TEST_PATH_RE.test(path) || TEST_PATH_RE.test(text)) &&
        (A2A_PATH_RE.test(path) || A2A_PATH_RE.test(text)) &&
        NEGATIVE_TEST_RE.test(text),
    );
    const negativeTests = { found: negRefs.length > 0, refs: negRefs };

    // Also check CI workflows for a2a deny gates
    const wf = join(ctx.targetPath, ".github", "workflows");
    if (existsSync(wf)) {
      for (const f of walkFiles(wf, {
        maxFiles: 80,
        extensions: [".yml", ".yaml"],
      })) {
        const text = readText(f) || "";
        if (A2A_PATH_RE.test(text) && NEGATIVE_TEST_RE.test(text)) {
          negativeTests.refs.push(rel(ctx.targetPath, f));
          negativeTests.found = true;
        }
      }
      negativeTests.refs = [...new Set(negativeTests.refs)].slice(0, 16);
    }

    const imported = loadImported(ctx);
    const report = buildA2aPeerAuthReport({
      assessedAt: ctx.assessedAt.toISOString(),
      handoffPaths,
      peerAuth,
      scopedCapabilities,
      negativeTests,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "a2a-peer-auth-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "policy",
        ref: `imports/${PLUGIN_ID}/a2a-peer-auth-report.json`,
        excerpt: redact(
          JSON.stringify(
            { summary: report.summary, notes: report.notes.slice(0, 5) },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "a2a-peer-auth",
          "agn-m4",
          DETECTOR_ID,
          ...(report.summary.agnM4Satisfied
            ? ["agn-m4-satisfied"]
            : ["agn-m4-incomplete"]),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AGN-M4 status=${report.summary.statusHint} multiAgent=${report.summary.multiAgentPresent} authScope=${report.summary.authAndScopePresent} satisfied=${report.summary.agnM4Satisfied}; report=imports/${PLUGIN_ID}/a2a-peer-auth-report.json`,
      nodes,
    };
  },
};
