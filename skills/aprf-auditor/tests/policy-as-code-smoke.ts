/**
 * Smoke: policy-as-code needs rules-as-code + CI/admission + ≤90d deny evidence.
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
  policyAsCodeCollector,
  type PolicyAsCodeReport,
} from "../collectors/policy-as-code.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<PolicyAsCodeReport> {
  await policyAsCodeCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    gitCommit: undefined,
    live: false,
    maxFiles: 2000,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "policy-as-code", "policy-as-code-report.json"),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authz-r1-"));
  const dirs: string[] = [root];

  try {
    const target = join(root, "target");
    mkdirSync(join(target, "policies"), { recursive: true });
    writeFileSync(
      join(target, "policies", "tool_access.rego"),
      "package tool.access\n# OPA policy-as-code for tool_access allow/deny\n",
      "utf8",
    );
    writeFileSync(
      join(target, "policies", "ci-policy-check.yml"),
      "name: policy-check\n# conftest / opa-test admission gate\n",
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
    mkdirSync(join(out2, "imports", "policy-as-code"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "policy-as-code", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrModelAccessControlPresent: true,
        toolAndModelAccessRulesAsCode: true,
        ciOrAdmissionEnforcementPresent: true,
        lastFailingToPassingPolicyChangeShowsDenyWithin90Days: true,
      }),
      "utf8",
    );
    dirs.push(out2);
    const r2 = await run(target, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authzR1Satisfied !== true) {
      throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
    }

    const out3 = join(root, "out3");
    mkdirSync(join(out3, "imports", "policy-as-code"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "policy-as-code", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolAndModelAccessRulesAsCode: true,
        ciOrAdmissionEnforcementPresent: true,
        lastFailingToPassingPolicyChangeShowsDenyWithin90Days: false,
      }),
      "utf8",
    );
    dirs.push(out3);
    const r3 = await run(target, out3);
    if (r3.summary.statusHint !== "fail") {
      throw new Error(`deny missing expected fail, got ${r3.summary.statusHint}`);
    }

    const empty = join(root, "empty");
    mkdirSync(empty, { recursive: true });
    const outNa = join(root, "out-na");
    mkdirSync(join(outNa, "imports", "policy-as-code"), { recursive: true });
    writeFileSync(
      join(outNa, "imports", "policy-as-code", "na.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolOrModelAccessControlPresent: false,
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

    console.log("aprf-auditor policy-as-code smoke OK");
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
