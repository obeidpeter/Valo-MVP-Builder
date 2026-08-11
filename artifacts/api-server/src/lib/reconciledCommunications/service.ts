import { createHash } from "node:crypto";
import type { NotificationAdapter } from "../providerContracts";
import {
  COMMUNICATION_BOUNDS,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_TEMPLATE_IDS,
  type CommunicationAttempt,
  type CommunicationAttemptStatus,
  type CommunicationChannel,
  type CommunicationEvent,
  type CommunicationScope,
  type CommunicationSnapshot,
  type CommunicationTemplateContext,
  type CommunicationTemplateId,
  type QueueCommunicationInput,
} from "./contracts";
import { CommunicationError } from "./errors";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const DAY_MS = 24 * 60 * 60 * 1_000;
const RETRY_DELAY_MS = 5 * 60 * 1_000;

export const COMMUNICATION_ENVELOPE_SCHEMA =
  "valo.reconciled-communications/v1" as const;
export const COMMUNICATION_TEMPLATE_PREFIX =
  `${COMMUNICATION_ENVELOPE_SCHEMA}:template:` as const;
export const REQUIRED_NOTIFICATION_CAPABILITY =
  "approved_template_delivery" as const;

const CHANNEL_TEMPLATE_POLICY: Readonly<
  Record<CommunicationChannel, ReadonlySet<CommunicationTemplateId>>
> = Object.freeze({
  email: new Set(COMMUNICATION_TEMPLATE_IDS),
  whatsapp_business: new Set<CommunicationTemplateId>([
    "deadline_reminder_v1",
    "evidence_request_ready_v1",
    "evidence_correction_required_v1",
  ]),
});

export interface ResolvedCommunicationRecipient {
  /** Transient provider address. Repositories must never persist this value. */
  recipient: string;
}

export interface CommunicationAuthority {
  assertProject(scope: CommunicationScope): Promise<void>;
  /** Active user plus active, direct organisation membership only. */
  assertNamedHuman(scope: CommunicationScope, userId: string): Promise<void>;
  /** Resolves an address only after exact, active purpose consent is proved. */
  resolveRecipient(
    scope: CommunicationScope,
    input: {
      recipientUserId: string;
      channel: CommunicationChannel;
      consentEvidenceSha256: string;
    },
  ): Promise<ResolvedCommunicationRecipient>;
  /** Proves that the minimal template context still matches canonical data. */
  assertTemplateContext(
    scope: CommunicationScope,
    input: {
      recipientUserId: string;
      templateId: CommunicationTemplateId;
      context: CommunicationTemplateContext;
    },
  ): Promise<void>;
}

export interface QueueCommunicationRecord {
  event: CommunicationEvent;
  idempotencyDigest: string;
}

export interface PreparedCommunicationAttempt {
  event: CommunicationEvent;
  attempt: CommunicationAttempt;
}

export type ProviderSettlementStatus = Extract<
  CommunicationAttemptStatus,
  | "provider_disconnected"
  | "policy_blocked"
  | "provider_rejected"
  | "outcome_unknown"
  | "accepted_pending_receipt"
>;

export interface CommunicationRepository {
  list(scope: CommunicationScope): Promise<CommunicationEvent[]>;
  get(scope: CommunicationScope, eventId: string): Promise<CommunicationEvent>;
  queue(
    scope: CommunicationScope,
    record: QueueCommunicationRecord,
  ): Promise<CommunicationEvent>;
  /** Commits the attempt before any provider health check or delivery call. */
  prepareAttempt(input: {
    scope: CommunicationScope;
    eventId: string;
    expectedVersion: number;
    provider: string;
    now: Date;
  }): Promise<PreparedCommunicationAttempt>;
  settleAttempt(input: {
    scope: CommunicationScope;
    eventId: string;
    attemptId: string;
    expectedVersion: number;
    status: ProviderSettlementStatus;
    providerMessageId?: string | null;
    responseCode?: string | null;
    now: Date;
  }): Promise<CommunicationEvent>;
  reconcileReceipt(input: {
    scope: CommunicationScope;
    eventId: string;
    attemptId: string;
    expectedVersion: number;
    outcome: "delivered" | "failed";
    providerMessageId?: string | null;
    receiptSha256: string;
    now: Date;
  }): Promise<CommunicationEvent>;
}

