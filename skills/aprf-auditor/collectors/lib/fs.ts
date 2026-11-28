import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

export function writeJson(path: string, data: unknown): void {
  ensureDir(join(path, ".."));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function tryGitCommit(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function ageDays(assessedAt: Date, lastModified?: Date): number | null {
  if (!lastModified) return null;
  const ms = assessedAt.getTime() - lastModified.getTime();
  return Math.max(0, Math.round((ms / 86400000) * 10) / 10);
}

export function redact(text: string, max = 200): string {
  let t = text
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "sk-[REDACTED]")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA[REDACTED]")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[PRIVATE KEY REDACTED]",
    )
    .replace(
      /(?<![A-Za-z0-9])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9])/g,
      "[REDACTED_BLOB]",
    );
  t = t.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1) + "…";
}

/** Default filesystem walk cap (CLI `--max-files`). Raised so core packages stay in-scan. */
export const DEFAULT_MAX_FILES = 20_000;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "_next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "i18n",
  "locales",
  // Benchmark noise: locale packs, static assets, Next export. Also skips any
  // directory named static/ or out/ (including src/out). Prefer --max-files
  // over walking those trees. Do not skip examples/.
  "static",
  "out",
  // Prior audit output under the target must never count as repo evidence.
  "aprf-assessment",
]);

/** Shared path filter for collectors that post-filter walk results. */
export const SKIP_SCAN_DIR_RE =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.next|_next|\.turbo|\.venv|venv|__pycache__|vendor|i18n|locales|static|out|aprf-assessment|public[/\\]assets)([/\\]|$)/i;

/** Control-evidence ranking: walk these last, never skip (secrets/config live here). */
function isDeprioritizedDirName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "examples" || n === "example";
}

export interface WalkMeta {
  truncated: boolean;
  scanned: number;
  cappedAt: number;
}

export interface SharedFileIndex {
  root: string;
  files: string[];
  meta: WalkMeta;
  content: Map<string, string | null>;
}

let lastMeta: WalkMeta = {
  truncated: false,
  scanned: 0,
  cappedAt: DEFAULT_MAX_FILES,
};

let sharedIndex: SharedFileIndex | null = null;

export function lastWalkMeta(): WalkMeta {
  return lastMeta;
}

export function setSharedFileIndex(index: SharedFileIndex | null): void {
  sharedIndex = index;
}

export function getSharedFileIndex(): SharedFileIndex | null {
  return sharedIndex;
}

export const INDEX_EXTENSIONS: readonly string[] = [
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".yml",
  ".yaml",
  ".json",
  ".toml",
  ".md",
  ".txt",
  ".sh",
  ".tf",
  ".hcl",
  ".rego",
  ".env",
  ".cfg",
  ".baseline",
  ".ipynb",
];

export function walkCap(maxFiles?: number): number {
  return maxFiles ?? DEFAULT_MAX_FILES;
}

export function isSkippedScanRelPath(relPath: string): boolean {
  return SKIP_SCAN_DIR_RE.test(relPath);
}

/** Absolute dirs pruned for the current collect run (e.g. --out under --target). */
let walkSkipAbsoluteDirs: string[] = [];

export function setWalkSkipAbsoluteDirs(dirs: string[]): void {
  walkSkipAbsoluteDirs = dirs
    .map((d) => resolve(d))
    .filter((d) => d.length > 0);
}

export function clearWalkSkipAbsoluteDirs(): void {
  walkSkipAbsoluteDirs = [];
}

function isUnderSkipAbsoluteDir(absPath: string): boolean {
  if (!walkSkipAbsoluteDirs.length) return false;
  const p = resolve(absPath);
  for (const skip of walkSkipAbsoluteDirs) {
    if (p === skip || p.startsWith(skip + sep)) return true;
  }
  return false;
}

/**
 * When --out lives inside --target (as a subdirectory), prune that tree from
 * repo evidence walks. No-op when outDir is outside the target, or when outDir
 * equals the target (callers should reject that configuration — skipping the
 * target root would suppress all evidence).
 */
export function configureWalkSkipForCollect(
  targetPath: string,
  outputDir: string,
): void {
  const target = resolve(targetPath);
  const out = resolve(outputDir);
  if (out !== target && out.startsWith(target + sep)) {
    setWalkSkipAbsoluteDirs([out]);
  } else {
    clearWalkSkipAbsoluteDirs();
  }
}

/**
 * Default repo walk for hybrid collectors: source + config + light docs.
 * Prefer this over per-collector copies of the same list.
 */
export const SCAN_EXTENSIONS: readonly string[] = [
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".yml",
  ".yaml",
  ".json",
  ".toml",
  ".md",
  ".txt",
];

/** Docs / policy / catalog surfaces (ops, continuity, playbooks). */
export const SCAN_EXTENSIONS_DOCS: readonly string[] = [
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".json",
  ".ts",
  ".py",
];

/** CI / IaC-oriented walks (collect-refs default). */
export const SCAN_EXTENSIONS_INFRA: readonly string[] = [
  ...SCAN_EXTENSIONS,
  ".sh",
  ".tf",
  ".rego",
];

