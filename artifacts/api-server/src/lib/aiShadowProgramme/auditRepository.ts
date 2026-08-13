import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
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
  AI_SHADOW_PROGRAMME_BOUNDS,
  AiShadowProgrammeError,
  type AiShadowCloseDraft,
  type AiShadowMutationResult,
  type AiShadowObservation,
  type AiShadowObservationDraft,
  type AiShadowPlan,
  type AiShadowPlanDraft,
  type AiShadowRepository,
  type AiShadowScope,
} from "./contracts";
import { isAiShadowObservation, isAiShadowPlan } from "./service";

const OBJECT_TYPE = "ai_shadow.plan" as const;
const PLAN_CREATED = "ai_shadow.plan_created" as const;
const OBSERVATION_RECORDED = "ai_shadow.observation_recorded" as const;
const PLAN_CLOSED = "ai_shadow.plan_closed" as const;
const EVENT_SCHEMA = "valo.ai-shadow-audit-event/v1" as const;
import {
  SHA256_HEX_PATTERN as SHA256,
  UUID_PATTERN as UUID,
} from "../identifierPatterns";
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const READ_ROLES = [
  "valo_operations_administrator",
  "valo_quality_adviser",
  "restricted_platform_administrator",
] as const;
const MANAGE_ROLES = [
  "valo_operations_administrator",
  "valo_quality_adviser",
] as const;
const MAX_EVENTS =
  AI_SHADOW_PROGRAMME_BOUNDS.maxPlansPerOrganisation *
    (AI_SHADOW_PROGRAMME_BOUNDS.maxObservationsPerPlan + 2) +
  1;

type ShadowTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface PlanCreatedEnvelope {
  schema: typeof EVENT_SCHEMA;
  kind: "plan_created";
  idempotencyKey: string;
  requestDigest: string;
  plan: AiShadowPlan;
}

interface ObservationEnvelope {
  schema: typeof EVENT_SCHEMA;
  kind: "observation_recorded";
  idempotencyKey: string;
  requestDigest: string;
  observation: AiShadowObservation;
}

interface PlanClosedEnvelope {
  schema: typeof EVENT_SCHEMA;
  kind: "plan_closed";
  expectedVersion: number;
  plan: AiShadowPlan;
}

type Envelope = PlanCreatedEnvelope | ObservationEnvelope | PlanClosedEnvelope;

function fail(message = "AI shadow repository is unavailable"): never {
  throw new AiShadowProgrammeError("repository_unavailable", message);
}

import { isPlainRecord as plain } from "../typeGuards";

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function parseEnvelope(details: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(details);
  } catch {
    return fail();
  }
  if (
    !plain(value) ||
    value.schema !== EVENT_SCHEMA ||
    typeof value.kind !== "string"
  )
    return fail();
  if (value.kind === "plan_created") {
    if (
      !exact(value, [
        "idempotencyKey",
        "kind",
        "plan",
        "requestDigest",
        "schema",
      ]) ||
      typeof value.idempotencyKey !== "string" ||
      !IDEMPOTENCY.test(value.idempotencyKey) ||
      typeof value.requestDigest !== "string" ||
      !SHA256.test(value.requestDigest) ||
      !isAiShadowPlan(value.plan)
    )
      return fail();
    return value as unknown as PlanCreatedEnvelope;
  }
  if (value.kind === "observation_recorded") {
    if (
      !exact(value, [
        "idempotencyKey",
        "kind",
        "observation",
        "requestDigest",
        "schema",
      ]) ||
      typeof value.idempotencyKey !== "string" ||
      !IDEMPOTENCY.test(value.idempotencyKey) ||
      typeof value.requestDigest !== "string" ||
      !SHA256.test(value.requestDigest) ||
      !isAiShadowObservation(value.observation)
    )
      return fail();
    return value as unknown as ObservationEnvelope;
  }
  if (value.kind === "plan_closed") {
    if (
      !exact(value, ["expectedVersion", "kind", "plan", "schema"]) ||
      typeof value.expectedVersion !== "number" ||
      !Number.isSafeInteger(value.expectedVersion) ||
      value.expectedVersion < 1 ||
      !isAiShadowPlan(value.plan) ||
      value.plan.status !== "closed" ||
      value.plan.version !== value.expectedVersion + 1
    )
      return fail();
    return value as unknown as PlanClosedEnvelope;
  }
  return fail();
}