export interface NotificationProviderRegistry {
  resolve(channel: CommunicationChannel): NotificationAdapter | null;
  isConfigured(channel: CommunicationChannel): boolean;
}

export class DisconnectedNotificationProviderRegistry implements NotificationProviderRegistry {
  resolve(_channel: CommunicationChannel): null {
    return null;
  }

  isConfigured(_channel: CommunicationChannel): false {
    return false;
  }
}

/** Explicit injection is required; the product default is always disconnected. */
export class StaticNotificationProviderRegistry implements NotificationProviderRegistry {
  readonly #adapters = new Map<CommunicationChannel, NotificationAdapter>();

  constructor(adapters: readonly NotificationAdapter[]) {
    for (const adapter of adapters) {
      const channel = adapter.descriptor.kind;
      if (
        (channel !== "email" && channel !== "whatsapp_business") ||
        this.#adapters.has(channel)
      ) {
        throw new CommunicationError(
          "policy_denied",
          "Notification provider configuration is ambiguous.",
        );
      }
      this.#adapters.set(channel, adapter);
    }
  }

  resolve(channel: CommunicationChannel): NotificationAdapter | null {
    return this.#adapters.get(channel) ?? null;
  }

  isConfigured(channel: CommunicationChannel): boolean {
    const adapter = this.#adapters.get(channel);
    return Boolean(adapter && providerApproved(adapter, channel));
  }
}

export interface VerifiedNotificationReceipt {
  verified: true;
  outcome: "delivered" | "failed";
  receiptSha256: string;
  providerMessageId?: string | null;
}

export interface NotificationReceiptVerifier {
  /** Must independently fetch/validate the provider receipt behind the reference. */
  verify(input: {
    channel: CommunicationChannel;
    provider: string;
    providerMessageId: string | null;
    attemptIdempotencyKey: string;
    receiptReference: string;
  }): Promise<VerifiedNotificationReceipt | { verified: false }>;
}

export interface ReconciledCommunicationServiceOptions {
  repository: CommunicationRepository;
  authority: CommunicationAuthority;
  providers?: NotificationProviderRegistry;
  receiptVerifier?: NotificationReceiptVerifier | null;
  now?: () => Date;
}

function invalid(message: string): never {
  throw new CommunicationError("invalid_request", message);
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

function boundedText(value: unknown, label: string, maximum: number): string {
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
  const candidate = boundedText(value, label, 64);
  if (!UUID_PATTERN.test(candidate)) invalid(`${label} is invalid.`);
  return candidate.toLowerCase();
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    invalid(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function dateTime(value: unknown, label: string): string {
  const candidate = boundedText(value, label, 64);
  const milliseconds = Date.parse(candidate);
  if (!Number.isFinite(milliseconds))
    invalid(`${label} must be an ISO date-time.`);
  return new Date(milliseconds).toISOString();
}

function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid("expectedVersion must be a positive integer.");
  }
  return Number(value);
}

function positiveAttempts(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > COMMUNICATION_BOUNDS.attemptsPerEvent
  ) {
    invalid("maxAttempts exceeds the approved retry bound.");
  }
  return Number(value);
}