export function walkFiles(
  root: string,
  opts: {
    maxFiles?: number;
    extensions?: string[];
    /** Extra absolute directory trees to prune for this call only. */
    skipAbsoluteDirs?: string[];
    /** Skip the shared audit index (imports walks, tests). */
    skipIndex?: boolean;
  } = {},
): string[] {
  const max = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const exts = opts.extensions;
  const out: string[] = [];
  const callSkips = (opts.skipAbsoluteDirs ?? []).map((d) => resolve(d));
  const absRoot = resolve(root);

  if (
    !opts.skipIndex &&
    sharedIndex &&
    absRoot === sharedIndex.root
  ) {
    const filtered = sharedIndex.files.filter((p) => {
      if (exts && !exts.some((x) => p.endsWith(x))) return false;
      if (isUnderSkipAbsoluteDir(p)) return false;
      if (callSkips.some((skip) => p === skip || p.startsWith(skip + sep))) {
        return false;
      }
      return true;
    });
    const sliced = filtered.slice(0, max);
    lastMeta = {
      truncated: sharedIndex.meta.truncated || filtered.length > max,
      scanned: sliced.length,
      cappedAt: max,
    };
    return sliced;
  }

  const shouldSkipDir = (
    absDir: string,
    name: string,
    parentDir: string,
  ): boolean => {
    const lower = name.toLowerCase();
    if (SKIP_DIRS.has(lower)) return true;
    if (lower === "assets" && basename(parentDir).toLowerCase() === "public") {
      return true;
    }
    if (isUnderSkipAbsoluteDir(absDir)) return true;
    for (const skip of callSkips) {
      if (absDir === skip || absDir.startsWith(skip + sep)) return true;
    }
    return false;
  };

  const queue: string[] = [root];
  let truncated = false;
  while (queue.length) {
    if (out.length >= max) {
      truncated = true;
      break;
    }
    const dir = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const nextDirs: string[] = [];
    const delayedDirs: string[] = [];
    for (const e of entries) {
      const name = e.name;
      if (
        name.startsWith(".") &&
        name !== ".github" &&
        name !== ".env.example"
      ) {
        if (e.isDirectory() && name !== ".github") continue;
      }
      const p = join(dir, name);
      if (e.isDirectory()) {
        if (shouldSkipDir(resolve(p), name, dir)) continue;
        if (isDeprioritizedDirName(name)) delayedDirs.push(p);
        else nextDirs.push(p);
      } else if (e.isFile()) {
        if (exts && !exts.some((x) => name.endsWith(x))) continue;
        if (isUnderSkipAbsoluteDir(p)) continue;
        if (callSkips.some((skip) => p === skip || p.startsWith(skip + sep))) {
          continue;
        }
        if (out.length >= max) {
          truncated = true;
          continue;
        }
        out.push(p);
      }
    }
    if (out.length >= max) {
      if (nextDirs.length || delayedDirs.length || queue.length) {
        truncated = true;
      }
      break;
    }
    queue.push(...nextDirs, ...delayedDirs);
  }
  lastMeta = { truncated, scanned: out.length, cappedAt: max };
  return out.sort((a, b) => a.localeCompare(b));
}

export function buildSharedFileIndex(
  root: string,
  maxFiles: number,
): SharedFileIndex {
  const files = walkFiles(root, {
    maxFiles,
    skipIndex: true,
    extensions: [...INDEX_EXTENSIONS],
  });
  const index: SharedFileIndex = {
    root: resolve(root),
    files,
    meta: { ...lastWalkMeta() },
    content: new Map(),
  };
  sharedIndex = index;
  return index;
}

export function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

const CONTENT_CACHE_MAX_ENTRIES = 512;
const CONTENT_CACHE_MAX_BYTES = 64_000;

export function readText(file: string, maxBytes = 256_000): string | null {
  const cacheKey = `${file}\0${maxBytes}`;
  if (sharedIndex?.content.has(cacheKey)) {
    return sharedIndex.content.get(cacheKey) ?? null;
  }
  let result: string | null = null;
  try {
    const st = statSync(file);
    if (st.size > maxBytes) {
      result = readFileSync(file, { encoding: "utf8" }).slice(0, maxBytes);
    } else {
      result = readFileSync(file, "utf8");
    }
  } catch {
    result = null;
  }
  if (
    sharedIndex &&
    result !== null &&
    result.length <= CONTENT_CACHE_MAX_BYTES &&
    sharedIndex.content.size < CONTENT_CACHE_MAX_ENTRIES
  ) {
    sharedIndex.content.set(cacheKey, result);
  }
  return result;
}

export function mtimeIso(file: string): string | undefined {
  try {
    return statSync(file).mtime.toISOString();
  } catch {
    return undefined;
  }
}

export function mtimeDate(file: string): Date | undefined {
  try {
    return statSync(file).mtime;
  } catch {
    return undefined;
  }
}

export function importsDir(outputDir: string, pluginId: string): string {
  return join(outputDir, "imports", pluginId);
}

export function listImportFiles(outputDir: string, pluginId: string): string[] {
  const dir = importsDir(outputDir, pluginId);
  if (!existsSync(dir)) return [];
  // Import ingest intentionally reads under outDir; clear global skip for this walk.
  const prev = walkSkipAbsoluteDirs;
  walkSkipAbsoluteDirs = [];
  try {
    return walkFiles(dir, { maxFiles: 500 });
  } finally {
    walkSkipAbsoluteDirs = prev;
  }
}

export function projectName(targetPath: string): string {
  return basename(resolve(targetPath));
}

export function matchAny(path: string, needles: string[]): boolean {
  const p = path.toLowerCase();
  return needles.some((n) => p.includes(n.toLowerCase()));
}
