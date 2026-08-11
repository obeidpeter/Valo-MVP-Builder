import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const directorySource = readFileSync(
  new URL("./authorityDirectory.ts", import.meta.url),
  "utf8",
);
const policySource = readFileSync(
  new URL("./authorityPolicy.ts", import.meta.url),
  "utf8",
);
const source = `${directorySource}\n${policySource}`;

test("client action authorities are exact-project, direct, current named members", () => {
  assert.match(source, /currentTenantDatabaseOrganisation\(\)/u);
  assert.match(source, /eq\(projects\.id, scope\.projectId\)/u);
  assert.match(
    source,
    /eq\(projects\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(organisationMemberships\.status, "active"\)/u);
  assert.match(source, /lte\(organisationMemberships\.accessStartsAt, now\)/u);
  assert.match(source, /gt\(organisationMemberships\.accessExpiresAt, now\)/u);
  assert.match(source, /eq\(users\.status, "active"\)/u);
  assert.match(source, /isNotNull\(users\.name\)/u);
  assert.match(source, /isRoleAllowedForOrganisation\(role, type\)/u);
  assert.match(source, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(source, /lte\(roleGrants\.startsAt, now\)/u);
  assert.match(source, /gt\(roleGrants\.expiresAt, now\)/u);
});

test("directory is bounded, excludes the maker, and returns names without contact PII", () => {
  assert.match(directorySource, /CLIENT_ACTION_BOUNDS\.authorities \+ 1/u);
  assert.match(
    source,
    /ne\(organisationMemberships\.userId, scope\.actorUserId\)/u,
  );
  assert.match(
    directorySource,
    /return \{ userId: row\.userId, name: row\.name \}/u,
  );
  assert.doesNotMatch(source, /users\.(email|clerkUserId|lastLoginAt)/u);
});
