import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  currentTenantDatabaseOrganisation,
  db,
  organisationMemberships,
  organisations,
  partnerRelationships,
  projects,
  users,
  workTasks,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import {
  CONSORTIUM_BOUNDS,
  CONSORTIUM_QA_CODES,
  CONSORTIUM_REASON_CODES,
  type ConsortiumAcceptance,
  type ConsortiumAuditReceipt,
  type ConsortiumParty,
  type ConsortiumParticipantOption,
  type ConsortiumQaDecision,
  type ConsortiumQaItem,
  type ConsortiumResponsibility,
  type ConsortiumScope,
  type PartnerConsortiumRoom,
} from "./contracts";
import { ConsortiumError } from "./errors";
import {
  CONSORTIUM_ENVELOPE_SCHEMA,
  type ConsortiumAuthority,
  type ConsortiumRelationshipAuthority,
  type ConsortiumRepository,
} from "./service";

type ConsortiumDatabase = (typeof import("@workspace/db"))["db"];
type ConsortiumTx = Parameters<
  Parameters<ConsortiumDatabase["transaction"]>[0]
>[0];
type WorkTaskRow = typeof workTasks.$inferSelect;

export const CONSORTIUM_TITLE_PREFIX = "[CONSORTIUM-ROOM:v1:" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ROOM_STATUSES = [
  "draft",
  "active",
  "qa_in_progress",
  "ready_for_client_release",
] as const;
const RESPONSIBILITY_STATUSES = [
  "proposed",
  "changes_requested",
  "active",
] as const;
const RECEIPT_ACTIONS = [
  "room_created",
  "responsibility_added",
  "responsibility_revised",
  "responsibility_decided",
  "qa_prepared",
  "qa_decided",
] as const;

interface PersistedConsortiumEnvelope {
  schema: typeof CONSORTIUM_ENVELOPE_SCHEMA;
  retentionPolicy: {
    class: "project_coordination";
    owner: "client_organisation";
    trigger: "owning_project_retention_policy";
    independentDeletionAllowed: false;
  };
  room: PartnerConsortiumRoom;
}

function denied(message: string): never {
  throw new ConsortiumError("scope_denied", message);
}

function assertScope(scope: ConsortiumScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.projectId) ||
    !UUID_PATTERN.test(scope.relationshipId) ||
    !UUID_PATTERN.test(scope.actorUserId) ||
    !UUID_PATTERN.test(scope.actorMembershipId) ||
    !UUID_PATTERN.test(scope.membershipOrganisationId) ||
    (scope.accessSource !== "membership" && scope.accessSource !== "partner") ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    denied("Consortium room scope denied.");
  }
}

