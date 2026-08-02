/**
 * artifact-provenance-integrity — SCI-M1 / repo-artifact-provenance-integrity.
 *
 * Discovers cosign, Notation, SLSA, OCI provenance, model-checksum, and digest
 * pin signals. Import coverage under imports/artifact-provenance-integrity/
 * unlocks PASS (measuredAt ≤90d). Digest pins alone ≠ PASS.
 */
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import type {
  Collector,
  CollectorContext,
  CollectorResult,
  EvidenceNode,
} from "./types.ts";
import {
  ensureDir,
  listImportFiles,
  readText,
  redact,
  rel,
  walkFiles,
} from "./lib/fs.ts";
import {
  asBool,
  measuredAtFresh,
  mergeAndBool,
  mergeMinNum,
  mergeOldestMeasuredAt,
  mergeOrBool,
  parseMeasuredAt,
} from "./lib/import-attest.ts";

const PLUGIN_ID = "artifact-provenance-integrity";
const RELATED = ["SCI-M1"] as const;
const DETECTOR_ID = "repo-artifact-provenance-integrity";
const IMPORT_MAX_AGE_DAYS = 90;

const SKIP_DIR_HINT =
  /(^|[/\\])(node_modules|\.git|dist|build|coverage|\.venv|venv|__pycache__|vendor)([/\\]|$)/i;

const COSIGN_RE =
  /\b(cosign|sigstore|fulcio|rekor|policy[_-]?controller)\b/i;

const NOTATION_RE =
  /\b(notation|notary[_-]?project|oras[_-]?sign|trust[_-]?policy\.json)\b/i;

const SLSA_RE =
  /\b(slsa|in[_-]?toto|provenance[_-]?attestation|slsa[_-]?verifier|attestation[_-]?verify)\b/i;

const OCI_PROVENANCE_RE =
  /\b(oci[_-]?(provenance|referrers)|referrers[_-]?api|artifact[_-]?manifest|image[_-]?provenance)\b/i;

const MODEL_CHECKSUM_RE =
  /\b(model[_-]?(checksum|hash|digest)|weights?[_-]?(sha256|checksum|hash)|checksum[_-]?(validat|verif)|sha256sum.{0,40}(model|weight|safetensor))\b/i;

const DIGEST_PIN_RE =
  /\b(sha256:[a-f0-9]{64}|image[_-]?digest|digest[_-]?pinned|@sha256:)\b/i;

const BLOCK_UNVERIFIED_RE =
  /\b(verify[_-]?images?|block[_-]?(unsigned|unverified)|reject[_-]?(unsigned|unverified)|admission[_-]?(controller|webhook)|image[_-]?policy|clusterimagepolicy|unverified[_-]?pull)\b/i;

const ARTIFACT_SURFACE_RE =
  /\b(container[_-]?image|docker[_-]?image|oci[_-]?image|model[_-]?(artifact|weight|registry)|production[_-]?(image|model))\b/i;

export interface ArtifactProvenanceIntegrityReport {
  schemaVersion: "0.2.0";
  pluginId: typeof PLUGIN_ID;
  detectorId: typeof DETECTOR_ID;
  relatedCheckIds: string[];
  assessedAt: string;
  signals: {
    cosign: { found: boolean; refs: string[] };
    notation: { found: boolean; refs: string[] };
    slsa: { found: boolean; refs: string[] };
    ociProvenance: { found: boolean; refs: string[] };
    modelChecksum: { found: boolean; refs: string[] };
    digestPin: { found: boolean; refs: string[] };
    blockUnverified: { found: boolean; refs: string[] };
  };
  importedResults: {
    found: boolean;
    productionModelOrContainerArtifactsPresent: boolean | null;
    provenanceOrIntegrityVerificationConfigured: boolean | null;
    productionPullsVerifiedAgainstDigestOrSignaturePct: number | null;
    unverifiedPullsBlocked: boolean | null;
    measuredAt: string | null;
    sources: string[];
  };
  summary: {
    gateSignalsPresent: boolean;
    verificationPresent: boolean;
    detectorHits: string[];
    sciM1Satisfied: boolean | null;
    statusHint:
      | "pass"
      | "partial"
      | "fail"
      | "not_demonstrated"
      | "not_applicable";
  };
  notes: string[];
}

