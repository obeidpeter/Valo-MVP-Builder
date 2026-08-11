import { createHash } from "node:crypto";
import {
  OPPORTUNITY_SOURCE_KINDS,
  OPPORTUNITY_SOURCE_NETWORK_BOUNDS,
  OPPORTUNITY_SOURCE_NETWORK_STATUS,
  OpportunitySourceNetworkError,
  type LicensedOpportunityFeedDescriptor,
  type NormalizedOpportunitySourceInput,
  type OpportunitySourceCandidate,
  type OpportunitySourceDecision,
  type OpportunitySourceInput,
  type OpportunitySourceListResult,
  type OpportunitySourceRepository,
  type OpportunitySourceScope,
} from "./contracts";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const COUNTRY = /^[A-Z]{2}$/u;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function hashOpportunitySourceValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex");
}

function boundedText(value: unknown, maximum: number, field: string): string {
  if (typeof value !== "string" || CONTROL.test(value)) {
    throw new OpportunitySourceNetworkError(
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
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      `${field} is outside the accepted bound.`,
    );
  }
  return normalized;
}

function optionalText(
  value: unknown,
  maximum: number,
  field: string,
): string | null {
  return value == null ? null : boundedText(value, maximum, field);
}

function exactIso(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      `${field} is invalid.`,
    );
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      `${field} is invalid.`,
    );
  }
  return value;
}

function optionalIso(value: unknown, field: string): string | null {
  return value == null ? null : exactIso(value, field);
}

/**
 * External locators are metadata, never instructions. Credentials, fragments
 * and query strings are rejected so signed URLs/tokens cannot enter the audit
 * ledger. Only an HTTPS origin and path are retained.
 */
export function normalizeOpportunitySourceLocator(value: unknown): string {
  const raw = boundedText(
    value,
    OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxLocatorCodeUnits,
    "sourceLocator",
  );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "sourceLocator must be an absolute HTTPS URL.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "sourceLocator must not contain credentials, query data or a fragment.",
    );
  }
  return url.toString();
}

export function normalizeOpportunitySourceInput(
  input: OpportunitySourceInput,
  provenance: NormalizedOpportunitySourceInput["provenance"],
): NormalizedOpportunitySourceInput {
  if (!input || typeof input !== "object") {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "Source input is required.",
    );
  }
  if (!OPPORTUNITY_SOURCE_KINDS.includes(input.sourceKind)) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "sourceKind is invalid.",
    );
  }
  const sourceSystem = boundedText(
    input.sourceSystem,
    OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxIdCodeUnits,
    "sourceSystem",
  );
  if (!SAFE_ID.test(sourceSystem)) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "sourceSystem is invalid.",
    );
  }
  const externalReference = boundedText(
    input.externalReference,
    OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxIdCodeUnits,
    "externalReference",
  );
  if (!SAFE_ID.test(externalReference)) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "externalReference is invalid.",
    );
  }
  const sourceLocator = normalizeOpportunitySourceLocator(input.sourceLocator);
  const observedAt = exactIso(input.observedAt, "observedAt");
  const publishedAt = optionalIso(input.publishedAt, "publishedAt");
  const submissionDeadline = optionalIso(
    input.submissionDeadline,
    "submissionDeadline",
  );
  if (publishedAt && submissionDeadline && publishedAt > submissionDeadline) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "publishedAt must not be later than submissionDeadline.",
    );
  }
  if (new Date(observedAt).getTime() > Date.now() + 300_000) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "observedAt must not be in the future.",
    );
  }
  const sourceContentSha256 = input.sourceContentSha256;
  if (sourceContentSha256 !== null && !SHA256.test(sourceContentSha256)) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "sourceContentSha256 is invalid.",
    );
  }
  const jurisdiction = boundedText(
    input.jurisdiction,
    2,
    "jurisdiction",
  ).toUpperCase();
  if (!COUNTRY.test(jurisdiction)) {
    throw new OpportunitySourceNetworkError(
      "invalid_request",
      "jurisdiction is invalid.",
    );
  }
  const normalized: OpportunitySourceInput = {
    sourceKind: input.sourceKind,
    sourceSystem,
    sourceAuthority: boundedText(
      input.sourceAuthority,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits,
      "sourceAuthority",
    ),
    sourceLocator,
    sourceLicenceReference: optionalText(
      input.sourceLicenceReference,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxSummaryCodeUnits,
      "sourceLicenceReference",
    ),
    externalReference,
    title: boundedText(
      input.title,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits,
      "title",
    ),
    procuringEntity: boundedText(
      input.procuringEntity,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits,
      "procuringEntity",
    ),
    jurisdiction,
    fundingSource: optionalText(
      input.fundingSource,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits,
      "fundingSource",
    ),
    procurementCategory: optionalText(
      input.procurementCategory,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits,
      "procurementCategory",
    ),
    publishedAt,
    submissionDeadline,
    observedAt,
    sourceContentSha256,
  };
  const sourceLocatorSha256 = hashOpportunitySourceValue(sourceLocator);
  return {
    ...normalized,
    provenance,
    sourceLocatorSha256,
    dedupeKey: hashOpportunitySourceValue({
      sourceSystem,
      externalReference,
    }),
    receiptSha256: hashOpportunitySourceValue({
      ...normalized,
      provenance,
      sourceLocatorSha256,
    }),
  };
}

