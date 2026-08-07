/**
 * Sync rfcs/*.md → spec/aprf-spec.json `rfcs` index.
 * Run from repo root: npm run aprf:sync-rfcs
 *
 * Each published RFC (NNNN-*.md, excluding 0000-template) must declare Status,
 * Created, SemVer impact, and Index summary in its metadata table.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rfcsDir = join(root, "rfcs");
const specPath = join(root, "spec", "aprf-spec.json");

type RfcEntry = {
  id: string;
  number: number;
  title: string;
  status: string;
  created: string;
  semverImpact: string;
  summary: string;
  slug: string;
  href: string;
  markdownPath: string;
};

function field(table: string, name: string): string {
  const re = new RegExp(
    `\\|\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*([^|]+?)\\s*\\|`,
    "i",
  );
  const m = table.match(re);
  if (!m) throw new Error(`missing table field "${name}"`);
  return m[1].trim();
}

function parseRfc(filename: string, body: string): RfcEntry {
  const heading = body.match(/^#\s+(APRF-RFC-(\d+)):\s*(.+)\s*$/m);
  if (!heading) {
    throw new Error(`${filename}: expected "# APRF-RFC-NNNN: Title"`);
  }
  const id = heading[1];
  const number = Number(heading[2]);
  const title = heading[3].trim();
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${filename}: invalid RFC number`);
  }

  const table = body.match(/^\| Field \| Value \|[\s\S]*?\n\n/m)?.[0];
  if (!table) throw new Error(`${filename}: missing metadata table`);

  const status = field(table, "Status").toLowerCase();
  const created = field(table, "Created");
  const semverImpact = field(table, "SemVer impact").toUpperCase();
  const summary = field(table, "Index summary");
  if (!summary || summary === "TODO") {
    throw new Error(`${filename}: Index summary required`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) {
    throw new Error(`${filename}: Created must be YYYY-MM-DD`);
  }

  const slug = filename.replace(/\.md$/, "");
  const expectedPrefix = String(number).padStart(4, "0");
  if (!slug.startsWith(expectedPrefix)) {
    throw new Error(
      `${filename}: slug prefix ${slug.slice(0, 4)} ≠ RFC number ${expectedPrefix}`,
    );
  }
  const idNum = id.replace("APRF-RFC-", "");
  if (idNum !== expectedPrefix) {
    throw new Error(`${filename}: heading id ${id} ≠ filename ${expectedPrefix}`);
  }

  return {
    id,
    number,
    title,
    status,
    created,
    semverImpact,
    summary,
    slug,
    href: `/aprf/rfc/${slug}/`,
    markdownPath: `/aprf/rfc/${slug}.md`,
  };
}

function main() {
  const files = readdirSync(rfcsDir)
    .filter((f) => /^\d{4}-.+\.md$/.test(f) && !f.startsWith("0000-"))
    .sort();

  const rfcs = files.map((f) =>
    parseRfc(f, readFileSync(join(rfcsDir, f), "utf8")),
  );

  for (let i = 0; i < rfcs.length; i++) {
    if (rfcs[i].number !== i + 1) {
      throw new Error(
        `RFC numbering gap: expected ${i + 1}, got ${rfcs[i].id} (${files[i]})`,
      );
    }
  }

  const specText = readFileSync(specPath, "utf8");
  const start = specText.indexOf('  "rfcs": [');
  if (start < 0) throw new Error("spec/aprf-spec.json: missing top-level rfcs array");
  const afterKey = start + '  "rfcs": '.length;
  // Match the array that follows "rfcs":
  let depth = 0;
  let end = -1;
  for (let i = afterKey; i < specText.length; i++) {
    const ch = specText[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("spec/aprf-spec.json: unterminated rfcs array");

  const rfcsJson = JSON.stringify(rfcs, null, 2)
    .split("\n")
    .map((line, idx) => (idx === 0 ? line : `  ${line}`))
    .join("\n");

  const next = specText.slice(0, afterKey) + rfcsJson + specText.slice(end);
  writeFileSync(specPath, next);
  console.log(
    `OK: synced ${rfcs.length} RFC(s) into spec/aprf-spec.json (${rfcs.map((r) => r.id).join(", ")})`,
  );
}

try {
  main();
} catch (e) {
  console.error(`FAIL: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
