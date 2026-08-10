import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildIntelligenceCentreSnapshot,
  INTELLIGENCE_CAPABILITY_IDS,
  type ProjectIntelligenceInput,
} from "./snapshot";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function input(): ProjectIntelligenceInput {
  return {
    environment: "production",
    productionAiEnabled: false,
    generatedAt: "2026-08-10T12:00:00.000Z",
    project: {
      id: "project-1",
      title: "Road rehabilitation",
      status: "review",
      deadline: "2026-09-01T11:00:00.000Z",
      restrictedMode: false,
      outcome: "none",
      outcomeClientConfirmed: false,
    },
    documents: [],
    documentVersions: [],
    requirements: [],
    requirementCitations: [],
    evidence: [],
    defects: [],
    boqChecks: [],
    vaultItems: [],
    capabilityItems: [],
    drafts: [],
    draftVersions: [],
    draftClaims: [],
    workTasks: [],
    opportunities: [],
    packages: [],
    packageVersions: [],
    packageSignoffs: [],
    reportStatuses: [],
  };
}

function addSafeDocument(
  value: ProjectIntelligenceInput,
  options: {
    id: string;
    contentText: string;
    sha?: string;
    addendumStatus?: string;
    type?: string;
  },
): void {
  const hash = options.sha ?? sha256(options.contentText);
  value.documents.push({
    id: options.id,
    projectId: value.project.id,
    filename: `${options.id}.pdf`,
    type: options.type ?? "tender",
    redactionStatus: "included",
    extractionStatus: "extracted",
    sha256: hash,
    contentText: options.contentText,
    updatedAt: "2026-08-10T09:00:00.000Z",
  });
  value.documentVersions.push({
    id: `version-${options.id}`,
    documentId: options.id,
    versionNumber: 1,
    sha256: hash,
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    addendumStatus: options.addendumStatus ?? "no_change",
    createdAt: "2026-08-10T09:00:00.000Z",
  });
}

function addGroundedRequirement(
  value: ProjectIntelligenceInput,
  options: {
    requirementId?: string;
    documentId?: string;
    snippet?: string;
    reviewStatus?: string;
  } = {},
): void {
  const requirementId = options.requirementId ?? "requirement-1";
  const documentId = options.documentId ?? "doc-1";
  const snippet =
    options.snippet ??
    "The bidder shall provide a current tax clearance certificate.";
  addSafeDocument(value, {
    id: documentId,
    contentText: `Tender clause: ${snippet}`,
  });
  value.requirements.push({
    id: requirementId,
    text: "Provide a current tax clearance certificate.",
    category: "eligibility",
    isMandatory: true,
    reviewStatus: options.reviewStatus ?? "confirmed",
    sourceDocId: documentId,
    pageRef: "14",
    clauseRef: "3.2",
    updatedAt: "2026-08-10T09:02:00.000Z",
  });
  value.requirementCitations.push({
    id: `citation-${requirementId}`,
    requirementId,
    documentVersionId: `version-${documentId}`,
    pageNumber: 14,
    paragraphRef: "Clause 3.2",
    sourceSnippet: snippet,
    sourceSnippetHash: sha256(snippet),
    verificationStatus: "verified",
    verifiedByUserId: "reviewer-1",
    verifiedByName: "Amina Reviewer",
    verifiedAt: "2026-08-10T09:03:00.000Z",
    updatedAt: "2026-08-10T09:03:00.000Z",
  });
  value.evidence.push({
    id: `evidence-${requirementId}`,
    requirementId,
    documentId,
    evidenceStatus: "present",
    excerpt: "current tax clearance certificate",
    suggested: false,
    confirmedBy: "reviewer-1",
    updatedAt: "2026-08-10T09:04:00.000Z",
  });
}

test("emits all ten capabilities without treating missing evidence as approval", () => {
  const snapshot = buildIntelligenceCentreSnapshot(input());

  assert.deepEqual(
    snapshot.capabilities.map((capability) => capability.id),
    INTELLIGENCE_CAPABILITY_IDS,
  );
  assert.equal(snapshot.capabilities.length, 10);
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "evidence_graph")?.state,
    "empty",
  );
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "grounded_copilot")?.state,
    "production_disabled",
  );
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "award_handoff")?.state,
    "empty",
  );
});

