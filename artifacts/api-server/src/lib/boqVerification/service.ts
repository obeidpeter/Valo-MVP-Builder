import { createHash } from "node:crypto";
import type {
  BoqCommercialLine,
  BoqLotSummary,
  BoqVerificationResult,
} from "../boqVerifier";
import {
  BOQ_EXCEPTION_RESOLUTION_STATUSES,
  BOQ_VERIFICATION_BOUNDS,
  BOQ_WORKBOOK_MANIFEST_SCHEMA,
  type BoqExceptionResolutionDraft,
  type BoqExceptionResolutionOutcome,
  type BoqRunDraft,
  type BoqRunOutcome,
} from "./contracts";

export const BOQ_VERIFICATION_AUTHORITY_NOTE =
  "Deterministic arithmetic verification of client-supplied figures against a " +
  "pinned rule pack. It never invents quantities, rates, taxes, discounts, " +
  "exchange rates or bid-security terms, and a passing run is not a pricing, " +
  "responsiveness or award opinion.";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DECIMAL_PATTERN = /^-?\d{1,24}(?:\.\d{1,12})?$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;

const IDENTIFIER_PATTERN = /^[\w./:-]+$/u;

function isBoundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= BOQ_VERIFICATION_BOUNDS.identifierCharacters &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function isBoundedDecimal(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= BOQ_VERIFICATION_BOUNDS.decimalCharacters &&
    DECIMAL_PATTERN.test(value)
  );
}

function isOptionalBoundedDecimal(value: unknown): boolean {
  return value == null || isBoundedDecimal(value);
}

function isBasisPoints(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 10_000
  );
}

function parseLine(value: unknown): BoqCommercialLine | null {
  if (!value || typeof value !== "object") return null;
  const line = value as Record<string, unknown>;
  if (
    !isBoundedIdentifier(line.id) ||
    !isBoundedIdentifier(line.lotId) ||
    typeof line.currency !== "string" ||
    !CURRENCY_PATTERN.test(line.currency) ||
    !isBoundedDecimal(line.quantity) ||
    !isBoundedDecimal(line.unitRate) ||
    !isBoundedDecimal(line.displayedExtension) ||
    !isOptionalBoundedDecimal(line.formulaExtension) ||
    (line.hidden != null && typeof line.hidden !== "boolean") ||
    (line.mergedPricingCell != null &&
      typeof line.mergedPricingCell !== "boolean") ||
    (line.sourceUnit != null && !isBoundedIdentifier(line.sourceUnit)) ||
    (line.pricingUnit != null && !isBoundedIdentifier(line.pricingUnit)) ||
    !isOptionalBoundedDecimal(line.conversionNumerator) ||
    !isOptionalBoundedDecimal(line.conversionDenominator) ||
    !isOptionalBoundedDecimal(line.convertedQuantity)
  ) {
    return null;
  }
  return {
    id: line.id,
    lotId: line.lotId,
    currency: line.currency,
    quantity: line.quantity,
    unitRate: line.unitRate,
    displayedExtension: line.displayedExtension,
    formulaExtension:
      (line.formulaExtension as string | null | undefined) ?? null,
    hidden: (line.hidden as boolean | undefined) ?? false,
    mergedPricingCell: (line.mergedPricingCell as boolean | undefined) ?? false,
    sourceUnit: (line.sourceUnit as string | null | undefined) ?? null,
    pricingUnit: (line.pricingUnit as string | null | undefined) ?? null,
    conversionNumerator:
      (line.conversionNumerator as string | null | undefined) ?? null,
    conversionDenominator:
      (line.conversionDenominator as string | null | undefined) ?? null,
    convertedQuantity:
      (line.convertedQuantity as string | null | undefined) ?? null,
  };
}

function parseLot(value: unknown): BoqLotSummary | null {
  if (!value || typeof value !== "object") return null;
  const lot = value as Record<string, unknown>;
  const security = lot.bidSecurity as
    | Record<string, unknown>
    | null
    | undefined;
  if (
    !isBoundedIdentifier(lot.lotId) ||
    typeof lot.currency !== "string" ||
    !CURRENCY_PATTERN.test(lot.currency) ||
    !isBoundedDecimal(lot.declaredNet) ||
    !isBasisPoints(lot.discountRateBasisPoints) ||
    !isBoundedDecimal(lot.declaredDiscount) ||
    !isBoundedDecimal(lot.declaredTaxableBase) ||
    !isBasisPoints(lot.vatRateBasisPoints) ||
    !isBoundedDecimal(lot.declaredVat) ||
    !isBoundedDecimal(lot.declaredGross) ||
    (lot.whtRateBasisPoints != null &&
      !isBasisPoints(lot.whtRateBasisPoints)) ||
    !isOptionalBoundedDecimal(lot.declaredWht) ||
    !isBoundedDecimal(lot.declaredNetPayable) ||
    (security != null &&
      (typeof security !== "object" ||
        !isBasisPoints(security.rateBasisPoints) ||
        (security.basis !== "net" && security.basis !== "gross") ||
        !isBoundedDecimal(security.declaredAmount)))
  ) {
    return null;
  }
  return {
    lotId: lot.lotId,
    currency: lot.currency,
    declaredNet: lot.declaredNet,
    discountRateBasisPoints: lot.discountRateBasisPoints,
    declaredDiscount: lot.declaredDiscount,
    declaredTaxableBase: lot.declaredTaxableBase,
    vatRateBasisPoints: lot.vatRateBasisPoints,
    declaredVat: lot.declaredVat,
    declaredGross: lot.declaredGross,
    whtRateBasisPoints:
      (lot.whtRateBasisPoints as number | undefined) ?? undefined,
    declaredWht: (lot.declaredWht as string | null | undefined) ?? null,
    declaredNetPayable: lot.declaredNetPayable,
    bidSecurity: security
      ? {
          rateBasisPoints: security.rateBasisPoints as number,
          basis: security.basis as "net" | "gross",
          declaredAmount: security.declaredAmount as string,
        }
      : null,
  };
}

