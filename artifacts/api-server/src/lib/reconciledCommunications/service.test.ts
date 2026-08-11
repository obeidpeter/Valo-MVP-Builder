import assert from "node:assert/strict";
import test from "node:test";
import type { NotificationAdapter } from "../providerContracts";
import type {
  CommunicationChannel,
  CommunicationScope,
  CommunicationTemplateContext,
  CommunicationTemplateId,
} from "./contracts";
import { CommunicationError } from "./errors";
import {
  InMemoryCommunicationRepository,
  ReconciledCommunicationService,
  StaticNotificationProviderRegistry,
  type CommunicationAuthority,
  type NotificationReceiptVerifier,
} from "./service";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const OPERATOR_ID = "33333333-3333-4333-8333-333333333333";
const RECIPIENT_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";
const CONSENT_SHA = "a".repeat(64);
const RECEIPT_SHA = "b".repeat(64);
const NOW = new Date("2026-08-11T10:00:00.000Z");

class TestAuthority implements CommunicationAuthority {
  consentActive = true;
  readonly resolved: Array<{ userId: string; channel: CommunicationChannel }> =
    [];

  async assertProject(_scope: CommunicationScope): Promise<void> {}

  async assertNamedHuman(
    _scope: CommunicationScope,
    userId: string,
  ): Promise<void> {
    if (userId !== OPERATOR_ID && userId !== RECIPIENT_ID) {
      throw new CommunicationError("scope_denied", "Named human denied.");
    }
  }

  async resolveRecipient(
    _scope: CommunicationScope,
    input: {
      recipientUserId: string;
      channel: CommunicationChannel;
      consentEvidenceSha256: string;
    },
  ): Promise<{ recipient: string }> {
    if (
      !this.consentActive ||
      input.recipientUserId !== RECIPIENT_ID ||
      input.consentEvidenceSha256 !== CONSENT_SHA
    ) {
      throw new CommunicationError("scope_denied", "Consent denied.");
    }
    this.resolved.push({
      userId: input.recipientUserId,
      channel: input.channel,
    });
    return { recipient: "approved-recipient@example.test" };
  }

  async assertTemplateContext(
    _scope: CommunicationScope,
    input: {
      recipientUserId: string;
      templateId: CommunicationTemplateId;
      context: CommunicationTemplateContext;
    },
  ): Promise<void> {
    if (
      input.recipientUserId !== RECIPIENT_ID ||
      input.templateId !== "evidence_request_ready_v1" ||
      input.context.kind !== "evidence_request" ||
      input.context.requestId !== REQUEST_ID
    ) {
      throw new CommunicationError("scope_denied", "Canonical context denied.");
    }
  }
}

class TestNotificationAdapter implements NotificationAdapter {
  readonly descriptor = {
    kind: "email" as const,
    provider: "test-provider",
    mode: "production" as const,
    productionApproved: true,
    capabilities: ["approved_template_delivery"],
  };
  readonly deliveries: Array<Parameters<NotificationAdapter["deliver"]>[0]> =
    [];
  accepted = true;
  throws = false;

  async health() {
    return {
      healthy: true,
      checkedAt: NOW.toISOString(),
      message: "test adapter ready",
    };
  }

  async deliver(input: Parameters<NotificationAdapter["deliver"]>[0]) {
    this.deliveries.push(structuredClone(input));
    if (this.throws) throw new Error("ambiguous provider timeout");
    return {
      providerMessageId: "provider-message-001",
      accepted: this.accepted,
    };
  }
}

function queueInput() {
  return {
    idempotencyKey: "client-action-request-001",
    channel: "email",
    templateId: "evidence_request_ready_v1",
    recipientUserId: RECIPIENT_ID,
    consentEvidenceSha256: CONSENT_SHA,
    context: {
      kind: "evidence_request",
      requestId: REQUEST_ID,
      dueAt: "2026-08-15T12:00:00.000Z",
    },
    deadlineAt: "2026-08-20T12:00:00.000Z",
    maxAttempts: 3,
  };
}

function harness(input?: {
  adapter?: TestNotificationAdapter;
  verifier?: NotificationReceiptVerifier;
}) {
  const authority = new TestAuthority();
  const repository = new InMemoryCommunicationRepository();
  const service = new ReconciledCommunicationService({
    authority,
    repository,
    providers: input?.adapter
      ? new StaticNotificationProviderRegistry([input.adapter])
      : undefined,
    receiptVerifier: input?.verifier,
    now: () => new Date(NOW),
  });
  const scope: CommunicationScope = {
    organisationId: ORGANISATION_ID,
    projectId: PROJECT_ID,
    actorUserId: OPERATOR_ID,
  };
  return { authority, repository, service, scope };
}

test("queues only a closed template intent and replays exact idempotency", async () => {
  const { service, scope } = harness();
  const first = await service.queue(scope, queueInput());
  const replay = await service.queue(scope, queueInput());
  assert.equal(replay.id, first.id);
  assert.equal(replay.version, 1);
  assert.equal(replay.status, "queued");
  assert.equal(replay.arbitraryBodyAccepted, false);
  assert.equal(replay.rawRecipientPersisted, false);
  assert.equal(
    JSON.stringify(replay).includes("approved-recipient@example.test"),
    false,
  );

  await assert.rejects(
    () =>
      service.queue(scope, {
        ...queueInput(),
        body: "Arbitrary tender content must never be accepted.",
      }),
    (error: unknown) =>
      error instanceof CommunicationError && error.code === "invalid_request",
  );
  await assert.rejects(
    () =>
      service.queue(scope, {
        ...queueInput(),
        recipient: "somebody@example.test",
      }),
    (error: unknown) =>
      error instanceof CommunicationError && error.code === "invalid_request",
  );
});

