import assert from "node:assert/strict";
import test from "node:test";
import type { OperationsScope, WorkObjectLinks } from "./contracts";
import { OperationsSuiteError } from "./errors";
import {
  OperationsSuiteService,
  type OperationsSuiteReferenceGuard,
} from "./service";
import { InMemoryOperationsSuiteStore } from "./store";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);

class TestReferences implements OperationsSuiteReferenceGuard {
  readonly documents: string[] = [];
  readonly quarantinedDocuments = new Set<string>();
  readonly packageVersions: string[] = [];
  readonly vaultItems: string[] = [];
  readonly vaultSnapshots = new Map<
    string,
    { version: number; sha256: string }
  >([["vault-item-1", { version: 3, sha256: SHA_A }]]);
  readonly documentHashes = new Map<string, string>([
    ["document-1", SHA_A],
    ["document-attendance", SHA_B],
    ["document-text", SHA_C],
  ]);
  readonly documentContentTypes = new Map<string, string>([
    ["document-1", "application/pdf"],
    ["document-attendance", "application/pdf"],
    ["document-text", "text/plain"],
  ]);
  packageManifestSha256 = SHA_A;
  renderQaStatus: "pending" | "passed" | "failed" = "passed";

  async assertUser(_scope: OperationsScope, _userId: string): Promise<void> {}

  async assertWorkLinks(
    _scope: OperationsScope,
    _links: WorkObjectLinks,
  ): Promise<void> {}

  async assertDocument(
    _scope: OperationsScope,
    documentId: string,
    expectedSha256?: string,
    acceptedContentTypes?: readonly string[],
  ): Promise<void> {
    this.documents.push(documentId);
    if (this.quarantinedDocuments.has(documentId)) {
      throw new OperationsSuiteError(
        "scope_denied",
        "Referenced document access or integrity denied.",
      );
    }
    if (
      expectedSha256 !== undefined &&
      this.documentHashes.get(documentId) !== expectedSha256
    ) {
      throw new OperationsSuiteError(
        "scope_denied",
        "Referenced document access or integrity denied.",
      );
    }
    if (
      acceptedContentTypes &&
      acceptedContentTypes.length > 0 &&
      !acceptedContentTypes
        .map((value) => value.toLocaleLowerCase("en-US"))
        .includes(
          this.documentContentTypes
            .get(documentId)
            ?.toLocaleLowerCase("en-US") ?? "",
        )
    ) {
      throw new OperationsSuiteError(
        "scope_denied",
        "Referenced document access or integrity denied.",
      );
    }
  }

  async assertDocuments(
    _scope: OperationsScope,
    documentIds: readonly string[],
  ): Promise<void> {
    this.documents.push(...documentIds);
    if (documentIds.some((id) => this.quarantinedDocuments.has(id))) {
      throw new OperationsSuiteError(
        "scope_denied",
        "Referenced document access denied.",
      );
    }
  }

  async assertPackageVersion(
    _scope: OperationsScope,
    packageVersionId: string,
    constraints?: {
      packageId?: string;
      manifestSha256?: string;
      expectedManifestSha256?: string;
      requireRenderQaPassed?: boolean;
    },
  ): Promise<void> {
    this.packageVersions.push(packageVersionId);
    if (
      (constraints?.manifestSha256 !== undefined &&
        constraints.manifestSha256 !== this.packageManifestSha256) ||
      (constraints?.expectedManifestSha256 !== undefined &&
        constraints.expectedManifestSha256 !== this.packageManifestSha256) ||
      (constraints?.requireRenderQaPassed === true &&
        this.renderQaStatus !== "passed")
    ) {
      throw new OperationsSuiteError(
        "scope_denied",
        "Referenced package version access denied.",
      );
    }
  }

  async setPackageRenderQaResult(
    _scope: OperationsScope,
    packageVersionId: string,
    constraints: {
      manifestSha256: string;
      expectedManifestSha256: string;
    },
    status: "passed" | "failed",
  ): Promise<void> {
    this.packageVersions.push(packageVersionId);
    if (
      constraints.manifestSha256 !== this.packageManifestSha256 ||
      constraints.expectedManifestSha256 !== this.packageManifestSha256
    ) {
      throw new Error("Canonical package manifest changed during visual QA");
    }
    this.renderQaStatus = status;
  }

