import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("./tenderContextDrizzleRepository.ts", import.meta.url),
  "utf8",
);

test("tender writes recheck direct authority in their tenant transaction", () => {
  assert.match(source, /withTenantDatabase\(scope\.organisationId/u);
  assert.match(source, /this\.database\.transaction/u);
  assert.match(source, /organisationMemberships\.delegatedByMembershipId/u);
  assert.match(source, /organisationMemberships\.accessStartsAt/u);
  assert.match(source, /organisationMemberships\.accessExpiresAt/u);
  assert.match(source, /roleGrants\.revokedAt/u);
  assert.match(source, /PROPOSE_PERMISSIONS/u);
  assert.match(source, /REVIEW_PERMISSIONS/u);
});

test("maker-checker review rejects the source-record creator", () => {
  assert.equal(
    [...source.matchAll(/current\.createdByUserId === actor\.id/gu)].length,
    2,
  );
});

test("acceptance locks and CAS-supersedes at most one exact predecessor", () => {
  assert.match(
    source,
    /eq\(tenderContextVersions\.status, "accepted"\)[\s\S]*\.limit\(2\)[\s\S]*\.for\("update"\)/u,
  );
  assert.match(source, /if \(acceptedRows\.length > 1\)/u);
  assert.match(
    source,
    /eq\(tenderContextVersions\.id, acceptedPredecessor\.id\)[\s\S]*eq\([\s\S]*tenderContextVersions\.version,[\s\S]*acceptedPredecessor\.version/u,
  );
  assert.match(source, /if \(superseded\.length !== 1\)/u);
  assert.match(source, /eventType: "tender_context\.superseded"/u);
  assert.match(source, /supersededByContextVersionId: contextVersionId/u);
  assert.doesNotMatch(
    source,
    /status: "superseded",[\s\S]{0,500}sql`\$\{tenderContextVersions\.version\} \+ 1`/u,
  );
});

test("context and eligibility sources are immutable and audited", () => {
  assert.match(source, /tenderContextRequirements\)\.values/u);
  assert.match(source, /tenderContextArtifacts\)\.values/u);
  assert.match(
    source,
    /verifyBindings\(transaction, scope, context, snapshot\)/u,
  );
  assert.match(source, /async function revalidateCurrentArtifactAuthority\(/u);
  for (const currentAuthorityField of [
    "row.item.status",
    "row.item.sourceDocumentId",
    "row.itemVersion.verificationState",
    "row.itemVersion.withdrawnAt",
  ]) {
    assert.match(
      source,
      new RegExp(currentAuthorityField.replace(".", "\\."), "u"),
    );
  }
  assert.match(
    source,
    /row\.snapshot\.documentVersionSha256[\s\S]*row\.documentVersion\.sha256/u,
  );
  assert.match(source, /citationQuoteSha256: sha256Text/u);
  assert.match(source, /eventType: "tender_context\.created"/u);
  assert.match(source, /eventType: "tender_context\.reviewed"/u);
  assert.match(source, /eventType: "tender_eligibility_passport\.created"/u);
  assert.match(source, /eventType: "tender_eligibility_passport\.reviewed"/u);
});

test("derived persistence envelopes are bounded before any authoritative insert", () => {
  const contextBound = source.indexOf(
    "TENDER_CONTEXT_BOUNDS.sourceManifestCodeUnits",
  );
  const contextInsert = source.indexOf(
    "transaction.insert(tenderContextVersions)",
  );
  const resultBound = source.indexOf(
    "TENDER_CONTEXT_BOUNDS.eligibilityResultCodeUnits",
  );
  const passportInsert = source.indexOf(
    "transaction.insert(tenderEligibilityPassports)",
  );
  assert.ok(contextBound >= 0 && contextBound < contextInsert);
  assert.ok(resultBound >= 0 && resultBound < passportInsert);
  for (const bound of [
    "sourceManifestBytes",
    "contextSnapshotCodeUnits",
    "contextSnapshotBytes",
    "ruleAdvisoriesCodeUnits",
    "ruleAdvisoriesBytes",
    "eligibilityResultBytes",
  ]) {
    assert.match(source, new RegExp(`TENDER_CONTEXT_BOUNDS\\.${bound}`, "u"));
  }
  assert.equal(
    [...source.matchAll(/serializedTenderValueWithinBound\(/gu)].length,
    4,
  );
});
