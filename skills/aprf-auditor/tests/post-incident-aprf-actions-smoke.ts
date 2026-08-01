/**
 * Smoke: post-incident-aprf-actions needs 100% coverage (or N/A when sev=0).
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
  postIncidentAprfActionsCollector,
  type PostIncidentAprfActionsReport,
} from "../collectors/post-incident-aprf-actions.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PostIncidentAprfActionsReport> {
  await postIncidentAprfActionsCollector.collect({
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
        "post-incident-aprf-actions",
        "post-incident-aprf-actions-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inc-r2-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "postmortem-template.md"),
      "Post-incident review with APRF pillar tracked action mapping\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.incR2Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "incidents"), { recursive: true });
    writeFileSync(
      join(t2, "incidents", "pir.md"),
      "SEV-2 postmortem: tracked action mapped to APRF pillar; no-action rationale optional\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "post-incident-aprf-actions"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "post-incident-aprf-actions", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sevEligibleIncidentCount: 2,
        reviewsWithTrackedActionOrRationalePct: 100,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.incR2Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "after-action.md"),
      "After-action report for AI incident\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "post-incident-aprf-actions"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "post-incident-aprf-actions", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sevEligibleIncidentCount: 1,
        reviewsMissingTrackedActionOrRationale: 1,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.incR2Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const t4 = join(root, "t4");
    mkdirSync(t4, { recursive: true });
    const out4 = join(root, "o4");
    mkdirSync(join(out4, "imports", "post-incident-aprf-actions"), {
      recursive: true,
    });
    writeFileSync(
      join(out4, "imports", "post-incident-aprf-actions", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        sevEligibleIncidentCount: 0,
      }),
    );
    const r4 = await run(t4, out4);
    if (r4.summary.statusHint !== "not_applicable") {
      throw new Error(`na expected: ${JSON.stringify(r4.summary)}`);
    }

    const t5 = join(root, "t5");
    mkdirSync(join(t5, "docs"), { recursive: true });
    writeFileSync(
      join(t5, "docs", "postmortem.md"),
      "Post-incident review with APRF pillar action\n",
    );
    const out5 = join(root, "o5");
    mkdirSync(join(out5, "imports", "post-incident-aprf-actions"), {
      recursive: true,
    });
    writeFileSync(
      join(out5, "imports", "post-incident-aprf-actions", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        reviewsWithTrackedActionOrRationalePct: 100,
      }),
    );
    const r5 = await run(t5, out5);
    if (
      r5.summary.statusHint !== "partial" ||
      r5.summary.incR2Satisfied !== false
    ) {
      throw new Error(
        `partial without sev count expected: ${JSON.stringify(r5.summary)}`,
      );
    }

    console.log("post-incident-aprf-actions smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
