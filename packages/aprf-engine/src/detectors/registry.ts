/**
 * Normative detector registry: attestation-only.
 *
 * Product/plugin repos supply real detectors. This package only ships
 * `manual-attest` so evaluate defaults never pretend to score via stubs.
 */
import type {
  Detector,
  DetectorContext,
  DetectorRegistry,
  DetectorResult,
} from "./types.js";
import { listCatalogDetectorIds } from "./catalog-ids.js";

/** Manual / attestation-only placeholder — never auto-passes. */
const manualAttestDetector: Detector = {
  id: "manual-attest",
  technologies: [],
  description: "Requires human attestation; does not auto-evaluate.",
  async run(
    _ctx: DetectorContext,
    params: Record<string, unknown>,
  ): Promise<DetectorResult> {
    return {
      passed: false,
      summary: "Manual attestation required",
      details: {
        hint: params.hint ?? "Provide evidence via attestation or a product detector registry",
      },
    };
  },
};

/**
 * Create a registry for product detectors.
 * Default contents: `manual-attest` only. Pass `extras` for real implementations.
 */
export function createDetectorRegistry(
  extras: Detector[] = [],
): DetectorRegistry {
  const map = new Map<string, Detector>();

  const register = (detector: Detector) => {
    map.set(detector.id, detector);
  };

  register(manualAttestDetector);
  for (const d of extras) register(d);

  return {
    register,
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    list: () => [...map.values()],
    ids: () => [...map.keys()],
  };
}

/**
 * IDs allowed in Check YAML `detection.detectors[].id`.
 * Prefer this over `listRegisteredDetectorIds` for catalog validation.
 */
export function listCatalogDetectorIdsForValidation(): string[] {
  return listCatalogDetectorIds();
}

/**
 * @deprecated Prefer `listCatalogDetectorIds()` for validation.
 * Returns catalog allowlist when no registry is passed (not stub runtimes).
 */
export function listRegisteredDetectorIds(
  registry?: DetectorRegistry,
): string[] {
  return registry ? registry.ids() : listCatalogDetectorIds();
}

export { listCatalogDetectorIds } from "./catalog-ids.js";
