import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("named Client Action humans require one direct active canonical authority", async () => {
  const source = await readFile(
    new URL("./drizzleRepository.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("async assertNamedHuman(scope, userId)");
  const end = source.indexOf("async assertEvidenceRequestRecipient", start);
  assert.ok(start >= 0 && end > start);
  const boundary = source.slice(start, end);
  assert.match(boundary, /selectDistinct/u);
  assert.match(
    boundary,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(boundary, /eq\(organisationMemberships\.status, "active"\)/u);
  assert.match(boundary, /eq\(organisations\.status, "active"\)/u);
  assert.match(boundary, /eq\(users\.status, "active"\)/u);
  assert.match(
    boundary,
    /lte\(organisationMemberships\.accessStartsAt, now\)/u,
  );
  assert.match(
    boundary,
    /gt\(organisationMemberships\.accessExpiresAt, now\)/u,
  );
  assert.match(boundary, /inArray\(roleGrants\.role, ORGANISATION_ROLES\)/u);
  assert.match(boundary, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(boundary, /lte\(roleGrants\.startsAt, now\)/u);
  assert.match(boundary, /gt\(roleGrants\.expiresAt, now\)/u);
  assert.match(boundary, /\.limit\(2\)/u);
  assert.match(boundary, /if \(rows\.length !== 1\)/u);
});

test("evidence recipients are revalidated in the atomic write path", async () => {
  const repositorySource = await readFile(
    new URL("./drizzleRepository.ts", import.meta.url),
    "utf8",
  );
  const policySource = await readFile(
    new URL("./authorityPolicy.ts", import.meta.url),
    "utf8",
  );
  const insertStart = repositorySource.indexOf("async insert(");
  const insertEnd = repositorySource.indexOf(
    "async compareAndSwap(",
    insertStart,
  );
  assert.ok(insertStart >= 0 && insertEnd > insertStart);
  const insert = repositorySource.slice(insertStart, insertEnd);
  assert.match(insert, /db\.transaction/u);
  assert.match(insert, /await validateBeforeWrite\?\.\(\)/u);
  assert.match(insert, /record\.kind === "evidence_request"/u);
  assert.match(insert, /assertEvidenceRequestRecipientForWrite/u);
  assert.match(insert, /transaction\s*\.insert\(workTasks\)/u);
  assert.ok(
    insert.indexOf("assertEvidenceRequestRecipientForWrite") <
      insert.indexOf(".insert(workTasks)"),
  );

  const policyStart = repositorySource.indexOf(
    "async function assertEvidenceRequestRecipientForWrite",
  );
  const policyEnd = repositorySource.indexOf(
    "function recordTitle",
    policyStart,
  );
  assert.ok(policyStart >= 0 && policyEnd > policyStart);
  const writePolicy = repositorySource.slice(policyStart, policyEnd);
  assert.match(writePolicy, /eq\(projects\.id, scope\.projectId\)/u);
  assert.match(
    writePolicy,
    /eq\(projects\.organisationId, scope\.organisationId\)/u,
  );
  assert.match(
    writePolicy,
    /clientActionRecipientPredicate\(transaction, scope, now\)/u,
  );
  assert.match(writePolicy, /validClientActionAuthorityName/u);
  assert.match(writePolicy, /\.for\("share"\)/u);

  assert.match(
    policySource,
    /clientActionRolesForPermission\("document:upload"\)/u,
  );
  assert.match(policySource, /isRoleAllowedForOrganisation\(role, type\)/u);
  assert.match(
    policySource,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(policySource, /eq\(users\.status, "active"\)/u);
  assert.match(policySource, /isNull\(roleGrants\.revokedAt\)/u);
});