  async assertVaultItemSnapshot(
    _scope: OperationsScope,
    vaultItemId: string,
    vaultItemVersion: number,
    documentSha256: string,
  ): Promise<void> {
    this.vaultItems.push(vaultItemId);
    const snapshot = this.vaultSnapshots.get(vaultItemId);
    if (
      snapshot?.version !== vaultItemVersion ||
      snapshot.sha256 !== documentSha256
    ) {
      throw new OperationsSuiteError(
        "scope_denied",
        "Referenced credential version access or integrity denied.",
      );
    }
  }
}

function harness() {
  let sequence = 0;
  const references = new TestReferences();
  const service = new OperationsSuiteService({
    store: new InMemoryOperationsSuiteStore(),
    references,
    now: () => new Date("2026-08-11T10:00:00.000Z"),
    idFactory: () => `record-${++sequence}`,
  });
  return { service, references };
}

const scope: OperationsScope = {
  organisationId: "organisation-1",
  projectId: "project-1",
  actorUserId: "user-1",
};

function hasCode(code: OperationsSuiteError["code"]) {
  return (error: unknown) =>
    error instanceof OperationsSuiteError && error.code === code;
}

test("opportunity intake preserves provenance, deduplicates, scopes and confirms deadlines", async () => {
  const { service } = harness();
  const input = {
    title: "Road rehabilitation",
    issuer: "State Works Agency",
    reference: "SWA/2026/04",
    deadline: "2026-09-20T12:00:00Z",
    source: {
      type: "ocds",
      locator: "ocds-release-100",
      receivedAt: "2026-08-11T09:00:00Z",
      authorisationBasis: "Published OCDS release under the portal terms",
      contentSha256: SHA_A,
    },
  };
  const created = await service.createOpportunity(scope, input);
  assert.equal(created.deadlineStatus, "unconfirmed");
  assert.match(created.provenanceSha256, /^[a-f0-9]{64}$/u);
  await assert.rejects(
    service.createOpportunity(scope, input),
    hasCode("conflict"),
  );
  await assert.rejects(
    service.getRecord({ ...scope, projectId: "project-2" }, created.id),
    hasCode("not_found"),
  );

  const confirmed = await service.confirmOpportunityDeadline(
    scope,
    created.id,
    {
      expectedVersion: 1,
      deadline: "2026-09-21T12:00:00Z",
    },
  );
  assert.equal(confirmed.deadlineStatus, "human_confirmed");
  assert.equal(confirmed.deadlineConfirmedByUserId, scope.actorUserId);
  await assert.rejects(
    service.confirmOpportunityDeadline(scope, created.id, {
      expectedVersion: 1,
      deadline: "2026-09-22T12:00:00Z",
    }),
    hasCode("stale_version"),
  );
});

test("pursuit board enforces dependencies, approvals, actor comments and My Work", async () => {
  const { service } = harness();
  let dependency = await service.createWorkItem(scope, {
    title: "Collect tax certificate",
    ownerUserId: "user-1",
  });
  dependency = await service.updateWorkItem(scope, dependency.id, {
    expectedVersion: dependency.version,
    status: "ready",
  });
  dependency = await service.updateWorkItem(scope, dependency.id, {
    expectedVersion: dependency.version,
    status: "in_progress",
  });

  let primary = await service.createWorkItem(scope, {
    title: "Complete compliance schedule",
    ownerUserId: "user-1",
    dependsOnIds: [dependency.id],
    approvalRequired: true,
  });
  primary = await service.addWorkItemComment(scope, primary.id, {
    expectedVersion: primary.version,
    body: "Waiting for the issuer receipt.",
  });
  assert.equal(primary.comments[0]?.authorUserId, "user-1");
  primary = await service.updateWorkItem(scope, primary.id, {
    expectedVersion: primary.version,
    status: "ready",
  });
  primary = await service.updateWorkItem(scope, primary.id, {
    expectedVersion: primary.version,
    status: "in_progress",
  });
  await assert.rejects(
    service.updateWorkItem(scope, primary.id, {
      expectedVersion: primary.version,
      status: "done",
    }),
    hasCode("policy_denied"),
  );

  dependency = await service.updateWorkItem(scope, dependency.id, {
    expectedVersion: dependency.version,
    status: "done",
  });
  await assert.rejects(
    service.decideWorkItemApproval(scope, primary.id, {
      expectedVersion: primary.version,
      decision: "approved",
      reason: "The creator must not approve their own work.",
    }),
    hasCode("policy_denied"),
  );
  const approverScope = { ...scope, actorUserId: "user-2" };
  primary = await service.decideWorkItemApproval(approverScope, primary.id, {
    expectedVersion: primary.version,
    decision: "approved",
    reason: "Evidence checked against the requirement.",
  });
  assert.equal(primary.approval.decidedByUserId, "user-2");
  await assert.rejects(
    service.updateWorkItem(scope, primary.id, {
      expectedVersion: primary.version,
      title: "Substantively changed after approval",
    }),
    hasCode("policy_denied"),
  );
  primary = await service.updateWorkItem(scope, primary.id, {
    expectedVersion: primary.version,
    status: "done",
  });
  assert.equal(primary.status, "done");
  assert.deepEqual(
    (await service.listMyWork(scope)).map(({ id }) => id),
    [dependency.id, primary.id],
  );
});