function parseContext(
  templateId: CommunicationTemplateId,
  value: unknown,
): CommunicationTemplateContext {
  const context = object(value, "context");
  switch (templateId) {
    case "deadline_reminder_v1":
      exactKeys(context, ["kind", "deadlineAt"]);
      if (context.kind !== "deadline")
        invalid("Template context kind is invalid.");
      return {
        kind: "deadline",
        deadlineAt: dateTime(context.deadlineAt, "context.deadlineAt"),
      };
    case "evidence_request_ready_v1":
      exactKeys(context, ["kind", "requestId", "dueAt"]);
      if (context.kind !== "evidence_request")
        invalid("Template context kind is invalid.");
      return {
        kind: "evidence_request",
        requestId: uuid(context.requestId, "context.requestId"),
        dueAt:
          context.dueAt === null
            ? null
            : dateTime(context.dueAt, "context.dueAt"),
      };
    case "evidence_correction_required_v1":
      exactKeys(context, ["kind", "requestId", "correctionSequence"]);
      if (context.kind !== "evidence_correction")
        invalid("Template context kind is invalid.");
      if (
        !Number.isSafeInteger(context.correctionSequence) ||
        Number(context.correctionSequence) < 1 ||
        Number(context.correctionSequence) >
          COMMUNICATION_BOUNDS.attemptsPerEvent
      ) {
        invalid("context.correctionSequence exceeds its safe bound.");
      }
      return {
        kind: "evidence_correction",
        requestId: uuid(context.requestId, "context.requestId"),
        correctionSequence: Number(context.correctionSequence),
      };
    case "package_ready_v1":
      exactKeys(context, ["kind", "packageVersionId", "manifestSha256"]);
      if (context.kind !== "released_package")
        invalid("Template context kind is invalid.");
      return {
        kind: "released_package",
        packageVersionId: uuid(
          context.packageVersionId,
          "context.packageVersionId",
        ),
        manifestSha256: sha256(
          context.manifestSha256,
          "context.manifestSha256",
        ),
      };
  }
}

function parseQueue(value: unknown, now: Date): QueueCommunicationInput {
  const body = object(value);
  exactKeys(
    body,
    [
      "idempotencyKey",
      "channel",
      "templateId",
      "recipientUserId",
      "consentEvidenceSha256",
      "context",
      "deadlineAt",
    ],
    ["maxAttempts"],
  );
  if (!COMMUNICATION_CHANNELS.includes(body.channel as CommunicationChannel)) {
    invalid("channel is not approved.");
  }
  if (
    !COMMUNICATION_TEMPLATE_IDS.includes(
      body.templateId as CommunicationTemplateId,
    )
  ) {
    invalid("templateId is not approved.");
  }
  const channel = body.channel as CommunicationChannel;
  const templateId = body.templateId as CommunicationTemplateId;
  if (!CHANNEL_TEMPLATE_POLICY[channel].has(templateId)) {
    throw new CommunicationError(
      "policy_denied",
      "The template is not approved for this channel.",
    );
  }
  const deadlineAt = dateTime(body.deadlineAt, "deadlineAt");
  const deadline = Date.parse(deadlineAt);
  if (
    deadline <= now.getTime() ||
    deadline > now.getTime() + COMMUNICATION_BOUNDS.maximumDeadlineDays * DAY_MS
  ) {
    invalid("deadlineAt must be within the next 30 days.");
  }
  return {
    idempotencyKey: boundedText(
      body.idempotencyKey,
      "idempotencyKey",
      COMMUNICATION_BOUNDS.idempotencyKey,
    ),
    channel,
    templateId,
    recipientUserId: uuid(body.recipientUserId, "recipientUserId"),
    consentEvidenceSha256: sha256(
      body.consentEvidenceSha256,
      "consentEvidenceSha256",
    ),
    context: parseContext(templateId, body.context),
    deadlineAt,
    maxAttempts:
      body.maxAttempts === undefined ? 3 : positiveAttempts(body.maxAttempts),
  };
}

function parseAttemptControl(value: unknown): { expectedVersion: number } {
  const body = object(value);
  exactKeys(body, ["expectedVersion"]);
  return { expectedVersion: positiveVersion(body.expectedVersion) };
}

