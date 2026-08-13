import { createHash, randomUUID } from "node:crypto";
import {
  CLIENT_ACTION_BOUNDS,
  CLIENT_ACTION_PURPOSES,
  type ClientActionPurpose,
  type ClientActionRecord,
  type ClientActionRecordKind,
  type ClientActionScope,
  type ClientActionSnapshot,
  type ClientEvidenceRequestRecord,
  type ClientEvidenceSlot,
  type ClientPackageDeliveryRecord,
  type CreateClientEvidenceRequestInput,
} from "./contracts";
import { ClientActionError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTENT_TYPE_PATTERN =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u;

export interface ClientActionRepository {
  list(
    scope: ClientActionScope,
    kind?: ClientActionRecordKind,
  ): Promise<ClientActionRecord[]>;
  insert(
    scope: ClientActionScope,
    record: ClientActionRecord,
    validateBeforeWrite?: () => Promise<void>,
  ): Promise<void>;
  compareAndSwap(
    scope: ClientActionScope,
    id: string,
    expectedVersion: number,
    mutate: (
      current: ClientActionRecord,
    ) => ClientActionRecord | Promise<ClientActionRecord>,
  ): Promise<ClientActionRecord>;
}

export interface ClientActionAuthority {
  assertProject(scope: ClientActionScope): Promise<void>;
  /** Requires an active user and active direct membership, never partner/break-glass. */
  assertNamedHuman(scope: ClientActionScope, userId: string): Promise<void>;
  /** Requires the canonical current role policy for document:upload. */
  assertEvidenceRequestRecipient(
    scope: ClientActionScope,
    userId: string,
  ): Promise<void>;
  assertCanonicalDocument(
    scope: ClientActionScope,
    input: {
      documentId: string;
      sha256: string;
      acceptedContentTypes: readonly string[];
      uploadedByUserId: string;
    },
  ): Promise<void>;
  assertReleasedPackage(
    scope: ClientActionScope,
    input: {
      packageVersionId: string;
      manifestSha256: string;
      releaseReceiptSha256: string;
    },
  ): Promise<void>;
}

export interface ClientActionServiceOptions {
  repository: ClientActionRepository;
  authority: ClientActionAuthority;
  now?: () => Date;
  idFactory?: () => string;
}

function invalid(message: string): never {
  throw new ClientActionError("invalid_request", message);
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
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(normalized)
  ) {
    invalid(`${label} is empty or exceeds its safe bound.`);
  }
  return normalized;
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
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    invalid("expectedVersion must be a positive integer.");
  }
  return value as number;
}

function dateTime(value: unknown, label: string): string {
  const candidate = text(value, label, 64);
  const parsed = Date.parse(candidate);
  if (Number.isNaN(parsed)) invalid(`${label} must be an ISO date-time.`);
  return new Date(parsed).toISOString();
}

