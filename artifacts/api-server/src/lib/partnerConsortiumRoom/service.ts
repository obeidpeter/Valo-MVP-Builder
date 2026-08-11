import { createHash, randomUUID } from "node:crypto";
import {
  CONSORTIUM_BOUNDS,
  CONSORTIUM_REASON_CODES,
  type ConsortiumAcceptance,
  type ConsortiumAuditAction,
  type ConsortiumAuditReceipt,
  type ConsortiumParty,
  type ConsortiumParticipantDirectory,
  type ConsortiumParticipantOption,
  type ConsortiumQaItem,
  type ConsortiumReasonCode,
  type ConsortiumResponsibility,
  type ConsortiumScope,
  type ConsortiumSnapshot,
  type PartnerConsortiumRoom,
} from "./contracts";
import { ConsortiumError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const CONSORTIUM_ENVELOPE_SCHEMA =
  "valo.partner-consortium-room/v1" as const;

export interface ConsortiumRelationshipAuthority {
  relationshipId: string;
  clientOrganisationId: string;
  partnerOrganisationId: string;
  relationshipVersion: number;
  coSigningRequired: boolean;
  qaResponsibilitySha256: string | null;
  actorParty: ConsortiumParty;
}

export interface ConsortiumAuthority {
  /** Validates the project, active exact relationship and current access context. */
  assertAccess(
    scope: ConsortiumScope,
  ): Promise<ConsortiumRelationshipAuthority>;
  /** Validates an active direct membership in the selected relationship party. */
  assertPartyParticipant(
    scope: ConsortiumScope,
    userId: string,
    party: ConsortiumParty,
  ): Promise<void>;
  /** Lists only bounded, active direct named members of the exact relationship parties. */
  listPartyParticipants(
    scope: ConsortiumScope,
    limit: number,
  ): Promise<readonly ConsortiumParticipantOption[]>;
}

export interface ConsortiumRepository {
  get(scope: ConsortiumScope): Promise<PartnerConsortiumRoom>;
  insert(
    scope: ConsortiumScope,
    room: PartnerConsortiumRoom,
  ): Promise<PartnerConsortiumRoom>;
  compareAndSwap(
    scope: ConsortiumScope,
    expectedVersion: number,
    mutate: (
      current: PartnerConsortiumRoom,
    ) => PartnerConsortiumRoom | Promise<PartnerConsortiumRoom>,
  ): Promise<PartnerConsortiumRoom>;
}

export interface PartnerConsortiumRoomServiceOptions {
  repository: ConsortiumRepository;
  authority: ConsortiumAuthority;
  now?: () => Date;
  idFactory?: () => string;
}

function invalid(message: string): never {
  throw new ConsortiumError("invalid_request", message);
}

function object(
  value: unknown,
  label = "Request body",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    invalid("Request body contains missing or unsupported fields.");
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${label} must be text.`);
  const candidate = value.trim();
  if (
    !candidate ||
    candidate.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(candidate)
  ) {
    invalid(`${label} is empty or exceeds its safe bound.`);
  }
  return candidate;
}

function uuid(value: unknown, label: string): string {
  const candidate = text(value, label, 64);
  if (!UUID_PATTERN.test(candidate)) invalid(`${label} is invalid.`);
  return candidate.toLowerCase();
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid("expectedVersion must be a positive integer.");
  }
  return Number(value);
}

function party(value: unknown, label: string): ConsortiumParty {
  if (value !== "client" && value !== "partner") {
    invalid(`${label} must be client or partner.`);
  }
  return value;
}

function reasonCode(
  value: unknown,
  required: boolean,
): ConsortiumReasonCode | null {
  if (value === undefined || value === null) {
    if (required) invalid("reasonCode is required for a rejected decision.");
    return null;
  }
  if (!CONSORTIUM_REASON_CODES.includes(value as ConsortiumReasonCode)) {
    invalid("reasonCode is not supported.");
  }
  return value as ConsortiumReasonCode;
}

function dateTime(value: unknown, now: Date): string | null {
  if (value === undefined || value === null) return null;
  const candidate = text(value, "dueAt", 64);
  const parsed = Date.parse(candidate);
  if (
    !Number.isFinite(parsed) ||
    parsed <= now.getTime() ||
    parsed > now.getTime() + CONSORTIUM_BOUNDS.maximumDueDays * DAY_MS
  ) {
    invalid("dueAt must be within the next 366 days.");
  }
  return new Date(parsed).toISOString();
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(seed).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function roomStatus(
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
  if (required.some(({ status }) => status !== "open")) return "qa_in_progress";
  return "active";
}

function receipt(
  room: PartnerConsortiumRoom,
  input: {
    action: ConsortiumAuditAction;
    objectId: string;
    actorUserId: string;
    actorParty: ConsortiumParty;
    occurredAt: string;
    facts: Record<string, unknown>;
    nextVersion: number;
  },
): ConsortiumAuditReceipt {
  if (room.auditReceipts.length >= CONSORTIUM_BOUNDS.receipts) {
    throw new ConsortiumError(
      "capacity_exceeded",
      "Consortium audit receipt limit reached.",
    );
  }
  const sequence = room.auditReceipts.length + 1;
  const previousReceiptSha256 =
    room.auditReceipts.at(-1)?.receiptSha256 ?? null;
  const factsSha256 = digest(input.facts);
  const id = deterministicUuid(
    `${CONSORTIUM_ENVELOPE_SCHEMA}\0receipt\0${room.id}\0${sequence}`,
  );
  const receiptSha256 = digest({
    id,
    sequence,
    action: input.action,
    objectId: input.objectId,
    actorUserId: input.actorUserId,
    actorParty: input.actorParty,
    priorVersion: room.version,
    nextVersion: input.nextVersion,
    factsSha256,
    previousReceiptSha256,
    occurredAt: input.occurredAt,
  });
  return {
    id,
    sequence,
    action: input.action,
    objectId: input.objectId,
    actorUserId: input.actorUserId,
    actorParty: input.actorParty,
    priorVersion: room.version,
    nextVersion: input.nextVersion,
    factsSha256,
    previousReceiptSha256,
    receiptSha256,
    occurredAt: input.occurredAt,
  };
}

function sameReceiptPrefix(
  before: readonly ConsortiumAuditReceipt[],
  after: readonly ConsortiumAuditReceipt[],
): boolean {
  return (
    after.length === before.length + 1 &&
    before.every(
      (item, index) => JSON.stringify(item) === JSON.stringify(after[index]),
    )
  );
}

function qaChecklist(input: {
  roomId: string;
  clientCoordinatorUserId: string;
  partnerCoordinatorUserId: string;
  coSigningRequired: boolean;
}): ConsortiumQaItem[] {
  const item = (
    code: ConsortiumQaItem["code"],
    preparerParty: ConsortiumParty,
    checkerParty: ConsortiumParty,
    ownerUserId: string,
    required = true,
  ): ConsortiumQaItem => ({
    id: deterministicUuid(
      `${CONSORTIUM_ENVELOPE_SCHEMA}\0qa\0${input.roomId}\0${code}`,
    ),
    code,
    required,
    preparerParty,
    checkerParty,
    ownerUserId,
    status: "open",
    evidenceSha256: null,
    preparedByUserId: null,
    preparedAt: null,
    lastDecision: null,
  });
  return [
    item(
      "evidence_quality_review",
      "partner",
      "client",
      input.partnerCoordinatorUserId,
    ),
    item(
      "requirement_coverage_review",
      "partner",
      "client",
      input.partnerCoordinatorUserId,
    ),
    item(
      "client_release_readiness",
      "partner",
      "client",
      input.partnerCoordinatorUserId,
    ),
    item(
      "partner_cosign",
      "client",
      "partner",
      input.clientCoordinatorUserId,
      input.coSigningRequired,
    ),
  ];
}

export class InMemoryConsortiumRepository implements ConsortiumRepository {
  readonly #rooms = new Map<string, PartnerConsortiumRoom>();
  readonly #locks = new Map<string, Promise<void>>();

  #key(scope: ConsortiumScope): string {
    return `${scope.organisationId}\0${scope.projectId}\0${scope.relationshipId}`;
  }

  async #locked<T>(scope: ConsortiumScope, work: () => Promise<T>): Promise<T> {
    const key = this.#key(scope);
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#locks.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#locks.get(key) === current) this.#locks.delete(key);
    }
  }

  async get(scope: ConsortiumScope): Promise<PartnerConsortiumRoom> {
    const room = this.#rooms.get(this.#key(scope));
    if (!room)
      throw new ConsortiumError("not_found", "Consortium room not found.");
    return clone(room);
  }

  async insert(
    scope: ConsortiumScope,
    room: PartnerConsortiumRoom,
  ): Promise<PartnerConsortiumRoom> {
    return this.#locked(scope, async () => {
      const key = this.#key(scope);
      const existing = this.#rooms.get(key);
      if (existing) {
        if (
          existing.idempotencyDigest !== room.idempotencyDigest ||
          existing.clientCoordinatorUserId !== room.clientCoordinatorUserId ||
          existing.partnerCoordinatorUserId !== room.partnerCoordinatorUserId ||
          existing.coSigningRequired !== room.coSigningRequired
        ) {
          throw new ConsortiumError(
            "conflict",
            "Room initialization conflicts with the existing room.",
          );
        }
        return clone(existing);
      }
      this.#rooms.set(key, clone(room));
      return clone(room);
    });
  }

  async compareAndSwap(
    scope: ConsortiumScope,
    expectedVersion: number,
    mutate: (
      current: PartnerConsortiumRoom,
    ) => PartnerConsortiumRoom | Promise<PartnerConsortiumRoom>,
  ): Promise<PartnerConsortiumRoom> {
    return this.#locked(scope, async () => {
      const key = this.#key(scope);
      const current = this.#rooms.get(key);
      if (!current)
        throw new ConsortiumError("not_found", "Consortium room not found.");
      if (current.version !== expectedVersion) {
        throw new ConsortiumError(
          "stale_version",
          "Consortium room changed; reload before retrying.",
        );
      }
      const next = await mutate(clone(current));
      if (
        next.id !== current.id ||
        next.organisationId !== current.organisationId ||
        next.projectId !== current.projectId ||
        next.relationshipId !== current.relationshipId ||
        next.version !== current.version + 1 ||
        !sameReceiptPrefix(current.auditReceipts, next.auditReceipts)
      ) {
        throw new ConsortiumError(
          "policy_denied",
          "Room identity, version, or receipt invariant failed.",
        );
      }
      this.#rooms.set(key, clone(next));
      return clone(next);
    });
  }
}

export class PartnerConsortiumRoomService {
  readonly #repository: ConsortiumRepository;
  readonly #authority: ConsortiumAuthority;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: PartnerConsortiumRoomServiceOptions) {
    this.#repository = options.repository;
    this.#authority = options.authority;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.idFactory ?? randomUUID;
  }

  async #access(
    scope: ConsortiumScope,
  ): Promise<ConsortiumRelationshipAuthority> {
    uuid(scope.organisationId, "organisationId");
    uuid(scope.projectId, "projectId");
    uuid(scope.relationshipId, "relationshipId");
    uuid(scope.actorUserId, "actorUserId");
    uuid(scope.actorMembershipId, "actorMembershipId");
    uuid(scope.membershipOrganisationId, "membershipOrganisationId");
    const access = await this.#authority.assertAccess(scope);
    if (
      access.relationshipId !== scope.relationshipId ||
      access.clientOrganisationId !== scope.organisationId
    ) {
      throw new ConsortiumError(
        "scope_denied",
        "Exact relationship scope denied.",
      );
    }
    return access;
  }

  #assertRoom(
    room: PartnerConsortiumRoom,
    scope: ConsortiumScope,
    access: ConsortiumRelationshipAuthority,
  ): void {
    if (
      room.organisationId !== scope.organisationId ||
      room.projectId !== scope.projectId ||
      room.relationshipId !== scope.relationshipId ||
      room.clientOrganisationId !== access.clientOrganisationId ||
      room.partnerOrganisationId !== access.partnerOrganisationId ||
      room.coSigningRequired !== access.coSigningRequired
    ) {
      throw new ConsortiumError(
        "policy_denied",
        "Room relationship policy no longer matches authority.",
      );
    }
  }

  async snapshot(scope: ConsortiumScope): Promise<ConsortiumSnapshot> {
    const access = await this.#access(scope);
    const room = await this.#repository.get(scope);
    this.#assertRoom(room, scope, access);
    return {
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      relationshipId: scope.relationshipId,
      actorParty: access.actorParty,
      room,
      relationship: {
        version: access.relationshipVersion,
        coSigningRequired: access.coSigningRequired,
        qaResponsibilitySha256: access.qaResponsibilitySha256,
      },
    };
  }

  async participants(
    scope: ConsortiumScope,
  ): Promise<ConsortiumParticipantDirectory> {
    await this.#access(scope);
    const listed = await this.#authority.listPartyParticipants(
      scope,
      CONSORTIUM_BOUNDS.participants + 1,
    );
    if (listed.length > CONSORTIUM_BOUNDS.participants) {
      throw new ConsortiumError(
        "capacity_exceeded",
        "Consortium participant directory exceeds its safe bound.",
      );
    }
    const seen = new Set<string>();
    const items = listed.map((item) => {
      const userId = uuid(item.userId, "participant.userId");
      const name = text(
        item.name,
        "participant.name",
        CONSORTIUM_BOUNDS.participantName,
      );
      if (item.party !== "client" && item.party !== "partner") {
        throw new ConsortiumError(
          "policy_denied",
          "Consortium participant party is invalid.",
        );
      }
      const key = `${item.party}:${userId}`;
      if (seen.has(key)) {
        throw new ConsortiumError(
          "policy_denied",
          "Consortium participant directory contains duplicates.",
        );
      }
      seen.add(key);
      return { userId, name, party: item.party };
    });
    return {
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      relationshipId: scope.relationshipId,
      items,
      limit: CONSORTIUM_BOUNDS.participants,
      truncated: false,
    };
  }

  async initialize(
    scope: ConsortiumScope,
    value: unknown,
  ): Promise<PartnerConsortiumRoom> {
    const access = await this.#access(scope);
    const body = object(value);
    exactKeys(body, [
      "idempotencyKey",
      "clientCoordinatorUserId",
      "partnerCoordinatorUserId",
    ]);
    const idempotencyKey = text(
      body.idempotencyKey,
      "idempotencyKey",
      CONSORTIUM_BOUNDS.idempotencyKey,
    );
    const clientCoordinatorUserId = uuid(
      body.clientCoordinatorUserId,
      "clientCoordinatorUserId",
    );
    const partnerCoordinatorUserId = uuid(
      body.partnerCoordinatorUserId,
      "partnerCoordinatorUserId",
    );
    await this.#authority.assertPartyParticipant(
      scope,
      clientCoordinatorUserId,
      "client",
    );
    await this.#authority.assertPartyParticipant(
      scope,
      partnerCoordinatorUserId,
      "partner",
    );
    const now = this.#now().toISOString();
    const roomId = deterministicUuid(
      `${CONSORTIUM_ENVELOPE_SCHEMA}\0room\0${scope.organisationId}\0${scope.projectId}\0${scope.relationshipId}`,
    );
    const base: PartnerConsortiumRoom = {
      id: roomId,
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      relationshipId: scope.relationshipId,
      clientOrganisationId: access.clientOrganisationId,
      partnerOrganisationId: access.partnerOrganisationId,
      clientCoordinatorUserId,
      partnerCoordinatorUserId,
      coSigningRequired: access.coSigningRequired,
      status: "draft",
      version: 1,
      responsibilities: [],
      qaChecklist: qaChecklist({
        roomId,
        clientCoordinatorUserId,
        partnerCoordinatorUserId,
        coSigningRequired: access.coSigningRequired,
      }),
      auditReceipts: [],
      idempotencyDigest: digest(idempotencyKey),
      createdByUserId: scope.actorUserId,
      updatedByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now,
      retention: {
        namespace: CONSORTIUM_ENVELOPE_SCHEMA,
        class: "project_coordination",
        owner: "client_organisation",
        trigger: "owning_project_retention_policy",
        independentDeletionAllowed: false,
      },
      authorityBoundaries: {
        legalAgreementGeneration: false,
        revenueSettlement: false,
        messaging: false,
        crossClientLearning: false,
        autonomousExternalAction: false,
      },
    };
    base.auditReceipts.push(
      receipt(
        { ...base, version: 0 },
        {
          action: "room_created",
          objectId: roomId,
          actorUserId: scope.actorUserId,
          actorParty: access.actorParty,
          occurredAt: now,
          nextVersion: 1,
          facts: {
            relationshipId: scope.relationshipId,
            clientCoordinatorUserId,
            partnerCoordinatorUserId,
            coSigningRequired: access.coSigningRequired,
          },
        },
      ),
    );
    return this.#repository.insert(scope, base);
  }

  async addResponsibility(
    scope: ConsortiumScope,
    value: unknown,
  ): Promise<PartnerConsortiumRoom> {
    const access = await this.#access(scope);
    const nowDate = this.#now();
    const body = object(value);
    exactKeys(
      body,
      [
        "expectedVersion",
        "workstreamLabel",
        "responsibleParty",
        "accountableParty",
        "ownerUserId",
      ],
      ["dueAt"],
    );
    const expectedVersion = version(body.expectedVersion);
    const responsibleParty = party(body.responsibleParty, "responsibleParty");
    const accountableParty = party(body.accountableParty, "accountableParty");
    const ownerUserId = uuid(body.ownerUserId, "ownerUserId");
    await this.#authority.assertPartyParticipant(
      scope,
      ownerUserId,
      responsibleParty,
    );
    const workstreamLabel = text(
      body.workstreamLabel,
      "workstreamLabel",
      CONSORTIUM_BOUNDS.workstreamLabel,
    );
    const dueAt = dateTime(body.dueAt, nowDate);
    return this.#repository.compareAndSwap(
      scope,
      expectedVersion,
      (current) => {
        this.#assertRoom(current, scope, access);
        if (
          current.responsibilities.length >= CONSORTIUM_BOUNDS.responsibilities
        ) {
          throw new ConsortiumError(
            "capacity_exceeded",
            "Responsibility matrix limit reached.",
          );
        }
        if (
          current.responsibilities.some(
            (item) =>
              item.workstreamLabel.toLocaleLowerCase("en-US") ===
              workstreamLabel.toLocaleLowerCase("en-US"),
          )
        ) {
          throw new ConsortiumError(
            "conflict",
            "Responsibility workstream already exists.",
          );
        }
        const at = nowDate.toISOString();
        const responsibility: ConsortiumResponsibility = {
          id: uuid(this.#id(), "generated responsibilityId"),
          iteration: 1,
          workstreamLabel,
          responsibleParty,
          accountableParty,
          ownerUserId,
          dueAt,
          status: "proposed",
          requiredAcceptance: "both_parties",
          acceptances: { client: null, partner: null },
          createdByUserId: scope.actorUserId,
          createdAt: at,
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        const nextVersion = current.version + 1;
        const next = {
          ...current,
          version: nextVersion,
          responsibilities: [...current.responsibilities, responsibility],
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        next.status = roomStatus(next);
        next.auditReceipts = [
          ...current.auditReceipts,
          receipt(current, {
            action: "responsibility_added",
            objectId: responsibility.id,
            actorUserId: scope.actorUserId,
            actorParty: access.actorParty,
            occurredAt: at,
            nextVersion,
            facts: {
              responsibilityId: responsibility.id,
              responsibleParty,
              accountableParty,
              ownerUserId,
              dueAtSha256: dueAt ? digest(dueAt) : null,
            },
          }),
        ];
        return next;
      },
    );
  }

  async reviseResponsibility(
    scope: ConsortiumScope,
    responsibilityIdValue: string,
    value: unknown,
  ): Promise<PartnerConsortiumRoom> {
    const access = await this.#access(scope);
    const responsibilityId = uuid(responsibilityIdValue, "responsibilityId");
    const nowDate = this.#now();
    const body = object(value);
    exactKeys(
      body,
      [
        "expectedVersion",
        "workstreamLabel",
        "responsibleParty",
        "accountableParty",
        "ownerUserId",
      ],
      ["dueAt"],
    );
    const expectedVersion = version(body.expectedVersion);
    const responsibleParty = party(body.responsibleParty, "responsibleParty");
    const accountableParty = party(body.accountableParty, "accountableParty");
    const ownerUserId = uuid(body.ownerUserId, "ownerUserId");
    const workstreamLabel = text(
      body.workstreamLabel,
      "workstreamLabel",
      CONSORTIUM_BOUNDS.workstreamLabel,
    );
    const dueAt = dateTime(body.dueAt, nowDate);
    await this.#authority.assertPartyParticipant(
      scope,
      ownerUserId,
      responsibleParty,
    );
    return this.#repository.compareAndSwap(
      scope,
      expectedVersion,
      (current) => {
        this.#assertRoom(current, scope, access);
        const index = current.responsibilities.findIndex(
          ({ id }) => id === responsibilityId,
        );
        const existing = current.responsibilities[index];
        if (!existing)
          throw new ConsortiumError("not_found", "Responsibility not found.");
        if (existing.status === "active") {
          throw new ConsortiumError(
            "policy_denied",
            "An accepted responsibility is immutable.",
          );
        }
        if (
          access.actorParty !== existing.responsibleParty &&
          access.actorParty !== existing.accountableParty
        ) {
          throw new ConsortiumError(
            "policy_denied",
            "Only an assigned party may revise this responsibility.",
          );
        }
        if (
          current.responsibilities.some(
            (item) =>
              item.id !== existing.id &&
              item.workstreamLabel.toLocaleLowerCase("en-US") ===
                workstreamLabel.toLocaleLowerCase("en-US"),
          )
        ) {
          throw new ConsortiumError(
            "conflict",
            "Responsibility workstream already exists.",
          );
        }
        const at = nowDate.toISOString();
        const revised: ConsortiumResponsibility = {
          ...existing,
          iteration: existing.iteration + 1,
          workstreamLabel,
          responsibleParty,
          accountableParty,
          ownerUserId,
          dueAt,
          status: "proposed",
          acceptances: { client: null, partner: null },
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        const responsibilities = [...current.responsibilities];
        responsibilities[index] = revised;
        const nextVersion = current.version + 1;
        const next = {
          ...current,
          version: nextVersion,
          responsibilities,
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        next.status = roomStatus(next);
        next.auditReceipts = [
          ...current.auditReceipts,
          receipt(current, {
            action: "responsibility_revised",
            objectId: existing.id,
            actorUserId: scope.actorUserId,
            actorParty: access.actorParty,
            occurredAt: at,
            nextVersion,
            facts: {
              responsibilityId: existing.id,
              iteration: revised.iteration,
              responsibleParty,
              accountableParty,
              ownerUserId,
            },
          }),
        ];
        return next;
      },
    );
  }

  async decideResponsibility(
    scope: ConsortiumScope,
    responsibilityIdValue: string,
    value: unknown,
  ): Promise<PartnerConsortiumRoom> {
    const access = await this.#access(scope);
    const responsibilityId = uuid(responsibilityIdValue, "responsibilityId");
    const body = object(value);
    exactKeys(body, ["expectedVersion", "decision"], ["reasonCode"]);
    const expectedVersion = version(body.expectedVersion);
    if (body.decision !== "accepted" && body.decision !== "changes_requested") {
      invalid("decision must be accepted or changes_requested.");
    }
    const decision = body.decision;
    const reason = reasonCode(
      body.reasonCode,
      decision === "changes_requested",
    );
    if (decision === "accepted" && reason !== null) {
      invalid("Accepted decisions cannot include a reasonCode.");
    }
    return this.#repository.compareAndSwap(
      scope,
      expectedVersion,
      (current) => {
        this.#assertRoom(current, scope, access);
        const index = current.responsibilities.findIndex(
          ({ id }) => id === responsibilityId,
        );
        const existing = current.responsibilities[index];
        if (!existing)
          throw new ConsortiumError("not_found", "Responsibility not found.");
        if (existing.status !== "proposed") {
          throw new ConsortiumError(
            "policy_denied",
            "Responsibility must be revised before another decision.",
          );
        }
        if (existing.createdByUserId === scope.actorUserId) {
          throw new ConsortiumError(
            "policy_denied",
            "Maker cannot check their own responsibility.",
          );
        }
        if (existing.acceptances[access.actorParty]) {
          throw new ConsortiumError(
            "conflict",
            "This party has already decided the current iteration.",
          );
        }
        const at = this.#now().toISOString();
        const acceptance: ConsortiumAcceptance = {
          party: access.actorParty,
          decision,
          reasonCode: reason,
          decidedByUserId: scope.actorUserId,
          decidedAt: at,
        };
        const acceptances = {
          ...existing.acceptances,
          [access.actorParty]: acceptance,
        };
        const status: ConsortiumResponsibility["status"] =
          decision === "changes_requested"
            ? "changes_requested"
            : acceptances.client?.decision === "accepted" &&
                acceptances.partner?.decision === "accepted"
              ? "active"
              : "proposed";
        const decided: ConsortiumResponsibility = {
          ...existing,
          acceptances,
          status,
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        const responsibilities = [...current.responsibilities];
        responsibilities[index] = decided;
        const nextVersion = current.version + 1;
        const next = {
          ...current,
          version: nextVersion,
          responsibilities,
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        next.status = roomStatus(next);
        next.auditReceipts = [
          ...current.auditReceipts,
          receipt(current, {
            action: "responsibility_decided",
            objectId: existing.id,
            actorUserId: scope.actorUserId,
            actorParty: access.actorParty,
            occurredAt: at,
            nextVersion,
            facts: {
              responsibilityId: existing.id,
              iteration: existing.iteration,
              party: access.actorParty,
              decision,
              reasonCode: reason,
            },
          }),
        ];
        return next;
      },
    );
  }

  async prepareQa(
    scope: ConsortiumScope,
    qaItemIdValue: string,
    value: unknown,
  ): Promise<PartnerConsortiumRoom> {
    const access = await this.#access(scope);
    const qaItemId = uuid(qaItemIdValue, "qaItemId");
    const body = object(value);
    exactKeys(body, ["expectedVersion", "evidenceSha256"]);
    const expectedVersion = version(body.expectedVersion);
    const evidenceSha256 = sha256(body.evidenceSha256, "evidenceSha256");
    return this.#repository.compareAndSwap(
      scope,
      expectedVersion,
      (current) => {
        this.#assertRoom(current, scope, access);
        if (
          current.responsibilities.length === 0 ||
          current.responsibilities.some(({ status }) => status !== "active")
        ) {
          throw new ConsortiumError(
            "policy_denied",
            "Both parties must accept every responsibility before QA.",
          );
        }
        const index = current.qaChecklist.findIndex(
          ({ id }) => id === qaItemId,
        );
        const existing = current.qaChecklist[index];
        if (!existing || !existing.required) {
          throw new ConsortiumError("not_found", "Required QA item not found.");
        }
        if (
          existing.status !== "open" ||
          existing.preparerParty !== access.actorParty ||
          existing.ownerUserId !== scope.actorUserId
        ) {
          throw new ConsortiumError(
            "policy_denied",
            "Only the named preparer may ready this QA item.",
          );
        }
        const at = this.#now().toISOString();
        const prepared: ConsortiumQaItem = {
          ...existing,
          status: "ready_for_check",
          evidenceSha256,
          preparedByUserId: scope.actorUserId,
          preparedAt: at,
          lastDecision: null,
        };
        const qaChecklist = [...current.qaChecklist];
        qaChecklist[index] = prepared;
        const nextVersion = current.version + 1;
        const next = {
          ...current,
          version: nextVersion,
          qaChecklist,
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        next.status = roomStatus(next);
        next.auditReceipts = [
          ...current.auditReceipts,
          receipt(current, {
            action: "qa_prepared",
            objectId: existing.id,
            actorUserId: scope.actorUserId,
            actorParty: access.actorParty,
            occurredAt: at,
            nextVersion,
            facts: {
              qaItemId: existing.id,
              code: existing.code,
              evidenceSha256,
            },
          }),
        ];
        return next;
      },
    );
  }

  async decideQa(
    scope: ConsortiumScope,
    qaItemIdValue: string,
    value: unknown,
  ): Promise<PartnerConsortiumRoom> {
    const access = await this.#access(scope);
    const qaItemId = uuid(qaItemIdValue, "qaItemId");
    const body = object(value);
    exactKeys(body, ["expectedVersion", "decision"], ["reasonCode"]);
    const expectedVersion = version(body.expectedVersion);
    if (body.decision !== "checked" && body.decision !== "rejected") {
      invalid("decision must be checked or rejected.");
    }
    const decision = body.decision;
    const reason = reasonCode(body.reasonCode, decision === "rejected");
    if (decision === "checked" && reason !== null) {
      invalid("Checked decisions cannot include a reasonCode.");
    }
    return this.#repository.compareAndSwap(
      scope,
      expectedVersion,
      (current) => {
        this.#assertRoom(current, scope, access);
        const index = current.qaChecklist.findIndex(
          ({ id }) => id === qaItemId,
        );
        const existing = current.qaChecklist[index];
        if (
          !existing ||
          !existing.required ||
          existing.status !== "ready_for_check" ||
          existing.checkerParty !== access.actorParty ||
          !existing.preparedByUserId ||
          existing.preparedByUserId === scope.actorUserId
        ) {
          throw new ConsortiumError(
            "policy_denied",
            "Independent QA checker authority denied.",
          );
        }
        const at = this.#now().toISOString();
        const decided: ConsortiumQaItem = {
          ...existing,
          status: decision === "checked" ? "checked" : "open",
          evidenceSha256:
            decision === "checked" ? existing.evidenceSha256 : null,
          preparedByUserId:
            decision === "checked" ? existing.preparedByUserId : null,
          preparedAt: decision === "checked" ? existing.preparedAt : null,
          lastDecision: {
            decision,
            reasonCode: reason,
            decidedByUserId: scope.actorUserId,
            decidedAt: at,
          },
        };
        const qaChecklist = [...current.qaChecklist];
        qaChecklist[index] = decided;
        const nextVersion = current.version + 1;
        const next = {
          ...current,
          version: nextVersion,
          qaChecklist,
          updatedByUserId: scope.actorUserId,
          updatedAt: at,
        };
        next.status = roomStatus(next);
        next.auditReceipts = [
          ...current.auditReceipts,
          receipt(current, {
            action: "qa_decided",
            objectId: existing.id,
            actorUserId: scope.actorUserId,
            actorParty: access.actorParty,
            occurredAt: at,
            nextVersion,
            facts: {
              qaItemId: existing.id,
              code: existing.code,
              decision,
              reasonCode: reason,
              evidenceSha256: existing.evidenceSha256,
            },
          }),
        ];
        return next;
      },
    );
  }
}