test("records a disconnected pre-effect attempt and never claims delivery", async () => {
  const { service, scope } = harness();
  const queued = await service.queue(scope, queueInput());
  const settled = await service.attempt(scope, queued.id, {
    expectedVersion: queued.version,
  });
  assert.equal(settled.status, "retry_wait");
  assert.equal(settled.version, 3);
  assert.equal(settled.attempts.length, 1);
  assert.equal(settled.attempts[0]?.status, "provider_disconnected");
  assert.match(settled.attempts[0]?.idempotencyKey ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(settled.attempts[0]?.providerMessageId, null);
  assert.notEqual(settled.status, "delivered");
});

test("provider acceptance remains pending until an independently verified receipt", async () => {
  const adapter = new TestNotificationAdapter();
  const verifier: NotificationReceiptVerifier = {
    async verify(input) {
      assert.equal(input.providerMessageId, "provider-message-001");
      assert.equal(input.receiptReference, "receipt-ref-001");
      return {
        verified: true,
        outcome: "delivered",
        receiptSha256: RECEIPT_SHA,
        providerMessageId: "provider-message-001",
      };
    },
  };
  const { service, scope } = harness({ adapter, verifier });
  let event = await service.queue(scope, queueInput());
  event = await service.attempt(scope, event.id, {
    expectedVersion: event.version,
  });
  assert.equal(event.status, "accepted_pending_receipt");
  assert.equal(event.attempts[0]?.status, "accepted_pending_receipt");
  assert.equal(adapter.deliveries.length, 1);
  assert.equal(
    adapter.deliveries[0]?.recipient,
    "approved-recipient@example.test",
  );
  assert.deepEqual(Object.keys(adapter.deliveries[0]?.variables ?? {}).sort(), [
    "action_reference",
    "due_at",
    "workspace_path",
  ]);
  assert.equal(JSON.stringify(adapter.deliveries[0]).includes("tender"), false);

  event = await service.reconcile(scope, event.id, {
    expectedVersion: event.version,
    attemptId: event.attempts[0]!.id,
    receiptReference: "receipt-ref-001",
  });
  assert.equal(event.status, "delivered");
  assert.equal(event.attempts[0]?.status, "receipt_verified_delivered");
  assert.equal(event.attempts[0]?.receiptSha256, RECEIPT_SHA);
});

test("an unverified receipt cannot create a delivered claim", async () => {
  const adapter = new TestNotificationAdapter();
  const verifier: NotificationReceiptVerifier = {
    async verify() {
      return { verified: false };
    },
  };
  const { service, repository, scope } = harness({ adapter, verifier });
  let event = await service.queue(scope, queueInput());
  event = await service.attempt(scope, event.id, {
    expectedVersion: event.version,
  });
  await assert.rejects(
    () =>
      service.reconcile(scope, event.id, {
        expectedVersion: event.version,
        attemptId: event.attempts[0]!.id,
        receiptReference: "untrusted-receipt",
      }),
    (error: unknown) =>
      error instanceof CommunicationError &&
      error.code === "receipt_unverified",
  );
  assert.equal(
    (await repository.get(scope, event.id)).status,
    "accepted_pending_receipt",
  );
});

test("ambiguous provider outcome requires reconciliation and cannot be resent", async () => {
  const adapter = new TestNotificationAdapter();
  adapter.throws = true;
  const { service, scope } = harness({ adapter });
  let event = await service.queue(scope, queueInput());
  event = await service.attempt(scope, event.id, {
    expectedVersion: event.version,
  });
  assert.equal(event.status, "reconciliation_required");
  assert.equal(event.attempts[0]?.status, "outcome_unknown");
  await assert.rejects(
    () => service.attempt(scope, event.id, { expectedVersion: event.version }),
    (error: unknown) =>
      error instanceof CommunicationError && error.code === "policy_denied",
  );
  assert.equal(adapter.deliveries.length, 1);
});

test("revalidates consent immediately before the provider effect and fences stale CAS", async () => {
  const adapter = new TestNotificationAdapter();
  const { authority, service, repository, scope } = harness({ adapter });
  const event = await service.queue(scope, queueInput());
  authority.consentActive = false;
  await assert.rejects(
    () => service.attempt(scope, event.id, { expectedVersion: event.version }),
    (error: unknown) =>
      error instanceof CommunicationError && error.code === "scope_denied",
  );
  const blocked = await repository.get(scope, event.id);
  assert.equal(blocked.attempts[0]?.status, "policy_blocked");
  assert.equal(adapter.deliveries.length, 0);
  await assert.rejects(
    () => service.attempt(scope, event.id, { expectedVersion: event.version }),
    (error: unknown) =>
      error instanceof CommunicationError && error.code === "stale_version",
  );
});

test("channel policy rejects package delivery over WhatsApp", async () => {
  const { service, scope } = harness();
  await assert.rejects(
    () =>
      service.queue(scope, {
        ...queueInput(),
        channel: "whatsapp_business",
        templateId: "package_ready_v1",
        context: {
          kind: "released_package",
          packageVersionId: REQUEST_ID,
          manifestSha256: RECEIPT_SHA,
        },
      }),
    (error: unknown) =>
      error instanceof CommunicationError && error.code === "policy_denied",
  );
});
