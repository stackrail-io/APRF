/**
 * cross-tenant-tests — AUTHZ-M2 detector executor.
 *
 * Looks for multi-tenant isolation in code and scores automated cross-tenant
 * attack tests on AI data/memory paths. Code isolation alone ≠ PASS —
 * passCondition requires ≥10 attack cases with 0 successful unauthorized access.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "cross-tenant-tests";
const RELATED = ["AUTHZ-M2"] as const;
const MIN_ATTACK_CASES = 10;
const IMPORT_MAX_AGE_DAYS = 90;

const ISOLATION_CODE_RE =
  /\b(access_grants|has_access|has_connection_access|has_access_to_file|user_id\s*==|filter.*user_id|tenant_id|org_id|workspace_id|cross[_-]?tenant|multi[_-]?tenant)/i;

const AI_DATA_PATH_HINTS = [
  "chats",
  "chat",
  "memories",
  "memory",
  "knowledge",
  "retrieval",
  "vector",
  "embeddings",
  "files",
  "notes",
  "folders",
  "documents",
  "rag",
  "context",
];

const CROSS_TENANT_TEST_RE =
  /\b(cross[_-]?tenant|tenant[_-]?isolat|other[_-]?user|another[_-]?user|user_a|user_b|attacker|unauthorized\s+(read|write|access)|isolation\s+test|data\s+leak)/i;

const DENIAL_OR_FAIL_RE =
  /\b(401|403|404|denied|forbidden|unauthorized|raises?\s*\(|assert.*(?:not|none|false|40[134]))/i;

const SUCCESS_LEAK_RE =
  /\b(assert.*(?:200|ok|success)|expect.*toHaveLength\([^0]|leaked|got\s+other)/i;

const TEST_FILE_RE =
  /(^|[/\\])(tests?|__tests__|spec)([/\\]|$)|[._-](test|spec)\.(py|ts|tsx|js|jsx|mjs|cjs)$/i;

const TEST_FN_RE =
  /(?:(?:async\s+)?def\s+(test_\w+)|(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`])/g;

export interface CrossTenantCase {
  id: string;
  source: string;
  aiDataPathHint: string | null;
  /** true if the case asserts denial / expects isolation to hold */
  expectsDenial: boolean;
  /** true if evidence suggests unauthorized access succeeded (suite failure) */
  unauthorizedSuccess: boolean;
  ok: boolean;
}

export interface CrossTenantReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  measuredAt: string | null;
  isolationCodeFound: boolean;
  isolationRefs: string[];
  aiDataPathRefs: string[];
  multiTenantAiDataOrMemoryPathsPresent: boolean | null;
  cases: CrossTenantCase[];
  summary: {
    attackCases: number;
    unauthorizedSuccesses: number;
    pass: number;
    fail: number;
    minRequired: number;
    /** true iff ≥10 cases, 0 unauthorized successes, measuredAt fresh */
    authzM2Satisfied: boolean | null;
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

function collectTestFiles(targetPath: string, maxFiles: number): string[] {
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  });
  return files.filter((f) => TEST_FILE_RE.test(f));
}

function scanIsolationCode(
  targetPath: string,
  maxFiles: number,
): { found: boolean; refs: string[]; aiDataRefs: string[] } {
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 6000),
    extensions: [".py", ".ts", ".js"],
  });
  const refs: string[] = [];
  const aiDataRefs: string[] = [];
  for (const f of files) {
    const text = readText(f, 200_000);
    if (!text) continue;
    const r = rel(targetPath, f);
    const lower = r.toLowerCase();
    if (ISOLATION_CODE_RE.test(text)) {
      refs.push(r);
    }
    if (
      AI_DATA_PATH_HINTS.some((h) => lower.includes(h)) &&
      ISOLATION_CODE_RE.test(text)
    ) {
      aiDataRefs.push(r);
    }
    if (refs.length >= 20 && aiDataRefs.length >= 12) break;
  }
  return {
    found: refs.length > 0,
    refs: refs.slice(0, 16),
    aiDataRefs: aiDataRefs.slice(0, 12),
  };
}

function hintForText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const h of AI_DATA_PATH_HINTS) {
    if (lower.includes(h)) return h;
  }
  return null;
}

