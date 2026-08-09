import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function routeSource(name: string): string {
  return readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
}

test("reviewed requirements require review permission for every PATCH field", () => {
  const source = routeSource("requirements");
  assert.match(
    source,
    /if \(!hasRequestPermission\(req, "requirement:review"\)\)/,
  );
});

test("confirmed evidence edit and delete decisions are made under row locks", () => {
  const source = routeSource("evidence");
  assert.match(source, /evidencePatchRequiresApproval/);
  assert.match(source, /isApprovedEvidence/);
  assert.ok((source.match(/\.for\("update"\)/g) ?? []).length >= 2);
  assert.match(source, /hasRequestPermission\(req, "evidence:approve"\)/);
});

test("approved capability edit and delete decisions are made under row locks", () => {
  const source = routeSource("capability");
  assert.match(source, /capabilityMutationRequiresApproval/);
  assert.ok((source.match(/\.for\("update"\)/g) ?? []).length >= 2);
  assert.match(source, /hasRequestPermission\(req, "evidence:approve"\)/);
});

test("defect responses expose the version required by PATCH If-Match", () => {
  const serializer = readFileSync(
    new URL("../lib/serializers.ts", import.meta.url),
    "utf8",
  );
  assert.match(serializer, /serializeDefect[\s\S]*?version: d\.version/);
});