function parseReconciliation(value: unknown): {
  expectedVersion: number;
  attemptId: string;
  receiptReference: string;
} {
  const body = object(value);
  exactKeys(body, ["expectedVersion", "attemptId", "receiptReference"]);
  const receiptReference = boundedText(
    body.receiptReference,
    "receiptReference",
    COMMUNICATION_BOUNDS.receiptReference,
  );
  if (!OPAQUE_REFERENCE_PATTERN.test(receiptReference)) {
    invalid("receiptReference must be an opaque provider reference.");
  }
  return {
    expectedVersion: positiveVersion(body.expectedVersion),
    attemptId: uuid(body.attemptId, "attemptId"),
    receiptReference,
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(digest(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function providerApproved(
  adapter: NotificationAdapter,
  channel: CommunicationChannel,
): boolean {
  return (
    adapter.descriptor.kind === channel &&
    adapter.descriptor.mode === "production" &&
    adapter.descriptor.productionApproved === true &&
    adapter.descriptor.capabilities.includes(REQUIRED_NOTIFICATION_CAPABILITY)
  );
}

function boundedProviderReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= COMMUNICATION_BOUNDS.providerReference &&
    OPAQUE_REFERENCE_PATTERN.test(value)
  );
}

function templateVariables(event: CommunicationEvent): Record<string, string> {
  const workspacePath = `/projects/${event.projectId}/client-actions`;
  switch (event.context.kind) {
    case "deadline":
      return {
        deadline_at: event.context.deadlineAt,
        workspace_path: workspacePath,
      };
    case "evidence_request":
      return {
        action_reference: event.context.requestId,
        due_at: event.context.dueAt ?? "not_set",
        workspace_path: workspacePath,
      };
    case "evidence_correction":
      return {
        action_reference: event.context.requestId,
        correction_sequence: String(event.context.correctionSequence),
        workspace_path: workspacePath,
      };
    case "released_package":
      return {
        package_reference: event.context.packageVersionId,
        workspace_path: workspacePath,
      };
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sameQueueIntent(
  stored: CommunicationEvent,
  candidate: CommunicationEvent,
): boolean {
  return (
    stored.id === candidate.id &&
    stored.organisationId === candidate.organisationId &&
    stored.projectId === candidate.projectId &&
    stored.channel === candidate.channel &&
    stored.templateId === candidate.templateId &&
    stored.recipientUserId === candidate.recipientUserId &&
    stored.consentEvidenceSha256 === candidate.consentEvidenceSha256 &&
    JSON.stringify(stored.context) === JSON.stringify(candidate.context) &&
    stored.requestedByUserId === candidate.requestedByUserId &&
    stored.deadlineAt === candidate.deadlineAt &&
    stored.maxAttempts === candidate.maxAttempts
  );
}

export class InMemoryCommunicationRepository implements CommunicationRepository {
  readonly #events = new Map<string, CommunicationEvent>();
  readonly #digests = new Map<string, string>();
  readonly #locks = new Map<string, Promise<void>>();

  #key(scope: CommunicationScope, eventId: string): string {
    return `${scope.organisationId}\0${scope.projectId}\0${eventId}`;
  }

  async #locked<T>(
    scope: CommunicationScope,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = `${scope.organisationId}\0${scope.projectId}`;
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#locks.set(key, next);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#locks.get(key) === next) this.#locks.delete(key);
    }
  }

  async list(scope: CommunicationScope): Promise<CommunicationEvent[]> {
    const prefix = `${scope.organisationId}\0${scope.projectId}\0`;
    return [...this.#events.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, event]) => clone(event));
  }

  async get(
    scope: CommunicationScope,
    eventId: string,
  ): Promise<CommunicationEvent> {
    const event = this.#events.get(this.#key(scope, eventId));
    if (!event)
      throw new CommunicationError(
        "not_found",
        "Communication intent not found.",
      );
    return clone(event);
  }

  async queue(
    scope: CommunicationScope,
    record: QueueCommunicationRecord,
  ): Promise<CommunicationEvent> {
    return this.#locked(scope, async () => {
      const key = this.#key(scope, record.event.id);
      const existing = this.#events.get(key);
      if (existing) {
        if (
          this.#digests.get(key) !== record.idempotencyDigest ||
          !sameQueueIntent(existing, record.event)
        ) {
          throw new CommunicationError(
            "conflict",
            "Idempotency key conflicts with another intent.",
          );
        }
        return clone(existing);
      }
      if (
        (await this.list(scope)).length >= COMMUNICATION_BOUNDS.eventsPerProject
      ) {
        throw new CommunicationError(
          "capacity_exceeded",
          "Communication intent limit reached.",
        );
      }
      this.#events.set(key, clone(record.event));
      this.#digests.set(key, record.idempotencyDigest);
      return clone(record.event);
    });
  }

  async prepareAttempt(input: {
    scope: CommunicationScope;
    eventId: string;
    expectedVersion: number;
    provider: string;
    now: Date;
  }): Promise<PreparedCommunicationAttempt> {
    return this.#locked(input.scope, async () => {
      const key = this.#key(input.scope, input.eventId);
      const current = this.#events.get(key);
      if (!current)
        throw new CommunicationError(
          "not_found",
          "Communication intent not found.",
        );
      if (current.version !== input.expectedVersion) {
        throw new CommunicationError(
          "stale_version",
          "Communication intent changed; reload before retrying.",
        );
      }
      const prior = current.attempts.at(-1);
      if (current.status === "prepared" && prior?.status === "prepared") {
        if (prior.provider !== input.provider) {
          throw new CommunicationError(
            "conflict",
            "Prepared provider no longer matches configuration.",
          );
        }
        return { event: clone(current), attempt: clone(prior) };
      }
      if (current.status !== "queued" && current.status !== "retry_wait") {
        throw new CommunicationError(
          "policy_denied",
          "Communication is not eligible for a delivery attempt.",
        );
      }
      if (Date.parse(current.deadlineAt) <= input.now.getTime()) {
        throw new CommunicationError(
          "policy_denied",
          "Communication deadline has passed.",
        );
      }
      const attemptNumber = current.attempts.length + 1;
      if (attemptNumber > current.maxAttempts) {
        throw new CommunicationError(
          "policy_denied",
          "Communication retry limit reached.",
        );
      }
      const attempt: CommunicationAttempt = {
        id: deterministicUuid(
          `${COMMUNICATION_ENVELOPE_SCHEMA}\0attempt\0${current.id}\0${attemptNumber}`,
        ),
        attemptNumber,
        provider: input.provider,
        idempotencyKey: digest(
          `${COMMUNICATION_ENVELOPE_SCHEMA}\0delivery\0${current.id}\0${attemptNumber}`,
        ),
        status: "prepared",
        providerMessageId: null,
        receiptSha256: null,
        responseCode: null,
        attemptedAt: input.now.toISOString(),
        nextAttemptAt: null,
      };
      const next: CommunicationEvent = {
        ...current,
        status: "prepared",
        version: current.version + 1,
        attempts: [...current.attempts, attempt],
      };
      this.#events.set(key, clone(next));
      return { event: clone(next), attempt: clone(attempt) };
    });
  }

  async settleAttempt(input: {
    scope: CommunicationScope;
    eventId: string;
    attemptId: string;
    expectedVersion: number;
    status: ProviderSettlementStatus;
    providerMessageId?: string | null;
    responseCode?: string | null;
    now: Date;
  }): Promise<CommunicationEvent> {
    return this.#locked(input.scope, async () => {
      const key = this.#key(input.scope, input.eventId);
      const current = this.#events.get(key);
      if (!current)
        throw new CommunicationError(
          "not_found",
          "Communication intent not found.",
        );
      if (current.version !== input.expectedVersion) {
        throw new CommunicationError(
          "stale_version",
          "Communication intent changed; reload before retrying.",
        );
      }
      const attempt = current.attempts.at(-1);
      if (
        current.status !== "prepared" ||
        !attempt ||
        attempt.id !== input.attemptId ||
        attempt.status !== "prepared"
      ) {
        throw new CommunicationError(
          "policy_denied",
          "Prepared attempt fence is invalid.",
        );
      }
      const knownNotDelivered =
        input.status === "provider_disconnected" ||
        input.status === "policy_blocked" ||
        input.status === "provider_rejected";
      const canRetry =
        knownNotDelivered &&
        attempt.attemptNumber < current.maxAttempts &&
        input.now.getTime() + RETRY_DELAY_MS < Date.parse(current.deadlineAt);
      const eventStatus =
        input.status === "accepted_pending_receipt"
          ? "accepted_pending_receipt"
          : input.status === "outcome_unknown"
            ? "reconciliation_required"
            : canRetry
              ? "retry_wait"
              : "dead_letter";
      const nextAttemptAt = canRetry
        ? new Date(input.now.getTime() + RETRY_DELAY_MS).toISOString()
        : null;
      const settled: CommunicationAttempt = {
        ...attempt,
        status: input.status,
        providerMessageId: input.providerMessageId ?? null,
        responseCode: input.responseCode ?? null,
        nextAttemptAt,
      };
      const next: CommunicationEvent = {
        ...current,
        status: eventStatus,
        version: current.version + 1,
        attempts: [...current.attempts.slice(0, -1), settled],
      };
      this.#events.set(key, clone(next));
      return clone(next);
    });
  }

  async reconcileReceipt(input: {
    scope: CommunicationScope;
    eventId: string;
    attemptId: string;
    expectedVersion: number;
    outcome: "delivered" | "failed";
    providerMessageId?: string | null;
    receiptSha256: string;
    now: Date;
  }): Promise<CommunicationEvent> {
    return this.#locked(input.scope, async () => {
      const key = this.#key(input.scope, input.eventId);
      const current = this.#events.get(key);
      if (!current)
        throw new CommunicationError(
          "not_found",
          "Communication intent not found.",
        );
      if (current.version !== input.expectedVersion) {
        throw new CommunicationError(
          "stale_version",
          "Communication intent changed; reload before retrying.",
        );
      }
      const attemptIndex = current.attempts.findIndex(
        ({ id }) => id === input.attemptId,
      );
      const attempt = current.attempts[attemptIndex];
      if (
        attemptIndex !== current.attempts.length - 1 ||
        !attempt ||
        (attempt.status !== "accepted_pending_receipt" &&
          attempt.status !== "outcome_unknown")
      ) {
        throw new CommunicationError(
          "policy_denied",
          "Attempt is not awaiting receipt reconciliation.",
        );
      }
      const failedCanRetry =
        input.outcome === "failed" &&
        attempt.attemptNumber < current.maxAttempts &&
        input.now.getTime() + RETRY_DELAY_MS < Date.parse(current.deadlineAt);
      const reconciled: CommunicationAttempt = {
        ...attempt,
        status:
          input.outcome === "delivered"
            ? "receipt_verified_delivered"
            : "receipt_verified_failed",
        providerMessageId: input.providerMessageId ?? attempt.providerMessageId,
        receiptSha256: input.receiptSha256,
        nextAttemptAt: failedCanRetry
          ? new Date(input.now.getTime() + RETRY_DELAY_MS).toISOString()
          : null,
      };
      const next: CommunicationEvent = {
        ...current,
        status:
          input.outcome === "delivered"
            ? "delivered"
            : failedCanRetry
              ? "retry_wait"
              : "dead_letter",
        version: current.version + 1,
        attempts: [...current.attempts.slice(0, -1), reconciled],
      };
      this.#events.set(key, clone(next));
      return clone(next);
    });
  }
}