/**
 * Deep fail-closed validation of a run request. Every line and lot must be a
 * bounded, well-formed record before the kernel sees it; anything else is
 * rejected as a whole rather than partially verified. The rule policy is
 * never read from the request.
 */
export function parseBoqRunDraft(body: unknown): BoqRunDraft | null {
  if (!body || typeof body !== "object") return null;
  const draft = body as Record<string, unknown>;
  if (
    typeof draft.documentId !== "string" ||
    !UUID_PATTERN.test(draft.documentId) ||
    !Array.isArray(draft.lines) ||
    draft.lines.length === 0 ||
    draft.lines.length > BOQ_VERIFICATION_BOUNDS.linesPerRun ||
    !Array.isArray(draft.lots) ||
    draft.lots.length === 0 ||
    draft.lots.length > BOQ_VERIFICATION_BOUNDS.lotsPerRun
  ) {
    return null;
  }
  const lines: BoqCommercialLine[] = [];
  const lineIds = new Set<string>();
  for (const candidate of draft.lines) {
    const line = parseLine(candidate);
    if (!line || lineIds.has(line.id)) return null;
    lineIds.add(line.id);
    lines.push(line);
  }
  const lots: BoqLotSummary[] = [];
  const lotIds = new Set<string>();
  for (const candidate of draft.lots) {
    const lot = parseLot(candidate);
    if (!lot || lotIds.has(lot.lotId)) return null;
    lotIds.add(lot.lotId);
    lots.push(lot);
  }
  // Every line must belong to a declared lot so no extension can escape the
  // lot-total reconciliation.
  if (lines.some((line) => !lotIds.has(line.lotId))) return null;
  return { documentId: draft.documentId, lines, lots };
}

export function parseBoqExceptionResolutionDraft(
  body: unknown,
): BoqExceptionResolutionDraft | null {
  if (!body || typeof body !== "object") return null;
  const draft = body as Record<string, unknown>;
  const status = draft.status;
  const reason = draft.reason;
  if (
    typeof status !== "string" ||
    !(BOQ_EXCEPTION_RESOLUTION_STATUSES as readonly string[]).includes(
      status,
    ) ||
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    reason.length > BOQ_VERIFICATION_BOUNDS.resolutionReasonCharacters
  ) {
    return null;
  }
  return {
    status: status as BoqExceptionResolutionDraft["status"],
    reason: reason.trim(),
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).sort(
          ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
        ),
      );
    }
    return entry;
  });
}

export function boqSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * A content-addressed record of exactly which figures were verified: the
 * governed source version identity plus a digest of the parsed lines and lots.
 * The manifest never stores the figures themselves.
 */
export function buildWorkbookManifest(input: {
  documentId: string;
  documentVersionId: string;
  documentSha256: string;
  draft: BoqRunDraft;
}): string {
  return canonicalJson({
    schema: BOQ_WORKBOOK_MANIFEST_SCHEMA,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    documentSha256: input.documentSha256,
    lineCount: input.draft.lines.length,
    lotCount: input.draft.lots.length,
    figuresSha256: boqSha256({
      lines: input.draft.lines,
      lots: input.draft.lots,
    }),
  });
}

export function summariseResultStatus(result: BoqVerificationResult): string {
  return result.passed ? "passed" : "exceptions_recorded";
}

export function runHttpStatus(outcome: BoqRunOutcome): number {
  switch (outcome.outcome) {
    case "created":
      return 201;
    case "document_conflict":
      return 409;
    case "capacity_exceeded":
      return 422;
  }
}

export function resolutionHttpStatus(
  outcome: BoqExceptionResolutionOutcome,
): number {
  switch (outcome.outcome) {
    case "updated":
      return 200;
    case "not_found":
      return 404;
    case "version_conflict":
      return 409;
    case "state_conflict":
      return 409;
  }
}
