/**
 * Validate YAML rule packs against schema + referential integrity.
 * Run: npm run validate -w @stackrail-io/aprf-engine
 */
import { loadRulesFromDisk, rulesRootDir } from "../src/loader";

function main() {
  const root = rulesRootDir();
  const { rules, categories, errors } = loadRulesFromDisk(root);

  if (errors.length > 0) {
    console.error("aprf-engine validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(
    `aprf-engine OK (${rules.length} rules, ${categories.length} categories) from ${root}`,
  );
}

main();
