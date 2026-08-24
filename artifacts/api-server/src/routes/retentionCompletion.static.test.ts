import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("../lib/retentionCompletion/drizzleRepository.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("./retentionCompletion.ts", import.meta.url),
  "utf8",
);
const projects = readFileSync(
  new URL("./projects.ts", import.meta.url),
  "utf8",
);

test("durable completion queues storage and delegates relational purge without direct blobs", () => {
  assert.match(repository, /enqueueStorageDeletionIntentTx\(tx/u);
  assert.match(repository, /lockStagedUploadObject/u);
  assert.match(repository, /purge_retention_project/u);
  assert.doesNotMatch(repository, /deleteObjectEntity|ObjectStorageService/u);
  assert.doesNotMatch(repository, /\.delete\(|DELETE\s+FROM/iu);
  assert.doesNotMatch(
    projects,
    /planProjectBlobPurge|purgeBlobs|ObjectStorageService/u,
  );
});

test("source and terminal evidence stay bounded and fail closed", () => {
  assert.match(repository, /CATEGORY_IDENTITY_LIMIT \+ 1/u);
  assert.match(repository, /SOURCE_TOTAL_IDENTITY_LIMIT \+ 1/u);
  for (const category of [
    "legal_holds",
    "orders",
    "invoices",
    "payments",
    "entitlement_usage",
    "vault_items",
    "audit_events",
    "document_version_snapshots",
    "requirement_citations",
    "conflict_records",
    "processing_runs",
    "notification_events",
    "notification_attempts",
    "boq_exceptions",
    "draft_versions",
    "draft_claims",
    "claim_evidence_links",
    "red_team_findings",
    "addendum_impact_items",
    "package_manifest_items",
    "approvals",
    "boq_checks",
    "capability_usage",
    "comments",
    "engagement_tender_lots",
    "evidence_items",
    "llm_runs",
    "outcomes",
    "reviews",
    "rule_evaluations",
    "vault_usage",
  ]) {
    assert.match(repository, new RegExp(`["']${category}["']`, "u"));
  }
  assert.match(
    repository,
    /terminalDisposition === "cancelled_referenced"[\s\S]*terminalDisposition === "accepted_unresolved"/u,
  );
  assert.match(repository, /code: "storage_terminal_untrusted"/u);
  assert.match(repository, /code: "governed_evidence_retained"/u);
  for (const selector of [
    "vaultItemVersions",
    "capabilityEvidenceLinks",
    "packageSignoffs",
    "exportDeliveries",
    "ruleOverrides",
    "externalConflictLineageRows",
    "otherRetentionRequestRows",
    "externalCapabilityDocumentRows",
    "externalRenewalNotificationRows",
    "externalVaultSourceRows",
    "projectBoundRetentionEventRows",
    "externalProjectLineageRows",
  ]) {
    assert.match(repository, new RegExp(selector, "u"));
  }
  for (const lineage of [
    "requirement_source_document",
    "evidence_document",
    "evidence_requirement",
    "boq_check_document",
    "defect_requirement",
    "defect_decision",
    "addendum_document_version",
    "boq_run_document_version",
    "context_artifact_document_version",
    "context_artifact_context",
    "context_primary_document_version",
    "context_successor",
    "draft_processing_run",
    "processing_job_document_version",
    "work_task_requirement",
    "context_requirement",
    "context_requirement_context",
    "eligibility_context",
    "requirement_citation_document_version",
    "claim_document_version",
  ]) {
    assert.match(repository, new RegExp(`'${lineage}'`, "u"));
  }
  assert.match(repository, /order\.status !== "paid_manual"/u);
  assert.match(repository, /invoice\.invoiceStatus !== "paid_manual"/u);
  assert.match(repository, /payment\.status !== "settled"/u);
  assert.match(
    repository,
    /payment\.reconciliationStatus !== "verified_manual"/u,
  );
});

test("owner purge proof and named phase authority gate every terminal transition", () => {
  assert.match(repository, /verifyOwnerPurgeProof\(tx, action, request\)/u);
  assert.match(repository, /action\.version !== 3/u);
  assert.match(repository, /updated\[0\]!\.version !== 4/u);
  assert.match(repository, /action\.version !== 4/u);
  assert.match(repository, /updated\[0\]!\.version !== 5/u);
  assert.match(repository, /purgeReceiptSha256/u);
  assert.match(repository, /postPurgeActionVersion !== 3/u);
  assert.match(repository, /executedByName: authority\.actorName/u);
  assert.match(repository, /preparedByName: authority\.actorName/u);
  assert.match(repository, /checkedByName: authority\.actorName/u);
  assert.match(repository, /rows\.length === 1 \? rows\[0\] : undefined/u);
  assert.match(repository, /actorName !== row\.actor\.name/u);
});

test("detach retries only a bounded PostgreSQL deadlock victim transaction", () => {
  assert.match(repository, /RETENTION_DETACH_DEADLOCK_ATTEMPTS = 3/u);
  assert.match(repository, /postgresErrorCode\(error\) === "40P01"/u);
  assert.match(
    repository,
    /withDetachPersistenceBoundary[\s\S]*retryDeadlock: true/u,
  );
  assert.match(
    repository,
    /async detach\([\s\S]*withDetachPersistenceBoundary\(async/u,
  );
});

test("completion snapshots ignore legacy protocol actions", () => {
  assert.match(
    repository,
    /async function buildSnapshot[\s\S]*eq\(retentionActions\.completionProtocolVersion, 1\)[\s\S]*const action = actions\[0\] \?\? null/u,
  );
});

test("routes expose explicit detach, reconcile and certify CAS controls", () => {
  for (const path of [
    "/retention-requests/:id/complete",
    "/retention-actions/:id/reconcile",
    "/retention-actions/:id/certify",
  ]) {
    assert.match(route, new RegExp(path.replaceAll("/", "\\/"), "u"));
  }
  assert.match(route, /parseExpectedVersion\(request\.get\("If-Match"\)\)/u);
  assert.match(route, /request\.get\("Idempotency-Key"\)/u);
  assert.match(route, /commitBeforeResponse\(request\)/u);
});
