/**
 * Validate YAML rule packs against schema, fixed enums, prose lint, and
 * published-spec mapping.
 * Run: npm run validate -w @stackrail-io/aprf-engine
 */
import { validateAllByDomainYaml } from "./validate-catalog.js";

function main() {
  const result = validateAllByDomainYaml();

  if (result.errors.length > 0) {
    console.error("aprf-engine validation failed:");
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(
    `aprf-engine OK (${result.ruleCount} rules, ${result.domainCount} domains, ${result.pillarCount} pillars, ${result.categoryCount} categories; spec-mapped=${result.specMappedCount}; files=${result.fileCount}) from ${result.rulesRoot}`,
  );
}

main();