test("surfaces reviewed, cited evidence and deterministic blockers without authorising release", () => {
  const value = input();
  value.documents.push(
    {
      id: "doc-1",
      projectId: "project-1",
      filename: "tender.pdf",
      type: "tender",
      redactionStatus: "included",
      extractionStatus: "extracted",
      sha256: "a".repeat(64),
      contentText:
        "The bidder shall provide a current tax clearance certificate.",
      updatedAt: "2026-08-10T09:00:00.000Z",
    },
    {
      id: "boq-1",
      projectId: "project-1",
      filename: "boq.xlsx",
      type: "boq",
      redactionStatus: "included",
      extractionStatus: "skipped",
      sha256: "b".repeat(64),
      updatedAt: "2026-08-10T09:01:00.000Z",
    },
  );
  value.documentVersions.push({
    id: "version-1",
    documentId: "doc-1",
    versionNumber: 1,
    sha256: "a".repeat(64),
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    addendumStatus: "not_assessed",
    createdAt: "2026-08-10T09:00:00.000Z",
  });
  value.requirements.push({
    id: "requirement-1",
    text: "Provide a current tax clearance certificate.",
    category: "eligibility",
    isMandatory: true,
    reviewStatus: "confirmed",
    sourceDocId: "doc-1",
    pageRef: "14",
    clauseRef: "3.2",
    updatedAt: "2026-08-10T09:02:00.000Z",
  });
  value.requirementCitations.push({
    id: "citation-1",
    requirementId: "requirement-1",
    documentVersionId: "version-1",
    pageNumber: 14,
    paragraphRef: "Clause 3.2",
    sourceSnippet:
      "The bidder shall provide a current tax clearance certificate.",
    sourceSnippetHash: sha256(
      "The bidder shall provide a current tax clearance certificate.",
    ),
    verificationStatus: "verified",
    verifiedByUserId: "reviewer-1",
    verifiedByName: "Amina Reviewer",
    verifiedAt: "2026-08-10T09:03:00.000Z",
    updatedAt: "2026-08-10T09:03:00.000Z",
  });
  value.evidence.push({
    id: "evidence-1",
    requirementId: "requirement-1",
    documentId: "doc-1",
    evidenceStatus: "present",
    excerpt: "current tax clearance certificate",
    suggested: false,
    confirmedBy: "reviewer-1",
    updatedAt: "2026-08-10T09:04:00.000Z",
  });
  value.boqChecks.push({
    id: "boq-check-1",
    sourceDocId: "boq-1",
    status: "flagged",
    severity: "likely_fatal",
    updatedAt: "2026-08-10T09:05:00.000Z",
  });

  const snapshot = buildIntelligenceCentreSnapshot(value);
  const graph = snapshot.capabilities.find(({ id }) => id === "evidence_graph");
  const preflight = snapshot.capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  const boq = snapshot.capabilities.find(({ id }) => id === "boq_sanity");

  assert.equal(graph?.state, "review_ready");
  assert.equal(graph?.citationCount, 1);
  assert.equal(graph?.citations[0]?.sourceName, "tender.pdf");
  assert.match(graph?.citations[0]?.locator ?? "", /Page 14/);
  assert.deepEqual(Object.keys(graph?.citations[0] ?? {}).sort(), [
    "excerpt",
    "id",
    "locator",
    "sourceName",
  ]);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /sourceSnippetHash|sourceVersionSha256|verifiedByUserId|verifiedByName|verifiedAt|malwareStatus|quarantineStatus|lifecycleState/u,
  );
  assert.equal(preflight?.state, "partial");
  assert.match(preflight?.summary ?? "", /1 BOQ binding gap/);
  assert.equal(boq?.state, "partial");
  assert.equal(boq?.reviewItemCount, 2);
  assert.equal(boq?.citationCount, 0);
});

