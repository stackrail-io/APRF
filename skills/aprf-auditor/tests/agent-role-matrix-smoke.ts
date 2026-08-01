/**
 * Smoke: agent-role-matrix needs 100% non-admin matrix + ≤90d review + 0 escalations.
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
  agentRoleMatrixCollector,
  type AgentRoleMatrixReport,
} from "../collectors/agent-role-matrix.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AgentRoleMatrixReport> {
  await agentRoleMatrixCollector.collect({
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
        "agent-role-matrix",
        "agent-role-matrix-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authz-m3-"));
  const dirs: string[] = [root];

  try {
    // Signals only → partial
    const target = join(root, "target");
    mkdirSync(join(target, "docs"), { recursive: true });
    writeFileSync(
      join(target, "docs", "agent-roles.md"),
      "# Agent role matrix\nLeast-privilege non-admin defaults for agent_identity service accounts.\n",
      "utf8",
    );
    const out1 = join(root, "out1");
    mkdirSync(out1, { recursive: true });
    dirs.push(out1);
    const r1 = await run(target, out1);
    if (r1.summary.statusHint !== "partial") {
      throw new Error(`signals-only expected partial, got ${r1.summary.statusHint}`);
    }
    if (r1.summary.authzM3Satisfied !== false) {
      throw new Error(`signals-only expected satisfied=false`);
    }

    // Complete import → pass
    const out2 = join(root, "out2");
    mkdirSync(join(out2, "imports", "agent-role-matrix"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "agent-role-matrix", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentOrAutomationIdentitiesPresent: true,
        identitiesInRoleMatrixWithNonAdminDefaultPct: 100,
        accessReviewWithin90Days: true,
        unexplainedPrivilegeEscalations: 0,
      }),
      "utf8",
    );
    dirs.push(out2);
    const r2 = await run(target, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authzM3Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    // Escalations → fail
    const out3 = join(root, "out3");
    mkdirSync(join(out3, "imports", "agent-role-matrix"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "agent-role-matrix", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identitiesInRoleMatrixWithNonAdminDefaultPct: 100,
        accessReviewWithin90Days: true,
        unexplainedPrivilegeEscalations: 2,
      }),
      "utf8",
    );
    dirs.push(out3);
    const r3 = await run(target, out3);
    if (r3.summary.statusHint !== "fail") {
      throw new Error(`escalations expected fail, got ${r3.summary.statusHint}`);
    }

    // N/A
    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    const outNa = join(root, "out-na");
    mkdirSync(join(outNa, "imports", "agent-role-matrix"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "agent-role-matrix", "na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        productionAgentOrAutomationIdentitiesPresent: false,
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

    // Alias-only import fields must still count as sources (and can PASS).
    const outAlias = join(root, "out-alias");
    mkdirSync(join(outAlias, "imports", "agent-role-matrix"), {
      recursive: true,
    });
    writeFileSync(
      join(outAlias, "imports", "agent-role-matrix", "aliases.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        hasProductionAgentOrAutomationIdentities: true,
        roleMatrixCoveragePct: 100,
        accessReviewAgeDays: 14,
        privilegeEscalationsUnexplained: 0,
      }),
      "utf8",
    );
    dirs.push(outAlias);
    const rAlias = await run(empty, outAlias);
    if (
      rAlias.summary.statusHint !== "pass" ||
      rAlias.summary.authzM3Satisfied !== true
    ) {
      throw new Error(
        `alias import expected pass, got ${JSON.stringify(rAlias.summary)} sources=${rAlias.importedResults.sources.join(",")}`,
      );
    }
    if (!rAlias.importedResults.sources.includes("aliases.json")) {
      throw new Error("alias-only import must appear in sources");
    }

    console.log("aprf-auditor agent-role-matrix smoke OK");
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
