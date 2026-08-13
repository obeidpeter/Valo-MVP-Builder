import {
  CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES,
  ClientActionUploadContractError,
  GOVERNED_CLIENT_UPLOAD_MIME_TYPES,
  adaptClientActionUploadFinalizationReceipt,
  adaptClientActionUploadLeaseGrant,
  type ClientActionUploadBinding,
  type ClientActionUploadFinalizationReceipt,
  type ClientActionUploadLeaseGrant,
} from "./client-action-upload-contract";

export type ClientActionUploadRetry =
  | "same_operation"
  | "new_lease"
  | "reload_scope"
  | "none";

export type ClientActionUploadPhase =
  | "checking"
  | "leasing"
  | "lease_ready"
  | "transferring"
  | "finalizing"
  | "completed";

export type ClientActionUploadProgress =
  | { phase: "checking" | "leasing" | "transferring" | "finalizing" }
  | {
      phase: "lease_ready";
      leaseId: string;
      expiresAt: string;
      replayed: boolean;
      lateRewriteClosure: "bounded-cushion-and-post-expiry-reconcile";
    }
  | {
      phase: "completed";
      receipt: ClientActionUploadFinalizationReceipt;
    };

export interface ClientActionUploadFile extends Blob {
  readonly name: string;
}

export interface RunClientActionUploadInput {
  binding: ClientActionUploadBinding;
  file: ClientActionUploadFile;
  idempotencyKey: string;
}

export interface RunClientActionUploadDependencies {
  assertCurrent(): void;
  issueLease(input: {
    binding: ClientActionUploadBinding;
    idempotencyKey: string;
  }): Promise<unknown>;
  putSignedObject(
    uploadUrl: string,
    init: RequestInit,
  ): Promise<Pick<Response, "ok" | "status" | "statusText">>;
  finalize(input: {
    binding: ClientActionUploadBinding;
    lease: ClientActionUploadLeaseGrant;
    idempotencyKey: string;
  }): Promise<unknown>;
  digest?(bytes: ArrayBuffer): Promise<string>;
  onProgress?(progress: ClientActionUploadProgress): void;
}

export class ClientActionUploadFlowError extends Error {
  constructor(
    message: string,
    readonly phase: ClientActionUploadPhase,
    readonly retry: ClientActionUploadRetry,
    readonly serverLeaseMayExist: boolean,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ClientActionUploadFlowError";
  }
}

const SAFE_KEY = /^[^\u0000-\u001f\u007f\ud800-\udfff]{16,128}$/u;
const SAFE_FILENAME = /^[^/\\\u0000-\u001f\u007f\ud800-\udfff]{1,255}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GOVERNED_MIME = new Set<string>(GOVERNED_CLIENT_UPLOAD_MIME_TYPES);

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as Record<string, unknown>).code;
  return typeof code === "string" ? code : null;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function requestFailure(
  error: unknown,
  phase: "leasing" | "finalizing",
): ClientActionUploadFlowError {
  const code = errorCode(error);
  const status = errorStatus(error);
  const leaseMayExist = phase === "finalizing" || status === null;
  if (code === "expired" || status === 410) {
    return new ClientActionUploadFlowError(
      "The upload lease expired. Reload the exact request slot before requesting a new lease.",
      phase,
      "new_lease",
      true,
      error,
    );
  }
  if (
    ["scope_denied", "not_found", "stale_version", "conflict"].includes(
      code ?? "",
    ) ||
    [403, 404, 409].includes(status ?? 0)
  ) {
    return new ClientActionUploadFlowError(
      "The organisation, membership, project, request, slot, version, or intent is no longer current. Reload before retrying.",
      phase,
      "reload_scope",
      leaseMayExist,
      error,
    );
  }
  if (
    ["intake_rejected", "cleanup_unconfirmed"].includes(code ?? "") ||
    status === 422
  ) {
    return new ClientActionUploadFlowError(
      "Secure intake did not finalize this file. Do not retry blindly; reload the request and follow the server disposition.",
      phase,
      "none",
      true,
      error,
    );
  }
  if (code === "unavailable") {
    return new ClientActionUploadFlowError(
      phase === "leasing"
        ? "Governed upload issuance is not operationally activated. No signed transfer was started; reload only after an administrator confirms the lifecycle gate is open."
        : "Secure intake is operationally unavailable. Staged bytes may exist; reload the authoritative request and do not retry blindly.",
      phase,
      "none",
      phase === "finalizing",
      error,
    );
  }
  return new ClientActionUploadFlowError(
    phase === "leasing"
      ? "The lease result is unknown. Retry this same exact file and operation key; do not start a parallel upload."
      : "The finalization result is unknown. Retry the same exact operation so the server can replay its receipt.",
    phase,
    "same_operation",
    leaseMayExist,
    error,
  );
}