function plain(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

function validParty(value: unknown): value is ConsortiumParty {
  return value === "client" || value === "partner";
}

function validAcceptance(
  value: unknown,
  party: ConsortiumParty,
): value is ConsortiumAcceptance {
  if (value === null) return false;
  const item = plain(value);
  return Boolean(
    item &&
    item.party === party &&
    (item.decision === "accepted" || item.decision === "changes_requested") &&
    (item.reasonCode === null ||
      CONSORTIUM_REASON_CODES.includes(item.reasonCode as never)) &&
    (item.decision === "accepted"
      ? item.reasonCode === null
      : item.reasonCode !== null) &&
    UUID_PATTERN.test(String(item.decidedByUserId)) &&
    validInstant(item.decidedAt),
  );
}

function validResponsibility(
  value: unknown,
): value is ConsortiumResponsibility {
  const item = plain(value);
  const acceptances = plain(item?.acceptances);
  if (
    !item ||
    !UUID_PATTERN.test(String(item.id)) ||
    !Number.isSafeInteger(item.iteration) ||
    Number(item.iteration) < 1 ||
    typeof item.workstreamLabel !== "string" ||
    !item.workstreamLabel.trim() ||
    item.workstreamLabel.length > CONSORTIUM_BOUNDS.workstreamLabel ||
    !validParty(item.responsibleParty) ||
    !validParty(item.accountableParty) ||
    !UUID_PATTERN.test(String(item.ownerUserId)) ||
    (item.dueAt !== null && !validInstant(item.dueAt)) ||
    !RESPONSIBILITY_STATUSES.includes(item.status as never) ||
    item.requiredAcceptance !== "both_parties" ||
    !acceptances ||
    !UUID_PATTERN.test(String(item.createdByUserId)) ||
    !validInstant(item.createdAt) ||
    !UUID_PATTERN.test(String(item.updatedByUserId)) ||
    !validInstant(item.updatedAt)
  ) {
    return false;
  }
  const client =
    acceptances.client === null
      ? null
      : validAcceptance(acceptances.client, "client")
        ? (acceptances.client as unknown as ConsortiumAcceptance)
        : undefined;
  const partner =
    acceptances.partner === null
      ? null
      : validAcceptance(acceptances.partner, "partner")
        ? (acceptances.partner as unknown as ConsortiumAcceptance)
        : undefined;
  if (client === undefined || partner === undefined) return false;
  if (
    client?.decidedByUserId === item.createdByUserId ||
    partner?.decidedByUserId === item.createdByUserId
  ) {
    return false;
  }
  if (
    (item.status === "active") !==
    (client?.decision === "accepted" && partner?.decision === "accepted")
  ) {
    return false;
  }
  if (
    item.status === "changes_requested" &&
    client?.decision !== "changes_requested" &&
    partner?.decision !== "changes_requested"
  ) {
    return false;
  }
  return true;
}

function validQaDecision(value: unknown): value is ConsortiumQaDecision {
  const decision = plain(value);
  return Boolean(
    decision &&
    (decision.decision === "checked" || decision.decision === "rejected") &&
    (decision.reasonCode === null ||
      CONSORTIUM_REASON_CODES.includes(decision.reasonCode as never)) &&
    (decision.decision === "checked"
      ? decision.reasonCode === null
      : decision.reasonCode !== null) &&
    UUID_PATTERN.test(String(decision.decidedByUserId)) &&
    validInstant(decision.decidedAt),
  );
}

function validQaItem(value: unknown): value is ConsortiumQaItem {
  const item = plain(value);
  if (
    !item ||
    !UUID_PATTERN.test(String(item.id)) ||
    !CONSORTIUM_QA_CODES.includes(item.code as never) ||
    typeof item.required !== "boolean" ||
    !validParty(item.preparerParty) ||
    !validParty(item.checkerParty) ||
    item.preparerParty === item.checkerParty ||
    !UUID_PATTERN.test(String(item.ownerUserId)) ||
    (item.status !== "open" &&
      item.status !== "ready_for_check" &&
      item.status !== "checked") ||
    (item.evidenceSha256 !== null &&
      !SHA256_PATTERN.test(String(item.evidenceSha256))) ||
    (item.preparedByUserId !== null &&
      !UUID_PATTERN.test(String(item.preparedByUserId))) ||
    (item.preparedAt !== null && !validInstant(item.preparedAt)) ||
    (item.lastDecision !== null && !validQaDecision(item.lastDecision))
  ) {
    return false;
  }
  if (
    item.status === "open" &&
    (item.evidenceSha256 !== null ||
      item.preparedByUserId !== null ||
      item.preparedAt !== null)
  ) {
    return false;
  }
  if (
    item.status !== "open" &&
    (!item.evidenceSha256 || !item.preparedByUserId || !item.preparedAt)
  ) {
    return false;
  }
  if (item.status !== "open" && item.preparedByUserId !== item.ownerUserId) {
    return false;
  }
  if (
    (item.status === "ready_for_check" && item.lastDecision !== null) ||
    (item.status === "checked" &&
      (item.lastDecision?.decision !== "checked" ||
        item.lastDecision.decidedByUserId === item.preparedByUserId)) ||
    (item.status === "open" && item.lastDecision?.decision === "checked")
  ) {
    return false;
  }
  return true;
}

function derivedRoomStatus(
  room: PartnerConsortiumRoom,
): PartnerConsortiumRoom["status"] {
  if (
    room.responsibilities.length === 0 ||
    room.responsibilities.some(({ status }) => status !== "active")
  ) {
    return "draft";
  }
  const required = room.qaChecklist.filter(({ required }) => required);
  if (
    required.length > 0 &&
    required.every(({ status }) => status === "checked")
  ) {
    return "ready_for_client_release";
  }
  if (required.some(({ status }) => status !== "open")) {
    return "qa_in_progress";
  }
  return "active";
}

function validQaPolicy(room: PartnerConsortiumRoom): boolean {
  return room.qaChecklist.every((item) => {
    if (item.code === "partner_cosign") {
      return (
        item.required === room.coSigningRequired &&
        item.preparerParty === "client" &&
        item.checkerParty === "partner" &&
        item.ownerUserId === room.clientCoordinatorUserId
      );
    }
    return (
      item.required === true &&
      item.preparerParty === "partner" &&
      item.checkerParty === "client" &&
      item.ownerUserId === room.partnerCoordinatorUserId
    );
  });
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validReceiptChain(
  receipts: readonly ConsortiumAuditReceipt[],
  roomVersion: number,
): boolean {
  if (
    receipts.length !== roomVersion ||
    receipts.length < 1 ||
    receipts.length > CONSORTIUM_BOUNDS.receipts
  ) {
    return false;
  }
  let previous: string | null = null;
  for (let index = 0; index < receipts.length; index += 1) {
    const item = receipts[index]!;
    if (
      !UUID_PATTERN.test(item.id) ||
      item.sequence !== index + 1 ||
      !RECEIPT_ACTIONS.includes(item.action) ||
      !UUID_PATTERN.test(item.objectId) ||
      !UUID_PATTERN.test(item.actorUserId) ||
      !validParty(item.actorParty) ||
      item.priorVersion !== index ||
      item.nextVersion !== index + 1 ||
      !SHA256_PATTERN.test(item.factsSha256) ||
      item.previousReceiptSha256 !== previous ||
      !SHA256_PATTERN.test(item.receiptSha256) ||
      !validInstant(item.occurredAt)
    ) {
      return false;
    }
    const expected = digest({
      id: item.id,
      sequence: item.sequence,
      action: item.action,
      objectId: item.objectId,
      actorUserId: item.actorUserId,
      actorParty: item.actorParty,
      priorVersion: item.priorVersion,
      nextVersion: item.nextVersion,
      factsSha256: item.factsSha256,
      previousReceiptSha256: item.previousReceiptSha256,
      occurredAt: item.occurredAt,
    });
    if (expected !== item.receiptSha256) return false;
    previous = item.receiptSha256;
  }
  return true;
}

function assertRoomShape(
  room: PartnerConsortiumRoom,
  scope: ConsortiumScope,
  row: WorkTaskRow,
): void {
  const qaCodes = room.qaChecklist.map(({ code }) => code);
  const matrixLabels = room.responsibilities.map(({ workstreamLabel }) =>
    workstreamLabel.trim().toLocaleLowerCase("en-US"),
  );
  if (
    room.id !== row.id ||
    room.organisationId !== scope.organisationId ||
    room.projectId !== scope.projectId ||
    room.relationshipId !== scope.relationshipId ||
    row.version !== room.version ||
    row.status !== room.status ||
    room.status !== derivedRoomStatus(room) ||
    !UUID_PATTERN.test(room.clientOrganisationId) ||
    room.clientOrganisationId !== scope.organisationId ||
    !UUID_PATTERN.test(room.partnerOrganisationId) ||
    !UUID_PATTERN.test(room.clientCoordinatorUserId) ||
    !UUID_PATTERN.test(room.partnerCoordinatorUserId) ||
    !ROOM_STATUSES.includes(room.status) ||
    !Number.isSafeInteger(room.version) ||
    room.version < 1 ||
    !Array.isArray(room.responsibilities) ||
    room.responsibilities.length > CONSORTIUM_BOUNDS.responsibilities ||
    room.responsibilities.some((item) => !validResponsibility(item)) ||
    new Set(matrixLabels).size !== matrixLabels.length ||
    !Array.isArray(room.qaChecklist) ||
    room.qaChecklist.length !== CONSORTIUM_QA_CODES.length ||
    room.qaChecklist.some((item) => !validQaItem(item)) ||
    new Set(qaCodes).size !== CONSORTIUM_QA_CODES.length ||
    !CONSORTIUM_QA_CODES.every((code) => qaCodes.includes(code)) ||
    !validQaPolicy(room) ||
    !validReceiptChain(room.auditReceipts, room.version) ||
    !SHA256_PATTERN.test(room.idempotencyDigest) ||
    !UUID_PATTERN.test(room.createdByUserId) ||
    !UUID_PATTERN.test(room.updatedByUserId) ||
    !validInstant(room.createdAt) ||
    !validInstant(room.updatedAt) ||
    room.retention?.namespace !== CONSORTIUM_ENVELOPE_SCHEMA ||
    room.retention.class !== "project_coordination" ||
    room.retention.owner !== "client_organisation" ||
    room.retention.trigger !== "owning_project_retention_policy" ||
    room.retention.independentDeletionAllowed !== false ||
    room.authorityBoundaries?.legalAgreementGeneration !== false ||
    room.authorityBoundaries.revenueSettlement !== false ||
    room.authorityBoundaries.messaging !== false ||
    room.authorityBoundaries.crossClientLearning !== false ||
    room.authorityBoundaries.autonomousExternalAction !== false
  ) {
    throw new ConsortiumError(
      "policy_denied",
      "Persisted consortium room failed its closed schema or authority bounds.",
    );
  }
}

function parseEnvelope(
  raw: string | null,
  scope: ConsortiumScope,
  row: WorkTaskRow,
): PartnerConsortiumRoom {
  if (
    !raw ||
    Buffer.byteLength(raw, "utf8") > CONSORTIUM_BOUNDS.envelopeBytes
  ) {
    throw new ConsortiumError(
      "capacity_exceeded",
      "Consortium envelope is unavailable or oversized.",
    );
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new ConsortiumError(
      "policy_denied",
      "Persisted consortium envelope is malformed.",
    );
  }
  const envelope = plain(decoded);
  const retentionPolicy = plain(envelope?.retentionPolicy);
  const room = envelope?.room as PartnerConsortiumRoom | undefined;
  if (
    !envelope ||
    envelope.schema !== CONSORTIUM_ENVELOPE_SCHEMA ||
    !retentionPolicy ||
    retentionPolicy.class !== "project_coordination" ||
    retentionPolicy.owner !== "client_organisation" ||
    retentionPolicy.trigger !== "owning_project_retention_policy" ||
    retentionPolicy.independentDeletionAllowed !== false ||
    !room ||
    typeof room !== "object"
  ) {
    throw new ConsortiumError(
      "policy_denied",
      "Persisted consortium envelope is invalid.",
    );
  }
  assertRoomShape(room, scope, row);
  return structuredClone(room);
}

function serialize(room: PartnerConsortiumRoom): string {
  const envelope: PersistedConsortiumEnvelope = {
    schema: CONSORTIUM_ENVELOPE_SCHEMA,
    retentionPolicy: {
      class: "project_coordination",
      owner: "client_organisation",
      trigger: "owning_project_retention_policy",
      independentDeletionAllowed: false,
    },
    room,
  };
  const encoded = JSON.stringify(envelope);
  if (Buffer.byteLength(encoded, "utf8") > CONSORTIUM_BOUNDS.envelopeBytes) {
    throw new ConsortiumError(
      "capacity_exceeded",
      "Consortium room exceeds its durable envelope bound.",
    );
  }
  return encoded;
}

function storageTitle(scope: ConsortiumScope): string {
  return `${CONSORTIUM_TITLE_PREFIX}${scope.relationshipId}]`;
}

function sameInitialization(
  existing: PartnerConsortiumRoom,
  candidate: PartnerConsortiumRoom,
): boolean {
  return (
    existing.id === candidate.id &&
    existing.organisationId === candidate.organisationId &&
    existing.projectId === candidate.projectId &&
    existing.relationshipId === candidate.relationshipId &&
    existing.idempotencyDigest === candidate.idempotencyDigest &&
    existing.clientCoordinatorUserId === candidate.clientCoordinatorUserId &&
    existing.partnerCoordinatorUserId === candidate.partnerCoordinatorUserId &&
    existing.coSigningRequired === candidate.coSigningRequired
  );
}

function sameReceiptPrefix(
  current: readonly ConsortiumAuditReceipt[],
  next: readonly ConsortiumAuditReceipt[],
): boolean {
  return (
    next.length === current.length + 1 &&
    current.every(
      (receipt, index) =>
        JSON.stringify(receipt) === JSON.stringify(next[index]),
    )
  );
}

async function auditUser(tx: ConsortiumTx, userId: string) {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);
  if (!user) denied("Named consortium actor denied.");
  return user;
}

async function loadRoom(
  tx: ConsortiumTx,
  scope: ConsortiumScope,
  lock = false,
): Promise<{ row: WorkTaskRow; room: PartnerConsortiumRoom }> {
  const query = tx
    .select()
    .from(workTasks)
    .where(
      and(
        eq(workTasks.organisationId, scope.organisationId),
        eq(workTasks.projectId, scope.projectId),
        eq(workTasks.title, storageTitle(scope)),
      ),
    )
    .limit(2);
  const rows = lock ? await query.for("update") : await query;
  if (rows.length !== 1) {
    throw new ConsortiumError("not_found", "Consortium room not found.");
  }
  return {
    row: rows[0]!,
    room: parseEnvelope(rows[0]!.description, scope, rows[0]!),
  };
}

async function lockScope(
  tx: ConsortiumTx,
  scope: ConsortiumScope,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scope.projectId}, 0))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${scope.organisationId}:${scope.projectId}:${scope.relationshipId}:consortium-room`}, 0))`,
  );
}

