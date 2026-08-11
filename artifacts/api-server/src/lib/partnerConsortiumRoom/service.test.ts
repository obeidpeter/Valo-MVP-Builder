import assert from "node:assert/strict";
import test from "node:test";
import type { ConsortiumParty, ConsortiumScope } from "./contracts";
import { ConsortiumError } from "./errors";
import {
  InMemoryConsortiumRepository,
  PartnerConsortiumRoomService,
  type ConsortiumAuthority,
} from "./service";

const CLIENT_ORG = "11111111-1111-4111-8111-111111111111";
const PARTNER_ORG = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const RELATIONSHIP_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_COORDINATOR = "55555555-5555-4555-8555-555555555555";
const CLIENT_CHECKER = "66666666-6666-4666-8666-666666666666";
const PARTNER_MAKER = "77777777-7777-4777-8777-777777777777";
const PARTNER_CHECKER = "88888888-8888-4888-8888-888888888888";
const CLIENT_MEMBERSHIP = "99999999-9999-4999-8999-999999999999";
const PARTNER_MEMBERSHIP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVIDENCE_SHA = "b".repeat(64);

class TestAuthority implements ConsortiumAuthority {
  active = true;
  readonly clientUsers = new Set([CLIENT_COORDINATOR, CLIENT_CHECKER]);
  readonly partnerUsers = new Set([PARTNER_MAKER, PARTNER_CHECKER]);

  async assertAccess(scope: ConsortiumScope) {
    if (!this.active) {
      throw new ConsortiumError(
        "relationship_inactive",
        "Relationship inactive.",
      );
    }
    if (
      scope.organisationId !== CLIENT_ORG ||
      scope.projectId !== PROJECT_ID ||
      scope.relationshipId !== RELATIONSHIP_ID
    ) {
      throw new ConsortiumError("scope_denied", "Exact scope denied.");
    }
    const actorParty: ConsortiumParty =
      scope.accessSource === "partner" ? "partner" : "client";
    if (
      (actorParty === "client" && !this.clientUsers.has(scope.actorUserId)) ||
      (actorParty === "partner" && !this.partnerUsers.has(scope.actorUserId))
    ) {
      throw new ConsortiumError("scope_denied", "Actor denied.");
    }
    return {
      relationshipId: RELATIONSHIP_ID,
      clientOrganisationId: CLIENT_ORG,
      partnerOrganisationId: PARTNER_ORG,
      relationshipVersion: 3,
      coSigningRequired: true,
      qaResponsibilitySha256: "c".repeat(64),
      actorParty,
    } as const;
  }

  async assertPartyParticipant(
    _scope: ConsortiumScope,
    userId: string,
    party: ConsortiumParty,
  ): Promise<void> {
    const allowed = party === "client" ? this.clientUsers : this.partnerUsers;
    if (!allowed.has(userId)) {
      throw new ConsortiumError("scope_denied", "Named participant denied.");
    }
  }

  async listPartyParticipants(scope: ConsortiumScope, limit: number) {
    await this.assertAccess(scope);
    return [
      {
        userId: CLIENT_COORDINATOR,
        name: "Client Coordinator",
        party: "client",
      },
      { userId: CLIENT_CHECKER, name: "Client Checker", party: "client" },
      { userId: PARTNER_MAKER, name: "Partner Maker", party: "partner" },
      { userId: PARTNER_CHECKER, name: "Partner Checker", party: "partner" },
    ].slice(0, limit) as Array<{
      userId: string;
      name: string;
      party: ConsortiumParty;
    }>;
  }
}

function clientScope(actorUserId = CLIENT_COORDINATOR): ConsortiumScope {
  return {
    organisationId: CLIENT_ORG,
    projectId: PROJECT_ID,
    relationshipId: RELATIONSHIP_ID,
    actorUserId,
    actorMembershipId: CLIENT_MEMBERSHIP,
    membershipOrganisationId: CLIENT_ORG,
    accessSource: "membership",
    contextPartnerRelationshipId: null,
  };
}

function partnerScope(actorUserId = PARTNER_MAKER): ConsortiumScope {
  return {
    organisationId: CLIENT_ORG,
    projectId: PROJECT_ID,
    relationshipId: RELATIONSHIP_ID,
    actorUserId,
    actorMembershipId: PARTNER_MEMBERSHIP,
    membershipOrganisationId: PARTNER_ORG,
    accessSource: "partner",
    contextPartnerRelationshipId: RELATIONSHIP_ID,
  };
}

