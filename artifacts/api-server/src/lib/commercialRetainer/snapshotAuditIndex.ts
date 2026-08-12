export const COMMERCIAL_QUOTE_CREATED_EVENT = "commercial.quote_created.v1";
export const COMMERCIAL_QUOTE_APPROVED_EVENT = "commercial.quote_approved.v1";
export const COMMERCIAL_PAYMENT_RECORDED_EVENT =
  "commercial.payment_recorded.v1";
export const COMMERCIAL_PAYMENT_VERIFIED_EVENT =
  "commercial.payment_verified.v1";

export interface CommercialSnapshotAuditEvent {
  objectType: string | null;
  objectId: string | null;
  eventType: string;
  userId: string | null;
  details: string | null;
  createdAt: Date;
  seq: number;
}

export interface CommercialPaymentActors {
  recordedByUserId: string | null;
  verifiedByUserId: string | null;
}

export interface CommercialSnapshotAuditIndex {
  quoteCreatedByOrderId: ReadonlyMap<string, CommercialSnapshotAuditEvent>;
  quoteApprovedByOrderId: ReadonlyMap<string, CommercialSnapshotAuditEvent>;
  paymentActorsByPaymentId: ReadonlyMap<string, CommercialPaymentActors>;
}

/**
 * Indexes the one bounded audit read used by the Commercial snapshot.
 *
 * The selection rules deliberately mirror the former per-record queries:
 * quote creation and payment actors use the earliest matching sequence, while
 * quote approval uses the latest matching sequence. Comparing sequence values
 * here keeps those semantics explicit even if a test double does not preserve
 * the database ordering.
 */
export function indexCommercialSnapshotAudits(
  rows: readonly CommercialSnapshotAuditEvent[],
): CommercialSnapshotAuditIndex {
  const quoteCreatedByOrderId = new Map<string, CommercialSnapshotAuditEvent>();
  const quoteApprovedByOrderId = new Map<
    string,
    CommercialSnapshotAuditEvent
  >();
  const paymentActorEvents = new Map<
    string,
    {
      recorded?: CommercialSnapshotAuditEvent;
      verified?: CommercialSnapshotAuditEvent;
    }
  >();

  for (const row of rows) {
    if (!row.objectId) continue;

    if (
      row.objectType === "order" &&
      row.eventType === COMMERCIAL_QUOTE_CREATED_EVENT
    ) {
      const existing = quoteCreatedByOrderId.get(row.objectId);
      if (!existing || row.seq < existing.seq) {
        quoteCreatedByOrderId.set(row.objectId, row);
      }
      continue;
    }

    if (
      row.objectType === "order" &&
      row.eventType === COMMERCIAL_QUOTE_APPROVED_EVENT
    ) {
      const existing = quoteApprovedByOrderId.get(row.objectId);
      if (!existing || row.seq > existing.seq) {
        quoteApprovedByOrderId.set(row.objectId, row);
      }
      continue;
    }

    if (
      row.objectType !== "payment" ||
      (row.eventType !== COMMERCIAL_PAYMENT_RECORDED_EVENT &&
        row.eventType !== COMMERCIAL_PAYMENT_VERIFIED_EVENT)
    ) {
      continue;
    }

    const actors = paymentActorEvents.get(row.objectId) ?? {};
    const key =
      row.eventType === COMMERCIAL_PAYMENT_RECORDED_EVENT
        ? "recorded"
        : "verified";
    const existing = actors[key];
    if (!existing || row.seq < existing.seq) actors[key] = row;
    paymentActorEvents.set(row.objectId, actors);
  }

  return {
    quoteCreatedByOrderId,
    quoteApprovedByOrderId,
    paymentActorsByPaymentId: new Map(
      [...paymentActorEvents].map(([paymentId, events]) => [
        paymentId,
        {
          recordedByUserId: events.recorded?.userId ?? null,
          verifiedByUserId: events.verified?.userId ?? null,
        },
      ]),
    ),
  };
}