function assertScope(scope: OpportunitySourceScope): void {
  if (
    !UUID.test(scope.organisationId) ||
    !UUID.test(scope.actorUserId) ||
    !boundedText(
      scope.actorName,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxTitleCodeUnits,
      "actorName",
    )
  ) {
    throw new OpportunitySourceNetworkError(
      "scope_denied",
      "Source access denied.",
    );
  }
}

export class OpportunitySourceNetworkService {
  constructor(private readonly repository: OpportunitySourceRepository) {}

  async list(
    scope: OpportunitySourceScope,
  ): Promise<OpportunitySourceListResult> {
    assertScope(scope);
    const items = await this.repository.list(scope);
    if (
      items.length > OPPORTUNITY_SOURCE_NETWORK_BOUNDS.candidatesPerOrganisation
    ) {
      throw new OpportunitySourceNetworkError(
        "capacity_exceeded",
        "The opportunity source inbox exceeds its safe bound.",
      );
    }
    return {
      items,
      limit: OPPORTUNITY_SOURCE_NETWORK_BOUNDS.candidatesPerOrganisation,
      truncated: false,
      authority: OPPORTUNITY_SOURCE_NETWORK_STATUS,
    };
  }

  async get(
    scope: OpportunitySourceScope,
    candidateId: string,
  ): Promise<OpportunitySourceCandidate> {
    assertScope(scope);
    if (!UUID.test(candidateId)) {
      throw new OpportunitySourceNetworkError(
        "not_found",
        "Candidate not found.",
      );
    }
    const candidate = await this.repository.get(scope, candidateId);
    if (!candidate) {
      throw new OpportunitySourceNetworkError(
        "not_found",
        "Candidate not found.",
      );
    }
    return candidate;
  }

  async recordManual(
    scope: OpportunitySourceScope,
    input: OpportunitySourceInput,
  ): Promise<OpportunitySourceCandidate> {
    assertScope(scope);
    if (input.sourceKind !== "manual_url") {
      throw new OpportunitySourceNetworkError(
        "invalid_request",
        "The manual endpoint accepts manual_url receipts only.",
      );
    }
    return this.repository.create(
      scope,
      normalizeOpportunitySourceInput(input, "operator_recorded"),
    );
  }

  async recordFromApprovedAdapter(
    scope: OpportunitySourceScope,
    descriptor: LicensedOpportunityFeedDescriptor,
    input: OpportunitySourceInput,
  ): Promise<OpportunitySourceCandidate> {
    assertScope(scope);
    if (
      descriptor.kind !== "licensed_tender_feed" ||
      descriptor.mode !== "production" ||
      descriptor.productionApproved !== true ||
      !descriptor.licenceEvidenceVersion?.trim() ||
      !["licensed_feed", "ocds"].includes(input.sourceKind)
    ) {
      throw new OpportunitySourceNetworkError(
        "source_unavailable",
        "The licensed opportunity source is not approved for production use.",
      );
    }
    if (!input.sourceLicenceReference?.trim()) {
      throw new OpportunitySourceNetworkError(
        "invalid_request",
        "Approved feeds require a source licence reference.",
      );
    }
    return this.repository.create(
      scope,
      normalizeOpportunitySourceInput(input, "adapter_verified"),
    );
  }

  async decide(
    scope: OpportunitySourceScope,
    candidateId: string,
    input: OpportunitySourceDecision,
  ): Promise<OpportunitySourceCandidate> {
    assertScope(scope);
    if (
      !UUID.test(candidateId) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !["accept", "reject"].includes(input.decision)
    ) {
      throw new OpportunitySourceNetworkError(
        "invalid_request",
        "Decision is invalid.",
      );
    }
    const reason = boundedText(
      input.reason,
      OPPORTUNITY_SOURCE_NETWORK_BOUNDS.maxSummaryCodeUnits,
      "reason",
    );
    return this.repository.decide(scope, candidateId, { ...input, reason });
  }
}
