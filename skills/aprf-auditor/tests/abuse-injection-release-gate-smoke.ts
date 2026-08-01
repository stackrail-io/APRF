/**
 * Smoke: abuse-injection-release-gate needs suite + 100% coverage + blocking/waivers.
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
  abuseInjectionReleaseGateCollector,
  type AbuseInjectionReleaseGateReport,
} from "../collectors/abuse-injection-release-gate.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AbuseInjectionReleaseGateReport> {
  await abuseInjectionReleaseGateCollector.collect({
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
        "abuse-injection-release-gate",
        "abuse-injection-release-gate-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "evals"), { recursive: true });
    writeFileSync(
      join(t1, "evals", "prompt-injection-suite.yml"),
      "prompt_injection_suite with jailbreak_case and abuse_fixture\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.secM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(t2, ".github", "workflows", "security-gate.yml"),
      "adversarial_security_ci_gate block_deploy required_check waiver expiry\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "abuse-injection-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "abuse-injection-release-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        abuseJailbreakInjectionSuiteConfigured: true,
        productionReleasesWithSecuritySuiteGatePassPct: 100,
        coverageWindowDays: 30,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.secM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    // Aggregate 100% without a 30-day window stays partial
    const outNoWindow = join(root, "o-no-window");
    mkdirSync(join(outNoWindow, "imports", "abuse-injection-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outNoWindow,
        "imports",
        "abuse-injection-release-gate",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        abuseJailbreakInjectionSuiteConfigured: true,
        productionReleasesWithSecuritySuiteGatePassPct: 100,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: true,
      }),
    );
    const rNoWindow = await run(t2, outNoWindow);
    if (rNoWindow.summary.statusHint !== "partial") {
      throw new Error(
        `partial expected without window: ${JSON.stringify(rNoWindow.summary)}`,
      );
    }

    // releases[] in last 30 days unlocks PASS (and sets window)
    const outReleases = join(root, "o-releases");
    mkdirSync(join(outReleases, "imports", "abuse-injection-release-gate"), {
      recursive: true,
    });
    const now = Date.now();
    writeFileSync(
      join(
        outReleases,
        "imports",
        "abuse-injection-release-gate",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date(now).toISOString(),
        abuseJailbreakInjectionSuiteConfigured: true,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: true,
        releases: [
          {
            releasedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
            gate: "pass",
          },
          {
            releasedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
            gatePass: false,
            waiver: { owner: "sec-oncall", expiryDays: 14 },
          },
        ],
      }),
    );
    const rReleases = await run(t2, outReleases);
    if (
      rReleases.summary.statusHint !== "pass" ||
      rReleases.summary.secM3Satisfied !== true
    ) {
      throw new Error(
        `pass expected from releases[]: ${JSON.stringify(rReleases.summary)}`,
      );
    }

    // Invalid waiver expiry >30d → fail
    const outBadWaiver = join(root, "o-bad-waiver");
    mkdirSync(join(outBadWaiver, "imports", "abuse-injection-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outBadWaiver,
        "imports",
        "abuse-injection-release-gate",
        "coverage.json",
      ),
      JSON.stringify({
        measuredAt: new Date(now).toISOString(),
        abuseJailbreakInjectionSuiteConfigured: true,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: true,
        releases: [
          {
            releasedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
            gate: "fail",
            waiver: { owner: "sec-oncall", expiryDays: 90 },
          },
        ],
      }),
    );
    const rBadWaiver = await run(t2, outBadWaiver);
    if (
      rBadWaiver.summary.statusHint !== "fail" ||
      rBadWaiver.summary.secM3Satisfied !== false
    ) {
      throw new Error(
        `fail expected for bad waiver: ${JSON.stringify(rBadWaiver.summary)}`,
      );
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "jailbreak-eval.md"),
      "jailbreak_eval injection_case optional job\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "abuse-injection-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "abuse-injection-release-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        abuseJailbreakInjectionSuiteConfigured: true,
        productionReleasesWithSecuritySuiteGatePassPct: 70,
        failingGateBlocksPromoteUnlessOwnedWaiverExpiry30d: true,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.secM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "abuse-injection-release-gate"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "abuse-injection-release-gate", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        customerFacingAiReleasesPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    console.log("abuse-injection-release-gate smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