function serialize(envelope: Envelope): string {
  const details = JSON.stringify(envelope);
  if (
    details.length > AI_SHADOW_PROGRAMME_BOUNDS.maxEventCodeUnits ||
    Buffer.byteLength(details, "utf8") >
      AI_SHADOW_PROGRAMME_BOUNDS.maxEventBytes
  )
    return fail();
  return details;
}

function assertScope(scope: AiShadowScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    !scope.actorName ||
    scope.actorName !== scope.actorName.trim() ||
    scope.actorName.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(scope.actorName) ||
    currentTenantDatabaseOrganisation() !== scope.organisationId
  )
    fail();
}

async function requireCurrentEvaluator(
  tx: ShadowTx,
  scope: AiShadowScope,
  manage = false,
): Promise<typeof users.$inferSelect> {
  const now = new Date();
  const memberships = await tx
    .select({ id: organisationMemberships.id, user: users })
    .from(organisationMemberships)
    .innerJoin(users, eq(organisationMemberships.userId, users.id))
    .where(
      and(
        eq(organisationMemberships.organisationId, scope.organisationId),
        eq(organisationMemberships.userId, scope.actorUserId),
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
    .limit(2);
  if (memberships.length !== 1 || memberships[0]?.user.name !== scope.actorName)
    fail();
  const grants = await tx
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.membershipId, memberships[0]!.id),
        inArray(roleGrants.role, [...(manage ? MANAGE_ROLES : READ_ROLES)]),
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.startsAt), lte(roleGrants.startsAt, now)),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, now)),
      ),
    )
    .limit((manage ? MANAGE_ROLES.length : READ_ROLES.length) + 1);
  if (
    grants.length < 1 ||
    grants.length > (manage ? MANAGE_ROLES.length : READ_ROLES.length)
  )
    fail();
  return memberships[0]!.user;
}

async function lock(
  tx: ShadowTx,
  organisationId: string,
  planId = "all",
): Promise<void> {
  await tx.execute(sql`
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${`${organisationId}:ai-shadow:${planId}`}, 0)
    )
  `);
}

async function loadEvents(
  tx: ShadowTx,
  organisationId: string,
  planId?: string,
): Promise<
  Array<{
    id: string;
    eventType: string;
    objectId: string | null;
    envelope: Envelope;
  }>
> {
  const filter = and(
    eq(auditEvents.organisationId, organisationId),
    eq(auditEvents.objectType, OBJECT_TYPE),
    inArray(auditEvents.eventType, [
      PLAN_CREATED,
      OBSERVATION_RECORDED,
      PLAN_CLOSED,
    ]),
    ...(planId ? [eq(auditEvents.objectId, planId)] : []),
  );
  const limit = planId
    ? AI_SHADOW_PROGRAMME_BOUNDS.maxObservationsPerPlan + 3
    : MAX_EVENTS;
  const metadata = await tx
    .select({
      id: auditEvents.id,
      codeUnits: sql<number>`pg_catalog.char_length(${auditEvents.details})`,
      bytes: sql<number>`pg_catalog.octet_length(${auditEvents.details})`,
    })
    .from(auditEvents)
    .where(filter)
    .orderBy(asc(auditEvents.seq))
    .limit(limit);
  let total = 0;
  for (const row of metadata) {
    if (
      !Number.isSafeInteger(row.codeUnits) ||
      !Number.isSafeInteger(row.bytes) ||
      row.codeUnits < 1 ||
      row.codeUnits > AI_SHADOW_PROGRAMME_BOUNDS.maxEventCodeUnits ||
      row.bytes < 1 ||
      row.bytes > AI_SHADOW_PROGRAMME_BOUNDS.maxEventBytes
    )
      fail();
    total += row.bytes;
    if (total > AI_SHADOW_PROGRAMME_BOUNDS.maxEventSetBytes) fail();
  }
  if (metadata.length >= limit) fail();
  if (metadata.length === 0) return [];
  const rows = await tx
    .select({
      id: auditEvents.id,
      eventType: auditEvents.eventType,
      objectId: auditEvents.objectId,
      details: auditEvents.details,
    })
    .from(auditEvents)
    .where(
      and(
        filter,
        inArray(
          auditEvents.id,
          metadata.map(({ id }) => id),
        ),
      ),
    )
    .orderBy(asc(auditEvents.seq));
  if (rows.length !== metadata.length) fail();
  return rows.map((row) => {
    if (!row.details) return fail();
    const envelope = parseEnvelope(row.details);
    if (
      !row.objectId ||
      !UUID.test(row.objectId) ||
      (envelope.kind === "plan_created" && row.eventType !== PLAN_CREATED) ||
      (envelope.kind === "observation_recorded" &&
        row.eventType !== OBSERVATION_RECORDED) ||
      (envelope.kind === "plan_closed" && row.eventType !== PLAN_CLOSED)
    )
      return fail();
    return { ...row, envelope };
  });
}