export class DrizzleConsortiumRepository implements ConsortiumRepository {
  async get(scope: ConsortiumScope): Promise<PartnerConsortiumRoom> {
    assertScope(scope);
    return db.transaction(async (tx) => (await loadRoom(tx, scope)).room, {
      isolationLevel: "read committed",
    });
  }

  async insert(
    scope: ConsortiumScope,
    room: PartnerConsortiumRoom,
  ): Promise<PartnerConsortiumRoom> {
    assertScope(scope);
    if (
      room.organisationId !== scope.organisationId ||
      room.projectId !== scope.projectId ||
      room.relationshipId !== scope.relationshipId ||
      room.version !== 1 ||
      room.auditReceipts.length !== 1 ||
      !UUID_PATTERN.test(room.id)
    ) {
      denied("Consortium room identity denied.");
    }
    return db.transaction(
      async (tx) => {
        await lockScope(tx, scope);
        const existing = await tx
          .select()
          .from(workTasks)
          .where(
            and(
              eq(workTasks.organisationId, scope.organisationId),
              eq(workTasks.projectId, scope.projectId),
              eq(workTasks.title, storageTitle(scope)),
            ),
          )
          .limit(2)
          .for("update");
        if (existing.length > 0) {
          if (existing.length !== 1) {
            throw new ConsortiumError(
              "conflict",
              "Consortium room namespace is ambiguous.",
            );
          }
          const current = parseEnvelope(
            existing[0]!.description,
            scope,
            existing[0]!,
          );
          if (!sameInitialization(current, room)) {
            throw new ConsortiumError(
              "conflict",
              "Room initialization conflicts with the durable room.",
            );
          }
          return current;
        }
        const description = serialize(room);
        const [inserted] = await tx
          .insert(workTasks)
          .values({
            id: room.id,
            organisationId: scope.organisationId,
            projectId: scope.projectId,
            title: storageTitle(scope),
            description,
            dueAt: null,
            priority: "normal",
            status: room.status,
            version: room.version,
            createdAt: new Date(room.createdAt),
            updatedAt: new Date(room.updatedAt),
          })
          .onConflictDoNothing({ target: workTasks.id })
          .returning();
        if (!inserted) {
          throw new ConsortiumError(
            "conflict",
            "Consortium room could not be initialized atomically.",
          );
        }
        const lastReceipt = room.auditReceipts[0]!;
        await writeAuditTx(tx, {
          user: await auditUser(tx, scope.actorUserId),
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          eventType: "consortium_room.room_created",
          objectType: "consortium_room",
          objectId: room.id,
          details: JSON.stringify({
            relationshipId: scope.relationshipId,
            priorVersion: 0,
            nextVersion: 1,
            receiptId: lastReceipt.id,
            receiptSha256: lastReceipt.receiptSha256,
            contentIncluded: false,
            externalActionPerformed: false,
          }),
        });
        return parseEnvelope(inserted.description, scope, inserted);
      },
      { isolationLevel: "read committed" },
    );
  }

