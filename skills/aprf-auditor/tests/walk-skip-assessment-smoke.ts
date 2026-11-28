/**
 * Smoke: assessment outDir under the target must never appear in walkFiles results.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearWalkSkipAbsoluteDirs,
  configureWalkSkipForCollect,
  DEFAULT_MAX_FILES,
  isSkippedScanRelPath,
  lastWalkMeta,
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
  // Conventional name + case variant (must match SKIP_SCAN_DIR_RE / SKIP_DIRS).
  mkdirSync(join(target, "aprf-assessment", "imports"), { recursive: true });
  writeFileSync(
    join(target, "aprf-assessment", "assessment.json"),
    '{"notes":["max_steps"]}',
    "utf8",
  );
  mkdirSync(join(target, "APRF-ASSESSMENT", "imports"), { recursive: true });
  writeFileSync(
    join(target, "APRF-ASSESSMENT", "assessment.json"),
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
      (r) =>
        r.includes("custom-out") ||
        /(^|\/)aprf-assessment(\/|$)/i.test(r),
    );
    if (leaked.length) {
      throw new Error(`assessment trees leaked into walk: ${leaked}`);
    }
  } finally {
    clearWalkSkipAbsoluteDirs();
  }

  // outDir === target must not prune the whole repo (runner rejects; helper no-ops).
  configureWalkSkipForCollect(target, target);
  try {
    const files = walkFiles(target, {
      maxFiles: 200,
      extensions: [".py"],
    });
    const rels = files.map((f) => rel(target, f));
    if (!rels.some((r) => r.includes("src/app.py"))) {
      throw new Error(
        `equal out/target must not skip repo root; got ${JSON.stringify(rels)}`,
      );
    }
  } finally {
    clearWalkSkipAbsoluteDirs();
  }

  if (!isSkippedScanRelPath("aprf-assessment/assessment.json")) {
    throw new Error("isSkippedScanRelPath should match aprf-assessment paths");
  }
  if (!isSkippedScanRelPath("APRF-ASSESSMENT/assessment.json")) {
    throw new Error("isSkippedScanRelPath should match case variants");
  }

  rmSync(target, { recursive: true, force: true });

  const capRoot = mkdtempSync(join(tmpdir(), "aprf-walk-cap-"));
  mkdirSync(join(capRoot, "i18n"), { recursive: true });
  mkdirSync(join(capRoot, "examples"), { recursive: true });
  mkdirSync(join(capRoot, "api"), { recursive: true });
  mkdirSync(join(capRoot, "_next"), { recursive: true });
  writeFileSync(join(capRoot, "i18n", "en.json"), "{}\n", "utf8");
  writeFileSync(join(capRoot, "_next", "bundle.js"), "sk-not-scanned\n", "utf8");
  writeFileSync(join(capRoot, "examples", "secret.env"), "AKIAEXAMPLE\n", "utf8");
  writeFileSync(join(capRoot, "api", "main.py"), "print(1)\n", "utf8");
  const full = walkFiles(capRoot, {
    maxFiles: 200,
    extensions: [".py", ".js", ".json", ".env"],
    skipIndex: true,
  });
  const fullRels = full.map((f) => rel(capRoot, f));
  if (fullRels.some((r) => r.includes("i18n") || r.includes("_next"))) {
    throw new Error(`noise dirs leaked: ${JSON.stringify(fullRels)}`);
  }
  if (!fullRels.some((r) => r.includes("examples/"))) {
    throw new Error(`examples/ must still be walked: ${JSON.stringify(fullRels)}`);
  }
  for (let i = 0; i < 30; i++) {
    writeFileSync(join(capRoot, `pad-${i}.py`), `x=${i}\n`, "utf8");
  }
  walkFiles(capRoot, {
    maxFiles: 8,
    extensions: [".py", ".js", ".json", ".env"],
    skipIndex: true,
  });
  const meta = lastWalkMeta();
  if (!meta.truncated) {
    throw new Error(`expected truncation warning meta, got ${JSON.stringify(meta)}`);
  }
  if (DEFAULT_MAX_FILES < 20000) {
    throw new Error(`default cap should be >= 20000, got ${DEFAULT_MAX_FILES}`);
  }
  const exactRoot = mkdtempSync(join(tmpdir(), "aprf-walk-exact-"));
  mkdirSync(join(exactRoot, "src"), { recursive: true });
  writeFileSync(join(exactRoot, "src", "a.py"), "a=1\n", "utf8");
  writeFileSync(join(exactRoot, "src", "b.py"), "b=1\n", "utf8");
  writeFileSync(join(exactRoot, "src", "c.py"), "c=1\n", "utf8");
  walkFiles(exactRoot, {
    maxFiles: 10,
    extensions: [".py"],
    skipIndex: true,
  });
  const exactMeta = lastWalkMeta();
  rmSync(exactRoot, { recursive: true, force: true });
  if (exactMeta.truncated || exactMeta.scanned !== 3) {
    throw new Error(
      `exact fit must not truncate: ${JSON.stringify(exactMeta)}`,
    );
  }
  rmSync(capRoot, { recursive: true, force: true });
  console.log("walk-skip-assessment smoke OK");
}

main();