test("evidence room records manual sharing, acceptance and a deterministic receipt", async () => {
  const { service, references } = harness();
  let request = await service.createEvidenceRequest(scope, {
    recipientLabel: "Client finance team",
    requestMessage: "Please provide the current clearance certificate.",
    slots: [
      {
        label: "Tax clearance",
        required: true,
        acceptedContentTypes: ["application/pdf"],
      },
    ],
  });
  await assert.rejects(
    service.recordEvidenceResponse(scope, request.id, {
      expectedVersion: 1,
      slotId: request.slots[0]?.id,
      documentId: "document-1",
      sha256: SHA_A,
      attestation: "Supplied by the client representative.",
    }),
    hasCode("policy_denied"),
  );
  request = await service.markEvidenceRequestShared(scope, request.id, {
    expectedVersion: request.version,
  });
  await assert.rejects(
    service.recordEvidenceResponse(scope, request.id, {
      expectedVersion: request.version,
      slotId: request.slots[0]?.id,
      documentId: "document-text",
      sha256: SHA_C,
      attestation: "A text file cannot satisfy the PDF-only slot.",
    }),
    hasCode("scope_denied"),
  );
  request = await service.recordEvidenceResponse(scope, request.id, {
    expectedVersion: request.version,
    slotId: request.slots[0]?.id,
    documentId: "document-1",
    sha256: SHA_A,
    attestation: "Supplied by the client representative.",
  });
  request = await service.decideEvidenceResponse(scope, request.id, {
    expectedVersion: request.version,
    slotId: request.slots[0]?.id,
    decision: "accepted",
    reason: "Issuer, date and integrity digest reviewed.",
  });
  assert.equal(request.status, "accepted");
  assert.match(request.receiptSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.deepEqual(references.documents, [
    "document-text",
    "document-1",
    "document-1",
  ]);
  assert.equal(request.deliveryMode, "manual_out_of_band");
});

test("war room can only record ordered human dispatch and receipt actions", async () => {
  const { service } = harness();
  let room = await service.createSubmissionWarRoom(scope, {
    packageId: "package-1",
    packageVersionId: "package-version-1",
    manifestSha256: SHA_A,
    copyCount: 2,
    sealIdentifiers: ["seal-001"],
  });
  assert.equal(room.externalActionPolicy, "record_only");
  await assert.rejects(
    service.advanceSubmissionWarRoom(scope, room.id, {
      expectedVersion: room.version,
      toStatus: "dispatched",
      dispatchMethod: "Human courier",
    }),
    hasCode("policy_denied"),
  );
  await service.createVisualQaReport(scope, {
    packageVersionId: "package-version-1",
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 400,
        nonWhitespacePixelRatio: 0.25,
        clippedElementCount: 0,
      },
    ],
  });
  for (const toStatus of ["frozen", "copies_prepared", "sealed"] as const) {
    room = await service.advanceSubmissionWarRoom(scope, room.id, {
      expectedVersion: room.version,
      toStatus,
    });
  }
  room = await service.advanceSubmissionWarRoom(scope, room.id, {
    expectedVersion: room.version,
    toStatus: "dispatched",
    dispatchMethod: "Human courier",
  });
  room = await service.advanceSubmissionWarRoom(scope, room.id, {
    expectedVersion: room.version,
    toStatus: "receipt_recorded",
    receiptSha256: SHA_B,
  });
  assert.equal(room.status, "receipt_recorded");
  assert.equal(room.dispatchedByUserId, "user-1");
  assert.equal(room.receiptSha256, SHA_B);
});

