import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const route = readFileSync(
  new URL("./tenderContext.ts", import.meta.url),
  "utf8",
);
const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("tender route is mounted, private, and permission-separated", () => {
  assert.match(index, /createTenderContextRouter/u);
  assert.match(index, /router\.use\(tenderContextRouter\)/u);
  assert.match(
    route,
    /router\.use\("\/projects\/:id\/tender-context", privateResponse\)/u,
  );
  assert.match(route, /"requirement:write"/u);
  assert.match(route, /"intelligence:review"/u);
  assert.match(route, /resolveCurrentDirectAuthority/u);
});

test("every authoritative tender response waits for database commit", () => {
  assert.equal(
    [...route.matchAll(/await commitBeforeResponse\(request\)/gu)].length,
    4,
  );
  assert.match(route, /parseExpectedVersion\(request\.get\("If-Match"\)\)/u);
});
