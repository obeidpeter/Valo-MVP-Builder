import { canonicalJsonLocale, sha256Hex } from "../canonicalDigest";
import {
  CLAIMS_DESK_ACTIONS,
  CLAIMS_DESK_ASSESSMENT_CODES,
  CLAIMS_DESK_BOUNDS,
  CLAIMS_DESK_REASON_CODES,
  CLAIMS_DESK_RECORD_TYPES,
  CLAIMS_DESK_STATUSES,
  type ClaimsDeskAction,
  type ClaimsDeskCreateDraft,
  type ClaimsDeskDocumentBinding,
  type ClaimsDeskMutationOutcome,
  type ClaimsDeskRecord,
  type ClaimsDeskReasonCode,
  type ClaimsDeskSnapshot,
  type ClaimsDeskTransitionDraft,
} from "./contracts";

export const CLAIMS_DESK_AUTHORITY_NOTE =
  "This desk records bounded human workflow evidence only. It does not reach a legal conclusion, certify entitlement or valuation, set a price, dispatch a notice, mutate an invoice or payment, or act autonomously.";

import {
  SHA256_HEX_PATTERN as SHA256_PATTERN,
  UUID_PATTERN,
} from "../identifierPatterns";
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./_():#-]{0,79}$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

// Active ISO 4217 alphabetic codes. Recording a code does not perform pricing
// or currency conversion.
const ISO_CURRENCIES = new Set(
  "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWL".split(
    " ",
  ),
);

type JsonObject = Record<string, unknown>;

export class ClaimsDeskValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ClaimsDeskValidationError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: JsonObject, expected: readonly string[]): boolean {
  const expectedSet = new Set(expected);
  const keys = Object.keys(value);
  return (
    keys.length === expected.length && keys.every((key) => expectedSet.has(key))
  );
}

function validDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function validTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

function parseBindings(value: unknown): ClaimsDeskDocumentBinding[] | null {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > CLAIMS_DESK_BOUNDS.documentsPerEvent
  ) {
    return null;
  }
  const seen = new Set<string>();
  const bindings: ClaimsDeskDocumentBinding[] = [];
  for (const item of value) {
    if (
      !isObject(item) ||
      !exactKeys(item, ["documentId", "sha256"]) ||
      typeof item.documentId !== "string" ||
      !UUID_PATTERN.test(item.documentId) ||
      typeof item.sha256 !== "string" ||
      !SHA256_PATTERN.test(item.sha256)
    ) {
      return null;
    }
    if (seen.has(item.documentId)) return null;
    seen.add(item.documentId);
    bindings.push({ documentId: item.documentId, sha256: item.sha256 });
  }
  return bindings.sort((a, b) => a.documentId.localeCompare(b.documentId));
}

export function parseClaimsDeskCreateDraft(
  value: unknown,
): ClaimsDeskCreateDraft | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "recordType",
      "reference",
      "eventDate",
      "dueAt",
      "amountMinor",
      "currency",
      "documentBindings",
      "idempotencyKey",
    ]) ||
    typeof value.recordType !== "string" ||
    !CLAIMS_DESK_RECORD_TYPES.includes(value.recordType as never) ||
    typeof value.reference !== "string" ||
    !REFERENCE_PATTERN.test(value.reference) ||
    typeof value.eventDate !== "string" ||
    !validDate(value.eventDate) ||
    !(
      value.dueAt === null ||
      (typeof value.dueAt === "string" && validTimestamp(value.dueAt))
    ) ||
    !(
      value.amountMinor === null ||
      (typeof value.amountMinor === "number" &&
        Number.isSafeInteger(value.amountMinor) &&
        value.amountMinor >= 0)
    ) ||
    !(
      value.currency === null ||
      (typeof value.currency === "string" && ISO_CURRENCIES.has(value.currency))
    ) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
  ) {
    return null;
  }
  const bindings = parseBindings(value.documentBindings);
  if (!bindings || (value.amountMinor === null) !== (value.currency === null))
    return null;
  const type = value.recordType as ClaimsDeskCreateDraft["recordType"];
  if (
    (["notice_deadline", "obligation"] as const).includes(type as never) &&
    value.dueAt === null
  ) {
    return null;
  }
  if (
    value.amountMinor !== null &&
    !(["variation", "claim", "payment_certificate"] as const).includes(
      type as never,
    )
  ) {
    return null;
  }
  if (
    value.dueAt !== null &&
    Date.parse(value.dueAt) < Date.parse(`${value.eventDate}T00:00:00.000Z`)
  ) {
    return null;
  }
  return {
    recordType: type,
    reference: value.reference,
    eventDate: value.eventDate,
    dueAt: value.dueAt,
    amountMinor: value.amountMinor,
    currency: value.currency,
    documentBindings: bindings,
    idempotencyKey: value.idempotencyKey,
  };
}

