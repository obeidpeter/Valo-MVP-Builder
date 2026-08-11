import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GrowthSuiteRepositoryUnavailableError } from "./contracts";
import {
  DrizzleGrowthSuiteRepository,
  type GrowthSuiteDurableDriver,
  type GrowthSuiteDurableTransaction,
  type GrowthSuiteLeadEventRow,
  type GrowthSuiteLeadEventSummary,
  type GrowthSuiteQueueRow,
} from "./drizzleRepository";

const organisationId = "00000000-0000-4000-8000-000000000001";
const actorUserId = "00000000-0000-4000-8000-000000000002";
const assigneeUserId = "00000000-0000-4000-8000-000000000003";
const leadId = "00000000-0000-4000-8000-000000000004";
const proposalId = "00000000-0000-4000-8000-000000000005";
const now = new Date("2026-08-11T10:00:00.000Z");

interface FakeState {
  queue: GrowthSuiteQueueRow[];
  events: GrowthSuiteLeadEventRow[];
}

function cloneState(value: FakeState): FakeState {
  return structuredClone(value);
}

class FakeTransaction implements GrowthSuiteDurableTransaction {
  readonly state: FakeState;
  actorAllowed = true;
  appendFails = false;
  contactReads = 0;
  locks: string[] = [];
  assignableUsers = new Set([assigneeUserId]);
  private sequence = 20;

  constructor(state: FakeState) {
    this.state = state;
    this.sequence = Math.max(
      this.sequence,
      ...state.events.map(({ seq }) => Number(seq)),
    );
  }

  async requireHumanActor() {
    return this.actorAllowed;
  }

  async isAssignableHuman(
    _scope: { organisationId: string; actorUserId: string },
    userId: string,
  ) {
    return this.assignableUsers.has(userId);
  }

  async lockLead(_scope: unknown, id: string) {
    this.locks.push(id);
  }

  async listQueue(limit: number) {
    return this.state.queue.slice(0, limit);
  }

  async loadLeadEvents(
    _scope: unknown,
    leadIds: readonly string[],
  ): Promise<readonly GrowthSuiteLeadEventSummary[]> {
    return leadIds.flatMap((id) => {
      const events = this.state.events.filter(
        ({ objectId }) => objectId === id,
      );
      if (events.length === 0) return [];
      const latest = new Map<string, GrowthSuiteLeadEventRow>();
      for (const event of events) {
        const previous = latest.get(event.eventType);
        if (!previous || Number(previous.seq) < Number(event.seq)) {
          latest.set(event.eventType, event);
        }
      }
      return [
        {
          objectId: id,
          eventCount: events.length,
          latest: [...latest.values()],
        },
      ];
    });
  }

  async transitionQueueStatus(
    id: string,
    expectedStatus: "stored" | "follow_up_started" | "closed",
    nextStatus: "follow_up_started" | "closed",
  ) {
    const row = this.state.queue.find(
      (candidate) =>
        candidate.requestId === id &&
        candidate.deliveryStatus === expectedStatus,
    );
    if (!row) return false;
    row.deliveryStatus = nextStatus;
    return true;
  }

  async getContactHandoff(id: string) {
    this.contactReads += 1;
    return id === leadId
      ? {
          requestId: leadId,
          contactName: "Ada Example",
          preferredContactMethod: "email",
          contactValue: "ada@example.test",
        }
      : null;
  }

  async appendLeadEvent(
    _scope: unknown,
    id: string,
    eventType: string,
    details: string,
  ) {
    if (this.appendFails) throw new Error("simulated append failure");
    this.sequence += 1;
    this.state.events.push({
      objectId: id,
      eventType,
      details,
      seq: this.sequence,
      createdAt: new Date(
        now.getTime() + (this.sequence - 20) * 1_000,
      ).toISOString(),
    });
  }
}

class FakeDriver implements GrowthSuiteDurableDriver {
  state: FakeState;
  readonly transaction: FakeTransaction["constructor"] extends never
    ? never
    : GrowthSuiteDurableDriver["transaction"];
  transactionView: FakeTransaction;

