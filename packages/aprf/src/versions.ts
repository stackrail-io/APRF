import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

function readJsonVersion(pkgPath: string): string | undefined {
  try {
    if (!existsSync(pkgPath)) return undefined;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ? String(pkg.version) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prefer monorepo sibling package.json (packages/<dir>) over a possibly stale
 * nested copy under packages/aprf/node_modules/@stackrail-io/*.
 * Works from both src/ (tsx) and dist/ (bundled CLI).
 */
function readWorkspaceSiblingVersion(dirName: string): string | undefined {
  // HERE is packages/aprf/src or packages/aprf/dist → siblings are ../../<dir>
  // (also probe ../../../ for unusual bundle layouts).
  for (const rel of [
    `../../${dirName}/package.json`,
    `../../../${dirName}/package.json`,
  ]) {
    const v = readJsonVersion(resolve(HERE, rel));
    if (v) return v;
  }
  return undefined;
}

function readPkgVersion(name: string): string {
  try {
    return String(require(`${name}/package.json`).version);
  } catch {
    return "unknown";
  }
}

declare const __APRF_GIT_SHA__: string | undefined;

function readBuildGitSha(): string | undefined {
  for (const rel of ["../BUILD.json", "./BUILD.json"]) {
    try {
      const p = resolve(HERE, rel);
      if (!existsSync(p)) continue;
      const j = JSON.parse(readFileSync(p, "utf8")) as { gitSha?: string };
      if (j.gitSha && j.gitSha !== "unknown") return String(j.gitSha);
    } catch {
      /* continue */
    }
  }
  try {
    const defined =
      typeof __APRF_GIT_SHA__ !== "undefined" ? __APRF_GIT_SHA__ : "";
    if (defined) return defined;
  } catch {
    /* no esbuild define */
  }
  return undefined;
}

export function cliVersion(): string {
  let v = "0.1.0";
  try {
    // dist/cli.js → ../package.json (published) or ../../package.json (src via tsx)
    for (const rel of ["../package.json", "../../package.json"]) {
      const found = readJsonVersion(resolve(HERE, rel));
      if (found) {
        v = found;
        break;
      }
    }
  } catch {
    /* fall through */
  }
  const sha = readBuildGitSha();
  return sha ? `${v}+${sha}` : v;
}

export function catalogVersion(): string {
  return (
    readWorkspaceSiblingVersion("aprf-engine") ??
    readPkgVersion("@stackrail-io/aprf-engine")
  );
}

export function frameworkVersion(): string {
  return (
    readWorkspaceSiblingVersion("framework-definition") ??
    readPkgVersion("@stackrail-io/aprf-framework-definition")
  );
}