test("does not let an unrelated citation cover an accepted requirement with cross-project or missing versions", () => {
  const value = input();
  addGroundedRequirement(value);
  addGroundedRequirement(value, {
    requirementId: "requirement-rejected",
    documentId: "doc-rejected",
    snippet: "The authority may reject late submissions.",
    reviewStatus: "rejected",
  });

  value.documents.push({
    id: "doc-foreign",
    projectId: "project-2",
    filename: "foreign.pdf",
    type: "tender",
    redactionStatus: "included",
    extractionStatus: "extracted",
    sha256: "f".repeat(64),
    contentText:
      "The bidder shall provide a current tax clearance certificate.",
  });
  value.documentVersions.push({
    id: "version-foreign",
    documentId: "doc-foreign",
    versionNumber: 1,
    sha256: "f".repeat(64),
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    addendumStatus: "no_change",
  });
  value.requirementCitations[0]!.documentVersionId = "version-foreign";
  value.requirementCitations.push({
    ...value.requirementCitations[0]!,
    id: "citation-missing-version",
    documentVersionId: "version-missing",
  });

  const graph = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "evidence_graph",
  );

  assert.equal(graph?.state, "partial");
  assert.equal(graph?.citationCount, 0);
  assert.deepEqual(graph?.citations, []);
  assert.match(graph?.summary ?? "", /1 citation gap/);
});

test("fails citation coverage closed for unsafe lifecycle, hash mismatch, or unnamed verification", async (t) => {
  const cases: Array<[string, (value: ProjectIntelligenceInput) => void]> = [
    [
      "malware",
      (value) => {
        value.documentVersions[0]!.malwareStatus = "infected";
      },
    ],
    [
      "quarantine",
      (value) => {
        value.documentVersions[0]!.quarantineStatus = "quarantined";
      },
    ],
    [
      "snippet hash",
      (value) => {
        value.requirementCitations[0]!.sourceSnippetHash = "f".repeat(64);
      },
    ],
    [
      "verifier",
      (value) => {
        value.requirementCitations[0]!.verifiedByName = null;
      },
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const value = input();
      addGroundedRequirement(value);
      mutate(value);
      const graph = buildIntelligenceCentreSnapshot(value).capabilities.find(
        ({ id }) => id === "evidence_graph",
      );
      assert.equal(graph?.state, "partial");
      assert.equal(graph?.citationCount, 0);
      assert.deepEqual(graph?.citations, []);
    });
  }
});

test("requires every current response draft and claim to be immutably bound and grounded", () => {
  const value = input();
  value.drafts.push({
    id: "draft-1",
    status: "draft",
    currentVersionNumber: 1,
  });
  value.draftVersions.push({
    id: "draft-version-1",
    draftId: "draft-1",
    versionNumber: 1,
    contentHash: "c".repeat(64),
    authorUserId: "author-1",
  });

  let studio = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "response_studio",
  );
  assert.equal(studio?.state, "partial");

  value.draftClaims.push({
    id: "claim-1",
    draftVersionId: "draft-version-1",
    groundingStatus: "verified",
    reviewerUserId: "reviewer-1",
    reviewedAt: "2026-08-10T10:00:00.000Z",
  });
  studio = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "response_studio",
  );
  assert.equal(studio?.state, "review_ready");

  value.draftClaims.push({
    id: "claim-unbound",
    draftVersionId: "draft-version-old",
    groundingStatus: "verified",
    reviewerUserId: "reviewer-1",
    reviewedAt: "2026-08-10T10:00:00.000Z",
  });
  studio = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "response_studio",
  );
  assert.equal(studio?.state, "partial");

  value.draftClaims.pop();
  value.drafts.push({
    id: "draft-2",
    status: "draft",
    currentVersionNumber: 1,
  });
  value.draftVersions.push({
    id: "draft-version-2",
    draftId: "draft-2",
    versionNumber: 1,
    contentHash: "d".repeat(64),
    authorUserId: "author-2",
  });
  studio = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "response_studio",
  );
  assert.equal(studio?.state, "partial");
});