  constructor(state: FakeState) {
    this.state = cloneState(state);
    this.transactionView = new FakeTransaction(this.state);
    this.transaction = async <T>(
      _organisationId: string,
      callback: (transaction: GrowthSuiteDurableTransaction) => Promise<T>,
    ) => {
      const before = cloneState(this.state);
      try {
        return await callback(this.transactionView);
      } catch (error) {
        this.state.queue.splice(0, this.state.queue.length, ...before.queue);
        this.state.events.splice(0, this.state.events.length, ...before.events);
        throw error;
      }
    };
  }
}

function queueRow(): GrowthSuiteQueueRow {
  return {
    requestId: leadId,
    organisationLabel: "Northwind Civil",
    tenderCategory: "federal_public",
    bidStage: "live",
    tenderDeadline: "2026-09-01",
    deliveryStatus: "stored",
    receivedAt: "2026-08-11T09:00:00.000Z",
  };
}

function repository(driver: FakeDriver) {
  return new DrizzleGrowthSuiteRepository({
    driver,
    now: () => now,
    id: () => proposalId,
    allowedOrganisationId: organisationId,
  });
}

test("listLeads exposes only operational lead fields and projects audit metadata", async () => {
  const driver = new FakeDriver({
    queue: [queueRow()],
    events: [
      {
        objectId: leadId,
        eventType: "growth_suite.lead.assigned",
        details: JSON.stringify({
          schema: "valo.growth-suite.lead-event/v1",
          action: "assign",
          assigneeUserId,
        }),
        seq: 20,
        createdAt: "2026-08-11T09:30:00.000Z",
      },
    ],
  });
  const [lead] = await repository(driver).listLeads(
    { organisationId, actorUserId },
    10,
  );
  assert.deepEqual(lead, {
    id: leadId,
    organisationId,
    leadReference: leadId,
    organisationLabel: "Northwind Civil",
    tenderCategory: "federal_public",
    bidStage: "live",
    receivedAt: "2026-08-11T09:00:00.000Z",
    tenderDeadline: "2026-09-01",
    assignedToUserId: assigneeUserId,
    status: "new",
    slaDueAt: null,
    conversionProposal: null,
    latestStatusDecision: null,
    version: 2,
    updatedAt: "2026-08-11T09:30:00.000Z",
  });
  assert.equal(Object.hasOwn(lead!, "contactName"), false);
  assert.equal(Object.hasOwn(lead!, "email"), false);
  assert.equal(Object.hasOwn(lead!, "telephone"), false);
});

test("mutations lock the lead, enforce optimistic version and require an assignable human", async () => {
  const driver = new FakeDriver({ queue: [queueRow()], events: [] });
  const repo = repository(driver);
  const scope = { organisationId, actorUserId };
  assert.deepEqual(
    await repo.mutateLead(scope, leadId, {
      action: "assign",
      expectedVersion: 2,
      assigneeUserId,
    }),
    { outcome: "not_found_or_conflict" },
  );
  assert.deepEqual(
    await repo.mutateLead(scope, leadId, {
      action: "assign",
      expectedVersion: 1,
      assigneeUserId: "00000000-0000-4000-8000-000000000099",
    }),
    { outcome: "policy_denied" },
  );
  const result = await repo.mutateLead(scope, leadId, {
    action: "assign",
    expectedVersion: 1,
    assigneeUserId,
  });
  assert.equal(result.outcome, "updated");
  if (result.outcome === "updated") {
    assert.equal(result.record.version, 2);
    assert.equal(result.record.assignedToUserId, assigneeUserId);
  }
  assert.deepEqual(driver.transactionView.locks, [leadId, leadId, leadId]);
});

