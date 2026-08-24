import assert from "node:assert/strict";
import { test } from "node:test";
import { sha256Text, type HumanReview, type SourceDocument } from "./domain";
import {
  buildPortalSubmissionRehearsal,
  type PortalSubmissionRehearsalInput,
} from "./portalSubmissionRehearsal";

const ACCEPTED: HumanReview = {
  state: "accepted",
  reviewerId: "portal-operator",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
const FILE_HASH = "a".repeat(64);

function source(
  sourceId: string,
  kind: SourceDocument["kind"],
  content: string,
  authority: SourceDocument["authority"] = "authoritative",
): SourceDocument {
  return {
    sourceId,
    versionId: "v1",
    kind,
    title: `${sourceId}.txt`,
    content,
    contentSha256: sha256Text(content),
    capturedAt: "2026-08-10T09:00:00.000Z",
    authority,
    origin: "controlled-test-fixture",
  };
}

function citation(item: SourceDocument, quote = item.content) {
  const startOffset = item.content.indexOf(quote);
  assert.notEqual(startOffset, -1);
  return {
    sourceId: item.sourceId,
    sourceVersionId: item.versionId,
    contentSha256: item.contentSha256,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}

function fixture(): PortalSubmissionRehearsalInput {
  const uploadRule = source(
    "portal-rule",
    "other",
    "Required file field Technical proposal, upload order 1, accepts .pdf up to 5000000 bytes (5 MB) and the filename must begin technical-. Required declaration field Completeness declaration, upload order 2. Declaration: I certify that the uploaded records are complete.",
  );
  const manifest = source(
    "package-manifest",
    "company_evidence",
    `technical-proposal.pdf 1024 bytes ${FILE_HASH}. Mapping: technical-proposal.pdf assigned to Technical proposal. The frozen technical file is assigned to this upload slot.`,
    "corroborating",
  );
  const uploadRuleText =
    "Required file field Technical proposal, upload order 1, accepts .pdf up to 5000000 bytes (5 MB) and the filename must begin technical-.";
  const declarationText =
    "Required declaration field Completeness declaration, upload order 2. Declaration: I certify that the uploaded records are complete.";
  return {
    sources: [uploadRule, manifest],
    fields: [
      {
        externalId: "technical-upload",
        label: "Technical proposal",
        fieldType: "file",
        required: true,
        uploadOrder: 1,
        ruleText: uploadRuleText,
        maxFileBytes: 5_000_000,
        maxFileBytesText: "5 MB",
        allowedExtensions: [".pdf"],
        requiredFilenamePrefix: "technical-",
        citations: [citation(uploadRule, uploadRuleText)],
        review: ACCEPTED,
      },
      {
        externalId: "operator-declaration",
        label: "Completeness declaration",
        fieldType: "declaration",
        required: true,
        uploadOrder: 2,
        ruleText: declarationText,
        declarationText,
        citations: [citation(uploadRule, declarationText)],
        review: ACCEPTED,
      },
    ],
    files: [
      {
        externalId: "technical-file",
        filename: "technical-proposal.pdf",
        sizeBytes: 1024,
        sizeText: "1024 bytes",
        sha256: FILE_HASH,
        citations: [citation(manifest)],
        review: ACCEPTED,
      },
    ],
    mappings: [
      {
        externalId: "technical-map",
        fieldExternalId: "technical-upload",
        fileExternalId: "technical-file",
        rationale: "The frozen technical file is assigned to this upload slot.",
        citations: [citation(uploadRule, uploadRuleText), citation(manifest)],
        review: ACCEPTED,
      },
    ],
  };
}

test("rehearses reviewed file mappings while keeping declarations manual", () => {
  const input = fixture();
  const proposed = buildPortalSubmissionRehearsal(input);
  assert.equal(proposed.status, "review_required");
  assert.equal(proposed.checks[0]?.state, "ready");
  assert.equal(proposed.checks[1]?.state, "manual_confirmation_required");
  assert.equal(proposed.manualDeclarationCount, 1);
  assert.equal(proposed.portalSubmissionReady, false);
  assert.equal(proposed.credentialsUsed, false);
  assert.equal(proposed.portalActionAuthorized, false);
  assert.equal(proposed.safety.externalAction, "none");

  const accepted = buildPortalSubmissionRehearsal({
    ...input,
    rehearsalReview: { subjectId: proposed.rehearsalId, review: ACCEPTED },
  });
  assert.equal(accepted.status, "rehearsal_ready");
  assert.equal(accepted.readyForOperatorRehearsal, true);
  assert.equal(accepted.portalSubmissionReady, false);
});

test("two-pass approval keeps the subject stable while item reviews advance", () => {
  const input = fixture();
  const pendingReview = {
    state: "needs_changes" as const,
    reviewerId: "portal-operator",
    reviewedAt: "2026-08-10T09:30:00.000Z",
    note: "Confirm the frozen mapping before rehearsal.",
  };
  const proposed = buildPortalSubmissionRehearsal({
    ...input,
    fields: input.fields.map((field) => ({ ...field, review: pendingReview })),
    files: input.files.map((file) => ({ ...file, review: pendingReview })),
    mappings: input.mappings.map((mapping) => ({
      ...mapping,
      review: pendingReview,
    })),
  });
  const accepted = buildPortalSubmissionRehearsal({
    ...input,
    rehearsalReview: { subjectId: proposed.rehearsalId, review: ACCEPTED },
  });
  assert.equal(accepted.rehearsalId, proposed.rehearsalId);
  assert.equal(accepted.status, "rehearsal_ready");
});

test("reports size, extension, and filename violations without altering files", () => {
  const base = fixture();
  const badManifest = source(
    "bad-manifest",
    "company_evidence",
    `proposal.zip 6000000 bytes ${FILE_HASH}. Mapping: proposal.zip assigned to Technical proposal. The frozen technical file is assigned to this upload slot.`,
    "corroborating",
  );
  const result = buildPortalSubmissionRehearsal({
    ...base,
    sources: [base.sources[0]!, badManifest],
    files: [
      {
        ...base.files[0]!,
        filename: "proposal.zip",
        sizeBytes: 6_000_000,
        sizeText: "6000000 bytes",
        citations: [citation(badManifest)],
      },
    ],
    mappings: [
      {
        ...base.mappings[0]!,
        citations: [base.fields[0]!.citations[0]!, citation(badManifest)],
      },
    ],
  });
  assert.equal(result.status, "incomplete");
  assert.equal(result.checks[0]?.state, "invalid_file");
  assert.deepEqual(result.checks[0]?.violations, [
    "extension_not_allowed",
    "file_too_large",
    "filename_prefix_mismatch",
  ]);
  assert.equal(result.readyForOperatorRehearsal, false);
});

test("never permits a file mapping to satisfy a declaration", () => {
  const input = fixture();
  const result = buildPortalSubmissionRehearsal({
    ...input,
    mappings: [
      {
        ...input.mappings[0]!,
        externalId: "declaration-map",
        fieldExternalId: "operator-declaration",
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.mappings.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "declaration_cannot_be_file_mapped",
    ),
  );
});

test("never marks a rehearsal ready while a frozen package file is unmapped", () => {
  const input = fixture();
  const secondHash = "b".repeat(64);
  const manifest = source(
    "complete-package-manifest",
    "company_evidence",
    `technical-proposal.pdf 1024 bytes ${FILE_HASH}. Mapping: technical-proposal.pdf assigned to Technical proposal. The frozen technical file is assigned to this upload slot.\nfinancial-proposal.pdf 2048 bytes ${secondHash}.`,
    "corroborating",
  );
  const withUnmappedFile: PortalSubmissionRehearsalInput = {
    ...input,
    sources: [input.sources[0]!, manifest],
    files: [
      {
        ...input.files[0]!,
        citations: [citation(manifest)],
      },
      {
        externalId: "financial-file",
        filename: "financial-proposal.pdf",
        sizeBytes: 2048,
        sizeText: "2048 bytes",
        sha256: secondHash,
        citations: [citation(manifest)],
        review: ACCEPTED,
      },
    ],
    mappings: [
      {
        ...input.mappings[0]!,
        citations: [input.fields[0]!.citations[0]!, citation(manifest)],
      },
    ],
  };
  const proposed = buildPortalSubmissionRehearsal(withUnmappedFile);
  const reviewed = buildPortalSubmissionRehearsal({
    ...withUnmappedFile,
    rehearsalReview: { subjectId: proposed.rehearsalId, review: ACCEPTED },
  });

  assert.equal(reviewed.status, "blocked");
  assert.equal(reviewed.readyForOperatorRehearsal, false);
  assert.ok(
    reviewed.issues.some(
      (issue) =>
        issue.code === "package_file_unmapped" &&
        issue.path === "files.financial-file",
    ),
  );
});

test("rejects a package file without company-manifest provenance", () => {
  const input = fixture();
  const rule = input.sources[0]!;
  const result = buildPortalSubmissionRehearsal({
    ...input,
    files: [
      {
        ...input.files[0]!,
        filename: "portal-rule",
        sizeText: "5 MB",
        sha256: rule.contentSha256,
        citations: [citation(rule)],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.files.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "package_manifest_source_invalid",
    ),
  );
});

test("rejects machine byte limits and sizes that diverge from cited text", () => {
  const input = fixture();
  const result = buildPortalSubmissionRehearsal({
    ...input,
    fields: [{ ...input.fields[0]!, maxFileBytes: 1 }, input.fields[1]!],
    files: [{ ...input.files[0]!, sizeBytes: 1 }],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.fields.length, 1);
  assert.equal(result.files.length, 0);
  assert.ok(
    result.issues.some((issue) => issue.code === "portal_rule_facts_not_cited"),
  );
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "package_manifest_facts_not_cited",
    ),
  );
});

test("requires the emitted portal field label in the exact rule citation", () => {
  const input = fixture();
  const result = buildPortalSubmissionRehearsal({
    ...input,
    fields: [
      { ...input.fields[0]!, label: "Uncited replacement label" },
      input.fields[1]!,
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(
    result.fields.some((field) => field.externalId === "technical-upload"),
    false,
  );
  assert.ok(
    result.issues.some((issue) => issue.code === "portal_rule_facts_not_cited"),
  );
});

test("does not accept upload order one from a cited order ten", () => {
  const input = fixture();
  const misleadingRule = source(
    "portal-rule-order-ten",
    "other",
    "Required file field Technical proposal, upload order 10, accepts .pdf up to 5000000 bytes (5 MB) and the filename must begin technical-.",
  );
  const result = buildPortalSubmissionRehearsal({
    ...input,
    sources: [...input.sources, misleadingRule],
    fields: [
      {
        ...input.fields[0]!,
        ruleText: misleadingRule.content,
        citations: [citation(misleadingRule)],
      },
      input.fields[1]!,
    ],
    mappings: [
      {
        ...input.mappings[0]!,
        citations: [citation(misleadingRule), input.files[0]!.citations[0]!],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.ok(
    result.issues.some((issue) => issue.code === "portal_rule_facts_not_cited"),
  );
});

test("does not launder manifest provenance through mixed source kinds", () => {
  const input = fixture();
  const manifestLikePortalRule = source(
    "manifest-like-portal-rule",
    "other",
    `technical-proposal.pdf 1024 bytes ${FILE_HASH}`,
  );
  const irrelevantCompany = source(
    "irrelevant-company-record",
    "company_evidence",
    "Registered office record only.",
    "corroborating",
  );
  const result = buildPortalSubmissionRehearsal({
    ...input,
    sources: [...input.sources, manifestLikePortalRule, irrelevantCompany],
    files: [
      {
        ...input.files[0]!,
        citations: [
          citation(manifestLikePortalRule),
          citation(irrelevantCompany),
        ],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.files.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "package_manifest_source_invalid",
    ),
  );
});

test("rejects a mapping cited to a different portal field", () => {
  const input = fixture();
  const declaration = input.fields[1]!;
  const result = buildPortalSubmissionRehearsal({
    ...input,
    mappings: [
      {
        ...input.mappings[0]!,
        citations: declaration.citations,
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.mappings.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "portal_mapping_rule_not_cited",
    ),
  );
});

test("rejects a file-to-field mapping without an exact manifest linkage claim", () => {
  const input = fixture();
  const unlinkedManifest = source(
    "unlinked-package-manifest",
    "company_evidence",
    `technical-alternate.pdf 1024 bytes ${FILE_HASH}`,
    "corroborating",
  );
  const unlinkedFile = {
    ...input.files[0]!,
    externalId: "technical-alternate-file",
    filename: "technical-alternate.pdf",
    citations: [citation(unlinkedManifest)],
  };
  const result = buildPortalSubmissionRehearsal({
    ...input,
    sources: [...input.sources, unlinkedManifest],
    files: [unlinkedFile],
    mappings: [
      {
        ...input.mappings[0]!,
        fileExternalId: unlinkedFile.externalId,
        citations: [input.fields[0]!.citations[0]!, unlinkedFile.citations[0]!],
      },
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.mappings.length, 0);
  assert.ok(
    result.issues.some(
      (issue) => issue.code === "portal_mapping_claim_not_cited",
    ),
  );
});

test("rehearsal identity is stable across source and field order", () => {
  const input = fixture();
  const baseline = buildPortalSubmissionRehearsal(input);
  const reordered = buildPortalSubmissionRehearsal({
    ...input,
    sources: [...input.sources].reverse(),
    fields: [...input.fields].reverse(),
    files: [...input.files].reverse(),
    mappings: [...input.mappings].reverse(),
  });
  assert.equal(reordered.rehearsalId, baseline.rehearsalId);
  assert.deepEqual(reordered.checks, baseline.checks);
});

test("rehearsal identity binds displayed portal constraint text", () => {
  const input = fixture();
  const baseline = buildPortalSubmissionRehearsal(input);
  const changed = buildPortalSubmissionRehearsal({
    ...input,
    fields: [
      {
        ...input.fields[0]!,
        maxFileBytesText: "5000000 bytes",
      },
      input.fields[1]!,
    ],
  });
  assert.equal(changed.status, "review_required");
  assert.notEqual(changed.fields[0]?.fieldId, baseline.fields[0]?.fieldId);
  assert.notEqual(changed.rehearsalId, baseline.rehearsalId);
});

test("a rehearsal approval cannot transfer to a changed mapping", () => {
  const input = fixture();
  const baseline = buildPortalSubmissionRehearsal(input);
  const changed = buildPortalSubmissionRehearsal({
    ...input,
    mappings: [
      {
        ...input.mappings[0]!,
        rationale: "A different operator mapping rationale.",
      },
    ],
    rehearsalReview: { subjectId: baseline.rehearsalId, review: ACCEPTED },
  });
  assert.equal(changed.status, "blocked");
  assert.equal(changed.readyForOperatorRehearsal, false);
  assert.ok(
    changed.issues.some((issue) => issue.code === "review_subject_mismatch"),
  );
});

test("rehearsal identity excludes mutable item-review provenance", () => {
  const input = fixture();
  const baseline = buildPortalSubmissionRehearsal(input);
  const changed = buildPortalSubmissionRehearsal({
    ...input,
    files: [
      {
        ...input.files[0]!,
        review: { ...ACCEPTED, reviewerId: "second-portal-operator" },
      },
    ],
    rehearsalReview: { subjectId: baseline.rehearsalId, review: ACCEPTED },
  });
  assert.equal(changed.rehearsalId, baseline.rehearsalId);
  assert.equal(changed.status, "rehearsal_ready");
});

test("accepts bounded long canonical portal and manifest sources", () => {
  const input = fixture();
  const portal = {
    ...input.sources[0]!,
    content: `${input.sources[0]!.content}\n${"P".repeat(21_000)}`,
  };
  const manifest = {
    ...input.sources[1]!,
    content: `${input.sources[1]!.content}\n${"M".repeat(21_000)}`,
  };
  const boundPortal = { ...portal, contentSha256: sha256Text(portal.content) };
  const boundManifest = {
    ...manifest,
    contentSha256: sha256Text(manifest.content),
  };
  const result = buildPortalSubmissionRehearsal({
    ...input,
    sources: [boundPortal, boundManifest],
    fields: input.fields.map((field) => ({
      ...field,
      citations: field.citations.map((item) =>
        item.sourceId === input.sources[0]!.sourceId
          ? citation(boundPortal, item.quote)
          : item,
      ),
    })),
    files: input.files.map((file) => ({
      ...file,
      citations: [citation(boundManifest, file.citations[0]!.quote)],
    })),
    mappings: input.mappings.map((mapping) => ({
      ...mapping,
      citations: [
        citation(boundPortal, mapping.citations[0]!.quote),
        citation(boundManifest, mapping.citations[1]!.quote),
      ],
    })),
  });
  assert.equal(
    result.issues.some(
      (issue) => issue.code === "capability_text_limit_exceeded",
    ),
    false,
  );
  assert.equal(result.status, "review_required");
});
