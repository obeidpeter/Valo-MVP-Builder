import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const route of ["requirements", "evidence"] as const) {
  test(`${route} model workflow holds tenant locks through disconnect and provider settlement`, () => {
    const source = readFileSync(
      new URL(`./${route}.ts`, import.meta.url),
      "utf8",
    );

    assert.match(source, /holdTenantDatabaseUntilComplete\(req\)/);
    assert.match(source, /res\.once\("close", abortOnDisconnect\)/);
    assert.match(source, /signal: disconnectController\.signal/);
    assert.match(
      source,
      /finally \{[\s\S]*?releaseTenantWork\(workflowError\)/,
    );
  });
}

test("LLM helpers check cancellation before disclosure and after provider settlement", () => {
  const source = readFileSync(
    new URL("../lib/llm.ts", import.meta.url),
    "utf8",
  );
  const checks = source.match(/signal\?\.throwIfAborted\(\)/g) ?? [];
  assert.ok(checks.length >= 6);
  assert.match(
    source,
    /executeJsonWithFallback[\s\S]*?signal\?\.throwIfAborted\(\)/,
  );
});
