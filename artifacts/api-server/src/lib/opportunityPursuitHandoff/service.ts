import { createHash } from "node:crypto";
import {
  OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS,
  OpportunityPursuitHandoffError,
  type NormalizedOpportunityPursuitHandoffDraft,
  type OpportunityPursuitHandoffDraft,
  type OpportunityPursuitHandoffPreparation,
  type OpportunityPursuitHandoffRepository,
  type OpportunityPursuitHandoffResult,
  type OpportunityPursuitHandoffScope,
} from "./contracts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      "The handoff digest input is invalid.",
    );
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key]!)}`)
    .join(",")}}`;
}

export function hashOpportunityPursuitHandoff(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function text(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string" || CONTROL.test(value)) {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      `${field} is invalid.`,
    );
  }
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    Buffer.byteLength(normalized, "utf8") > maximum * 4
  ) {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      `${field} is outside the accepted bound.`,
    );
  }
  return normalized;
}

function exactIsoOrNull(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      `${field} is invalid.`,
    );
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      `${field} is invalid.`,
    );
  }
  return value;
}

function assertScope(scope: OpportunityPursuitHandoffScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    !UUID.test(scope.actorMembershipId)
  ) {
    throw new OpportunityPursuitHandoffError(
      "scope_denied",
      "Direct opportunity handoff authority is required.",
    );
  }
  text(
    scope.actorName,
    OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxTextCodeUnits,
    "actorName",
  );
}

export function normalizeOpportunityPursuitHandoffDraft(
  draft: OpportunityPursuitHandoffDraft,
  idempotencyKey: string,
): NormalizedOpportunityPursuitHandoffDraft {
  if (
    !draft ||
    typeof draft !== "object" ||
    !Number.isSafeInteger(draft.expectedCandidateVersion) ||
    draft.expectedCandidateVersion < 1 ||
    !Number.isSafeInteger(draft.expectedTenderVersion) ||
    draft.expectedTenderVersion < 1 ||
    !SHA256.test(draft.expectedSourceReceiptSha256) ||
    !SHA256.test(draft.expectedConflictBoundarySha256) ||
    !UUID.test(draft.clientId) ||
    !Number.isSafeInteger(draft.expectedClientVersion) ||
    draft.expectedClientVersion < 1 ||
    (draft.tenderLotId !== null && !UUID.test(draft.tenderLotId)) ||
    (draft.tenderLotId === null
      ? draft.expectedTenderLotVersion !== null ||
        draft.confirmedLotReference !== null
      : !Number.isSafeInteger(draft.expectedTenderLotVersion) ||
        (draft.expectedTenderLotVersion ?? 0) < 1 ||
        typeof draft.confirmedLotReference !== "string") ||
    !UUID.test(draft.reviewerUserId) ||
    draft.officialSourceReopened !== true ||
    !IDEMPOTENCY.test(idempotencyKey)
  ) {
    throw new OpportunityPursuitHandoffError(
      "invalid_request",
      "The handoff confirmation is invalid.",
    );
  }
  const normalized: OpportunityPursuitHandoffDraft = {
    expectedCandidateVersion: draft.expectedCandidateVersion,
    expectedSourceReceiptSha256: draft.expectedSourceReceiptSha256,
    expectedTenderVersion: draft.expectedTenderVersion,
    expectedConflictBoundarySha256: draft.expectedConflictBoundarySha256,
    clientId: draft.clientId,
    expectedClientVersion: draft.expectedClientVersion,
    tenderLotId: draft.tenderLotId,
    expectedTenderLotVersion: draft.expectedTenderLotVersion,
    confirmedLotReference:
      draft.confirmedLotReference === null
        ? null
        : text(
            draft.confirmedLotReference,
            OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxTextCodeUnits,
            "confirmedLotReference",
          ),
    reviewerUserId: draft.reviewerUserId,
    officialSourceReopened: true,
    confirmedBuyer: text(
      draft.confirmedBuyer,
      OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxTextCodeUnits,
      "confirmedBuyer",
    ),
    confirmedReference: text(
      draft.confirmedReference,
      128,
      "confirmedReference",
    ),
    confirmedSubmissionDeadline: exactIsoOrNull(
      draft.confirmedSubmissionDeadline,
      "confirmedSubmissionDeadline",
    ),
    confirmationNote: text(
      draft.confirmationNote,
      OPPORTUNITY_PURSUIT_HANDOFF_BOUNDS.maxNoteCodeUnits,
      "confirmationNote",
    ),
  };
  return {
    ...normalized,
    idempotencyKeySha256: hashOpportunityPursuitHandoff(idempotencyKey),
    requestSha256: hashOpportunityPursuitHandoff(normalized),
  };
}

export class OpportunityPursuitHandoffService {
  constructor(
    private readonly repository: OpportunityPursuitHandoffRepository,
  ) {}

  async prepare(
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
  ): Promise<OpportunityPursuitHandoffPreparation> {
    assertScope(scope);
    if (!UUID.test(candidateId)) {
      throw new OpportunityPursuitHandoffError(
        "not_found",
        "Source not found.",
      );
    }
    return this.repository.prepare(scope, candidateId);
  }

  async confirm(
    scope: OpportunityPursuitHandoffScope,
    candidateId: string,
    idempotencyKey: string,
    draft: OpportunityPursuitHandoffDraft,
  ): Promise<OpportunityPursuitHandoffResult> {
    assertScope(scope);
    if (!UUID.test(candidateId)) {
      throw new OpportunityPursuitHandoffError(
        "not_found",
        "Source not found.",
      );
    }
    return this.repository.confirm(
      scope,
      candidateId,
      normalizeOpportunityPursuitHandoffDraft(draft, idempotencyKey),
    );
  }
}