test("credential checks, missions and post-award completion stay human and evidence bound", async () => {
  const { service, references } = harness();
  await assert.rejects(
    service.createCredentialVerification(scope, {
      vaultItemId: "vault-item-1",
      vaultItemVersion: 3,
      documentSha256: SHA_A,
      authorityName: "Certificate issuer",
      officialSourceLocator: "https://issuer.example/verify",
      checkedAt: "not-a-date",
      outcome: "verified",
      receiptSha256: SHA_A,
    }),
    hasCode("invalid_request"),
  );
  await assert.rejects(
    service.createCredentialVerification(scope, {
      vaultItemId: "vault-item-1",
      vaultItemVersion: 3,
      documentSha256: SHA_A,
      authorityName: "Certificate issuer",
      officialSourceLocator: "https://issuer.example/verify",
      checkedAt: "2026-08-11T10:05:01.000Z",
      outcome: "verified",
      receiptSha256: SHA_A,
    }),
    hasCode("policy_denied"),
  );
  const credential = await service.createCredentialVerification(scope, {
    vaultItemId: "vault-item-1",
    vaultItemVersion: 3,
    documentSha256: SHA_A,
    authorityName: "Certificate issuer",
    officialSourceLocator: "https://issuer.example/verify",
    checkedAt: "2026-08-11T09:30:00Z",
    outcome: "verified",
    receiptSha256: SHA_A,
  });
  assert.equal(credential.verificationMode, "human_recorded");
  assert.equal(credential.vaultItemVersion, 3);
  assert.equal(credential.documentSha256, SHA_A);
  assert.deepEqual(references.vaultItems, ["vault-item-1"]);

  let followUp = await service.createWorkItem(scope, {
    title: "File visit notes",
  });
  let mission = await service.createMission(scope, {
    missionType: "site_visit",
    title: "Mandatory site visit",
    location: "Project site",
    startsAt: "2026-08-15T08:00:00Z",
    attendanceRequired: true,
    delegateUserId: "user-1",
    delegateAuthorityNote: "Authorised to sign the attendance register only.",
    checklist: [{ label: "Carry authority letter", required: true }],
  });
  mission = await service.updateMission(scope, mission.id, {
    expectedVersion: mission.version,
    status: "attended",
    completedChecklistItemId: mission.checklist[0]?.id,
    proofDocumentId: "document-attendance",
    proofSha256: SHA_B,
    followUpWorkItemId: followUp.id,
  });
  mission = await service.updateMission(scope, mission.id, {
    expectedVersion: mission.version,
    status: "completed",
  });
  assert.equal(mission.status, "completed");
  assert.deepEqual(mission.followUpWorkItemIds, [followUp.id]);

  let obligation = await service.createPostAwardItem(scope, {
    category: "deliverable",
    title: "Submit inception report",
    ownerUserId: "user-1",
    evidenceDocumentIds: ["document-report"],
  });
  await assert.rejects(
    service.updatePostAwardItem(scope, obligation.id, {
      expectedVersion: obligation.version,
      status: "satisfied",
    }),
    hasCode("policy_denied"),
  );
  obligation = await service.updatePostAwardItem(scope, obligation.id, {
    expectedVersion: obligation.version,
    status: "satisfied",
    completionReceiptSha256: SHA_C,
  });
  assert.equal(obligation.completedByUserId, "user-1");
  assert.equal(obligation.completionReceiptSha256, SHA_C);
  followUp = await service.updateWorkItem(scope, followUp.id, {
    expectedVersion: followUp.version,
    status: "ready",
  });
  assert.equal(followUp.status, "ready");
});

test("terminal mission and post-award transitions revalidate retained canonical documents under CAS", async () => {
  const { service, references } = harness();

  let mission = await service.createMission(scope, {
    missionType: "site_visit",
    title: "Inspect the project site",
    location: "Project site",
    startsAt: "2026-08-15T08:00:00Z",
    attendanceRequired: true,
    checklist: [],
  });
  mission = await service.updateMission(scope, mission.id, {
    expectedVersion: mission.version,
    status: "attended",
    proofDocumentId: "document-attendance",
    proofSha256: SHA_B,
  });
  references.quarantinedDocuments.add("document-attendance");
  await assert.rejects(
    service.updateMission(scope, mission.id, {
      expectedVersion: mission.version,
      status: "completed",
    }),
    hasCode("scope_denied"),
  );
  const missionAfterDenial = await service.getRecord(scope, mission.id);
  assert.equal(missionAfterDenial.kind, "mission");
  assert.equal(missionAfterDenial.status, "attended");
  assert.equal(missionAfterDenial.version, mission.version);
  references.quarantinedDocuments.delete("document-attendance");
  mission = await service.updateMission(scope, mission.id, {
    expectedVersion: mission.version,
    status: "completed",
  });
  assert.equal(mission.status, "completed");

  let postAward = await service.createPostAwardItem(scope, {
    category: "deliverable",
    title: "Accept the completion report",
    sourceDocumentId: "document-1",
    evidenceDocumentIds: ["document-report"],
  });
  references.quarantinedDocuments.add("document-report");
  await assert.rejects(
    service.updatePostAwardItem(scope, postAward.id, {
      expectedVersion: postAward.version,
      status: "satisfied",
      completionReceiptSha256: SHA_C,
    }),
    hasCode("scope_denied"),
  );
  references.quarantinedDocuments.delete("document-report");
  references.quarantinedDocuments.add("document-1");
  await assert.rejects(
    service.updatePostAwardItem(scope, postAward.id, {
      expectedVersion: postAward.version,
      status: "satisfied",
      completionReceiptSha256: SHA_C,
    }),
    hasCode("scope_denied"),
  );
  const postAwardAfterDenials = await service.getRecord(scope, postAward.id);
  assert.equal(postAwardAfterDenials.kind, "post_award_item");
  assert.equal(postAwardAfterDenials.status, "open");
  assert.equal(postAwardAfterDenials.version, postAward.version);
  references.quarantinedDocuments.delete("document-1");
  postAward = await service.updatePostAwardItem(scope, postAward.id, {
    expectedVersion: postAward.version,
    status: "satisfied",
    completionReceiptSha256: SHA_C,
  });
  assert.equal(postAward.status, "satisfied");
});