  async compareAndSwap(
    scope: ConsortiumScope,
    expectedVersion: number,
    mutate: (
      current: PartnerConsortiumRoom,
    ) => PartnerConsortiumRoom | Promise<PartnerConsortiumRoom>,
  ): Promise<PartnerConsortiumRoom> {
    assertScope(scope);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new ConsortiumError(
        "invalid_request",
        "expectedVersion is invalid.",
      );
    }
    return db.transaction(
      async (tx) => {
        await lockScope(tx, scope);
        const loaded = await loadRoom(tx, scope, true);
        const current = loaded.room;
        if (current.version !== expectedVersion) {
          throw new ConsortiumError(
            "stale_version",
            "Consortium room changed; reload before retrying.",
          );
        }
        const next = await mutate(structuredClone(current));
        if (
          next.id !== current.id ||
          next.organisationId !== current.organisationId ||
          next.projectId !== current.projectId ||
          next.relationshipId !== current.relationshipId ||
          next.clientOrganisationId !== current.clientOrganisationId ||
          next.partnerOrganisationId !== current.partnerOrganisationId ||
          next.clientCoordinatorUserId !== current.clientCoordinatorUserId ||
          next.partnerCoordinatorUserId !== current.partnerCoordinatorUserId ||
          next.coSigningRequired !== current.coSigningRequired ||
          next.idempotencyDigest !== current.idempotencyDigest ||
          next.version !== current.version + 1 ||
          !sameReceiptPrefix(current.auditReceipts, next.auditReceipts)
        ) {
          throw new ConsortiumError(
            "policy_denied",
            "Room identity, version, policy, or receipt invariant failed.",
          );
        }
        const description = serialize(next);
        const [updated] = await tx
          .update(workTasks)
          .set({
            description,
            status: next.status,
            version: next.version,
            updatedAt: new Date(next.updatedAt),
          })
          .where(
            and(
              eq(workTasks.id, current.id),
              eq(workTasks.organisationId, scope.organisationId),
              eq(workTasks.projectId, scope.projectId),
              eq(workTasks.title, storageTitle(scope)),
              eq(workTasks.version, current.version),
            ),
          )
          .returning();
        if (!updated) {
          throw new ConsortiumError(
            "stale_version",
            "Consortium room changed during mutation.",
          );
        }
        const lastReceipt = next.auditReceipts.at(-1)!;
        await writeAuditTx(tx, {
          user: await auditUser(tx, scope.actorUserId),
          organisationId: scope.organisationId,
          projectId: scope.projectId,
          eventType: `consortium_room.${lastReceipt.action}`,
          objectType: "consortium_room_receipt",
          objectId: lastReceipt.id,
          details: JSON.stringify({
            relationshipId: scope.relationshipId,
            action: lastReceipt.action,
            objectId: lastReceipt.objectId,
            priorVersion: lastReceipt.priorVersion,
            nextVersion: lastReceipt.nextVersion,
            receiptSha256: lastReceipt.receiptSha256,
            factsSha256: lastReceipt.factsSha256,
            contentIncluded: false,
            externalActionPerformed: false,
          }),
        });
        return parseEnvelope(updated.description, scope, updated);
      },
      { isolationLevel: "read committed" },
    );
  }
}

