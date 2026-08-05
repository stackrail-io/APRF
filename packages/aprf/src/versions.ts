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
  return readJsonVersion(resolve(HERE, `../${dirName}/package.json`));
}

function readPkgVersion(name: string): string {
  try {
    return String(require(`${name}/package.json`).version);
  } catch {
    return "unknown";
  }
}

export function cliVersion(): string {
  try {
    // dist/cli.js → ../package.json (published) or ../../package.json (src via tsx)
    for (const rel of ["../package.json", "../../package.json"]) {
      const v = readJsonVersion(resolve(HERE, rel));
      if (v) return v;
    }
  } catch {
    /* fall through */
  }
  return "0.1.0";
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