function assertCurrent(
  dependencies: RunClientActionUploadDependencies,
  phase: ClientActionUploadPhase,
  leaseMayExist: boolean,
): void {
  try {
    dependencies.assertCurrent();
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      "The organisation, membership, project, request, slot, version, or intent changed during upload. Reload before any retry.",
      phase,
      "reload_scope",
      leaseMayExist,
      cause,
    );
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function validateBinding(binding: ClientActionUploadBinding): void {
  const accepted =
    binding.acceptedContentTypes.length === 0 ||
    binding.acceptedContentTypes.includes(binding.contentType);
  if (
    binding.sizeBytes < 1 ||
    binding.sizeBytes > CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES ||
    !SAFE_FILENAME.test(binding.filename) ||
    !SHA256.test(binding.declaredSha256) ||
    !GOVERNED_MIME.has(binding.contentType) ||
    !accepted
  ) {
    throw new ClientActionUploadFlowError(
      "This upload intent is outside the governed file policy. Record a new valid intent before selecting bytes.",
      "checking",
      "reload_scope",
      false,
    );
  }
}

export async function runClientActionUpload(
  input: RunClientActionUploadInput,
  dependencies: RunClientActionUploadDependencies,
): Promise<ClientActionUploadFinalizationReceipt> {
  dependencies.onProgress?.({ phase: "checking" });
  assertCurrent(dependencies, "checking", false);
  validateBinding(input.binding);
  if (!SAFE_KEY.test(input.idempotencyKey)) {
    throw new ClientActionUploadFlowError(
      "The upload operation key is invalid.",
      "checking",
      "none",
      false,
    );
  }
  const contentType = input.file.type.trim().toLocaleLowerCase("en-US");
  if (
    input.file.name !== input.binding.filename ||
    input.file.size !== input.binding.sizeBytes ||
    contentType !== input.binding.contentType
  ) {
    throw new ClientActionUploadFlowError(
      "The selected file does not exactly match the acknowledged filename, byte count, and MIME type.",
      "checking",
      "none",
      false,
    );
  }

  let bytes: ArrayBuffer;
  let measuredSha256: string;
  try {
    bytes = await input.file.arrayBuffer();
    measuredSha256 = await (dependencies.digest ?? sha256)(bytes);
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      "The selected file could not be read and verified locally. No lease was requested.",
      "checking",
      "none",
      false,
      cause,
    );
  }
  assertCurrent(dependencies, "checking", false);
  if (
    bytes.byteLength !== input.binding.sizeBytes ||
    measuredSha256 !== input.binding.declaredSha256
  ) {
    throw new ClientActionUploadFlowError(
      "The selected bytes do not match the acknowledged SHA-256 and byte count. No lease was requested.",
      "checking",
      "none",
      false,
    );
  }

  dependencies.onProgress?.({ phase: "leasing" });
  let lease: ClientActionUploadLeaseGrant;
  try {
    const rawLease = await dependencies.issueLease({
      binding: input.binding,
      idempotencyKey: input.idempotencyKey,
    });
    assertCurrent(dependencies, "leasing", true);
    lease = adaptClientActionUploadLeaseGrant(rawLease, input.binding);
  } catch (error) {
    if (error instanceof ClientActionUploadFlowError) throw error;
    if (error instanceof ClientActionUploadContractError) {
      throw new ClientActionUploadFlowError(
        "The upload lease response failed its exact binding checks. No bytes were transferred; server expiry and reconciliation remain authoritative.",
        "leasing",
        "none",
        true,
        error,
      );
    }
    throw requestFailure(error, "leasing");
  }
  dependencies.onProgress?.({
    phase: "lease_ready",
    leaseId: lease.leaseId,
    expiresAt: lease.expiresAt,
    replayed: lease.replayed,
    lateRewriteClosure: lease.lateRewriteClosure,
  });
  assertCurrent(dependencies, "lease_ready", true);

  dependencies.onProgress?.({ phase: "transferring" });
  let uploadResponse: Pick<Response, "ok" | "status" | "statusText">;
  try {
    uploadResponse = await dependencies.putSignedObject(lease.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": lease.contentType },
      body: input.file,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
    });
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      "The signed transfer result is unknown. Retry the same exact operation while its lease is current; staged bytes remain server-governed.",
      "transferring",
      "same_operation",
      true,
      cause,
    );
  }
  if (!uploadResponse.ok) {
    throw new ClientActionUploadFlowError(
      `Signed storage rejected the transfer (${uploadResponse.status}). Retry the same exact operation while its lease is current.`,
      "transferring",
      "same_operation",
      true,
    );
  }
  assertCurrent(dependencies, "transferring", true);

  dependencies.onProgress?.({ phase: "finalizing" });
  let receipt: ClientActionUploadFinalizationReceipt;
  try {
    const rawReceipt = await dependencies.finalize({
      binding: input.binding,
      lease,
      idempotencyKey: input.idempotencyKey,
    });
    assertCurrent(dependencies, "finalizing", true);
    receipt = adaptClientActionUploadFinalizationReceipt(
      rawReceipt,
      input.binding,
      lease,
    );
  } catch (error) {
    if (error instanceof ClientActionUploadFlowError) throw error;
    if (error instanceof ClientActionUploadContractError) {
      throw new ClientActionUploadFlowError(
        "The final receipt failed its exact binding checks. Reload the request to reconcile the authoritative server state; do not retry blindly.",
        "finalizing",
        "none",
        true,
        error,
      );
    }
    throw requestFailure(error, "finalizing");
  }
  dependencies.onProgress?.({ phase: "completed", receipt });
  return receipt;
}