export class ReconciledCommunicationService {
  readonly #repository: CommunicationRepository;
  readonly #authority: CommunicationAuthority;
  readonly #providers: NotificationProviderRegistry;
  readonly #receiptVerifier: NotificationReceiptVerifier | null;
  readonly #now: () => Date;

  constructor(options: ReconciledCommunicationServiceOptions) {
    this.#repository = options.repository;
    this.#authority = options.authority;
    this.#providers =
      options.providers ?? new DisconnectedNotificationProviderRegistry();
    this.#receiptVerifier = options.receiptVerifier ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  async #authorise(scope: CommunicationScope): Promise<void> {
    uuid(scope.organisationId, "organisationId");
    uuid(scope.projectId, "projectId");
    uuid(scope.actorUserId, "actorUserId");
    await this.#authority.assertProject(scope);
    await this.#authority.assertNamedHuman(scope, scope.actorUserId);
  }

  async snapshot(scope: CommunicationScope): Promise<CommunicationSnapshot> {
    await this.#authorise(scope);
    return {
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      events: await this.#repository.list(scope),
      policy: {
        approvedTemplatesOnly: true,
        arbitraryBodyAccepted: false,
        arbitraryRecipientAccepted: false,
        deliveryRequiresVerifiedProviderReceipt: true,
        autonomousDispatch: false,
        providersConnected: COMMUNICATION_CHANNELS.some((channel) =>
          this.#providers.isConfigured(channel),
        ),
      },
    };
  }