test("consequential status reasons remain authoritative on the versioned record", async () => {
  const { service } = harness();

  let work = await service.createWorkItem(scope, { title: "Withdraw task" });
  await assert.rejects(
    service.updateWorkItem(scope, work.id, {
      expectedVersion: work.version,
      status: "cancelled",
    }),
    hasCode("policy_denied"),
  );
  work = await service.updateWorkItem(scope, work.id, {
    expectedVersion: work.version,
    status: "cancelled",
    reason: "The requirement was withdrawn by the issuer.",
  });
  assert.deepEqual(
    work.statusReasonHistory.map(({ fromStatus, toStatus, reason }) => ({
      fromStatus,
      toStatus,
      reason,
    })),
    [
      {
        fromStatus: "backlog",
        toStatus: "cancelled",
        reason: "The requirement was withdrawn by the issuer.",
      },
    ],
  );

  let room = await service.createSubmissionWarRoom(scope, {
    packageId: "package-reason",
    packageVersionId: "package-version-reason",
    manifestSha256: SHA_A,
  });
  room = await service.advanceSubmissionWarRoom(scope, room.id, {
    expectedVersion: room.version,
    toStatus: "cancelled",
    reason: "Issuer cancelled the procurement.",
  });
  assert.equal(
    room.statusReasonHistory[0]?.reason,
    "Issuer cancelled the procurement.",
  );

  let mission = await service.createMission(scope, {
    missionType: "pre_bid",
    title: "Clarification meeting",
    location: "Issuer office",
    startsAt: "2026-08-20T08:00:00Z",
    attendanceRequired: false,
    checklist: [],
  });
  mission = await service.updateMission(scope, mission.id, {
    expectedVersion: mission.version,
    status: "missed",
    reason: "The issuer changed the meeting without notice.",
  });
  assert.equal(
    mission.statusReasonHistory[0]?.reason,
    "The issuer changed the meeting without notice.",
  );

  let award = await service.createPostAwardItem(scope, {
    category: "obligation",
    title: "Resolve acceptance dispute",
  });
  award = await service.updatePostAwardItem(scope, award.id, {
    expectedVersion: award.version,
    status: "disputed",
    reason: "Client disputed the measured quantity.",
  });
  award = await service.updatePostAwardItem(scope, award.id, {
    expectedVersion: award.version,
    status: "in_progress",
  });
  award = await service.updatePostAwardItem(scope, award.id, {
    expectedVersion: award.version,
    status: "cancelled",
    reason: "The parties replaced this item by signed variation.",
  });
  assert.deepEqual(
    award.statusReasonHistory.map(({ toStatus, reason }) => ({
      toStatus,
      reason,
    })),
    [
      {
        toStatus: "disputed",
        reason: "Client disputed the measured quantity.",
      },
      {
        toStatus: "cancelled",
        reason: "The parties replaced this item by signed variation.",
      },
    ],
  );
});

