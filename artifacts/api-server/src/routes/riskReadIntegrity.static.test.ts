import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./risk.ts", import.meta.url), "utf8");

test("GET risk computes a response without persisting under defect:read", () => {
  const computeEnd = source.indexOf("router.get(");
  const readEnd = source.indexOf("router.post(", computeEnd);

  assert.ok(computeEnd > 0 && readEnd > computeEnd);
  assert.doesNotMatch(source.slice(0, computeEnd), /\.update\(/);
  assert.doesNotMatch(source.slice(computeEnd, readEnd), /\.update\(/);
  assert.match(
    source.slice(computeEnd, readEnd),
    /requirePermissionOrLegacy\("defect:read"\)[\s\S]*computeAssessment/,
  );
});
