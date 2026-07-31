/**
 * Smoke: eval-track-catalog needs three tracks + owners + last-promotion runs for PASS.
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
  evalTrackCatalogCollector,
  type EvalTrackCatalogReport,
} from "../collectors/eval-track-catalog.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<EvalTrackCatalogReport> {
  await evalTrackCatalogCollector.collect({
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
        "eval-track-catalog",
        "eval-track-catalog-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-evl-r1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "catalog.yml"),
      "tracks:\n  - name: regression_track\n  - name: adversarial_track\n  - name: distribution_shift_track\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.evlR1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "evals"), { recursive: true });
    writeFileSync(
      join(t2, "evals", "tracks.md"),
      "regression track\nadversarial track\ndistribution-shift track\nowner: eval-team\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "eval-track-catalog"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "eval-track-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        missingTracks: 0,
        missingOwners: 0,
        tracksNotRunOnLastPromotion: 0,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.evlR1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "evals"), { recursive: true });
    writeFileSync(
      join(t3, "evals", "suite.yaml"),
      "eval regression track and adversarial track\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "eval-track-catalog"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "eval-track-catalog", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        missingTracks: 1,
        missingOwners: 0,
        tracksNotRunOnLastPromotion: 0,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.evlR1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("eval-track-catalog smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