function contentType(value: unknown): string {
  const normalized = text(value, "contentType", 192).toLocaleLowerCase("en-US");
  if (!CONTENT_TYPE_PATTERN.test(normalized))
    invalid("contentType is invalid.");
  return normalized;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseCreateRequest(
  value: unknown,
  now: Date,
): CreateClientEvidenceRequestInput {
  const body = object(value);
  exactKeys(
    body,
    ["purpose", "purposeStatement", "recipientUserId", "slots"],
    ["dueAt"],
  );
  if (!CLIENT_ACTION_PURPOSES.includes(body.purpose as ClientActionPurpose)) {
    invalid("purpose is not supported.");
  }
  if (
    !Array.isArray(body.slots) ||
    body.slots.length < 1 ||
    body.slots.length > CLIENT_ACTION_BOUNDS.slotsPerRequest
  ) {
    invalid("slots must contain between 1 and 20 entries.");
  }
  const slots = body.slots.map((entry, index) => {
    const slot = object(entry, `slots[${index}]`);
    exactKeys(slot, ["label", "required"], ["acceptedContentTypes"]);
    if (typeof slot.required !== "boolean")
      invalid(`slots[${index}].required must be boolean.`);
    const accepted = slot.acceptedContentTypes ?? [];
    if (
      !Array.isArray(accepted) ||
      accepted.length > CLIENT_ACTION_BOUNDS.contentTypesPerSlot
    ) {
      invalid(`slots[${index}].acceptedContentTypes exceeds its safe bound.`);
    }
    const acceptedContentTypes = accepted.map(contentType);
    if (new Set(acceptedContentTypes).size !== acceptedContentTypes.length) {
      invalid(`slots[${index}].acceptedContentTypes contains duplicates.`);
    }
    return {
      label: text(
        slot.label,
        `slots[${index}].label`,
        CLIENT_ACTION_BOUNDS.shortText,
      ),
      required: slot.required,
      acceptedContentTypes,
    };
  });
  if (!slots.some(({ required }) => required))
    invalid("At least one slot must be required.");
  const dueAt =
    body.dueAt === undefined || body.dueAt === null
      ? null
      : dateTime(body.dueAt, "dueAt");
  if (dueAt) {
    const due = Date.parse(dueAt);
    if (
      due <= now.getTime() ||
      due - now.getTime() > 366 * 24 * 60 * 60 * 1_000
    ) {
      invalid("dueAt must be in the future and no more than 366 days away.");
    }
  }
  return {
    purpose: body.purpose as ClientActionPurpose,
    purposeStatement: text(
      body.purposeStatement,
      "purposeStatement",
      CLIENT_ACTION_BOUNDS.statement,
    ),
    recipientUserId: uuid(body.recipientUserId, "recipientUserId"),
    dueAt,
    slots,
  };
}

function latest(slot: ClientEvidenceSlot) {
  return slot.attempts.at(-1) ?? null;
}

export function deriveClientEvidenceRequestStatus(
  slots: readonly ClientEvidenceSlot[],
): ClientEvidenceRequestRecord["status"] {
  const attempts = slots.map(latest);
  if (
    attempts.some(
      (attempt) => attempt?.review?.decision === "correction_required",
    )
  ) {
    return "changes_required";
  }
  const relevant = slots.filter(
    (slot) => slot.required || latest(slot)?.document,
  );
  if (
    relevant.length > 0 &&
    relevant.every((slot) => latest(slot)?.review?.decision === "accepted") &&
    slots
      .filter(({ required }) => required)
      .every((slot) => latest(slot)?.review?.decision === "accepted")
  ) {
    return "completed";
  }
  if (
    slots
      .filter(({ required }) => required)
      .every((slot) => Boolean(latest(slot)?.document))
  ) {
    return "submitted";
  }
  return attempts.some(Boolean) ? "in_progress" : "acknowledged";
}

export class InMemoryClientActionRepository implements ClientActionRepository {
  readonly #records = new Map<string, ClientActionRecord>();
  readonly #locks = new Map<string, Promise<void>>();

  #prefix(scope: ClientActionScope): string {
    return `${scope.organisationId}\u0000${scope.projectId}\u0000`;
  }

  async #locked<T>(
    scope: ClientActionScope,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = this.#prefix(scope);
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

  async list(
    scope: ClientActionScope,
    kind?: ClientActionRecordKind,
  ): Promise<ClientActionRecord[]> {
    const prefix = this.#prefix(scope);
    return [...this.#records.entries()]
      .filter(
        ([key, record]) =>
          key.startsWith(prefix) && (!kind || record.kind === kind),
      )
      .map(([, record]) => clone(record));
  }

  async insert(
    scope: ClientActionScope,
    record: ClientActionRecord,
    validateBeforeWrite?: () => Promise<void>,
  ): Promise<void> {
    await this.#locked(scope, async () => {
      if (
        record.organisationId !== scope.organisationId ||
        record.projectId !== scope.projectId
      ) {
        throw new ClientActionError("scope_denied", "Record scope denied.");
      }
      const records = await this.list(scope);
      if (records.length >= CLIENT_ACTION_BOUNDS.recordsPerProject) {
        throw new ClientActionError(
          "capacity_exceeded",
          "The client-action record limit has been reached.",
        );
      }
      if (
        record.kind === "package_delivery" &&
        records.some(
          (candidate) =>
            candidate.kind === "package_delivery" &&
            candidate.packageVersionId === record.packageVersionId &&
            candidate.recipientUserId === record.recipientUserId,
        )
      ) {
        throw new ClientActionError(
          "conflict",
          "A delivery record already exists for this recipient and package version.",
        );
      }
      const key = `${this.#prefix(scope)}${record.id}`;
      if (this.#records.has(key))
        throw new ClientActionError("conflict", "The record already exists.");
      await validateBeforeWrite?.();
      this.#records.set(key, clone(record));
    });
  }

  async compareAndSwap(
    scope: ClientActionScope,
    id: string,
    expectedVersion: number,
    mutate: (
      current: ClientActionRecord,
    ) => ClientActionRecord | Promise<ClientActionRecord>,
  ): Promise<ClientActionRecord> {
    return this.#locked(scope, async () => {
      const key = `${this.#prefix(scope)}${id}`;
      const current = this.#records.get(key);
      if (!current)
        throw new ClientActionError(
          "not_found",
          "The client action was not found.",
        );
      if (current.version !== expectedVersion)
        throw new ClientActionError(
          "stale_version",
          "The client action changed; reload before retrying.",
        );
      const next = await mutate(clone(current));
      if (
        next.id !== current.id ||
        next.kind !== current.kind ||
        next.organisationId !== scope.organisationId ||
        next.projectId !== scope.projectId ||
        next.version !== current.version + 1
      ) {
        throw new ClientActionError(
          "policy_denied",
          "Record identity or version invariant failed.",
        );
      }
      this.#records.set(key, clone(next));
      return clone(next);
    });
  }
}

