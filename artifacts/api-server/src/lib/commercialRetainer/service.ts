import {
  COMMERCIAL_OFFERS,
  COMMERCIAL_RETAINER_BOUNDS,
  CommercialRetainerError,
  type CommercialMutationResult,
  type CommercialRetainerRepository,
  type CommercialScope,
  type CommercialSnapshot,
  type CommercialOfferVersion,
  type CreateRetainerRequest,
  type ManualInvoiceTerms,
  type ManualPaymentEvidence,
  type QuoteProposal,
  type QuoteTerms,
  type RetainerRequestAction,
  type RetainerServiceRequest,
} from "./contracts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const OFFER_VERSIONS = new Set(
  COMMERCIAL_OFFERS.map((offer) => offer.versionId),
);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function text(
  value: unknown,
  maximum: number = COMMERCIAL_RETAINER_BOUNDS.text,
): string | null {
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value)) return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  return normalized.length > 0 &&
    normalized.length <= maximum &&
    Buffer.byteLength(normalized, "utf8") <=
      COMMERCIAL_RETAINER_BOUNDS.textBytes
    ? normalized
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function calendarDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function assertScope(scope: CommercialScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    !UUID.test(scope.actorMembershipId)
  ) {
    throw new CommercialRetainerError("invalid_scope");
  }
}

export function parseQuoteTerms(value: unknown, now: Date): QuoteTerms | null {
  const body = record(value);
  if (
    !body ||
    !exactKeys(body, [
      "projectId",
      "customerReference",
      "offerVersionId",
      "scopeSummary",
      "currency",
      "amountMinor",
      "validUntil",
      "serviceStartsOn",
      "serviceEndsOn",
      "serviceUnits",
      "idempotencyDigest",
    ])
  ) {
    return null;
  }
  const projectId = body.projectId == null ? null : uuid(body.projectId);
  const customerReference = text(
    body.customerReference,
    COMMERCIAL_RETAINER_BOUNDS.reference,
  );
  const scopeSummary = text(body.scopeSummary);
  const validUntil = calendarDate(body.validUntil);
  const serviceStartsOn = calendarDate(body.serviceStartsOn);
  const serviceEndsOn = calendarDate(body.serviceEndsOn);
  const amountMinor = integer(
    body.amountMinor,
    1,
    COMMERCIAL_RETAINER_BOUNDS.moneyMinor,
  );
  const serviceUnits = integer(
    body.serviceUnits,
    1,
    COMMERCIAL_RETAINER_BOUNDS.serviceUnits,
  );
  const nowDay = new Date(
    `${now.toISOString().slice(0, 10)}T00:00:00.000Z`,
  ).getTime();
  const validTime = validUntil
    ? Date.parse(`${validUntil}T00:00:00.000Z`)
    : NaN;
  const startsTime = serviceStartsOn
    ? Date.parse(`${serviceStartsOn}T00:00:00.000Z`)
    : NaN;
  const endsTime = serviceEndsOn
    ? Date.parse(`${serviceEndsOn}T00:00:00.000Z`)
    : NaN;
  if (
    (body.projectId != null && !projectId) ||
    !customerReference ||
    !scopeSummary ||
    typeof body.offerVersionId !== "string" ||
    !OFFER_VERSIONS.has(body.offerVersionId as CommercialOfferVersion) ||
    typeof body.currency !== "string" ||
    !CURRENCY.test(body.currency) ||
    amountMinor == null ||
    serviceUnits == null ||
    !validUntil ||
    !serviceStartsOn ||
    !serviceEndsOn ||
    validTime <= nowDay ||
    validTime >
      nowDay + COMMERCIAL_RETAINER_BOUNDS.quoteValidityDays * 86_400_000 ||
    startsTime < nowDay ||
    endsTime <= startsTime ||
    endsTime >
      startsTime + COMMERCIAL_RETAINER_BOUNDS.servicePeriodDays * 86_400_000 ||
    typeof body.idempotencyDigest !== "string" ||
    !SHA256.test(body.idempotencyDigest)
  ) {
    return null;
  }
  return {
    projectId,
    customerReference,
    offerVersionId: body.offerVersionId as CommercialOfferVersion,
    scopeSummary,
    currency: body.currency,
    amountMinor,
    validUntil,
    serviceStartsOn,
    serviceEndsOn,
    serviceUnits,
    idempotencyDigest: body.idempotencyDigest,
  };
}

