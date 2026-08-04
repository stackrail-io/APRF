#!/usr/bin/env node
import {
  mkdirSync,
  chmodSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  cpSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const dist = resolve(pkgRoot, "dist");
const repoRoot = resolve(pkgRoot, "../..");

mkdirSync(dist, { recursive: true });

// Charter spec/examples are read at report-render time from disk (bundled path).
const charterExamples = resolve(
  repoRoot,
  "skills/aprf-auditor/examples/agent-charter",
);
if (existsSync(charterExamples)) {
  cpSync(charterExamples, resolve(dist, "examples/agent-charter"), {
    recursive: true,
  });
}

// Brand mark for REPORT.html (embedded as data URI at render time).
const owlMark = resolve(repoRoot, "plugins/aprf/assets/owl-mark.png");
if (existsSync(owlMark)) {
  mkdirSync(resolve(dist, "assets"), { recursive: true });
  copyFileSync(owlMark, resolve(dist, "assets/owl-mark.png"));
}

await esbuild.build({
  entryPoints: [resolve(pkgRoot, "src/cli.ts")],
  outfile: resolve(dist, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: "#!/usr/bin/env node\n",
  },
  // Keep catalog packages + yaml external (yaml uses CJS dynamic require).
  external: [
    "@stackrail-io/aprf-engine",
    "@stackrail-io/aprf-framework-definition",
    "yaml",
  ],
  // Collectors / skill scripts live outside this package.
  absWorkingDir: repoRoot,
  logLevel: "info",
});

chmodSync(resolve(dist, "cli.js"), 0o755);

// Tiny package marker for runtime version reporting inside the bundle path.
writeFileSync(
  resolve(dist, "BUILD.json"),
  `${JSON.stringify({ builtAt: new Date().toISOString() }, null, 2)}\n`,
);

for (const name of ["LICENSE", "NOTICE"]) {
  const src = resolve(repoRoot, name);
  if (existsSync(src)) copyFileSync(src, resolve(pkgRoot, name));
}

console.log("Built dist/cli.js");
