import type { Technology } from "../types.js";

export interface DetectorContext {
  /** Optional workspace / repo root for file-based detectors. */
  workspaceRoot?: string;
  /** Technologies known to be in use for the system under review. */
  technologies?: Technology[];
  /** Opaque caller metadata (org id, run id, etc.). */
  meta?: Record<string, unknown>;
}

export interface DetectorResult {
  passed: boolean;
  /** Short human-readable summary. */
  summary: string;
  evidenceRef?: string;
  /** Extra structured details for UI / logs. */
  details?: Record<string, unknown>;
  error?: string;
}

export interface Detector {
  id: string;
  technologies: Technology[];
  description?: string;
  run(
    ctx: DetectorContext,
    params: Record<string, unknown>,
  ): Promise<DetectorResult>;
}

export interface DetectorRegistry {
  register(detector: Detector): void;
  get(id: string): Detector | undefined;
  has(id: string): boolean;
  list(): Detector[];
  ids(): string[];
}
