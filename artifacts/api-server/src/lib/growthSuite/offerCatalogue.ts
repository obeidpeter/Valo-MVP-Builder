import type { CreateQuoteDraft, OfferCatalogueItem } from "./contracts";
import { GROWTH_SUITE_BOUNDS } from "./contracts";

export const OFFER_CATALOGUE_VERSION = "2026-08-11.1";

export const OFFER_CATALOGUE: readonly OfferCatalogueItem[] = Object.freeze([
  {
    sku: "bid_autopsy",
    versionId: "bid_autopsy@1",
    revision: 1,
    title: "Bid Autopsy",
    summary:
      "A bounded review of an existing bid, with cited findings and a human-reviewed improvement brief.",
    includedOutcomes: Object.freeze([
      "Reviewed defect register",
      "Evidence-linked priority findings",
      "Human-approved improvement brief",
    ]),
    excludedActions: Object.freeze([
      "Tender submission",
      "Award prediction",
      "Client communication",
    ]),
    pricingMode: "human_quote_required",
    paymentMode: "external_manual_only",
    status: "active",
  },
  {
    sku: "assisted_bid",
    versionId: "assisted_bid@1",
    revision: 1,
    title: "Assisted Bid",
    summary:
      "A governed pursuit workspace for requirement, evidence, review and package-readiness coordination.",
    includedOutcomes: Object.freeze([
      "Requirement and evidence workspace",
      "Named review checkpoints",
      "Submission-readiness package checks",
    ]),
    excludedActions: Object.freeze([
      "Autonomous drafting release",
      "Commercial pricing decisions",
      "Portal submission",
    ]),
    pricingMode: "human_quote_required",
    paymentMode: "external_manual_only",
    status: "active",
  },
  {
    sku: "evidence_readiness_retainer",
    versionId: "evidence_readiness_retainer@1",
    revision: 1,
    title: "Evidence Readiness Retainer",
    summary:
      "A recurring, human-governed programme for evidence currency, ownership and renewal readiness.",
    includedOutcomes: Object.freeze([
      "Evidence readiness review",
      "Named renewal actions",
      "Periodic readiness receipts",
    ]),
    excludedActions: Object.freeze([
      "Issuer verification representation",
      "Automatic renewals",
      "Automated payment collection",
    ]),
    pricingMode: "human_quote_required",
    paymentMode: "external_manual_only",
    status: "active",
  },
]);

const ACTIVE_OFFER_VERSIONS = new Set(
  OFFER_CATALOGUE.map(({ versionId }) => versionId),
);
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value)) return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    Buffer.byteLength(normalized, "utf8") > GROWTH_SUITE_BOUNDS.maxSummaryBytes
  ) {
    return null;
  }
  return normalized;
}

function realFutureDate(
  value: unknown,
  now: Date,
  maximumDays: number,
): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    parsed.getTime() <= now.getTime() ||
    parsed.getTime() > now.getTime() + maximumDays * 86_400_000
  ) {
    return null;
  }
  return value;
}

/** Validates only operator-entered terms. It never calculates a price. */
export function parseQuoteDraft(
  value: unknown,
  now = new Date(),
): CreateQuoteDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const allowed = new Set([
    "customerReference",
    "offerVersionId",
    "scopeSummary",
    "currency",
    "amountMinor",
    "validUntil",
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return null;
  const customerReference = boundedText(
    body.customerReference,
    GROWTH_SUITE_BOUNDS.maxIdCodeUnits,
  );
  const scopeSummary = boundedText(
    body.scopeSummary,
    GROWTH_SUITE_BOUNDS.maxSummaryCodeUnits,
  );
  const validUntil = realFutureDate(
    body.validUntil,
    now,
    GROWTH_SUITE_BOUNDS.maxQuoteValidityDays,
  );
  if (
    !customerReference ||
    !scopeSummary ||
    !validUntil ||
    typeof body.offerVersionId !== "string" ||
    !ACTIVE_OFFER_VERSIONS.has(body.offerVersionId) ||
    typeof body.currency !== "string" ||
    !/^[A-Z]{3}$/u.test(body.currency) ||
    !Number.isSafeInteger(body.amountMinor) ||
    (body.amountMinor as number) <= 0 ||
    (body.amountMinor as number) > GROWTH_SUITE_BOUNDS.maxMoneyMinor
  ) {
    return null;
  }
  return {
    customerReference,
    offerVersionId: body.offerVersionId,
    scopeSummary,
    currency: body.currency,
    amountMinor: body.amountMinor as number,
    validUntil,
  };
}