  async queue(
    scope: CommunicationScope,
    value: unknown,
  ): Promise<CommunicationEvent> {
    await this.#authorise(scope);
    const now = this.#now();
    const input = parseQueue(value, now);
    await this.#authority.assertNamedHuman(scope, input.recipientUserId);
    await this.#authority.resolveRecipient(scope, input);
    await this.#authority.assertTemplateContext(scope, input);
    const idempotencyDigest = digest(input.idempotencyKey);
    const eventId = deterministicUuid(
      `${COMMUNICATION_ENVELOPE_SCHEMA}\0queue\0${scope.organisationId}\0${scope.projectId}\0${idempotencyDigest}`,
    );
    const event: CommunicationEvent = {
      id: eventId,
      organisationId: scope.organisationId,
      projectId: scope.projectId,
      channel: input.channel,
      templateId: input.templateId,
      recipientUserId: input.recipientUserId,
      consentEvidenceSha256: input.consentEvidenceSha256,
      context: input.context,
      status: "queued",
      requestedByUserId: scope.actorUserId,
      requestedAt: now.toISOString(),
      deadlineAt: input.deadlineAt,
      maxAttempts: input.maxAttempts ?? 3,
      version: 1,
      attempts: [],
      deliveryAuthority: "verified_provider_receipt_only",
      arbitraryBodyAccepted: false,
      rawRecipientPersisted: false,
    };
    return this.#repository.queue(scope, { event, idempotencyDigest });
  }

