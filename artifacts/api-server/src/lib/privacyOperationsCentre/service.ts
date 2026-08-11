import { createHash } from "node:crypto";
import {
  PRIVACY_DSR_REASON_CODES,
  PRIVACY_DSR_STATUSES,
  PRIVACY_HOLD_REVIEW_OUTCOMES,
  PRIVACY_IDENTITY_STATUSES,
  PRIVACY_OPERATIONS_AUDIT_SCHEMA,
  PRIVACY_OPERATIONS_MAX_ITEMS,
  PrivacyOperationsRepositoryUnavailableError,
  type PrivacyAuditRow,
  type PrivacyConsentItem,
  type PrivacyConsentWithdrawalCommand,
  type PrivacyConsentWithdrawalDraft,
  type PrivacyDeletionItem,
  type PrivacyDsrItem,
  type PrivacyDsrTriageCommand,
  type PrivacyDsrTriageDraft,
  type PrivacyEvidenceState,
  type PrivacyHoldReviewCommand,
  type PrivacyHoldReviewDraft,
  type PrivacyLegalHoldItem,
  type PrivacyMutationOutcome,
  type PrivacyOperationsDashboard,
  type PrivacyOperationsRawDashboard,
  type PrivacyOperationsRepository,
  type PrivacyOperationsScope,
  type PrivacyReviewPosture,
  type PrivacySubprocessorItem,
  type PrivacyTransferItem,
  type PrivacyWorkflowReceipt,
} from "./contracts";

export const PRIVACY_OPERATIONS_AUTHORITY_NOTE =
  "This centre organises minimised operational evidence for named human reviewers. It does not contact providers, establish identity, decide legal rights, release a hold, delete data or make a legal conclusion.";

const SHA256 = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_HOLD_REVIEW_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;
const DUE_SOON_MS = 3 * 24 * 60 * 60 * 1_000;
const REVIEW_DUE_SOON_MS = 30 * 24 * 60 * 60 * 1_000;
const SAFE_DSR_REQUEST_TYPES = new Set([
  "access",
  "erasure",
  "correction",
  "portability",
  "restriction",
  "objection",
  "complaint",
]);
const SAFE_DSR_STORED_STATUSES = new Set([
  ...PRIVACY_DSR_STATUSES,
  "completed",
  "rejected",
  "cancelled",
]);
const SAFE_IDENTITY_STORED_STATUSES = new Set([
  ...PRIVACY_IDENTITY_STATUSES,
  "not_required",
]);

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

type PrivacyWorkflowEventType = PrivacyWorkflowReceipt["eventType"];
const WORKFLOW_EVENT_TYPES = new Set<PrivacyWorkflowEventType>([
  "privacy.dsr_triage_recorded",
  "privacy.consent_withdrawal_recorded",
  "privacy.legal_hold_review_recorded",
]);

interface PrivacyWorkflowEvidence {
  eventType: PrivacyWorkflowEventType;
  objectId: string;
  actorUserId: string;
  recordedAt: string;
  resultingVersion: number;
  payload: Readonly<Record<string, CanonicalValue>>;
}

interface ParsedAuditDetails extends PrivacyWorkflowEvidence {
  receiptSha256: string;
}

export class PrivacyOperationsValidationError extends Error {
  readonly name = "PrivacyOperationsValidationError";

