/**
 * Smoke: ai-admin-mfa needs 100% MFA + bounded monitored break-glass.
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
  aiAdminMfaCollector,
  type AiAdminMfaReport,
} from "../collectors/ai-admin-mfa.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AiAdminMfaReport> {
  await aiAdminMfaCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "ai-admin-mfa", "ai-admin-mfa-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authn-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "mfa-policy.md"),
      "idp_policy requires mfa multi_factor for ai_control_plane_admin roles\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.authnM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "security"), { recursive: true });
    writeFileSync(
      join(t2, "security", "break-glass.md"),
      "break_glass emergency_access inventory with monitor alert siem\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "ai-admin-mfa"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "ai-admin-mfa", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiControlPlaneAdminRolesMfaEnforcedPct: 100,
        breakGlassAccountCount: 2,
        documentedBreakGlassMaximum: 3,
        breakGlassMonitoringEnabled: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authnM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "ai-admin-mfa"), { recursive: true });
    writeFileSync(
      join(outFail, "imports", "ai-admin-mfa", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiControlPlaneAdminRolesMfaEnforcedPct: 80,
        breakGlassAccountCount: 2,
        documentedBreakGlassMaximum: 3,
        breakGlassMonitoringEnabled: true,
      }),
    );
    const rFail = await run(t2, outFail);
    if (
      rFail.summary.statusHint !== "fail" ||
      rFail.summary.authnM3Satisfied !== false
    ) {
      throw new Error(`fail expected: ${JSON.stringify(rFail.summary)}`);
    }

    // Attested monitoring=false must FAIL even when in-repo monitoring docs exist
    const outMonFalse = join(root, "o-mon-false");
    mkdirSync(join(outMonFalse, "imports", "ai-admin-mfa"), {
      recursive: true,
    });
    writeFileSync(
      join(outMonFalse, "imports", "ai-admin-mfa", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiControlPlaneAdminRolesMfaEnforcedPct: 100,
        breakGlassAccountCount: 2,
        documentedBreakGlassMaximum: 3,
        breakGlassMonitoringEnabled: false,
      }),
    );
    const rMonFalse = await run(t2, outMonFalse);
    if (
      rMonFalse.summary.statusHint !== "fail" ||
      rMonFalse.summary.authnM3Satisfied !== false
    ) {
      throw new Error(
        `monitoring=false must fail despite repo docs: ${JSON.stringify(rMonFalse.summary)}`,
      );
    }

    // present=false must not N/A when in-repo MFA/break-glass signals exist
    const outNaSignals = join(root, "ona-signals");
    mkdirSync(join(outNaSignals, "imports", "ai-admin-mfa"), {
      recursive: true,
    });
    writeFileSync(
      join(outNaSignals, "imports", "ai-admin-mfa", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiControlPlaneAdminAccessPresent: false,
        aiControlPlaneAdminRolesMfaEnforcedPct: 100,
        breakGlassAccountCount: 2,
        documentedBreakGlassMaximum: 3,
        breakGlassMonitoringEnabled: true,
      }),
    );
    const rNaSignals = await run(t2, outNaSignals);
    if (rNaSignals.summary.statusHint === "not_applicable") {
      throw new Error(
        `in-repo signals must override present=false N/A: ${JSON.stringify(rNaSignals.summary)}`,
      );
    }
    if (
      rNaSignals.summary.statusHint !== "pass" ||
      rNaSignals.summary.authnM3Satisfied !== true
    ) {
      throw new Error(
        `present=false + signals + metrics should pass: ${JSON.stringify(rNaSignals.summary)}`,
      );
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "ai-admin-mfa"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "ai-admin-mfa", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        aiControlPlaneAdminAccessPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    console.log("ai-admin-mfa smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
