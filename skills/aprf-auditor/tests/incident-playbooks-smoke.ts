/**
 * Smoke: incident-playbooks needs four scenarios + owners + reviews ≤12m for PASS.
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
  incidentPlaybooksCollector,
  type IncidentPlaybooksReport,
} from "../collectors/incident-playbooks.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<IncidentPlaybooksReport> {
  await incidentPlaybooksCollector.collect({
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
        "incident-playbooks",
        "incident-playbooks-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-inc-m1-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs", "incidents"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "incidents", "abuse-playbook.md"),
      "# Abuse playbook\nRespond to prompt injection and misuse.\n",
    );
    writeFileSync(
      join(t1, "docs", "incidents", "leakage-runbook.md"),
      "# Leakage runbook\nContain PII exposure and data exfil.\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.incM1Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "docs", "incidents"), { recursive: true });
    writeFileSync(
      join(t2, "docs", "incidents", "ai-incidents.md"),
      [
        "# AI incident playbooks",
        "Owner: sre-ai@example.com",
        "Last review date: 2026-01-15",
        "## Abuse / prompt injection",
        "## Leakage / PII exposure",
        "## Bad actions / unsafe tool misuse",
        "## Provider outage / LLM API outage",
      ].join("\n"),
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "incident-playbooks"), { recursive: true });
    writeFileSync(
      join(out2, "imports", "incident-playbooks", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fourPlaybooksPresent: true,
        allPlaybooksHaveOwner: true,
        allPlaybooksReviewedWithin12Months: true,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.incM1Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const t3 = join(root, "t3");
    mkdirSync(join(t3, "docs"), { recursive: true });
    writeFileSync(
      join(t3, "docs", "provider-outage-playbook.md"),
      "Provider outage playbook for model API outage\n",
    );
    const out3 = join(root, "o3");
    mkdirSync(join(out3, "imports", "incident-playbooks"), { recursive: true });
    writeFileSync(
      join(out3, "imports", "incident-playbooks", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        fourPlaybooksPresent: true,
        allPlaybooksHaveOwner: true,
        allPlaybooksReviewedWithin12Months: false,
      }),
    );
    const r3 = await run(t3, out3);
    if (r3.summary.statusHint !== "fail" || r3.summary.incM1Satisfied !== false) {
      throw new Error(`fail expected: ${JSON.stringify(r3.summary)}`);
    }

    console.log("incident-playbooks smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
