export type DocumentUploadType =
  | "tender"
  | "bid"
  | "certificate"
  | "boq"
  | "evidence"
  | "other";

export interface SignedUploadTarget {
  uploadURL: string;
  objectPath: string;
}

export interface DocumentRecordInput {
  type: DocumentUploadType;
  filename: string;
  objectPath: string;
  contentType: string;
  size: number;
  redactionStatus: "excluded";
}

export interface DiscardUploadedObjectResult {
  disposition: "deleted" | "already_absent";
  quarantineMayRetainCopy: boolean;
}

interface IntakeFailureDetails {
  storedObjectDisposition: string | null;
  quarantineRetained: boolean | null | undefined;
  cleanupConfirmed: boolean | null;
  findings: string[];
  responseReceived: boolean;
}

function intakeFailureDetails(cause: unknown): IntakeFailureDetails {
  const data =
    cause && typeof cause === "object" && "data" in cause
      ? (cause as { data?: unknown }).data
      : null;
  if (!data || typeof data !== "object") {
    return {
      storedObjectDisposition: null,
      quarantineRetained: undefined,
      cleanupConfirmed: null,
      findings: [],
      responseReceived: false,
    };
  }
  const record = data as Record<string, unknown>;
  return {
    storedObjectDisposition:
      typeof record.storedObjectDisposition === "string"
        ? record.storedObjectDisposition.slice(0, 200)
        : null,
    quarantineRetained:
      typeof record.quarantineRetained === "boolean"
        ? record.quarantineRetained
        : record.quarantineRetained === null
          ? null
          : undefined,
    cleanupConfirmed:
      typeof record.cleanupConfirmed === "boolean"
        ? record.cleanupConfirmed
        : null,
    findings: Array.isArray(record.findings)
      ? record.findings
          .filter((finding): finding is string => typeof finding === "string")
          .slice(0, 8)
          .map((finding) => finding.slice(0, 80))
      : [],
    responseReceived: true,
  };
}

function confirmedCleanupMessage(
  result: DiscardUploadedObjectResult,
  intake: IntakeFailureDetails,
): string {
  if (result.disposition === "deleted") {
    return "The unreferenced staging object was purged; you can retry.";
  }
  if (intake.quarantineRetained) {
    return "No object remained at the original staging path; the controlled security-quarantine copy remains retained. You can retry.";
  }
  if (intake.storedObjectDisposition) {
    return `No object remained at the original staging path. Secure intake reported storage disposition “${intake.storedObjectDisposition}”. You can retry.`;
  }
  return "No object remained at the original staging path; a controlled security-quarantine copy may still be retained. You can retry.";
}

export interface CompleteDocumentUploadOptions {
  projectId: string;
  file: File;
  requestUploadTarget: (input: {
    name: string;
    size: number;
    contentType: string;
  }) => Promise<SignedUploadTarget>;
  createDocumentRecord: (input: {
    id: string;
    data: DocumentRecordInput;
  }) => Promise<unknown>;
  discardUploadedObject: (input: {
    objectPath: string;
  }) => Promise<DiscardUploadedObjectResult>;
  fetchImpl?: typeof fetch;
}

export class SignedUploadError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    const detail = statusText.trim() || "object storage rejected the request";
    super(
      `Secure file transfer failed (${status} ${detail}). No document record was created.`,
    );
    this.name = "SignedUploadError";
    this.status = status;
  }
}

export class SignedUploadOutcomeUnknownError extends Error {
  readonly transferCause: unknown;
  readonly cleanupConfirmed: boolean;
  readonly cleanupDisposition:
    | DiscardUploadedObjectResult["disposition"]
    | null;
  readonly retrySafe = false;

  constructor(
    transferCause: unknown,
    cleanup:
      | { confirmed: true; result: DiscardUploadedObjectResult }
      | { confirmed: false; cause: unknown },
  ) {
    super(
      cleanup.confirmed
        ? "The signed transfer response was lost, so completion cannot be confirmed. Staging cleanup ran, but a late storage write may still arrive. Retry is paused pending administrator reconciliation."
        : "The signed transfer response was lost, and staging cleanup could not be confirmed. Retry is paused pending administrator reconciliation.",
    );
    this.name = "SignedUploadOutcomeUnknownError";
    this.transferCause = transferCause;
    this.cleanupConfirmed = cleanup.confirmed;
    this.cleanupDisposition = cleanup.confirmed
      ? cleanup.result.disposition
      : null;
  }
}

export class DocumentRegistrationError extends Error {
  readonly cleanupConfirmed: boolean;
  readonly registrationCause: unknown;
  readonly cleanupCause: unknown;
  readonly cleanupDisposition:
    | DiscardUploadedObjectResult["disposition"]
    | null;
  readonly quarantineMayRetainCopy: boolean;
  readonly intakeDisposition: string | null;
  readonly intakeFindings: string[];
  readonly retrySafe: boolean;