test("conversion requires qualification and closes only after a named manual completion", async () => {
  const driver = new FakeDriver({ queue: [queueRow()], events: [] });
  const repo = repository(driver);
  const scope = { organisationId, actorUserId };
  assert.deepEqual(
    await repo.mutateLead(scope, leadId, {
      action: "propose_conversion",
      expectedVersion: 1,
      suggestedPursuitTitle: "Northwind Federal Works",
      rationale: "This unqualified proposal must be denied.",
    }),
    { outcome: "policy_denied" },
  );
  const qualified = await repo.mutateLead(scope, leadId, {
    action: "set_status",
    expectedVersion: 1,
    status: "qualified",
    reason: "Named operator confirmed the tender scope and response window.",
  });
  assert.equal(qualified.outcome, "updated");
  if (qualified.outcome === "updated") {
    assert.equal(qualified.record.latestStatusDecision?.status, "qualified");
    assert.match(
      qualified.record.latestStatusDecision?.reason ?? "",
      /scope and response window/u,
    );
  }
  const proposed = await repo.mutateLead(scope, leadId, {
    action: "propose_conversion",
    expectedVersion: 2,
    suggestedPursuitTitle: "Northwind Federal Works",
    rationale: "Named operator recommends a governed pursuit review.",
  });
  assert.equal(proposed.outcome, "updated");
  if (proposed.outcome === "updated") {
    assert.equal(proposed.record.status, "conversion_proposed");
    assert.equal(proposed.record.version, 3);
    assert.deepEqual(proposed.record.conversionProposal, {
      id: proposalId,
      status: "pending_human_decision",
      proposedAt: now.toISOString(),
      proposedByUserId: actorUserId,
      suggestedPursuitTitle: "Northwind Federal Works",
      rationale: "Named operator recommends a governed pursuit review.",
    });
  }
  assert.equal(driver.state.queue[0]!.deliveryStatus, "follow_up_started");
  const converted = await repo.mutateLead(scope, leadId, {
    action: "set_status",
    expectedVersion: 3,
    status: "converted",
    reason:
      "The approved proposal was created manually in the pursuit register.",
    externalTargetReference: "PURSUIT-2026-0042",
    receiptSha256: "a".repeat(64),
  });
  assert.equal(converted.outcome, "updated");
  if (converted.outcome === "updated") {
    assert.equal(converted.record.status, "converted");
    assert.equal(converted.record.version, 4);
    assert.equal(
      converted.record.latestStatusDecision?.externalTargetReference,
      "PURSUIT-2026-0042",
    );
    assert.equal(
      converted.record.latestStatusDecision?.receiptSha256,
      "a".repeat(64),
    );
  }
  assert.equal(driver.state.queue[0]!.deliveryStatus, "closed");
});

test("reveals only one assigned lead contact and records a PII-free purpose receipt", async () => {
  const driver = new FakeDriver({
    queue: [queueRow()],
    events: [
      {
        objectId: leadId,
        eventType: "growth_suite.lead.assigned",
        details: JSON.stringify({
          schema: "valo.growth-suite.lead-event/v1",
          action: "assign",
          assigneeUserId: actorUserId,
        }),
        seq: 20,
        createdAt: "2026-08-11T09:30:00.000Z",
      },
    ],
  });
  const result = await repository(driver).getLeadContactHandoff(
    { organisationId, actorUserId },
    leadId,
    2,
    "initial_follow_up",
  );
  assert.equal(result.outcome, "updated");
  if (result.outcome === "updated") {
    assert.equal(result.record.contactName, "Ada Example");
    assert.equal(result.record.contactValue, "ada@example.test");
    assert.equal(result.record.version, 3);
  }
  assert.equal(driver.transactionView.contactReads, 1);
  const audit = driver.state.events.at(-1)!;
  assert.equal(audit.eventType, "growth_suite.lead.contact_accessed");
  assert.deepEqual(JSON.parse(audit.details), {
    schema: "valo.growth-suite.lead-event/v1",
    action: "contact_accessed",
    purpose: "initial_follow_up",
  });
  assert.doesNotMatch(audit.details, /Ada|example\.test/u);
});

test("denies contact handoff before reading PII when the actor is not assigned", async () => {
  const driver = new FakeDriver({
    queue: [queueRow()],
    events: [
      {
        objectId: leadId,
        eventType: "growth_suite.lead.assigned",
        details: JSON.stringify({
          schema: "valo.growth-suite.lead-event/v1",
          action: "assign",
          assigneeUserId,
        }),
        seq: 20,
        createdAt: "2026-08-11T09:30:00.000Z",
      },
    ],
  });
  assert.deepEqual(
    await repository(driver).getLeadContactHandoff(
      { organisationId, actorUserId },
      leadId,
      2,
      "initial_follow_up",
    ),
    { outcome: "policy_denied" },
  );
  assert.equal(driver.transactionView.contactReads, 0);
});

test("denies a conversion handoff until a named proposal is current", async () => {
  const driver = new FakeDriver({
    queue: [queueRow()],
    events: [
      {
        objectId: leadId,
        eventType: "growth_suite.lead.assigned",
        details: JSON.stringify({
          schema: "valo.growth-suite.lead-event/v1",
          action: "assign",
          assigneeUserId: actorUserId,
        }),
        seq: 20,
        createdAt: "2026-08-11T09:30:00.000Z",
      },
    ],
  });
  assert.deepEqual(
    await repository(driver).getLeadContactHandoff(
      { organisationId, actorUserId },
      leadId,
      2,
      "conversion_handoff",
    ),
    { outcome: "policy_denied" },
  );
  assert.equal(driver.transactionView.contactReads, 0);
});

