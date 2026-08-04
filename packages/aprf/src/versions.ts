import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

function readPkgVersion(name: string): string {
  try {
    return String(require(`${name}/package.json`).version);
  } catch {
    return "unknown";
  }
}

export function cliVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/cli.js → ../package.json (published) or ../../package.json (src via tsx)
    for (const rel of ["../package.json", "../../package.json"]) {
      try {
        const pkg = JSON.parse(readFileSync(resolve(here, rel), "utf8")) as {
          version?: string;
        };
        if (pkg.version) return pkg.version;
      } catch {
        /* try next */
      }
    }
  } catch {
    /* fall through */
  }
  return "0.1.0";
}

export function catalogVersion(): string {
  return readPkgVersion("@stackrail-io/aprf-engine");
}

export function frameworkVersion(): string {
  return readPkgVersion("@stackrail-io/aprf-framework-definition");
}