export function parseManualInvoiceTerms(
  value: unknown,
): ManualInvoiceTerms | null {
  const body = record(value);
  if (
    !body ||
    !exactKeys(body, [
      "orderId",
      "expectedOrderVersion",
      "invoiceNumber",
      "netAmountMinor",
      "vatRateBasisPoints",
      "vatAmountMinor",
      "grossAmountMinor",
      "whtRateBasisPoints",
      "whtAmountMinor",
      "netPayableMinor",
      "taxRuleId",
      "taxPointAt",
      "dueAt",
    ])
  )
    return null;
  const orderId = uuid(body.orderId);
  const expectedOrderVersion = integer(body.expectedOrderVersion, 1, 1_000_000);
  const invoiceNumber = text(
    body.invoiceNumber,
    COMMERCIAL_RETAINER_BOUNDS.reference,
  );
  const netAmountMinor = integer(
    body.netAmountMinor,
    1,
    COMMERCIAL_RETAINER_BOUNDS.moneyMinor,
  );
  const vatRateBasisPoints = integer(body.vatRateBasisPoints, 0, 100_000);
  const vatAmountMinor = integer(
    body.vatAmountMinor,
    0,
    COMMERCIAL_RETAINER_BOUNDS.moneyMinor,
  );
  const grossAmountMinor = integer(
    body.grossAmountMinor,
    1,
    COMMERCIAL_RETAINER_BOUNDS.moneyMinor,
  );
  const whtRateBasisPoints =
    body.whtRateBasisPoints == null
      ? null
      : integer(body.whtRateBasisPoints, 0, 100_000);
  const whtAmountMinor =
    body.whtAmountMinor == null
      ? null
      : integer(body.whtAmountMinor, 0, COMMERCIAL_RETAINER_BOUNDS.moneyMinor);
  const netPayableMinor = integer(
    body.netPayableMinor,
    1,
    COMMERCIAL_RETAINER_BOUNDS.moneyMinor,
  );
  const taxRuleId = text(body.taxRuleId, COMMERCIAL_RETAINER_BOUNDS.reference);
  const taxPointAt = isoInstant(body.taxPointAt);
  const dueAt = body.dueAt == null ? null : isoInstant(body.dueAt);
  if (
    !orderId ||
    expectedOrderVersion == null ||
    !invoiceNumber ||
    netAmountMinor == null ||
    vatRateBasisPoints == null ||
    vatAmountMinor == null ||
    grossAmountMinor == null ||
    (body.whtRateBasisPoints != null && whtRateBasisPoints == null) ||
    (body.whtAmountMinor != null && whtAmountMinor == null) ||
    (whtRateBasisPoints == null) !== (whtAmountMinor == null) ||
    netPayableMinor == null ||
    !taxRuleId ||
    !taxPointAt ||
    (body.dueAt != null && !dueAt) ||
    netAmountMinor + vatAmountMinor !== grossAmountMinor ||
    grossAmountMinor - (whtAmountMinor ?? 0) !== netPayableMinor
  )
    return null;
  return {
    orderId,
    expectedOrderVersion,
    invoiceNumber,
    netAmountMinor,
    vatRateBasisPoints,
    vatAmountMinor,
    grossAmountMinor,
    whtRateBasisPoints,
    whtAmountMinor,
    netPayableMinor,
    taxRuleId,
    taxPointAt,
    dueAt,
  };
}

