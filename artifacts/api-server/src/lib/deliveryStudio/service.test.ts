import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type {
  DeliveryStudioDerivedAction,
  DeliveryStudioRepository,
  DeliveryStudioRepositorySnapshot,
  DeliveryStudioScope,
} from "./contracts";
import {
  bindDeliveryStudioSingleUnitCitation,
  buildDeliveryStudioRehearsalManifestText,
  deliveryStudioRehearsalManifestOrigin,
  deliveryStudioRehearsalManifestTitle,
  DeliveryStudioError,
} from "./contracts";
import { sha256Text } from "../intelligence/domain";
import { buildPortalSubmissionRehearsal } from "../intelligence/portalSubmissionRehearsal";
import { DeliveryStudioService } from "./service";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const scope: DeliveryStudioScope = {
  organisationId: ORGANISATION_ID,
  actorUserId: ACTOR_ID,
  actorName: "Ada Reviewer",
  membershipId: "44444444-4444-4444-8444-444444444444",
};

const snapshot: DeliveryStudioRepositorySnapshot = {
  version: 2,
  project: {
    id: PROJECT_ID,
    title: "Deterministic response",
    status: "review",
    deadline: null,
  },
  sourceSnapshotHash: "a".repeat(64),
  responseStudio: {
    status: "review_required",
    sectionCount: 1,
    claimCount: 1,
    groundedClaimCount: 0,
    placeholderCount: 0,
    sections: [],
  },
  redTeamReview: { status: "not_started", dueAt: null, run: null },
  packageAssembly: { status: "not_started", package: null },
  submissionRehearsal: { status: "not_started", receipt: null },
};

