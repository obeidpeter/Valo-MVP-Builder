import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = readFileSync(
  new URL("./drizzleRepository.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
const contracts = readFileSync(
  new URL("./contracts.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../routes/deliveryStudio.ts", import.meta.url),
  "utf8",
);

test("source fingerprint binds current tender, addendum, requirement and evidence state", () => {
  for (const source of [
    "documents",
    "documentVersions",
    "documentVersionSnapshots",
    "requirements",
    "evidenceItems",
    "draftVersions",
    "draftClaims",
    "claimEvidenceLinks",
  ]) {
    assert.match(repository, new RegExp(`\\b${source}\\b`, "u"));
  }
  assert.match(repository, /canonicalTextSha256/u);
  assert.match(repository, /textSha256:\s*sha256Text\(text\)/u);
  assert.match(
    repository,
    /excerptSha256:\s*excerpt\s*!==\s*null\s*\?\s*sha256Text/u,
  );
  assert.match(
    repository,
    /expectedEvidenceSha256:\s*expectedEvidence\s*!==\s*null/u,
  );
  const receiptBody = repository.slice(
    repository.indexOf("function responseReviewPayload("),
    repository.indexOf("async function mutate("),
  );
  assert.doesNotMatch(receiptBody, /canonicalText/u);
});

test("claim approval is independent and cannot override deterministic blockers", () => {
  assert.match(
    repository,
    /claim\.authorUserId\s*===\s*input\.scope\.actorUserId/u,
  );
  assert.match(repository, /hasStoredBlocker/u);
  assert.match(
    repository,
    /new Set\(\["factual", "instructional"\]\)\.has\(claim\.claimKind\)/u,
  );
  assert.match(repository, /claimEvidenceLinks\.draftClaimId/u);
  assert.match(
    repository,
    /action\.decision\s*===\s*"accepted"[\s\S]*?\?\s*"approved"/u,
  );
  assert.match(repository, /currentActiveEvidenceLinkIds\(/u);
  assert.match(repository, /row\.snapshotStatus\s*===\s*"verified"/u);
  assert.match(
    repository,
    /eligibleRedactionStatus\(row\.capturedRedactionStatus\)/u,
  );
  assert.match(
    repository,
    /latest\.get\(row\.documentId\)\s*===\s*row\.versionNumber/u,
  );
});

test("response citations are bound to reviewed structured page spans", () => {
  assert.match(repository, /parseProposedStructuredSnapshot\(/u);
  assert.match(repository, /structuredSnapshotSha256/u);
  assert.match(repository, /span\.page\s*!==\s*citation\.pageNumber/u);
  assert.match(repository, /span\.value\.includes\(citation\.quote\)/u);
  assert.match(repository, /startOffset\s*-\s*span\.startOffset/u);
  assert.match(
    repository,
    /canonicalPageText:\s*boundSpan\?\.canonicalPageText/u,
  );
  assert.doesNotMatch(repository, /canonicalPageText:\s*row\.canonicalText/u);
  assert.match(repository, /COMPANY_EVIDENCE_DOCUMENT_TYPES/u);
  assert.match(repository, /bindDeliveryStudioSingleUnitCitation\(/u);
  assert.match(contracts, /pageCount !== null && pageCount !== 1/u);
  assert.match(repository, /boundSpan\s*!==\s*null/u);
});

test("red-team approval and package assembly remain bound to current state", () => {
  assert.match(
    repository,
    /projectId:\s*input\.projectId,[\s\S]*?ifMatch:\s*input\.ifMatch,[\s\S]*?data:\s*input\.data/u,
  );
  assert.match(repository, /latest\.status\s*!==\s*"ready_for_approval"/u);
  assert.match(
    repository,
    /eq\(redTeamRuns\.sourceSnapshotHash, sourceSnapshotHash\)/u,
  );
  assert.match(repository, /if \(existingRun\)/u);
  assert.match(repository, /latest\.sourceSnapshotHash\s*!==\s*currentHash/u);
  assert.ok(
    (
      repository.match(/snapshot\.responseStudio\.status\s*!==\s*"ready"/gu) ??
      []
    ).length >= 3,
  );
  assert.match(
    repository,
    /snapshot\.redTeamReview\.status\s*!==\s*"approved"/u,
  );
});

test("rehearsal exact-binds package files and authoritative server sources", () => {
  assert.match(repository, /version\.packageType\s*!==\s*"submission"/u);
  assert.match(
    repository,
    /canonicalJson\(expectedFiles\)\s*!==\s*canonicalJson\(suppliedFiles\)/u,
  );
  assert.match(repository, /manifestSourceContent/u);
  assert.match(
    repository,
    /file\.sizeText\s*!==\s*`\$\{file\.sizeBytes\} bytes`/u,
  );
  assert.match(repository, /mappingReferencesValid/u);
  assert.match(repository, /deliveryStudioRehearsalManifestTitle/u);
  assert.match(repository, /deliveryStudioRehearsalManifestOrigin/u);
  assert.match(repository, /source\.authority\s*!==\s*"authoritative"/u);
  assert.match(repository, /structured\.sourceKind\s*!==\s*source\.kind/u);
  assert.match(repository, /structured\.origin\s*!==\s*source\.origin/u);
  assert.match(repository, /row\.filename\s*!==\s*source\.title/u);
  assert.match(repository, /row\.canonicalText\s*!==\s*source\.content/u);
  assert.match(repository, /row\.snapshotStatus\s*!==\s*"verified"/u);
  assert.match(repository, /row\.malwareStatus\s*!==\s*"clean"/u);
  assert.match(repository, /row\.quarantineStatus\s*!==\s*"cleared"/u);
  assert.match(
    repository,
    /review\.reviewerId\s*!==\s*input\.scope\.actorUserId/u,
  );
  assert.match(
    contracts,
    /`Mapping: \$\{file\.filename\} assigned to \$\{mapping\.fieldLabel\}\. \$\{mapping\.rationale\}`/u,
  );
});

test("all mutations fail closed for released and archived projects", () => {
  assert.match(
    repository,
    /TERMINAL_PROJECT_STATUSES\s*=\s*new Set\(\[\s*"signed_off",\s*"exported",\s*"archived",?\s*\]\)/u,
  );
  assert.match(
    repository,
    /TERMINAL_PROJECT_STATUSES\.has\(project\.status\)/u,
  );
  assert.ok(
    repository.indexOf("TERMINAL_PROJECT_STATUSES.has(project.status)") <
      repository.indexOf("const target = await applyAction(effectiveInput)"),
  );
});

test("response writes are aggregate-bounded and projection failures roll back", () => {
  assert.match(repository, /otherCurrentResponse/u);
  assert.match(repository, /countDistinct\(drafts\.id\)/u);
  assert.match(repository, /projectedSections\s*>\s*500/u);
  assert.match(repository, /projectedClaims\s*>\s*500/u);
  assert.match(repository, /projectedCitations\s*>\s*500/u);
  assert.ok(
    repository.indexOf("projectedSections > 500") <
      repository.indexOf(".insert(draftVersions)"),
  );
  assert.match(
    service,
    /post-mutation projection failed; the request must roll back/u,
  );
  assert.match(service, /mutation\.outcome === "recorded"/u);
});

test("idempotency is rechecked under the project lock", () => {
  const lock = repository.indexOf('.for("update")');
  const lockedReplay = repository.indexOf("const [lockedPrior]", lock);
  const terminalCheck = repository.indexOf(
    "TERMINAL_PROJECT_STATUSES.has(project.status)",
    lock,
  );
  const staleCheck = repository.indexOf(
    "project.version !== input.ifMatch",
    lock,
  );
  assert.ok(
    lock >= 0 &&
      lockedReplay > lock &&
      terminalCheck > lockedReplay &&
      staleCheck > terminalCheck,
  );
  assert.match(
    repository,
    /lockedPrior[\s\S]*payload\?\.requestDigest !== requestDigest/u,
  );
  assert.match(
    repository,
    /\.onConflictDoNothing\(\{ target: reviews\.id \}\)/u,
  );
  assert.match(repository, /if \(!insertedReceipt\)/u);
});

test("blocking findings cannot be note-cleared and approval attestations remain reviewable", () => {
  assert.match(
    repository,
    /finding\.severity === "fatal" \|\| finding\.severity === "likely_fatal"/u,
  );
  assert.match(repository, /attestation: input\.data\.attestation\.trim\(\)/u);
  assert.match(repository, /approvalAttestation/u);
  assert.match(contracts, /readonly approvalAttestation: string \| null/u);
});

test("portfolio summaries are batched and recompute current source freshness", () => {
  const portfolioBody = repository.slice(
    repository.indexOf("async function portfolio("),
    repository.indexOf("export class DrizzleDeliveryStudioRepository"),
  );
  assert.doesNotMatch(portfolioBody, /loadSnapshot\(/u);
  assert.match(repository, /PORTFOLIO_CHUNK_SIZE\s*=\s*25/u);
  assert.match(repository, /loadPortfolioSummaryChunk\(/u);
  assert.match(repository, /selectDistinctOn\(\[redTeamRuns\.projectId\]/u);
  assert.match(repository, /selectDistinctOn\(\[packages\.projectId\]/u);
  assert.match(repository, /selectDistinctOn\(\[reviews\.projectId\]/u);
  assert.match(repository, /PORTFOLIO_RAW_CITATION_BYTES/u);
  assert.match(repository, /sourceSnapshotHash\s*=\s*sha256Text\(/u);
  assert.match(
    repository,
    /source\.snapshotVersionSha256 === source\.versionSha256/u,
  );
  assert.match(
    repository,
    /TERMINAL_PROJECT_STATUSES\.has\(input\.projectStatus\)[\s\S]*Released pursuit is read-only/u,
  );
});

test("source hash can run on the caller's locked transaction", () => {
  assert.match(repository, /export type DeliveryStudioQueryExecutor/u);
  assert.match(
    repository,
    /computeCurrentDeliveryStudioSourceSnapshotHash\([\s\S]*query: DeliveryStudioQueryExecutor = db/u,
  );
  assert.match(repository, /sourceSnapshotProjection\([\s\S]*query,[\s\S]*\)/u);
});

test("delivery workflow invokes only deterministic proposal engines", () => {
  assert.match(service, /validateCitationFirstResponse\(/u);
  assert.match(repository, /buildPortalSubmissionRehearsal\(/u);
  assert.doesNotMatch(service, /proposeOutcomeLessons\(/u);
  assert.match(service, /Lesson derivation is unavailable/u);
  assert.doesNotMatch(service, /\bfetch\s*\(/u);
  assert.doesNotMatch(service, /openai|anthropic|portal credential/iu);
  assert.match(contracts, /externalPortalAction:\s*false/u);
});

test("route requires current direct authority, bounded bodies and commit-before-response", () => {
  assert.match(route, /resolveCurrentDirectAuthority/u);
  assert.match(route, /authority\.permissions\.has\(permission\)/u);
  assert.match(route, /createBoundedJsonBody\(4_000_000/u);
  assert.match(route, /response\.status\(428\)/u);
  assert.match(route, /await commitBeforeResponse\(request\)/u);
  assert.ok(
    route.indexOf("await commitBeforeResponse(request)") <
      route.indexOf("response.status(result.outcome"),
  );
});
