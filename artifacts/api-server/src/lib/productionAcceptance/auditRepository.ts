import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  auditEvents,
  currentTenantDatabaseOrganisation,
  db,
  organisationMemberships,
  roleGrants,
  users,
} from "@workspace/db";
import { writeAuditTx } from "../audit";
import {
  PRODUCTION_ACCEPTANCE_BOUNDS,
  ProductionAcceptanceRepositoryUnavailableError,
  type ProductionAcceptanceAppendResult,
  type ProductionAcceptanceEvidenceRecord,
  type ProductionAcceptanceRepository,
  type ProductionAcceptanceScope,
} from "./contracts";
import { verifyProductionAcceptanceEvidenceDigest } from "./service";

const EVENT_TYPE = "production_acceptance.evidence_recorded" as const;
const OBJECT_TYPE = "production_acceptance.evidence" as const;
const REPOSITORY_SCHEMA = "valo.production-acceptance-repository/v1" as const;
import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "../identifierPatterns";
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const MAX_EVENT_CODE_UNITS = 10_000;
const MAX_EVENT_BYTES = 20_000;
const MAX_SET_BYTES = 4_000_000;
const READ_ROLES = [
  "valo_operations_administrator",
  "restricted_platform_administrator",
  "valo_quality_adviser",
] as const;
const RECORD_ROLES = [
  "valo_operations_administrator",
  "valo_quality_adviser",
] as const;

type AcceptanceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface StoredEvidenceEnvelope {
  schema: typeof REPOSITORY_SCHEMA;
  idempotencyKey: string;
  requestDigest: string;
  record: ProductionAcceptanceEvidenceRecord;
}

function assertScope(scope: ProductionAcceptanceScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
}

import { isPlainRecord as isPlain } from "../typeGuards";

function parseEnvelope(value: string): StoredEvidenceEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  if (
    !isPlain(parsed) ||
    Object.keys(parsed).length !== 4 ||
    !["schema", "idempotencyKey", "requestDigest", "record"].every(
      (key) => key in parsed,
    ) ||
    parsed.schema !== REPOSITORY_SCHEMA ||
    typeof parsed.idempotencyKey !== "string" ||
    !IDEMPOTENCY.test(parsed.idempotencyKey) ||
    typeof parsed.requestDigest !== "string" ||
    !SHA256.test(parsed.requestDigest) ||
    !verifyProductionAcceptanceEvidenceDigest(parsed.record)
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  return parsed as unknown as StoredEvidenceEnvelope;
}

async function loadEnvelopes(
  tx: AcceptanceTx,
  scope: ProductionAcceptanceScope,
  limit: number,
): Promise<StoredEvidenceEnvelope[]> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > PRODUCTION_ACCEPTANCE_BOUNDS.maxEvidenceRecords + 1
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  const metadata = await tx
    .select({
      id: auditEvents.id,
      codeUnits: sql<number>`pg_catalog.char_length(${auditEvents.details})`,
      bytes: sql<number>`pg_catalog.octet_length(${auditEvents.details})`,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, scope.organisationId),
        eq(auditEvents.eventType, EVENT_TYPE),
        eq(auditEvents.objectType, OBJECT_TYPE),
      ),
    )
    .orderBy(asc(auditEvents.seq))
    .limit(limit);
  let totalBytes = 0;
  for (const row of metadata) {
    if (
      !Number.isSafeInteger(row.codeUnits) ||
      !Number.isSafeInteger(row.bytes) ||
      row.codeUnits < 1 ||
      row.codeUnits > MAX_EVENT_CODE_UNITS ||
      row.bytes < 1 ||
      row.bytes > MAX_EVENT_BYTES
    ) {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    }
    totalBytes += row.bytes;
    if (totalBytes > MAX_SET_BYTES) {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    }
  }
  if (metadata.length === 0) return [];
  const rows = await tx
    .select({ id: auditEvents.id, details: auditEvents.details })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, scope.organisationId),
        inArray(
          auditEvents.id,
          metadata.map(({ id }) => id),
        ),
      ),
    )
    .orderBy(asc(auditEvents.seq));
  if (rows.length !== metadata.length) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  const idempotencyKeys = new Set<string>();
  const recordIds = new Set<string>();
  return rows.map(({ details }) => {
    if (!details) throw new ProductionAcceptanceRepositoryUnavailableError();
    const envelope = parseEnvelope(details);
    if (
      envelope.record.organisationId !== scope.organisationId ||
      idempotencyKeys.has(envelope.idempotencyKey) ||
      recordIds.has(envelope.record.id)
    ) {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    }
    idempotencyKeys.add(envelope.idempotencyKey);
    recordIds.add(envelope.record.id);
    return envelope;
  });
}

