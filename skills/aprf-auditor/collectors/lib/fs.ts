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

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
]);

export function walkFiles(
  root: string,
  opts: { maxFiles?: number; extensions?: string[] } = {},
): string[] {
  const max = opts.maxFiles ?? 4000;
  const exts = opts.extensions;
  const out: string[] = [];

  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= max) break;
      const name = e.name;
      if (name.startsWith(".") && name !== ".github" && name !== ".env.example") {
        if (e.isDirectory() && name !== ".github") continue;
      }
      const p = join(dir, name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        stack.push(p);
      } else if (e.isFile()) {
        if (exts && !exts.some((x) => name.endsWith(x))) continue;
        out.push(p);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

export function readText(file: string, maxBytes = 256_000): string | null {
  try {
    const st = statSync(file);
    if (st.size > maxBytes) {
      return readFileSync(file, { encoding: "utf8" }).slice(0, maxBytes);
    }
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
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
  return walkFiles(dir, { maxFiles: 500 });
}

export function projectName(targetPath: string): string {
  return basename(resolve(targetPath));
}

export function matchAny(path: string, needles: string[]): boolean {
  const p = path.toLowerCase();
  return needles.some((n) => p.includes(n.toLowerCase()));
}
