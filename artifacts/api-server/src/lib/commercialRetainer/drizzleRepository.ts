import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  db,
  entitlements,
  entitlementUsage,
  invoiceLines,
  invoices,
  organisationMemberships,
  organisations,
  orders,
  payments,
  priceBookEntries,
  priceBooks,
  projects,
  roleGrants,
  subscriptions,
  users,
  withTenantDatabase,
  workTasks,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  like,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { writeAuditTx } from "../audit";
import {
  ORGANISATION_ROLES,
  hasPermission,
  isOrganisationRole,
  type OrganisationRole,
} from "../permissions";
import {
  COMMERCIAL_OFFERS,
  COMMERCIAL_RETAINER_BOUNDS,
  COMMERCIAL_RETAINER_MANIFEST,
  COMMERCIAL_RETAINER_MODULE_VERSION,
  COMMERCIAL_RETAINER_PRICE_BOOK_NAME,
  COMMERCIAL_RETAINER_PRICE_BOOK_VERSION,
  CommercialRetainerError,
  RETAINER_TASK_PREFIX,
  type CommercialEntitlement,
  type CommercialInvoice,
  type CommercialMutationResult,
  type CommercialOffer,
  type CommercialPayment,
  type CommercialRetainerRepository,
  type CommercialScope,
  type CommercialSnapshot,
  type CreateRetainerRequest,
  type ManualInvoiceTerms,
  type ManualPaymentEvidence,
  type QuoteProposal,
  type QuoteTerms,
  type RetainerHistoryEntry,
  type RetainerRequestAction,
  type RetainerServiceRequest,
  type RetainerStatus,
} from "./contracts";
import {
  COMMERCIAL_PAYMENT_RECORDED_EVENT,
  COMMERCIAL_PAYMENT_VERIFIED_EVENT,
  COMMERCIAL_QUOTE_APPROVED_EVENT,
  COMMERCIAL_QUOTE_CREATED_EVENT,
  indexCommercialSnapshotAudits,
  type CommercialPaymentActors,
  type CommercialSnapshotAuditEvent,
  type CommercialSnapshotAuditIndex,
} from "./snapshotAuditIndex";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = typeof users.$inferSelect;

const INVOICE_CREATED_EVENT = "commercial.invoice_created.v1";
const ENTITLEMENT_PROVISIONED_EVENT = "commercial.entitlement_provisioned.v1";
const RETAINER_CREATED_EVENT = "retainer.request_created.v1";
const RETAINER_MUTATED_EVENT = "retainer.request_mutated.v1";
const PAYMENT_PROVIDER = "manual-evidence-v1";
const RETAINER_ENVELOPE_SCHEMA = "valo.retainer-service-request@v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

interface QuoteAuditDetails extends Omit<
  QuoteTerms,
  "customerReference" | "scopeSummary" | "idempotencyDigest"
> {
  schemaVersion: "valo.commercial-quote@v1";
  customerReferenceSha256: string;
  scopeSummarySha256: string;
  createdByUserId: string;
}

type CommercialAuthorityAction =
  | "read"
  | "quote:create"
  | "quote:approve"
  | "invoice:create"
  | "payment:record"
  | "payment:verify"
  | "retainer:use";

const COMMERCIAL_CHECKER_ROLES = new Set<OrganisationRole>([
  "client_organisation_owner",
  "client_administrator",
  "valo_operations_administrator",
]);
const MUTABLE_PROJECT_STATUSES = new Set([
  "intake",
  "extraction",
  "review",
  "defects",
  "reporting",
]);

interface RetainerEnvelope {
  schemaVersion: typeof RETAINER_ENVELOPE_SCHEMA;
  record: RetainerServiceRequest;
}

function digest(parts: readonly (string | number | null)[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function redactedDigest(value: string): string {
  return `sha256:${digest([value])}`;
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(seed).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function safeMoney(value: bigint): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return converted;
}

function sameInstant(value: Date | null, iso: string | null): boolean {
  if (value == null || iso == null) return value == null && iso == null;
  return value.getTime() === new Date(iso).getTime();
}

function offer(versionId: string): CommercialOffer {
  const found = COMMERCIAL_OFFERS.find((item) => item.versionId === versionId);
  if (!found) throw new CommercialRetainerError("persistence_unavailable");
  return found;
}

function statusForOrder(status: string): QuoteProposal["status"] {
  switch (status) {
    case "quote_pending_checker":
      return "pending_checker";
    case "quote_approved":
      return "approved";
    case "invoiced_manual":
      return "invoiced";
    case "paid_manual":
      return "paid";
    default:
      throw new CommercialRetainerError("persistence_unavailable");
  }
}

function parseJson(value: string | null): unknown {
  if (!value) throw new CommercialRetainerError("persistence_unavailable");
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CommercialRetainerError("persistence_unavailable");
  }
}

function storedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.normalize("NFC") === value &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value) &&
    Buffer.byteLength(value, "utf8") <= COMMERCIAL_RETAINER_BOUNDS.textBytes
  );
}

function storedInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function retainerStatus(value: unknown): value is RetainerStatus {
  return (
    value === "open" ||
    value === "in_progress" ||
    value === "awaiting_evidence" ||
    value === "completed" ||
    value === "cancelled"
  );
}

