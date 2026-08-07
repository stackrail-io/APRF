/**
 * Smoke: agent-charter-inventory / AGN-M1.
 * Covers plugin whenUnavailable predicates: import PASS gates, completeness
 * evidence variants, structured approval, lifecycle, exceptions ≤90d, scope N/A,
 * severity escalation, and FAIL/PARTIAL paths.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentCharterInventoryCollector,
  type AgentCharterInventoryReport,
} from "../collectors/agent-charter-inventory.ts";
import type { CollectorContext } from "../collectors/types.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function daysFrom(baseIso: string, days: number): string {
  const t = Date.parse(baseIso);
  return new Date(t + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function readReport(outDir: string): AgentCharterInventoryReport {
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "agent-charter-inventory",
        "agent-charter-inventory-report.json",
      ),
      "utf8",
    ),
  ) as AgentCharterInventoryReport;
}

function writeImport(
  outDir: string,
  payload: Record<string, unknown>,
  name = "inventory.json",
): void {
  mkdirSync(join(outDir, "imports", "agent-charter-inventory"), {
    recursive: true,
  });
  writeFileSync(
    join(outDir, "imports", "agent-charter-inventory", name),
    JSON.stringify(payload),
    "utf8",
  );
}

function fullAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "support-agent",
    environment: "prod",
    system: "customer-support",
    application: "support-triage",
    lifecycleStatus: "Active",
    purpose: "Resolve tickets",
    allowedTools: ["search_kb"],
    forbiddenTools: ["shell"],
    dataScope: "support_corpus",
    autonomy: { maxSteps: 20, wallClockSeconds: 60, spawnDepth: 0 },
    owner: "engineering",
    approval: {
      approvedBy: "platform-governance",
      approvalDate: "2026-07-01",
      approvalStatus: "approved",
    },
    changeJustification: "Initial production charter",
    identityPolicy: "workload identity",
    loggingPolicy: "retain 90d",
    memoryPolicy: "session only",
    networkPolicy: "internal only",
    reviewDate: "2026-07-01",
    lastUpdated: "2026-07-10T09:00:00Z",
    expiryDate: "2027-07-01",
    agentVersion: 1,
    ...overrides,
  };
}

async function collect(
  base: CollectorContext,
  targetPath: string,
  outputDir: string,
): Promise<AgentCharterInventoryReport> {
  await agentCharterInventoryCollector.collect({
    ...base,
    targetPath,
    outputDir,
  });
  return readReport(outputDir);
}

function seedInventoryRepo(targetDir: string): void {
  mkdirSync(join(targetDir, "agents"), { recursive: true });
  writeFileSync(
    join(targetDir, "agents", "inventory.yaml"),
    `
agents:
  - id: support-agent
    purpose: Resolve customer support tickets
    tool_allowlist: [search_kb, create_ticket]
    data_scope: support_corpus_v2
    autonomy_limits: { max_steps: 20, spawn_depth: 0 }
    owner: platform-oncall
    environment: prod
    lifecycleStatus: Active
`,
    "utf8",
  );
  writeFileSync(
    join(targetDir, "agents", "charter.md"),
    `# Support agent charter
purpose: help customers
tool allowlist: search_kb
data scope: tenant support docs
autonomy limits: max_steps 20
owner: platform-oncall
environment: prod
lifecycleStatus: Active
changeJustification: initial
approval:
  approvedBy: gov
  approvalDate: 2026-07-01
  approvalStatus: approved
`,
    "utf8",
  );
}

async function main() {
  const targetDir = tmp("aprf-agn1-t-");
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: tmp("aprf-agn1-o-"),
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  // --- Empty repo → N/A + catalog scope lists ---
  {
    const r = await collect(baseCtx, targetDir, baseCtx.outputDir);
    assert(
      r.summary.statusHint === "not_applicable" && r.summary.inScope === false,
      `empty: expected N/A, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      (r.summary.appliesTo?.length ?? 0) > 0 &&
        (r.summary.notApplicableTo?.length ?? 0) > 0,
      "empty: expected appliesTo/notApplicableTo from AGN-M1 catalog",
    );
    assert(
      r.summary.naReason && /production agent/i.test(r.summary.naReason),
      `empty: expected naReason, got ${r.summary.naReason}`,
    );
    assert(
      r.schemaVersion === "0.4.0",
      `expected schemaVersion 0.4.0, got ${r.schemaVersion}`,
    );
  }

  seedInventoryRepo(targetDir);

  // --- Repo inventory/charter only → PARTIAL (plugin: cannot PASS alone) ---
  {
    const out = tmp("aprf-agn1-partial-");
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "partial" && r.summary.inventoryPresent,
      `repo-only: expected partial, got ${JSON.stringify(r.summary)}`,
    );
    assert(
      r.gapNotes?.some((n) => /complete=true/i.test(n)),
      `repo-only: expected complete=true gap, got ${JSON.stringify(r.gapNotes)}`,
    );
    assert(
      r.summary.severityHint === "critical",
      `repo-only: expected critical (completeness unproven), got ${r.summary.severityHint}`,
    );
  }

  // --- PASS: coversAllProductionAgents + structured approval ---
  {
    const out = tmp("aprf-agn1-pass-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      completenessEvidence: "approved-attestation",
      agents: [fullAgent()],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "pass" &&
        r.summary.agnM1Satisfied === true &&
        r.summary.completenessProven === true &&
        r.summary.severityHint === "high",
      `pass coversAll: got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- PASS: each completenessEvidence value (plugin whenUnavailable list) ---
  for (const evidence of [
    "runtime-registry",
    "deployment-manifest",
    "cmdb",
    "platform-registry",
    "approved-attestation",
  ] as const) {
    const out = tmp(`aprf-agn1-ev-${evidence}-`);
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      completenessEvidence: evidence,
      agents: [fullAgent({ id: `agent-${evidence}` })],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "pass",
      `completenessEvidence=${evidence}: expected pass, got ${r.summary.statusHint}`,
    );
  }

  // --- PASS: camelCase completenessEvidence ---
  {
    const out = tmp("aprf-agn1-camel-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      completenessEvidence: "runtimeRegistry",
      agents: [fullAgent({ id: "camel-agent" })],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "pass" &&
        r.importedResults.completenessEvidence === "runtime-registry",
      `camelCase evidence: got ${JSON.stringify(r.summary)} / ${r.importedResults.completenessEvidence}`,
    );
  }

  // --- PASS: revisionHistory instead of changeJustification ---
  {
    const out = tmp("aprf-agn1-revhist-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          changeJustification: undefined,
          revisionHistory: [
            {
              date: "2026-07-01",
              author: "gov",
              summary: "Initial charter",
            },
          ],
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "pass",
      `revisionHistory: expected pass, got ${r.summary.statusHint}`,
    );
  }

  // --- PASS: flat approval fields (not nested) ---
  {
    const out = tmp("aprf-agn1-flat-appr-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          approval: undefined,
          approvedBy: "platform-governance",
          approvalDate: "2026-07-01",
          approvalStatus: "approved",
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "pass",
      `flat approval: expected pass, got ${r.summary.statusHint}`,
    );
  }

  // --- PASS: valid exception within 90d ---
  {
    const out = tmp("aprf-agn1-ex-ok-");
    const measuredAt = new Date().toISOString();
    writeImport(out, {
      measuredAt,
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          exceptions: [
            {
              justification: "temporary shell for incident",
              approver: "platform-governance",
              expiry: daysFrom(measuredAt, 30),
              compensatingControls: "dual control + audit",
            },
          ],
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "pass",
      `valid exception: expected pass, got ${r.summary.statusHint}`,
    );
  }

  // --- PARTIAL + critical: completeness unproven ---
  {
    const out = tmp("aprf-agn1-nocomp-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: false,
      agents: [fullAgent({ id: "orphan-agent" })],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "partial" &&
        r.summary.severityHint === "critical" &&
        r.summary.completenessProven === false,
      `incomplete coverage: got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- PARTIAL: stale measuredAt (>90d) ---
  {
    const out = tmp("aprf-agn1-stale-");
    writeImport(out, {
      measuredAt: daysAgo(120),
      coversAllProductionAgents: true,
      agents: [fullAgent({ id: "stale-agent" })],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "partial",
      `stale measuredAt: expected partial, got ${r.summary.statusHint}`,
    );
    assert(
      r.gapNotes?.some((n) => /measuredAt/i.test(n)),
      `stale measuredAt: expected measuredAt gap, got ${JSON.stringify(r.gapNotes)}`,
    );
  }

  // --- FAIL: string approvalPolicy alone (importer break) ---
  {
    const out = tmp("aprf-agn1-appr-str-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          approval: undefined,
          approvalPolicy: "approved",
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `approvalPolicy string: expected fail, got ${r.summary.statusHint}`,
    );
  }

  // --- FAIL: missing lifecycleStatus (generic status ignored) ---
  {
    const out = tmp("aprf-agn1-status-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          lifecycleStatus: undefined,
          status: "Active",
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `status≠lifecycle: expected fail, got ${r.summary.statusHint}`,
    );
  }

  // --- FAIL: missing production identifier ---
  {
    const out = tmp("aprf-agn1-noid-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          environment: undefined,
          system: undefined,
          application: undefined,
          deploymentId: undefined,
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `no production id: expected fail, got ${r.summary.statusHint}`,
    );
  }

  // --- FAIL: missing change control ---
  {
    const out = tmp("aprf-agn1-nochg-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          changeJustification: undefined,
          revisionHistory: undefined,
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `no change control: expected fail, got ${r.summary.statusHint}`,
    );
  }

  // --- FAIL: missing owner → critical ---
  {
    const out = tmp("aprf-agn1-noowner-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [fullAgent({ owner: undefined, owned_by: undefined, team: "" })],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `no owner: expected fail, got ${r.summary.statusHint}`,
    );
    assert(
      r.summary.severityHint === "critical",
      `no owner: expected critical, got ${r.summary.severityHint}`,
    );
    assert(
      (r.importedResults.missingOwnerCount ?? 0) > 0,
      "no owner: expected missingOwnerCount > 0",
    );
  }

  // --- FAIL: exception expiry >90d ---
  {
    const out = tmp("aprf-agn1-ex-far-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          exceptions: [
            {
              justification: "temporary shell",
              approver: "platform-governance",
              expiry: "2099-01-01",
              compensatingControls: "dual control",
            },
          ],
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `exception >90d: expected fail, got ${r.summary.statusHint}`,
    );
  }

  // --- FAIL: exception missing compensatingControls ---
  {
    const out = tmp("aprf-agn1-ex-ncc-");
    const measuredAt = new Date().toISOString();
    writeImport(out, {
      measuredAt,
      coversAllProductionAgents: true,
      agents: [
        fullAgent({
          exceptions: [
            {
              justification: "temporary shell",
              approver: "platform-governance",
              expiry: daysFrom(measuredAt, 14),
            },
          ],
        }),
      ],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "fail",
      `exception missing compensatingControls: expected fail, got ${r.summary.statusHint}`,
    );
  }

  // --- Empty agents[] must not PASS (plugin: agentCount ≥ 1) ---
  {
    const out = tmp("aprf-agn1-empty-agents-");
    writeImport(out, {
      measuredAt: new Date().toISOString(),
      coversAllProductionAgents: true,
      complete: true,
      agents: [],
    });
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint !== "pass",
      "empty agents[] must not unlock PASS",
    );
  }

  // --- N/A: productionAgentsPresent=false ---
  {
    const out = tmp("aprf-agn1-na-import-");
    writeImport(
      out,
      {
        measuredAt: new Date().toISOString(),
        productionAgentsPresent: false,
      },
      "scope.json",
    );
    const r = await collect(baseCtx, targetDir, out);
    assert(
      r.summary.statusHint === "not_applicable" &&
        r.summary.inScope === false &&
        /productionAgentsPresent=false/i.test(r.summary.naReason ?? ""),
      `import N/A: got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- N/A: terraform-only (plugin: frameworks/infra alone) ---
  {
    const tfTarget = tmp("aprf-agn1-tf-");
    mkdirSync(join(tfTarget, "infra"), { recursive: true });
    writeFileSync(
      join(tfTarget, "infra", "main.tf"),
      'resource "null_resource" "x" {}\n',
    );
    const r = await collect(baseCtx, tfTarget, tmp("aprf-agn1-tf-o-"));
    assert(
      r.summary.statusHint === "not_applicable" && r.summary.inScope === false,
      `terraform-only: got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- N/A: framework-only SDK repo (langgraph, no inventory) ---
  {
    const fw = tmp("aprf-agn1-fw-");
    mkdirSync(join(fw, "langgraph"), { recursive: true });
    writeFileSync(
      join(fw, "langgraph", "README.md"),
      "# LangGraph\nPython agent framework SDK for building graphs.\n",
    );
    writeFileSync(
      join(fw, "pyproject.toml"),
      '[project]\nname = "langgraph"\nversion = "0.1.0"\n',
    );
    const r = await collect(baseCtx, fw, tmp("aprf-agn1-fw-o-"));
    assert(
      r.summary.statusHint === "not_applicable" && r.summary.inScope === false,
      `framework-only: got ${JSON.stringify(r.summary)}`,
    );
  }

  // --- NOT_DEMONSTRATED: agent code signals, no inventory/charter ---
  {
    const codeOnly = tmp("aprf-agn1-code-");
    mkdirSync(join(codeOnly, "src"), { recursive: true });
    writeFileSync(
      join(codeOnly, "src", "runner.ts"),
      `export function run() {
  const agent = create_react_agent({ tools: [] });
  return AgentExecutor.fromAgentAndTools(agent, []);
}
`,
    );
    const r = await collect(baseCtx, codeOnly, tmp("aprf-agn1-code-o-"));
    assert(
      r.summary.statusHint === "not_demonstrated",
      `code-only: expected not_demonstrated, got ${r.summary.statusHint}`,
    );
    assert(
      r.summary.severityHint === "critical",
      `code-only: expected critical, got ${r.summary.severityHint}`,
    );
  }

  console.log("agent-charter-inventory smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