async function lockRegister(
  tx: AcceptanceTx,
  organisationId: string,
): Promise<void> {
  await tx.execute(sql`
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${`${organisationId}:production-acceptance`}, 0)
    )
  `);
}

function validAuthorityName(value: string | null): value is string {
  return Boolean(
    value &&
    value === value.trim() &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value),
  );
}

async function requireCurrentAuthorities(
  tx: AcceptanceTx,
  organisationId: string,
  userIds: readonly string[],
  roles: readonly string[],
): Promise<Map<string, typeof users.$inferSelect>> {
  const uniqueUserIds = [...new Set(userIds)];
  if (
    uniqueUserIds.length !== userIds.length ||
    uniqueUserIds.some((userId) => !UUID.test(userId))
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  const now = new Date();
  const memberships = await tx
    .select({ membershipId: organisationMemberships.id, user: users })
    .from(organisationMemberships)
    .innerJoin(users, eq(organisationMemberships.userId, users.id))
    .where(
      and(
        eq(organisationMemberships.organisationId, organisationId),
        inArray(organisationMemberships.userId, uniqueUserIds),
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
      ),
    )
    .limit(uniqueUserIds.length + 1);
  if (
    memberships.length !== uniqueUserIds.length ||
    memberships.some(({ user }) => !validAuthorityName(user.name))
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  const grants = await tx
    .select({ membershipId: roleGrants.membershipId })
    .from(roleGrants)
    .where(
      and(
        inArray(
          roleGrants.membershipId,
          memberships.map(({ membershipId }) => membershipId),
        ),
        inArray(roleGrants.role, [...roles]),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit(uniqueUserIds.length * roles.length + 1);
  const authorisedMembershipIds = new Set(
    grants.map(({ membershipId }) => membershipId),
  );
  if (
    memberships.some(
      ({ membershipId }) => !authorisedMembershipIds.has(membershipId),
    )
  ) {
    throw new ProductionAcceptanceRepositoryUnavailableError();
  }
  return new Map(memberships.map(({ user }) => [user.id, user]));
}

/**
 * Append-only production repository over the tenant audit chain. The evidence
 * body contains operational metadata and immutable artefact references only;
 * no backup, restore or deployment operation is represented or callable.
 */
export class AuditProductionAcceptanceRepository implements ProductionAcceptanceRepository {
  async listAuthorities(
    scope: ProductionAcceptanceScope,
    limit: number,
  ): Promise<readonly { userId: string; name: string }[]> {
    assertScope(scope);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > PRODUCTION_ACCEPTANCE_BOUNDS.maxAuthorities + 1
    ) {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    }
    return db.transaction(
      async (tx) => {
        await requireCurrentAuthorities(
          tx,
          scope.organisationId,
          [scope.actorUserId],
          RECORD_ROLES,
        );
        const now = new Date();
        const rawLimit = limit * RECORD_ROLES.length + 1;
        const rows = await tx
          .select({
            userId: users.id,
            name: users.name,
            grantId: roleGrants.id,
          })
          .from(organisationMemberships)
          .innerJoin(users, eq(organisationMemberships.userId, users.id))
          .innerJoin(
            roleGrants,
            eq(roleGrants.membershipId, organisationMemberships.id),
          )
          .where(
            and(
              eq(organisationMemberships.organisationId, scope.organisationId),
              ne(organisationMemberships.userId, scope.actorUserId),
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
              inArray(roleGrants.role, [...RECORD_ROLES]),
              isNull(roleGrants.revokedAt),
              or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
              or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
            ),
          )
          .orderBy(asc(users.name), asc(users.id), asc(roleGrants.id))
          .limit(rawLimit);
        if (rows.length >= rawLimit) {
          throw new ProductionAcceptanceRepositoryUnavailableError();
        }
        const authorities = new Map<string, string>();
        for (const row of rows) {
          if (!validAuthorityName(row.name)) {
            throw new ProductionAcceptanceRepositoryUnavailableError();
          }
          authorities.set(row.userId, row.name);
        }
        if (authorities.size > PRODUCTION_ACCEPTANCE_BOUNDS.maxAuthorities) {
          throw new ProductionAcceptanceRepositoryUnavailableError();
        }
        return [...authorities]
          .slice(0, limit)
          .map(([userId, name]) => ({ userId, name }));
      },
      { isolationLevel: "read committed" },
    );
  }

  async listEvidence(
    scope: ProductionAcceptanceScope,
    limit: number,
  ): Promise<readonly ProductionAcceptanceEvidenceRecord[]> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        await requireCurrentAuthorities(
          tx,
          scope.organisationId,
          [scope.actorUserId],
          READ_ROLES,
        );
        return (await loadEnvelopes(tx, scope, limit)).map(
          ({ record }) => record,
        );
      },
      { isolationLevel: "read committed" },
    );
  }

  async appendEvidence(
    scope: ProductionAcceptanceScope,
    idempotencyKey: string,
    requestDigest: string,
    record: ProductionAcceptanceEvidenceRecord,
  ): Promise<ProductionAcceptanceAppendResult> {
    assertScope(scope);
    if (
      !IDEMPOTENCY.test(idempotencyKey) ||
      !SHA256.test(requestDigest) ||
      !verifyProductionAcceptanceEvidenceDigest(record) ||
      !UUID.test(record.ownerUserId) ||
      record.organisationId !== scope.organisationId ||
      record.verifiedByUserId !== scope.actorUserId
    ) {
      throw new ProductionAcceptanceRepositoryUnavailableError();
    }
    return db.transaction(
      async (tx) => {
        await lockRegister(tx, scope.organisationId);
        const people = await requireCurrentAuthorities(
          tx,
          scope.organisationId,
          [scope.actorUserId, record.ownerUserId],
          RECORD_ROLES,
        );
        const current = await loadEnvelopes(
          tx,
          scope,
          PRODUCTION_ACCEPTANCE_BOUNDS.maxEvidenceRecords + 1,
        );
        const replay = current.find(
          (candidate) => candidate.idempotencyKey === idempotencyKey,
        );
        if (replay) {
          return replay.requestDigest === requestDigest
            ? { outcome: "replayed", record: replay.record }
            : { outcome: "idempotency_conflict" };
        }
        const duplicateEvidence = current.find(
          (candidate) => candidate.record.id === record.id,
        );
        if (duplicateEvidence) {
          return duplicateEvidence.requestDigest === requestDigest
            ? { outcome: "replayed", record: duplicateEvidence.record }
            : { outcome: "idempotency_conflict" };
        }
        if (current.length >= PRODUCTION_ACCEPTANCE_BOUNDS.maxEvidenceRecords) {
          throw new ProductionAcceptanceRepositoryUnavailableError();
        }
        const actor = people.get(scope.actorUserId);
        const owner = people.get(record.ownerUserId);
        if (!actor || !owner) {
          throw new ProductionAcceptanceRepositoryUnavailableError();
        }
        const envelope: StoredEvidenceEnvelope = {
          schema: REPOSITORY_SCHEMA,
          idempotencyKey,
          requestDigest,
          record,
        };
        const details = JSON.stringify(envelope);
        if (
          details.length > MAX_EVENT_CODE_UNITS ||
          Buffer.byteLength(details, "utf8") > MAX_EVENT_BYTES
        ) {
          throw new ProductionAcceptanceRepositoryUnavailableError();
        }
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          eventType: EVENT_TYPE,
          objectType: OBJECT_TYPE,
          objectId: record.id,
          details,
        });
        return { outcome: "appended", record };
      },
      { isolationLevel: "read committed" },
    );
  }
}