function harness() {
  let sequence = 10;
  const authority = new TestAuthority();
  const repository = new InMemoryConsortiumRepository();
  const service = new PartnerConsortiumRoomService({
    authority,
    repository,
    now: () => new Date("2026-08-11T10:00:00.000Z"),
    idFactory: () =>
      `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  return { authority, repository, service };
}

async function initialize(service: PartnerConsortiumRoomService) {
  return service.initialize(clientScope(), {
    idempotencyKey: "relationship-room-001",
    clientCoordinatorUserId: CLIENT_COORDINATOR,
    partnerCoordinatorUserId: PARTNER_MAKER,
  });
}

test("lists only bounded named participants for the exact relationship parties", async () => {
  const { service } = harness();
  const directory = await service.participants(clientScope());
  assert.deepEqual(directory, {
    organisationId: CLIENT_ORG,
    projectId: PROJECT_ID,
    relationshipId: RELATIONSHIP_ID,
    items: [
      {
        userId: CLIENT_COORDINATOR,
        name: "Client Coordinator",
        party: "client",
      },
      { userId: CLIENT_CHECKER, name: "Client Checker", party: "client" },
      { userId: PARTNER_MAKER, name: "Partner Maker", party: "partner" },
      { userId: PARTNER_CHECKER, name: "Partner Checker", party: "partner" },
    ],
    limit: 100,
    truncated: false,
  });
});

test("initializes one content-bounded room with explicit retention and authority exclusions", async () => {
  const { service } = harness();
  const room = await initialize(service);
  const replay = await initialize(service);
  assert.equal(replay.id, room.id);
  assert.equal(room.version, 1);
  assert.equal(room.qaChecklist.length, 4);
  assert.equal(
    room.qaChecklist.find(({ code }) => code === "partner_cosign")?.required,
    true,
  );
  assert.deepEqual(room.retention, {
    namespace: "valo.partner-consortium-room/v1",
    class: "project_coordination",
    owner: "client_organisation",
    trigger: "owning_project_retention_policy",
    independentDeletionAllowed: false,
  });
  assert.deepEqual(room.authorityBoundaries, {
    legalAgreementGeneration: false,
    revenueSettlement: false,
    messaging: false,
    crossClientLearning: false,
    autonomousExternalAction: false,
  });
  assert.equal(room.auditReceipts.length, 1);
  assert.equal(room.auditReceipts[0]?.priorVersion, 0);
  assert.equal(room.auditReceipts[0]?.nextVersion, 1);
});

test("requires bilateral maker-checker acceptance for each named responsibility", async () => {
  const { service } = harness();
  let room = await initialize(service);
  room = await service.addResponsibility(partnerScope(), {
    expectedVersion: room.version,
    workstreamLabel: "Technical response ownership",
    responsibleParty: "partner",
    accountableParty: "client",
    ownerUserId: PARTNER_MAKER,
    dueAt: "2026-08-20T12:00:00.000Z",
  });
  const responsibility = room.responsibilities[0]!;
  assert.equal(responsibility.status, "proposed");
  assert.equal(responsibility.requiredAcceptance, "both_parties");

  await assert.rejects(
    () =>
      service.decideResponsibility(
        partnerScope(PARTNER_MAKER),
        responsibility.id,
        { expectedVersion: room.version, decision: "accepted" },
      ),
    (error: unknown) =>
      error instanceof ConsortiumError && error.code === "policy_denied",
  );

  room = await service.decideResponsibility(
    clientScope(CLIENT_CHECKER),
    responsibility.id,
    { expectedVersion: room.version, decision: "accepted" },
  );
  assert.equal(room.responsibilities[0]?.status, "proposed");
  room = await service.decideResponsibility(
    partnerScope(PARTNER_CHECKER),
    responsibility.id,
    { expectedVersion: room.version, decision: "accepted" },
  );
  assert.equal(room.responsibilities[0]?.status, "active");
  assert.equal(room.status, "active");
  assert.equal(room.auditReceipts.length, room.version);
  assert.equal(
    room.auditReceipts.at(-1)?.previousReceiptSha256,
    room.auditReceipts.at(-2)?.receiptSha256,
  );
});

test("records a closed reason code and requires revision after changes are requested", async () => {
  const { service } = harness();
  let room = await initialize(service);
  room = await service.addResponsibility(partnerScope(), {
    expectedVersion: room.version,
    workstreamLabel: "Commercial response checks",
    responsibleParty: "partner",
    accountableParty: "client",
    ownerUserId: PARTNER_MAKER,
  });
  const responsibilityId = room.responsibilities[0]!.id;
  room = await service.decideResponsibility(
    clientScope(CLIENT_CHECKER),
    responsibilityId,
    {
      expectedVersion: room.version,
      decision: "changes_requested",
      reasonCode: "ownership_mismatch",
    },
  );
  assert.equal(room.responsibilities[0]?.status, "changes_requested");

  await assert.rejects(
    () =>
      service.decideResponsibility(
        partnerScope(PARTNER_CHECKER),
        responsibilityId,
        { expectedVersion: room.version, decision: "accepted" },
      ),
    (error: unknown) =>
      error instanceof ConsortiumError && error.code === "policy_denied",
  );
  room = await service.reviseResponsibility(
    partnerScope(PARTNER_CHECKER),
    responsibilityId,
    {
      expectedVersion: room.version,
      workstreamLabel: "Commercial response review",
      responsibleParty: "partner",
      accountableParty: "client",
      ownerUserId: PARTNER_CHECKER,
    },
  );
  assert.equal(room.responsibilities[0]?.iteration, 2);
  assert.deepEqual(room.responsibilities[0]?.acceptances, {
    client: null,
    partner: null,
  });
});

test("gates QA on accepted responsibilities and enforces independent named checking", async () => {
  const { service } = harness();
  let room = await initialize(service);
  room = await service.addResponsibility(partnerScope(), {
    expectedVersion: room.version,
    workstreamLabel: "Evidence schedule",
    responsibleParty: "partner",
    accountableParty: "client",
    ownerUserId: PARTNER_MAKER,
  });
  const qaItem = room.qaChecklist.find(
    ({ code }) => code === "evidence_quality_review",
  )!;
  await assert.rejects(
    () =>
      service.prepareQa(partnerScope(), qaItem.id, {
        expectedVersion: room.version,
        evidenceSha256: EVIDENCE_SHA,
      }),
    (error: unknown) =>
      error instanceof ConsortiumError && error.code === "policy_denied",
  );

  const responsibilityId = room.responsibilities[0]!.id;
  room = await service.decideResponsibility(
    clientScope(CLIENT_CHECKER),
    responsibilityId,
    { expectedVersion: room.version, decision: "accepted" },
  );
  room = await service.decideResponsibility(
    partnerScope(PARTNER_CHECKER),
    responsibilityId,
    { expectedVersion: room.version, decision: "accepted" },
  );
  room = await service.prepareQa(partnerScope(PARTNER_MAKER), qaItem.id, {
    expectedVersion: room.version,
    evidenceSha256: EVIDENCE_SHA,
  });
  assert.equal(
    room.qaChecklist.find(({ id }) => id === qaItem.id)?.status,
    "ready_for_check",
  );
  room = await service.decideQa(clientScope(CLIENT_CHECKER), qaItem.id, {
    expectedVersion: room.version,
    decision: "checked",
  });
  assert.equal(
    room.qaChecklist.find(({ id }) => id === qaItem.id)?.status,
    "checked",
  );
  assert.equal(room.status, "qa_in_progress");
});

test("fails stale CAS, unsupported payload fields, inactive relationships, and wrong-party owners", async () => {
  const { authority, service } = harness();
  const room = await initialize(service);
  await assert.rejects(
    () =>
      service.addResponsibility(partnerScope(), {
        expectedVersion: room.version + 1,
        workstreamLabel: "Stale responsibility",
        responsibleParty: "partner",
        accountableParty: "client",
        ownerUserId: PARTNER_MAKER,
      }),
    (error: unknown) =>
      error instanceof ConsortiumError && error.code === "stale_version",
  );
  await assert.rejects(
    () =>
      service.addResponsibility(partnerScope(), {
        expectedVersion: room.version,
        workstreamLabel: "Unsupported action",
        responsibleParty: "partner",
        accountableParty: "client",
        ownerUserId: PARTNER_MAKER,
        sendMessage: true,
      }),
    (error: unknown) =>
      error instanceof ConsortiumError && error.code === "invalid_request",
  );
  await assert.rejects(
    () =>
      service.addResponsibility(partnerScope(), {
        expectedVersion: room.version,
        workstreamLabel: "Wrong owner",
        responsibleParty: "partner",
        accountableParty: "client",
        ownerUserId: CLIENT_COORDINATOR,
      }),
    (error: unknown) =>
      error instanceof ConsortiumError && error.code === "scope_denied",
  );
  authority.active = false;
  await assert.rejects(
    () => service.snapshot(clientScope()),
    (error: unknown) =>
      error instanceof ConsortiumError &&
      error.code === "relationship_inactive",
  );
});