test("requires active hash-bound Vault evidence with named capability verification", () => {
  const value = input();
  addSafeDocument(value, {
    id: "vault-doc",
    contentText: "Verified company registration evidence.",
  });
  const sourceHash = value.documents[0]!.sha256!;
  value.vaultItems.push({
    id: "vault-1",
    artefactType: "company_registration",
    status: "active",
    expiryDate: "2027-08-10T12:00:00.000Z",
    sourceDocumentId: "vault-doc",
    sha256: sourceHash,
  });
  value.capabilityItems.push({
    id: "capability-1",
    claimType: "registration",
    approvedStatus: "approved",
    evidenceDocId: "vault-doc",
    verifierId: "reviewer-1",
    verifierName: "Amina Reviewer",
    verifiedAt: "2026-08-10T10:00:00.000Z",
  });

  let passport = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "eligibility_passport",
  );
  assert.equal(passport?.state, "review_ready");

  value.vaultItems[0]!.status = "inactive";
  passport = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "eligibility_passport",
  );
  assert.equal(passport?.state, "partial");

  value.vaultItems[0]!.status = "active";
  value.capabilityItems[0]!.verifierName = null;
  passport = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "eligibility_passport",
  );
  assert.equal(passport?.state, "partial");
});

test("scopes opportunity signals to the selected project's tender reference", () => {
  const value = input();
  value.project.tenderReference = "TENDER-1";
  value.opportunities.push(
    {
      id: "tender-1",
      reference: "TENDER-1",
      title: "Selected pursuit",
      sourceType: "manual",
      status: "open",
    },
    {
      id: "tender-2",
      reference: "TENDER-2",
      title: "Unrelated pursuit",
      sourceType: "manual",
      status: "open",
    },
  );

  let radar = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "opportunity_radar",
  );
  assert.equal(radar?.state, "review_ready");
  assert.equal(radar?.reviewItemCount, 1);

  value.project.tenderReference = null;
  radar = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "opportunity_radar",
  );
  assert.equal(radar?.state, "empty");
  assert.equal(radar?.reviewItemCount, 0);
});

test("keeps uncited clarification candidates partial until every candidate has a verified project citation", () => {
  const value = input();
  addGroundedRequirement(value, { reviewStatus: "suggested" });
  const citation = value.requirementCitations.pop()!;

  let assistant = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "clarification_assistant",
  );
  assert.equal(assistant?.state, "partial");
  assert.equal(assistant?.citationCount, 0);
  assert.doesNotMatch(assistant?.stateReason ?? "", /source-linked/u);

  value.requirementCitations.push(citation);
  assistant = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "clarification_assistant",
  );
  assert.equal(assistant?.state, "review_ready");
  assert.equal(assistant?.citationCount, 1);
});

test("BOQ sanity requires every current-record check to bind to a safe in-project BOQ", () => {
  const value = input();
  addSafeDocument(value, {
    id: "boq-safe",
    type: "boq",
    contentText: "Item 1, quantity 5, unit rate 20.",
  });
  value.boqChecks.push({
    id: "boq-check-safe",
    sourceDocId: "boq-safe",
    status: "cleared",
    severity: "advisory",
  });

  let sanity = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "boq_sanity",
  );
  assert.equal(sanity?.state, "review_ready");
  assert.match(sanity?.stateReason ?? "", /current-record/u);
  assert.match(sanity?.stateReason ?? "", /not version-proven/u);

  value.documentVersions[0]!.malwareStatus = "infected";
  sanity = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "boq_sanity",
  );
  assert.equal(sanity?.state, "partial");

  const unrelated = input();
  addSafeDocument(unrelated, {
    id: "boq-local",
    type: "boq",
    contentText: "Item 1, quantity 5, unit rate 20.",
  });
  unrelated.documents.push({
    id: "boq-foreign",
    projectId: "project-2",
    filename: "foreign-boq.xlsx",
    type: "boq",
    redactionStatus: "included",
    extractionStatus: "extracted",
    sha256: "f".repeat(64),
    contentText: "Foreign project arithmetic.",
  });
  unrelated.documentVersions.push({
    id: "version-boq-foreign",
    documentId: "boq-foreign",
    versionNumber: 1,
    sha256: "f".repeat(64),
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    addendumStatus: "no_change",
  });
  unrelated.boqChecks.push({
    id: "boq-check-foreign",
    sourceDocId: "boq-foreign",
    status: "cleared",
    severity: "advisory",
  });
  sanity = buildIntelligenceCentreSnapshot(unrelated).capabilities.find(
    ({ id }) => id === "boq_sanity",
  );
  assert.equal(sanity?.state, "partial");
});

