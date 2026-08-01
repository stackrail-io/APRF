/**
 * Smoke: sensitive-doc-abac needs enumerated classes + inventory match + deny tests.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sensitiveDocAbacCollector,
  type SensitiveDocAbacReport,
} from "../collectors/sensitive-doc-abac.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<SensitiveDocAbacReport> {
  await sensitiveDocAbacCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "sensitive-doc-abac",
        "sensitive-doc-abac-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authz-m4-"));
  const dirs: string[] = [root];

  try {
    const target = join(root, "target");
    mkdirSync(join(target, "policies"), { recursive: true });
    writeFileSync(
      join(target, "policies", "sensitive-document-classes.md"),
      "# Sensitive document classes\nABAC attribute-based policy with cedar subject attributes.\n",
      "utf8",
    );
    const out1 = join(root, "out1");
    mkdirSync(out1, { recursive: true });
    dirs.push(out1);
    const r1 = await run(target, out1);
    if (r1.summary.statusHint !== "partial") {
      throw new Error(`signals-only expected partial, got ${r1.summary.statusHint}`);
    }

    const out2 = join(root, "out2");
    mkdirSync(join(out2, "imports", "sensitive-doc-abac"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "sensitive-doc-abac", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveDocumentClassesPresent: true,
        sensitiveDocumentClassesEnumerated: true,
        inventoryMatchesProductionClasses: true,
        unauthorizedClassAccessDeniedInTests: true,
      }),
      "utf8",
    );
    dirs.push(out2);
    const r2 = await run(target, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authzM4Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const out3 = join(root, "out3");
    mkdirSync(join(out3, "imports", "sensitive-doc-abac"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "sensitive-doc-abac", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveDocumentClassesEnumerated: true,
        inventoryMatchesProductionClasses: true,
        unauthorizedClassAccessDeniedInTests: false,
      }),
      "utf8",
    );
    dirs.push(out3);
    const r3 = await run(target, out3);
    if (r3.summary.statusHint !== "fail") {
      throw new Error(`deny fail expected fail, got ${r3.summary.statusHint}`);
    }

    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    const outNa = join(root, "out-na");
    mkdirSync(join(outNa, "imports", "sensitive-doc-abac"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "sensitive-doc-abac", "na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveDocumentClassesPresent: false,
      }),
      "utf8",
    );
    dirs.push(outNa);
    const rNa = await run(empty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(
        `expected not_applicable, got ${rNa.summary.statusHint} notes=${rNa.notes.join("; ")}`,
      );
    }

    // Bare "confidential" / OPA mention must not override N/A + coverage → PASS.
    const weak = join(root, "weak");
    mkdirSync(join(weak, "docs"), { recursive: true });
    writeFileSync(
      join(weak, "docs", "notes.md"),
      "Keep confidential customer notes. We evaluate OPA elsewhere.\n",
      "utf8",
    );
    const outWeak = join(root, "out-weak-na");
    mkdirSync(join(outWeak, "imports", "sensitive-doc-abac"), {
      recursive: true,
    });
    writeFileSync(
      join(outWeak, "imports", "sensitive-doc-abac", "na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveDocumentClassesPresent: false,
      }),
      "utf8",
    );
    writeFileSync(
      join(outWeak, "imports", "sensitive-doc-abac", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sensitiveDocumentClassesEnumerated: true,
        inventoryMatchesProductionClasses: true,
        unauthorizedClassAccessDeniedInTests: true,
      }),
      "utf8",
    );
    dirs.push(outWeak);
    const rWeak = await run(weak, outWeak);
    if (rWeak.summary.statusHint !== "not_applicable") {
      throw new Error(
        `weak signals must not override N/A / PASS: ${JSON.stringify(rWeak.summary)}`,
      );
    }

    console.log("aprf-auditor sensitive-doc-abac smoke OK");
  } finally {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