export function parseManualPaymentEvidence(
  value: unknown,
): ManualPaymentEvidence | null {
  const body = record(value);
  if (
    !body ||
    !exactKeys(body, [
      "invoiceId",
      "expectedInvoiceVersion",
      "evidenceReference",
      "evidenceSha256",
      "amountMinor",
      "currency",
      "settledAt",
      "idempotencyDigest",
    ])
  )
    return null;
  const invoiceId = uuid(body.invoiceId);
  const expectedInvoiceVersion = integer(
    body.expectedInvoiceVersion,
    1,
    1_000_000,
  );
  const evidenceReference = text(
    body.evidenceReference,
    COMMERCIAL_RETAINER_BOUNDS.reference,
  );
  const amountMinor = integer(
    body.amountMinor,
    1,
    COMMERCIAL_RETAINER_BOUNDS.moneyMinor,
  );
  const settledAt = isoInstant(body.settledAt);
  if (
    !invoiceId ||
    expectedInvoiceVersion == null ||
    !evidenceReference ||
    typeof body.evidenceSha256 !== "string" ||
    !SHA256.test(body.evidenceSha256) ||
    amountMinor == null ||
    typeof body.currency !== "string" ||
    !CURRENCY.test(body.currency) ||
    !settledAt ||
    typeof body.idempotencyDigest !== "string" ||
    !SHA256.test(body.idempotencyDigest)
  )
    return null;
  return {
    invoiceId,
    expectedInvoiceVersion,
    evidenceReference,
    evidenceSha256: body.evidenceSha256,
    amountMinor,
    currency: body.currency,
    settledAt,
    idempotencyDigest: body.idempotencyDigest,
  };
}

export function parseCreateRetainerRequest(
  value: unknown,
): CreateRetainerRequest | null {
  const body = record(value);
  if (
    !body ||
    !exactKeys(body, [
      "projectId",
      "entitlementId",
      "purpose",
      "summary",
      "ownerMembershipId",
      "sla",
      "idempotencyDigest",
    ])
  )
    return null;
  const projectId = uuid(body.projectId);
  const entitlementId = uuid(body.entitlementId);
  const summary = text(body.summary);
  const ownerMembershipId = uuid(body.ownerMembershipId);
  if (
    !projectId ||
    !entitlementId ||
    !summary ||
    !ownerMembershipId ||
    (body.purpose !== "evidence_review" &&
      body.purpose !== "renewal_readiness" &&
      body.purpose !== "bid_evidence_pack") ||
    (body.sla !== "standard" && body.sla !== "priority") ||
    typeof body.idempotencyDigest !== "string" ||
    !SHA256.test(body.idempotencyDigest)
  )
    return null;
  return {
    projectId,
    entitlementId,
    purpose: body.purpose,
    summary,
    ownerMembershipId,
    sla: body.sla,
    idempotencyDigest: body.idempotencyDigest,
  };
}

export function parseRetainerRequestAction(
  value: unknown,
): RetainerRequestAction | null {
  const body = record(value);
  if (!body || typeof body.action !== "string") return null;
  const expectedVersion = integer(body.expectedVersion, 1, 1_000_000);
  if (expectedVersion == null) return null;
  switch (body.action) {
    case "comment": {
      if (!exactKeys(body, ["action", "expectedVersion", "body"])) return null;
      const comment = text(body.body);
      return comment
        ? { action: "comment", expectedVersion, body: comment }
        : null;
    }
    case "record_evidence": {
      if (
        !exactKeys(body, ["action", "expectedVersion", "reference", "sha256"])
      )
        return null;
      const reference = text(
        body.reference,
        COMMERCIAL_RETAINER_BOUNDS.reference,
      );
      return reference &&
        typeof body.sha256 === "string" &&
        SHA256.test(body.sha256)
        ? {
            action: "record_evidence",
            expectedVersion,
            reference,
            sha256: body.sha256,
          }
        : null;
    }
    case "set_status":
      if (!exactKeys(body, ["action", "expectedVersion", "status"]))
        return null;
      return body.status === "in_progress" ||
        body.status === "awaiting_evidence" ||
        body.status === "completed" ||
        body.status === "cancelled"
        ? { action: "set_status", expectedVersion, status: body.status }
        : null;
    case "reassign": {
      if (!exactKeys(body, ["action", "expectedVersion", "ownerMembershipId"]))
        return null;
      const ownerMembershipId = uuid(body.ownerMembershipId);
      return ownerMembershipId
        ? { action: "reassign", expectedVersion, ownerMembershipId }
        : null;
    }
    default:
      return null;
  }
}