function activeWindow(input: {
  status: string;
  startsAt: Date | null;
  expiresAt: Date | null;
}): boolean {
  const now = Date.now();
  return (
    input.status === "active" &&
    (!input.startsAt || input.startsAt.getTime() <= now) &&
    (!input.expiresAt || input.expiresAt.getTime() > now)
  );
}

async function relationshipAuthority(scope: ConsortiumScope): Promise<{
  access: ConsortiumRelationshipAuthority;
  partnerOrganisationId: string;
}> {
  assertScope(scope);
  const rows = await db
    .select({
      relationship: partnerRelationships,
      projectOrganisationId: projects.organisationId,
    })
    .from(partnerRelationships)
    .innerJoin(
      projects,
      and(
        eq(projects.id, scope.projectId),
        eq(projects.organisationId, partnerRelationships.clientOrganisationId),
      ),
    )
    .where(
      and(
        eq(partnerRelationships.id, scope.relationshipId),
        eq(partnerRelationships.clientOrganisationId, scope.organisationId),
        eq(partnerRelationships.status, "active"),
      ),
    )
    .limit(2);
  const row = rows.length === 1 ? rows[0] : null;
  if (
    !row ||
    row.projectOrganisationId !== scope.organisationId ||
    !row.relationship.approvedByMembershipId ||
    row.relationship.clientOwnershipRule !== "client_retained" ||
    !activeWindow({
      status: row.relationship.status,
      startsAt: row.relationship.accessStartsAt,
      expiresAt: row.relationship.accessExpiresAt,
    })
  ) {
    throw new ConsortiumError(
      "relationship_inactive",
      "Active exact partner relationship is required.",
    );
  }
  const directClient =
    scope.accessSource === "membership" &&
    scope.membershipOrganisationId === scope.organisationId &&
    scope.contextPartnerRelationshipId === null;
  const exactPartner =
    scope.accessSource === "partner" &&
    scope.membershipOrganisationId === row.relationship.partnerOrganisationId &&
    scope.contextPartnerRelationshipId === scope.relationshipId;
  if (!directClient && !exactPartner)
    denied("Current access context is not authorised for this relationship.");
  return {
    partnerOrganisationId: row.relationship.partnerOrganisationId,
    access: {
      relationshipId: row.relationship.id,
      clientOrganisationId: row.relationship.clientOrganisationId,
      partnerOrganisationId: row.relationship.partnerOrganisationId,
      relationshipVersion: row.relationship.version,
      coSigningRequired: row.relationship.coSigningRequired,
      qaResponsibilitySha256: row.relationship.qaResponsibility
        ? createHash("sha256")
            .update(row.relationship.qaResponsibility)
            .digest("hex")
        : null,
      actorParty: directClient ? "client" : "partner",
    },
  };
}