describe("DeliveryStudioService deterministic engines", () => {
  test("company evidence uses only an exact page-1 bounded canonical unit", () => {
    const canonicalText = "Certificate number RC-123 remains valid.";
    const startOffset = canonicalText.indexOf("RC-123");
    const bound = bindDeliveryStudioSingleUnitCitation({
      canonicalText,
      pageCount: null,
      citation: {
        pageNumber: 1,
        quote: "RC-123",
        startOffset,
        endOffset: startOffset + "RC-123".length,
      },
    });
    assert.deepEqual(bound, {
      canonicalPageText: "RC-123",
      startOffset: 0,
      endOffset: "RC-123".length,
    });
    assert.deepEqual(
      bindDeliveryStudioSingleUnitCitation({
        canonicalText: `${"x".repeat(70_000)} unique company proof`,
        pageCount: 1,
        citation: { pageNumber: 1, quote: "unique company proof" },
      }),
      {
        canonicalPageText: "unique company proof",
        startOffset: 0,
        endOffset: "unique company proof".length,
      },
    );
    assert.equal(
      bindDeliveryStudioSingleUnitCitation({
        canonicalText: "duplicate proof and duplicate proof",
        pageCount: 1,
        citation: { pageNumber: 1, quote: "duplicate proof" },
      }),
      null,
    );
    assert.equal(
      bindDeliveryStudioSingleUnitCitation({
        canonicalText,
        pageCount: 2,
        citation: {
          pageNumber: 1,
          quote: "RC-123",
          startOffset,
          endOffset: startOffset + "RC-123".length,
        },
      }),
      null,
    );
    assert.equal(
      bindDeliveryStudioSingleUnitCitation({
        canonicalText,
        pageCount: null,
        citation: {
          pageNumber: 2,
          quote: "RC-123",
          startOffset,
          endOffset: startOffset + 6,
        },
      }),
      null,
    );
  });

  test("runs citation-first validation before saving a response", async () => {
    let derived: DeliveryStudioDerivedAction | undefined;
    const repository: DeliveryStudioRepository = {
      load: async () => snapshot,
      portfolio: async () => ({
        totals: {
          projectCount: 0,
          responseReadyCount: 0,
          redTeamApprovedCount: 0,
          packageReadyCount: 0,
          rehearsalReadyCount: 0,
          confirmedOutcomeCount: 0,
        },
        projects: [],
      }),
      prepareResponseValidation: async () => ({
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        claims: [
          {
            id: "methodology",
            sectionId: "technical",
            text: "Named operators control final submission.",
            kind: "opinion",
            citations: [],
          },
        ],
      }),
      mutate: async (input) => {
        derived = input.derived;
        return {
          outcome: "recorded",
          receiptId: "55555555-5555-4555-8555-555555555555",
        };
      },
    };
    const service = new DeliveryStudioService(
      repository,
      () => new Date("2026-08-22T10:00:00.000Z"),
    );
    await service.execute({
      scope,
      projectId: PROJECT_ID,
      ifMatch: 1,
      idempotencyKey: "delivery-studio-save-001",
      data: {
        action: "save_response",
        sectionKey: "technical",
        title: "Technical response",
        content: "Named operators control final submission.",
        claims: [
          {
            claimKey: "methodology",
            text: "Named operators control final submission.",
            kind: "opinion",
            citations: [],
          },
        ],
      },
    });
    assert.equal(
      derived?.responseValidation?.validationStatus,
      "eligible_for_human_review",
    );
    assert.equal(derived?.responseValidation?.releaseAuthorized, false);
  });

  test("defers portal rehearsal derivation to the server-bound repository", async () => {
    let derived: DeliveryStudioDerivedAction | undefined;
    const repository: DeliveryStudioRepository = {
      load: async () => snapshot,
      prepareResponseValidation: async () => ({
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        claims: [],
      }),
      portfolio: async () => ({
        totals: {
          projectCount: 0,
          responseReadyCount: 0,
          redTeamApprovedCount: 0,
          packageReadyCount: 0,
          rehearsalReadyCount: 0,
          confirmedOutcomeCount: 0,
        },
        projects: [],
      }),
      mutate: async (input) => {
        derived = input.derived;
        return {
          outcome: "recorded",
          receiptId: "55555555-5555-4555-8555-555555555555",
        };
      },
    };
    const service = new DeliveryStudioService(repository);
    await service.execute({
      scope,
      projectId: PROJECT_ID,
      ifMatch: 1,
      idempotencyKey: "delivery-studio-rehearse-001",
      data: {
        action: "rehearse_submission",
        packageVersionId: "66666666-6666-4666-8666-666666666666",
        rehearsal: { sources: [], fields: [], files: [], mappings: [] },
      },
    });
    assert.equal(derived?.rehearsalResult, undefined);
    assert.equal(derived?.normalizedRehearsal, undefined);
  });

  test("portfolio intelligence remains tenant-local and prediction-free", async () => {
    const repository: DeliveryStudioRepository = {
      load: async () => snapshot,
      prepareResponseValidation: async () => ({
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        claims: [],
      }),
      mutate: async () => ({
        outcome: "recorded",
        receiptId: "55555555-5555-4555-8555-555555555555",
      }),
      portfolio: async () => ({
        totals: {
          projectCount: 0,
          responseReadyCount: 0,
          redTeamApprovedCount: 0,
          packageReadyCount: 0,
          rehearsalReadyCount: 0,
          confirmedOutcomeCount: 0,
        },
        projects: [],
      }),
    };
    const result = await new DeliveryStudioService(repository).getPortfolio(
      scope,
    );
    assert.equal(result.totals.confirmedOutcomeCount, 0);
    assert.match(result.limitations.join(" "), /not win predictions/iu);
    assert.match(result.limitations.join(" "), /current organisation/iu);
    assert.match(
      result.limitations.join(" "),
      /lesson derivation is unavailable/iu,
    );
  });

  test("canonical server manifest text can produce a rehearsal-ready deterministic result", () => {
    const packageId = "55555555-5555-4555-8555-555555555555";
    const packageVersionId = "66666666-6666-4666-8666-666666666666";
    const documentId = "77777777-7777-4777-8777-777777777777";
    const documentVersionId = "88888888-8888-4888-8888-888888888888";
    const reviewedAt = "2026-08-22T10:00:00.000Z";
    const filename = "001-technical.pdf";
    const fileSha256 = "b".repeat(64);
    const fieldLabel = "Technical response";
    const rationale = "Matches the required technical response.";
    const portalRule =
      "Required file field Technical response, upload order 1.";
    const manifest = buildDeliveryStudioRehearsalManifestText({
      packageId,
      packageVersionId,
      files: [
        {
          filename,
          sizeBytes: 12,
          sha256: fileSha256,
          mappings: [{ fieldLabel, rationale }],
        },
      ],
    });
    const portalSource = {
      sourceId: documentId,
      versionId: documentVersionId,
      kind: "solicitation" as const,
      title: "Invitation to tender.pdf",
      content: portalRule,
      contentSha256: sha256Text(portalRule),
      capturedAt: reviewedAt,
      authority: "authoritative" as const,
      origin: `document:${documentId}:version:${documentVersionId}`,
    };
    const manifestSource = {
      sourceId: packageId,
      versionId: packageVersionId,
      kind: "company_evidence" as const,
      title: deliveryStudioRehearsalManifestTitle(packageVersionId),
      content: manifest,
      contentSha256: sha256Text(manifest),
      capturedAt: reviewedAt,
      authority: "authoritative" as const,
      origin: deliveryStudioRehearsalManifestOrigin(
        packageId,
        packageVersionId,
      ),
    };
    const portalCitation = {
      sourceId: portalSource.sourceId,
      sourceVersionId: portalSource.versionId,
      contentSha256: portalSource.contentSha256,
      startOffset: 0,
      endOffset: portalRule.length,
      quote: portalRule,
    };
    const manifestCitation = {
      sourceId: manifestSource.sourceId,
      sourceVersionId: manifestSource.versionId,
      contentSha256: manifestSource.contentSha256,
      startOffset: 0,
      endOffset: manifest.length,
      quote: manifest,
    };
    const review = {
      state: "accepted" as const,
      reviewerId: ACTOR_ID,
      reviewedAt,
      note: "Checked against the current source.",
    };
    const input = {
      sources: [portalSource, manifestSource],
      fields: [
        {
          externalId: "technical_field",
          label: fieldLabel,
          fieldType: "file" as const,
          required: true,
          uploadOrder: 1,
          ruleText: portalRule,
          citations: [portalCitation],
          review,
        },
      ],
      files: [
        {
          externalId: "technical_file",
          filename,
          sizeBytes: 12,
          sizeText: "12 bytes",
          sha256: fileSha256,
          citations: [manifestCitation],
          review,
        },
      ],
      mappings: [
        {
          externalId: "technical_mapping",
          fieldExternalId: "technical_field",
          fileExternalId: "technical_file",
          rationale,
          citations: [portalCitation, manifestCitation],
          review,
        },
      ],
    };
    const proposed = buildPortalSubmissionRehearsal(input);
    assert.equal(proposed.status, "review_required");
    const ready = buildPortalSubmissionRehearsal({
      ...input,
      rehearsalReview: { subjectId: proposed.rehearsalId, review },
    });
    assert.equal(ready.status, "rehearsal_ready");
    assert.equal(ready.readyForOperatorRehearsal, true);
    assert.equal(ready.portalActionAuthorized, false);
  });

  test("recorded mutations turn projection failures into rollback errors", async () => {
    const projectionFailure = new DeliveryStudioError(
      "conflict",
      "projection exceeded a bound",
    );
    const repository: DeliveryStudioRepository = {
      load: async () => {
        throw projectionFailure;
      },
      prepareResponseValidation: async () => ({
        organisationId: ORGANISATION_ID,
        projectId: PROJECT_ID,
        claims: [],
      }),
      mutate: async () => ({
        outcome: "recorded",
        receiptId: "55555555-5555-4555-8555-555555555555",
      }),
      portfolio: async () => ({
        totals: {
          projectCount: 0,
          responseReadyCount: 0,
          redTeamApprovedCount: 0,
          packageReadyCount: 0,
          rehearsalReadyCount: 0,
          confirmedOutcomeCount: 0,
        },
        projects: [],
      }),
    };
    await assert.rejects(
      new DeliveryStudioService(repository).execute({
        scope,
        projectId: PROJECT_ID,
        ifMatch: 2,
        idempotencyKey: "delivery-studio-rollback-001",
        data: { action: "assemble_package", packageType: "submission" },
      }),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof DeliveryStudioError) &&
        /must roll back/u.test(error.message),
    );
  });
});
