/**
 * Smoke: high-priv-agent-review needs ≤90d review + revoke/none-warranted.
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
  highPrivAgentReviewCollector,
  type HighPrivAgentReviewReport,
} from "../collectors/high-priv-agent-review.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<HighPrivAgentReviewReport> {
  await highPrivAgentReviewCollector.collect({
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
        "high-priv-agent-review",
        "high-priv-agent-review-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authz-r2-"));
  const dirs: string[] = [root];

  try {
    const target = join(root, "target");
    mkdirSync(join(target, "docs"), { recursive: true });
    writeFileSync(
      join(target, "docs", "high-privilege-agent-access-review.md"),
      "# High-privilege agent access review\nRevoke and scope-reduction decisions.\n",
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
    mkdirSync(join(out2, "imports", "high-priv-agent-review"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "high-priv-agent-review", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highPrivilegeAgentIdentitiesPresent: true,
        everyHighPrivilegeAgentReviewedWithin90Days: true,
        revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted: true,
      }),
      "utf8",
    );
    dirs.push(out2);
    const r2 = await run(target, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authzR2Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const out3 = join(root, "out3");
    mkdirSync(join(out3, "imports", "high-priv-agent-review"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "high-priv-agent-review", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        everyHighPrivilegeAgentReviewedWithin90Days: true,
        revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted: false,
      }),
      "utf8",
    );
    dirs.push(out3);
    const r3 = await run(target, out3);
    if (r3.summary.statusHint !== "fail") {
      throw new Error(`revoke missing expected fail, got ${r3.summary.statusHint}`);
    }

    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    const outNa = join(root, "out-na");
    mkdirSync(join(outNa, "imports", "high-priv-agent-review"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "high-priv-agent-review", "na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highPrivilegeAgentIdentitiesPresent: false,
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

    // Bare "revoke" / access-review mention must not override N/A + coverage → PASS.
    const weak = join(root, "weak");
    mkdirSync(join(weak, "docs"), { recursive: true });
    writeFileSync(
      join(weak, "docs", "ops.md"),
      "Remember to revoke unused tokens after the access review.\n",
      "utf8",
    );
    const outWeak = join(root, "out-weak-na");
    mkdirSync(join(outWeak, "imports", "high-priv-agent-review"), {
      recursive: true,
    });
    writeFileSync(
      join(outWeak, "imports", "high-priv-agent-review", "na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        highPrivilegeAgentIdentitiesPresent: false,
      }),
      "utf8",
    );
    writeFileSync(
      join(outWeak, "imports", "high-priv-agent-review", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        everyHighPrivilegeAgentReviewedWithin90Days: true,
        revokeOrScopeReductionInLastTwoCyclesOrAttestedNoneWarranted: true,
      }),
      "utf8",
    );
    dirs.push(outWeak);
    const rWeak = await run(weak, outWeak);
    if (rWeak.summary.statusHint !== "not_applicable") {
      throw new Error(
        `weak revoke/review must not override N/A / PASS: ${JSON.stringify(rWeak.summary)}`,
      );
    }

    console.log("aprf-auditor high-priv-agent-review smoke OK");
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