test("keeps preflight partial until current package, sign-off, deadline, addenda, and report are proven", () => {
  const value = input();
  addGroundedRequirement(value);

  let preflight = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  assert.equal(preflight?.state, "partial");
  assert.match(preflight?.summary ?? "", /release-proof gap/);

  value.packages.push({
    id: "package-1",
    status: "signed",
    currentVersionNumber: 1,
  });
  value.packageVersions.push({
    id: "package-version-1",
    packageId: "package-1",
    versionNumber: 1,
    sourceSnapshotHash: "c".repeat(64),
    manifestHash: "d".repeat(64),
    pdfSha256: "e".repeat(64),
    renderQaStatus: "passed",
    generatedByUserId: "author-1",
  });
  value.packageSignoffs.push({
    id: "signoff-1",
    packageVersionId: "package-version-1",
    signerUserId: "signer-1",
    signerRole: "director",
    signerAuthority: "authorised_signatory",
    intentStatement: "I approve this exact package for release.",
    documentHash: "e".repeat(64),
    trustedTimestamp: "2026-08-10T10:30:00.000Z",
    mfaEvidence: "mfa-event-1",
    deviceEventEvidence: "device-event-1",
  });
  value.reportStatuses.push({
    id: "report-1",
    version: 1,
    status: "signed_off",
    reviewerId: "reviewer-1",
    reviewerName: "Amina Reviewer",
    attestation: "Reviewed against the immutable package inputs.",
    engineVersion: "engine-1",
    promptPackVersion: "prompt-pack-1",
    modelId: "deterministic",
    taxonomyVersion: "taxonomy-1",
    signedOffAt: "2026-08-10T10:00:00.000Z",
    updatedAt: "2026-08-10T11:00:00.000Z",
  });

  preflight = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  assert.equal(preflight?.state, "review_ready");

  value.packages[0]!.status = "draft";
  preflight = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  assert.equal(preflight?.state, "partial");

  value.packages[0]!.status = "signed";
  value.reportStatuses.push({
    id: "report-2",
    version: 2,
    status: "draft",
    updatedAt: "2026-08-09T11:00:00.000Z",
  });
  preflight = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  assert.equal(preflight?.state, "partial");

  value.reportStatuses.pop();
  preflight = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  assert.equal(preflight?.state, "review_ready");

  value.packageSignoffs.length = 0;
  preflight = buildIntelligenceCentreSnapshot(value).capabilities.find(
    ({ id }) => id === "submission_preflight",
  );
  assert.equal(preflight?.state, "partial");
});

test("Restricted Mode keeps provider-like previews restricted while deterministic checks remain visible", () => {
  const value = input();
  value.project.restrictedMode = true;
  value.documents.push({
    id: "boq-1",
    projectId: "project-1",
    filename: "boq.xlsx",
    type: "boq",
    redactionStatus: "included",
    extractionStatus: "skipped",
    sha256: "b".repeat(64),
  });

  const snapshot = buildIntelligenceCentreSnapshot(value);
  assert.equal(snapshot.restrictedMode, true);
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "grounded_copilot")?.state,
    "restricted",
  );
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "clarification_assistant")
      ?.state,
    "restricted",
  );
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "boq_sanity")?.state,
    "partial",
  );
});

test("does not infer source-bound delivery obligations from a generic task", () => {
  const value = input();
  value.workTasks.push({
    id: "task-1",
    status: "open",
    dueAt: "2026-09-10T10:00:00.000Z",
  });
  let snapshot = buildIntelligenceCentreSnapshot(value);
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "award_handoff")?.state,
    "empty",
  );

  value.project.outcome = "awarded";
  snapshot = buildIntelligenceCentreSnapshot(value);
  assert.equal(
    snapshot.capabilities.find(({ id }) => id === "award_handoff")?.state,
    "empty",
  );

  value.project.outcomeClientConfirmed = true;
  snapshot = buildIntelligenceCentreSnapshot(value);
  const handoff = snapshot.capabilities.find(
    ({ id }) => id === "award_handoff",
  );
  assert.equal(handoff?.state, "partial");
  assert.match(handoff?.stateReason ?? "", /not accepted source-bound/u);
});
