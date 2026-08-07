/**
 * Threat-map gate: spec/aprf-threat-map.yaml ↔ YAML catalog ↔ pinned MITRE index.
 * Run from repo root: npm run aprf:threat-map
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parse } from "yaml";
import { getGeneratedCatalog } from "../packages/aprf-engine/src/catalog.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const errors: string[] = [];

function check(cond: unknown, msg: string): void {
  if (!cond) errors.push(msg);
}

type Entry = {
  securityIntent?: unknown;
  threats?: unknown;
  protects?: unknown;
  mitre?: { atlas?: unknown; attack?: unknown };
  mappingRationale?: unknown;
};

type ThreatMap = {
  vocabularies?: {
    threats?: { core?: string[]; extended?: string[] };
    protects?: string[];
  };
  rules?: Record<string, Entry>;
};

const map = parse(
  readFileSync(join(root, "spec", "aprf-threat-map.yaml"), "utf8"),
) as ThreatMap;

const mitreIndex = JSON.parse(
  readFileSync(join(root, "spec", "mitre-technique-index.json"), "utf8"),
) as {
  atlas: { techniques: Record<string, string> };
  attack: { techniques: Record<string, string> };
};

const allowedThreats = new Set([
  ...(map.vocabularies?.threats?.core ?? []),
  ...(map.vocabularies?.threats?.extended ?? []),
]);
const allowedProtects = new Set(map.vocabularies?.protects ?? []);
const atlasIds = new Set(Object.keys(mitreIndex.atlas.techniques));
const attackIds = new Set(Object.keys(mitreIndex.attack.techniques));

check(allowedThreats.size > 0, "threat vocabulary is empty");
check(allowedProtects.size > 0, "protects vocabulary is empty");

const entries = map.rules ?? {};
const catalogIds = new Set(getGeneratedCatalog().rules.map((r) => r.id));

for (const id of catalogIds) {
  if (!(id in entries)) errors.push(`${id}: missing from threat map`);
}
for (const id of Object.keys(entries)) {
  if (!catalogIds.has(id)) errors.push(`${id}: not a known APRF Check ID`);
}

/** Rationale is capped at 3 sentences so mappings stay reviewable at a glance. */
function sentenceCount(text: string): number {
  return text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0).length;
}

for (const [id, entry] of Object.entries(entries)) {
  const intent = entry.securityIntent;
  check(
    typeof intent === "string" && intent.trim().length > 0,
    `${id}: securityIntent is required`,
  );
  if (typeof intent === "string") {
    check(
      sentenceCount(intent) === 1,
      `${id}: securityIntent must be one sentence, got ${sentenceCount(intent)}`,
    );
  }

  const rationale = entry.mappingRationale;
  check(
    typeof rationale === "string" && rationale.trim().length > 0,
    `${id}: mappingRationale is required`,
  );
  if (typeof rationale === "string") {
    const n = sentenceCount(rationale);
    check(n <= 3, `${id}: mappingRationale must be at most 3 sentences, got ${n}`);
  }

  const threats = entry.threats;
  check(
    Array.isArray(threats) && threats.length > 0,
    `${id}: at least one human-readable threat is required`,
  );
  if (Array.isArray(threats)) {
    check(
      new Set(threats).size === threats.length,
      `${id}: duplicate entries in threats`,
    );
    for (const t of threats) {
      check(allowedThreats.has(t as string), `${id}: unknown threat "${t}"`);
    }
  }

  const protects = entry.protects;
  check(
    Array.isArray(protects) && protects.length > 0,
    `${id}: at least one protected asset is required`,
  );
  if (Array.isArray(protects)) {
    check(
      new Set(protects).size === protects.length,
      `${id}: duplicate entries in protects`,
    );
    for (const p of protects) {
      check(allowedProtects.has(p as string), `${id}: unknown protected asset "${p}"`);
    }
  }

  const atlas = entry.mitre?.atlas;
  const attack = entry.mitre?.attack;
  check(Array.isArray(atlas), `${id}: mitre.atlas must be an array (use [] when unmapped)`);
  check(Array.isArray(attack), `${id}: mitre.attack must be an array (use [] when unmapped)`);

  if (Array.isArray(atlas)) {
    check(
      new Set(atlas).size === atlas.length,
      `${id}: duplicate entries in mitre.atlas`,
    );
    for (const t of atlas) {
      check(
        atlasIds.has(t as string),
        `${id}: "${t}" is not a technique in the pinned MITRE ATLAS index`,
      );
    }
  }
  if (Array.isArray(attack)) {
    check(
      new Set(attack).size === attack.length,
      `${id}: duplicate entries in mitre.attack`,
    );
    for (const t of attack) {
      check(
        attackIds.has(t as string),
        `${id}: "${t}" is not a technique in the pinned MITRE ATT&CK index`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} threat-map problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const mapped = Object.values(entries).filter(
  (e) =>
    (Array.isArray(e.mitre?.atlas) && e.mitre.atlas.length > 0) ||
    (Array.isArray(e.mitre?.attack) && e.mitre.attack.length > 0),
).length;

console.log(
  `OK: threat map covers ${Object.keys(entries).length}/${catalogIds.size} Checks; ` +
    `${mapped} carry a MITRE mapping, ${Object.keys(entries).length - mapped} intentionally unmapped`,
);