  async attempt(
    scope: CommunicationScope,
    eventIdValue: string,
    value: unknown,
  ): Promise<CommunicationEvent> {
    await this.#authorise(scope);
    const eventId = uuid(eventIdValue, "eventId");
    const { expectedVersion } = parseAttemptControl(value);
    const current = await this.#repository.get(scope, eventId);
    if (current.version !== expectedVersion) {
      throw new CommunicationError(
        "stale_version",
        "Communication intent changed; reload before retrying.",
      );
    }
    const adapter = this.#providers.resolve(current.channel);
    const provider =
      adapter?.descriptor.provider ?? `disconnected:${current.channel}`;
    if (!boundedProviderReference(provider)) {
      throw new CommunicationError(
        "policy_denied",
        "Provider identifier is invalid.",
      );
    }
    const now = this.#now();
    const prepared = await this.#repository.prepareAttempt({
      scope,
      eventId,
      expectedVersion,
      provider,
      now,
    });

    const settle = (
      status: ProviderSettlementStatus,
      responseCode: string,
      providerMessageId?: string | null,
    ) =>
      this.#repository.settleAttempt({
        scope,
        eventId,
        attemptId: prepared.attempt.id,
        expectedVersion: prepared.event.version,
        status,
        providerMessageId,
        responseCode,
        now: this.#now(),
      });

    if (!adapter)
      return settle("provider_disconnected", "provider_not_configured");
    if (!providerApproved(adapter, current.channel)) {
      return settle("policy_blocked", "provider_not_approved");
    }
    try {
      const health = await adapter.health();
      if (!health.healthy)
        return settle("provider_disconnected", "provider_unhealthy");
    } catch {
      return settle("provider_disconnected", "provider_health_unknown");
    }

    let recipient: ResolvedCommunicationRecipient;
    try {
      await this.#authority.assertNamedHuman(scope, current.recipientUserId);
      recipient = await this.#authority.resolveRecipient(scope, {
        recipientUserId: current.recipientUserId,
        channel: current.channel,
        consentEvidenceSha256: current.consentEvidenceSha256,
      });
      await this.#authority.assertTemplateContext(scope, {
        recipientUserId: current.recipientUserId,
        templateId: current.templateId,
        context: current.context,
      });
    } catch (error) {
      await settle("policy_blocked", "authority_revalidation_failed");
      throw error;
    }

    try {
      const result = await adapter.deliver({
        recipient: recipient.recipient,
        template: current.templateId,
        variables: templateVariables(current),
        idempotencyKey: prepared.attempt.idempotencyKey,
      });
      if (!result.accepted) {
        return settle("provider_rejected", "provider_rejected");
      }
      if (!boundedProviderReference(result.providerMessageId)) {
        return settle("outcome_unknown", "invalid_provider_response");
      }
      return settle(
        "accepted_pending_receipt",
        "accepted_not_delivered",
        result.providerMessageId,
      );
    } catch {
      return settle("outcome_unknown", "provider_outcome_unknown");
    }
  }

  async reconcile(
    scope: CommunicationScope,
    eventIdValue: string,
    value: unknown,
  ): Promise<CommunicationEvent> {
    await this.#authorise(scope);
    const eventId = uuid(eventIdValue, "eventId");
    const input = parseReconciliation(value);
    const event = await this.#repository.get(scope, eventId);
    if (event.version !== input.expectedVersion) {
      throw new CommunicationError(
        "stale_version",
        "Communication intent changed; reload before retrying.",
      );
    }
    const attempt = event.attempts.find(({ id }) => id === input.attemptId);
    if (
      !attempt ||
      attempt !== event.attempts.at(-1) ||
      (attempt.status !== "accepted_pending_receipt" &&
        attempt.status !== "outcome_unknown")
    ) {
      throw new CommunicationError(
        "policy_denied",
        "Attempt is not awaiting receipt reconciliation.",
      );
    }
    if (!this.#receiptVerifier) {
      throw new CommunicationError(
        "receipt_unverified",
        "No trusted receipt verifier is configured.",
      );
    }
    let receipt: VerifiedNotificationReceipt | { verified: false };
    try {
      receipt = await this.#receiptVerifier.verify({
        channel: event.channel,
        provider: attempt.provider,
        providerMessageId: attempt.providerMessageId,
        attemptIdempotencyKey: attempt.idempotencyKey,
        receiptReference: input.receiptReference,
      });
    } catch {
      throw new CommunicationError(
        "receipt_unverified",
        "Provider receipt could not be verified.",
      );
    }
    if (
      !receipt.verified ||
      !SHA256_PATTERN.test(receipt.receiptSha256) ||
      (receipt.providerMessageId != null &&
        !boundedProviderReference(receipt.providerMessageId)) ||
      (attempt.providerMessageId != null &&
        receipt.providerMessageId != null &&
        receipt.providerMessageId !== attempt.providerMessageId)
    ) {
      throw new CommunicationError(
        "receipt_unverified",
        "Provider receipt did not verify against the attempt.",
      );
    }
    return this.#repository.reconcileReceipt({
      scope,
      eventId,
      attemptId: attempt.id,
      expectedVersion: event.version,
      outcome: receipt.outcome,
      providerMessageId: receipt.providerMessageId ?? attempt.providerMessageId,
      receiptSha256: receipt.receiptSha256,
      now: this.#now(),
    });
  }
}