async function assertDirectMember(input: {
  organisationId: string;
  userId: string;
  membershipId?: string;
}): Promise<void> {
  const conditions = [
    eq(organisationMemberships.organisationId, input.organisationId),
    eq(organisationMemberships.userId, input.userId),
    eq(organisationMemberships.status, "active"),
    isNull(organisationMemberships.delegatedByMembershipId),
    eq(users.status, "active"),
    eq(organisations.status, "active"),
  ];
  if (input.membershipId) {
    conditions.push(eq(organisationMemberships.id, input.membershipId));
  }
  const rows = await db
    .select({
      accessStartsAt: organisationMemberships.accessStartsAt,
      accessExpiresAt: organisationMemberships.accessExpiresAt,
    })
    .from(organisationMemberships)
    .innerJoin(users, eq(users.id, organisationMemberships.userId))
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMemberships.organisationId),
    )
    .where(and(...conditions))
    .limit(2);
  const membership = rows.length === 1 ? rows[0] : null;
  if (
    !membership ||
    (membership.accessStartsAt &&
      membership.accessStartsAt.getTime() > Date.now()) ||
    (membership.accessExpiresAt &&
      membership.accessExpiresAt.getTime() <= Date.now())
  ) {
    denied("Active direct named membership is required.");
  }
}

