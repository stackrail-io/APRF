import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Collector, CollectorContext, EvidenceNode } from "./types.ts";
import {
  ageDays,
  mtimeDate,
  mtimeIso,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";

function signalsFromWorkflow(content: string): string[] {
  const s = new Set<string>();
  s.add("workflow-job");
  const lower = content.toLowerCase();
  if (/gitleaks|trufflehog|secret.?scan|detect-secrets/.test(lower)) {
    s.add("secret-scan");
  }
  if (/promptfoo|eval|pytest|vitest|jest/.test(lower)) s.add("eval-gate");
  if (/deploy|helm|kubectl|terraform apply/.test(lower)) s.add("deploy");
  if (/permissions:/.test(lower)) s.add("permissions-block");
  if (/id-token:\s*write|oidc/.test(lower)) s.add("oidc");
  return [...s];
}

function relatedChecks(signals: string[]): string[] {
  const ids: string[] = [];
  if (signals.includes("secret-scan")) ids.push("SEC2-M1", "SEC2-M2");
  if (signals.includes("eval-gate")) ids.push("EVL-M1");
  if (signals.includes("deploy")) ids.push("CHG-M1", "CHG-M2");
  return ids;
}

export const githubActionsCollector: Collector = {
  id: "github-actions",
  async collect(ctx: CollectorContext) {
    const wfDir = join(ctx.targetPath, ".github", "workflows");
    if (!existsSync(wfDir)) {
      return {
        pluginId: "github-actions",
        status: "skipped",
        detail: "No .github/workflows directory",
        nodes: [],
      };
    }

    const files = walkFiles(wfDir, {
      maxFiles: 200,
      extensions: [".yml", ".yaml"],
    });
    const nodes: EvidenceNode[] = [];
    let i = 0;
    for (const file of files) {
      const content = readText(file) ?? "";
      const signals = signalsFromWorkflow(content);
      const r = rel(ctx.targetPath, file);
      const mt = mtimeDate(file);
      nodes.push({
        id: `github-actions:${i++}:${r}`,
        class: "ci",
        ref: r,
        excerpt: redact(content.slice(0, 400)),
        pluginId: "github-actions",
        lastModified: mtimeIso(file),
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: ageDays(ctx.assessedAt, mt),
        signals,
        relatedCheckIds: relatedChecks(signals),
      });
    }

    // Optional live: recent workflow runs via GitHub API
    if (ctx.live && process.env.GITHUB_TOKEN) {
      const liveNodes = await fetchRecentRuns(ctx);
      nodes.push(...liveNodes);
    } else if (ctx.live && !process.env.GITHUB_TOKEN) {
      return {
        pluginId: "github-actions",
        status: "needs-user",
        detail:
          "Parsed workflows; set GITHUB_TOKEN for live run evidence (APRF_AUDITOR_LIVE=1)",
        nodes,
      };
    }

    return {
      pluginId: "github-actions",
      status: "ran",
      detail: `Parsed ${files.length} workflow file(s)`,
      nodes,
    };
  },
};

async function fetchRecentRuns(ctx: CollectorContext): Promise<EvidenceNode[]> {
  const remote = tryRemote(ctx.targetPath);
  if (!remote) return [];
  const url = `https://api.github.com/repos/${remote}/actions/runs?per_page=5`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "aprf-auditor-collectors",
      },
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      workflow_runs?: Array<{
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string;
        updated_at: string;
        head_sha: string;
      }>;
    };
    return (body.workflow_runs ?? []).map((run) => ({
      id: `github-actions:live:${run.id}`,
      class: "ci" as const,
      ref: run.html_url,
      excerpt: redact(
        `${run.name} status=${run.status} conclusion=${run.conclusion ?? "n/a"}`,
      ),
      pluginId: "github-actions",
      lastModified: run.updated_at,
      gitCommit: run.head_sha,
      buildId: String(run.id),
      evidenceAgeDays: ageDays(ctx.assessedAt, new Date(run.updated_at)),
      signals: ["workflow-run", run.conclusion ?? run.status],
      relatedCheckIds: ["CHG-M1"],
    }));
  } catch {
    return [];
  }
}

function tryRemote(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = out.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m ? m[1].replace(/\.git$/, "") : null;
  } catch {
    return null;
  }
}
