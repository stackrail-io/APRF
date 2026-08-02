/**
 * Smoke: credential-egress-controls needs allowlist + documented destinations
 * + ≥1 deny event + measuredAt ≤90d; allowlist docs alone ≠ PASS.
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
  credentialEgressControlsCollector,
  type CredentialEgressControlsReport,
} from "../collectors/credential-egress-controls.ts";
import type { CollectorContext } from "../collectors/types.ts";

async function run(
  target: string,
  outDir: string,
): Promise<CredentialEgressControlsReport> {
  await credentialEgressControlsCollector.collect({
    targetPath: target,
    outputDir: outDir,
    assessedAt: new Date(),
    live: false,
    maxFiles: 200,
  } as CollectorContext);
  return JSON.parse(
    readFileSync(
      join(
        outDir,
        "imports",
        "credential-egress-controls",
        "credential-egress-controls-report.json",
      ),
      "utf8",
    ),
  );
}

function coverage(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    measuredAt: new Date().toISOString(),
    runtimesHoldingCredentialsPresent: true,
    egressAllowlistOrPolicyConfigured: true,
    credentialEgressDestinationsDocumented: true,
    denyEventCountProvingEnforcementInLast90Days: 1,
    ...extra,
  });
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "aprf-sec2-r2-"));
  try {
    const tEmpty = join(root, "t-empty");
    mkdirSync(tEmpty, { recursive: true });
    const r0 = await run(tEmpty, join(root, "o0"));
    if (r0.summary.statusHint !== "not_demonstrated") {
      throw new Error(`expected not_demonstrated, got ${r0.summary.statusHint}`);
    }

    const tPol = join(root, "t-pol");
    mkdirSync(join(tPol, "k8s"), { recursive: true });
    writeFileSync(
      join(tPol, "k8s", "egress_allowlist_policy.yaml"),
      `
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: runtime-credential-egress
spec:
  egress:
    - to:
        - ipBlock: { cidr: 10.0.0.0/8 }
`,
    );
    const r1 = await run(tPol, join(root, "o1"));
    if (
      r1.summary.statusHint !== "partial" ||
      !r1.summary.allowlistPresent
    ) {
      throw new Error(
        `expected partial with allowlist, got ${JSON.stringify(r1.summary)}`,
      );
    }

    // Fail: 0 deny events
    const outFail = join(root, "o-fail");
    mkdirSync(join(outFail, "imports", "credential-egress-controls"), {
      recursive: true,
    });
    writeFileSync(
      join(outFail, "imports", "credential-egress-controls", "coverage.json"),
      coverage({ denyEventCountProvingEnforcementInLast90Days: 0 }),
    );
    const r2 = await run(tPol, outFail);
    if (r2.summary.statusHint !== "fail") {
      throw new Error(`expected fail, got ${JSON.stringify(r2.summary)}`);
    }

    // Metrics without measuredAt → PARTIAL
    const outStale = join(root, "o-stale");
    mkdirSync(join(outStale, "imports", "credential-egress-controls"), {
      recursive: true,
    });
    writeFileSync(
      join(outStale, "imports", "credential-egress-controls", "coverage.json"),
      JSON.stringify({
        runtimesHoldingCredentialsPresent: true,
        egressAllowlistOrPolicyConfigured: true,
        credentialEgressDestinationsDocumented: true,
        denyEventCountProvingEnforcementInLast90Days: 2,
      }),
    );
    const rStale = await run(tPol, outStale);
    if (rStale.summary.statusHint !== "partial") {
      throw new Error(
        `without measuredAt expected partial: ${JSON.stringify(rStale.summary)}`,
      );
    }

    // Over-age measuredAt must not PASS.
    const outAged = join(root, "o-aged");
    mkdirSync(join(outAged, "imports", "credential-egress-controls"), {
      recursive: true,
    });
    const aged = new Date();
    aged.setUTCDate(aged.getUTCDate() - 120);
    writeFileSync(
      join(outAged, "imports", "credential-egress-controls", "coverage.json"),
      coverage({ measuredAt: aged.toISOString() }),
    );
    const rAged = await run(tPol, outAged);
    if (rAged.summary.statusHint === "pass") {
      throw new Error(
        `over-age measuredAt must not PASS: ${JSON.stringify(rAged.summary)}`,
      );
    }

    // PASS
    const outPass = join(root, "o-pass");
    mkdirSync(join(outPass, "imports", "credential-egress-controls"), {
      recursive: true,
    });
    writeFileSync(
      join(outPass, "imports", "credential-egress-controls", "coverage.json"),
      coverage(),
    );
    const r3 = await run(tPol, outPass);
    if (r3.summary.sec2R2Satisfied !== true || r3.summary.statusHint !== "pass") {
      throw new Error(`expected pass, got ${JSON.stringify(r3.summary)}`);
    }

    // N/A
    const outNa = join(root, "ona");
    mkdirSync(join(outNa, "imports", "credential-egress-controls"), {
      recursive: true,
    });
    writeFileSync(
      join(outNa, "imports", "credential-egress-controls", "coverage.json"),
      JSON.stringify({
        measuredAt: new Date().toISOString(),
        runtimesHoldingCredentialsPresent: false,
      }),
    );
    const rNa = await run(tEmpty, outNa);
    if (rNa.summary.statusHint !== "not_applicable") {
      throw new Error(`N/A expected: ${JSON.stringify(rNa.summary)}`);
    }

    // N/A overridden by allowlist → pass with full import
    const outOverride = join(root, "o-override");
    mkdirSync(join(outOverride, "imports", "credential-egress-controls"), {
      recursive: true,
    });
    writeFileSync(
      join(
        outOverride,
        "imports",
        "credential-egress-controls",
        "coverage.json",
      ),
      coverage({ runtimesHoldingCredentialsPresent: false }),
    );
    const rOv = await run(tPol, outOverride);
    if (rOv.summary.statusHint !== "pass") {
      throw new Error(
        `allowlist should override N/A to pass: ${JSON.stringify(rOv.summary)}`,
      );
    }

    console.log("aprf-auditor credential-egress-controls smoke OK");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
