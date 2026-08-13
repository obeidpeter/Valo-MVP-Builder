import type { OpportunityPursuitHandoffDraft } from "./contracts";

const KEYS = [
  "expectedCandidateVersion",
  "expectedSourceReceiptSha256",
  "expectedTenderVersion",
  "expectedConflictBoundarySha256",
  "clientId",
  "expectedClientVersion",
  "tenderLotId",
  "expectedTenderLotVersion",
  "confirmedLotReference",
  "reviewerUserId",
  "officialSourceReopened",
  "confirmedBuyer",
  "confirmedReference",
  "confirmedSubmissionDeadline",
  "confirmationNote",
] as const;

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function parseOpportunityPursuitHandoffBody(
  value: unknown,
): OpportunityPursuitHandoffDraft | null {
  if (!plain(value)) return null;
  const expected = new Set<string>(KEYS);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key)) ||
    typeof value.confirmedBuyer !== "string" ||
    typeof value.confirmedReference !== "string" ||
    typeof value.confirmationNote !== "string" ||
    (value.confirmedSubmissionDeadline !== null &&
      typeof value.confirmedSubmissionDeadline !== "string") ||
    typeof value.clientId !== "string" ||
    !Number.isSafeInteger(value.expectedClientVersion) ||
    (value.tenderLotId !== null && typeof value.tenderLotId !== "string") ||
    (value.expectedTenderLotVersion !== null &&
      !Number.isSafeInteger(value.expectedTenderLotVersion)) ||
    (value.confirmedLotReference !== null &&
      typeof value.confirmedLotReference !== "string") ||
    typeof value.reviewerUserId !== "string" ||
    typeof value.expectedSourceReceiptSha256 !== "string" ||
    typeof value.expectedConflictBoundarySha256 !== "string" ||
    !Number.isSafeInteger(value.expectedCandidateVersion) ||
    !Number.isSafeInteger(value.expectedTenderVersion) ||
    value.officialSourceReopened !== true
  ) {
    return null;
  }
  return value as unknown as OpportunityPursuitHandoffDraft;
}
