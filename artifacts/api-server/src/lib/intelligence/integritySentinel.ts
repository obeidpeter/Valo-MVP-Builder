import {
  deterministicId,
  hasBlockers,
  isIsoInstant,
  isValidId,
  reviewIsAccepted,
  sha256Text,
  sortIssues,
  UNREVIEWED,
  validateHumanReview,
  type DomainIssue,
  type HumanReview,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  boundedNextCapabilityRecordKeys,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export interface IntegrityAuditEvent {
  readonly eventId: string;
  readonly organisationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action:
    | "submit_for_approval"
    | "approve"
    | "external_contact"
    | "declare_relationship"
    | "override_control";
  readonly subjectId: string;
  readonly occurredAt: string;
  readonly eventSha256: string;
  readonly immutable: boolean;
  readonly contactChannel?:
    | "approved_portal"
    | "approved_email"
    | "personal_email"
    | "messaging_app";
}

export interface DeclaredIntegrityRelationship {
  readonly relationshipId: string;
  readonly organisationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly counterpartyId: string;
  readonly status: "declared" | "under_review" | "cleared";
}

export interface IntegritySentinelInput {
  readonly organisationId: string;
  readonly projectId: string;
  readonly events: readonly IntegrityAuditEvent[];
  readonly relationships: readonly DeclaredIntegrityRelationship[];
  readonly signalReviews?: Readonly<Record<string, HumanReview>>;
}

export interface IntegrityControlSignal {
  readonly signalId: string;
  readonly type:
    | "segregation_of_duties"
    | "unapproved_contact_channel"
    | "relationship_review_pending"
    | "control_override";
  readonly eventIds: readonly string[];
  readonly relationshipIds: readonly string[];
  readonly subjectIds: readonly string[];
  readonly notice: "control_signal_not_misconduct_finding";
  readonly audience: "authorised_ethics_or_legal_reviewers_only";
  readonly review: HumanReview;
  readonly externallyReported: false;
}

export interface IntegritySentinelResult {
  readonly runId: string;
  readonly status: "blocked" | "review_required" | "ready";
  readonly readyForUse: boolean;
  readonly signals: readonly IntegrityControlSignal[];
  readonly issues: readonly DomainIssue[];
  readonly safety: NextCapabilitySafetyEnvelope;
  readonly misconductDeterminationAuthority: "none";
  readonly externalReportingAuthority: "none";
  readonly absenceIsClearance: false;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const ACTIONS = new Set<IntegrityAuditEvent["action"]>([
  "submit_for_approval",
  "approve",
  "external_contact",
  "declare_relationship",
  "override_control",
]);
const RELATIONSHIP_STATUSES = new Set<DeclaredIntegrityRelationship["status"]>([
  "declared",
  "under_review",
  "cleared",
]);
const CONTACT_CHANNELS = new Set<
  NonNullable<IntegrityAuditEvent["contactChannel"]>
>(["approved_portal", "approved_email", "personal_email", "messaging_app"]);

/** Produces the exact digest callers must persist with an immutable event. */
export function integrityAuditEventSha256(
  event: Omit<IntegrityAuditEvent, "eventSha256">,
): string {
  return sha256Text(
    JSON.stringify({
      eventId: event.eventId,
      organisationId: event.organisationId,
      projectId: event.projectId,
      actorId: event.actorId,
      action: event.action,
      subjectId: event.subjectId,
      occurredAt: event.occurredAt,
      immutable: event.immutable,
      contactChannel: event.contactChannel ?? null,
    }),
  );
}

/** Emits restricted control signals, never allegations or external reports. */
export function detectProcurementIntegritySignals(
  input: IntegritySentinelInput,
): IntegritySentinelResult {
  const issues: DomainIssue[] = [
    ...validateNextCapabilityCollection(input.events, "events", "Audit events"),
    ...validateNextCapabilityCollection(
      input.relationships,
      "relationships",
      "Relationships",
    ),
  ];
  const eventInputs = input.events.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const relationshipInputs = input.relationships.slice(
    0,
    NEXT_CAPABILITY_MAX_ITEMS,
  );
  const scopeValid =
    isValidId(input.organisationId) && isValidId(input.projectId);
  if (!scopeValid) {
    issues.push({
      code: "invalid_integrity_scope",
      severity: "blocker",
      path: "scope",
      message:
        "Integrity analysis requires stable organisation and project IDs.",
    });
  }
  const eventIds = new Set<string>();
  const validEvents = eventInputs
    .filter((event, index) => {
      const path = `events[${index}]`;
      const eventIdentityValid = isValidId(event.eventId);
      const duplicate = eventIdentityValid && eventIds.has(event.eventId);
      const channelValid =
        (event.contactChannel == null ||
          (typeof event.contactChannel === "string" &&
            CONTACT_CHANNELS.has(event.contactChannel))) &&
        (event.action === "external_contact"
          ? event.contactChannel != null
          : event.contactChannel == null);
      const primitiveFieldsValid =
        event.organisationId === input.organisationId &&
        event.projectId === input.projectId &&
        scopeValid &&
        isValidId(event.organisationId) &&
        isValidId(event.projectId) &&
        eventIdentityValid &&
        isValidId(event.actorId) &&
        isValidId(event.subjectId) &&
        isIsoInstant(event.occurredAt) &&
        ACTIONS.has(event.action) &&
        channelValid &&
        event.immutable === true;
      const expectedHash = primitiveFieldsValid
        ? integrityAuditEventSha256({
            eventId: event.eventId,
            organisationId: event.organisationId,
            projectId: event.projectId,
            actorId: event.actorId,
            action: event.action,
            subjectId: event.subjectId,
            occurredAt: event.occurredAt,
            immutable: event.immutable,
            contactChannel: event.contactChannel,
          })
        : undefined;
      const valid =
        primitiveFieldsValid &&
        typeof event.eventSha256 === "string" &&
        SHA256.test(event.eventSha256) &&
        event.eventSha256 === expectedHash &&
        !duplicate;
      if (!valid) {
        issues.push({
          code: "invalid_integrity_event",
          severity: "blocker",
          path,
          message:
            "Audit events must be unique, immutable, hash-bound and inside the requested scope.",
        });
      }
      if (eventIdentityValid) eventIds.add(event.eventId);
      return valid;
    })
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.eventId.localeCompare(right.eventId),
    );
  const relationshipIds = new Set<string>();
  const validRelationships = relationshipInputs.filter(
    (relationship, index) => {
      const relationshipIdentityValid = isValidId(relationship.relationshipId);
      const duplicate =
        relationshipIdentityValid &&
        relationshipIds.has(relationship.relationshipId);
      const valid =
        relationship.organisationId === input.organisationId &&
        relationship.projectId === input.projectId &&
        scopeValid &&
        isValidId(relationship.organisationId) &&
        isValidId(relationship.projectId) &&
        relationshipIdentityValid &&
        isValidId(relationship.actorId) &&
        isValidId(relationship.counterpartyId) &&
        relationship.actorId !== relationship.counterpartyId &&
        RELATIONSHIP_STATUSES.has(relationship.status) &&
        !duplicate;
      if (!valid) {
        issues.push({
          code: "invalid_integrity_relationship",
          severity: "blocker",
          path: `relationships[${index}]`,
          message:
            "Relationship records must be identified and inside the requested scope.",
        });
      }
      if (relationshipIdentityValid) {
        relationshipIds.add(relationship.relationshipId);
      }
      return valid;
    },
  );

  const rawSignals: Array<Omit<IntegrityControlSignal, "signalId" | "review">> =
    [];
  let signalLimitExceeded = false;
  const addRawSignal = (signal: (typeof rawSignals)[number]): boolean => {
    if (rawSignals.length >= NEXT_CAPABILITY_MAX_ITEMS) {
      signalLimitExceeded = true;
      return false;
    }
    rawSignals.push(signal);
    return true;
  };
  const bySubject = new Map<string, IntegrityAuditEvent[]>();
  for (const event of validEvents) {
    bySubject.set(event.subjectId, [
      ...(bySubject.get(event.subjectId) ?? []),
      event,
    ]);
  }
  segregationSignals: for (const [subjectId, events] of bySubject) {
    const submissions = events.filter(
      (event) => event.action === "submit_for_approval",
    );
    const approvals = events.filter((event) => event.action === "approve");
    for (const submission of submissions) {
      for (const approval of approvals.filter(
        (candidate) =>
          candidate.actorId === submission.actorId &&
          candidate.occurredAt >= submission.occurredAt,
      )) {
        if (
          !addRawSignal({
            type: "segregation_of_duties",
            eventIds: [submission.eventId, approval.eventId].sort(),
            relationshipIds: [],
            subjectIds: [subjectId],
            notice: "control_signal_not_misconduct_finding",
            audience: "authorised_ethics_or_legal_reviewers_only",
            externallyReported: false,
          })
        )
          break segregationSignals;
      }
    }
  }
  for (const event of validEvents) {
    if (
      event.action === "external_contact" &&
      event.contactChannel &&
      !new Set(["approved_portal", "approved_email"]).has(event.contactChannel)
    ) {
      addRawSignal({
        type: "unapproved_contact_channel",
        eventIds: [event.eventId],
        relationshipIds: [],
        subjectIds: [event.subjectId],
        notice: "control_signal_not_misconduct_finding",
        audience: "authorised_ethics_or_legal_reviewers_only",
        externallyReported: false,
      });
    }
    if (event.action === "override_control") {
      addRawSignal({
        type: "control_override",
        eventIds: [event.eventId],
        relationshipIds: [],
        subjectIds: [event.subjectId],
        notice: "control_signal_not_misconduct_finding",
        audience: "authorised_ethics_or_legal_reviewers_only",
        externallyReported: false,
      });
    }
  }
  for (const relationship of validRelationships.filter(
    (relationship) => relationship.status === "under_review",
  )) {
    addRawSignal({
      type: "relationship_review_pending",
      eventIds: [],
      relationshipIds: [relationship.relationshipId],
      subjectIds: [relationship.actorId, relationship.counterpartyId].sort(),
      notice: "control_signal_not_misconduct_finding",
      audience: "authorised_ethics_or_legal_reviewers_only",
      externallyReported: false,
    });
  }
  if (signalLimitExceeded) {
    issues.push({
      code: "capability_item_limit_exceeded",
      severity: "blocker",
      path: "signals",
      message: `Integrity signals exceed the deterministic limit of ${NEXT_CAPABILITY_MAX_ITEMS} items.`,
    });
  }
  const signals = rawSignals.map((signal) => {
    const eventEvidence = signal.eventIds
      .map((eventId) => validEvents.find((event) => event.eventId === eventId))
      .filter((event): event is IntegrityAuditEvent => Boolean(event))
      .map((event) => ({
        eventId: event.eventId,
        actorId: event.actorId,
        action: event.action,
        subjectId: event.subjectId,
        occurredAt: event.occurredAt,
        eventSha256: event.eventSha256,
        contactChannel: event.contactChannel,
      }));
    const relationshipEvidence = signal.relationshipIds
      .map((relationshipId) =>
        validRelationships.find(
          (relationship) => relationship.relationshipId === relationshipId,
        ),
      )
      .filter((relationship): relationship is DeclaredIntegrityRelationship =>
        Boolean(relationship),
      )
      .map((relationship) => ({
        relationshipId: relationship.relationshipId,
        actorId: relationship.actorId,
        counterpartyId: relationship.counterpartyId,
        status: relationship.status,
      }));
    const signalId = deterministicId("integrity", {
      organisationId: input.organisationId,
      projectId: input.projectId,
      signal,
      eventEvidence,
      relationshipEvidence,
    });
    const review = input.signalReviews?.[signalId] ?? UNREVIEWED;
    issues.push(...validateHumanReview(review, `signalReviews.${signalId}`));
    return { signalId, ...signal, review };
  });
  signals.sort((left, right) => left.signalId.localeCompare(right.signalId));
  const signalReviewKeys = boundedNextCapabilityRecordKeys(
    input.signalReviews,
    "signalReviews",
    "Integrity signal reviews",
  );
  issues.push(...signalReviewKeys.issues);
  for (const signalId of signalReviewKeys.keys) {
    if (!signals.some((signal) => signal.signalId === signalId)) {
      issues.push({
        code: "orphan_integrity_review",
        severity: "blocker",
        path: `signalReviews.${signalId}`,
        message: "A review must bind to a signal generated by this exact run.",
      });
    }
  }
  const runId = deterministicId("integrityrun", {
    scope: scopeValid
      ? [input.organisationId, input.projectId]
      : "invalid_scope",
    signalIds: signals.map((signal) => signal.signalId),
  });
  const sortedIssues = sortIssues(issues);
  const blocked = hasBlockers(sortedIssues);
  const readyForUse =
    !blocked &&
    signals.length > 0 &&
    signals.every((signal) => reviewIsAccepted(signal.review));
  return {
    runId,
    status: blocked ? "blocked" : readyForUse ? "ready" : "review_required",
    readyForUse,
    signals,
    issues: sortedIssues,
    safety: nextCapabilitySafety(),
    misconductDeterminationAuthority: "none",
    externalReportingAuthority: "none",
    absenceIsClearance: false,
  };
}
