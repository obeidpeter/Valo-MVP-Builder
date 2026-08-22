import { sha256Hex } from "../canonicalDigest";
import { UUID_PATTERN } from "../identifierPatterns";
import {
  DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST,
  evaluateRetentionCompletionActivation,
} from "./activation";
import {
  RETENTION_COMPLETION_BOUNDS,
  RetentionCompletionError,
  type RetentionCompletionPermissions,
  type RetentionCompletionReadiness,
  type RetentionCompletionRepository,
  type RetentionCompletionScope,
  type RetentionCompletionSnapshot,
} from "./contracts";

export interface RetentionCompletionServiceOptions {
  repository: RetentionCompletionRepository;
  activationManifest?: unknown;
  environment?: Readonly<Record<string, string | undefined>>;
}

function assertScope(scope: RetentionCompletionScope): void {
  if (
    !UUID_PATTERN.test(scope.organisationId) ||
    !UUID_PATTERN.test(scope.actorUserId) ||
    !UUID_PATTERN.test(scope.actorMembershipId)
  ) {
    throw new RetentionCompletionError(
      "not_found_or_not_authorized",
      "Current direct retention authority is required.",
    );
  }
}

function assertId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new RetentionCompletionError("invalid_input", "Invalid identifier.");
  }
  return value;
}

function boundedSecret(value: string | undefined, minimum: number): string {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized !== value ||
    normalized.length < minimum ||
    normalized.length > RETENTION_COMPLETION_BOUNDS.idempotencyKeyCodeUnits ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(normalized)
  ) {
    throw new RetentionCompletionError(
      "invalid_input",
      "A valid idempotency key is required.",
    );
  }
  return normalized;
}

function boundedAttestation(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 16 ||
    value.length > RETENTION_COMPLETION_BOUNDS.attestationCodeUnits ||
    /[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    throw new RetentionCompletionError(
      "invalid_input",
      "A bounded named-human attestation is required.",
    );
  }
  return value;
}

function expectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RetentionCompletionError(
      "invalid_input",
      "A valid expected version is required.",
    );
  }
  return value;
}

function idempotencyDigest(input: {
  scope: RetentionCompletionScope;
  phase: "detach" | "reconcile" | "certify";
  resourceId: string;
  key: string;
}): string {
  return sha256Hex(
    [
      "valo.retention-completion-idempotency/v1",
      input.scope.organisationId,
      input.scope.actorUserId,
      input.phase,
      input.resourceId,
      input.key,
    ].join("\0"),
  );
}

function permissions(): RetentionCompletionPermissions {
  return { canStart: true, canReconcile: true, canCertify: true };
}

export class RetentionCompletionService {
  readonly #repository: RetentionCompletionRepository;
  readonly #activationManifest: unknown;
  readonly #environment: Readonly<Record<string, string | undefined>>;

  constructor(options: RetentionCompletionServiceOptions) {
    this.#repository = options.repository;
    this.#activationManifest =
      options.activationManifest ??
      DEFAULT_RETENTION_COMPLETION_ACTIVATION_MANIFEST;
    this.#environment = options.environment ?? process.env;
  }

  #activation() {
    return evaluateRetentionCompletionActivation(
      this.#activationManifest,
      this.#environment,
    );
  }

  #assertActivated(): void {
    if (!this.#activation().activated) {
      throw new RetentionCompletionError(
        "not_activated",
        "Retention completion is not activated. No data was deleted and no deletion certificate was issued.",
      );
    }
  }

  async readiness(
    scope: RetentionCompletionScope,
  ): Promise<RetentionCompletionReadiness> {
    assertScope(scope);
    const now = await this.#repository.databaseNow(scope);
    return {
      ...this.#activation(),
      checkedAt: now.toISOString(),
      permissions: permissions(),
    };
  }

  async list(
    scope: RetentionCompletionScope,
  ): Promise<readonly import("./contracts").RetentionRequestView[]> {
    assertScope(scope);
    return this.#repository.list(scope, permissions());
  }

  async read(
    scope: RetentionCompletionScope,
    requestId: string,
  ): Promise<RetentionCompletionSnapshot> {
    assertScope(scope);
    return this.#repository.read(scope, assertId(requestId), permissions());
  }

  async detach(
    scope: RetentionCompletionScope,
    requestId: string,
    input: {
      expectedVersion: number;
      idempotencyKey?: string;
      attestation: unknown;
    },
  ): Promise<RetentionCompletionSnapshot> {
    assertScope(scope);
    this.#assertActivated();
    const idempotencyKey = boundedSecret(input.idempotencyKey, 16);
    const attestation = boundedAttestation(input.attestation);
    return this.#repository.detach(
      scope,
      assertId(requestId),
      {
        expectedVersion: expectedVersion(input.expectedVersion),
        idempotencyKeySha256: idempotencyDigest({
          scope,
          phase: "detach",
          resourceId: requestId,
          key: idempotencyKey,
        }),
        attestationSha256: sha256Hex(attestation),
      },
      permissions(),
    );
  }

  async reconcile(
    scope: RetentionCompletionScope,
    actionId: string,
    input: {
      expectedVersion: number;
      idempotencyKey?: string;
      attestation: unknown;
    },
  ): Promise<RetentionCompletionSnapshot> {
    assertScope(scope);
    this.#assertActivated();
    const idempotencyKey = boundedSecret(input.idempotencyKey, 16);
    const attestation = boundedAttestation(input.attestation);
    return this.#repository.reconcile(
      scope,
      assertId(actionId),
      {
        expectedVersion: expectedVersion(input.expectedVersion),
        idempotencyKeySha256: idempotencyDigest({
          scope,
          phase: "reconcile",
          resourceId: actionId,
          key: idempotencyKey,
        }),
        attestationSha256: sha256Hex(attestation),
      },
      permissions(),
    );
  }

  async certify(
    scope: RetentionCompletionScope,
    actionId: string,
    input: {
      expectedVersion: number;
      idempotencyKey?: string;
      attestation: unknown;
    },
  ): Promise<RetentionCompletionSnapshot> {
    assertScope(scope);
    this.#assertActivated();
    const idempotencyKey = boundedSecret(input.idempotencyKey, 16);
    const attestation = boundedAttestation(input.attestation);
    return this.#repository.certify(
      scope,
      assertId(actionId),
      {
        expectedVersion: expectedVersion(input.expectedVersion),
        idempotencyKeySha256: idempotencyDigest({
          scope,
          phase: "certify",
          resourceId: actionId,
          key: idempotencyKey,
        }),
        attestationSha256: sha256Hex(attestation),
      },
      permissions(),
    );
  }
}
