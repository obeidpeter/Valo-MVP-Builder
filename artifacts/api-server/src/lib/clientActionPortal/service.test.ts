import assert from "node:assert/strict";
import test from "node:test";
import type { ClientActionScope } from "./contracts";
import { ClientActionError } from "./errors";
import {
  ClientActionService,
  InMemoryClientActionRepository,
  type ClientActionAuthority,
} from "./service";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const OPERATOR_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const READ_ONLY_ID = "77777777-7777-4777-8777-777777777777";
const DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";
const PACKAGE_VERSION_ID = "66666666-6666-4666-8666-666666666666";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

class TestAuthority implements ClientActionAuthority {
  readonly active = new Set([OPERATOR_ID, CLIENT_ID, READ_ONLY_ID]);
  readonly evidenceRecipients = new Set([CLIENT_ID]);
  readonly documents: string[] = [];
  readonly packages: string[] = [];

  async assertProject(_scope: ClientActionScope): Promise<void> {}

  async assertNamedHuman(
    _scope: ClientActionScope,
    userId: string,
  ): Promise<void> {
    if (!this.active.has(userId)) {
      throw new ClientActionError("scope_denied", "Named participant denied.");
    }
  }

  async assertEvidenceRequestRecipient(
    _scope: ClientActionScope,
    userId: string,
  ): Promise<void> {
    if (!this.evidenceRecipients.has(userId)) {
      throw new ClientActionError(
        "scope_denied",
        "Evidence request recipient denied.",
      );
    }
  }

  async assertCanonicalDocument(
    _scope: ClientActionScope,
    input: {
      documentId: string;
      sha256: string;
      acceptedContentTypes: readonly string[];
      uploadedByUserId: string;
    },
  ): Promise<void> {
    if (
      input.documentId !== DOCUMENT_ID ||
      input.sha256 !== SHA_A ||
      input.uploadedByUserId !== CLIENT_ID ||
      !input.acceptedContentTypes.includes("application/pdf")
    ) {
      throw new ClientActionError("scope_denied", "Document denied.");
    }
    this.documents.push(input.documentId);
  }

  async assertReleasedPackage(
    _scope: ClientActionScope,
    input: {
      packageVersionId: string;
      manifestSha256: string;
      releaseReceiptSha256: string;
    },
  ): Promise<void> {
    if (
      input.packageVersionId !== PACKAGE_VERSION_ID ||
      input.manifestSha256 !== SHA_A ||
      input.releaseReceiptSha256 !== SHA_B
    ) {
      throw new ClientActionError("scope_denied", "Package denied.");
    }
    this.packages.push(input.packageVersionId);
  }
}

function harness() {
  let sequence = 100;
  const authority = new TestAuthority();
  const repository = new InMemoryClientActionRepository();
  const service = new ClientActionService({
    authority,
    repository,
    now: () => new Date("2026-08-11T10:00:00.000Z"),
    idFactory: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  const operator: ClientActionScope = {
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    actorUserId: OPERATOR_ID,
  };
  const client = { ...operator, actorUserId: CLIENT_ID };
  return { authority, repository, service, operator, client };
}

async function createRequest(
  service: ClientActionService,
  scope: ClientActionScope,
) {
  return service.createEvidenceRequest(scope, {
    purpose: "tender_evidence",
    purposeStatement:
      "Provide the current tax clearance evidence for this pursuit only.",
    recipientUserId: CLIENT_ID,
    dueAt: "2026-08-15T12:00:00.000Z",
    slots: [
      {
        label: "Tax clearance certificate",
        required: true,
        acceptedContentTypes: ["application/pdf"],
      },
    ],
  });
}

test("runs the acknowledgement, intent, canonical attachment and maker-checker flow", async () => {
  const { authority, service, operator, client } = harness();
  let request = await createRequest(service, operator);
  assert.equal(request.status, "open");
  assert.equal(request.externalMessageSentByValo, false);

  request = await service.acknowledgeRequest(client, request.id, {
    expectedVersion: request.version,
    statement: "I acknowledge this evidence request.",
  });
  assert.equal(request.status, "acknowledged");

  request = await service.recordUploadIntent(
    client,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      filename: "tax-clearance.pdf",
      contentType: "application/pdf",
      sizeBytes: 1_024,
      declaredSha256: SHA_A,
    },
  );
  const intentId = request.slots[0]!.attempts[0]!.intent.id;
  assert.equal(request.status, "in_progress");

  request = await service.attachCanonicalDocument(
    client,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      intentId,
      documentId: DOCUMENT_ID,
      sha256: SHA_A,
    },
  );
  assert.equal(request.status, "submitted");
  assert.deepEqual(authority.documents, [DOCUMENT_ID]);

  await assert.rejects(
    () =>
      service.reviewSlot(client, request.id, request.slots[0]!.id, {
        expectedVersion: request.version,
        decision: "accepted",
        reason: "Self approval is forbidden.",
      }),
    (error: unknown) =>
      error instanceof ClientActionError && error.code === "policy_denied",
  );

  request = await service.reviewSlot(
    operator,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      decision: "accepted",
      reason: "The canonical document matches the requested evidence.",
    },
  );
  assert.equal(request.status, "completed");
  assert.match(request.completionReceiptSha256 ?? "", /^[a-f0-9]{64}$/u);

  const snapshot = await service.snapshot(client);
  assert.deepEqual(snapshot.authority, {
    externalMessaging: false,
    rawUpload: false,
    packageTransfer: false,
    uploadIntentOnly: true,
  });
});

