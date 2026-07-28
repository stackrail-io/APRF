import { createHash } from "crypto";
import type { AprfPolicy, CheckPolicyOverlay } from "./types.js";

/** Stable digest over check overlays for attestation. */
export function buildPolicyDigest(overlays: CheckPolicyOverlay[]): string {
  const canonical = JSON.stringify(
    overlays
      .slice()
      .sort((a, b) => a.checkId.localeCompare(b.checkId))
      .map((o) => ({
        checkId: o.checkId,
        applicability: o.applicability ?? null,
        severityOverride: o.severityOverride ?? null,
        naJustification: o.naJustification ?? null,
        steward: o.steward ?? null,
      })),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function withPolicyDigest(policy: AprfPolicy): AprfPolicy {
  return {
    ...policy,
    policyDigest: buildPolicyDigest(policy.checkOverlays),
  };
}
