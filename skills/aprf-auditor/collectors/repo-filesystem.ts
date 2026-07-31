import type { Collector, CollectorContext, EvidenceNode } from "./types.ts";
import {
  ageDays,
  matchAny,
  mtimeDate,
  mtimeIso,
  projectName,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";

const DOC_HINTS = ["readme", "security", "contributing", "/docs/", "adr"];
const POLICY_HINTS = [".rego", "/cedar/", "policy", "allowlist"];
const IAC_HINTS = [".tf", "terraform", "pulumi", "/helm/", "deployment", "kustomization"];
const CONFIG_HINTS = [
  "mcp",
  "model",
  "prompt",
  "feature-flag",
  "launchdarkly",
  "unleash",
  ".env.example",
];
const CODE_HINTS = [
  "/src/",
  "/app/",
  "/lib/",
  "/packages/",
  ".ts",
  ".tsx",
  ".py",
  ".go",
];

function classify(relPath: string): EvidenceNode["class"] {
  if (matchAny(relPath, POLICY_HINTS)) return "policy";
  if (matchAny(relPath, IAC_HINTS)) return "iac";
  if (matchAny(relPath, CONFIG_HINTS)) return "runtime-config";
  if (matchAny(relPath, DOC_HINTS)) return "docs";
  if (matchAny(relPath, CODE_HINTS)) return "code";
  return "code";
}

function interesting(relPath: string): boolean {
  return (
    matchAny(relPath, [
      ...DOC_HINTS,
      ...POLICY_HINTS,
      ...IAC_HINTS,
      ...CONFIG_HINTS,
      "dockerfile",
      "docker-compose",
      "openapi",
      "guardrail",
      "eval",
      "otel",
      "secret",
      "auth",
    ]) ||
    /\.(ya?ml|json|toml|md|tf|rego)$/i.test(relPath)
  );
}

export const repoFilesystemCollector: Collector = {
  id: "repo-filesystem",
  async collect(ctx: CollectorContext) {
    const files = walkFiles(ctx.targetPath, { maxFiles: ctx.maxFiles ?? 4000 });
    const nodes: EvidenceNode[] = [];
    let i = 0;
    for (const file of files) {
      const r = rel(ctx.targetPath, file);
      if (!interesting(r)) continue;
      const text = readText(file, 8_000);
      const mt = mtimeDate(file);
      nodes.push({
        id: `repo-filesystem:${i++}:${r}`,
        class: classify(r),
        ref: r,
        excerpt: text ? redact(text.slice(0, 400)) : undefined,
        pluginId: "repo-filesystem",
        lastModified: mtimeIso(file),
        gitCommit: ctx.gitCommit,
        evidenceAgeDays: ageDays(ctx.assessedAt, mt),
        signals: ["file-present"],
      });
    }
    return {
      pluginId: "repo-filesystem",
      status: "ran",
      detail: `scanned ${files.length} files, emitted ${nodes.length} nodes for ${projectName(ctx.targetPath)}`,
      nodes,
    };
  },
};