test("requires correction acknowledgement before a bounded replacement attempt", async () => {
  const { service, operator, client } = harness();
  let request = await createRequest(service, operator);
  request = await service.acknowledgeRequest(client, request.id, {
    expectedVersion: request.version,
    statement: "Request received.",
  });
  request = await service.recordUploadIntent(
    client,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      filename: "first.pdf",
      contentType: "application/pdf",
      sizeBytes: 50,
      declaredSha256: SHA_A,
    },
  );
  request = await service.attachCanonicalDocument(
    client,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      intentId: request.slots[0]!.attempts[0]!.intent.id,
      documentId: DOCUMENT_ID,
      sha256: SHA_A,
    },
  );
  request = await service.reviewSlot(
    operator,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      decision: "correction_required",
      reason: "The certificate page showing the validity date is missing.",
    },
  );
  assert.equal(request.status, "changes_required");

  await assert.rejects(
    () =>
      service.recordUploadIntent(client, request.id, request.slots[0]!.id, {
        expectedVersion: request.version,
        filename: "replacement.pdf",
        contentType: "application/pdf",
        sizeBytes: 50,
        declaredSha256: SHA_A,
      }),
    (error: unknown) =>
      error instanceof ClientActionError && error.code === "policy_denied",
  );

  request = await service.acknowledgeCorrection(
    client,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      statement: "I acknowledge the requested replacement page.",
    },
  );
  request = await service.recordUploadIntent(
    client,
    request.id,
    request.slots[0]!.id,
    {
      expectedVersion: request.version,
      filename: "replacement.pdf",
      contentType: "application/pdf",
      sizeBytes: 75,
      declaredSha256: SHA_A,
    },
  );
  assert.equal(request.slots[0]!.attempts.length, 2);
  assert.equal(request.status, "in_progress");
});

test("binds package acknowledgement to a released package, recipient and CAS", async () => {
  const { authority, service, operator, client } = harness();
  let delivery = await service.createPackageDelivery(operator, {
    recipientUserId: CLIENT_ID,
    packageVersionId: PACKAGE_VERSION_ID,
    manifestSha256: SHA_A,
    releaseReceiptSha256: SHA_B,
  });
  assert.equal(delivery.deliveryMode, "metadata_record_only");
  assert.equal(delivery.externalDeliveryPerformedByValo, false);

  await assert.rejects(
    () =>
      service.acknowledgePackageDelivery(client, delivery.id, {
        expectedVersion: delivery.version + 1,
        statement: "Received.",
      }),
    (error: unknown) =>
      error instanceof ClientActionError && error.code === "stale_version",
  );

  delivery = await service.acknowledgePackageDelivery(client, delivery.id, {
    expectedVersion: delivery.version,
    statement: "I acknowledge receipt of this exact released package version.",
  });
  assert.equal(delivery.status, "acknowledged");
  assert.match(
    delivery.acknowledgement?.receiptSha256 ?? "",
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(authority.packages.length, 2);
});

test("rejects unsupported purpose, extra fields and noncanonical media intent", async () => {
  const { service, operator, client } = harness();
  await assert.rejects(
    () =>
      service.createEvidenceRequest(operator, {
        purpose: "marketing",
        purposeStatement: "Too broad",
        recipientUserId: CLIENT_ID,
        slots: [{ label: "Anything", required: true }],
      }),
    (error: unknown) =>
      error instanceof ClientActionError && error.code === "invalid_request",
  );

  let request = await createRequest(service, operator);
  request = await service.acknowledgeRequest(client, request.id, {
    expectedVersion: request.version,
    statement: "Received.",
  });
  await assert.rejects(
    () =>
      service.recordUploadIntent(client, request.id, request.slots[0]!.id, {
        expectedVersion: request.version,
        filename: "payload.exe",
        contentType: "application/octet-stream",
        sizeBytes: 10,
        declaredSha256: SHA_A,
        uploadUrl: "https://example.invalid/bypass",
      }),
    (error: unknown) =>
      error instanceof ClientActionError && error.code === "invalid_request",
  );
});

test("rejects an active named read-only recipient at the repository write boundary", async () => {
  const { repository, service, operator } = harness();
  await assert.rejects(
    () =>
      service.createEvidenceRequest(operator, {
        purpose: "tender_evidence",
        purposeStatement:
          "This raw request must not bypass recipient upload authority.",
        recipientUserId: READ_ONLY_ID,
        slots: [{ label: "Evidence", required: true }],
      }),
    (error: unknown) =>
      error instanceof ClientActionError && error.code === "scope_denied",
  );
  assert.deepEqual(await repository.list(operator), []);
});