function importDir(ctx: CollectorContext): string {
  return join(ctx.outputDir, "imports", PLUGIN_ID);
}

function isSkippable(path: string): boolean {
  return SKIP_DIR_HINT.test(path);
}

function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function collectRefs(
  targetPath: string,
  maxFiles: number,
  match: (path: string, text: string) => boolean,
  limit = 12,
): string[] {
  const refs: string[] = [];
  const files = walkFiles(targetPath, {
    maxFiles: Math.max(maxFiles, 5000),
    extensions: [
      ".yml",
      ".yaml",
      ".json",
      ".md",
      ".toml",
      ".sh",
      ".ts",
      ".js",
      ".py",
      ".tf",
    ],
  });
  for (const f of files) {
    const r = rel(targetPath, f);
    if (isSkippable(r)) continue;
    const text = readText(f, 80_000) || "";
    if (match(r, text)) refs.push(r);
    if (refs.length >= limit) break;
  }
  return [...new Set(refs)];
}

function loadImported(
  ctx: CollectorContext,
): ArtifactProvenanceIntegrityReport["importedResults"] {
  const sources: string[] = [];
  let productionModelOrContainerArtifactsPresent: boolean | null = null;
  let provenanceOrIntegrityVerificationConfigured: boolean | null = null;
  let productionPullsVerifiedAgainstDigestOrSignaturePct: number | null = null;
  let unverifiedPullsBlocked: boolean | null = null;
  let measuredAt: string | null = null;

  for (const f of listImportFiles(ctx.outputDir, PLUGIN_ID)) {
    if (/artifact-provenance-integrity-report\.json$/i.test(f)) continue;
    const text = readText(f);
    if (!text) continue;
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      sources.push(basename(f));
      measuredAt = mergeOldestMeasuredAt(measuredAt, parseMeasuredAt(data));
      productionModelOrContainerArtifactsPresent = mergeOrBool(
        productionModelOrContainerArtifactsPresent,
        asBool(data.productionModelOrContainerArtifactsPresent) ??
          asBool(data.production_model_or_container_artifacts_present) ??
          asBool(data.productionArtifactsPresent),
      );
      provenanceOrIntegrityVerificationConfigured = mergeAndBool(
        provenanceOrIntegrityVerificationConfigured,
        asBool(data.provenanceOrIntegrityVerificationConfigured) ??
          asBool(data.provenance_or_integrity_verification_configured) ??
          asBool(data.verificationConfigured),
      );
      productionPullsVerifiedAgainstDigestOrSignaturePct = mergeMinNum(
        productionPullsVerifiedAgainstDigestOrSignaturePct,
        asNum(data.productionPullsVerifiedAgainstDigestOrSignaturePct) ??
          asNum(
            data.production_pulls_verified_against_digest_or_signature_pct,
          ) ??
          asNum(data.verifiedPullsPct),
      );
      unverifiedPullsBlocked = mergeAndBool(
        unverifiedPullsBlocked,
        asBool(data.unverifiedPullsBlocked) ??
          asBool(data.unverified_pulls_blocked) ??
          asBool(data.blockUnverified),
      );
    } catch {
      /* skip */
    }
  }

  return {
    found: sources.length > 0,
    productionModelOrContainerArtifactsPresent,
    provenanceOrIntegrityVerificationConfigured,
    productionPullsVerifiedAgainstDigestOrSignaturePct,
    unverifiedPullsBlocked,
    measuredAt,
    sources,
  };
}