test("caller-equal hashes cannot substitute for canonical package or document hashes", async () => {
  const { service, references } = harness();
  await assert.rejects(
    service.createSubmissionWarRoom(scope, {
      packageId: "package-forged",
      packageVersionId: "package-version-forged",
      manifestSha256: SHA_B,
    }),
    hasCode("scope_denied"),
  );
  references.renderQaStatus = "pending";
  const canonicalQa = await service.createVisualQaReport(scope, {
    packageVersionId: "package-version-canonical-pending",
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 100,
        nonWhitespacePixelRatio: 0.1,
        clippedElementCount: 0,
      },
    ],
  });
  assert.equal(canonicalQa.result.status, "pass");
  assert.equal(references.renderQaStatus, "passed");
  await assert.rejects(
    service.createVisualQaReport(scope, {
      packageVersionId: "package-version-forged",
      manifestSha256: SHA_B,
      expectedManifestSha256: SHA_B,
      pages: [
        {
          pageNumber: 1,
          textCharacterCount: 100,
          nonWhitespacePixelRatio: 0.1,
          clippedElementCount: 0,
        },
      ],
    }),
    hasCode("scope_denied"),
  );

  let request = await service.createEvidenceRequest(scope, {
    recipientLabel: "Client records team",
    requestMessage: "Provide the signed record.",
    slots: [{ label: "Signed record", required: true }],
  });
  request = await service.markEvidenceRequestShared(scope, request.id, {
    expectedVersion: request.version,
  });
  await assert.rejects(
    service.recordEvidenceResponse(scope, request.id, {
      expectedVersion: request.version,
      slotId: request.slots[0]?.id,
      documentId: "document-1",
      sha256: SHA_B,
      attestation: "Caller supplied a forged digest.",
    }),
    hasCode("scope_denied"),
  );

  const mission = await service.createMission(scope, {
    missionType: "site_visit",
    title: "Site visit",
    location: "Site",
    startsAt: "2026-08-21T08:00:00Z",
    attendanceRequired: true,
    checklist: [],
  });
  await assert.rejects(
    service.updateMission(scope, mission.id, {
      expectedVersion: mission.version,
      status: "attended",
      proofDocumentId: "document-attendance",
      proofSha256: SHA_A,
    }),
    hasCode("scope_denied"),
  );
  await assert.rejects(
    service.createCredentialVerification(scope, {
      vaultItemId: "vault-item-1",
      vaultItemVersion: 3,
      documentSha256: SHA_B,
      authorityName: "Certificate issuer",
      officialSourceLocator: "https://issuer.example/verify",
      checkedAt: "2026-08-11T09:30:00Z",
      outcome: "verified",
      receiptSha256: SHA_C,
    }),
    hasCode("scope_denied"),
  );
});

test("freeze requires the latest clean canonical-manifest pass and authoritative render QA", async () => {
  const { service, references } = harness();
  let room = await service.createSubmissionWarRoom(scope, {
    packageId: "package-freeze",
    packageVersionId: "package-version-freeze",
    manifestSha256: SHA_A,
  });
  await assert.rejects(
    service.advanceSubmissionWarRoom(scope, room.id, {
      expectedVersion: room.version,
      toStatus: "frozen",
    }),
    hasCode("policy_denied"),
  );
  await service.createVisualQaReport(scope, {
    packageVersionId: room.packageVersionId,
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 0,
        nonWhitespacePixelRatio: 0,
        clippedElementCount: 0,
      },
    ],
  });
  await assert.rejects(
    service.advanceSubmissionWarRoom(scope, room.id, {
      expectedVersion: room.version,
      toStatus: "frozen",
    }),
    hasCode("policy_denied"),
  );
  await service.createVisualQaReport(scope, {
    packageVersionId: room.packageVersionId,
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 250,
        nonWhitespacePixelRatio: 0.2,
        clippedElementCount: 0,
      },
    ],
  });
  references.renderQaStatus = "pending";
  await assert.rejects(
    service.advanceSubmissionWarRoom(scope, room.id, {
      expectedVersion: room.version,
      toStatus: "frozen",
    }),
    hasCode("scope_denied"),
  );
  references.renderQaStatus = "passed";
  room = await service.advanceSubmissionWarRoom(scope, room.id, {
    expectedVersion: room.version,
    toStatus: "frozen",
  });
  assert.equal(room.status, "frozen");
  await service.createVisualQaReport(scope, {
    packageVersionId: room.packageVersionId,
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 250,
        nonWhitespacePixelRatio: 0.2,
        clippedElementCount: 1,
      },
    ],
  });
  assert.equal(references.renderQaStatus, "failed");
  await assert.rejects(
    service.advanceSubmissionWarRoom(scope, room.id, {
      expectedVersion: room.version,
      toStatus: "copies_prepared",
    }),
    hasCode("policy_denied"),
  );
  await service.createVisualQaReport(scope, {
    packageVersionId: room.packageVersionId,
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 250,
        nonWhitespacePixelRatio: 0.2,
        clippedElementCount: 0,
      },
    ],
  });
  assert.equal(references.renderQaStatus, "passed");
  room = await service.advanceSubmissionWarRoom(scope, room.id, {
    expectedVersion: room.version,
    toStatus: "copies_prepared",
  });
  assert.equal(room.status, "copies_prepared");

  const second = await service.createSubmissionWarRoom(scope, {
    packageId: "package-freeze-fail",
    packageVersionId: "package-version-freeze-fail",
    manifestSha256: SHA_A,
  });
  await service.createVisualQaReport(scope, {
    packageVersionId: second.packageVersionId,
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 250,
        nonWhitespacePixelRatio: 0.2,
        clippedElementCount: 0,
      },
    ],
  });
  await service.createVisualQaReport(scope, {
    packageVersionId: second.packageVersionId,
    manifestSha256: SHA_A,
    expectedManifestSha256: SHA_A,
    pages: [
      {
        pageNumber: 1,
        textCharacterCount: 250,
        nonWhitespacePixelRatio: 0.2,
        clippedElementCount: 1,
      },
    ],
  });
  await assert.rejects(
    service.advanceSubmissionWarRoom(scope, second.id, {
      expectedVersion: second.version,
      toStatus: "frozen",
    }),
    hasCode("policy_denied"),
  );
});