function reducePlans(
  organisationId: string,
  events: Awaited<ReturnType<typeof loadEvents>>,
): AiShadowPlan[] {
  const plans = new Map<string, AiShadowPlan>();
  for (const event of events) {
    if (event.envelope.kind === "plan_created") {
      const plan = event.envelope.plan;
      if (
        event.objectId !== plan.id ||
        plan.organisationId !== organisationId ||
        plans.has(plan.id)
      )
        fail();
      plans.set(plan.id, plan);
    } else if (event.envelope.kind === "plan_closed") {
      const current = plans.get(event.objectId!);
      const closed = event.envelope.plan;
      if (
        !current ||
        current.status !== "active" ||
        event.envelope.expectedVersion !== current.version ||
        closed.id !== current.id ||
        closed.organisationId !== organisationId
      )
        fail();
      plans.set(closed.id, closed);
    }
  }
  return [...plans.values()];
}

function reduceObservations(
  organisationId: string,
  planId: string,
  events: Awaited<ReturnType<typeof loadEvents>>,
): AiShadowObservation[] {
  const ids = new Set<string>();
  const cases = new Set<string>();
  const idempotency = new Set<string>();
  const results: AiShadowObservation[] = [];
  for (const { objectId, envelope } of events) {
    if (envelope.kind !== "observation_recorded") continue;
    const observation = envelope.observation;
    if (
      objectId !== planId ||
      observation.organisationId !== organisationId ||
      observation.planId !== planId ||
      ids.has(observation.id) ||
      cases.has(observation.caseId) ||
      idempotency.has(envelope.idempotencyKey)
    )
      fail();
    ids.add(observation.id);
    cases.add(observation.caseId);
    idempotency.add(envelope.idempotencyKey);
    results.push(observation);
  }
  if (results.length > AI_SHADOW_PROGRAMME_BOUNDS.maxObservationsPerPlan)
    fail();
  return results;
}

