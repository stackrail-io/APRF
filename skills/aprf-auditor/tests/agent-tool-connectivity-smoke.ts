/**
 * Smoke: agent-tool-connectivity needs deps + controls + match + unauthorized deny probe.
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
  agentToolConnectivityCollector,
  type AgentToolConnectivityReport,
} from "../collectors/agent-tool-connectivity.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<AgentToolConnectivityReport> {
  await agentToolConnectivityCollector.collect({
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
        "agent-tool-connectivity",
        "agent-tool-connectivity-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inf-m3-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "infra"), { recursive: true });
    writeFileSync(
      join(t1, "infra", "network-policy.yaml"),
      "kind: NetworkPolicy\negress_allowlist for agent_runtime\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.infM3Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "dependencies.md"),
      "dependency_inventory required_dependencies for agent_tool\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "agent-tool-connectivity"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "agent-tool-connectivity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentOrToolRuntimesPresent: true,
        dependencyInventoryDocumented: true,
        leastPrivilegeConnectivityControlsConfigured: true,
        connectivityControlsMatchDependencyInventory: true,
        unauthorizedInternalServiceAccessBlockedInProbe: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.infM3Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "tests"), { recursive: true });
    writeFileSync(
      join(t3, "tests", "connectivity-probe.md"),
      "connectivity_probe unauthorized_internal_deny service_mesh\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "agent-tool-connectivity"), {
      recursive: true,
    });
    writeFileSync(
      join(out3, "imports", "agent-tool-connectivity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        dependencyInventoryDocumented: true,
        leastPrivilegeConnectivityControlsConfigured: true,
        connectivityControlsMatchDependencyInventory: true,
        unauthorizedInternalServiceAccessBlockedInProbe: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.infM3Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "agent-tool-connectivity"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "agent-tool-connectivity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        agentOrToolRuntimesPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // Controls alone + perfect metrics without inventory/present → PARTIAL.
    const tControlsOnly = join(root, "t-controls-only");
    mkdirSync(join(tControlsOnly, "infra"), { recursive: true });
    writeFileSync(
      join(tControlsOnly, "infra", "network-policy.yaml"),
      "kind: NetworkPolicy\negress_allowlist\n",
    );
    const outControlsOnly = join(root, "o-controls-only");
    mkdirSync(join(outControlsOnly, "imports", "agent-tool-connectivity"), {
      recursive: true,
    });
    writeFileSync(
      join(outControlsOnly, "imports", "agent-tool-connectivity", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        dependencyInventoryDocumented: true,
        leastPrivilegeConnectivityControlsConfigured: true,
        connectivityControlsMatchDependencyInventory: true,
        unauthorizedInternalServiceAccessBlockedInProbe: true,
      }),
    );
    const rControlsOnly = await run(tControlsOnly, outControlsOnly);
    if (rControlsOnly.summary.statusHint !== "partial") {
      throw new Error(
        `controls-only without inventory expected partial: ${JSON.stringify(rControlsOnly.summary)}`,
      );
    }

    console.log("aprf-auditor agent-tool-connectivity smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
