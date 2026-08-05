/**
 * Smoke: assessment outDir under the target must never appear in walkFiles results.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearWalkSkipAbsoluteDirs,
  configureWalkSkipForCollect,
  isSkippedScanRelPath,
  rel,
  walkFiles,
} from "../collectors/lib/fs.ts";

function main() {
  const target = mkdtempSync(join(tmpdir(), "aprf-walk-skip-t-"));
  const outDir = join(target, "custom-out");
  mkdirSync(join(target, "src"), { recursive: true });
  mkdirSync(join(outDir, "imports", "demo"), { recursive: true });
  writeFileSync(join(target, "src", "app.py"), "max_steps = 1\n", "utf8");
  writeFileSync(
    join(outDir, "assessment.json"),
    JSON.stringify({ notes: ["max_steps wall_clock spawn_depth"] }),
    "utf8",
  );
  writeFileSync(
    join(outDir, "imports", "demo", "demo-report.json"),
    JSON.stringify({ maxSteps: { found: true } }),
    "utf8",
  );
  // Also plant the conventional name.
  mkdirSync(join(target, "aprf-assessment", "imports"), { recursive: true });
  writeFileSync(
    join(target, "aprf-assessment", "assessment.json"),
    '{"notes":["max_steps"]}',
    "utf8",
  );

  configureWalkSkipForCollect(target, outDir);
  try {
    const files = walkFiles(target, {
      maxFiles: 200,
      extensions: [".py", ".json"],
    });
    const rels = files.map((f) => rel(target, f));
    if (!rels.some((r) => r.includes("src/app.py"))) {
      throw new Error(`expected repo file, got ${JSON.stringify(rels)}`);
    }
    const leaked = rels.filter(
      (r) => r.includes("custom-out") || r.includes("aprf-assessment"),
    );
    if (leaked.length) {
      throw new Error(`assessment trees leaked into walk: ${leaked}`);
    }
  } finally {
    clearWalkSkipAbsoluteDirs();
  }

  if (!isSkippedScanRelPath("aprf-assessment/assessment.json")) {
    throw new Error("isSkippedScanRelPath should match aprf-assessment paths");
  }

  rmSync(target, { recursive: true, force: true });
  console.log("walk-skip-assessment smoke OK");
}

main();
