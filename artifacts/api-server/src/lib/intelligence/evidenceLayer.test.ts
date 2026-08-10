import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EVIDENCE_LAYER_BOUNDS,
  EVIDENCE_LAYER_FOUNDATION_STATUS,
  buildEvidenceLayer,
  evidenceFieldLengthExceedsBounds,
  hashEvidenceLayerText,
  searchEvidenceLayer,
  type EvidenceLayerInput,
} from "./evidenceLayer";

const content = [
  "Invitation to Bid.",
  "Clause 7.2: The bidder shall provide bid security of NGN 5,000,000.",
  "The security must remain valid for 120 days.",
].join("\n");
const snippet = "provide bid security of NGN 5,000,000";

function validInput(): EvidenceLayerInput {
  return {
    organisationId: "org-a",
    projectId: "project-a",
    requestedMode: "verified_spans",
    evaluatedAt: "2026-08-10T12:00:00.000Z",
    project: { id: "project-a", organisationId: "org-a" },
    actor: {
      userId: "user-a",
      organisationId: "org-a",
      projectId: "project-a",
      permissions: [
        "project:read",
        "document:read",
        "requirement:read",
        "evidence:read",
      ],
      visibleDocumentIds: ["document-a"],
    },
    documents: [
      {
        id: "document-a",
        organisationId: "org-a",
        projectId: "project-a",
        filename: "invitation.pdf",
        redactionStatus: "included",
        extractionStatus: "extracted",
        sha256: hashEvidenceLayerText(content),
        contentText: content,
      },
    ],
    documentVersions: [
      {
        id: "version-a1",
        organisationId: "org-a",
        documentId: "document-a",
        versionNumber: 1,
        sha256: hashEvidenceLayerText(content),
        malwareStatus: "clean",
        quarantineStatus: "cleared",
      },
    ],
    requirements: [
      {
        id: "requirement-a",
        organisationId: "org-a",
        projectId: "project-a",
        sourceDocId: "document-a",
        text: "Provide the required bid security.",
        reviewStatus: "confirmed",
      },
    ],
    requirementCitations: [
      {
        id: "citation-a",
        organisationId: "org-a",
        requirementId: "requirement-a",
        documentVersionId: "version-a1",
        pageNumber: 4,
        paragraphRef: "Clause 7.2",
        tableRef: null,
        coordinateJson: null,
        sourceSnippet: snippet,
        sourceSnippetHash: hashEvidenceLayerText(snippet),
        verificationStatus: "verified",
        verifiedByUserId: "reviewer-a",
        verifiedByName: "Amina Reviewer",
        verifiedAt: "2026-08-10T10:00:00.000Z",
        verifierAuthority: "active_direct_tenant_evidence_approver",
      },
    ],
  };
}

function cloneInput(): EvidenceLayerInput {
  return structuredClone(validInput());
}

function addSecondSource(input: EvidenceLayerInput): EvidenceLayerInput {
  const secondContent =
    "Clause 12: Bid security is required and must use the prescribed form.";
  const secondSnippet = "Bid security is required";
  return {
    ...input,
    actor: {
      ...input.actor,
      visibleDocumentIds: ["document-b", ...input.actor.visibleDocumentIds],
    },
    documents: [
      ...input.documents,
      {
        id: "document-b",
        organisationId: "org-a",
        projectId: "project-a",
        filename: "instructions.pdf",
        redactionStatus: "redacted",
        extractionStatus: "extracted",
        sha256: hashEvidenceLayerText(secondContent),
        contentText: secondContent,
      },
    ],
    documentVersions: [
      ...input.documentVersions,
      {
        id: "version-b1",
        organisationId: "org-a",
        documentId: "document-b",
        versionNumber: 1,
        sha256: hashEvidenceLayerText(secondContent),
        malwareStatus: "clean",
        quarantineStatus: "cleared",
      },
    ],
    requirements: [
      ...input.requirements,
      {
        id: "requirement-b",
        organisationId: "org-a",
        projectId: "project-a",
        sourceDocId: "document-b",
        text: "Use the prescribed bid-security form.",
        reviewStatus: "edited",
      },
    ],
    requirementCitations: [
      ...input.requirementCitations,
      {
        id: "citation-b",
        organisationId: "org-a",
        requirementId: "requirement-b",
        documentVersionId: "version-b1",
        pageNumber: 8,
        paragraphRef: "Clause 12",
        tableRef: null,
        coordinateJson: null,
        sourceSnippet: secondSnippet,
        sourceSnippetHash: hashEvidenceLayerText(secondSnippet),
        verificationStatus: "verified",
        verifiedByUserId: "reviewer-b",
        verifiedByName: "Bola Reviewer",
        verifiedAt: "2026-08-10T11:00:00.000Z",
        verifierAuthority: "active_direct_tenant_evidence_approver",
      },
    ],
  };
}

