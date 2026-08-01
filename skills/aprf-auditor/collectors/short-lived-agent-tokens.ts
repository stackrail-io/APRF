/**
 * short-lived-agent-tokens — AUTHN-R1 / repo-short-lived-agent-tokens.
 *
 * Discovers TTL/token-policy and prompt/config secret-scan signals. Import
 * agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct=100 +
 * longLivedStaticApiKeysInPromptsOrConfig=0 under
 * imports/short-lived-agent-tokens/ to unlock PASS (measuredAt ≤90d).
 * Set agentToolCredentialsInProductionPromptsOrConfigPresent=false for N/A.
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
  mergeMaxNum,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "short-lived-agent-tokens";
const RELATED = ["AUTHN-R1"] as const;
const DETECTOR_ID = "repo-short-lived-agent-tokens";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const TTL_RE =
  /\b(token[_-]?ttl|short[_-]?lived[_-]?(token|credential)|expires[_-]?in|max[_-]?age|jwt[_-]?expir|credential[_-]?ttl|access[_-]?token[_-]?lifetime)\b/i;

const AGENT_CRED_RE =
  /\b(agent[_-]?(token|credential|api[_-]?key)|tool[_-]?(token|credential|api[_-]?key)|mcp[_-]?(token|credential)|service[_-]?account[_-]?(token|key))\b/i;

const PROMPT_SECRET_RE =
  /\b(prompt.{0,40}(api[_-]?key|secret|sk-[a-z0-9])|(api[_-]?key|secret).{0,40}prompt|static[_-]?(api[_-]?key|bearer)|long[_-]?lived[_-]?(key|token|secret))\b/i;

const SCAN_RE =
  /\b(secret[_-]?scan|gitleaks|trufflehog|detect[_-]?secrets|prompt[_-]?secret|credential[_-]?scan)\b/i;

export interface ShortLivedAgentTokensReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    ttlPolicy: { found: boolean; refs: string[] };
    agentCreds: { found: boolean; refs: string[] };
    promptSecrets: { found: boolean; refs: string[] };
    secretScan: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    agentToolCredentialsInProductionPromptsOrConfigPresent: boolean | null;
    agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: number | null;
    longLivedStaticApiKeysInPromptsOrConfig: number | null;
    ownedExceptionsWithin30Days: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    authnR1Satisfied: boolean | null;
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
      ".prompt",
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
): ShortLivedAgentTokensReport["importedResults"] {
  const sources: string[] = [];
  let agentToolCredentialsInProductionPromptsOrConfigPresent: boolean | null =
    null;
  let agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct: number | null =
    null;
  let longLivedStaticApiKeysInPromptsOrConfig: number | null = null;
  let ownedExceptionsWithin30Days: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/short-lived-agent-tokens-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      ageDays = mergeMaxNum(
        ageDays,
        asNum(data.ageDays) ?? asNum(data.age_days),
      );
      agentToolCredentialsInProductionPromptsOrConfigPresent = mergeOrBool(
        agentToolCredentialsInProductionPromptsOrConfigPresent,
        asBool(data.agentToolCredentialsInProductionPromptsOrConfigPresent) ??
          asBool(
            data.agent_tool_credentials_in_production_prompts_or_config_present,
          ) ??
          asBool(data.hasAgentToolCredentialsInPromptsOrConfig),
      );
      agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct = mergeMinNum(
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct,
        asNum(data.agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct) ??
          asNum(
            data.agent_tool_credentials_with_ttl_at_most_1h_or_owned_exception_pct,
          ) ??
          asNum(data.shortLivedCredentialPct) ??
          asNum(data.ttlCoveragePct),
      );
      longLivedStaticApiKeysInPromptsOrConfig = mergeMaxNum(
        longLivedStaticApiKeysInPromptsOrConfig,
        asNum(data.longLivedStaticApiKeysInPromptsOrConfig) ??
          asNum(data.long_lived_static_api_keys_in_prompts_or_config) ??
          asNum(data.staticKeysInPrompts) ??
          asNum(data.longLivedKeyFindings),
      );
      ownedExceptionsWithin30Days = mergeAndBool(
        ownedExceptionsWithin30Days,
        asBool(data.ownedExceptionsWithin30Days) ??
          asBool(data.owned_exceptions_within_30_days) ??
          asBool(data.exceptionsOwnedExpiry30d),
      );

      const creds =
        (data.credentials as Array<Record<string, unknown>>) ||
        (data.inventory as Array<Record<string, unknown>>) ||
        [];
      if (creds.length) {
        const ok = creds.filter((c) => {
          const ttlMin =
            asNum(c.ttlMinutes) ??
            asNum(c.ttl_minutes) ??
            (asNum(c.ttlSeconds) !== null
              ? (asNum(c.ttlSeconds) as number) / 60
              : null) ??
            (asNum(c.ttlHours) !== null
              ? (asNum(c.ttlHours) as number) * 60
              : null);
          const excDays =
            asNum(c.exceptionExpiryDays) ?? asNum(c.exception_expiry_days);
          const hasOwner = Boolean(c.owner || c.exceptionOwner);
          const ttlOk = ttlMin !== null && ttlMin <= 60;
          const excOk =
            hasOwner && excDays !== null && excDays <= 30;
          return ttlOk || excOk;
        }).length;
        const pct = (ok / creds.length) * 100;
        agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct = mergeMinNum(
          agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct,
          pct,
        );
        // Credential inventory proves the production surface exists — cannot
        // be wiped by a sibling present=false N/A attest.
        agentToolCredentialsInProductionPromptsOrConfigPresent = mergeOrBool(
          agentToolCredentialsInProductionPromptsOrConfigPresent,
          true,
        );
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    agentToolCredentialsInProductionPromptsOrConfigPresent,
    agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct,
    longLivedStaticApiKeysInPromptsOrConfig,
    ownedExceptionsWithin30Days,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildShortLivedAgentTokensReport(opts: {
  assessedAt: string;
  ttlPolicy: { found: boolean; refs: string[] };
  agentCreds: { found: boolean; refs: string[] };
  promptSecrets: { found: boolean; refs: string[] };
  secretScan: { found: boolean; refs: string[] };
  imported: ShortLivedAgentTokensReport["importedResults"];
}): ShortLivedAgentTokensReport {
  const notes: string[] = [];
  const gateSignalsPresent =
    opts.ttlPolicy.found ||
    opts.agentCreds.found ||
    opts.promptSecrets.found ||
    opts.secretScan.found;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No short-lived agent/tool token signals — AUTHN-R1 remains not demonstrated until inventory/scan evidence or an explicit N/A attest (agentToolCredentialsInProductionPromptsOrConfigPresent=false) is imported.",
    );
  }
  if (opts.ttlPolicy.found) {
    notes.push(`TTL/policy refs: ${opts.ttlPolicy.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.agentCreds.found) {
    notes.push(
      `Agent/tool credential refs: ${opts.agentCreds.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.secretScan.found) {
    notes.push(
      `Secret-scan refs: ${opts.secretScan.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.promptSecrets.found) {
    notes.push(
      `Prompt/static-key signal refs: ${opts.promptSecrets.refs.slice(0, 3).join(", ")} (supporting only — need import scan count)`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (scopePresent=${opts.imported.agentToolCredentialsInProductionPromptsOrConfigPresent}, ttlPct=${opts.imported.agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct}, staticKeys=${opts.imported.longLivedStaticApiKeysInPromptsOrConfig}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct=100 + longLivedStaticApiKeysInPromptsOrConfig=0 (measuredAt ≤90d) under imports/short-lived-agent-tokens/ to PASS. Set agentToolCredentialsInProductionPromptsOrConfigPresent=false for NOT_APPLICABLE.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null ||
    opts.imported.ageDays <= IMPORT_MAX_AGE_DAYS;
  const ttlOk =
    opts.imported.agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct ===
    100;
  const scanOk = opts.imported.longLivedStaticApiKeysInPromptsOrConfig === 0;
  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
  );
  const scopeAbsent =
    opts.imported.agentToolCredentialsInProductionPromptsOrConfigPresent ===
      false && !gateSignalsPresent;
  const scopePresent =
    opts.imported.agentToolCredentialsInProductionPromptsOrConfigPresent ===
    true;
  // Metrics alone with present=null cannot unlock PASS — need in-repo signals
  // or an explicit present=true attest.
  const surfaceOk = gateSignalsPresent || scopePresent;

  let statusHint: ShortLivedAgentTokensReport["summary"]["statusHint"];
  let authnR1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    !scopeAbsent &&
    ((opts.imported.agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct !==
      null &&
      opts.imported.agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct <
        100) ||
      (opts.imported.longLivedStaticApiKeysInPromptsOrConfig !== null &&
        opts.imported.longLivedStaticApiKeysInPromptsOrConfig > 0) ||
      opts.imported.ownedExceptionsWithin30Days === false ||
      (opts.imported.ageDays !== null &&
        opts.imported.ageDays > IMPORT_MAX_AGE_DAYS));

  if (
    opts.imported.found &&
    opts.imported.agentToolCredentialsInProductionPromptsOrConfigPresent ===
      false &&
    gateSignalsPresent
  ) {
    notes.push(
      "Imported agentToolCredentialsInProductionPromptsOrConfigPresent=false ignored — in-repo TTL/scan/credential signals prove the surface exists.",
    );
  }

  if (opts.imported.found && scopeAbsent) {
    statusHint = "not_applicable";
    authnR1Satisfied = null;
    notes.push(
      "Imported agentToolCredentialsInProductionPromptsOrConfigPresent=false — AUTHN-R1 NOT_APPLICABLE.",
    );
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    authnR1Satisfied = null;
  } else if (explicitFail) {
    statusHint = "fail";
    authnR1Satisfied = false;
    notes.push(
      opts.imported.ownedExceptionsWithin30Days === false
        ? "Imported ownedExceptionsWithin30Days=false — named TTL exceptions must have owner and expiry ≤30 days (AUTHN-R1 fail)."
        : "Imported evidence shows TTL coverage <100%, long-lived static keys in prompts/config, or attest older than 90 days — AUTHN-R1 fail.",
    );
  } else if (
    surfaceOk &&
    ttlOk &&
    scanOk &&
    ageOk &&
    importFresh &&
    opts.imported.ownedExceptionsWithin30Days !== false &&
    opts.imported.found
  ) {
    statusHint = "pass";
    authnR1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    authnR1Satisfied = false;
    if (opts.imported.found && !surfaceOk) {
      notes.push(
        "Import must set agentToolCredentialsInProductionPromptsOrConfigPresent=true (or discover in-repo TTL/scan signals) — coverage metrics alone without an attested surface cannot unlock PASS.",
      );
    }
    if (opts.imported.found && !ttlOk) {
      notes.push(
        "Import must show agentToolCredentialsWithTtlAtMost1hOrOwnedExceptionPct=100.",
      );
    }
    if (opts.imported.found && !scanOk) {
      notes.push(
        "Import must show longLivedStaticApiKeysInPromptsOrConfig=0.",
      );
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock AUTHN-R1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    authnR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      ttlPolicy: opts.ttlPolicy,
      agentCreds: opts.agentCreds,
      promptSecrets: opts.promptSecrets,
      secretScan: opts.secretScan,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      authnR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const shortLivedAgentTokensCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const ttlRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => TTL_RE.test(path) || TTL_RE.test(text),
      10,
    );
    const credRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => AGENT_CRED_RE.test(path) || AGENT_CRED_RE.test(text),
      10,
    );
    const promptSecretRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => PROMPT_SECRET_RE.test(path) || PROMPT_SECRET_RE.test(text),
      10,
    );
    const scanRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) => SCAN_RE.test(path) || SCAN_RE.test(text),
      8,
    );

    const imported = loadImported(ctx);
    const report = buildShortLivedAgentTokensReport({
      assessedAt: ctx.assessedAt.toISOString(),
      ttlPolicy: { found: ttlRefs.length > 0, refs: ttlRefs },
      agentCreds: { found: credRefs.length > 0, refs: credRefs },
      promptSecrets: {
        found: promptSecretRefs.length > 0,
        refs: promptSecretRefs,
      },
      secretScan: { found: scanRefs.length > 0, refs: scanRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "short-lived-agent-tokens-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "runtime",
        ref: `imports/${PLUGIN_ID}/short-lived-agent-tokens-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "short-lived-agent-tokens",
          "authn-r1",
          DETECTOR_ID,
          ...(report.summary.authnR1Satisfied ? ["authn-r1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];
    for (const r of [
      ...new Set([
        ...report.signals.ttlPolicy.refs,
        ...report.signals.agentCreds.refs,
        ...report.signals.promptSecrets.refs,
        ...report.signals.secretScan.refs,
      ]),
    ].slice(0, 8)) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        signals: ["short-lived-agent-tokens-ref"],
        relatedCheckIds: [...RELATED],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `AUTHN-R1 status=${report.summary.statusHint} signals=${report.summary.gateSignalsPresent} satisfied=${report.summary.authnR1Satisfied}; report=imports/${PLUGIN_ID}/short-lived-agent-tokens-report.json`,
      nodes,
    };
  },
};
