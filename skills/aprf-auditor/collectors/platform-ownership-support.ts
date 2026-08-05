/**
 * platform-ownership-support — DX-R4 / repo-platform-ownership detector executor.
 *
 * Discovers AI platform / paved-road ownership and support-channel signals.
 * Import owner + channel + (pingWithinSla | onCallListed) under
 * imports/platform-ownership-support/ to unlock PASS.
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
  isSkippedScanRelPath,
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

const PLUGIN_ID = "platform-ownership-support";
const RELATED = ["DX-R4"] as const;
const DETECTOR_ID = "repo-platform-ownership";

const AI_PATH_RE =
  /(openai|anthropic|bedrock|vertex|azure.?openai|llm|model|agent|genai|ai[_-]?feature|mlops|promptfoo)/i;

const PLATFORM_CONTEXT_RE =
  /(golden[\s_-]*path|paved[\s_-]*road|ai[\s_-]*platform|platform[\s_-]*(team|eng|engineering)|devtools|internal[\s_-]*developer)/i;

const OWNER_RE =
  /\b(CODEOWNERS|OWNERS|owner[\s_-]*team|platform[\s_-]*owner|owned[\s_-]*by|accountable[\s_-]*team|support[\s_-]*owner)\b/i;

const SUPPORT_CHANNEL_RE =
  /\b(support[\s_-]*(channel|alias|queue)|slack|pagerduty|opsgenie|ticket[\s_-]*queue|helpdesk|on[\s_-]*call|oncall|#ai[-_]?platform|#platform[-_]?support)\b/i;

const ONCALL_RE =
  /\b(on[\s_-]*call|oncall|pagerduty|opsgenie|rotation|duty[\s_-]*roster)\b/i;

const SLA_RE =
  /\b(sla|response[\s_-]*time|time[\s_-]*to[\s_-]*(ack|respond)|ack[\s_-]*within)\b/i;

export interface PlatformOwnershipSupportReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  ownership: { found: boolean; refs: string[] };
  supportChannel: { found: boolean; refs: string[] };
  onCallSignals: { found: boolean; refs: string[] };
  slaSignals: { found: boolean; refs: string[] };
  importedResults: {
    found: boolean;
    ownerTeamPresent: boolean | null;
    supportChannelPresent: boolean | null;
    pingWithinSla: boolean | null;
    onCallListed: boolean | null;
    ageDays: number | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    aiSignalsPresent: boolean;
    ownerAndChannelPresent: boolean;
    supportReachable: boolean;
    dxR4Satisfied: boolean | null;
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
    ],
  });
  const named = walkFiles(targetPath, {
    maxFiles: Math.min(maxFiles, 2000),
  }).filter((f) => {
    const r = rel(targetPath, f);
    return /CODEOWNERS|OWNERS|\.md$/i.test(basename(f)) || /CODEOWNERS|OWNERS/i.test(r);
  });

  const all = [...new Set([...files, ...named])];
  for (const f of all) {
    const r = rel(targetPath, f);
    if (isSkippedScanRelPath(r)) continue;
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
        PLATFORM_CONTEXT_RE.test(path) ||
        PLATFORM_CONTEXT_RE.test(text) ||
        /\b(ChatCompletion|openai|anthropic|bedrock|litellm|promptfoo)\b/i.test(
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
): PlatformOwnershipSupportReport["importedResults"] {
  const sources: string[] = [];
  let ownerTeamPresent: boolean | null = null;
  let supportChannelPresent: boolean | null = null;
  let pingWithinSla: boolean | null = null;
  let onCallListed: boolean | null = null;
  let ageDays: number | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/platform-ownership-support-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = parseMeasuredAt(data) ?? measuredAt;
      ownerTeamPresent =
        asBool(data.ownerTeamPresent) ??
        asBool(data.hasOwnerTeam) ??
        asBool(data.ownerDocumented) ??
        ownerTeamPresent;
      supportChannelPresent =
        asBool(data.supportChannelPresent) ??
        asBool(data.hasSupportChannel) ??
        asBool(data.channelDocumented) ??
        supportChannelPresent;
      pingWithinSla =
        asBool(data.pingWithinSla) ??
        asBool(data.testPingWithinSla) ??
        asBool(data.slaMet) ??
        pingWithinSla;
      onCallListed =
        asBool(data.onCallListed) ??
        asBool(data.oncallListed) ??
        asBool(data.hasOnCallRotation) ??
        onCallListed;
      ageDays = asNum(data.ageDays) ?? asNum(data.age_days) ?? ageDays;

      if (typeof data.ownerTeam === "string" && data.ownerTeam.trim()) {
        ownerTeamPresent = true;
      }
      if (
        typeof data.supportChannel === "string" &&
        data.supportChannel.trim()
      ) {
        supportChannelPresent = true;
      }
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    ownerTeamPresent,
    supportChannelPresent,
    pingWithinSla,
    onCallListed,
    ageDays,
    measuredAt,
    sources,
  };
}

export function buildPlatformOwnershipSupportReport(opts: {
  assessedAt: string;
  ownership: PlatformOwnershipSupportReport["ownership"];
  supportChannel: PlatformOwnershipSupportReport["supportChannel"];
  onCallSignals: PlatformOwnershipSupportReport["onCallSignals"];
  slaSignals: PlatformOwnershipSupportReport["slaSignals"];
  aiSignals: boolean;
  imported: PlatformOwnershipSupportReport["importedResults"];
}): PlatformOwnershipSupportReport {
  const notes: string[] = [];
  const ownerAndChannelPresent =
    (opts.ownership.found || opts.imported.ownerTeamPresent === true) &&
    (opts.supportChannel.found ||
      opts.imported.supportChannelPresent === true);

  if (
    !opts.aiSignals &&
    !ownerAndChannelPresent &&
    !opts.imported.found
  ) {
    notes.push(
      "No AI-platform ownership/support signals — DX-R4 may be NOT_APPLICABLE if there is no AI paved road.",
    );
  }
  if (opts.ownership.found) {
    notes.push(
      `Ownership refs: ${opts.ownership.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No AI-platform ownership signals found in repo.");
  }
  if (opts.supportChannel.found) {
    notes.push(
      `Support-channel refs: ${opts.supportChannel.refs.slice(0, 3).join(", ")}`,
    );
  } else {
    notes.push("No support-channel signals found.");
  }
  if (opts.onCallSignals.found) {
    notes.push(
      `On-call signals: ${opts.onCallSignals.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.slaSignals.found) {
    notes.push(`SLA signals: ${opts.slaSignals.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (owner=${opts.imported.ownerTeamPresent}, channel=${opts.imported.supportChannelPresent}, pingSla=${opts.imported.pingWithinSla}, onCall=${opts.imported.onCallListed}, ageDays=${opts.imported.ageDays})`,
    );
  } else if (ownerAndChannelPresent) {
    notes.push(
      "Owner/channel docs alone are PARTIAL — import pingWithinSla or onCallListed (≤90d) under imports/platform-ownership-support/ to PASS.",
    );
  }

  const ageOk =
    opts.imported.ageDays === null || opts.imported.ageDays <= 90;
  const importFresh = measuredAtFresh(opts.imported.measuredAt);
  const passOk =
    opts.imported.ownerTeamPresent === true &&
    opts.imported.supportChannelPresent === true &&
    (opts.imported.pingWithinSla === true ||
      opts.imported.onCallListed === true) &&
    ageOk &&
    importFresh;

  let statusHint: PlatformOwnershipSupportReport["summary"]["statusHint"];
  let dxR4Satisfied: boolean | null = null;

  const measuredFail =
    opts.imported.found &&
    (opts.imported.ownerTeamPresent === false ||
      opts.imported.supportChannelPresent === false ||
      (opts.imported.pingWithinSla === false &&
        opts.imported.onCallListed === false) ||
      (opts.imported.ageDays !== null && opts.imported.ageDays > 90));

  if (
    !opts.aiSignals &&
    !opts.ownership.found &&
    !opts.supportChannel.found &&
    !opts.imported.found
  ) {
    statusHint = "not_applicable";
    dxR4Satisfied = null;
  } else if (measuredFail) {
    statusHint = "fail";
    dxR4Satisfied = false;
    notes.push(
      "Imported results show missing owner/channel, no reachable support, or evidence older than 90 days — DX-R4 fail.",
    );
  } else if (passOk) {
    statusHint = "pass";
    dxR4Satisfied = true;
  } else if (
    opts.ownership.found ||
    opts.supportChannel.found ||
    opts.imported.found
  ) {
    statusHint = "partial";
    dxR4Satisfied = false;
    if (opts.imported.found) {
      if (opts.imported.ownerTeamPresent !== true) {
        notes.push("Import must show ownerTeamPresent=true.");
      }
      if (opts.imported.supportChannelPresent !== true) {
        notes.push("Import must show supportChannelPresent=true.");
      }
      if (
        opts.imported.pingWithinSla !== true &&
        opts.imported.onCallListed !== true
      ) {
        notes.push(
          "Import must show pingWithinSla=true or onCallListed=true with ageDays ≤90.",
        );
      }
      if (!importFresh) {
        notes.push(
          "Import missing fresh measuredAt (≤90 days) — required to unlock DX-R4 PASS.",
        );
      }
    }
  } else if (opts.aiSignals) {
    statusHint = "not_demonstrated";
    dxR4Satisfied = null;
    notes.push(
      "AI/platform signals present but no ownership or support-channel docs found.",
    );
  } else {
    statusHint = "not_demonstrated";
    dxR4Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    ownership: opts.ownership,
    supportChannel: opts.supportChannel,
    onCallSignals: opts.onCallSignals,
    slaSignals: opts.slaSignals,
    importedResults: opts.imported,
    summary: {
      aiSignalsPresent: opts.aiSignals,
      ownerAndChannelPresent,
      supportReachable:
        opts.imported.pingWithinSla === true ||
        opts.imported.onCallListed === true,
      dxR4Satisfied,
      statusHint,
    },
    notes,
  };
}

export const platformOwnershipSupportCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;
    const aiSignals = detectAiSignals(ctx.targetPath, maxFiles);

    const inPlatformContext = (path: string, text: string) =>
      PLATFORM_CONTEXT_RE.test(path) ||
      PLATFORM_CONTEXT_RE.test(text) ||
      AI_PATH_RE.test(path) ||
      /CODEOWNERS|OWNERS|SUPPORT|ONCALL|ON-CALL|PAGER/i.test(path);

    const ownershipRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (OWNER_RE.test(path) || OWNER_RE.test(text)) &&
        inPlatformContext(path, text),
    );
    const supportRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SUPPORT_CHANNEL_RE.test(path) || SUPPORT_CHANNEL_RE.test(text)) &&
        inPlatformContext(path, text),
    );
    const onCallRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (ONCALL_RE.test(path) || ONCALL_RE.test(text)) &&
        inPlatformContext(path, text),
      12,
    );
    const slaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (path, text) =>
        (SLA_RE.test(path) || SLA_RE.test(text)) &&
        inPlatformContext(path, text),
      12,
    );

    const imported = loadImported(ctx);
    const report = buildPlatformOwnershipSupportReport({
      assessedAt: ctx.assessedAt.toISOString(),
      ownership: {
        found: ownershipRefs.length > 0,
        refs: ownershipRefs,
      },
      supportChannel: {
        found: supportRefs.length > 0,
        refs: supportRefs,
      },
      onCallSignals: {
        found: onCallRefs.length > 0,
        refs: onCallRefs,
      },
      slaSignals: { found: slaRefs.length > 0, refs: slaRefs },
      aiSignals,
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "platform-ownership-support-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "docs",
        ref: `imports/${PLUGIN_ID}/platform-ownership-support-report.json`,
        excerpt: redact(JSON.stringify(report.summary)),
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: [
          "platform-ownership-support",
          "dx-r4",
          DETECTOR_ID,
          ...(report.summary.ownerAndChannelPresent
            ? ["owner-and-channel"]
            : []),
          ...(report.summary.dxR4Satisfied ? ["dx-r4-satisfied"] : []),
        ],
      },
    ];

    for (const r of [
      ...new Set([
        ...ownershipRefs.slice(0, 2),
        ...supportRefs.slice(0, 2),
        ...onCallRefs.slice(0, 2),
      ]),
    ]) {
      nodes.push({
        id: `${PLUGIN_ID}:ref:${r}`,
        class: "code",
        ref: r,
        pluginId: PLUGIN_ID,
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: 0,
        relatedCheckIds: [...RELATED],
        signals: ["platform-ownership-support-ref"],
      });
    }

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `DX-R4 status=${report.summary.statusHint} ownerChannel=${report.summary.ownerAndChannelPresent} satisfied=${report.summary.dxR4Satisfied}; report=imports/${PLUGIN_ID}/platform-ownership-support-report.json`,
      nodes,
    };
  },
};
