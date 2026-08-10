import assert from "node:assert/strict";
import test from "node:test";
import {
  detectProcurementIntegritySignals,
  integrityAuditEventSha256,
  type IntegrityAuditEvent,
} from "./integritySentinel";

const scope = { organisationId: "org-1", projectId: "project-1" };
const accepted = {
  state: "accepted" as const,
  reviewerId: "ethics-1",
  reviewedAt: "2026-08-10T10:00:00.000Z",
};
function event(
  eventId: string,
  action: IntegrityAuditEvent["action"],
  overrides: Partial<IntegrityAuditEvent> = {},
): IntegrityAuditEvent {
  const { eventSha256, ...eventOverrides } = overrides;
  const unsigned: Omit<IntegrityAuditEvent, "eventSha256"> = {
    ...scope,
    eventId,
    actorId: "user-1",
    action,
    subjectId: "package-1",
    occurredAt: "2026-08-10T09:00:00.000Z",
    immutable: true,
    ...eventOverrides,
  };
  return {
    ...unsigned,
    eventSha256: eventSha256 ?? integrityAuditEventSha256(unsigned),
  };
}

test("flags segregation-of-duties evidence without making an allegation", () => {
  const first = detectProcurementIntegritySignals({
    ...scope,
    events: [
      event("submit-1", "submit_for_approval"),
      event("approve-1", "approve"),
    ],
    relationships: [],
  });
  const signalId = first.signals[0]?.signalId;
  assert.ok(signalId);
  const ready = detectProcurementIntegritySignals({
    ...scope,
    events: [
      event("submit-1", "submit_for_approval"),
      event("approve-1", "approve"),
    ],
    relationships: [],
    signalReviews: { [signalId]: accepted },
  });
  assert.equal(ready.status, "ready");
  assert.equal(
    ready.signals[0]?.notice,
    "control_signal_not_misconduct_finding",
  );
  assert.equal(ready.externalReportingAuthority, "none");
});

test("keeps unapproved-channel signals restricted and internal", () => {
  const result = detectProcurementIntegritySignals({
    ...scope,
    events: [
      event("contact-1", "external_contact", {
        contactChannel: "personal_email",
      }),
    ],
    relationships: [],
  });
  assert.equal(result.signals[0]?.type, "unapproved_contact_channel");
  assert.equal(result.signals[0]?.externallyReported, false);
  assert.equal(
    result.signals[0]?.audience,
    "authorised_ethics_or_legal_reviewers_only",
  );
});

test("rejects cross-tenant audit evidence", () => {
  const result = detectProcurementIntegritySignals({
    ...scope,
    events: [event("foreign-1", "approve", { organisationId: "org-2" })],
    relationships: [],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.signals.length, 0);
});

test("a signal review cannot transfer after immutable event evidence changes", () => {
  const events = [
    event("submit-1", "submit_for_approval"),
    event("approve-1", "approve"),
  ];
  const first = detectProcurementIntegritySignals({
    ...scope,
    events,
    relationships: [],
  });
  const signalId = first.signals[0]?.signalId;
  assert.ok(signalId);
  const changed = detectProcurementIntegritySignals({
    ...scope,
    events: [
      events[0],
      event("approve-1", "approve", {
        occurredAt: "2026-08-10T09:01:00.000Z",
      }),
    ],
    relationships: [],
    signalReviews: { [signalId]: accepted },
  });
  assert.notEqual(changed.signals[0]?.signalId, signalId);
  assert.equal(changed.status, "blocked");
  assert.equal(changed.absenceIsClearance, false);
});

test("rejects a regex-shaped event digest that does not bind event content", () => {
  const result = detectProcurementIntegritySignals({
    ...scope,
    events: [
      event("override-1", "override_control", {
        eventSha256: "a".repeat(64),
      }),
    ],
    relationships: [],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.signals.length, 0);
});

test("rejects oversized event identities before immutable-event hashing", () => {
  const oversizedEvent = {
    ...scope,
    eventId: "e".repeat(20_001),
    actorId: "user-1",
    action: "override_control" as const,
    subjectId: "package-1",
    occurredAt: "2026-08-10T09:00:00.000Z",
    eventSha256: "a".repeat(64),
    immutable: true,
  };
  const result = detectProcurementIntegritySignals({
    ...scope,
    events: [oversizedEvent],
    relationships: [],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.signals.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "invalid_integrity_event"),
    true,
  );
});

test("rejects duplicate or invalid relationship records", () => {
  const relationship = {
    ...scope,
    relationshipId: "relationship-1",
    actorId: "user-1",
    counterpartyId: "counterparty-1",
    status: "under_review" as const,
  };
  const result = detectProcurementIntegritySignals({
    ...scope,
    events: [],
    relationships: [relationship, relationship],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.signals.length, 1);
});

test("does not pair an approval that predates submission", () => {
  const result = detectProcurementIntegritySignals({
    ...scope,
    events: [
      event("approve-early", "approve", {
        occurredAt: "2026-08-10T08:59:00.000Z",
      }),
      event("submit-later", "submit_for_approval"),
    ],
    relationships: [],
  });
  assert.equal(result.signals.length, 0);
  assert.equal(result.status, "review_required");
});

test("event input order cannot change a control signal review subject", () => {
  const events = [
    event("submit-1", "submit_for_approval"),
    event("approve-1", "approve", {
      occurredAt: "2026-08-10T09:01:00.000Z",
    }),
  ];
  const forward = detectProcurementIntegritySignals({
    ...scope,
    events,
    relationships: [],
  });
  const reversed = detectProcurementIntegritySignals({
    ...scope,
    events: [...events].reverse(),
    relationships: [],
  });
  assert.equal(forward.signals[0]?.signalId, reversed.signals[0]?.signalId);
});

test("a relationship review cannot transfer across project scope", () => {
  const relationship = {
    ...scope,
    relationshipId: "relationship-1",
    actorId: "user-1",
    counterpartyId: "counterparty-1",
    status: "under_review" as const,
  };
  const first = detectProcurementIntegritySignals({
    ...scope,
    events: [],
    relationships: [relationship],
  });
  const signalId = first.signals[0]!.signalId;
  const changed = detectProcurementIntegritySignals({
    organisationId: scope.organisationId,
    projectId: "project-2",
    events: [],
    relationships: [{ ...relationship, projectId: "project-2" }],
    signalReviews: { [signalId]: accepted },
  });
  assert.notEqual(changed.signals[0]?.signalId, signalId);
  assert.equal(changed.status, "blocked");
});

test("derived signal fan-out is bounded and fails closed", () => {
  const events = Array.from({ length: 250 }, (_, index) => [
    event(`submit-${index}`, "submit_for_approval"),
    event(`approve-${index}`, "approve", {
      occurredAt: "2026-08-10T09:01:00.000Z",
    }),
  ]).flat();
  const result = detectProcurementIntegritySignals({
    ...scope,
    events,
    relationships: [],
  });
  assert.equal(result.signals.length, 500);
  assert.equal(result.status, "blocked");
  assert.equal(
    result.issues.some(
      (issue) =>
        issue.code === "capability_item_limit_exceeded" &&
        issue.path === "signals",
    ),
    true,
  );
});