function validParticipantName(value: string | null): value is string {
  return Boolean(
    value &&
    value === value.trim() &&
    value.length <= CONSORTIUM_BOUNDS.participantName &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
}

async function currentRelationshipAccess(
  scope: ConsortiumScope,
): Promise<Awaited<ReturnType<typeof relationshipAuthority>>> {
  const relationship = await relationshipAuthority(scope);
  await assertDirectMember({
    organisationId:
      relationship.access.actorParty === "client"
        ? relationship.access.clientOrganisationId
        : relationship.access.partnerOrganisationId,
    userId: scope.actorUserId,
    membershipId: scope.actorMembershipId,
  });
  return relationship;
}

export function createDbConsortiumAuthority(): ConsortiumAuthority {
  return {
    async assertAccess(scope) {
      const relationship = await currentRelationshipAccess(scope);
      return relationship.access;
    },

    async assertPartyParticipant(scope, userId, party) {
      if (!UUID_PATTERN.test(userId)) denied("Named participant denied.");
      const relationship = await relationshipAuthority(scope);
      await assertDirectMember({
        organisationId:
          party === "client"
            ? relationship.access.clientOrganisationId
            : relationship.access.partnerOrganisationId,
        userId,
      });
    },

    async listPartyParticipants(scope, limit) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > CONSORTIUM_BOUNDS.participants + 1
      ) {
        denied("Participant directory bound denied.");
      }
      const relationship = await currentRelationshipAccess(scope);
      const now = new Date();
      const rows = await db
        .select({
          membershipId: organisationMemberships.id,
          organisationId: organisationMemberships.organisationId,
          userId: users.id,
          name: users.name,
        })
        .from(organisationMemberships)
        .innerJoin(users, eq(users.id, organisationMemberships.userId))
        .innerJoin(
          organisations,
          eq(organisations.id, organisationMemberships.organisationId),
        )
        .where(
          and(
            inArray(organisationMemberships.organisationId, [
              relationship.access.clientOrganisationId,
              relationship.access.partnerOrganisationId,
            ]),
            eq(organisationMemberships.status, "active"),
            isNull(organisationMemberships.delegatedByMembershipId),
            or(
              isNull(organisationMemberships.accessStartsAt),
              lte(organisationMemberships.accessStartsAt, now),
            ),
            or(
              isNull(organisationMemberships.accessExpiresAt),
              gt(organisationMemberships.accessExpiresAt, now),
            ),
            eq(users.status, "active"),
            isNotNull(users.name),
            eq(organisations.status, "active"),
          ),
        )
        .orderBy(
          asc(users.name),
          asc(users.id),
          asc(organisationMemberships.organisationId),
          asc(organisationMemberships.id),
        )
        .limit(limit);
      const seen = new Set<string>();
      const participants: ConsortiumParticipantOption[] = [];
      for (const row of rows) {
        const party: ConsortiumParty =
          row.organisationId === relationship.access.clientOrganisationId
            ? "client"
            : "partner";
        const key = `${party}:${row.userId}`;
        if (seen.has(key) || !validParticipantName(row.name)) {
          denied(
            "Participant directory failed its direct named-member policy.",
          );
        }
        seen.add(key);
        participants.push({ userId: row.userId, name: row.name, party });
      }
      return participants;
    },
  };
}