test("a rejected evidence response can be replaced without erasing its decision history", async () => {
  const { service } = harness();
  let request = await service.createEvidenceRequest(scope, {
    recipientLabel: "Client evidence owner",
    requestMessage: "Please provide the signed schedule.",
    slots: [{ label: "Signed schedule", required: true }],
  });
  request = await service.markEvidenceRequestShared(scope, request.id, {
    expectedVersion: request.version,
  });
  const slotId = request.slots[0]!.id;
  request = await service.recordEvidenceResponse(scope, request.id, {
    expectedVersion: request.version,
    slotId,
    documentId: "document-1",
    sha256: SHA_A,
    attestation: "Recorded after receipt from the client.",
  });
  request = await service.decideEvidenceResponse(scope, request.id, {
    expectedVersion: request.version,
    slotId,
    decision: "rejected",
    reason: "The schedule is unsigned.",
  });
  assert.equal(
    (await service.mobileQueue(scope, ["evidence_request"])).items.length,
    0,
  );
  await assert.rejects(
    service.decideEvidenceResponse(scope, request.id, {
      expectedVersion: request.version,
      slotId,
      decision: "accepted",
      reason: "Attempt to overwrite the prior decision.",
    }),
    hasCode("policy_denied"),
  );
  await assert.rejects(
    service.recordEvidenceResponse(scope, request.id, {
      expectedVersion: request.version,
      slotId,
      documentId: "document-attendance",
      sha256: SHA_A,
      attestation: "Replacement with the wrong canonical hash.",
    }),
    hasCode("scope_denied"),
  );
  request = await service.recordEvidenceResponse(scope, request.id, {
    expectedVersion: request.version,
    slotId,
    documentId: "document-attendance",
    sha256: SHA_B,
    attestation: "Replacement received with a signature.",
  });
  const replacement = request.slots[0]!;
  assert.equal(replacement.response?.documentId, "document-attendance");
  assert.equal(replacement.response?.sha256, SHA_B);
  assert.equal(replacement.acceptance, null);
  assert.equal(replacement.responseHistory.length, 1);
  assert.equal(
    replacement.responseHistory[0]?.response.documentId,
    "document-1",
  );
  assert.equal(
    replacement.responseHistory[0]?.acceptance.reason,
    "The schedule is unsigned.",
  );
  assert.equal(
    replacement.responseHistory[0]?.acceptance.decidedByUserId,
    scope.actorUserId,
  );
  assert.deepEqual(
    (await service.mobileQueue(scope, ["evidence_request"])).items.map(
      ({ subresourceId }) => subresourceId,
    ),
    [slotId],
  );
});