export class CommercialRetainerService {
  constructor(
    private readonly repository: CommercialRetainerRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  snapshot(
    scope: CommercialScope,
    projectId?: string,
  ): Promise<CommercialSnapshot> {
    assertScope(scope);
    if (projectId != null && !UUID.test(projectId)) {
      throw new CommercialRetainerError("invalid_input");
    }
    return this.repository.readSnapshot(scope, projectId);
  }

  createQuote(scope: CommercialScope, value: unknown): Promise<QuoteProposal> {
    assertScope(scope);
    const terms = parseQuoteTerms(value, this.now());
    if (!terms) throw new CommercialRetainerError("invalid_input");
    return this.repository.createQuote(scope, terms);
  }

  approveQuote(
    scope: CommercialScope,
    orderId: string,
    expectedVersion: number,
  ): Promise<CommercialMutationResult<QuoteProposal>> {
    assertScope(scope);
    if (!UUID.test(orderId) || integer(expectedVersion, 1, 1_000_000) == null) {
      throw new CommercialRetainerError("invalid_input");
    }
    return this.repository.approveQuote(scope, orderId, expectedVersion);
  }

  createInvoice(scope: CommercialScope, value: unknown) {
    assertScope(scope);
    const terms = parseManualInvoiceTerms(value);
    if (!terms) throw new CommercialRetainerError("invalid_input");
    return this.repository.createInvoice(scope, terms);
  }

  recordPayment(scope: CommercialScope, value: unknown) {
    assertScope(scope);
    const evidence = parseManualPaymentEvidence(value);
    if (!evidence) throw new CommercialRetainerError("invalid_input");
    return this.repository.recordPayment(scope, evidence);
  }

  verifyPayment(
    scope: CommercialScope,
    paymentId: string,
    expectedPaymentVersion: number,
    expectedInvoiceVersion: number,
  ) {
    assertScope(scope);
    if (
      !UUID.test(paymentId) ||
      integer(expectedPaymentVersion, 1, 1_000_000) == null ||
      integer(expectedInvoiceVersion, 1, 1_000_000) == null
    )
      throw new CommercialRetainerError("invalid_input");
    return this.repository.verifyPayment(
      scope,
      paymentId,
      expectedPaymentVersion,
      expectedInvoiceVersion,
    );
  }

  createRetainerRequest(
    scope: CommercialScope,
    value: unknown,
  ): Promise<CommercialMutationResult<RetainerServiceRequest>> {
    assertScope(scope);
    const command = parseCreateRetainerRequest(value);
    if (!command) throw new CommercialRetainerError("invalid_input");
    return this.repository.createRetainerRequest(scope, command);
  }

  mutateRetainerRequest(
    scope: CommercialScope,
    requestId: string,
    value: unknown,
  ): Promise<CommercialMutationResult<RetainerServiceRequest>> {
    assertScope(scope);
    const action = parseRetainerRequestAction(value);
    if (!UUID.test(requestId) || !action) {
      throw new CommercialRetainerError("invalid_input");
    }
    return this.repository.mutateRetainerRequest(scope, requestId, action);
  }
}

export function createCommercialRetainerService(input: {
  repository: CommercialRetainerRepository;
  now?: () => Date;
}): CommercialRetainerService {
  return new CommercialRetainerService(input.repository, input.now);
}
