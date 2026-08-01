/**
 * Smoke: injection-policy-gate needs policy + corpus/gate + ≥95% deny for PASS.
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
  injectionPolicyGateCollector,
  type InjectionPolicyReport,
} from "../collectors/injection-policy-gate.ts";
import type { CollectorContext } from "../collectors/types.ts";

const outDir = mkdtempSync(join(tmpdir(), "aprf-inj-"));
const targetDir = mkdtempSync(join(tmpdir(), "aprf-inj-target-"));

async function main() {
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  const empty = await injectionPolicyGateCollector.collect(baseCtx);
  if (empty.status !== "ran") throw new Error(`expected ran: ${empty.status}`);
  const r0 = JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "injection-policy-gate",
        "injection-policy-gate-report.json",
      ),
      "utf8",
    ),
  ) as InjectionPolicyReport;
  if (r0.summary.statusHint !== "not_demonstrated") {
    throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "policy"), { recursive: true });
  writeFileSync(
    join(targetDir, "policy", "tool_policy.py"),
    `
def authorize_tool(user, tool_name):
    """server-side policy — never trust model text alone for privileged tool calls"""
    return has_permission(user, f"tool.{tool_name}")
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-inj1-"));
  await injectionPolicyGateCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = JSON.parse(
    readFileSync(
      join(
        out1,
        "imports",
        "injection-policy-gate",
        "injection-policy-gate-report.json",
      ),
      "utf8",
    ),
  ) as InjectionPolicyReport;
  if (r1.summary.statusHint !== "partial" || !r1.summary.policyPresent) {
    throw new Error(`expected partial with policy, got ${JSON.stringify(r1.summary)}`);
  }

  // Fail: low deny rate
  const out2 = mkdtempSync(join(tmpdir(), "aprf-inj2-"));
  mkdirSync(join(out2, "imports", "injection-policy-gate"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "injection-policy-gate", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      denyRatePct: 80,
      modelTextPrivilegeGrants: 0,
      caseCount: 20,
    }),
    "utf8",
  );
  await injectionPolicyGateCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = JSON.parse(
    readFileSync(
      join(
        out2,
        "imports",
        "injection-policy-gate",
        "injection-policy-gate-report.json",
      ),
      "utf8",
    ),
  ) as InjectionPolicyReport;
  if (r2.summary.statusHint !== "fail") {
    throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
  }

  // Pass
  const out3 = mkdtempSync(join(tmpdir(), "aprf-inj3-"));
  mkdirSync(join(out3, "imports", "injection-policy-gate"), { recursive: true });
  writeFileSync(
    join(out3, "imports", "injection-policy-gate", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      denyRatePct: 97,
      modelTextPrivilegeGrants: 0,
      cases: Array.from({ length: 20 }, (_, i) => ({
        id: `c${i}`,
        result: "denied",
      })),
    }),
    "utf8",
  );
  await injectionPolicyGateCollector.collect({ ...baseCtx, outputDir: out3 });
  const r3 = JSON.parse(
    readFileSync(
      join(
        out3,
        "imports",
        "injection-policy-gate",
        "injection-policy-gate-report.json",
      ),
      "utf8",
    ),
  ) as InjectionPolicyReport;
  if (r3.summary.secM1Satisfied !== true || r3.summary.statusHint !== "pass") {
    throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
  }

  console.log("aprf-auditor injection-policy-gate smoke OK");
  for (const d of [outDir, out1, out2, out3, targetDir]) {
    rmSync(d, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