export class ClientActionService {
  readonly #repository: ClientActionRepository;
  readonly #authority: ClientActionAuthority;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: ClientActionServiceOptions) {
    this.#repository = options.repository;
    this.#authority = options.authority;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.idFactory ?? randomUUID;
  }

  async #authorise(scope: ClientActionScope): Promise<void> {
    uuid(scope.organisationId, "organisationId");
    uuid(scope.projectId, "projectId");
    uuid(scope.actorUserId, "actorUserId");
    await this.#authority.assertProject(scope);
    await this.#authority.assertNamedHuman(scope, scope.actorUserId);
  }

  #touch<T extends ClientActionRecord>(scope: ClientActionScope, record: T): T {
    return {
      ...record,
      version: record.version + 1,
      updatedByUserId: scope.actorUserId,
      updatedAt: this.#now().toISOString(),
    };
  }

  async snapshot(scope: ClientActionScope): Promise<ClientActionSnapshot> {
    await this.#authorise(scope);
    return {
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      records: await this.#repository.list(scope),
      authority: {
        externalMessaging: false,
        rawUpload: false,
        packageTransfer: false,
        uploadIntentOnly: true,
      },
    };
  }

  async createEvidenceRequest(
    scope: ClientActionScope,
    raw: unknown,
  ): Promise<ClientEvidenceRequestRecord> {
    await this.#authorise(scope);
    const now = this.#now();
    const input = parseCreateRequest(raw, now);
    if (input.recipientUserId === scope.actorUserId) {
      throw new ClientActionError(
        "policy_denied",
        "A request creator cannot be its client recipient.",
      );
    }
    const stamp = now.toISOString();
    const record: ClientEvidenceRequestRecord = {
      id: this.#id(),
      kind: "evidence_request",
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      version: 1,
      createdByUserId: scope.actorUserId,
      createdAt: stamp,
      updatedByUserId: scope.actorUserId,
      updatedAt: stamp,
      purpose: input.purpose,
      purposeStatement: input.purposeStatement,
      recipientUserId: input.recipientUserId,
      dueAt: input.dueAt ?? null,
      status: "open",
      requestAcknowledgement: null,
      slots: input.slots.map((slot) => ({
        ...slot,
        acceptedContentTypes: slot.acceptedContentTypes ?? [],
        id: this.#id(),
        attempts: [],
      })),
      completionReceiptSha256: null,
      externalMessageSentByValo: false,
    };
    await this.#repository.insert(scope, record, () =>
      this.#authority.assertEvidenceRequestRecipient(
        scope,
        input.recipientUserId,
      ),
    );
    return record;
  }

  async acknowledgeRequest(
    scope: ClientActionScope,
    id: string,
    raw: unknown,
  ): Promise<ClientEvidenceRequestRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, ["expectedVersion", "statement"]);
    const expected = version(body.expectedVersion);
    const statement = text(
      body.statement,
      "statement",
      CLIENT_ACTION_BOUNDS.statement,
    );
    return (await this.#repository.compareAndSwap(
      scope,
      uuid(id, "requestId"),
      expected,
      (current) => {
        if (current.kind !== "evidence_request")
          throw new ClientActionError(
            "not_found",
            "The evidence request was not found.",
          );
        if (current.recipientUserId !== scope.actorUserId)
          throw new ClientActionError(
            "scope_denied",
            "Only the named recipient can acknowledge this request.",
          );
        if (current.status !== "open" || current.requestAcknowledgement)
          throw new ClientActionError(
            "policy_denied",
            "The request cannot be acknowledged in its current state.",
          );
        const stamp = this.#now().toISOString();
        return this.#touch(scope, {
          ...current,
          status: "acknowledged",
          requestAcknowledgement: {
            statement,
            acknowledgedByUserId: scope.actorUserId,
            acknowledgedAt: stamp,
          },
        });
      },
    )) as ClientEvidenceRequestRecord;
  }

  async recordUploadIntent(
    scope: ClientActionScope,
    id: string,
    slotId: string,
    raw: unknown,
  ): Promise<ClientEvidenceRequestRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, [
      "expectedVersion",
      "filename",
      "contentType",
      "sizeBytes",
      "declaredSha256",
    ]);
    const expected = version(body.expectedVersion);
    const filename = text(
      body.filename,
      "filename",
      CLIENT_ACTION_BOUNDS.filename,
    );
    const mediaType = contentType(body.contentType);
    if (
      !Number.isSafeInteger(body.sizeBytes) ||
      (body.sizeBytes as number) < 1 ||
      (body.sizeBytes as number) > CLIENT_ACTION_BOUNDS.maximumIntentBytes
    ) {
      invalid("sizeBytes is outside the controlled upload bound.");
    }
    const declaredSha256 = sha256(body.declaredSha256, "declaredSha256");
    return (await this.#repository.compareAndSwap(
      scope,
      uuid(id, "requestId"),
      expected,
      (current) => {
        if (current.kind !== "evidence_request")
          throw new ClientActionError(
            "not_found",
            "The evidence request was not found.",
          );
        if (current.recipientUserId !== scope.actorUserId)
          throw new ClientActionError(
            "scope_denied",
            "Only the named recipient can record an upload intent.",
          );
        if (!current.requestAcknowledgement || current.status === "completed")
          throw new ClientActionError(
            "policy_denied",
            "A current, acknowledged request is required.",
          );
        const slot = current.slots.find(
          (candidate) => candidate.id === uuid(slotId, "slotId"),
        );
        if (!slot)
          throw new ClientActionError(
            "not_found",
            "The evidence slot was not found.",
          );
        if (
          slot.acceptedContentTypes.length > 0 &&
          !slot.acceptedContentTypes.includes(mediaType)
        ) {
          throw new ClientActionError(
            "policy_denied",
            "The declared content type is not accepted by this slot.",
          );
        }
        if (slot.attempts.length >= CLIENT_ACTION_BOUNDS.attemptsPerSlot)
          throw new ClientActionError(
            "capacity_exceeded",
            "The correction-attempt limit has been reached.",
          );
        const prior = latest(slot);
        if (
          prior &&
          !(
            prior.review?.decision === "correction_required" &&
            prior.correctionAcknowledgement
          )
        ) {
          throw new ClientActionError(
            "policy_denied",
            "Finish the active attempt or acknowledge its correction before replacing it.",
          );
        }
        const stamp = this.#now().toISOString();
        const attempts = [
          ...slot.attempts,
          {
            id: this.#id(),
            intent: {
              id: this.#id(),
              filename,
              contentType: mediaType,
              sizeBytes: body.sizeBytes as number,
              declaredSha256,
              recordedByUserId: scope.actorUserId,
              recordedAt: stamp,
            },
            document: null,
            review: null,
            correctionAcknowledgement: null,
          },
        ];
        const slots = current.slots.map((candidate) =>
          candidate.id === slot.id ? { ...candidate, attempts } : candidate,
        );
        return this.#touch(scope, {
          ...current,
          slots,
          status: deriveClientEvidenceRequestStatus(slots),
          completionReceiptSha256: null,
        });
      },
    )) as ClientEvidenceRequestRecord;
  }

  async attachCanonicalDocument(
    scope: ClientActionScope,
    id: string,
    slotId: string,
    raw: unknown,
  ): Promise<ClientEvidenceRequestRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, ["expectedVersion", "intentId", "documentId", "sha256"]);
    const expected = version(body.expectedVersion);
    const intentId = uuid(body.intentId, "intentId");
    const documentId = uuid(body.documentId, "documentId");
    const documentSha256 = sha256(body.sha256, "sha256");
    return (await this.#repository.compareAndSwap(
      scope,
      uuid(id, "requestId"),
      expected,
      async (current) => {
        if (current.kind !== "evidence_request")
          throw new ClientActionError(
            "not_found",
            "The evidence request was not found.",
          );
        if (current.recipientUserId !== scope.actorUserId)
          throw new ClientActionError(
            "scope_denied",
            "Only the named recipient can attach a document.",
          );
        const targetSlotId = uuid(slotId, "slotId");
        const slot = current.slots.find(
          (candidate) => candidate.id === targetSlotId,
        );
        const attempt = slot ? latest(slot) : null;
        if (
          !slot ||
          !attempt ||
          attempt.intent.id !== intentId ||
          attempt.document ||
          attempt.review
        ) {
          throw new ClientActionError(
            "policy_denied",
            "A matching active upload intent is required.",
          );
        }
        if (attempt.intent.declaredSha256 !== documentSha256)
          throw new ClientActionError(
            "policy_denied",
            "The canonical document digest does not match the upload intent.",
          );
        await this.#authority.assertCanonicalDocument(scope, {
          documentId,
          sha256: documentSha256,
          acceptedContentTypes: slot.acceptedContentTypes,
          uploadedByUserId: scope.actorUserId,
        });
        const stamp = this.#now().toISOString();
        const slots = current.slots.map((candidate) =>
          candidate.id === targetSlotId
            ? {
                ...candidate,
                attempts: candidate.attempts.map((entry) =>
                  entry.id === attempt.id
                    ? {
                        ...entry,
                        document: {
                          documentId,
                          sha256: documentSha256,
                          attachedByUserId: scope.actorUserId,
                          attachedAt: stamp,
                        },
                      }
                    : entry,
                ),
              }
            : candidate,
        );
        return this.#touch(scope, {
          ...current,
          slots,
          status: deriveClientEvidenceRequestStatus(slots),
        });
      },
    )) as ClientEvidenceRequestRecord;
  }

  async reviewSlot(
    scope: ClientActionScope,
    id: string,
    slotId: string,
    raw: unknown,
  ): Promise<ClientEvidenceRequestRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, ["expectedVersion", "decision", "reason"]);
    const expected = version(body.expectedVersion);
    if (
      !(["accepted", "correction_required"] as const).includes(
        body.decision as "accepted" | "correction_required",
      )
    )
      invalid("decision is invalid.");
    const decision = body.decision as "accepted" | "correction_required";
    const reason = text(body.reason, "reason", CLIENT_ACTION_BOUNDS.statement);
    return (await this.#repository.compareAndSwap(
      scope,
      uuid(id, "requestId"),
      expected,
      async (current) => {
        if (current.kind !== "evidence_request")
          throw new ClientActionError(
            "not_found",
            "The evidence request was not found.",
          );
        if (current.recipientUserId === scope.actorUserId)
          throw new ClientActionError(
            "policy_denied",
            "The recipient cannot review their own response.",
          );
        const targetSlotId = uuid(slotId, "slotId");
        const slot = current.slots.find(
          (candidate) => candidate.id === targetSlotId,
        );
        const attempt = slot ? latest(slot) : null;
        if (
          !slot ||
          !attempt?.document ||
          attempt.review ||
          current.status === "completed"
        ) {
          throw new ClientActionError(
            "policy_denied",
            "A current, undecided canonical document is required.",
          );
        }
        await this.#authority.assertCanonicalDocument(scope, {
          documentId: attempt.document.documentId,
          sha256: attempt.document.sha256,
          acceptedContentTypes: slot.acceptedContentTypes,
          uploadedByUserId: current.recipientUserId,
        });
        const stamp = this.#now().toISOString();
        const slots = current.slots.map((candidate) =>
          candidate.id === targetSlotId
            ? {
                ...candidate,
                attempts: candidate.attempts.map((entry) =>
                  entry.id === attempt.id
                    ? {
                        ...entry,
                        review: {
                          decision,
                          reason,
                          reviewedByUserId: scope.actorUserId,
                          reviewedAt: stamp,
                        },
                      }
                    : entry,
                ),
              }
            : candidate,
        );
        const status = deriveClientEvidenceRequestStatus(slots);
        return this.#touch(scope, {
          ...current,
          slots,
          status,
          completionReceiptSha256:
            status === "completed"
              ? digest(
                  slots.map((candidate) => ({
                    slotId: candidate.id,
                    attemptId: latest(candidate)?.id ?? null,
                    documentSha256: latest(candidate)?.document?.sha256 ?? null,
                    review: latest(candidate)?.review ?? null,
                  })),
                )
              : null,
        });
      },
    )) as ClientEvidenceRequestRecord;
  }

  async acknowledgeCorrection(
    scope: ClientActionScope,
    id: string,
    slotId: string,
    raw: unknown,
  ): Promise<ClientEvidenceRequestRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, ["expectedVersion", "statement"]);
    const expected = version(body.expectedVersion);
    const statement = text(
      body.statement,
      "statement",
      CLIENT_ACTION_BOUNDS.statement,
    );
    return (await this.#repository.compareAndSwap(
      scope,
      uuid(id, "requestId"),
      expected,
      (current) => {
        if (current.kind !== "evidence_request")
          throw new ClientActionError(
            "not_found",
            "The evidence request was not found.",
          );
        if (current.recipientUserId !== scope.actorUserId)
          throw new ClientActionError(
            "scope_denied",
            "Only the named recipient can acknowledge a correction.",
          );
        const targetSlotId = uuid(slotId, "slotId");
        const slot = current.slots.find(
          (candidate) => candidate.id === targetSlotId,
        );
        const attempt = slot ? latest(slot) : null;
        if (
          !slot ||
          attempt?.review?.decision !== "correction_required" ||
          attempt.correctionAcknowledgement
        ) {
          throw new ClientActionError(
            "policy_denied",
            "An unacknowledged correction is required.",
          );
        }
        const stamp = this.#now().toISOString();
        const slots = current.slots.map((candidate) =>
          candidate.id === targetSlotId
            ? {
                ...candidate,
                attempts: candidate.attempts.map((entry) =>
                  entry.id === attempt.id
                    ? {
                        ...entry,
                        correctionAcknowledgement: {
                          statement,
                          acknowledgedByUserId: scope.actorUserId,
                          acknowledgedAt: stamp,
                        },
                      }
                    : entry,
                ),
              }
            : candidate,
        );
        return this.#touch(scope, { ...current, slots });
      },
    )) as ClientEvidenceRequestRecord;
  }

  async createPackageDelivery(
    scope: ClientActionScope,
    raw: unknown,
  ): Promise<ClientPackageDeliveryRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, [
      "recipientUserId",
      "packageVersionId",
      "manifestSha256",
      "releaseReceiptSha256",
    ]);
    const recipientUserId = uuid(body.recipientUserId, "recipientUserId");
    if (recipientUserId === scope.actorUserId)
      throw new ClientActionError(
        "policy_denied",
        "A release recorder cannot acknowledge their own delivery.",
      );
    await this.#authority.assertNamedHuman(scope, recipientUserId);
    const packageVersionId = uuid(body.packageVersionId, "packageVersionId");
    const manifestSha256 = sha256(body.manifestSha256, "manifestSha256");
    const releaseReceiptSha256 = sha256(
      body.releaseReceiptSha256,
      "releaseReceiptSha256",
    );
    await this.#authority.assertReleasedPackage(scope, {
      packageVersionId,
      manifestSha256,
      releaseReceiptSha256,
    });
    const existing = (
      await this.#repository.list(scope, "package_delivery")
    ).some(
      (record) =>
        record.kind === "package_delivery" &&
        record.packageVersionId === packageVersionId &&
        record.recipientUserId === recipientUserId,
    );
    if (existing)
      throw new ClientActionError(
        "conflict",
        "A delivery acknowledgement record already exists for this recipient and package version.",
      );
    const stamp = this.#now().toISOString();
    const record: ClientPackageDeliveryRecord = {
      id: this.#id(),
      kind: "package_delivery",
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      version: 1,
      createdByUserId: scope.actorUserId,
      createdAt: stamp,
      updatedByUserId: scope.actorUserId,
      updatedAt: stamp,
      recipientUserId,
      packageVersionId,
      manifestSha256,
      releaseReceiptSha256,
      status: "available_for_acknowledgement",
      deliveryMode: "metadata_record_only",
      acknowledgement: null,
      externalDeliveryPerformedByValo: false,
    };
    await this.#repository.insert(scope, record);
    return record;
  }

  async acknowledgePackageDelivery(
    scope: ClientActionScope,
    id: string,
    raw: unknown,
  ): Promise<ClientPackageDeliveryRecord> {
    await this.#authorise(scope);
    const body = object(raw);
    exactKeys(body, ["expectedVersion", "statement"]);
    const expected = version(body.expectedVersion);
    const statement = text(
      body.statement,
      "statement",
      CLIENT_ACTION_BOUNDS.statement,
    );
    return (await this.#repository.compareAndSwap(
      scope,
      uuid(id, "deliveryId"),
      expected,
      async (current) => {
        if (current.kind !== "package_delivery")
          throw new ClientActionError(
            "not_found",
            "The package delivery was not found.",
          );
        if (current.recipientUserId !== scope.actorUserId)
          throw new ClientActionError(
            "scope_denied",
            "Only the named recipient can acknowledge this package.",
          );
        if (
          current.status !== "available_for_acknowledgement" ||
          current.acknowledgement
        )
          throw new ClientActionError(
            "policy_denied",
            "This package delivery is already acknowledged.",
          );
        await this.#authority.assertReleasedPackage(scope, {
          packageVersionId: current.packageVersionId,
          manifestSha256: current.manifestSha256,
          releaseReceiptSha256: current.releaseReceiptSha256,
        });
        const stamp = this.#now().toISOString();
        return this.#touch(scope, {
          ...current,
          status: "acknowledged",
          acknowledgement: {
            statement,
            acknowledgedByUserId: scope.actorUserId,
            acknowledgedAt: stamp,
            receiptSha256: digest({
              deliveryId: current.id,
              packageVersionId: current.packageVersionId,
              manifestSha256: current.manifestSha256,
              releaseReceiptSha256: current.releaseReceiptSha256,
              acknowledgedByUserId: scope.actorUserId,
              acknowledgedAt: stamp,
              statement,
            }),
          },
        });
      },
    )) as ClientPackageDeliveryRecord;
  }
}