function extractCasesFromTestFile(
  file: string,
  targetPath: string,
  text: string,
): CrossTenantCase[] {
  if (!CROSS_TENANT_TEST_RE.test(text) && !/\btenant\b/i.test(text)) {
    // Still accept files that clearly compare two users on AI data paths
    const twoUsers =
      /\b(user1|user2|user_a|user_b|alice|bob)\b/i.test(text) &&
      AI_DATA_PATH_HINTS.some((h) => text.toLowerCase().includes(h));
    if (!twoUsers) return [];
  }

  const cases: CrossTenantCase[] = [];
  const relPath = rel(targetPath, file);
  let m: RegExpExecArray | null;
  const re = new RegExp(TEST_FN_RE.source, "g");
  while ((m = re.exec(text))) {
    const name = (m[1] || m[2] || "").trim();
    if (!name) continue;
    // Slice a window after the match for local assertions
    const window = text.slice(m.index, m.index + 800);
    const relevant =
      CROSS_TENANT_TEST_RE.test(window) ||
      CROSS_TENANT_TEST_RE.test(name) ||
      (/\b(user1|user2|user_a|user_b|alice|bob|other)\b/i.test(window) &&
        hintForText(window) !== null);
    if (!relevant && !CROSS_TENANT_TEST_RE.test(text)) continue;

    const expectsDenial = DENIAL_OR_FAIL_RE.test(window) || DENIAL_OR_FAIL_RE.test(text);
    const unauthorizedSuccess =
      SUCCESS_LEAK_RE.test(window) && !expectsDenial;
    cases.push({
      id: name,
      source: relPath,
      aiDataPathHint: hintForText(name) || hintForText(window) || hintForText(text),
      expectsDenial,
      unauthorizedSuccess,
      ok: expectsDenial && !unauthorizedSuccess,
    });
  }

  // File-level fallback: one synthetic case if file matches but no fns parsed
  if (cases.length === 0 && (CROSS_TENANT_TEST_RE.test(text) || hintForText(text))) {
    const expectsDenial = DENIAL_OR_FAIL_RE.test(text);
    cases.push({
      id: `${relPath}::file`,
      source: relPath,
      aiDataPathHint: hintForText(text),
      expectsDenial,
      unauthorizedSuccess: false,
      ok: expectsDenial,
    });
  }
  return cases;
}

function loadImportedSuite(ctx: CollectorContext): {
  cases: CrossTenantCase[];
  sources: string[];
  measuredAt: string | null;
  multiTenantAiDataOrMemoryPathsPresent: boolean | null;
} {
  const cases: CrossTenantCase[] = [];
  const sources: string[] = [];
  let measuredAt: string | null = null;
  let multiTenantAiDataOrMemoryPathsPresent: boolean | null = null;
  for (const file of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (!/\.json$/i.test(file)) continue;
    if (/cross-tenant-report\.json$/i.test(file)) continue;
    const text = readText(file, 2_000_000);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      multiTenantAiDataOrMemoryPathsPresent = mergeOrBool(
        multiTenantAiDataOrMemoryPathsPresent,
        asBool(data.multiTenantAiDataOrMemoryPathsPresent) ??
          asBool(data.multi_tenant_ai_data_or_memory_paths_present) ??
          asBool(data.multiTenantAiDataPathsPresent),
      );
      const src = rel(ctx.outputDir, file);
      const before = cases.length;
      const caseList: Array<Record<string, unknown>> = Array.isArray(data.cases)
        ? (data.cases as Array<Record<string, unknown>>)
        : Array.isArray(data.attackCases)
          ? (data.attackCases as Array<Record<string, unknown>>)
          : [];

      for (let i = 0; i < caseList.length; i++) {
        const c = caseList[i];
        if (!c || typeof c !== "object") continue;
        const result = String(c.result || c.status || "").toLowerCase();
        const unauthorizedSuccess =
          c.unauthorizedSuccess === true ||
          result === "leak" ||
          result === "fail" ||
          result === "breach";
        const expectsDenial =
          c.expectsDenial !== false &&
          !unauthorizedSuccess &&
          (result === "pass" ||
            result === "denied" ||
            result === "ok" ||
            c.ok === true ||
            result === "");
        cases.push({
          id: String(c.id || c.name || `import-${i + 1}`),
          source: src,
          aiDataPathHint:
            (c.aiDataPathHint as string) || (c.path as string) || null,
          expectsDenial,
          unauthorizedSuccess,
          ok: expectsDenial && !unauthorizedSuccess,
        });
      }
      // Compact summary form: { attackCases: 12, unauthorizedSuccesses: 0 }
      if (
        caseList.length === 0 &&
        typeof data.attackCases === "number" &&
        data.attackCases > 0
      ) {
        const n = Math.min(Number(data.attackCases), 200);
        const leaks = Number(data.unauthorizedSuccesses || 0);
        for (let i = 0; i < n; i++) {
          const leak = i < leaks;
          cases.push({
            id: `summary-case-${i + 1}`,
            source: src,
            aiDataPathHint: null,
            expectsDenial: !leak,
            unauthorizedSuccess: leak,
            ok: !leak,
          });
        }
      }
      const hasPresentAttest =
        asBool(data.multiTenantAiDataOrMemoryPathsPresent) !== null ||
        asBool(data.multi_tenant_ai_data_or_memory_paths_present) !== null ||
        asBool(data.multiTenantAiDataPathsPresent) !== null;
      if (cases.length > before || hasPresentAttest || parseMeasuredAt(data)) {
        sources.push(src);
      }
    } catch {
      /* skip */
    }
  }
  return {
    cases,
    sources,
    measuredAt,
    multiTenantAiDataOrMemoryPathsPresent,
  };
}