test("the deterministic route is connected while model and vector runtimes remain blocked", () => {
  assert.deepEqual(EVIDENCE_LAYER_FOUNDATION_STATUS, {
    runtimeConnected: true,
    deterministicRuntimeConnected: true,
    modelRuntimeConnected: false,
    vectorRuntimeConnected: false,
    extractionArtifactIntegrity: "unproven_schema_gap",
    verifierAuthorityProvenance: "current_state_only",
    activationBlockers: [
      "immutable_extraction_artifact_provenance",
      "immutable_historical_verifier_authority",
    ],
    productionApproved: false,
    activation: "blocked",
    retrieval: "bounded_lexical_verified_spans",
    writesEnabled: false,
    externalActionsEnabled: false,
  });
  assert.equal(EVIDENCE_LAYER_FOUNDATION_STATUS.productionApproved, false);
});

test("the repository pre-bounds text and resolves direct current verifier authority", () => {
  const source = readFileSync(
    new URL("./evidenceLayerStore.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /char_length\(/u);
  assert.match(source, /octet_length\(/u);
  assert.match(source, /maxDocuments \+ 1/u);
  assert.match(source, /maxRequirementCitations \+ 1/u);
  assert.match(source, /maxCitationsPerDocument/u);
  assert.match(source, /delegatedByMembershipId === null/u);
  assert.match(source, /hasPermission\(\[role\], "evidence:approve"\)/u);
  assert.match(source, /isActiveAccessWindow\(/u);
  assert.match(source, /verifierAuthority:/u);
  assert.match(source, /currentEvidenceApproverIds/u);
  assert.match(source, /maxVerifierAuthorityRows \+ 1/u);
  assert.match(source, /authorityRows\.length !== authorityBounds\.length/u);
  for (const boundedField of [
    "documents.filename",
    "documents.type",
    "documents.redactionStatus",
    "documents.extractionStatus",
    "documents.sha256",
    "documents.contentText",
    "requirements.text",
    "requirements.category",
    "requirements.pageRef",
    "requirements.clauseRef",
    "requirements.confidence",
    "requirements.reviewStatus",
    "requirements.reviewerNotes",
    "documentVersions.sha256",
    "documentVersions.malwareStatus",
    "documentVersions.quarantineStatus",
    "documentVersions.addendumStatus",
    "requirementCitations.paragraphRef",
    "requirementCitations.tableRef",
    "requirementCitations.coordinateJson",
    "requirementCitations.sourceSnippet",
    "requirementCitations.sourceSnippetHash",
    "requirementCitations.verificationStatus",
    "users.name",
    "users.status",
    "organisationMemberships.status",
    "roleGrants.role",
  ]) {
    assert.match(source, new RegExp(`\\$\\{${boundedField}\\}`, "u"));
  }
});

test("repository field gates reject oversized filenames, locators, and verifier names before materialization", () => {
  const adversarialCases = [
    {
      codeUnits: EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits + 1,
      bytes: EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
      maxCodeUnits: EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits,
      maxBytes: EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
    },
    {
      codeUnits: EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
      bytes: EVIDENCE_LAYER_BOUNDS.maxLocatorBytes + 1,
      maxCodeUnits: EVIDENCE_LAYER_BOUNDS.maxLocatorCodeUnits,
      maxBytes: EVIDENCE_LAYER_BOUNDS.maxLocatorBytes,
    },
    {
      codeUnits: EVIDENCE_LAYER_BOUNDS.maxVerifierNameCodeUnits + 1,
      bytes: EVIDENCE_LAYER_BOUNDS.maxVerifierNameBytes,
      maxCodeUnits: EVIDENCE_LAYER_BOUNDS.maxVerifierNameCodeUnits,
      maxBytes: EVIDENCE_LAYER_BOUNDS.maxVerifierNameBytes,
    },
  ];
  for (const { codeUnits, bytes, maxCodeUnits, maxBytes } of adversarialCases) {
    assert.equal(
      evidenceFieldLengthExceedsBounds(
        [{ codeUnits, bytes }],
        maxCodeUnits,
        maxBytes,
      ),
      true,
    );
  }
  assert.equal(
    evidenceFieldLengthExceedsBounds(
      [
        {
          codeUnits: EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits,
          bytes: EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
        },
      ],
      EVIDENCE_LAYER_BOUNDS.maxFilenameCodeUnits,
      EVIDENCE_LAYER_BOUNDS.maxFilenameBytes,
    ),
    false,
  );

  const source = readFileSync(
    new URL("./evidenceLayerStore.ts", import.meta.url),
    "utf8",
  );
  for (const metric of [
    "filenameCodeUnits",
    "filenameBytes",
    "locatorCodeUnits",
    "locatorBytes",
    "verifierNameCodeUnits",
    "verifierNameBytes",
  ])
    assert.match(source, new RegExp(`${metric}:`, "u"));
  for (const bound of [
    "maxFilenameCodeUnits",
    "maxFilenameBytes",
    "maxLocatorCodeUnits",
    "maxLocatorBytes",
    "maxVerifierNameCodeUnits",
    "maxVerifierNameBytes",
  ])
    assert.match(source, new RegExp(`EVIDENCE_LAYER_BOUNDS\\.${bound}`, "u"));
});

test("builds exact current-version sources and searches verified spans only", () => {
  const layer = buildEvidenceLayer(validInput());
  assert.equal(layer.disposition, "ready");
  assert.equal(layer.actualMode, "verified_spans");
  assert.equal(layer.sources.length, 1);
  assert.equal(layer.sources[0]?.text, snippet);
  assert.equal(layer.sources[0]?.sourceName, "invitation.pdf");
  assert.equal(layer.sources[0]?.locator.pageNumber, 4);
  assert.equal(layer.sources[0]?.locator.paragraphRef, "Clause 7.2");
  assert.equal(layer.sources[0]?.verifier.name, "Amina Reviewer");
  assert.equal(
    layer.sources[0]?.verifier.authority,
    "active_direct_tenant_evidence_approver",
  );
  assert.equal(layer.sources[0]?.instructionAuthority, "none");
  assert.match(layer.manifestSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(layer.versionSha256 ?? "", /^[a-f0-9]{64}$/u);

  const result = searchEvidenceLayer(layer, {
    actor: validInput().actor,
    expectedManifestSha256: layer.manifestSha256!,
    query: "bid security NGN",
    limit: 5,
  });
  assert.equal(result.disposition, "ready");
  assert.equal(result.matches[0]?.source.citationId, "citation-a");
  assert.deepEqual(result.matches[0]?.matchedTokens, [
    "bid",
    "security",
    "ngn",
  ]);
  assert.match(result.querySha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.match(result.searchManifestSha256 ?? "", /^[a-f0-9]{64}$/u);

  const absent = searchEvidenceLayer(layer, {
    actor: validInput().actor,
    expectedManifestSha256: layer.manifestSha256!,
    query: "diesel generator",
    limit: 5,
  });
  assert.equal(absent.disposition, "abstain");
  assert.equal(absent.abstentionReason, "no_lexical_match");
});

test("manifest, version and lexical ordering are independent of input order", () => {
  const input = addSecondSource(validInput());
  const first = buildEvidenceLayer(input);
  const second = buildEvidenceLayer({
    ...input,
    actor: {
      ...input.actor,
      permissions: [...input.actor.permissions].reverse(),
      visibleDocumentIds: [...input.actor.visibleDocumentIds].reverse(),
    },
    documents: [...input.documents].reverse(),
    documentVersions: [...input.documentVersions].reverse(),
    requirements: [...input.requirements].reverse(),
    requirementCitations: [...input.requirementCitations].reverse(),
  });
  assert.equal(first.disposition, "ready");
  assert.equal(second.disposition, "ready");
  assert.equal(second.manifestSha256, first.manifestSha256);
  assert.equal(second.versionSha256, first.versionSha256);
  assert.deepEqual(second.sources, first.sources);

  const request = {
    actor: input.actor,
    expectedManifestSha256: first.manifestSha256!,
    query: "bid security",
    limit: 20,
  };
  const search = searchEvidenceLayer(first, request);
  assert.deepEqual(
    search.matches.map(({ source }) => source.citationId),
    ["citation-a", "citation-b"],
  );
});

test("cross-tenant and cross-project rows block without disclosing a source", () => {
  const cases: Array<[string, (input: EvidenceLayerInput) => void]> = [
    [
      "document_scope_mismatch",
      (input) => {
        (input.documents[0] as { projectId: string }).projectId = "project-b";
      },
    ],
    [
      "version_scope_mismatch",
      (input) => {
        (
          input.documentVersions[0] as { organisationId: string }
        ).organisationId = "org-b";
      },
    ],
    [
      "requirement_scope_mismatch",
      (input) => {
        (input.requirements[0] as { projectId: string }).projectId =
          "project-b";
      },
    ],
    [
      "citation_scope_mismatch",
      (input) => {
        (
          input.requirementCitations[0] as { organisationId: string }
        ).organisationId = "org-b";
      },
    ],
  ];
  for (const [expectedCode, mutate] of cases) {
    const input = cloneInput();
    mutate(input);
    const result = buildEvidenceLayer(input);
    assert.equal(result.disposition, "blocked", expectedCode);
    assert.deepEqual(result.sources, [], expectedCode);
    assert.equal(
      result.blockers.some(({ code }) => code === expectedCode),
      true,
      expectedCode,
    );
  }
});

test("a citation to an older version never falls back behind the latest version", () => {
  const input = cloneInput();
  const updatedContent = `${content}\nAddendum 1 changes the security to NGN 7,000,000.`;
  (input.documents[0] as { sha256: string; contentText: string }).sha256 =
    hashEvidenceLayerText(updatedContent);
  (input.documents[0] as { sha256: string; contentText: string }).contentText =
    updatedContent;
  (input.documentVersions as Array<unknown>).push({
    id: "version-a2",
    organisationId: "org-a",
    documentId: "document-a",
    versionNumber: 2,
    sha256: hashEvidenceLayerText(updatedContent),
    malwareStatus: "clean",
    quarantineStatus: "cleared",
  });
  const result = buildEvidenceLayer(input);
  assert.equal(result.disposition, "abstain");
  assert.deepEqual(result.sources, []);
  assert.equal(result.rejected[0]?.code, "citation_version_not_current");
});

test("hash mismatches and non-current content abstain", () => {
  const cases: Array<[string, (input: EvidenceLayerInput) => void]> = [
    [
      "document_hash_mismatch",
      (input) => {
        (input.documents[0] as { sha256: string }).sha256 = "b".repeat(64);
      },
    ],
    [
      "snippet_hash_mismatch",
      (input) => {
        (
          input.requirementCitations[0] as { sourceSnippetHash: string }
        ).sourceSnippetHash = "c".repeat(64);
      },
    ],
    [
      "snippet_not_in_current_content",
      (input) => {
        const altered = "The exact cited phrase is no longer in this document.";
        (
          input.documents[0] as { contentText: string; sha256: string }
        ).contentText = altered;
        (input.documents[0] as { contentText: string; sha256: string }).sha256 =
          hashEvidenceLayerText(altered);
        (input.documentVersions[0] as { sha256: string }).sha256 =
          hashEvidenceLayerText(altered);
      },
    ],
  ];
  for (const [expectedCode, mutate] of cases) {
    const input = cloneInput();
    mutate(input);
    const result = buildEvidenceLayer(input);
    assert.equal(result.disposition, "abstain", expectedCode);
    assert.deepEqual(result.sources, [], expectedCode);
    assert.equal(result.rejected[0]?.code, expectedCode);
  }
});

test("unsafe lifecycle states never produce searchable evidence", () => {
  const cases: Array<[string, (input: EvidenceLayerInput) => void]> = [
    [
      "malware_not_clean",
      (input) => {
        (input.documentVersions[0] as { malwareStatus: string }).malwareStatus =
          "infected";
      },
    ],
    [
      "quarantine_not_cleared",
      (input) => {
        (
          input.documentVersions[0] as { quarantineStatus: string }
        ).quarantineStatus = "quarantined";
      },
    ],
    [
      "document_redaction_ineligible",
      (input) => {
        (input.documents[0] as { redactionStatus: string }).redactionStatus =
          "excluded";
      },
    ],
    [
      "document_extraction_incomplete",
      (input) => {
        (input.documents[0] as { extractionStatus: string }).extractionStatus =
          "processing";
      },
    ],
  ];
  for (const [expectedCode, mutate] of cases) {
    const input = cloneInput();
    mutate(input);
    const result = buildEvidenceLayer(input);
    assert.equal(result.disposition, "abstain", expectedCode);
    assert.equal(result.rejected[0]?.code, expectedCode);
    assert.deepEqual(result.sources, []);
  }
});

test("unverified, unnamed and untimestamped citations abstain", () => {
  const cases: Array<[string, (input: EvidenceLayerInput) => void]> = [
    [
      "citation_unverified",
      (input) => {
        (
          input.requirementCitations[0] as { verificationStatus: string }
        ).verificationStatus = "pending";
      },
    ],
    [
      "citation_verifier_missing",
      (input) => {
        (
          input.requirementCitations[0] as { verifiedByName: null }
        ).verifiedByName = null;
      },
    ],
    [
      "citation_timestamp_invalid",
      (input) => {
        (input.requirementCitations[0] as { verifiedAt: string }).verifiedAt =
          "tomorrow";
      },
    ],
    [
      "citation_verifier_unauthorised",
      (input) => {
        (
          input.requirementCitations[0] as {
            verifierAuthority: "not_authorized";
          }
        ).verifierAuthority = "not_authorized";
      },
    ],
    [
      "citation_timestamp_future",
      (input) => {
        (input.requirementCitations[0] as { verifiedAt: string }).verifiedAt =
          "2026-08-10T12:00:00.001Z";
      },
    ],
  ];
  for (const [expectedCode, mutate] of cases) {
    const input = cloneInput();
    mutate(input);
    const result = buildEvidenceLayer(input);
    assert.equal(result.disposition, "abstain", expectedCode);
    assert.equal(result.rejected[0]?.code, expectedCode);
  }
});

test("invalid locators cannot masquerade as exact citations", () => {
  const input = cloneInput();
  const citation = input.requirementCitations[0] as {
    pageNumber: number | null;
    paragraphRef: string | null;
    coordinateJson: string | null;
  };
  citation.pageNumber = -1;
  citation.paragraphRef = "Clause 7.2";
  citation.coordinateJson = "{not-json";
  const result = buildEvidenceLayer(input);
  assert.equal(result.disposition, "abstain");
  assert.equal(result.rejected[0]?.code, "citation_locator_invalid");
});

test("per-document citation fan-out is bounded before citation evaluation", () => {
  const input = cloneInput();
  const template = input.requirementCitations[0]!;
  (
    input as {
      requirementCitations: EvidenceLayerInput["requirementCitations"];
    }
  ).requirementCitations = Array.from(
    { length: EVIDENCE_LAYER_BOUNDS.maxCitationsPerDocument + 1 },
    (_, index) => ({ ...template, id: `citation-${index}` }),
  );
  const result = buildEvidenceLayer(input);
  assert.equal(result.disposition, "blocked");
  assert.equal(result.blockers[0]?.code, "input_bound_exceeded");
  assert.equal(result.blockers[0]?.path, "requirementCitations.byDocument");
});

test("oversized build and search inputs block before hashing or searching", () => {
  const oversizedText = "x".repeat(
    EVIDENCE_LAYER_BOUNDS.maxDocumentTextCodeUnits + 1,
  );
  const input = cloneInput();
  (input.documents[0] as { contentText: string }).contentText = oversizedText;
  const build = buildEvidenceLayer(input);
  assert.equal(build.disposition, "blocked");
  assert.equal(build.blockers[0]?.code, "input_bound_exceeded");
  assert.equal(build.manifestSha256, null);
  assert.throws(() => hashEvidenceLayerText(oversizedText), RangeError);

  const layer = buildEvidenceLayer(validInput());
  const search = searchEvidenceLayer(layer, {
    actor: validInput().actor,
    expectedManifestSha256: layer.manifestSha256!,
    query: "q".repeat(EVIDENCE_LAYER_BOUNDS.maxQueryCodeUnits + 1),
    limit: 1,
  });
  assert.equal(search.disposition, "blocked");
  assert.equal(search.blockers[0]?.code, "query_invalid");
  assert.equal(search.querySha256, null);

  const oversizedActor = structuredClone(validInput().actor);
  (
    oversizedActor as unknown as { visibleDocumentIds: string[] }
  ).visibleDocumentIds = [
    "d".repeat(EVIDENCE_LAYER_BOUNDS.maxIdentifierCodeUnits + 1),
  ];
  const actorSearch = searchEvidenceLayer(layer, {
    actor: oversizedActor,
    expectedManifestSha256: layer.manifestSha256!,
    query: "security",
    limit: 1,
  });
  assert.equal(actorSearch.disposition, "blocked");
  assert.equal(actorSearch.blockers[0]?.code, "input_bound_exceeded");
  assert.equal(actorSearch.searchManifestSha256, null);

  const tooMany = cloneInput();
  const documents = Array.from(
    { length: EVIDENCE_LAYER_BOUNDS.maxDocuments + 1 },
    (_, index) => ({ ...tooMany.documents[0]!, id: `document-${index}` }),
  );
  (tooMany as unknown as { documents: typeof documents }).documents = documents;
  assert.equal(buildEvidenceLayer(tooMany).disposition, "blocked");
});

test("permission and exact visibility changes block build and search", () => {
  const missingPermission = cloneInput();
  (
    missingPermission.actor as unknown as { permissions: string[] }
  ).permissions = ["project:read", "document:read", "requirement:read"];
  const denied = buildEvidenceLayer(missingPermission);
  assert.equal(denied.disposition, "blocked");
  assert.equal(
    denied.blockers.some(({ code }) => code === "permission_denied"),
    true,
  );

  const invisible = cloneInput();
  (
    invisible.actor as unknown as { visibleDocumentIds: string[] }
  ).visibleDocumentIds = [];
  const hidden = buildEvidenceLayer(invisible);
  assert.equal(hidden.disposition, "blocked");
  assert.equal(
    hidden.blockers.some(({ code }) => code === "document_visibility_mismatch"),
    true,
  );

  const layer = buildEvidenceLayer(validInput());
  const searchActor = structuredClone(validInput().actor) as {
    userId: string;
    organisationId: string;
    projectId: string;
    permissions: string[];
    visibleDocumentIds: string[];
  };
  searchActor.visibleDocumentIds = [];
  const search = searchEvidenceLayer(layer, {
    actor: searchActor,
    expectedManifestSha256: layer.manifestSha256!,
    query: "security",
    limit: 1,
  });
  assert.equal(search.disposition, "blocked");
  assert.equal(
    search.blockers.some(({ code }) => code === "document_visibility_mismatch"),
    true,
  );
});

test("deleted source rows and deleted latest versions never expose stale evidence", () => {
  const deletedDocument = cloneInput();
  (
    deletedDocument as unknown as {
      documents: [];
      actor: { visibleDocumentIds: [] };
    }
  ).documents = [];
  (
    deletedDocument.actor as unknown as { visibleDocumentIds: [] }
  ).visibleDocumentIds = [];
  const missing = buildEvidenceLayer(deletedDocument);
  assert.equal(missing.disposition, "blocked");
  assert.equal(
    missing.blockers.some(({ code }) => code === "source_reference_missing"),
    true,
  );

  const deletedLatest = cloneInput();
  const newestContent = `${content}\nCurrent addendum text.`;
  (
    deletedLatest.documents[0] as { contentText: string; sha256: string }
  ).contentText = newestContent;
  (
    deletedLatest.documents[0] as { contentText: string; sha256: string }
  ).sha256 = hashEvidenceLayerText(newestContent);
  // The remaining v1 row cannot silently become current because its digest no
  // longer matches the document's persisted current digest.
  const stale = buildEvidenceLayer(deletedLatest);
  assert.equal(stale.disposition, "abstain");
  assert.equal(stale.rejected[0]?.code, "document_hash_mismatch");
});

test("complete-corpus mode is explicit and requires full-content verification", () => {
  const incomplete = cloneInput();
  (incomplete as { requestedMode: "complete_corpus" }).requestedMode =
    "complete_corpus";
  const abstained = buildEvidenceLayer(incomplete);
  assert.equal(abstained.disposition, "abstain");
  assert.equal(abstained.actualMode, "verified_spans");
  assert.equal(abstained.abstentionReason, "complete_corpus_not_proven");

  const complete = cloneInput();
  (complete as { requestedMode: "complete_corpus" }).requestedMode =
    "complete_corpus";
  (
    complete.requirementCitations[0] as {
      sourceSnippet: string;
      sourceSnippetHash: string;
    }
  ).sourceSnippet = content;
  (
    complete.requirementCitations[0] as {
      sourceSnippet: string;
      sourceSnippetHash: string;
    }
  ).sourceSnippetHash = hashEvidenceLayerText(content);
  const ready = buildEvidenceLayer(complete);
  assert.equal(ready.disposition, "ready");
  assert.equal(ready.actualMode, "complete_corpus");
  assert.equal(ready.coverage.fullyVerifiedDocumentCount, 1);
});

test("a mutated or stale manifest cannot be searched", () => {
  const layer = buildEvidenceLayer(validInput());
  const stale = searchEvidenceLayer(layer, {
    actor: validInput().actor,
    expectedManifestSha256: "f".repeat(64),
    query: "security",
    limit: 1,
  });
  assert.equal(stale.disposition, "blocked");
  assert.equal(
    stale.blockers.some(({ code }) => code === "manifest_mismatch"),
    true,
  );

  const mutated = structuredClone(layer);
  (mutated.sources[0] as { text: string }).text = "altered evidence";
  const result = searchEvidenceLayer(mutated, {
    actor: validInput().actor,
    expectedManifestSha256: layer.manifestSha256!,
    query: "security",
    limit: 1,
  });
  assert.equal(result.disposition, "blocked");
  assert.equal(
    result.blockers.some(({ code }) => code === "manifest_mismatch"),
    true,
  );
});
