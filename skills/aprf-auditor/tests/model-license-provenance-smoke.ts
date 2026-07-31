/**
 * Smoke: model-license-provenance needs full fresh reviews + exception hygiene for PASS.
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
  modelLicenseProvenanceCollector,
  type ModelLicenseProvenanceReport,
} from "../collectors/model-license-provenance.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<ModelLicenseProvenanceReport> {
  await modelLicenseProvenanceCollector.collect({
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
        "model-license-provenance",
        "model-license-provenance-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-mod-r3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "model-license-review.md"),
      "# Open-weight model license review\nprovenance review checklist\nfine-tuned model card\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.modR3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "registry"), { recursive: true });
    writeFileSync(
      join(t2, "registry", "open-weight-models.yaml"),
      "models:\n  - id: llama-ft\n    open_weight: true\n    fine_tuned: true\n    license_review_date: 2026-01-01\n    provenance_review: complete\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "model-license-provenance"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "model-license-provenance", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        openWeightOrFineTunedMissingReview: 0,
        reviewsOlderThan12Months: 0,
        blockedLicensesMissingException: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.modR3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "weights.md"),
      "huggingface open-weight checkpoint with safetensors\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "model-license-provenance"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "model-license-provenance", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        openWeightOrFineTunedMissingReview: 1,
        reviewsOlderThan12Months: 0,
        blockedLicensesMissingException: 1,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.modR3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("model-license-provenance smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