test("closed leads are immutable and an exact status replay is a no-op", async () => {
  const closed = queueRow();
  closed.deliveryStatus = "closed";
  const driver = new FakeDriver({
    queue: [closed],
    events: [
      {
        objectId: leadId,
        eventType: "growth_suite.lead.status_set",
        details: JSON.stringify({
          schema: "valo.growth-suite.lead-event/v1",
          action: "set_status",
          status: "not_a_fit",
          reason: "The opportunity is outside the recorded delivery scope.",
          decidedAt: now.toISOString(),
          decidedByUserId: actorUserId,
        }),
        seq: 20,
        createdAt: now.toISOString(),
      },
    ],
  });
  const repo = repository(driver);
  const scope = { organisationId, actorUserId };
  const replay = await repo.mutateLead(scope, leadId, {
    action: "set_status",
    expectedVersion: 2,
    status: "not_a_fit",
    reason: "The opportunity is outside the recorded delivery scope.",
  });
  assert.equal(replay.outcome, "updated");
  assert.equal(driver.state.events.length, 1);
  assert.deepEqual(
    await repo.mutateLead(scope, leadId, {
      action: "assign",
      expectedVersion: 2,
      assigneeUserId,
    }),
    { outcome: "policy_denied" },
  );
  assert.equal(driver.state.events.length, 1);
});

test("a failed audit append rolls a queue transition back with the transaction", async () => {
  const driver = new FakeDriver({ queue: [queueRow()], events: [] });
  driver.transactionView.appendFails = true;
  await assert.rejects(
    repository(driver).mutateLead({ organisationId, actorUserId }, leadId, {
      action: "set_status",
      expectedVersion: 1,
      status: "qualified",
      reason: "Named operator confirmed the scope and response window.",
    }),
    GrowthSuiteRepositoryUnavailableError,
  );
  assert.equal(driver.state.queue[0]!.deliveryStatus, "stored");
  assert.equal(driver.state.events.length, 0);
});

test("missing human scope and durable quote operations fail closed", async () => {
  const driver = new FakeDriver({ queue: [queueRow()], events: [] });
  driver.transactionView.actorAllowed = false;
  const repo = repository(driver);
  await assert.rejects(
    repo.listLeads({ organisationId, actorUserId }, 10),
    GrowthSuiteRepositoryUnavailableError,
  );
  await assert.rejects(
    repo.listQuotes({ organisationId, actorUserId }, 10),
    GrowthSuiteRepositoryUnavailableError,
  );
});

test("pins the global intake queue to one configured internal organisation", async () => {
  const driver = new FakeDriver({ queue: [queueRow()], events: [] });
  const unconfigured = new DrizzleGrowthSuiteRepository({
    driver,
    allowedOrganisationId: null,
  });
  await assert.rejects(
    unconfigured.listLeads({ organisationId, actorUserId }, 10),
    GrowthSuiteRepositoryUnavailableError,
  );

  const otherOrganisation = "00000000-0000-4000-8000-000000000099";
  const configured = new DrizzleGrowthSuiteRepository({
    driver,
    allowedOrganisationId: organisationId,
  });
  await assert.rejects(
    configured.listLeads(
      { organisationId: otherOrganisation, actorUserId },
      10,
    ),
    GrowthSuiteRepositoryUnavailableError,
  );
});

test("the durable SQL adapter keeps contact PII out of bulk queue reads", async () => {
  const source = await readFile(
    new URL("./drizzleRepository.ts", import.meta.url),
    "utf8",
  );
  const bulkQueueRead = source.slice(
    source.indexOf("async listQueue("),
    source.indexOf("async loadLeadEvents("),
  );
  for (const forbidden of [
    "contact_name",
    "business_email",
    "business_telephone",
  ]) {
    assert.equal(bulkQueueRead.includes(forbidden), false, forbidden);
  }
  for (const forbidden of ["business_email", "business_telephone"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.match(source, /get_bid_autopsy_contact_handoff/u);
});
