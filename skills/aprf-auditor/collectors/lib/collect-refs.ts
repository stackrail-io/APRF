/**
 * Shared path/text ref collection for hybrid auditors.
 */
import { readText, rel, walkFiles } from "./fs.ts";

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const DEFAULT_EXTENSIONS = [
  ".yml",
  ".yaml",
  ".json",
  ".md",
  ".toml",
  ".sh",
  ".ts",
  ".js",
  ".py",
  ".tf",
  ".rego",
];

export function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 12,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: DEFAULT_EXTENSIONS,
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (SKIP_DIR_HINT.test(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

export function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
