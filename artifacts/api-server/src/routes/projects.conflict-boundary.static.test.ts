import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./projects.ts", import.meta.url), "utf8");

test("legacy project writers canonicalise and lock tender identity before conflict reads", () => {
  assert.match(source, /canonicalOpportunityPursuitConflictValue/u);
  assert.match(
    source,
    /const tenderReference = canonicalOpportunityPursuitConflictValue\([\s\S]*?lockOpportunityPursuitConflictBoundary\([\s\S]*?findSameTenderConflict/u,
  );
  assert.match(source, /tenderRef: tenderReference,[\s\S]*?lot: lotReference/u);
  assert.match(
    source,
    /regexp_replace\(normalize\(pg_catalog\.btrim\(\$\{projects\.tenderRef\}\), NFC\)[\s\S]*?regexp_replace\(normalize\(pg_catalog\.btrim\(coalesce\(\$\{projects\.lot\}, ''\)\), NFC\)/u,
  );
});
