import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("./aiShadowProgramme.ts", import.meta.url),
  "utf8",
);
const repositorySource = readFileSync(
  new URL("../lib/aiShadowProgramme/auditRepository.ts", import.meta.url),
  "utf8",
);

test("AI shadow routes stay private, human-authorised and activation-disabled", () => {
  assert.match(routeSource, /context\?\.source === "membership"/u);
  assert.match(routeSource, /permissions\.has\("evaluation:read"\)/u);
  assert.match(routeSource, /permissions\.has\("evaluation:manage"\)/u);
  assert.match(routeSource, /Cache-Control", "private, no-store"/u);
  assert.match(routeSource, /productionActivationGranted: false/u);
  assert.doesNotMatch(
    routeSource,
    /fetch\(|provider\.invoke|model\.generate/iu,
  );
});

test("AI shadow durable authority is revalidated inside tenant transactions", () => {
  assert.match(
    repositorySource,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(repositorySource, /eq\(users\.status, "active"\)/u);
  assert.match(repositorySource, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(repositorySource, /pg_advisory_xact_lock/u);
  assert.doesNotMatch(
    repositorySource,
    /fetch\(|provider\.invoke|model\.generate/iu,
  );
});