export function parseClaimsDeskTransitionDraft(
  value: unknown,
): ClaimsDeskTransitionDraft | null {
  if (
    !isObject(value) ||
    !exactKeys(value, [
      "action",
      "reasonCode",
      "assessmentCode",
      "documentBindings",
      "idempotencyKey",
    ]) ||
    typeof value.action !== "string" ||
    !CLAIMS_DESK_ACTIONS.includes(value.action as never) ||
    typeof value.reasonCode !== "string" ||
    !CLAIMS_DESK_REASON_CODES.includes(value.reasonCode as never) ||
    !(
      value.assessmentCode === null ||
      (typeof value.assessmentCode === "string" &&
        CLAIMS_DESK_ASSESSMENT_CODES.includes(value.assessmentCode as never))
    ) ||
    typeof value.idempotencyKey !== "string" ||
    !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
  ) {
    return null;
  }
  const bindings = parseBindings(value.documentBindings);
  if (!bindings) return null;
  if (
    (value.action === "propose_assessment") !==
    (value.assessmentCode !== null)
  ) {
    return null;
  }
  return {
    action: value.action as ClaimsDeskAction,
    reasonCode: value.reasonCode as ClaimsDeskReasonCode,
    assessmentCode:
      value.assessmentCode as ClaimsDeskTransitionDraft["assessmentCode"],
    documentBindings: bindings,
    idempotencyKey: value.idempotencyKey,
  };
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonLocale(value);
}

export function claimsDeskSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

import { deterministicUuidFromHex } from "../deterministicUuid";
export const deterministicClaimsDeskUuid = deterministicUuidFromHex;

export interface ClaimsDeskTransitionDecision {
  fromStatus: ClaimsDeskRecord["status"];
  toStatus: ClaimsDeskRecord["status"];
  assessmentCode: ClaimsDeskRecord["assessmentCode"];
  pendingMakerUserId: string | null;
}

export function decideClaimsDeskTransition(
  current: ClaimsDeskRecord,
  draft: ClaimsDeskTransitionDraft,
  actorUserId: string,
): ClaimsDeskTransitionDecision | "state_conflict" | "maker_checker_conflict" {
  const fromStatus = current.status;
  const result = (
    toStatus: ClaimsDeskRecord["status"],
    pendingMakerUserId: string | null,
    assessmentCode = current.assessmentCode,
  ): ClaimsDeskTransitionDecision => ({
    fromStatus,
    toStatus,
    assessmentCode,
    pendingMakerUserId,
  });
  switch (draft.action) {
    case "start_review":
      return fromStatus === "registered"
        ? result("under_review", null)
        : "state_conflict";
    case "propose_assessment":
      return fromStatus === "under_review"
        ? result("assessment_proposed", actorUserId, draft.assessmentCode)
        : "state_conflict";
    case "approve_assessment":
      if (fromStatus !== "assessment_proposed") return "state_conflict";
      return current.pendingMakerUserId === actorUserId
        ? "maker_checker_conflict"
        : result("assessed", null);
    case "return_assessment":
      if (fromStatus !== "assessment_proposed") return "state_conflict";
      return current.pendingMakerUserId === actorUserId
        ? "maker_checker_conflict"
        : result("under_review", null, null);
    case "propose_closure":
      return fromStatus === "assessed"
        ? result("closure_proposed", actorUserId)
        : "state_conflict";
    case "approve_closure":
      if (fromStatus !== "closure_proposed") return "state_conflict";
      return current.pendingMakerUserId === actorUserId
        ? "maker_checker_conflict"
        : result("closed", null);
    case "return_closure":
      if (fromStatus !== "closure_proposed") return "state_conflict";
      return current.pendingMakerUserId === actorUserId
        ? "maker_checker_conflict"
        : result("assessed", null);
    case "withdraw":
      return ["registered", "under_review", "assessed"].includes(fromStatus)
        ? result("withdrawn", null)
        : "state_conflict";
  }
}

export function buildClaimsDeskPosture(
  records: readonly ClaimsDeskRecord[],
  now: Date,
): ClaimsDeskSnapshot["posture"] {
  const nowMs = now.valueOf();
  const soonMs = nowMs + 7 * 86_400_000;
  const terminal = (record: ClaimsDeskRecord) =>
    CLAIMS_DESK_STATUSES.slice(-2).includes(record.status as never);
  return {
    total: records.length,
    open: records.filter((record) => !terminal(record)).length,
    overdue: records.filter(
      (record) =>
        !terminal(record) && record.dueAt && Date.parse(record.dueAt) < nowMs,
    ).length,
    dueSoon: records.filter((record) => {
      if (terminal(record) || !record.dueAt) return false;
      const due = Date.parse(record.dueAt);
      return due >= nowMs && due <= soonMs;
    }).length,
    awaitingChecker: records.filter((record) =>
      ["assessment_proposed", "closure_proposed"].includes(record.status),
    ).length,
    terminal: records.filter(terminal).length,
  };
}

export function mutationHttpStatus(outcome: ClaimsDeskMutationOutcome): number {
  if (outcome.outcome === "created") return 201;
  if (outcome.outcome === "updated") return 200;
  if (outcome.outcome === "not_found") return 404;
  if (outcome.outcome === "capacity_exceeded") return 429;
  return 409;
}
