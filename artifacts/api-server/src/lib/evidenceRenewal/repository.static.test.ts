import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./repository.ts", import.meta.url),
  "utf8",
);
const lifecycleSource = await readFile(
  new URL("./approvalLifecycle.ts", import.meta.url),
  "utf8",
);

test("renewal writers use the shared authority lock then a post-wait database clock", () => {
  for (const method of [
    "createPlan",
    "stageReplacement",
    "reviewReplacement",
  ]) {
    const start = source.indexOf(`async ${method}(`);
    assert.notEqual(start, -1, `${method} must exist`);
    const body = source.slice(start, source.indexOf("\n  }\n", start) + 5);
    const authorityLock = body.indexOf("lockMembershipAuthority");
    const workflowLock = body.indexOf("lockRenewalProject");
    const clock = body.indexOf("authoritativeDatabaseNow");
    const authorityRead = body.indexOf("requireCurrentPeople");
    assert.ok(
      authorityLock >= 0 &&
        workflowLock > authorityLock &&
        clock > workflowLock &&
        authorityRead > clock,
      `${method} must check time after every blocking governance lock`,
    );
    assert.match(body, /_requestedNow: Date/u);
  }
  assert.match(source, /SELECT pg_catalog\.clock_timestamp\(\) AS now/u);
});

