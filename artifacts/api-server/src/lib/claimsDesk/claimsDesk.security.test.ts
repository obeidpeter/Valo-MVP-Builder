import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const repositoryUrl = new URL("./repository.ts", import.meta.url);
const routeUrl = new URL("../../routes/claimsDesk.ts", import.meta.url);

describe("Claims Desk static security contract", () => {
  test("the ledger is insert-only and explicitly tenant/project filtered", async () => {
    const source = await readFile(repositoryUrl, "utf8");
    assert.doesNotMatch(source, /\.update\(workTasks\)|\.delete\(workTasks\)/u);
    assert.match(
      source,
      /eq\(workTasks\.organisationId, scope\.organisationId\)/u,
    );
    assert.match(source, /eq\(workTasks\.projectId, scope\.projectId\)/u);
    assert.match(source, /writeAuditTx\(tx/u);
    assert.match(source, /quarantineStatus === "cleared"/u);
    assert.match(source, /malwareStatus === "clean"/u);
    assert.match(source, /document\.sha256 === binding\.sha256/u);
  });

  test("routes expose controlled record/transition endpoints only", async () => {
    const source = await readFile(routeUrl, "utf8");
    assert.doesNotMatch(source, /router\.(?:patch|put|delete)\(/u);
    assert.doesNotMatch(
      source,
      /["'`]\/[^"'`]*(?:dispatch|invoice|payment-provider)|fetch\(/iu,
    );
    assert.match(
      source,
      /context\?\.permissions\.has\(CLAIMS_DESK_READ_PERMISSION\)/u,
    );
    assert.match(
      source,
      /context\?\.permissions\.has\(CLAIMS_DESK_MANAGE_PERMISSION\)/u,
    );
  });
});