  constructor(
    registrationCause: unknown,
    cleanupConfirmed: boolean,
    cleanupCause?: unknown,
    cleanupResult?: DiscardUploadedObjectResult,
  ) {
    const intake = intakeFailureDetails(registrationCause);
    // A staging DELETE cannot prove that promotion/registration did not
    // commit when the create response was lost. Only a structured server
    // rejection can confirm the finalisation outcome, and an explicit
    // cleanupConfirmed=false always wins over staging cleanup.
    const endToEndCleanupConfirmed =
      cleanupConfirmed &&
      intake.responseReceived &&
      intake.cleanupConfirmed !== false &&
      // A null quarantine-retention disposition means the copy operation may
      // have committed but its acknowledgement/probe was lost. Staging cleanup
      // cannot make that distributed outcome safe to retry.
      intake.quarantineRetained !== null;
    const findingSummary = intake.findings.length
      ? ` Secure-intake findings: ${intake.findings.join(", ")}.`
      : "";
    const dispositionSummary = intake.storedObjectDisposition
      ? ` Server storage disposition: “${intake.storedObjectDisposition}”.`
      : "";
    super(
      endToEndCleanupConfirmed && cleanupResult
        ? `The file transfer completed, but the server rejected document registration.${findingSummary} ${confirmedCleanupMessage(cleanupResult, intake)}`
        : `The file transfer completed, but the document registration result and end-to-end cleanup could not be confirmed.${findingSummary}${dispositionSummary} Refresh the document list and contact an administrator before retrying.`,
    );
    this.name = "DocumentRegistrationError";
    this.cleanupConfirmed = endToEndCleanupConfirmed;
    this.registrationCause = registrationCause;
    this.cleanupCause = cleanupCause;
    this.cleanupDisposition = cleanupResult?.disposition ?? null;
    this.quarantineMayRetainCopy =
      cleanupResult?.quarantineMayRetainCopy ?? false;
    this.intakeDisposition = intake.storedObjectDisposition;
    this.intakeFindings = intake.findings;
    this.retrySafe = endToEndCleanupConfirmed;
  }
}

async function discardAfterFailure(
  objectPath: string,
  discardUploadedObject: (input: {
    objectPath: string;
  }) => Promise<DiscardUploadedObjectResult>,
): Promise<
  | { confirmed: true; result: DiscardUploadedObjectResult }
  | { confirmed: false; cause: unknown }
> {
  try {
    const result = await discardUploadedObject({ objectPath });
    if (
      !result ||
      !["deleted", "already_absent"].includes(result.disposition) ||
      typeof result.quarantineMayRetainCopy !== "boolean"
    ) {
      throw new Error("Cleanup endpoint returned an invalid disposition");
    }
    return { confirmed: true, result };
  } catch (cause) {
    return { confirmed: false, cause };
  }
}

/** Infer a conservative default document type from the filename. */
export function guessDocumentType(name: string): DocumentUploadType {
  const normalized = name.toLowerCase();
  if (
    /\b(boq|bill.*quant)\b/.test(normalized) ||
    /\.(xlsx|xls|csv)$/.test(normalized)
  ) {
    return "boq";
  }
  if (/tender|rfp|itt|invitation/.test(normalized)) return "tender";
  if (/bid|proposal|submission/.test(normalized)) return "bid";
  if (/cert|licen|clearance|pencom|cac/.test(normalized)) return "certificate";
  return "other";
}

/**
 * Complete the two-phase upload contract.
 *
 * The metadata record is deliberately created only after object storage has
 * acknowledged the signed PUT with a 2xx response. A rejected or interrupted
 * PUT therefore cannot leave a database row pointing at a missing object.
 */
export async function completeDocumentUpload({
  projectId,
  file,
  requestUploadTarget,
  createDocumentRecord,
  discardUploadedObject,
  fetchImpl = fetch,
}: CompleteDocumentUploadOptions): Promise<void> {
  const { uploadURL, objectPath } = await requestUploadTarget({
    name: file.name,
    size: file.size,
    contentType: file.type,
  });

  let uploadResponse: Response;
  try {
    uploadResponse = await fetchImpl(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch (transferCause) {
    const cleanup = await discardAfterFailure(
      objectPath,
      discardUploadedObject,
    );
    throw new SignedUploadOutcomeUnknownError(transferCause, cleanup);
  }

  if (!uploadResponse.ok) {
    const transferError = new SignedUploadError(
      uploadResponse.status,
      uploadResponse.statusText,
    );
    const cleanup = await discardAfterFailure(
      objectPath,
      discardUploadedObject,
    );
    if (!cleanup.confirmed) {
      throw new DocumentRegistrationError(transferError, false, cleanup.cause);
    }
    throw transferError;
  }

  try {
    await createDocumentRecord({
      id: projectId,
      data: {
        type: guessDocumentType(file.name),
        filename: file.name,
        objectPath,
        contentType: file.type,
        size: file.size,
        // Confidentiality is fail-closed: a reviewer must explicitly promote
        // the document before extraction or other AI-assisted processing.
        redactionStatus: "excluded",
      },
    });
  } catch (registrationCause) {
    const cleanup = await discardAfterFailure(
      objectPath,
      discardUploadedObject,
    );
    throw new DocumentRegistrationError(
      registrationCause,
      cleanup.confirmed,
      cleanup.confirmed ? undefined : cleanup.cause,
      cleanup.confirmed ? cleanup.result : undefined,
    );
  }
}
