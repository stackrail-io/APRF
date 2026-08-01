/**
 * Smoke: identity-propagation needs design + 100% subject-bound sample + 0 anon hops.
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
  identityPropagationCollector,
  type IdentityPropagationReport,
} from "../collectors/identity-propagation.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<IdentityPropagationReport> {
  await identityPropagationCollector.collect({
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
        "identity-propagation",
        "identity-propagation-report.json",
      ),
      "utf8",
    ),
  );
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-authn-m4-"));
  try {
    const t1 = join(root, "t1");
    mkdirSync(join(t1, "docs"), { recursive: true });
    writeFileSync(
      join(t1, "docs", "identity-propagation.md"),
      "identity_propagation design carries end_user_subject on tool_call hops\n",
    );
    const r1 = await run(t1, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      r1.summary.authnM4Satisfied !== false
    ) {
      throw new Error(`partial expected: ${JSON.stringify(r1.summary)}`);
    }

    const t2 = join(root, "t2");
    mkdirSync(join(t2, "agents"), { recursive: true });
    writeFileSync(
      join(t2, "agents", "tool-chain.md"),
      "agent_chain tool_call privileged_hop with subject binding harness\n",
    );
    const out2 = join(root, "o2");
    mkdirSync(join(out2, "imports", "identity-propagation"), {
      recursive: true,
    });
    writeFileSync(
      join(out2, "imports", "identity-propagation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identityPropagationDesignDocumented: true,
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct: 100,
        anonymousPrivilegedHops: 0,
        sampleSize: 25,
      }),
    );
    const r2 = await run(t2, out2);
    if (r2.summary.statusHint !== "pass" || r2.summary.authnM4Satisfied !== true) {
      throw new Error(`pass expected: ${JSON.stringify(r2.summary)}`);
    }

    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "identity-propagation"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "identity-propagation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identityPropagationDesignDocumented: true,
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct: 100,
        anonymousPrivilegedHops: 2,
        sampleSize: 25,
      }),
    );
    const rFail = await run(t2, outFail);
    if (
      rFail.summary.statusHint !== "fail" ||
      rFail.summary.authnM4Satisfied !== false
    ) {
      throw new Error(`fail expected: ${JSON.stringify(rFail.summary)}`);
    }

    const outSvc = join(root, "o-svc");
    mkdirSync(join(outSvc, "imports", "identity-propagation"), {
      recursive: true,
    });
    writeFileSync(
      join(outSvc, "imports", "identity-propagation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identityPropagationDesignDocumented: true,
        samples: [
          { hasDocumentedServiceSubject: true },
          { hasDocumentedServiceSubject: true, subject: "svc:batch" },
        ],
      }),
    );
    const rSvc = await run(t2, outSvc);
    if (
      rSvc.summary.statusHint !== "pass" ||
      rSvc.summary.authnM4Satisfied !== true ||
      (rSvc.importedResults.anonymousPrivilegedHops ?? 0) !== 0
    ) {
      throw new Error(
        `documented-service samples should pass with 0 anon hops: ${JSON.stringify(rSvc.summary)} anon=${rSvc.importedResults.anonymousPrivilegedHops}`,
      );
    }

    const outMerge = join(root, "o-merge");
    mkdirSync(join(outMerge, "imports", "identity-propagation"), {
      recursive: true,
    });
    writeFileSync(
      join(outMerge, "imports", "identity-propagation", "a-bad.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identityPropagationDesignDocumented: true,
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct: 100,
        anonymousPrivilegedHops: 3,
        sampleSize: 10,
      }),
    );
    writeFileSync(
      join(outMerge, "imports", "identity-propagation", "z-good.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identityPropagationDesignDocumented: true,
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct: 100,
        anonymousPrivilegedHops: 0,
        sampleSize: 10,
      }),
    );
    const rMerge = await run(t2, outMerge);
    if (
      rMerge.summary.statusHint !== "fail" ||
      (rMerge.importedResults.anonymousPrivilegedHops ?? 0) < 3
    ) {
      throw new Error(
        `multi-file merge must keep worse anon hops: ${JSON.stringify(rMerge.summary)} anon=${rMerge.importedResults.anonymousPrivilegedHops}`,
      );
    }

    const outDouble = join(root, "o-double");
    mkdirSync(join(outDouble, "imports", "identity-propagation"), {
      recursive: true,
    });
    writeFileSync(
      join(outDouble, "imports", "identity-propagation", "both.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        identityPropagationDesignDocumented: true,
        privilegedToolCallsWithEndUserOrDocumentedServiceSubjectPct: 100,
        anonymousPrivilegedHops: 2,
        samples: [
          { hasEndUserSubject: true },
          { anonymous: true },
        ],
      }),
    );
    const rDouble = await run(t2, outDouble);
    if ((rDouble.importedResults.anonymousPrivilegedHops ?? 0) !== 2) {
      throw new Error(
        `scalar+samples must not double-count anon hops, got ${rDouble.importedResults.anonymousPrivilegedHops}`,
      );
    }

    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "identity-propagation"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "identity-propagation", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        toolsAgentsWorkflowsOrDelegatedActionsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`n/a expected: ${JSON.stringify(rNa.summary)}`);
    }

    console.log("identity-propagation smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