function quoteAudit(value: string | null): QuoteAuditDetails {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  const detail = parsed as Partial<QuoteAuditDetails>;
  if (
    detail.schemaVersion !== "valo.commercial-quote@v1" ||
    typeof detail.createdByUserId !== "string" ||
    !UUID.test(detail.createdByUserId) ||
    typeof detail.offerVersionId !== "string" ||
    !COMMERCIAL_OFFERS.some(
      (item) => item.versionId === detail.offerVersionId,
    ) ||
    typeof detail.customerReferenceSha256 !== "string" ||
    !SHA256.test(detail.customerReferenceSha256) ||
    typeof detail.scopeSummarySha256 !== "string" ||
    !SHA256.test(detail.scopeSummarySha256) ||
    typeof detail.currency !== "string" ||
    typeof detail.amountMinor !== "number" ||
    !Number.isSafeInteger(detail.amountMinor) ||
    typeof detail.validUntil !== "string" ||
    typeof detail.serviceStartsOn !== "string" ||
    typeof detail.serviceEndsOn !== "string" ||
    typeof detail.serviceUnits !== "number" ||
    !Number.isSafeInteger(detail.serviceUnits) ||
    (detail.projectId != null &&
      (typeof detail.projectId !== "string" || !UUID.test(detail.projectId)))
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return detail as QuoteAuditDetails;
}

function serializeRetainer(record: RetainerServiceRequest): string {
  const value = JSON.stringify({
    schemaVersion: RETAINER_ENVELOPE_SCHEMA,
    record,
  } satisfies RetainerEnvelope);
  if (
    value.length > 64_000 ||
    Buffer.byteLength(value, "utf8") > 256_000 ||
    record.comments.length > COMMERCIAL_RETAINER_BOUNDS.comments ||
    record.evidenceReceipts.length >
      COMMERCIAL_RETAINER_BOUNDS.evidenceReceipts ||
    record.history.length > COMMERCIAL_RETAINER_BOUNDS.history
  ) {
    throw new CommercialRetainerError("capacity_exceeded");
  }
  return value;
}

function parseRetainer(
  value: string | null,
  row: Pick<
    typeof workTasks.$inferSelect,
    | "id"
    | "organisationId"
    | "projectId"
    | "title"
    | "ownerMembershipId"
    | "dueAt"
    | "priority"
    | "status"
    | "completedAt"
    | "version"
    | "createdAt"
    | "updatedAt"
  >,
): RetainerServiceRequest {
  if (
    value == null ||
    value.length > 64_000 ||
    Buffer.byteLength(value, "utf8") > 256_000
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  const unknownEnvelope = parseJson(value);
  if (
    typeof unknownEnvelope !== "object" ||
    unknownEnvelope == null ||
    Array.isArray(unknownEnvelope)
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  const parsed = unknownEnvelope as Partial<RetainerEnvelope>;
  const record = parsed.record;
  if (
    parsed.schemaVersion !== RETAINER_ENVELOPE_SCHEMA ||
    !record ||
    typeof record !== "object" ||
    record.id !== row.id ||
    record.organisationId !== row.organisationId ||
    record.projectId !== row.projectId ||
    record.version !== row.version ||
    !UUID.test(record.entitlementId) ||
    !UUID.test(record.ownerMembershipId) ||
    record.ownerMembershipId !== row.ownerMembershipId ||
    !row.title.startsWith(`${RETAINER_TASK_PREFIX}${record.entitlementId}]`) ||
    (record.purpose !== "evidence_review" &&
      record.purpose !== "renewal_readiness" &&
      record.purpose !== "bid_evidence_pack") ||
    !storedText(record.summary, COMMERCIAL_RETAINER_BOUNDS.text) ||
    (record.sla !== "standard" && record.sla !== "priority") ||
    record.slaPolicyVersion !== "valo.retainer-sla@v1" ||
    !storedInstant(record.dueAt) ||
    row.dueAt == null ||
    row.dueAt.getTime() !== new Date(record.dueAt).getTime() ||
    row.priority !== (record.sla === "priority" ? "high" : "normal") ||
    !retainerStatus(record.status) ||
    record.status !== row.status ||
    (record.status === "completed") !== (row.completedAt != null) ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1 ||
    !storedInstant(record.createdAt) ||
    !storedInstant(record.updatedAt) ||
    row.createdAt.getTime() !== new Date(record.createdAt).getTime() ||
    row.updatedAt.getTime() !== new Date(record.updatedAt).getTime() ||
    !Array.isArray(record.comments) ||
    !Array.isArray(record.evidenceReceipts) ||
    !Array.isArray(record.history) ||
    record.comments.length > COMMERCIAL_RETAINER_BOUNDS.comments ||
    record.evidenceReceipts.length >
      COMMERCIAL_RETAINER_BOUNDS.evidenceReceipts ||
    record.history.length > COMMERCIAL_RETAINER_BOUNDS.history ||
    !record.comments.every(
      (comment) =>
        comment != null &&
        typeof comment === "object" &&
        UUID.test(comment.id) &&
        storedText(comment.body, COMMERCIAL_RETAINER_BOUNDS.text) &&
        UUID.test(comment.createdByUserId) &&
        storedInstant(comment.createdAt),
    ) ||
    !record.evidenceReceipts.every(
      (receipt) =>
        receipt != null &&
        typeof receipt === "object" &&
        UUID.test(receipt.id) &&
        storedText(receipt.reference, COMMERCIAL_RETAINER_BOUNDS.reference) &&
        SHA256.test(receipt.sha256) &&
        UUID.test(receipt.recordedByUserId) &&
        storedInstant(receipt.recordedAt),
    ) ||
    record.history.length === 0 ||
    record.history[0]?.action !== "created" ||
    !record.history.every(
      (entry) =>
        entry != null &&
        typeof entry === "object" &&
        (entry.action === "created" ||
          entry.action === "commented" ||
          entry.action === "evidence_recorded" ||
          entry.action === "status_changed" ||
          entry.action === "reassigned") &&
        UUID.test(entry.actorUserId) &&
        storedInstant(entry.at) &&
        (entry.from == null || typeof entry.from === "string") &&
        (entry.to == null || typeof entry.to === "string"),
    )
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return structuredClone(record);
}

function hasCommercialAuthority(
  roles: readonly OrganisationRole[],
  action: CommercialAuthorityAction,
): boolean {
  switch (action) {
    case "read":
      return (
        hasPermission(roles, "billing:read") &&
        hasPermission(roles, "entitlement:read")
      );
    case "quote:create":
      return hasPermission(roles, "order:create");
    case "quote:approve":
      return (
        hasPermission(roles, "order:create") &&
        roles.some((role) => COMMERCIAL_CHECKER_ROLES.has(role))
      );
    case "invoice:create":
    case "payment:record":
    case "payment:verify":
      return (
        roles.includes("valo_operations_administrator") &&
        hasPermission(roles, "billing:read") &&
        hasPermission(roles, "order:create")
      );
    case "retainer:use":
      return (
        hasPermission(roles, "entitlement:read") &&
        hasPermission(roles, "order:create")
      );
  }
}

async function requireDirectAuthority(
  tx: Transaction,
  input: {
    organisationId: string;
    membershipId: string;
    expectedUserId?: string;
    action: CommercialAuthorityAction;
  },
  now: Date,
): Promise<Actor> {
  const [row] = await tx
    .select({ actor: users })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(
      and(
        eq(organisationMemberships.id, input.membershipId),
        eq(organisationMemberships.organisationId, input.organisationId),
        input.expectedUserId
          ? eq(organisationMemberships.userId, input.expectedUserId)
          : undefined,
        eq(organisationMemberships.status, "active"),
        isNull(organisationMemberships.delegatedByMembershipId),
        eq(organisations.status, "active"),
        or(
          isNull(organisationMemberships.accessStartsAt),
          lte(organisationMemberships.accessStartsAt, now),
        ),
        or(
          isNull(organisationMemberships.accessExpiresAt),
          gt(organisationMemberships.accessExpiresAt, now),
        ),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!row) throw new CommercialRetainerError("not_found_or_not_authorized");
  const grantRows = await tx
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, input.membershipId),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(ORGANISATION_ROLES.length + 1);
  const roles = grantRows.map(({ role }) => role).filter(isOrganisationRole);
  if (!hasCommercialAuthority(roles, input.action)) {
    throw new CommercialRetainerError("not_found_or_not_authorized");
  }
  return row.actor;
}

async function requireActor(
  tx: Transaction,
  scope: CommercialScope,
  now: Date,
  action: CommercialAuthorityAction,
): Promise<Actor> {
  return requireDirectAuthority(
    tx,
    {
      organisationId: scope.organisationId,
      membershipId: scope.actorMembershipId,
      expectedUserId: scope.actorUserId,
      action,
    },
    now,
  );
}

async function requireRetainerOwner(
  tx: Transaction,
  organisationId: string,
  membershipId: string,
  now: Date,
): Promise<void> {
  await requireDirectAuthority(
    tx,
    {
      organisationId,
      membershipId,
      action: "retainer:use",
    },
    now,
  );
}

/**
 * No Commercial action is currently approved as an append-only mutation of a
 * released project. Every linked mutation therefore takes the canonical
 * project advisory lock and fails closed for signed-off, exported, archived or
 * unknown states. This keeps financial and service records from bypassing the
 * project lifecycle merely because their route does not carry a project ID.
 */
async function lockMutableProject(
  tx: Transaction,
  organisationId: string,
  projectId: string | null,
): Promise<void> {
  if (projectId == null) return;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`,
  );
  const [project] = await tx
    .select({ status: projects.status })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.organisationId, organisationId),
      ),
    )
    .for("share");
  if (!project) {
    throw new CommercialRetainerError("not_found_or_not_authorized");
  }
  if (!MUTABLE_PROJECT_STATUSES.has(project.status)) {
    throw new CommercialRetainerError("state_conflict");
  }
}

async function catalogueEntry(
  tx: Transaction,
  organisationId: string,
  versionId: string,
  currency: string,
  now: Date,
) {
  const definition = offer(versionId);
  const rows = await tx
    .select({ entry: priceBookEntries, book: priceBooks })
    .from(priceBookEntries)
    .innerJoin(priceBooks, eq(priceBooks.id, priceBookEntries.priceBookId))
    .where(
      and(
        eq(priceBooks.name, COMMERCIAL_RETAINER_PRICE_BOOK_NAME),
        eq(priceBooks.versionNumber, COMMERCIAL_RETAINER_PRICE_BOOK_VERSION),
        eq(priceBooks.status, "active"),
        or(
          eq(priceBooks.organisationId, organisationId),
          isNull(priceBooks.organisationId),
        ),
        lte(priceBooks.effectiveFrom, now),
        or(isNull(priceBooks.effectiveTo), gt(priceBooks.effectiveTo, now)),
        eq(priceBookEntries.productCode, versionId),
        eq(priceBookEntries.productKind, definition.sku),
        eq(priceBookEntries.currency, currency),
        eq(priceBookEntries.billingCadence, definition.cadence),
      ),
    )
    .orderBy(
      sql`${priceBooks.organisationId} IS NULL`,
      desc(priceBooks.effectiveFrom),
    )
    .limit(3);
  const tenantRows = rows.filter(
    ({ book }) => book.organisationId === organisationId,
  );
  const candidates =
    tenantRows.length > 0
      ? tenantRows
      : rows.filter(({ book }) => book.organisationId == null);
  const [row] = candidates;
  if (!row || !row.book.approvedByUserId || !row.book.approvedAt) {
    throw new CommercialRetainerError("catalogue_not_seeded");
  }
  if (candidates.length !== 1) {
    throw new CommercialRetainerError("catalogue_not_seeded");
  }
  return row.entry;
}

async function loadSnapshotAuditIndex(
  tx: Transaction,
  organisationId: string,
  orderIds: readonly string[],
  paymentIds: readonly string[],
): Promise<CommercialSnapshotAuditIndex> {
  const orderFilter =
    orderIds.length === 0
      ? undefined
      : and(
          eq(auditEvents.objectType, "order"),
          inArray(auditEvents.objectId, [...orderIds]),
          inArray(auditEvents.eventType, [
            COMMERCIAL_QUOTE_CREATED_EVENT,
            COMMERCIAL_QUOTE_APPROVED_EVENT,
          ]),
        );
  const paymentFilter =
    paymentIds.length === 0
      ? undefined
      : and(
          eq(auditEvents.objectType, "payment"),
          inArray(auditEvents.objectId, [...paymentIds]),
          inArray(auditEvents.eventType, [
            COMMERCIAL_PAYMENT_RECORDED_EVENT,
            COMMERCIAL_PAYMENT_VERIFIED_EVENT,
          ]),
        );
  const objectFilter =
    orderFilter && paymentFilter
      ? or(orderFilter, paymentFilter)
      : (orderFilter ?? paymentFilter);
  if (!objectFilter) return indexCommercialSnapshotAudits([]);

  // Rank before limiting so duplicate historical receipts retain the former
  // per-record query semantics: earliest creation/recording/verification and
  // latest approval. The outer query therefore materialises at most one row
  // per selected object/event pair, regardless of raw audit history size.
  const maxRows = orderIds.length * 2 + paymentIds.length * 2;
  const rankedAudits = tx
    .select({
      objectType: auditEvents.objectType,
      objectId: auditEvents.objectId,
      eventType: auditEvents.eventType,
      userId: auditEvents.userId,
      details: auditEvents.details,
      createdAt: auditEvents.createdAt,
      seq: auditEvents.seq,
      snapshotRank: sql<number>`row_number() over (
        partition by ${auditEvents.objectType}, ${auditEvents.objectId}, ${auditEvents.eventType}
        order by case
          when ${auditEvents.eventType} = ${COMMERCIAL_QUOTE_APPROVED_EVENT}
            then -${auditEvents.seq}
          else ${auditEvents.seq}
        end asc
      )`.as("snapshot_rank"),
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.organisationId, organisationId), objectFilter))
    .as("ranked_commercial_snapshot_audits");
  const rows = await tx
    .select({
      objectType: rankedAudits.objectType,
      objectId: rankedAudits.objectId,
      eventType: rankedAudits.eventType,
      userId: rankedAudits.userId,
      details: rankedAudits.details,
      createdAt: rankedAudits.createdAt,
      seq: rankedAudits.seq,
    })
    .from(rankedAudits)
    .where(eq(rankedAudits.snapshotRank, 1))
    .orderBy(asc(rankedAudits.seq))
    .limit(maxRows + 1);
  if (rows.length > maxRows) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return indexCommercialSnapshotAudits(rows);
}

async function createdAuditFor(
  tx: Transaction,
  organisationId: string,
  orderId: string,
) {
  const [event] = await tx
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.eventType, COMMERCIAL_QUOTE_CREATED_EVENT),
        eq(auditEvents.objectType, "order"),
        eq(auditEvents.objectId, orderId),
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(1);
  if (!event) throw new CommercialRetainerError("persistence_unavailable");
  return { event, details: quoteAudit(event.details) };
}

async function approvedByFor(
  tx: Transaction,
  organisationId: string,
  orderId: string,
): Promise<string | null> {
  const [event] = await tx
    .select({ userId: auditEvents.userId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.eventType, COMMERCIAL_QUOTE_APPROVED_EVENT),
        eq(auditEvents.objectType, "order"),
        eq(auditEvents.objectId, orderId),
      ),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  return event?.userId ?? null;
}

async function quoteRecord(
  tx: Transaction,
  row: typeof orders.$inferSelect,
): Promise<QuoteProposal> {
  const { event, details } = await createdAuditFor(
    tx,
    row.organisationId,
    row.id,
  );
  const approvedByUserId = await approvedByFor(tx, row.organisationId, row.id);
  return materializeQuote(row, event, details, approvedByUserId);
}

function materializeQuote(
  row: typeof orders.$inferSelect,
  event: Pick<CommercialSnapshotAuditEvent, "createdAt">,
  details: QuoteAuditDetails,
  approvedByUserId: string | null,
): QuoteProposal {
  if (
    details.projectId !== row.projectId ||
    details.currency !== row.currency ||
    details.amountMinor !== safeMoney(row.totalAmountMinor) ||
    details.createdByUserId !== row.placedByUserId
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return {
    id: row.id,
    organisationId: row.organisationId,
    projectId: row.projectId,
    offerVersionId: details.offerVersionId,
    customerReference: `sha256:${details.customerReferenceSha256}`,
    scopeSummary: `sha256:${details.scopeSummarySha256}`,
    currency: row.currency,
    amountMinor: safeMoney(row.totalAmountMinor),
    validUntil: details.validUntil,
    serviceStartsOn: details.serviceStartsOn,
    serviceEndsOn: details.serviceEndsOn,
    serviceUnits: details.serviceUnits,
    status: statusForOrder(row.status),
    createdByUserId: row.placedByUserId,
    approvedByUserId,
    version: row.version,
    createdAt: event.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function quoteRecordFromAuditIndex(
  row: typeof orders.$inferSelect,
  audits: CommercialSnapshotAuditIndex,
): QuoteProposal {
  const event = audits.quoteCreatedByOrderId.get(row.id);
  if (!event) throw new CommercialRetainerError("persistence_unavailable");
  return materializeQuote(
    row,
    event,
    quoteAudit(event.details),
    audits.quoteApprovedByOrderId.get(row.id)?.userId ?? null,
  );
}

function invoiceRecord(
  invoice: typeof invoices.$inferSelect,
  orderId: string,
): CommercialInvoice {
  if (invoice.status !== "issued_manual" && invoice.status !== "paid_manual") {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return {
    id: invoice.id,
    orderId,
    invoiceNumber: invoice.invoiceNumber,
    currency: invoice.currency,
    netAmountMinor: safeMoney(invoice.netAmountMinor),
    vatAmountMinor: safeMoney(invoice.vatAmountMinor),
    grossAmountMinor: safeMoney(invoice.grossAmountMinor),
    whtAmountMinor:
      invoice.whtAmountMinor == null ? null : safeMoney(invoice.whtAmountMinor),
    netPayableMinor: safeMoney(invoice.netPayableMinor),
    status: invoice.status,
    version: invoice.version,
    createdAt: invoice.createdAt.toISOString(),
  };
}

async function paymentActors(
  tx: Transaction,
  organisationId: string,
  paymentId: string,
) {
  const rows = await tx
    .select({ eventType: auditEvents.eventType, userId: auditEvents.userId })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        eq(auditEvents.objectType, "payment"),
        eq(auditEvents.objectId, paymentId),
        inArray(auditEvents.eventType, [
          COMMERCIAL_PAYMENT_RECORDED_EVENT,
          COMMERCIAL_PAYMENT_VERIFIED_EVENT,
        ]),
      ),
    )
    .orderBy(asc(auditEvents.seq));
  return {
    recordedByUserId:
      rows.find((row) => row.eventType === COMMERCIAL_PAYMENT_RECORDED_EVENT)
        ?.userId ?? null,
    verifiedByUserId:
      rows.find((row) => row.eventType === COMMERCIAL_PAYMENT_VERIFIED_EVENT)
        ?.userId ?? null,
  };
}

async function paymentRecord(
  tx: Transaction,
  row: typeof payments.$inferSelect,
): Promise<CommercialPayment> {
  return materializePayment(
    row,
    await paymentActors(tx, row.organisationId, row.id),
  );
}

function materializePayment(
  row: typeof payments.$inferSelect,
  actors: CommercialPaymentActors | undefined,
): CommercialPayment {
  if (
    !row.invoiceId ||
    row.provider !== PAYMENT_PROVIDER ||
    !row.providerEventHash ||
    !row.settledAt ||
    (row.status !== "evidence_recorded" && row.status !== "settled") ||
    (row.reconciliationStatus !== "pending_checker" &&
      row.reconciliationStatus !== "verified_manual")
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  if (!actors?.recordedByUserId) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    amountMinor: safeMoney(row.amountMinor),
    currency: row.currency,
    status: row.status,
    reconciliationStatus: row.reconciliationStatus,
    evidenceSha256: row.providerEventHash,
    recordedByUserId: actors.recordedByUserId,
    verifiedByUserId: actors.verifiedByUserId,
    settledAt: row.settledAt.toISOString(),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

function paymentRecordFromAuditIndex(
  row: typeof payments.$inferSelect,
  audits: CommercialSnapshotAuditIndex,
): CommercialPayment {
  return materializePayment(row, audits.paymentActorsByPaymentId.get(row.id));
}

function entitlementRecord(
  row: typeof entitlements.$inferSelect,
): CommercialEntitlement {
  if (
    !row.orderId ||
    !COMMERCIAL_OFFERS.some((item) => item.sku === row.productKind) ||
    (row.status !== "active" && row.status !== "scheduled") ||
    row.paymentState !== "verified_manual" ||
    row.endsAt == null ||
    row.usageLimit == null ||
    row.rulesVersion !== COMMERCIAL_RETAINER_MODULE_VERSION
  ) {
    throw new CommercialRetainerError("persistence_unavailable");
  }
  return {
    id: row.id,
    orderId: row.orderId,
    subscriptionId: row.subscriptionId,
    productKind: row.productKind as CommercialOffer["sku"],
    status: row.status,
    paymentState: "verified_manual",
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    usageLimit: row.usageLimit,
    usageConsumed: row.usageConsumed,
    rulesVersion: COMMERCIAL_RETAINER_MODULE_VERSION,
    version: row.version,
  };
}

function resultForMiss<T>(
  row: { version: number; status?: string } | undefined,
  expectedVersion: number,
): CommercialMutationResult<T> {
  if (!row) return { outcome: "not_found" };
  if (row.version !== expectedVersion) return { outcome: "version_conflict" };
  return { outcome: "state_conflict" };
}

export class DrizzleCommercialRetainerRepository implements CommercialRetainerRepository {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async readSnapshot(
    scope: CommercialScope,
    projectId?: string,
  ): Promise<CommercialSnapshot> {
    return withTenantDatabase(scope.organisationId, async () => {
      const now = this.now();
      await requireActor(db as unknown as Transaction, scope, now, "read");
      const entryRows = await db
        .select({ entry: priceBookEntries, book: priceBooks })
        .from(priceBookEntries)
        .innerJoin(priceBooks, eq(priceBooks.id, priceBookEntries.priceBookId))
        .where(
          and(
            eq(priceBooks.name, COMMERCIAL_RETAINER_PRICE_BOOK_NAME),
            eq(
              priceBooks.versionNumber,
              COMMERCIAL_RETAINER_PRICE_BOOK_VERSION,
            ),
            eq(priceBooks.status, "active"),
            or(
              eq(priceBooks.organisationId, scope.organisationId),
              isNull(priceBooks.organisationId),
            ),
            lte(priceBooks.effectiveFrom, now),
            or(isNull(priceBooks.effectiveTo), gt(priceBooks.effectiveTo, now)),
          ),
        );
      const orderable = new Set(
        COMMERCIAL_OFFERS.filter((definition) => {
          const matching = entryRows.filter(
            ({ entry }) =>
              entry.productCode === definition.versionId &&
              entry.productKind === definition.sku &&
              entry.billingCadence === definition.cadence,
          );
          const tenantRows = matching.filter(
            ({ book }) => book.organisationId === scope.organisationId,
          );
          const candidates =
            tenantRows.length > 0
              ? tenantRows
              : matching.filter(({ book }) => book.organisationId == null);
          return Boolean(
            candidates.length === 1 &&
            candidates[0]!.book.approvedByUserId &&
            candidates[0]!.book.approvedAt,
          );
        }).map((definition) => definition.versionId),
      );
      const orderRows = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.organisationId, scope.organisationId),
            inArray(orders.status, [
              "quote_pending_checker",
              "quote_approved",
              "invoiced_manual",
              "paid_manual",
            ]),
            projectId ? eq(orders.projectId, projectId) : undefined,
          ),
        )
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(COMMERCIAL_RETAINER_BOUNDS.listRows + 1);
      if (orderRows.length > COMMERCIAL_RETAINER_BOUNDS.listRows) {
        throw new CommercialRetainerError("capacity_exceeded");
      }
      const orderIds = orderRows.map((row) => row.id);
      const invoiceRows =
        orderIds.length === 0
          ? []
          : await db
              .select({ invoice: invoices, orderId: invoiceLines.orderId })
              .from(invoiceLines)
              .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
              .where(
                and(
                  eq(invoices.organisationId, scope.organisationId),
                  inArray(invoiceLines.orderId, orderIds),
                  inArray(invoices.status, ["issued_manual", "paid_manual"]),
                ),
              )
              .orderBy(desc(invoices.createdAt))
              .limit(COMMERCIAL_RETAINER_BOUNDS.listRows + 1);
      if (invoiceRows.length > COMMERCIAL_RETAINER_BOUNDS.listRows) {
        throw new CommercialRetainerError("capacity_exceeded");
      }
      const commercialInvoices = invoiceRows.map(({ invoice, orderId }) => {
        if (!orderId)
          throw new CommercialRetainerError("persistence_unavailable");
        return invoiceRecord(invoice, orderId);
      });
      const invoiceIds = invoiceRows.map(({ invoice }) => invoice.id);
      const paymentRows =
        invoiceIds.length === 0
          ? []
          : await db
              .select()
              .from(payments)
              .where(
                and(
                  eq(payments.organisationId, scope.organisationId),
                  eq(payments.provider, PAYMENT_PROVIDER),
                  inArray(payments.invoiceId, invoiceIds),
                ),
              )
              .orderBy(desc(payments.createdAt))
              .limit(COMMERCIAL_RETAINER_BOUNDS.listRows + 1);
      if (paymentRows.length > COMMERCIAL_RETAINER_BOUNDS.listRows) {
        throw new CommercialRetainerError("capacity_exceeded");
      }
      const snapshotAudits = await loadSnapshotAuditIndex(
        db as unknown as Transaction,
        scope.organisationId,
        orderIds,
        paymentRows.map((row) => row.id),
      );
      const quotes = orderRows.map((row) =>
        quoteRecordFromAuditIndex(row, snapshotAudits),
      );
      const commercialPayments = paymentRows.map((row) =>
        paymentRecordFromAuditIndex(row, snapshotAudits),
      );
      const entitlementRows =
        orderIds.length === 0
          ? []
          : await db
              .select()
              .from(entitlements)
              .where(
                and(
                  eq(entitlements.organisationId, scope.organisationId),
                  inArray(entitlements.orderId, orderIds),
                  eq(
                    entitlements.rulesVersion,
                    COMMERCIAL_RETAINER_MODULE_VERSION,
                  ),
                ),
              )
              .orderBy(desc(entitlements.createdAt))
              .limit(COMMERCIAL_RETAINER_BOUNDS.listRows + 1);
      if (entitlementRows.length > COMMERCIAL_RETAINER_BOUNDS.listRows) {
        throw new CommercialRetainerError("capacity_exceeded");
      }
      const taskRows = await db
        .select()
        .from(workTasks)
        .where(
          and(
            eq(workTasks.organisationId, scope.organisationId),
            like(workTasks.title, `${RETAINER_TASK_PREFIX}%`),
            projectId ? eq(workTasks.projectId, projectId) : undefined,
          ),
        )
        .orderBy(desc(workTasks.updatedAt), desc(workTasks.id))
        .limit(COMMERCIAL_RETAINER_BOUNDS.listRows + 1);
      if (taskRows.length > COMMERCIAL_RETAINER_BOUNDS.listRows) {
        throw new CommercialRetainerError("capacity_exceeded");
      }
      return {
        organisationId: scope.organisationId,
        manifest: COMMERCIAL_RETAINER_MANIFEST,
        activation: {
          fixedPriceBookReady: COMMERCIAL_OFFERS.every((item) =>
            orderable.has(item.versionId),
          ),
          providerConnected: false as const,
          manualReconciliationReady: true,
          retainerDeskReady: orderable.has("evidence_readiness_retainer@1"),
        },
        offers: COMMERCIAL_OFFERS.map((item) => ({
          ...item,
          orderable: orderable.has(item.versionId),
        })),
        quotes,
        invoices: commercialInvoices,
        payments: commercialPayments,
        entitlements: entitlementRows.map(entitlementRecord),
        serviceRequests: taskRows.map((row) =>
          parseRetainer(row.description, row),
        ),
      };
    });
  }

  async createQuote(
    scope: CommercialScope,
    terms: QuoteTerms,
  ): Promise<QuoteProposal> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          await lockMutableProject(tx, scope.organisationId, terms.projectId);
          const actor = await requireActor(tx, scope, now, "quote:create");
          const entry = await catalogueEntry(
            tx,
            scope.organisationId,
            terms.offerVersionId,
            terms.currency,
            now,
          );
          const idempotencyKey = digest([
            COMMERCIAL_RETAINER_MODULE_VERSION,
            scope.organisationId,
            "quote",
            terms.idempotencyDigest,
          ]);
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
          );
          const [existing] = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.organisationId, scope.organisationId),
                eq(orders.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) {
            const replay = await quoteRecord(tx, existing);
            if (
              replay.projectId !== terms.projectId ||
              replay.offerVersionId !== terms.offerVersionId ||
              replay.customerReference !==
                redactedDigest(terms.customerReference) ||
              replay.scopeSummary !== redactedDigest(terms.scopeSummary) ||
              replay.currency !== terms.currency ||
              replay.amountMinor !== terms.amountMinor ||
              replay.validUntil !== terms.validUntil ||
              replay.serviceStartsOn !== terms.serviceStartsOn ||
              replay.serviceEndsOn !== terms.serviceEndsOn ||
              replay.serviceUnits !== terms.serviceUnits
            ) {
              throw new CommercialRetainerError("state_conflict");
            }
            return replay;
          }
          const [row] = await tx
            .insert(orders)
            .values({
              organisationId: scope.organisationId,
              projectId: terms.projectId,
              priceBookEntryId: entry.id,
              quantity: 1,
              unitAmountMinor: BigInt(terms.amountMinor),
              totalAmountMinor: BigInt(terms.amountMinor),
              currency: terms.currency,
              status: "quote_pending_checker",
              idempotencyKey,
              placedByUserId: scope.actorUserId,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!row)
            throw new CommercialRetainerError("persistence_unavailable");
          const details: QuoteAuditDetails = {
            schemaVersion: "valo.commercial-quote@v1",
            projectId: terms.projectId,
            customerReferenceSha256: digest([terms.customerReference]),
            offerVersionId: terms.offerVersionId,
            scopeSummarySha256: digest([terms.scopeSummary]),
            currency: terms.currency,
            amountMinor: terms.amountMinor,
            validUntil: terms.validUntil,
            serviceStartsOn: terms.serviceStartsOn,
            serviceEndsOn: terms.serviceEndsOn,
            serviceUnits: terms.serviceUnits,
            createdByUserId: scope.actorUserId,
          };
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: terms.projectId,
            eventType: COMMERCIAL_QUOTE_CREATED_EVENT,
            objectType: "order",
            objectId: row.id,
            details: JSON.stringify(details),
          });
          return {
            id: row.id,
            organisationId: row.organisationId,
            projectId: row.projectId,
            offerVersionId: terms.offerVersionId,
            customerReference: redactedDigest(terms.customerReference),
            scopeSummary: redactedDigest(terms.scopeSummary),
            currency: terms.currency,
            amountMinor: terms.amountMinor,
            validUntil: terms.validUntil,
            serviceStartsOn: terms.serviceStartsOn,
            serviceEndsOn: terms.serviceEndsOn,
            serviceUnits: terms.serviceUnits,
            status: "pending_checker",
            createdByUserId: scope.actorUserId,
            approvedByUserId: null,
            version: row.version,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async approveQuote(
    scope: CommercialScope,
    orderId: string,
    expectedVersion: number,
  ): Promise<CommercialMutationResult<QuoteProposal>> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          const [probe] = await tx
            .select({ projectId: orders.projectId })
            .from(orders)
            .where(
              and(
                eq(orders.id, orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .limit(1);
          if (!probe) return { outcome: "not_found" };
          await lockMutableProject(tx, scope.organisationId, probe.projectId);
          const actor = await requireActor(tx, scope, now, "quote:approve");
          const [current] = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.id, orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .for("update");
          if (!current || current.version !== expectedVersion) {
            return resultForMiss(current, expectedVersion);
          }
          if (current.status !== "quote_pending_checker") {
            return { outcome: "state_conflict" };
          }
          if (current.placedByUserId === scope.actorUserId) {
            throw new CommercialRetainerError("self_approval_denied");
          }
          const created = await createdAuditFor(
            tx,
            scope.organisationId,
            current.id,
          );
          if (
            Date.parse(`${created.details.validUntil}T23:59:59.999Z`) <
            now.getTime()
          ) {
            return { outcome: "state_conflict" };
          }
          const [updated] = await tx
            .update(orders)
            .set({
              status: "quote_approved",
              version: expectedVersion + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(orders.id, current.id),
                eq(orders.status, "quote_pending_checker"),
                eq(orders.version, expectedVersion),
              ),
            )
            .returning();
          if (!updated) return { outcome: "version_conflict" };
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: updated.projectId,
            eventType: COMMERCIAL_QUOTE_APPROVED_EVENT,
            objectType: "order",
            objectId: updated.id,
            details: JSON.stringify({
              schemaVersion: "valo.commercial-quote-approval@v1",
              makerUserId: updated.placedByUserId,
              checkerUserId: scope.actorUserId,
              sourceVersion: expectedVersion,
            }),
          });
          return { outcome: "updated", record: await quoteRecord(tx, updated) };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async createInvoice(
    scope: CommercialScope,
    terms: ManualInvoiceTerms,
  ): Promise<CommercialMutationResult<CommercialInvoice>> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          const [orderProbe] = await tx
            .select({ projectId: orders.projectId })
            .from(orders)
            .where(
              and(
                eq(orders.id, terms.orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .limit(1);
          if (!orderProbe) return { outcome: "not_found" };
          await lockMutableProject(
            tx,
            scope.organisationId,
            orderProbe.projectId,
          );
          const actor = await requireActor(tx, scope, now, "invoice:create");
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${terms.orderId}, 0))`,
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.organisationId}:invoice:${terms.invoiceNumber}`}, 0))`,
          );
          const existingInvoiceRows = await tx
            .select({ invoice: invoices, line: invoiceLines })
            .from(invoices)
            .leftJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
            .where(
              and(
                eq(invoices.organisationId, scope.organisationId),
                eq(invoices.invoiceNumber, terms.invoiceNumber),
              ),
            )
            .limit(2);
          if (existingInvoiceRows.length > 0) {
            const existing = existingInvoiceRows[0]!;
            if (
              existingInvoiceRows.length !== 1 ||
              !existing.line ||
              existing.line.orderId !== terms.orderId ||
              existing.line.quantity !== 1 ||
              safeMoney(existing.line.unitAmountMinor) !==
                terms.netAmountMinor ||
              safeMoney(existing.line.lineAmountMinor) !==
                terms.netAmountMinor ||
              safeMoney(existing.invoice.netAmountMinor) !==
                terms.netAmountMinor ||
              existing.invoice.vatRateBasisPoints !==
                terms.vatRateBasisPoints ||
              safeMoney(existing.invoice.vatAmountMinor) !==
                terms.vatAmountMinor ||
              safeMoney(existing.invoice.grossAmountMinor) !==
                terms.grossAmountMinor ||
              existing.invoice.whtRateBasisPoints !==
                terms.whtRateBasisPoints ||
              (existing.invoice.whtAmountMinor == null
                ? null
                : safeMoney(existing.invoice.whtAmountMinor)) !==
                terms.whtAmountMinor ||
              safeMoney(existing.invoice.netPayableMinor) !==
                terms.netPayableMinor ||
              existing.invoice.taxRuleId !== terms.taxRuleId ||
              !sameInstant(existing.invoice.taxPointAt, terms.taxPointAt) ||
              !sameInstant(existing.invoice.dueAt, terms.dueAt)
            ) {
              return { outcome: "state_conflict" };
            }
            const [createdByModule] = await tx
              .select({ id: auditEvents.id })
              .from(auditEvents)
              .where(
                and(
                  eq(auditEvents.organisationId, scope.organisationId),
                  eq(auditEvents.eventType, INVOICE_CREATED_EVENT),
                  eq(auditEvents.objectType, "invoice"),
                  eq(auditEvents.objectId, existing.invoice.id),
                ),
              )
              .limit(1);
            if (!createdByModule) {
              return { outcome: "state_conflict" };
            }
            return {
              outcome: "updated",
              record: invoiceRecord(existing.invoice, terms.orderId),
            };
          }
          const [order] = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.id, terms.orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .for("update");
          if (!order || order.version !== terms.expectedOrderVersion) {
            return resultForMiss(order, terms.expectedOrderVersion);
          }
          if (
            order.status !== "quote_approved" ||
            safeMoney(order.totalAmountMinor) !== terms.netAmountMinor
          ) {
            return { outcome: "state_conflict" };
          }
          const [invoice] = await tx
            .insert(invoices)
            .values({
              organisationId: scope.organisationId,
              invoiceNumber: terms.invoiceNumber,
              currency: order.currency,
              netAmountMinor: BigInt(terms.netAmountMinor),
              vatRateBasisPoints: terms.vatRateBasisPoints,
              vatAmountMinor: BigInt(terms.vatAmountMinor),
              grossAmountMinor: BigInt(terms.grossAmountMinor),
              whtRateBasisPoints: terms.whtRateBasisPoints,
              whtAmountMinor:
                terms.whtAmountMinor == null
                  ? null
                  : BigInt(terms.whtAmountMinor),
              netPayableMinor: BigInt(terms.netPayableMinor),
              taxRuleId: terms.taxRuleId,
              taxPointAt: new Date(terms.taxPointAt),
              dueAt: terms.dueAt ? new Date(terms.dueAt) : null,
              status: "issued_manual",
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!invoice)
            throw new CommercialRetainerError("persistence_unavailable");
          const definition = offer(
            (await createdAuditFor(tx, scope.organisationId, order.id)).details
              .offerVersionId,
          );
          await tx.insert(invoiceLines).values({
            invoiceId: invoice.id,
            orderId: order.id,
            description: `${definition.title} — approved manual quote`,
            quantity: 1,
            unitAmountMinor: order.totalAmountMinor,
            lineAmountMinor: order.totalAmountMinor,
            createdAt: now,
          });
          const [updatedOrder] = await tx
            .update(orders)
            .set({
              status: "invoiced_manual",
              version: order.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(orders.id, order.id),
                eq(orders.status, "quote_approved"),
                eq(orders.version, order.version),
              ),
            )
            .returning();
          if (!updatedOrder) return { outcome: "version_conflict" };
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: order.projectId,
            eventType: INVOICE_CREATED_EVENT,
            objectType: "invoice",
            objectId: invoice.id,
            details: JSON.stringify({
              schemaVersion: "valo.manual-invoice@v1",
              orderId: order.id,
              createdByUserId: scope.actorUserId,
              noProviderCall: true,
            }),
          });
          return {
            outcome: "updated",
            record: invoiceRecord(invoice, order.id),
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async recordPayment(
    scope: CommercialScope,
    evidence: ManualPaymentEvidence,
  ): Promise<CommercialMutationResult<CommercialPayment>> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          const invoiceContexts = await tx
            .select({
              invoiceId: invoices.id,
              orderId: orders.id,
              projectId: orders.projectId,
            })
            .from(invoices)
            .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
            .innerJoin(
              orders,
              and(
                eq(orders.id, invoiceLines.orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .where(
              and(
                eq(invoices.id, evidence.invoiceId),
                eq(invoices.organisationId, scope.organisationId),
              ),
            )
            .limit(2);
          if (invoiceContexts.length !== 1) return { outcome: "not_found" };
          const [invoiceContext] = invoiceContexts;
          await lockMutableProject(
            tx,
            scope.organisationId,
            invoiceContext!.projectId,
          );
          const actor = await requireActor(tx, scope, now, "payment:record");
          const idempotencyKey = digest([
            COMMERCIAL_RETAINER_MODULE_VERSION,
            scope.organisationId,
            "payment",
            evidence.idempotencyDigest,
          ]);
          const providerReference = `manual:${digest([
            scope.organisationId,
            evidence.evidenceReference,
          ])}`;
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`,
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${providerReference}, 0))`,
          );
          const [existing] = await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.organisationId, scope.organisationId),
                eq(payments.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);
          if (existing) {
            if (
              existing.invoiceId !== evidence.invoiceId ||
              existing.provider !== PAYMENT_PROVIDER ||
              existing.providerReference !== providerReference ||
              existing.providerEventHash !== evidence.evidenceSha256 ||
              safeMoney(existing.amountMinor) !== evidence.amountMinor ||
              existing.currency !== evidence.currency ||
              !sameInstant(existing.settledAt, evidence.settledAt)
            ) {
              return { outcome: "state_conflict" };
            }
            return {
              outcome: "updated",
              record: await paymentRecord(tx, existing),
            };
          }
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, evidence.invoiceId),
                eq(invoices.organisationId, scope.organisationId),
              ),
            )
            .for("update");
          if (!invoice || invoice.version !== evidence.expectedInvoiceVersion) {
            return resultForMiss(invoice, evidence.expectedInvoiceVersion);
          }
          if (
            invoice.status !== "issued_manual" ||
            invoice.currency !== evidence.currency ||
            safeMoney(invoice.netPayableMinor) !== evidence.amountMinor
          ) {
            return { outcome: "state_conflict" };
          }
          const [payment] = await tx
            .insert(payments)
            .values({
              organisationId: scope.organisationId,
              invoiceId: invoice.id,
              provider: PAYMENT_PROVIDER,
              providerReference,
              idempotencyKey,
              amountMinor: BigInt(evidence.amountMinor),
              currency: evidence.currency,
              status: "evidence_recorded",
              reconciliationStatus: "pending_checker",
              providerEventHash: evidence.evidenceSha256,
              settledAt: new Date(evidence.settledAt),
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!payment)
            throw new CommercialRetainerError("persistence_unavailable");
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: invoiceContext!.projectId,
            eventType: COMMERCIAL_PAYMENT_RECORDED_EVENT,
            objectType: "payment",
            objectId: payment.id,
            details: JSON.stringify({
              schemaVersion: "valo.manual-payment-evidence@v1",
              evidenceReference: evidence.evidenceReference,
              evidenceSha256: evidence.evidenceSha256,
              recordedByUserId: scope.actorUserId,
              providerConnected: false,
            }),
          });
          return {
            outcome: "updated",
            record: await paymentRecord(tx, payment),
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async verifyPayment(
    scope: CommercialScope,
    paymentId: string,
    expectedPaymentVersion: number,
    expectedInvoiceVersion: number,
  ): Promise<
    CommercialMutationResult<{
      payment: CommercialPayment;
      entitlement: CommercialEntitlement;
    }>
  > {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          const paymentContexts = await tx
            .select({
              paymentId: payments.id,
              invoiceId: invoices.id,
              orderId: orders.id,
              projectId: orders.projectId,
            })
            .from(payments)
            .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
            .innerJoin(invoiceLines, eq(invoiceLines.invoiceId, invoices.id))
            .innerJoin(
              orders,
              and(
                eq(orders.id, invoiceLines.orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .where(
              and(
                eq(payments.id, paymentId),
                eq(payments.organisationId, scope.organisationId),
                eq(payments.provider, PAYMENT_PROVIDER),
                eq(invoices.organisationId, scope.organisationId),
              ),
            )
            .limit(2);
          if (paymentContexts.length !== 1) return { outcome: "not_found" };
          const [paymentContext] = paymentContexts;
          await lockMutableProject(
            tx,
            scope.organisationId,
            paymentContext!.projectId,
          );
          const actor = await requireActor(tx, scope, now, "payment:verify");
          const [payment] = await tx
            .select()
            .from(payments)
            .where(
              and(
                eq(payments.id, paymentId),
                eq(payments.organisationId, scope.organisationId),
                eq(payments.provider, PAYMENT_PROVIDER),
              ),
            )
            .for("update");
          if (!payment || payment.version !== expectedPaymentVersion) {
            return resultForMiss(payment, expectedPaymentVersion);
          }
          if (
            payment.status !== "evidence_recorded" ||
            payment.reconciliationStatus !== "pending_checker" ||
            !payment.invoiceId
          )
            return { outcome: "state_conflict" };
          const actors = await paymentActors(
            tx,
            scope.organisationId,
            payment.id,
          );
          if (!actors.recordedByUserId) {
            throw new CommercialRetainerError("persistence_unavailable");
          }
          if (actors.recordedByUserId === scope.actorUserId) {
            throw new CommercialRetainerError("self_approval_denied");
          }
          const [invoice] = await tx
            .select()
            .from(invoices)
            .where(
              and(
                eq(invoices.id, payment.invoiceId),
                eq(invoices.organisationId, scope.organisationId),
              ),
            )
            .for("update");
          if (!invoice || invoice.version !== expectedInvoiceVersion) {
            return resultForMiss(invoice, expectedInvoiceVersion);
          }
          if (
            invoice.status !== "issued_manual" ||
            payment.currency !== invoice.currency ||
            payment.amountMinor !== invoice.netPayableMinor ||
            !payment.providerEventHash
          )
            return { outcome: "state_conflict" };
          const lines = await tx
            .select()
            .from(invoiceLines)
            .where(eq(invoiceLines.invoiceId, invoice.id));
          if (
            lines.length !== 1 ||
            !lines[0]!.orderId ||
            lines[0]!.orderId !== paymentContext!.orderId
          ) {
            throw new CommercialRetainerError("persistence_unavailable");
          }
          const [order] = await tx
            .select()
            .from(orders)
            .where(
              and(
                eq(orders.id, lines[0]!.orderId!),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .for("update");
          if (
            !order ||
            order.projectId !== paymentContext!.projectId ||
            order.status !== "invoiced_manual"
          ) {
            return { outcome: "state_conflict" };
          }
          const existingEntitlements = await tx
            .select({ id: entitlements.id })
            .from(entitlements)
            .where(
              and(
                eq(entitlements.organisationId, scope.organisationId),
                eq(entitlements.orderId, order.id),
                eq(
                  entitlements.rulesVersion,
                  COMMERCIAL_RETAINER_MODULE_VERSION,
                ),
              ),
            );
          if (existingEntitlements.length !== 0) {
            return { outcome: "state_conflict" };
          }
          const created = await createdAuditFor(
            tx,
            scope.organisationId,
            order.id,
          );
          const definition = offer(created.details.offerVersionId);
          const startsAt = new Date(
            `${created.details.serviceStartsOn}T00:00:00.000Z`,
          );
          const endsAt = new Date(
            `${created.details.serviceEndsOn}T23:59:59.999Z`,
          );
          if (endsAt.getTime() <= now.getTime())
            return { outcome: "state_conflict" };
          const [subscription] =
            definition.cadence === "manual_monthly"
              ? await tx
                  .insert(subscriptions)
                  .values({
                    organisationId: scope.organisationId,
                    priceBookEntryId: order.priceBookEntryId,
                    status:
                      startsAt.getTime() <= now.getTime()
                        ? "active_manual"
                        : "scheduled_manual",
                    startsAt,
                    currentPeriodEndsAt: endsAt,
                    providerReference: null,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning()
              : [undefined];
          const [entitlement] = await tx
            .insert(entitlements)
            .values({
              organisationId: scope.organisationId,
              orderId: order.id,
              subscriptionId: subscription?.id ?? null,
              productKind: definition.sku,
              status:
                startsAt.getTime() <= now.getTime() ? "active" : "scheduled",
              startsAt,
              endsAt,
              usageLimit: created.details.serviceUnits,
              usageConsumed: 0,
              paymentState: "verified_manual",
              featureFlagKey: null,
              rulesVersion: COMMERCIAL_RETAINER_MODULE_VERSION,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!entitlement)
            throw new CommercialRetainerError("persistence_unavailable");
          const [updatedPayment] = await tx
            .update(payments)
            .set({
              status: "settled",
              reconciliationStatus: "verified_manual",
              version: payment.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(payments.id, payment.id),
                eq(payments.status, "evidence_recorded"),
                eq(payments.reconciliationStatus, "pending_checker"),
                eq(payments.version, payment.version),
              ),
            )
            .returning();
          const [updatedInvoice] = await tx
            .update(invoices)
            .set({
              status: "paid_manual",
              version: invoice.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(invoices.id, invoice.id),
                eq(invoices.status, "issued_manual"),
                eq(invoices.version, invoice.version),
              ),
            )
            .returning();
          const [updatedOrder] = await tx
            .update(orders)
            .set({
              status: "paid_manual",
              version: order.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(orders.id, order.id),
                eq(orders.status, "invoiced_manual"),
                eq(orders.version, order.version),
              ),
            )
            .returning();
          if (!updatedPayment || !updatedInvoice || !updatedOrder) {
            throw new CommercialRetainerError("version_conflict");
          }
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: order.projectId,
            eventType: COMMERCIAL_PAYMENT_VERIFIED_EVENT,
            objectType: "payment",
            objectId: payment.id,
            details: JSON.stringify({
              schemaVersion: "valo.manual-payment-verification@v1",
              makerUserId: actors.recordedByUserId,
              checkerUserId: scope.actorUserId,
              evidenceSha256: payment.providerEventHash,
              providerConnected: false,
            }),
          });
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: order.projectId,
            eventType: ENTITLEMENT_PROVISIONED_EVENT,
            objectType: "entitlement",
            objectId: entitlement.id,
            details: JSON.stringify({
              schemaVersion: "valo.entitlement-provisioning@v1",
              orderId: order.id,
              paymentId: payment.id,
              manualEvidenceVerified: true,
            }),
          });
          return {
            outcome: "updated",
            record: {
              payment: await paymentRecord(tx, updatedPayment),
              entitlement: entitlementRecord(entitlement),
            },
          };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async createRetainerRequest(
    scope: CommercialScope,
    command: CreateRetainerRequest,
  ): Promise<CommercialMutationResult<RetainerServiceRequest>> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          await lockMutableProject(tx, scope.organisationId, command.projectId);
          const actor = await requireActor(tx, scope, now, "retainer:use");
          await requireRetainerOwner(
            tx,
            scope.organisationId,
            command.ownerMembershipId,
            now,
          );
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${command.entitlementId}, 0))`,
          );
          const requestId = deterministicUuid(
            `${COMMERCIAL_RETAINER_MODULE_VERSION}\0${scope.organisationId}\0retainer\0${command.idempotencyDigest}`,
          );
          const [existing] = await tx
            .select()
            .from(workTasks)
            .where(
              and(
                eq(workTasks.id, requestId),
                eq(workTasks.organisationId, scope.organisationId),
              ),
            )
            .limit(1);
          if (existing) {
            if (!existing.title.startsWith(RETAINER_TASK_PREFIX)) {
              throw new CommercialRetainerError("persistence_unavailable");
            }
            const replay = parseRetainer(existing.description, existing);
            if (
              replay.projectId !== command.projectId ||
              replay.entitlementId !== command.entitlementId ||
              replay.purpose !== command.purpose ||
              replay.summary !== command.summary ||
              replay.ownerMembershipId !== command.ownerMembershipId ||
              replay.sla !== command.sla
            ) {
              return { outcome: "state_conflict" };
            }
            return {
              outcome: "updated",
              record: replay,
            };
          }
          const [entitlement] = await tx
            .select()
            .from(entitlements)
            .where(
              and(
                eq(entitlements.id, command.entitlementId),
                eq(entitlements.organisationId, scope.organisationId),
              ),
            )
            .for("update");
          if (!entitlement || !entitlement.orderId) {
            return { outcome: "not_found" };
          }
          const [order] = await tx
            .select({ projectId: orders.projectId })
            .from(orders)
            .where(
              and(
                eq(orders.id, entitlement.orderId),
                eq(orders.organisationId, scope.organisationId),
              ),
            )
            .limit(1);
          if (
            entitlement.productKind !== "evidence_readiness_retainer" ||
            entitlement.status !== "active" ||
            entitlement.paymentState !== "verified_manual" ||
            entitlement.rulesVersion !== COMMERCIAL_RETAINER_MODULE_VERSION ||
            entitlement.startsAt.getTime() > now.getTime() ||
            entitlement.endsAt == null ||
            entitlement.endsAt.getTime() <= now.getTime() ||
            entitlement.usageLimit == null ||
            entitlement.usageConsumed >= entitlement.usageLimit ||
            order?.projectId !== command.projectId
          ) {
            return { outcome: "policy_denied" };
          }
          const dueAt = new Date(
            now.getTime() +
              (command.sla === "priority" ? 48 : 120) * 60 * 60_000,
          );
          const history: RetainerHistoryEntry[] = [
            {
              action: "created",
              actorUserId: scope.actorUserId,
              at: now.toISOString(),
            },
          ];
          const record: RetainerServiceRequest = {
            id: requestId,
            organisationId: scope.organisationId,
            projectId: command.projectId,
            entitlementId: entitlement.id,
            purpose: command.purpose,
            summary: command.summary,
            ownerMembershipId: command.ownerMembershipId,
            sla: command.sla,
            slaPolicyVersion: "valo.retainer-sla@v1",
            dueAt: dueAt.toISOString(),
            status: "open",
            comments: [],
            evidenceReceipts: [],
            history,
            version: 1,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };
          const [updatedEntitlement] = await tx
            .update(entitlements)
            .set({
              usageConsumed: entitlement.usageConsumed + 1,
              version: entitlement.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(entitlements.id, entitlement.id),
                eq(entitlements.version, entitlement.version),
                eq(entitlements.usageConsumed, entitlement.usageConsumed),
              ),
            )
            .returning();
          if (!updatedEntitlement) return { outcome: "version_conflict" };
          await tx.insert(entitlementUsage).values({
            organisationId: scope.organisationId,
            entitlementId: entitlement.id,
            projectId: command.projectId,
            units: 1,
            idempotencyKey: digest([
              COMMERCIAL_RETAINER_MODULE_VERSION,
              entitlement.id,
              command.idempotencyDigest,
            ]),
            actorUserId: scope.actorUserId,
            consumedAt: now,
          });
          const [task] = await tx
            .insert(workTasks)
            .values({
              id: requestId,
              organisationId: scope.organisationId,
              projectId: command.projectId,
              requirementId: null,
              title:
                `${RETAINER_TASK_PREFIX}${entitlement.id}] ${command.summary}`.slice(
                  0,
                  1_024,
                ),
              description: serializeRetainer(record),
              ownerMembershipId: command.ownerMembershipId,
              dueAt,
              priority: command.sla === "priority" ? "high" : "normal",
              status: "open",
              completedAt: null,
              version: 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          if (!task)
            throw new CommercialRetainerError("persistence_unavailable");
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: command.projectId,
            eventType: RETAINER_CREATED_EVENT,
            objectType: "work_task",
            objectId: task.id,
            details: JSON.stringify({
              schemaVersion: RETAINER_ENVELOPE_SCHEMA,
              entitlementId: entitlement.id,
              purpose: command.purpose,
              usageUnits: 1,
              externalMessaging: false,
              autonomousWork: false,
            }),
          });
          return { outcome: "updated", record };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }

  async mutateRetainerRequest(
    scope: CommercialScope,
    requestId: string,
    action: RetainerRequestAction,
  ): Promise<CommercialMutationResult<RetainerServiceRequest>> {
    return withTenantDatabase(scope.organisationId, () =>
      db.transaction(
        async (tx) => {
          const now = this.now();
          const [taskProbe] = await tx
            .select({ projectId: workTasks.projectId })
            .from(workTasks)
            .where(
              and(
                eq(workTasks.id, requestId),
                eq(workTasks.organisationId, scope.organisationId),
                like(workTasks.title, `${RETAINER_TASK_PREFIX}%`),
              ),
            )
            .limit(1);
          if (!taskProbe) return { outcome: "not_found" };
          if (!taskProbe.projectId) return { outcome: "state_conflict" };
          await lockMutableProject(
            tx,
            scope.organisationId,
            taskProbe.projectId,
          );
          const actor = await requireActor(tx, scope, now, "retainer:use");
          const [task] = await tx
            .select()
            .from(workTasks)
            .where(
              and(
                eq(workTasks.id, requestId),
                eq(workTasks.organisationId, scope.organisationId),
                like(workTasks.title, `${RETAINER_TASK_PREFIX}%`),
              ),
            )
            .for("update");
          if (
            !task ||
            task.projectId !== taskProbe.projectId ||
            task.version !== action.expectedVersion
          ) {
            return resultForMiss(task, action.expectedVersion);
          }
          const current = parseRetainer(task.description, task);
          if (
            current.status === "completed" ||
            current.status === "cancelled"
          ) {
            return { outcome: "state_conflict" };
          }
          const history = [...current.history];
          let next: RetainerServiceRequest;
          switch (action.action) {
            case "comment": {
              if (
                current.comments.length >= COMMERCIAL_RETAINER_BOUNDS.comments
              ) {
                return { outcome: "capacity_exceeded" };
              }
              history.push({
                action: "commented",
                actorUserId: scope.actorUserId,
                at: now.toISOString(),
              });
              next = {
                ...current,
                comments: [
                  ...current.comments,
                  {
                    id: randomUUID(),
                    body: action.body,
                    createdByUserId: scope.actorUserId,
                    createdAt: now.toISOString(),
                  },
                ],
                history,
                version: current.version + 1,
                updatedAt: now.toISOString(),
              };
              break;
            }
            case "record_evidence": {
              if (
                current.evidenceReceipts.length >=
                COMMERCIAL_RETAINER_BOUNDS.evidenceReceipts
              )
                return { outcome: "capacity_exceeded" };
              history.push({
                action: "evidence_recorded",
                actorUserId: scope.actorUserId,
                at: now.toISOString(),
              });
              next = {
                ...current,
                evidenceReceipts: [
                  ...current.evidenceReceipts,
                  {
                    id: randomUUID(),
                    reference: action.reference,
                    sha256: action.sha256,
                    recordedByUserId: scope.actorUserId,
                    recordedAt: now.toISOString(),
                  },
                ],
                history,
                version: current.version + 1,
                updatedAt: now.toISOString(),
              };
              break;
            }
            case "reassign": {
              await requireRetainerOwner(
                tx,
                scope.organisationId,
                action.ownerMembershipId,
                now,
              );
              history.push({
                action: "reassigned",
                actorUserId: scope.actorUserId,
                at: now.toISOString(),
                from: current.ownerMembershipId,
                to: action.ownerMembershipId,
              });
              next = {
                ...current,
                ownerMembershipId: action.ownerMembershipId,
                history,
                version: current.version + 1,
                updatedAt: now.toISOString(),
              };
              break;
            }
            case "set_status": {
              const allowed: Record<RetainerStatus, readonly RetainerStatus[]> =
                {
                  open: ["in_progress", "cancelled"],
                  in_progress: ["awaiting_evidence", "completed", "cancelled"],
                  awaiting_evidence: ["in_progress", "completed", "cancelled"],
                  completed: [],
                  cancelled: [],
                };
              if (
                !allowed[current.status].includes(action.status) ||
                (action.status === "completed" &&
                  current.evidenceReceipts.length === 0)
              )
                return { outcome: "state_conflict" };
              history.push({
                action: "status_changed",
                actorUserId: scope.actorUserId,
                at: now.toISOString(),
                from: current.status,
                to: action.status,
              });
              next = {
                ...current,
                status: action.status,
                history,
                version: current.version + 1,
                updatedAt: now.toISOString(),
              };
              break;
            }
          }
          if (next.history.length > COMMERCIAL_RETAINER_BOUNDS.history) {
            return { outcome: "capacity_exceeded" };
          }
          const [updated] = await tx
            .update(workTasks)
            .set({
              description: serializeRetainer(next),
              ownerMembershipId: next.ownerMembershipId,
              status: next.status,
              completedAt: next.status === "completed" ? now : null,
              version: next.version,
              updatedAt: now,
            })
            .where(
              and(
                eq(workTasks.id, task.id),
                eq(workTasks.organisationId, scope.organisationId),
                eq(workTasks.version, task.version),
                like(workTasks.title, `${RETAINER_TASK_PREFIX}%`),
              ),
            )
            .returning();
          if (!updated) return { outcome: "version_conflict" };
          await writeAuditTx(tx, {
            user: actor,
            organisationId: scope.organisationId,
            projectId: task.projectId,
            eventType: RETAINER_MUTATED_EVENT,
            objectType: "work_task",
            objectId: task.id,
            details: JSON.stringify({
              schemaVersion: RETAINER_ENVELOPE_SCHEMA,
              action: action.action,
              sourceVersion: task.version,
              nextVersion: next.version,
              externalMessaging: false,
              autonomousWork: false,
            }),
          });
          return { outcome: "updated", record: next };
        },
        { isolationLevel: "read committed" },
      ),
    );
  }
}

export function createDrizzleCommercialRetainerRepository(input?: {
  now?: () => Date;
}): DrizzleCommercialRetainerRepository {
  return new DrizzleCommercialRetainerRepository(input?.now);
}