test("stage and promotion revalidate exact tenant/project canonical bytes", () => {
  assert.match(source, /document\.project_id = \$\{scope\.projectId\}::uuid/u);
  assert.match(source, /current_version\.malware_status = 'clean'/u);
  assert.match(source, /current_version\.quarantine_status = 'cleared'/u);
  assert.match(
    source,
    /NOT EXISTS \([\s\S]*later_version\.version_number > current_version\.version_number/u,
  );
  assert.match(source, /documentVersionId: staged\.documentVersionId/u);
  assert.match(
    lifecycleSource,
    /canonical\.documentVersionId === expected\.documentVersionId/u,
  );
  assert.match(source, /staged\.expiryDate <= today\(now\)/u);
});

test("promotion uses CAS, independent verification and content-minimised audit receipts", () => {
  assert.match(source, /current\.ownerUserId === current\.verifierUserId/u);
  assert.match(
    source,
    /stagedReplacement\?\.stagedByUserId === scope\.actorUserId/u,
  );
  assert.match(
    lifecycleSource,
    /candidateVault\.version !== expected\.expectedVaultItemVersion/u,
  );
  assert.match(source, /eq\(vaultItems\.version, vault\.version\)/u);
  assert.match(source, /sourceDocumentId: canonical\.documentId/u);
  assert.match(source, /MAX_AUDIT_RECEIPT_CODE_UNITS = 1_024/u);
  assert.match(
    source,
    /details: canonicalEvidenceRenewalJson\(auditReceipt\(event\)\)/u,
  );
  assert.doesNotMatch(
    source,
    /notificationEvents|transactionalOutbox|sendEmail|sendMessage/u,
  );
});

test("creation rejects a second active renewal for the same vault item", () => {
  assert.match(
    source,
    /plan\.vaultItemId === draft\.vaultItemId[\s\S]*plan\.status === "planned"[\s\S]*plan\.status === "replacement_staged"/u,
  );
});

test("receipt-backed reminders are assigned to the owner and never claim delivery", () => {
  assert.match(source, /ownerMembershipId: taskOwner\.membershipId/u);
  assert.match(
    source,
    /reminderDueAt: `\$\{draft\.targetDate\}T16:00:00\.000Z`/u,
  );
  assert.match(source, /recordedReceiptSha256: plan\.receipts\[0\]!\.sha256/u);
  assert.match(
    source,
    /plan\.status === "promoted" \|\| plan\.status === "rejected"[\s\S]*?\? plan\.latestReceiptSha256[\s\S]*?: null/u,
  );
  assert.match(source, /externalDeliveryReceipt: null/u);
  assert.match(
    source,
    /Renewal reminder metadata diverges from its immutable receipt/u,
  );
});

test("stage and review revalidate affected pursuits and acquire row locks sequentially", () => {
  const affectedChecks =
    source.match(/await validateAffectedPursuits\(/gu) ?? [];
  assert.ok(affectedChecks.length >= 3);
  const stageStart = source.indexOf("async stageReplacement(");
  const stageBody = source.slice(
    stageStart,
    source.indexOf("\n  }\n", stageStart) + 5,
  );
  const stageVaultLock = stageBody.indexOf("const vault = await readVaultItem");
  const stageCanonicalRead = stageBody.indexOf("currentCanonicalDocument");
  assert.ok(stageVaultLock >= 0 && stageCanonicalRead > stageVaultLock);
  assert.doesNotMatch(stageBody, /Promise\.all\([\s\S]*readVaultItem/u);

  const candidateVault = lifecycleSource.indexOf("readVaultCandidate");
  const candidateCanonical = lifecycleSource.indexOf("readCanonicalCandidate");
  const vaultForUpdate = lifecycleSource.lastIndexOf("readVaultForUpdate");
  const freshCanonical = lifecycleSource.lastIndexOf("readFreshCanonical");
  assert.ok(
    candidateVault >= 0 &&
      candidateCanonical > candidateVault &&
      vaultForUpdate > candidateCanonical &&
      freshCanonical > vaultForUpdate,
  );
  assert.doesNotMatch(lifecycleSource, /Promise\.all/u);
});

test("canonical drift blocks approval but cannot brick an independent rejection", () => {
  const start = source.indexOf("async reviewReplacement(");
  const body = source.slice(start, source.indexOf("\n  }\n", start) + 5);
  const approvalGate = body.indexOf('if (draft.decision === "approve")');
  const lifecycleGate = body.indexOf(
    "promoteEvidenceRenewalWithStorageLifecycle",
  );
  const eventAppend = body.indexOf("appendEvent");
  assert.ok(
    approvalGate >= 0 &&
      lifecycleGate > approvalGate &&
      eventAppend > lifecycleGate,
  );
  assert.match(
    body,
    /if \(draft\.decision === "approve"\) \{[\s\S]*?promoteEvidenceRenewalWithStorageLifecycle/u,
  );
  assert.doesNotMatch(body, /else \{[\s\S]*?\.update\(vaultItems\)/u);
  assert.match(lifecycleSource, /readFreshCanonical/u);
});

test("approval atomically queues the superseded path after CAS and before its receipt", () => {
  const start = source.indexOf("async reviewReplacement(");
  const body = source.slice(start, source.indexOf("\n  }\n", start) + 5);
  const transaction = body.indexOf("db.transaction(async (tx)");
  const lifecycle = body.indexOf("promoteEvidenceRenewalWithStorageLifecycle");
  const update = body.indexOf(".update(vaultItems)", lifecycle);
  const enqueue = body.indexOf("enqueueStorageDeletionIntentTx(tx", update);
  const receipt = body.indexOf("appendEvent(tx", enqueue);
  assert.ok(
    transaction >= 0 &&
      lifecycle > transaction &&
      update > lifecycle &&
      enqueue > update &&
      receipt > enqueue,
  );
  assert.match(body, /aggregateType: "vault_item"/u);
  assert.match(body, /reason: "reference_replaced"/u);
  assert.match(body, /projectId: null/u);
  assert.match(
    lifecycleSource,
    /lockedVault\.objectPath !== null &&[\s\S]*lockedVault\.objectPath !== freshCanonical\.objectPath[\s\S]*enqueueSupersededObject\(lockedVault\.objectPath\)/u,
  );
  const cleanupGate = lifecycleSource.slice(
    lifecycleSource.indexOf("lockedVault.objectPath !== null"),
    lifecycleSource.indexOf('return "promoted"'),
  );
  assert.doesNotMatch(cleanupGate, /lockedVault\.sourceDocumentId/u);
});

test("approval obtains sorted path locks before the vault row and rejects drift", () => {
  const candidateRead = lifecycleSource.indexOf("readVaultCandidate()");
  const sortedPaths = lifecycleSource.indexOf(".sort()", candidateRead);
  const pathLock = lifecycleSource.indexOf("lockObjectPath(objectPath)");
  const vaultRowLock = lifecycleSource.lastIndexOf("readVaultForUpdate()");
  const vaultDrift = lifecycleSource.indexOf(
    "!unchangedVault(candidateVault, lockedVault)",
  );
  const canonicalDrift = lifecycleSource.indexOf(
    "!unchangedCanonical(candidateCanonical, freshCanonical)",
  );
  assert.ok(
    candidateRead >= 0 &&
      sortedPaths > candidateRead &&
      pathLock > sortedPaths &&
      vaultRowLock > pathLock &&
      vaultDrift > vaultRowLock &&
      canonicalDrift > vaultDrift,
  );
  assert.match(
    source,
    /readVaultForUpdate:[\s\S]*?readVaultItem\([\s\S]*?current\.vaultItemId,[\s\S]*?true,[\s\S]*?\)/u,
  );
  assert.match(source, /const rows = lock \? await query\.for\("update"\)/u);
});

test("all affected project facts are locked in sorted order through each receipt append", () => {
  const start = source.indexOf("async function validateAffectedPursuits(");
  const body = source.slice(start, source.indexOf("\n}\n", start) + 3);
  assert.match(body, /\.orderBy\(asc\(projects\.id\)\)/u);
  assert.match(body, /\.for\("share"\)/u);
  assert.match(source, /SET LOCAL lock_timeout = '3s'/u);
});

test("staging does not create a project-document FK that blocks certified retention", () => {
  assert.doesNotMatch(source, /vaultItemVersions|vault_item_versions/u);
  assert.match(source, /expectedVaultItemVersion: vault\.version/u);
  assert.match(source, /eq\(vaultItems\.version, vault\.version\)/u);
});