export function buildCrossTenantReport(
  ctx: CollectorContext,
  opts: {
    isolation: { found: boolean; refs: string[]; aiDataRefs: string[] };
    repoCases: CrossTenantCase[];
    importedCases: CrossTenantCase[];
    importedSources: string[];
    importedMeasuredAt: string | null;
    multiTenantAiDataOrMemoryPathsPresent: boolean | null;
  },
): CrossTenantReport {
  const notes: string[] = [];
  const usedImport = opts.importedCases.length > 0;
  // Prefer explicit imported suite; else repo-discovered cases
  const cases = usedImport ? opts.importedCases : opts.repoCases;

  const unauthorizedSuccesses = cases.filter((c) => c.unauthorizedSuccess)
    .length;
  const pass = cases.filter((c) => c.ok).length;
  const fail = cases.length - pass;

  if (opts.isolation.found) {
    notes.push(
      `Tenant isolation patterns present in code (e.g. ${opts.isolation.refs.slice(0, 3).join(", ")}); code alone does not satisfy AUTHZ-M2.`,
    );
  } else {
    notes.push(
      "No clear tenant-isolation helpers found (access_grants / user_id filters / …).",
    );
  }

  if (cases.length === 0) {
    notes.push(
      `No cross-tenant attack tests found. AUTHZ-M2 requires ≥${MIN_ATTACK_CASES} automated attack cases on AI data/memory paths with 0 successful unauthorized reads/writes.`,
    );
  } else if (cases.length < MIN_ATTACK_CASES) {
    notes.push(
      `Only ${cases.length} attack case(s) found; need ≥${MIN_ATTACK_CASES}.`,
    );
  }
  if (unauthorizedSuccesses > 0) {
    notes.push(
      `${unauthorizedSuccesses} case(s) indicate successful unauthorized cross-tenant access.`,
    );
  }
  if (opts.importedSources.length) {
    notes.push(`Imported suite from: ${opts.importedSources.join(", ")}`);
  }

  // Repo-discovered cases are measured at assessment time; import suites need dated measuredAt.
  let measuredAt: string | null = usedImport
    ? opts.importedMeasuredAt
    : ctx.assessedAt.toISOString();
  if (usedImport && !opts.importedMeasuredAt) {
    notes.push(
      "Imported suite lacks measuredAt — required to unlock AUTHZ-M2 PASS.",
    );
  }

  const fresh = measuredAtFresh(
    measuredAt,
    ctx.assessedAt,
    IMPORT_MAX_AGE_DAYS,
  );

  const surfaceEvidence =
    opts.isolation.aiDataRefs.length > 0 ||
    cases.length > 0 ||
    cases.some((c) => c.aiDataPathHint);

  let presentAttest = opts.multiTenantAiDataOrMemoryPathsPresent;
  if (surfaceEvidence && presentAttest === false) {
    notes.push(
      "Imported multiTenantAiDataOrMemoryPathsPresent=false ignored — AI data/memory path or suite evidence proves the surface exists.",
    );
    presentAttest = true;
  }

  let statusHint: CrossTenantReport["summary"]["statusHint"] =
    "not_demonstrated";
  let authzM2Satisfied: boolean | null = null;

  if (cases.length === 0 && presentAttest === false) {
    statusHint = "not_applicable";
    authzM2Satisfied = null;
    notes.push(
      "Imported multiTenantAiDataOrMemoryPathsPresent=false — AUTHZ-M2 NOT_APPLICABLE.",
    );
  } else if (unauthorizedSuccesses > 0) {
    statusHint = "fail";
    authzM2Satisfied = false;
  } else if (
    cases.length >= MIN_ATTACK_CASES &&
    unauthorizedSuccesses === 0 &&
    fail === 0 &&
    fresh
  ) {
    statusHint = "pass";
    authzM2Satisfied = true;
  } else if (
    cases.length > 0 ||
    opts.isolation.found ||
    opts.isolation.aiDataRefs.length > 0 ||
    opts.importedSources.length > 0
  ) {
    statusHint = "partial";
    authzM2Satisfied = cases.length === 0 ? null : false;
    if (cases.length >= MIN_ATTACK_CASES && fail > 0) {
      notes.push(
        `${fail} attack case(s) lack denial assertions — AUTHZ-M2 requires expectsDenial on each case.`,
      );
    }
    if (cases.length >= MIN_ATTACK_CASES && fail === 0 && !fresh) {
      notes.push(
        "Suite measuredAt older than 90 days (or missing) — required to unlock AUTHZ-M2 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authzM2Satisfied = null;
    notes.push(
      "No multi-tenant AI data/memory paths demonstrated — AUTHZ-M2 remains not demonstrated until paths/suite evidence exists or an explicit N/A attest (multiTenantAiDataOrMemoryPathsPresent=false) is imported.",
    );
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: ctx.assessedAt.toISOString(),
    measuredAt,
    isolationCodeFound: opts.isolation.found,
    isolationRefs: opts.isolation.refs,
    aiDataPathRefs: opts.isolation.aiDataRefs,
    multiTenantAiDataOrMemoryPathsPresent: presentAttest,
    cases: cases.slice(0, 200),
    summary: {
      attackCases: cases.length,
      unauthorizedSuccesses,
      pass,
      fail,
      minRequired: MIN_ATTACK_CASES,
      authzM2Satisfied,
      statusHint,
    },
    notes,
  };
}

export const crossTenantTestsCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const isolation = scanIsolationCode(ctx.targetPath, ctx.maxFiles ?? 4000);
    const testFiles = collectTestFiles(ctx.targetPath, ctx.maxFiles ?? 4000);
    const repoCases: CrossTenantCase[] = [];
    for (const f of testFiles) {
      const text = readText(f, 400_000);
      if (!text) continue;
      repoCases.push(...extractCasesFromTestFile(f, ctx.targetPath, text));
    }
    const imported = loadImportedSuite(ctx);

    const report = buildCrossTenantReport(ctx, {
      isolation,
      repoCases,
      importedCases: imported.cases,
      importedSources: imported.sources,
      importedMeasuredAt: imported.measuredAt,
      multiTenantAiDataOrMemoryPathsPresent:
        imported.multiTenantAiDataOrMemoryPathsPresent,
    });

    ensureDir(importDir(ctx));
    const reportPath = join(importDir(ctx), "cross-tenant-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "code",
        ref: `imports/${PLUGIN_ID}/cross-tenant-report.json`,
        excerpt: redact(
          JSON.stringify(
            {
              summary: report.summary,
              notes: report.notes.slice(0, 4),
              sampleCases: report.cases.slice(0, 8).map((c) => ({
                id: c.id,
                ok: c.ok,
                hint: c.aiDataPathHint,
              })),
            },
            null,
            2,
          ).slice(0, 1200),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: [
          "cross-tenant-tests",
          "authz-m2",
          `authz-m2-${report.summary.statusHint}`,
          ...(report.summary.authzM2Satisfied
            ? ["authz-m2-satisfied"]
            : ["authz-m2-fail-or-incomplete"]),
          ...(report.isolationCodeFound ? ["tenant-isolation"] : []),
          ...(report.summary.attackCases < MIN_ATTACK_CASES
            ? ["cross-tenant-gap"]
            : []),
        ],
        relatedCheckIds: [...RELATED],
      },
    ];

    if (isolation.found) {
      nodes.push({
        id: `${PLUGIN_ID}:isolation-code`,
        class: "code",
        ref: isolation.refs[0] || "tenant-isolation",
        excerpt: redact(
          `Isolation refs: ${isolation.refs.slice(0, 8).join(", ")}`.slice(
            0,
            400,
          ),
        ),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        signals: ["tenant-isolation", "authz-m2"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHZ-M2 status=${report.summary.statusHint} attackCases=${report.summary.attackCases} unauthorizedSuccesses=${report.summary.unauthorizedSuccesses} satisfied=${report.summary.authzM2Satisfied}; report=imports/${PLUGIN_ID}/cross-tenant-report.json`,
      nodes,
    };
  },
};