test("the store serialises concurrent active war-room inserts", async () => {
  class BarrierReferences extends TestReferences {
    #calls = 0;
    #release = (): void => undefined;
    readonly #both = new Promise<void>((resolve) => {
      this.#release = resolve;
    });

    override async assertPackageVersion(
      innerScope: OperationsScope,
      packageVersionId: string,
      constraints?: Parameters<TestReferences["assertPackageVersion"]>[2],
    ): Promise<void> {
      await super.assertPackageVersion(
        innerScope,
        packageVersionId,
        constraints,
      );
      this.#calls += 1;
      if (this.#calls === 2) this.#release();
      await this.#both;
    }
  }

  let sequence = 0;
  const service = new OperationsSuiteService({
    store: new InMemoryOperationsSuiteStore(),
    references: new BarrierReferences(),
    idFactory: () => `concurrent-${++sequence}`,
  });
  const input = {
    packageId: "package-concurrent",
    packageVersionId: "package-version-concurrent",
    manifestSha256: SHA_A,
  };
  const results = await Promise.allSettled([
    service.createSubmissionWarRoom(scope, input),
    service.createSubmissionWarRoom(scope, input),
  ]);
  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const rejected = results.find(({ status }) => status === "rejected");
  assert(
    rejected?.status === "rejected" &&
      rejected.reason instanceof OperationsSuiteError &&
      rejected.reason.code === "conflict",
  );
});

test("dependency cycle validation runs inside the serialised compare-and-swap", async () => {
  const { service } = harness();
  const first = await service.createWorkItem(scope, { title: "First" });
  const second = await service.createWorkItem(scope, { title: "Second" });
  const outcomes = await Promise.allSettled([
    service.updateWorkItem(scope, first.id, {
      expectedVersion: first.version,
      dependsOnIds: [second.id],
    }),
    service.updateWorkItem(scope, second.id, {
      expectedVersion: second.version,
      dependsOnIds: [first.id],
    }),
  ]);
  assert.equal(
    outcomes.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find(({ status }) => status === "rejected");
  assert(
    rejected?.status === "rejected" &&
      rejected.reason instanceof OperationsSuiteError &&
      rejected.reason.code === "policy_denied",
  );
});

test("mobile queue is compact, deterministic and permission-filtered", async () => {
  const { service } = harness();
  await service.createWorkItem(scope, {
    title: "Owned action",
    description: "This full body must not be projected.",
    ownerUserId: scope.actorUserId,
    dueAt: "2026-08-18T08:00:00Z",
  });
  await service.createWorkItem(scope, {
    title: "Someone else's action",
    ownerUserId: "user-2",
  });
  let evidence = await service.createEvidenceRequest(scope, {
    recipientLabel: "Client team",
    requestMessage: "A full request body that must stay off the queue.",
    dueAt: "2026-08-17T08:00:00Z",
    slots: [{ label: "Current certificate", required: true }],
  });
  evidence = await service.markEvidenceRequestShared(scope, evidence.id, {
    expectedVersion: evidence.version,
  });
  await service.recordEvidenceResponse(scope, evidence.id, {
    expectedVersion: evidence.version,
    slotId: evidence.slots[0]?.id,
    documentId: "document-1",
    sha256: SHA_A,
    attestation: "Recorded by a named human.",
  });
  await service.createMission(scope, {
    missionType: "pre_bid",
    title: "Pre-bid meeting",
    location: "A location excluded from the queue projection",
    startsAt: "2026-08-19T08:00:00Z",
    attendanceRequired: false,
    checklist: [],
  });

  const projectOnly = await service.mobileQueue(scope, [
    "work_item",
    "mission",
  ]);
  assert.deepEqual(
    projectOnly.items.map(({ kind }) => kind),
    ["work_item", "mission"],
  );
  const complete = await service.mobileQueue(scope, [
    "work_item",
    "evidence_request",
    "mission",
  ]);
  assert.deepEqual(
    complete.items.map(({ kind }) => kind),
    ["evidence_request", "work_item", "mission"],
  );
  assert(complete.items.every(({ restrictedContent }) => restrictedContent));
  const serialized = JSON.stringify(complete);
  assert.doesNotMatch(
    serialized,
    /full request body|full body|location excluded/u,
  );
  assert.doesNotMatch(
    serialized,
    /requestMessage|description|comments|proofs|manifestSha256/u,
  );
});

test("mobile queue fails closed rather than truncating fan-out", async () => {
  const { service } = harness();
  for (let index = 0; index < 250; index += 1) {
    await service.createWorkItem(scope, {
      title: `Queue item ${index}`,
      ownerUserId: scope.actorUserId,
    });
  }
  await service.createMission(scope, {
    missionType: "pre_bid",
    title: "One item beyond the bound",
    location: "Issuer office",
    startsAt: "2026-08-20T08:00:00Z",
    attendanceRequired: false,
    checklist: [],
  });
  await assert.rejects(
    service.mobileQueue(scope, ["work_item", "mission"]),
    hasCode("capacity_exceeded"),
  );
});