  constructor(
    readonly code:
      | "INVALID_IDENTIFIER"
      | "INVALID_VERSION"
      | "INVALID_TIME"
      | "INVALID_REVIEW_WINDOW",
  ) {
    super(code);
  }
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, CanonicalValue>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(",")}}`;
}

function workflowDigest(evidence: PrivacyWorkflowEvidence): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        schema: PRIVACY_OPERATIONS_AUDIT_SCHEMA,
        ...evidence,
      }),
    )
    .digest("hex");
}

export function createPrivacyWorkflowAuditDetails(
  evidence: PrivacyWorkflowEvidence,
): { details: string; receipt: PrivacyWorkflowReceipt } {
  const receiptSha256 = workflowDigest(evidence);
  return {
    details: canonicalJson({
      schema: PRIVACY_OPERATIONS_AUDIT_SCHEMA,
      ...evidence,
      receiptSha256,
    }),
    receipt: {
      receiptSha256,
      eventType: evidence.eventType,
      objectId: evidence.objectId,
      actorUserId: evidence.actorUserId,
      recordedAt: evidence.recordedAt,
      resultingVersion: evidence.resultingVersion,
      legalDecisionAutomated: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index])
  );
}

function parseIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parsePrivacyDsrTriageDraft(
  value: unknown,
): PrivacyDsrTriageDraft | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "assignedToUserId",
      "decisionEvidenceSha256",
      "identityVerificationStatus",
      "reasonCode",
      "status",
    ]) ||
    typeof value.status !== "string" ||
    !PRIVACY_DSR_STATUSES.includes(
      value.status as PrivacyDsrTriageDraft["status"],
    ) ||
    typeof value.identityVerificationStatus !== "string" ||
    !PRIVACY_IDENTITY_STATUSES.includes(
      value.identityVerificationStatus as PrivacyDsrTriageDraft["identityVerificationStatus"],
    ) ||
    !isUuid(value.assignedToUserId) ||
    typeof value.reasonCode !== "string" ||
    !PRIVACY_DSR_REASON_CODES.includes(
      value.reasonCode as PrivacyDsrTriageDraft["reasonCode"],
    ) ||
    !isSha256(value.decisionEvidenceSha256)
  ) {
    return null;
  }
  return value as unknown as PrivacyDsrTriageDraft;
}

export function parsePrivacyConsentWithdrawalDraft(
  value: unknown,
): PrivacyConsentWithdrawalDraft | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["evidenceSha256", "withdrawnAt"]) ||
    !isSha256(value.evidenceSha256)
  ) {
    return null;
  }
  const withdrawnAt = parseIso(value.withdrawnAt);
  return withdrawnAt
    ? { withdrawnAt, evidenceSha256: value.evidenceSha256 }
    : null;
}

export function parsePrivacyHoldReviewDraft(
  value: unknown,
): PrivacyHoldReviewDraft | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["evidenceSha256", "nextReviewAt", "reviewOutcome"]) ||
    typeof value.reviewOutcome !== "string" ||
    !PRIVACY_HOLD_REVIEW_OUTCOMES.includes(
      value.reviewOutcome as PrivacyHoldReviewDraft["reviewOutcome"],
    ) ||
    !isSha256(value.evidenceSha256)
  ) {
    return null;
  }
  const nextReviewAt = parseIso(value.nextReviewAt);
  return nextReviewAt
    ? {
        reviewOutcome:
          value.reviewOutcome as PrivacyHoldReviewDraft["reviewOutcome"],
        nextReviewAt,
        evidenceSha256: value.evidenceSha256,
      }
    : null;
}

function assertCommandBoundary(input: {
  id: string;
  expectedVersion: number;
  now: Date;
}): string {
  if (!isUuid(input.id)) {
    throw new PrivacyOperationsValidationError("INVALID_IDENTIFIER");
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new PrivacyOperationsValidationError("INVALID_VERSION");
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new PrivacyOperationsValidationError("INVALID_TIME");
  }
  return input.now.toISOString();
}

function verifyWorkflowResult(
  result: PrivacyMutationOutcome,
  evidence: Omit<PrivacyWorkflowEvidence, "resultingVersion">,
): PrivacyMutationOutcome {
  if (result.outcome !== "updated") return result;
  if (
    !Number.isInteger(result.resultingVersion) ||
    result.resultingVersion < 1
  ) {
    throw new PrivacyOperationsRepositoryUnavailableError(
      "Privacy workflow returned an invalid version",
    );
  }
  const expected = createPrivacyWorkflowAuditDetails({
    ...evidence,
    resultingVersion: result.resultingVersion,
  }).receipt;
  if (
    result.receipt.receiptSha256 !== expected.receiptSha256 ||
    result.receipt.eventType !== expected.eventType ||
    result.receipt.objectId !== expected.objectId ||
    result.receipt.actorUserId !== expected.actorUserId ||
    result.receipt.recordedAt !== expected.recordedAt ||
    result.receipt.resultingVersion !== expected.resultingVersion ||
    result.receipt.legalDecisionAutomated !== false
  ) {
    throw new PrivacyOperationsRepositoryUnavailableError(
      "Privacy workflow receipt failed deterministic verification",
    );
  }
  return result;
}

export async function triagePrivacyDsr(input: {
  repository: PrivacyOperationsRepository;
  scope: PrivacyOperationsScope;
  id: string;
  expectedVersion: number;
  draft: PrivacyDsrTriageDraft;
  now: Date;
}): Promise<PrivacyMutationOutcome> {
  const recordedAt = assertCommandBoundary(input);
  const command: PrivacyDsrTriageCommand = {
    id: input.id,
    expectedVersion: input.expectedVersion,
    recordedAt,
    ...input.draft,
  };
  const result = await input.repository.triageDataSubjectRequest(
    input.scope,
    command,
  );
  return verifyWorkflowResult(result, {
    eventType: "privacy.dsr_triage_recorded",
    objectId: command.id,
    actorUserId: input.scope.actorUserId,
    recordedAt: command.recordedAt,
    payload: {
      assignedToUserId: command.assignedToUserId,
      decisionEvidenceSha256: command.decisionEvidenceSha256,
      expectedVersion: command.expectedVersion,
      identityVerificationStatus: command.identityVerificationStatus,
      reasonCode: command.reasonCode,
      status: command.status,
    },
  });
}

export async function recordPrivacyConsentWithdrawal(input: {
  repository: PrivacyOperationsRepository;
  scope: PrivacyOperationsScope;
  id: string;
  expectedVersion: number;
  draft: PrivacyConsentWithdrawalDraft;
  now: Date;
}): Promise<PrivacyMutationOutcome> {
  const recordedAt = assertCommandBoundary(input);
  const withdrawnAtMs = Date.parse(input.draft.withdrawnAt);
  if (
    !Number.isFinite(withdrawnAtMs) ||
    withdrawnAtMs > input.now.getTime() + MAX_FUTURE_SKEW_MS
  ) {
    throw new PrivacyOperationsValidationError("INVALID_TIME");
  }
  const command: PrivacyConsentWithdrawalCommand = {
    id: input.id,
    expectedVersion: input.expectedVersion,
    recordedAt,
    ...input.draft,
  };
  const result = await input.repository.recordConsentWithdrawal(
    input.scope,
    command,
  );
  return verifyWorkflowResult(result, {
    eventType: "privacy.consent_withdrawal_recorded",
    objectId: command.id,
    actorUserId: input.scope.actorUserId,
    recordedAt: command.recordedAt,
    payload: {
      evidenceSha256: command.evidenceSha256,
      expectedVersion: command.expectedVersion,
      withdrawnAt: command.withdrawnAt,
    },
  });
}

export async function recordPrivacyLegalHoldReview(input: {
  repository: PrivacyOperationsRepository;
  scope: PrivacyOperationsScope;
  id: string;
  expectedVersion: number;
  draft: PrivacyHoldReviewDraft;
  now: Date;
}): Promise<PrivacyMutationOutcome> {
  const recordedAt = assertCommandBoundary(input);
  const nextReviewMs = Date.parse(input.draft.nextReviewAt);
  const nowMs = input.now.getTime();
  if (
    !Number.isFinite(nextReviewMs) ||
    nextReviewMs <= nowMs ||
    nextReviewMs - nowMs > MAX_HOLD_REVIEW_WINDOW_MS
  ) {
    throw new PrivacyOperationsValidationError("INVALID_REVIEW_WINDOW");
  }
  const command: PrivacyHoldReviewCommand = {
    id: input.id,
    expectedVersion: input.expectedVersion,
    recordedAt,
    ...input.draft,
  };
  const result = await input.repository.recordLegalHoldReview(
    input.scope,
    command,
  );
  return verifyWorkflowResult(result, {
    eventType: "privacy.legal_hold_review_recorded",
    objectId: command.id,
    actorUserId: input.scope.actorUserId,
    recordedAt: command.recordedAt,
    payload: {
      evidenceSha256: command.evidenceSha256,
      expectedVersion: command.expectedVersion,
      nextReviewAt: command.nextReviewAt,
      reviewOutcome: command.reviewOutcome,
    },
  });
}

function safeStoredValue(value: string, allowed: ReadonlySet<string>): string {
  return allowed.has(value) ? value : "unknown";
}

function evidenceState(
  present: boolean,
  digest: string | null,
): PrivacyEvidenceState {
  if (!present) return "missing";
  return isSha256(digest) ? "verified" : "invalid";
}

function reviewPosture(
  nextReviewAt: Date | null,
  nowMs: number,
): PrivacyReviewPosture {
  if (!nextReviewAt) return "missing_review_date";
  const dueMs = nextReviewAt.getTime();
  if (!Number.isFinite(dueMs) || dueMs <= nowMs) return "overdue";
  return dueMs - nowMs <= REVIEW_DUE_SOON_MS ? "due_soon" : "current";
}

function validWorkflowPayload(
  eventType: PrivacyWorkflowEventType,
  payload: Record<string, unknown>,
): boolean {
  if (eventType === "privacy.dsr_triage_recorded") {
    return Boolean(
      exactKeys(payload, [
        "assignedToUserId",
        "decisionEvidenceSha256",
        "expectedVersion",
        "identityVerificationStatus",
        "reasonCode",
        "status",
      ]) &&
      isUuid(payload.assignedToUserId) &&
      isSha256(payload.decisionEvidenceSha256) &&
      Number.isInteger(payload.expectedVersion) &&
      Number(payload.expectedVersion) > 0 &&
      typeof payload.identityVerificationStatus === "string" &&
      PRIVACY_IDENTITY_STATUSES.includes(
        payload.identityVerificationStatus as PrivacyDsrTriageDraft["identityVerificationStatus"],
      ) &&
      typeof payload.reasonCode === "string" &&
      PRIVACY_DSR_REASON_CODES.includes(
        payload.reasonCode as PrivacyDsrTriageDraft["reasonCode"],
      ) &&
      typeof payload.status === "string" &&
      PRIVACY_DSR_STATUSES.includes(
        payload.status as PrivacyDsrTriageDraft["status"],
      ),
    );
  }
  if (eventType === "privacy.consent_withdrawal_recorded") {
    return Boolean(
      exactKeys(payload, [
        "evidenceSha256",
        "expectedVersion",
        "withdrawnAt",
      ]) &&
      isSha256(payload.evidenceSha256) &&
      Number.isInteger(payload.expectedVersion) &&
      Number(payload.expectedVersion) > 0 &&
      parseIso(payload.withdrawnAt),
    );
  }
  return Boolean(
    exactKeys(payload, [
      "evidenceSha256",
      "expectedVersion",
      "nextReviewAt",
      "reviewOutcome",
    ]) &&
    isSha256(payload.evidenceSha256) &&
    Number.isInteger(payload.expectedVersion) &&
    Number(payload.expectedVersion) > 0 &&
    parseIso(payload.nextReviewAt) &&
    typeof payload.reviewOutcome === "string" &&
    PRIVACY_HOLD_REVIEW_OUTCOMES.includes(
      payload.reviewOutcome as PrivacyHoldReviewDraft["reviewOutcome"],
    ),
  );
}

function parseAuditDetails(row: PrivacyAuditRow): ParsedAuditDetails | null {
  if (!row.details || !isSha256(row.hash)) return null;
  try {
    const value: unknown = JSON.parse(row.details);
    if (
      !isRecord(value) ||
      !exactKeys(value, [
        "actorUserId",
        "eventType",
        "objectId",
        "payload",
        "receiptSha256",
        "recordedAt",
        "resultingVersion",
        "schema",
      ]) ||
      value.schema !== PRIVACY_OPERATIONS_AUDIT_SCHEMA ||
      value.eventType !== row.eventType ||
      !WORKFLOW_EVENT_TYPES.has(value.eventType as PrivacyWorkflowEventType) ||
      value.objectId !== row.objectId ||
      !isUuid(value.objectId) ||
      !isUuid(value.actorUserId) ||
      !parseIso(value.recordedAt) ||
      !Number.isInteger(value.resultingVersion) ||
      Number(value.resultingVersion) < 1 ||
      !isRecord(value.payload) ||
      !validWorkflowPayload(
        value.eventType as PrivacyWorkflowEventType,
        value.payload,
      ) ||
      !isSha256(value.receiptSha256)
    ) {
      return null;
    }
    const evidence: PrivacyWorkflowEvidence = {
      eventType: value.eventType as PrivacyWorkflowEventType,
      objectId: value.objectId,
      actorUserId: value.actorUserId,
      recordedAt: new Date(String(value.recordedAt)).toISOString(),
      resultingVersion: Number(value.resultingVersion),
      payload: value.payload as Record<string, CanonicalValue>,
    };
    return workflowDigest(evidence) === value.receiptSha256
      ? { ...evidence, receiptSha256: value.receiptSha256 }
      : null;
  } catch {
    return null;
  }
}

function latestAudit(
  rows: readonly PrivacyAuditRow[],
  eventType: PrivacyWorkflowEventType,
  objectId: string,
): { parsed: ParsedAuditDetails | null; malformed: boolean } {
  const matching = rows
    .filter((row) => row.eventType === eventType && row.objectId === objectId)
    .sort((left, right) => right.seq - left.seq);
  if (matching.length === 0) return { parsed: null, malformed: false };
  const parsed = parseAuditDetails(matching[0]!);
  return { parsed, malformed: !parsed };
}

function assertRawDashboard(
  raw: PrivacyOperationsRawDashboard,
  organisationId: string,
  limit: number,
): void {
  const collections = [
    raw.dataSubjectRequests,
    raw.consentRecords,
    raw.legalHolds,
    raw.subprocessors,
    raw.crossBorderTransfers,
    raw.deletionActions,
  ];
  if (
    collections.some((rows) => rows.length > limit + 1) ||
    raw.auditRows.length > Math.min((limit + 1) * 4, 204) ||
    collections.some((rows) =>
      rows.some((row) => row.organisationId !== organisationId),
    ) ||
    raw.dataSubjectRequests.some(
      (row) =>
        row.requestType.length > 64 ||
        row.identityVerificationStatus.length > 64 ||
        row.status.length > 64,
    ) ||
    raw.consentRecords.some((row) => row.evidenceHash.length > 64) ||
    raw.legalHolds.some((row) => row.status.length > 64) ||
    raw.subprocessors.some(
      (row) =>
        row.legalName.length > 160 ||
        row.service.length > 160 ||
        row.countryCode.length > 8 ||
        row.dpaStatus.length > 64 ||
        row.securityReviewStatus.length > 64,
    ) ||
    raw.crossBorderTransfers.some(
      (row) =>
        row.originCountry.length > 8 ||
        row.destinationCountry.length > 8 ||
        row.transferBasis.length > 128 ||
        row.legalReviewStatus.length > 64,
    ) ||
    raw.deletionActions.some((row) => row.status.length > 64) ||
    raw.auditRows.some((row) => row.organisationId !== organisationId) ||
    raw.auditRows.some(
      (row) => row.details !== null && row.details.length > 4_000,
    ) ||
    Object.values(raw.totals).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    throw new PrivacyOperationsRepositoryUnavailableError(
      "Privacy dashboard failed tenant or bound validation",
    );
  }
}

function dateIso(value: Date | null): string | null {
  if (!value) return null;
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new PrivacyOperationsRepositoryUnavailableError(
      "Privacy dashboard contains an invalid date",
    );
  }
  return value.toISOString();
}

function deletionItem(
  row: PrivacyOperationsRawDashboard["deletionActions"][number],
): PrivacyDeletionItem {
  const certificates = row.certificates;
  const certificate = certificates.length === 1 ? certificates[0]! : null;
  const completed = row.status === "completed" || row.executedAt !== null;
  const validCertificate = Boolean(
    certificate &&
    isSha256(certificate.scopeManifestHash) &&
    certificate.signatureEvidencePresent,
  );
  const receiptState =
    certificates.length > 1
      ? "invalid"
      : validCertificate
        ? "recorded"
        : completed
          ? "missing"
          : "pending";
  return {
    id: row.id,
    status: row.status,
    held: row.legalHoldId !== null,
    executedByUserId: row.executedByUserId,
    executedAt: dateIso(row.executedAt),
    receiptState,
    scopeManifestSha256: validCertificate
      ? certificate!.scopeManifestHash
      : null,
    signedByUserId: validCertificate ? certificate!.signedByUserId : null,
    completedAt: validCertificate ? dateIso(certificate!.completedAt) : null,
    version: row.version,
    updatedAt: dateIso(row.updatedAt)!,
  };
}

export function buildPrivacyOperationsDashboard(input: {
  raw: PrivacyOperationsRawDashboard;
  scope: PrivacyOperationsScope;
  limit: number;
  now: Date;
}): PrivacyOperationsDashboard {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > PRIVACY_OPERATIONS_MAX_ITEMS ||
    !Number.isFinite(input.now.getTime())
  ) {
    throw new PrivacyOperationsValidationError("INVALID_VERSION");
  }
  assertRawDashboard(input.raw, input.scope.organisationId, input.limit);
  const nowMs = input.now.getTime();
  const take = <T>(rows: readonly T[]) => rows.slice(0, input.limit);

  const dataSubjectRequests: PrivacyDsrItem[] = take(
    input.raw.dataSubjectRequests,
  ).map((row) => {
    const dueAtMs = row.dueAt.getTime();
    const completed = row.completedAt !== null || row.status === "completed";
    return {
      id: row.id,
      requestType: safeStoredValue(
        row.requestType.toLowerCase(),
        SAFE_DSR_REQUEST_TYPES,
      ),
      identityVerificationStatus: safeStoredValue(
        row.identityVerificationStatus.toLowerCase(),
        SAFE_IDENTITY_STORED_STATUSES,
      ),
      receivedAt: dateIso(row.receivedAt)!,
      dueAt: dateIso(row.dueAt)!,
      status: safeStoredValue(
        row.status.toLowerCase(),
        SAFE_DSR_STORED_STATUSES,
      ),
      assignedToUserId: row.assignedToUserId,
      responseEvidenceState: evidenceState(
        row.responseEvidencePresent,
        row.responseEvidenceSha256,
      ),
      completedAt: dateIso(row.completedAt),
      urgency: completed
        ? "completed"
        : dueAtMs <= nowMs
          ? "overdue"
          : dueAtMs - nowMs <= DUE_SOON_MS
            ? "due_soon"
            : "on_track",
      version: row.version,
      updatedAt: dateIso(row.updatedAt)!,
    };
  });

  const consentRecords: PrivacyConsentItem[] = take(
    input.raw.consentRecords,
  ).map((row) => {
    const withdrawal = latestAudit(
      input.raw.auditRows,
      "privacy.consent_withdrawal_recorded",
      row.id,
    );
    const payload = withdrawal.parsed?.payload;
    const withdrawalEvidence = payload?.evidenceSha256;
    const withdrawnBy = withdrawal.parsed?.actorUserId ?? null;
    const withdrawalMatchesRecord = Boolean(
      withdrawal.parsed &&
      withdrawal.parsed.resultingVersion <= row.version &&
      parseIso(payload?.withdrawnAt) === dateIso(row.withdrawnAt),
    );
    const withdrawalReceiptState: PrivacyEvidenceState = row.withdrawnAt
      ? withdrawal.malformed
        ? "invalid"
        : withdrawalMatchesRecord && isSha256(withdrawalEvidence)
          ? "verified"
          : withdrawal.parsed
            ? "invalid"
            : "missing"
      : "missing";
    return {
      id: row.id,
      privacyRecordId: row.privacyRecordId,
      capturedAt: dateIso(row.capturedAt)!,
      withdrawnAt: dateIso(row.withdrawnAt),
      state: row.withdrawnAt ? "withdrawn" : "active",
      captureEvidenceState: isSha256(row.evidenceHash) ? "verified" : "invalid",
      withdrawalReceiptState,
      withdrawalEvidenceSha256:
        withdrawalMatchesRecord && isSha256(withdrawalEvidence)
          ? withdrawalEvidence
          : null,
      withdrawnByUserId: withdrawalMatchesRecord ? withdrawnBy : null,
      version: row.version,
      updatedAt: dateIso(row.updatedAt)!,
    };
  });

  const legalHolds: PrivacyLegalHoldItem[] = take(input.raw.legalHolds).map(
    (row) => {
      const review = latestAudit(
        input.raw.auditRows,
        "privacy.legal_hold_review_recorded",
        row.id,
      );
      const payload = review.parsed?.payload;
      const nextReviewAt = parseIso(payload?.nextReviewAt);
      const evidenceSha256 = payload?.evidenceSha256;
      const outcome = payload?.reviewOutcome;
      const released = row.status === "released" || row.releasedAt !== null;
      const trustedReview = Boolean(
        review.parsed && review.parsed.resultingVersion <= row.version,
      );
      return {
        id: row.id,
        projectId: row.projectId,
        status: row.status,
        placedByUserId: row.placedByUserId,
        releasedByUserId: row.releasedByUserId,
        releasedAt: dateIso(row.releasedAt),
        lastReviewOutcome:
          trustedReview &&
          typeof outcome === "string" &&
          PRIVACY_HOLD_REVIEW_OUTCOMES.includes(
            outcome as (typeof PRIVACY_HOLD_REVIEW_OUTCOMES)[number],
          )
            ? (outcome as PrivacyLegalHoldItem["lastReviewOutcome"])
            : null,
        lastReviewedAt: trustedReview
          ? (review.parsed?.recordedAt ?? null)
          : null,
        lastReviewedByUserId: trustedReview
          ? (review.parsed?.actorUserId ?? null)
          : null,
        nextReviewAt: trustedReview ? nextReviewAt : null,
        reviewEvidenceSha256:
          trustedReview && isSha256(evidenceSha256) ? evidenceSha256 : null,
        reviewPosture: released
          ? "released"
          : review.malformed
            ? "overdue"
            : reviewPosture(
                trustedReview && nextReviewAt ? new Date(nextReviewAt) : null,
                nowMs,
              ),
        version: row.version,
        createdAt: dateIso(row.createdAt)!,
        updatedAt: dateIso(row.updatedAt)!,
      };
    },
  );

  const subprocessors: PrivacySubprocessorItem[] = take(
    input.raw.subprocessors,
  ).map((row) => ({
    id: row.id,
    legalName: row.legalName,
    service: row.service,
    countryCode: row.countryCode,
    dpaStatus: row.dpaStatus,
    securityReviewStatus: row.securityReviewStatus,
    approvedAt: dateIso(row.approvedAt),
    nextReviewAt: dateIso(row.nextReviewAt),
    reviewPosture: reviewPosture(row.nextReviewAt, nowMs),
    version: row.version,
    updatedAt: dateIso(row.updatedAt)!,
  }));

  const crossBorderTransfers: PrivacyTransferItem[] = take(
    input.raw.crossBorderTransfers,
  ).map((row) => ({
    id: row.id,
    subprocessorId: row.subprocessorId,
    originCountry: row.originCountry,
    destinationCountry: row.destinationCountry,
    transferBasis: row.transferBasis,
    approvalEvidenceState: evidenceState(
      row.approvalEvidencePresent,
      row.approvalEvidenceSha256,
    ),
    legalReviewStatus: row.legalReviewStatus,
    nextReviewAt: dateIso(row.nextReviewAt)!,
    reviewPosture: reviewPosture(row.nextReviewAt, nowMs),
    version: row.version,
    updatedAt: dateIso(row.updatedAt)!,
  }));

  const deletionActions = take(input.raw.deletionActions).map(deletionItem);
  const blockers: string[] = [];
  const pushCount = (count: number, message: string) => {
    if (count > 0) blockers.push(`${count} ${message}`);
  };
  pushCount(
    dataSubjectRequests.filter(({ urgency }) => urgency === "overdue").length,
    "loaded data-subject request(s) are overdue for named-human handling.",
  );
  pushCount(
    consentRecords.filter(
      (item) =>
        item.captureEvidenceState !== "verified" ||
        (item.state === "withdrawn" &&
          item.withdrawalReceiptState !== "verified"),
    ).length,
    "loaded consent record(s) have incomplete or invalid evidence.",
  );
  pushCount(
    legalHolds.filter(
      ({ reviewPosture: posture }) =>
        posture === "overdue" || posture === "missing_review_date",
    ).length,
    "loaded active hold(s) require review evidence.",
  );
  pushCount(
    subprocessors.filter(
      ({ reviewPosture: posture }) =>
        posture === "overdue" || posture === "missing_review_date",
    ).length,
    "loaded subprocessor record(s) require review.",
  );
  pushCount(
    crossBorderTransfers.filter(
      (item) =>
        item.reviewPosture === "overdue" ||
        item.approvalEvidenceState !== "verified",
    ).length,
    "loaded transfer record(s) require human review or evidence.",
  );
  pushCount(
    deletionActions.filter(
      ({ receiptState }) =>
        receiptState === "missing" || receiptState === "invalid",
    ).length,
    "loaded completed deletion action(s) lack a valid receipt.",
  );

  return {
    generatedAt: input.now.toISOString(),
    organisationId: input.scope.organisationId,
    boundedTo: input.limit,
    legalDecisionAutomated: false,
    rawSubjectPiiIncluded: false,
    authorityNote: PRIVACY_OPERATIONS_AUTHORITY_NOTE,
    totals: input.raw.totals,
    truncated: {
      dataSubjectRequests: input.raw.dataSubjectRequests.length > input.limit,
      consentRecords: input.raw.consentRecords.length > input.limit,
      legalHolds: input.raw.legalHolds.length > input.limit,
      subprocessors: input.raw.subprocessors.length > input.limit,
      crossBorderTransfers: input.raw.crossBorderTransfers.length > input.limit,
      deletionActions: input.raw.deletionActions.length > input.limit,
    },
    dataSubjectRequests,
    consentRecords,
    legalHolds,
    subprocessors,
    crossBorderTransfers,
    deletionActions,
    blockers,
  };
}
