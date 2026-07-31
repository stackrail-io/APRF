/**
 * platform-scaffolding-templates — DX-R1 / repo-scaffolding-templates executor.
 *
 * Discovers agent / RAG / MCP scaffolds with auth, secrets, logging defaults.
 * Import adoption (use in 90d or target) under imports/platform-scaffolding-templates/
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

const PLUGIN_ID = "platform-scaffolding-templates";
const RELATED = ["DX-R1"] as const;
const DETECTOR_ID = "repo-scaffolding-templates";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|genai|rag|mcp|promptfoo)/i;

const TEMPLATE_PATH_RE =
  /(template|scaffold|cookiecutter|copier|backstage|create[-_]?app|generator|boilerplate|starter)/i;

const AGENT_RE =
  /\b(agent[\s_-]*(template|scaffold|starter)|langgraph|crewai|autogen|orchestrat)\b/i;

const RAG_RE =
  /\b(rag[\s_-]*(template|scaffold|starter)|retrieval[\s_-]*augment|vector[\s_-]*store|embeddings?[\s_-]*pipeline)\b/i;

const MCP_RE =
  /\b(mcp[\s_-]*(template|scaffold|starter|server)|model[\s_-]*context[\s_-]*protocol|tool[_-]?server[\s_-]*template)\b/i;

const AUTH_RE = /\b(authn|auths?|authentication|oidc|sso|identity)\b/i;
const SECRETS_RE =
  /\b(secrets?(?:[\s_-]?manager)?|vault|credential|env[\s_-]?from)\b/i;
const LOGGING_RE =
  /\b(logging|otel|opentelemetry|structured[\s_-]?log|observability)\b/i;

export interface PlatformScaffoldingTemplatesReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  templates: {
    agent: { found: boolean; refs: string[] };
    rag: { found: boolean; refs: string[] };
    mcp: { found: boolean; refs: string[] };
  };
  defaults: {
    auth: { found: boolean; refs: string[] };
    secrets: { found: boolean; refs: string[] };
    logging: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    agentTemplatePresent: boolean | null;
    ragTemplatePresent: boolean | null;
    mcpTemplatePresent: boolean | null;
    authDefaultOn: boolean | null;
    secretsDefaultOn: boolean | null;
    loggingDefaultOn: boolean | null;
    usedInLast90Days: boolean | null;
    adoptionTargetDocumented: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    allThreeTemplatesPresent: boolean;
    safeDefaultsPresent: boolean;
    dxR1Satisfied: boolean | null;
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
      ".txt",
      ".ts",
      ".js",
      ".py",
      ".jinja",
      ".j2",
    ],
  });
  for (const f of files) {
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
        TEMPLATE_PATH_RE.test(path) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|mcp|rag|agent)\b/i.test(
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
): PlatformScaffoldingTemplatesReport["importedResults"] {
  const sources: string[] = [];
  let agentTemplatePresent: boolean | null = null;
  let ragTemplatePresent: boolean | null = null;
  let mcpTemplatePresent: boolean | null = null;
  let authDefaultOn: boolean | null = null;
  let secretsDefaultOn: boolean | null = null;
  let loggingDefaultOn: boolean | null = null;
  let usedInLast90Days: boolean | null = null;
  let adoptionTargetDocumented: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/platform-scaffolding-templates-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      agentTemplatePresent =
        asBool(data.agentTemplatePresent) ??
        asBool(data.hasAgentTemplate) ??
        agentTemplatePresent;
      ragTemplatePresent =
        asBool(data.ragTemplatePresent) ??
        asBool(data.hasRagTemplate) ??
        ragTemplatePresent;
      mcpTemplatePresent =
        asBool(data.mcpTemplatePresent) ??
        asBool(data.hasMcpTemplate) ??
        mcpTemplatePresent;
      authDefaultOn =
        asBool(data.authDefaultOn) ??
        asBool(data.hasAuthDefault) ??
        authDefaultOn;
      secretsDefaultOn =
        asBool(data.secretsDefaultOn) ??
        asBool(data.hasSecretsDefault) ??
        secretsDefaultOn;
      loggingDefaultOn =
        asBool(data.loggingDefaultOn) ??
        asBool(data.hasLoggingDefault) ??
        loggingDefaultOn;
      usedInLast90Days =
        asBool(data.usedInLast90Days) ??
        asBool(data.adoptionInLast90Days) ??
        usedInLast90Days;
      adoptionTargetDocumented =
        asBool(data.adoptionTargetDocumented) ??
        asBool(data.hasAdoptionTarget) ??
        adoptionTargetDocumented;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      const templates = Array.isArray(data.templates)
        ? (data.templates as Array<Record<string, unknown>>)
        : [];
      for (const t of templates) {
        const kind = String(t.kind || t.type || "").toLowerCase();
        const present = t.present === true || t.exists === true;
        if (kind.includes("agent") && present) agentTemplatePresent = true;
        if (kind.includes("rag") && present) ragTemplatePresent = true;
        if (kind.includes("mcp") && present) mcpTemplatePresent = true;
        if (t.authDefaultOn === true) authDefaultOn = true;
        if (t.secretsDefaultOn === true) secretsDefaultOn = true;
        if (t.loggingDefaultOn === true) loggingDefaultOn = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    agentTemplatePresent,
    ragTemplatePresent,
    mcpTemplatePresent,
    authDefaultOn,
    secretsDefaultOn,
    loggingDefaultOn,
    usedInLast90Days,
    adoptionTargetDocumented,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPlatformScaffoldingTemplatesReport(opts: {
  assessedAt: string;
  templates: PlatformScaffoldingTemplatesReport["templates"];
  defaults: PlatformScaffoldingTemplatesReport["defaults"];
  aiSignals: boolean;
  imported: PlatformScaffoldingTemplatesReport["importedResults"];
}): PlatformScaffoldingTemplatesReport {
  const notes: string[] = [];
  const allThreeFromRepo =
    opts.templates.agent.found &&
    opts.templates.rag.found &&
    opts.templates.mcp.found;
  const allThreeFromImport =
    opts.imported.agentTemplatePresent === true &&
    opts.imported.ragTemplatePresent === true &&
    opts.imported.mcpTemplatePresent === true;
  const allThreeTemplatesPresent = allThreeFromRepo || allThreeFromImport;

  const defaultsFromRepo =
    opts.defaults.auth.found &&
    opts.defaults.secrets.found &&
    opts.defaults.logging.found;
  const defaultsFromImport =
    opts.imported.authDefaultOn === true &&
    opts.imported.secretsDefaultOn === true &&
    opts.imported.loggingDefaultOn === true;
  const safeDefaultsPresent = defaultsFromRepo || defaultsFromImport;

  if (!opts.aiSignals && !allThreeTemplatesPresent && !opts.imported.found) {
    notes.push(
      "No AI scaffolding signals — DX-R1 may be NOT_APPLICABLE if the org does not build agent/RAG/MCP services.",
    );
  }
  for (const [label, t] of [
    ["Agent", opts.templates.agent],
    ["RAG", opts.templates.rag],
    ["MCP", opts.templates.mcp],
  ] as const) {
    if (t.found) {
      notes.push(`${label} template refs: ${t.refs.slice(0, 3).join(", ")}`);
    } else {
      notes.push(`No ${label} scaffolding template signals found.`);
    }
  }
  for (const [label, d] of [
    ["Auth", opts.defaults.auth],
    ["Secrets", opts.defaults.secrets],
    ["Logging", opts.defaults.logging],
  ] as const) {
    if (d.found) {
      notes.push(`${label} default refs: ${d.refs.slice(0, 2).join(", ")}`);
    }
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (agent=${opts.imported.agentTemplatePresent}, rag=${opts.imported.ragTemplatePresent}, mcp=${opts.imported.mcpTemplatePresent}, auth=${opts.imported.authDefaultOn}, secrets=${opts.imported.secretsDefaultOn}, logging=${opts.imported.loggingDefaultOn}, used90d=${opts.imported.usedInLast90Days}, target=${opts.imported.adoptionTargetDocumented}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (allThreeTemplatesPresent || safeDefaultsPresent) {
    notes.push(
      "Template signals alone are PARTIAL — import all three templates + safe defaults + (usedInLast90Days|adoptionTargetDocumented) ≤90d under imports/platform-scaffolding-templates/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const adoptionOk =
    opts.imported.usedInLast90Days === true ||
    opts.imported.adoptionTargetDocumented === true;
  const passOk =
    opts.imported.agentTemplatePresent === true &&
    opts.imported.ragTemplatePresent === true &&
    opts.imported.mcpTemplatePresent === true &&
    opts.imported.authDefaultOn === true &&
    opts.imported.secretsDefaultOn === true &&
    opts.imported.loggingDefaultOn === true &&
    adoptionOk &&
    ageOk &&
    importFresh;

  let statusHint: PlatformScaffoldingTemplatesReport["summary"]["statusHint"] =
    "not_demonstrated";
  let dxR1Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.agentTemplatePresent === false ||
      opts.imported.ragTemplatePresent === false ||
      opts.imported.mcpTemplatePresent === false ||
      opts.imported.authDefaultOn === false ||
      opts.imported.secretsDefaultOn === false ||
      opts.imported.loggingDefaultOn === false ||
      (opts.imported.usedInLast90Days === false &&
        opts.imported.adoptionTargetDocumented === false) ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.templates.agent.found &&
    !opts.templates.rag.found &&
    !opts.templates.mcp.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dxR1Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dxR1Satisfied = false;
    notes.push(
      "Imported results show missing templates/defaults/adoption or evidence older than 90 days — DX-R1 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dxR1Satisfied = true;
  } else if (
    opts.templates.agent.found ||
    opts.templates.rag.found ||
    opts.templates.mcp.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dxR1Satisfied = false;
    if (opts.imported.found) {
      if (
        opts.imported.agentTemplatePresent !== true ||
        opts.imported.ragTemplatePresent !== true ||
        opts.imported.mcpTemplatePresent !== true
      ) {
        notes.push(
          "Import must show agentTemplatePresent, ragTemplatePresent, and mcpTemplatePresent=true.",
        );
      }
      if (
        opts.imported.authDefaultOn !== true ||
        opts.imported.secretsDefaultOn !== true ||
        opts.imported.loggingDefaultOn !== true
      ) {
        notes.push(
          "Import must show authDefaultOn, secretsDefaultOn, and loggingDefaultOn=true.",
        );
      }
      if (!adoptionOk) {
        notes.push(
          "Import must show usedInLast90Days=true or adoptionTargetDocumented=true.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DX-R1 PASS.",
        );
      }
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    dxR1Satisfied = null;
    notes.push(
      "AI signals present but no agent/RAG/MCP scaffolding templates found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dxR1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    templates: opts.templates,
    defaults: opts.defaults,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      allThreeTemplatesPresent,
      safeDefaultsPresent,
      dxR1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const platformScaffoldingTemplatesCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const inTemplateContext = (path: string, text: string) =>
      TEMPLATE_PATH_RE.test(path) ||
      TEMPLATE_PATH_RE.test(text) ||
      AI_PATH_RE.test(path);

    const agentRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AGENT_RE.test(path) || AGENT_RE.test(text)) &&
        inTemplateContext(path, text),
    );
    const ragRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (RAG_RE.test(path) || RAG_RE.test(text)) &&
        inTemplateContext(path, text),
    );
    const mcpRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (MCP_RE.test(path) || MCP_RE.test(text)) &&
        inTemplateContext(path, text),
    );

    const defaultContext = (path: string, text: string) =>
      inTemplateContext(path, text) ||
      agentRefs.some((r) => path === r) ||
      ragRefs.some((r) => path === r) ||
      mcpRefs.some((r) => path === r);

    const authRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (AUTH_RE.test(path) || AUTH_RE.test(text)) &&
        defaultContext(path, text),
      12,
    );
    const secretsRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SECRETS_RE.test(path) || SECRETS_RE.test(text)) &&
        defaultContext(path, text),
      12,
    );
    const loggingRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (LOGGING_RE.test(path) || LOGGING_RE.test(text)) &&
        defaultContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPlatformScaffoldingTemplatesReport({
      assessedAt: ctx.assessedAt.toISOString(),
      templates: {
        agent: { found: agentRefs.length > 0, refs: agentRefs },
        rag: { found: ragRefs.length > 0, refs: ragRefs },
        mcp: { found: mcpRefs.length > 0, refs: mcpRefs },
      },
      defaults: {
        auth: { found: authRefs.length > 0, refs: authRefs },
        secrets: { found: secretsRefs.length > 0, refs: secretsRefs },
        logging: { found: loggingRefs.length > 0, refs: loggingRefs },
      },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "platform-scaffolding-templates-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/platform-scaffolding-templates-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "platform-scaffolding-templates",
          "dx-r1",
          DETECTOR_ID,
          ...(report.summary.allThreeTemplatesPresent
            ? ["agent-rag-mcp-templates"]
            : []),
          ...(report.summary.dxR1Satisfied ? ["dx-r1-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...agentRefs.slice(0, 2),
      ...ragRefs.slice(0, 2),
      ...mcpRefs.slice(0, 2),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["platform-scaffolding-templates-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DX-R1 status=${report.summary.statusHint} templates=${report.summary.allThreeTemplatesPresent} satisfied=${report.summary.dxR1Satisfied}; report=imports/${PLUGIN_ID}/platform-scaffolding-templates-report.json`,
      nodes,
    };
  },
};