export class AuditAiShadowRepository implements AiShadowRepository {
  async listPlans(scope: AiShadowScope): Promise<AiShadowPlan[]> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        await requireCurrentEvaluator(tx, scope);
        const plans = reducePlans(
          scope.organisationId,
          await loadEvents(tx, scope.organisationId),
        );
        if (plans.length > AI_SHADOW_PROGRAMME_BOUNDS.maxPlansPerOrganisation)
          fail();
        return plans;
      },
      { isolationLevel: "read committed" },
    );
  }

  async listObservations(
    scope: AiShadowScope,
    planId: string,
  ): Promise<AiShadowObservation[]> {
    assertScope(scope);
    if (!UUID.test(planId)) return [];
    return db.transaction(
      async (tx) => {
        await requireCurrentEvaluator(tx, scope);
        return reduceObservations(
          scope.organisationId,
          planId,
          await loadEvents(tx, scope.organisationId, planId),
        );
      },
      { isolationLevel: "read committed" },
    );
  }

  async createPlan(
    scope: AiShadowScope,
    draft: AiShadowPlanDraft,
    requestDigest: string,
    plan: AiShadowPlan,
  ): Promise<AiShadowMutationResult<AiShadowPlan>> {
    assertScope(scope);
    if (
      !SHA256.test(requestDigest) ||
      plan.organisationId !== scope.organisationId
    )
      fail();
    return db.transaction(
      async (tx) => {
        const actor = await requireCurrentEvaluator(tx, scope, true);
        await lock(tx, scope.organisationId);
        const events = await loadEvents(tx, scope.organisationId);
        const created = events.filter(
          ({ envelope }) => envelope.kind === "plan_created",
        );
        const replay = created.find(
          ({ envelope }) =>
            envelope.kind === "plan_created" &&
            envelope.idempotencyKey === draft.idempotencyKey,
        )?.envelope;
        if (replay?.kind === "plan_created")
          return replay.requestDigest === requestDigest
            ? { outcome: "replayed", value: replay.plan }
            : { outcome: "idempotency_conflict" };
        if (
          reducePlans(scope.organisationId, events).length >=
          AI_SHADOW_PROGRAMME_BOUNDS.maxPlansPerOrganisation
        )
          throw new AiShadowProgrammeError(
            "capacity_exceeded",
            "The shadow plan register is full.",
          );
        const envelope: PlanCreatedEnvelope = {
          schema: EVENT_SCHEMA,
          kind: "plan_created",
          idempotencyKey: draft.idempotencyKey,
          requestDigest,
          plan,
        };
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          eventType: PLAN_CREATED,
          objectType: OBJECT_TYPE,
          objectId: plan.id,
          details: serialize(envelope),
        });
        return { outcome: "created", value: plan };
      },
      { isolationLevel: "read committed" },
    );
  }

  async appendObservation(
    scope: AiShadowScope,
    plan: AiShadowPlan,
    draft: AiShadowObservationDraft,
    requestDigest: string,
    observation: AiShadowObservation,
  ): Promise<AiShadowMutationResult<AiShadowObservation>> {
    assertScope(scope);
    if (!SHA256.test(requestDigest) || observation.planId !== plan.id) fail();
    return db.transaction(
      async (tx) => {
        const actor = await requireCurrentEvaluator(tx, scope, true);
        await lock(tx, scope.organisationId, plan.id);
        const events = await loadEvents(tx, scope.organisationId, plan.id);
        const persistedPlan = reducePlans(scope.organisationId, events)[0];
        if (
          !persistedPlan ||
          persistedPlan.status !== "active" ||
          persistedPlan.version !== plan.version
        )
          throw new AiShadowProgrammeError(
            "conflict",
            "The plan changed before the observation was recorded.",
          );
        const replay = events.find(
          ({ envelope }) =>
            envelope.kind === "observation_recorded" &&
            envelope.idempotencyKey === draft.idempotencyKey,
        )?.envelope;
        if (replay?.kind === "observation_recorded")
          return replay.requestDigest === requestDigest
            ? { outcome: "replayed", value: replay.observation }
            : { outcome: "idempotency_conflict" };
        const current = reduceObservations(
          scope.organisationId,
          plan.id,
          events,
        );
        if (current.some(({ caseId }) => caseId === draft.caseId))
          throw new AiShadowProgrammeError(
            "conflict",
            "The case already has an observation.",
          );
        if (current.length >= AI_SHADOW_PROGRAMME_BOUNDS.maxObservationsPerPlan)
          throw new AiShadowProgrammeError(
            "capacity_exceeded",
            "The observation register is full.",
          );
        const envelope: ObservationEnvelope = {
          schema: EVENT_SCHEMA,
          kind: "observation_recorded",
          idempotencyKey: draft.idempotencyKey,
          requestDigest,
          observation,
        };
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          eventType: OBSERVATION_RECORDED,
          objectType: OBJECT_TYPE,
          objectId: plan.id,
          details: serialize(envelope),
        });
        return { outcome: "recorded", value: observation };
      },
      { isolationLevel: "read committed" },
    );
  }

  async closePlan(
    scope: AiShadowScope,
    plan: AiShadowPlan,
    close: AiShadowCloseDraft,
    closedPlan: AiShadowPlan,
  ): Promise<AiShadowMutationResult<AiShadowPlan>> {
    assertScope(scope);
    return db.transaction(
      async (tx) => {
        const actor = await requireCurrentEvaluator(tx, scope, true);
        await lock(tx, scope.organisationId, plan.id);
        const events = await loadEvents(tx, scope.organisationId, plan.id);
        const persistedPlan = reducePlans(scope.organisationId, events)[0];
        if (
          !persistedPlan ||
          persistedPlan.status !== "active" ||
          persistedPlan.version !== close.expectedVersion
        )
          throw new AiShadowProgrammeError(
            "conflict",
            "The plan changed before closure.",
          );
        const currentObservations = reduceObservations(
          scope.organisationId,
          plan.id,
          events,
        );
        if (currentObservations.length !== close.expectedObservationCount)
          throw new AiShadowProgrammeError(
            "conflict",
            "The observation set changed before closure.",
          );
        const envelope: PlanClosedEnvelope = {
          schema: EVENT_SCHEMA,
          kind: "plan_closed",
          expectedVersion: close.expectedVersion,
          plan: closedPlan,
        };
        await writeAuditTx(tx, {
          user: actor,
          organisationId: scope.organisationId,
          eventType: PLAN_CLOSED,
          objectType: OBJECT_TYPE,
          objectId: plan.id,
          details: serialize(envelope),
        });
        return { outcome: "closed", value: closedPlan };
      },
      { isolationLevel: "read committed" },
    );
  }
}
