import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dbSource = readFileSync(
  new URL("../../../../lib/db/src/index.ts", import.meta.url),
  "utf8",
);
const llmSource = readFileSync(new URL("./llm.ts", import.meta.url), "utf8");

test("AI attempt telemetry uses an independent tenant transaction", () => {
  assert.match(
    dbSource,
    /export async function withIndependentTenantDatabase<[^]+?return rootDb\.transaction\(/,
  );
  const independentHelper = dbSource.slice(
    dbSource.indexOf("export async function withIndependentTenantDatabase"),
    dbSource.indexOf(
      "export function currentTenantDatabaseOrganisation",
      dbSource.indexOf("export async function withIndependentTenantDatabase"),
    ),
  );
  assert.match(independentHelper, /tenantDatabaseContext\.getStore\(\)/);
  assert.match(
    independentHelper,
    /assertIndependentTenantContext\(active\?\.organisationId, organisationId\)/,
  );
  assert.match(
    llmSource,
    /await withIndependentTenantDatabase\(organisationId, \(\) =>\s*db\.insert\(llmRuns\)/,
  );
  assert.doesNotMatch(llmSource, /logFailureBestEffort/);
  assert.match(
    llmSource,
    /async function logFailureDurably[^]+?await logRun\(/,
  );
});

test("durable AI telemetry stores hashes, safe codes and bounded summaries", () => {
  const valuesStart = llmSource.indexOf("db.insert(llmRuns).values({");
  const valuesEnd = llmSource.indexOf("\n    }),", valuesStart);
  assert.ok(valuesStart >= 0 && valuesEnd > valuesStart);
  const persistedValues = llmSource.slice(valuesStart, valuesEnd);
  assert.match(llmSource, /inputHash: createHash\("sha256"\)/);
  assert.match(llmSource, /error: safeAiErrorCode\(params\.error\)/);
  assert.match(llmSource, /JSON\.stringify\([^]+?\.slice\(0, 2000\)/);
  assert.doesNotMatch(persistedValues, /\binput:\s*params\.input\b/);
});
