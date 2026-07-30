/**
 * Smoke: a2a-peer-auth needs handoff + auth/scope + 100% deny suite for PASS.
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
  a2aPeerAuthCollector,
  type A2aPeerAuthReport,
} from "../collectors/a2a-peer-auth.ts";
import type { CollectorContext } from "../collectors/types.ts";

function readReport(outDir: string): A2aPeerAuthReport {
  return JSON.parse(
    readFileSync(
      join(outDir, "imports", "a2a-peer-auth", "a2a-peer-auth-report.json"),
      "utf8",
    ),
  ) as A2aPeerAuthReport;
}

async function main() {
  const targetDir = mkdtempSync(join(tmpdir(), "aprf-agn4-t-"));
  const outEmpty = mkdtempSync(join(tmpdir(), "aprf-agn4-o-"));
  const baseCtx: CollectorContext = {
    targetPath: targetDir,
    outputDir: outEmpty,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  };

  await a2aPeerAuthCollector.collect(baseCtx);
  const r0 = readReport(outEmpty);
  if (r0.summary.statusHint !== "not_applicable") {
    throw new Error(`expected not_applicable, got ${r0.summary.statusHint}`);
  }

  mkdirSync(join(targetDir, "a2a"), { recursive: true });
  writeFileSync(
    join(targetDir, "a2a", "handoff.yaml"),
    `
a2a:
  peer_auth: mutual_tls
  capability_token:
    scope: [tools.read, data.tenant]
    least_privilege: true
`,
    "utf8",
  );
  mkdirSync(join(targetDir, "tests"), { recursive: true });
  writeFileSync(
    join(targetDir, "tests", "test_a2a_negative.py"),
    `
def test_unauthenticated_a2a_handoff_denied():
    assert deny(unauthenticated_peer())

def test_forged_peer_denied():
    assert deny(forged_identity())

def test_over_scoped_capability_denied():
    assert deny(over_scoped_token())
`,
    "utf8",
  );

  const out1 = mkdtempSync(join(tmpdir(), "aprf-agn4-1-"));
  await a2aPeerAuthCollector.collect({ ...baseCtx, outputDir: out1 });
  const r1 = readReport(out1);
  if (r1.summary.statusHint !== "partial" || !r1.summary.multiAgentPresent) {
    throw new Error(`expected partial, got ${JSON.stringify(r1.summary)}`);
  }

  const out2 = mkdtempSync(join(tmpdir(), "aprf-agn4-2-"));
  mkdirSync(join(out2, "imports", "a2a-peer-auth"), { recursive: true });
  writeFileSync(
    join(out2, "imports", "a2a-peer-auth", "suite.json"),
    JSON.stringify({
      measuredAt: new Date().toISOString(),
      cases: [
        { kind: "unauth", denied: true },
        { kind: "forge", denied: true },
        { kind: "scope", denied: true },
      ],
      denyRatePct: 100,
    }),
    "utf8",
  );
  await a2aPeerAuthCollector.collect({ ...baseCtx, outputDir: out2 });
  const r2 = readReport(out2);
  if (r2.summary.statusHint !== "pass" || r2.summary.agnM4Satisfied !== true) {
    throw new Error(`expected pass, got ${JSON.stringify(r2.summary)}`);
  }

  console.log("a2a-peer-auth smoke OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
