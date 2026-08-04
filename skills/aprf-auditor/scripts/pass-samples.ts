/**
 * PASS sample artifacts shown as flyout attachments in REPORT.html.
 * Source files live under skills/aprf-auditor/examples/pass-samples/.
 */
import agnM1Inventory from "../examples/pass-samples/AGN-M1.inventory.json" with {
  type: "json",
};

export type PassSample = {
  checkId: string;
  /** Display / download filename for the attachment chip. */
  filename: string;
  /** Where to place the file for the collector to score it. */
  destination: string;
  hint: string;
  content: string;
};

const SAMPLES: PassSample[] = [
  {
    checkId: "AGN-M1",
    filename: "inventory.json",
    destination: "aprf-assessment/imports/agent-charter-inventory/inventory.json",
    hint: "Copy this measured inventory export into the destination path (do not overwrite *-report.json), then re-run collect + assess. Finding severity defaults to high; completeness/ownership gaps escalate to critical.",
    content: `${JSON.stringify(agnM1Inventory, null, 2)}\n`,
  },
];

export function getPassSample(checkId: string): PassSample | undefined {
  return SAMPLES.find((s) => s.checkId === checkId);
}

export function allPassSamples(): PassSample[] {
  return [...SAMPLES];
}