export function buildArtifactProvenanceIntegrityReport(opts: {
  assessedAt: string;
  cosign: { found: boolean; refs: string[] };
  notation: { found: boolean; refs: string[] };
  slsa: { found: boolean; refs: string[] };
  ociProvenance: { found: boolean; refs: string[] };
  modelChecksum: { found: boolean; refs: string[] };
  digestPin: { found: boolean; refs: string[] };
  blockUnverified: { found: boolean; refs: string[] };
  imported: ArtifactProvenanceIntegrityReport["importedResults"];
}): ArtifactProvenanceIntegrityReport {
  const notes: string[] = [];
  const detectorHits: string[] = [];
  if (opts.cosign.found) detectorHits.push("cosign-verification");
  if (opts.notation.found) detectorHits.push("notation-verification");
  if (opts.slsa.found) detectorHits.push("slsa-attestation");
  if (opts.ociProvenance.found) detectorHits.push("oci-provenance");
  if (opts.modelChecksum.found) detectorHits.push("model-checksum-validation");
  if (opts.digestPin.found) detectorHits.push("docker-image-digest-pinned");
  if (
    opts.cosign.found ||
    opts.notation.found ||
    opts.slsa.found ||
    opts.ociProvenance.found ||
    opts.modelChecksum.found
  ) {
    detectorHits.push("artifact-signature-verification");
  }

  const verificationSignal =
    opts.cosign.found ||
    opts.notation.found ||
    opts.slsa.found ||
    opts.ociProvenance.found ||
    opts.modelChecksum.found;
  // Digest pins / block-unverified policy prove an artifact surface exists —
  // they must not be N/A-laundered even though pins alone ≠ PASS.
  const gateSignalsPresent =
    verificationSignal ||
    opts.digestPin.found ||
    opts.blockUnverified.found;
  const surfaceProvedForNaOverride = gateSignalsPresent;

  if (!gateSignalsPresent && !opts.imported.found) {
    notes.push(
      "No artifact-provenance-integrity signals — SCI-M1 remains not demonstrated until cosign/Notation/SLSA/OCI/checksum verification + measured pull coverage or an explicit N/A attest (productionModelOrContainerArtifactsPresent=false) is imported.",
    );
  }
  if (opts.cosign.found) {
    notes.push(`Cosign refs: ${opts.cosign.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.notation.found) {
    notes.push(`Notation refs: ${opts.notation.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.slsa.found) {
    notes.push(`SLSA refs: ${opts.slsa.refs.slice(0, 3).join(", ")}`);
  }
  if (opts.ociProvenance.found) {
    notes.push(
      `OCI provenance refs: ${opts.ociProvenance.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.modelChecksum.found) {
    notes.push(
      `Model-checksum refs: ${opts.modelChecksum.refs.slice(0, 3).join(", ")}`,
    );
  }
  if (opts.digestPin.found) {
    notes.push(
      `Digest-pin refs: ${opts.digestPin.refs.slice(0, 3).join(", ")}; pins alone ≠ PASS without verify+block import.`,
    );
  }
  if (opts.blockUnverified.found) {
    notes.push(
      `Block-unverified refs: ${opts.blockUnverified.refs.slice(0, 3).join(", ")}; policy wording alone ≠ PASS without import.`,
    );
  }
  if (opts.imported.found) {
    notes.push(
      `Imported: ${opts.imported.sources.join(", ")} (artifactsPresent=${opts.imported.productionModelOrContainerArtifactsPresent}, verification=${opts.imported.provenanceOrIntegrityVerificationConfigured}, verifiedPct=${opts.imported.productionPullsVerifiedAgainstDigestOrSignaturePct}, blocked=${opts.imported.unverifiedPullsBlocked}, measuredAt=${opts.imported.measuredAt})`,
    );
  } else if (gateSignalsPresent) {
    notes.push(
      "Signals alone are PARTIAL — import verification configured (or present via cosign/Notation/SLSA/OCI/checksum signals) plus productionPullsVerifiedAgainstDigestOrSignaturePct=100 + unverifiedPullsBlocked=true (measuredAt ≤90d) under imports/artifact-provenance-integrity/ to PASS. Set productionModelOrContainerArtifactsPresent=false for NOT_APPLICABLE.",
    );
  }

  const importFresh = measuredAtFresh(
    opts.imported.measuredAt,
    new Date(opts.assessedAt),
    IMPORT_MAX_AGE_DAYS,
  );
  const verificationPresent =
    verificationSignal ||
    opts.imported.provenanceOrIntegrityVerificationConfigured === true;
  const verifiedOk =
    opts.imported.productionPullsVerifiedAgainstDigestOrSignaturePct === 100;
  const blockedOk = opts.imported.unverifiedPullsBlocked === true;

  let statusHint: ArtifactProvenanceIntegrityReport["summary"]["statusHint"];
  let sciM1Satisfied: boolean | null = null;

  const explicitFail =
    opts.imported.found &&
    ((opts.imported.provenanceOrIntegrityVerificationConfigured === false &&
      !verificationSignal) ||
      (opts.imported.productionPullsVerifiedAgainstDigestOrSignaturePct !==
        null &&
        opts.imported.productionPullsVerifiedAgainstDigestOrSignaturePct <
          100) ||
      opts.imported.unverifiedPullsBlocked === false);

  if (explicitFail) {
    statusHint = "fail";
    sciM1Satisfied = false;
    if (
      opts.imported.productionModelOrContainerArtifactsPresent === false &&
      surfaceProvedForNaOverride
    ) {
      notes.push(
        "Imported productionModelOrContainerArtifactsPresent=false ignored — in-repo digest pin, block-unverified policy, or verification tooling proves the surface exists.",
      );
    }
    notes.push(
      "Imported evidence shows missing verification, verifiedPct<100, or unverified pulls not blocked — SCI-M1 fail.",
    );
  } else if (
    opts.imported.found &&
    opts.imported.productionModelOrContainerArtifactsPresent === false &&
    !surfaceProvedForNaOverride
  ) {
    statusHint = "not_applicable";
    sciM1Satisfied = null;
    notes.push(
      "Imported productionModelOrContainerArtifactsPresent=false — SCI-M1 NOT_APPLICABLE.",
    );
  } else if (
    opts.imported.productionModelOrContainerArtifactsPresent === false &&
    surfaceProvedForNaOverride
  ) {
    notes.push(
      "Imported productionModelOrContainerArtifactsPresent=false ignored — in-repo digest pin, block-unverified policy, or verification tooling proves the surface exists.",
    );
    if (
      verificationPresent &&
      verifiedOk &&
      blockedOk &&
      importFresh &&
      opts.imported.found
    ) {
      statusHint = "pass";
      sciM1Satisfied = true;
    } else {
      statusHint = "partial";
      sciM1Satisfied = false;
    }
  } else if (!gateSignalsPresent && !opts.imported.found) {
    statusHint = "not_demonstrated";
    sciM1Satisfied = null;
  } else if (
    verificationPresent &&
    verifiedOk &&
    blockedOk &&
    importFresh &&
    opts.imported.found
  ) {
    statusHint = "pass";
    sciM1Satisfied = true;
  } else if (gateSignalsPresent || opts.imported.found) {
    statusHint = "partial";
    sciM1Satisfied = false;
    if (opts.imported.found && !verificationPresent) {
      notes.push(
        "PASS requires provenance/integrity verification (cosign/Notation/SLSA/OCI/checksum signal or provenanceOrIntegrityVerificationConfigured=true). Digest pins alone are insufficient.",
      );
    }
    if (opts.imported.found && !verifiedOk) {
      notes.push(
        "Import must show productionPullsVerifiedAgainstDigestOrSignaturePct=100.",
      );
    }
    if (opts.imported.found && !blockedOk) {
      notes.push("Import must show unverifiedPullsBlocked=true.");
    }
    if (opts.imported.found && !importFresh) {
      notes.push(
        "Import missing fresh measuredAt (≤90 days) — required to unlock SCI-M1 PASS.",
      );
    }
  } else {
    statusHint = "not_demonstrated";
    sciM1Satisfied = null;
  }

  return {
    schemaVersion: "0.2.0",
    pluginId: PLUGIN_ID,
    detectorId: DETECTOR_ID,
    relatedCheckIds: [...RELATED],
    assessedAt: opts.assessedAt,
    signals: {
      cosign: opts.cosign,
      notation: opts.notation,
      slsa: opts.slsa,
      ociProvenance: opts.ociProvenance,
      modelChecksum: opts.modelChecksum,
      digestPin: opts.digestPin,
      blockUnverified: opts.blockUnverified,
    },
    importedResults: opts.imported,
    summary: {
      gateSignalsPresent,
      verificationPresent,
      detectorHits: [...new Set(detectorHits)],
      sciM1Satisfied,
      statusHint,
    },
    notes,
  };
}

export const artifactProvenanceIntegrityCollector: Collector = {
  id: PLUGIN_ID,
  async collect(ctx: CollectorContext): Promise<CollectorResult> {
    const maxFiles = ctx.maxFiles ?? 8000;

    const cosignRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => COSIGN_RE.test(p) || COSIGN_RE.test(t),
      10,
    );
    const notationRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => NOTATION_RE.test(p) || NOTATION_RE.test(t),
      10,
    );
    const slsaRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => SLSA_RE.test(p) || SLSA_RE.test(t),
      10,
    );
    const ociRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => OCI_PROVENANCE_RE.test(p) || OCI_PROVENANCE_RE.test(t),
      10,
    );
    const checksumRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => MODEL_CHECKSUM_RE.test(p) || MODEL_CHECKSUM_RE.test(t),
      10,
    );
    const digestRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) => DIGEST_PIN_RE.test(p) || DIGEST_PIN_RE.test(t),
      10,
    );
    const blockRefs = collectRefs(
      ctx.targetPath,
      maxFiles,
      (p, t) =>
        BLOCK_UNVERIFIED_RE.test(p) ||
        BLOCK_UNVERIFIED_RE.test(t) ||
        (ARTIFACT_SURFACE_RE.test(t) && BLOCK_UNVERIFIED_RE.test(t)),
      10,
    );

    const imported = loadImported(ctx);
    const report = buildArtifactProvenanceIntegrityReport({
      assessedAt: ctx.assessedAt.toISOString(),
      cosign: { found: cosignRefs.length > 0, refs: cosignRefs },
      notation: { found: notationRefs.length > 0, refs: notationRefs },
      slsa: { found: slsaRefs.length > 0, refs: slsaRefs },
      ociProvenance: { found: ociRefs.length > 0, refs: ociRefs },
      modelChecksum: { found: checksumRefs.length > 0, refs: checksumRefs },
      digestPin: { found: digestRefs.length > 0, refs: digestRefs },
      blockUnverified: { found: blockRefs.length > 0, refs: blockRefs },
      imported,
    });

    ensureDir(importDir(ctx));
    writeFileSync(
      join(importDir(ctx), "artifact-provenance-integrity-report.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    const nodes: EvidenceNode[] = [
      {
        id: `${PLUGIN_ID}:report`,
        class: "ci",
        ref: `imports/${PLUGIN_ID}/artifact-provenance-integrity-report.json`,
        pluginId: PLUGIN_ID,
        signals: [
          "artifact-provenance-integrity",
          "sci-m1",
          DETECTOR_ID,
          ...report.summary.detectorHits,
          ...(report.summary.sciM1Satisfied ? ["sci-m1-satisfied"] : []),
        ],
        excerpt: redact(report.notes.slice(0, 3).join(" | ").slice(0, 400)),
        relatedCheckIds: [...RELATED],
      },
    ];

    return {
      pluginId: PLUGIN_ID,
      status: "ran",
      detail: `SCI-M1 status=${report.summary.statusHint} verification=${report.summary.verificationPresent} hits=${report.summary.detectorHits.join(",") || "none"} satisfied=${report.summary.sciM1Satisfied}; report=imports/${PLUGIN_ID}/artifact-provenance-integrity-report.json`,
      nodes,
    };
  },
};
