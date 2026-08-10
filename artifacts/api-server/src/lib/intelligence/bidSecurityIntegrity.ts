import {
  deterministicId,
  hasBlockers,
  isIsoDate,
  isValidId,
  resolveSubjectReview,
  reviewIsAccepted,
  sortIssues,
  uniqueIds,
  validateCitations,
  validateHumanReview,
  type DomainIssue,
  type ExactCitation,
  type GroundedCitation,
  type HumanReview,
  type SourceDocument,
  type SubjectReview,
} from "./domain";
import {
  NEXT_CAPABILITY_MAX_ITEMS,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export interface BidSecurityRequirementInput {
  readonly externalId: string;
  readonly label: string;
  readonly requiredAmountMinor: string;
  readonly requiredAmountText: string;
  readonly currency: string;
  readonly beneficiary: string;
  readonly permittedIssuerTypes: readonly string[];
  readonly issueNotBefore?: string;
  readonly issueNotBeforeText?: string;
  readonly requiredValidUntil: string;
  readonly requiredValidUntilText: string;
  readonly requiredPhrases: readonly string[];
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface BidSecurityInstrumentInput {
  readonly externalId: string;
  readonly requirementExternalId: string;
  readonly statedAmountMinor: string;
  readonly statedAmountText: string;
  readonly currency: string;
  readonly beneficiary: string;
  readonly issuerName: string;
  readonly issuerType: string;
  readonly issueDate: string;
  readonly issueDateText: string;
  readonly expiryDate: string;
  readonly expiryDateText: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface BidSecurityIntegrityInput {
  readonly sources: readonly SourceDocument[];
  readonly requirements: readonly BidSecurityRequirementInput[];
  readonly instruments: readonly BidSecurityInstrumentInput[];
  readonly deskReview?: SubjectReview;
}

export interface BidSecurityRequirementRecord extends BidSecurityRequirementInput {
  readonly requirementId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface BidSecurityInstrumentRecord extends BidSecurityInstrumentInput {
  readonly instrumentId: string;
  readonly requirementId: string;
  readonly citations: readonly GroundedCitation[];
}

export type BidSecurityMismatchCode =
  | "amount_mismatch"
  | "currency_mismatch"
  | "beneficiary_mismatch"
  | "issuer_type_not_permitted"
  | "issued_too_early"
  | "validity_too_short"
  | "required_wording_missing";

export interface BidSecurityCheck {
  readonly requirementId: string;
  readonly instrumentIds: readonly string[];
  readonly state: "missing" | "pending_review" | "mismatch" | "matches";
  readonly mismatches: readonly BidSecurityMismatchCode[];
}

export interface BidSecurityIntegrityResult {
  readonly deskId: string;
  readonly status: "blocked" | "incomplete" | "review_required" | "ready";
  readonly readyForHumanDecision: boolean;
  readonly requirements: readonly BidSecurityRequirementRecord[];
  readonly instruments: readonly BidSecurityInstrumentRecord[];
  readonly checks: readonly BidSecurityCheck[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly instrumentLegallyValidated: false;
  readonly bankInstructionAuthorized: false;
  readonly safety: NextCapabilitySafetyEnvelope;
}

const MINOR_AMOUNT = /^(?:0|[1-9]\d*)$/u;

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

function citationsContain(
  citations: readonly GroundedCitation[],
  values: readonly string[],
): boolean {
  return citations.some((citation) => {
    const text = normalized(citation.quote);
    return values.every((value) => {
      const sought = normalized(value);
      return sought.length > 0 && text.includes(sought);
    });
  });
}

function amountTextSupportsMinorUnits(
  amountText: string,
  value: string,
): boolean {
  return normalized(amountText).includes(`${value} minor units`);
}

function validMinorAmount(value: string): boolean {
  return value.length <= 100 && MINOR_AMOUNT.test(value) && BigInt(value) > 0n;
}

function isRequirementSource(citations: readonly GroundedCitation[]): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceAuthority === "authoritative" &&
        (citation.sourceKind === "solicitation" ||
          citation.sourceKind === "addendum"),
    )
  );
}

function isInstrumentSource(citations: readonly GroundedCitation[]): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceKind === "company_evidence" &&
        citation.sourceAuthority !== "unverified",
    )
  );
}

/**
 * Compares reviewed security requirements with reviewed instrument facts. A
 * matching result is a deterministic checklist outcome, never a legal opinion,
 * bank instruction, authenticity attestation, or release decision.
 */
export function evaluateBidSecurityIntegrity(
  input: BidSecurityIntegrityInput,
): BidSecurityIntegrityResult {
  const sourceValidation = validateNextCapabilitySources(
    input.sources,
    "Bid-security source documents",
  );
  const sourceSet = sourceValidation.sourceSet;
  const issues: DomainIssue[] = [
    ...sourceValidation.issues,
    ...validateNextCapabilityCollection(
      input.requirements,
      "requirements",
      "Bid-security requirements",
    ),
    ...validateNextCapabilityCollection(
      input.instruments,
      "instruments",
      "Bid-security instruments",
    ),
  ];
  const requirementInputs = input.requirements.slice(
    0,
    NEXT_CAPABILITY_MAX_ITEMS,
  );
  const instrumentInputs = input.instruments.slice(
    0,
    NEXT_CAPABILITY_MAX_ITEMS,
  );
  issues.push(
    ...uniqueIds(requirementInputs, "requirements"),
    ...uniqueIds(instrumentInputs, "instruments"),
  );

  const requirements: BidSecurityRequirementRecord[] = [];
  requirementInputs.forEach((requirement, index) => {
    const path = `requirements[${index}]`;
    const citationIssues = validateNextCapabilityCollection(
      requirement.citations,
      `${path}.citations`,
      "Security requirement citations",
    );
    const local = validateCitations(
      requirement.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const issuerTypeIssues = validateNextCapabilityCollection(
      requirement.permittedIssuerTypes,
      `${path}.permittedIssuerTypes`,
      "Permitted issuer types",
      50,
    );
    const requiredPhraseIssues = validateNextCapabilityCollection(
      requirement.requiredPhrases,
      `${path}.requiredPhrases`,
      "Required instrument phrases",
      100,
    );
    const permittedIssuerTypes = requirement.permittedIssuerTypes.slice(0, 50);
    const requiredPhrases = requirement.requiredPhrases.slice(0, 100);
    const nestedTextIssues = [
      ...permittedIssuerTypes.flatMap((value, valueIndex) =>
        validateNextCapabilityText(
          value,
          `${path}.permittedIssuerTypes[${valueIndex}]`,
          "Permitted issuer type",
          { maximum: 256 },
        ),
      ),
      ...requiredPhrases.flatMap((value, valueIndex) =>
        validateNextCapabilityText(
          value,
          `${path}.requiredPhrases[${valueIndex}]`,
          "Required instrument phrase",
        ),
      ),
    ];
    const textIssues = [
      ...validateNextCapabilityText(
        requirement.label,
        `${path}.label`,
        "Security requirement label",
      ),
      ...validateNextCapabilityText(
        requirement.requiredAmountText,
        `${path}.requiredAmountText`,
        "Required amount source text",
      ),
      ...validateNextCapabilityText(
        requirement.currency,
        `${path}.currency`,
        "Required currency",
        { maximum: 12 },
      ),
      ...validateNextCapabilityText(
        requirement.beneficiary,
        `${path}.beneficiary`,
        "Required beneficiary",
      ),
      ...validateNextCapabilityText(
        requirement.requiredValidUntilText,
        `${path}.requiredValidUntilText`,
        "Required validity source text",
      ),
      ...(requirement.issueNotBeforeText === undefined
        ? []
        : validateNextCapabilityText(
            requirement.issueNotBeforeText,
            `${path}.issueNotBeforeText`,
            "Earliest issue-date source text",
          )),
    ];
    issues.push(
      ...citationIssues,
      ...issuerTypeIssues,
      ...requiredPhraseIssues,
      ...nestedTextIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(requirement.review, `${path}.review`),
    );
    if (!validMinorAmount(requirement.requiredAmountMinor)) {
      issues.push({
        code: "invalid_security_amount",
        severity: "blocker",
        path: `${path}.requiredAmountMinor`,
        message:
          "Required security amount must be a positive integer in minor units.",
      });
    }
    if (!isIsoDate(requirement.requiredValidUntil)) {
      issues.push({
        code: "invalid_security_date",
        severity: "blocker",
        path: `${path}.requiredValidUntil`,
        message: "Required security validity must be an ISO calendar date.",
      });
    }
    if (requirement.issueNotBefore && !isIsoDate(requirement.issueNotBefore)) {
      issues.push({
        code: "invalid_security_date",
        severity: "blocker",
        path: `${path}.issueNotBefore`,
        message: "The earliest issue date must be an ISO calendar date.",
      });
    }
    if (
      Boolean(requirement.issueNotBefore) !==
      Boolean(requirement.issueNotBeforeText?.trim())
    ) {
      issues.push({
        code: "issue_date_source_text_mismatch",
        severity: "blocker",
        path: `${path}.issueNotBeforeText`,
        message:
          "An earliest issue date and its exact source text must be supplied together.",
      });
    }
    if (
      permittedIssuerTypes.length === 0 ||
      permittedIssuerTypes.some((value) => !value.trim()) ||
      requiredPhrases.some((value) => !value.trim())
    ) {
      issues.push({
        code: "invalid_security_wording_rule",
        severity: "blocker",
        path,
        message:
          "Issuer types must be non-empty and required phrases may not contain empty values.",
      });
    }
    const sourceValues = [
      requirement.label,
      requirement.requiredAmountText,
      requirement.currency,
      requirement.beneficiary,
      requirement.requiredValidUntilText,
      ...(requirement.issueNotBeforeText
        ? [requirement.issueNotBeforeText]
        : []),
      ...permittedIssuerTypes,
      ...requiredPhrases,
    ];
    const machineFactsCited =
      amountTextSupportsMinorUnits(
        requirement.requiredAmountText,
        requirement.requiredAmountMinor,
      ) &&
      normalized(requirement.requiredValidUntilText).includes(
        `valid until ${requirement.requiredValidUntil}`,
      ) &&
      (!requirement.issueNotBefore ||
        normalized(requirement.issueNotBeforeText ?? "").includes(
          `issue not before ${requirement.issueNotBefore}`,
        ));
    if (local.citations.length && !isRequirementSource(local.citations)) {
      issues.push({
        code: "security_requirement_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Bid-security rules require authoritative solicitation or addendum citations.",
      });
    }
    if (
      local.citations.length &&
      (!citationsContain(local.citations, sourceValues) || !machineFactsCited)
    ) {
      issues.push({
        code: "security_requirement_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Required amount in minor units, currency, beneficiary, validity dates, issuer, and wording facts must occur in the cited source text.",
      });
    }
    const valid =
      isValidId(requirement.externalId) &&
      citationIssues.length === 0 &&
      issuerTypeIssues.length === 0 &&
      requiredPhraseIssues.length === 0 &&
      nestedTextIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      isRequirementSource(local.citations) &&
      citationsContain(local.citations, sourceValues) &&
      machineFactsCited &&
      validMinorAmount(requirement.requiredAmountMinor) &&
      isIsoDate(requirement.requiredValidUntil) &&
      (!requirement.issueNotBefore || isIsoDate(requirement.issueNotBefore)) &&
      Boolean(requirement.issueNotBefore) ===
        Boolean(requirement.issueNotBeforeText?.trim()) &&
      permittedIssuerTypes.length > 0 &&
      permittedIssuerTypes.every((value) => value.trim()) &&
      requiredPhrases.every((value) => value.trim());
    if (valid) {
      requirements.push({
        ...requirement,
        requirementId: deterministicId("bondreq", {
          externalId: requirement.externalId,
          label: requirement.label,
          requiredAmountMinor: requirement.requiredAmountMinor,
          requiredAmountText: requirement.requiredAmountText,
          currency: requirement.currency,
          beneficiary: requirement.beneficiary,
          permittedIssuerTypes: [...permittedIssuerTypes].sort(),
          issueNotBefore: requirement.issueNotBefore,
          issueNotBeforeText: requirement.issueNotBeforeText,
          requiredValidUntil: requirement.requiredValidUntil,
          requiredValidUntilText: requirement.requiredValidUntilText,
          requiredPhrases: [...requiredPhrases].sort(),
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        permittedIssuerTypes: [...permittedIssuerTypes].sort(),
        requiredPhrases: [...requiredPhrases].sort(),
        citations: local.citations,
      });
    }
  });
  requirements.sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId),
  );
  const requirementByExternalId = new Map(
    requirements.map((requirement) => [requirement.externalId, requirement]),
  );

  const instruments: BidSecurityInstrumentRecord[] = [];
  instrumentInputs.forEach((instrument, index) => {
    const path = `instruments[${index}]`;
    const requirement = requirementByExternalId.get(
      instrument.requirementExternalId,
    );
    const citationIssues = validateNextCapabilityCollection(
      instrument.citations,
      `${path}.citations`,
      "Security instrument citations",
    );
    const local = validateCitations(
      instrument.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(
        instrument.statedAmountText,
        `${path}.statedAmountText`,
        "Instrument amount source text",
      ),
      ...validateNextCapabilityText(
        instrument.currency,
        `${path}.currency`,
        "Instrument currency",
        { maximum: 12 },
      ),
      ...validateNextCapabilityText(
        instrument.beneficiary,
        `${path}.beneficiary`,
        "Instrument beneficiary",
      ),
      ...validateNextCapabilityText(
        instrument.issuerName,
        `${path}.issuerName`,
        "Instrument issuer",
      ),
      ...validateNextCapabilityText(
        instrument.issuerType,
        `${path}.issuerType`,
        "Instrument issuer type",
      ),
      ...validateNextCapabilityText(
        instrument.issueDateText,
        `${path}.issueDateText`,
        "Instrument issue-date source text",
      ),
      ...validateNextCapabilityText(
        instrument.expiryDateText,
        `${path}.expiryDateText`,
        "Instrument expiry-date source text",
      ),
    ];
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(instrument.review, `${path}.review`),
    );
    if (!requirement) {
      issues.push({
        code: "security_requirement_reference_missing",
        severity: "blocker",
        path: `${path}.requirementExternalId`,
        message:
          "Every instrument must reference a valid security requirement.",
      });
    }
    if (!validMinorAmount(instrument.statedAmountMinor)) {
      issues.push({
        code: "invalid_security_amount",
        severity: "blocker",
        path: `${path}.statedAmountMinor`,
        message: "Instrument amount must be a positive integer in minor units.",
      });
    }
    if (!isIsoDate(instrument.issueDate) || !isIsoDate(instrument.expiryDate)) {
      issues.push({
        code: "invalid_security_date",
        severity: "blocker",
        path,
        message:
          "Instrument issue and expiry dates must be ISO calendar dates.",
      });
    } else if (instrument.issueDate > instrument.expiryDate) {
      issues.push({
        code: "invalid_security_date_range",
        severity: "blocker",
        path,
        message: "Instrument expiry may not precede its issue date.",
      });
    }
    if (local.citations.length && !isInstrumentSource(local.citations)) {
      issues.push({
        code: "security_instrument_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Instrument facts require verified company-evidence provenance.",
      });
    }
    const sourceValues = [
      instrument.statedAmountText,
      instrument.currency,
      instrument.beneficiary,
      instrument.issuerName,
      instrument.issuerType,
      instrument.issueDateText,
      instrument.expiryDateText,
    ];
    const machineFactsCited =
      amountTextSupportsMinorUnits(
        instrument.statedAmountText,
        instrument.statedAmountMinor,
      ) &&
      normalized(instrument.issueDateText).includes(
        `issue date ${instrument.issueDate}`,
      ) &&
      normalized(instrument.expiryDateText).includes(
        `expiry date ${instrument.expiryDate}`,
      );
    if (
      local.citations.length &&
      (!citationsContain(local.citations, sourceValues) || !machineFactsCited)
    ) {
      issues.push({
        code: "security_instrument_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Instrument amount in minor units, currency, beneficiary, issuer, and machine-compared dates must occur in the cited instrument text.",
      });
    }
    if (
      requirement &&
      isValidId(instrument.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      isInstrumentSource(local.citations) &&
      citationsContain(local.citations, sourceValues) &&
      machineFactsCited &&
      validMinorAmount(instrument.statedAmountMinor) &&
      isIsoDate(instrument.issueDate) &&
      isIsoDate(instrument.expiryDate) &&
      instrument.issueDate <= instrument.expiryDate
    ) {
      instruments.push({
        ...instrument,
        instrumentId: deterministicId("bondinst", {
          externalId: instrument.externalId,
          requirementId: requirement.requirementId,
          statedAmountMinor: instrument.statedAmountMinor,
          statedAmountText: instrument.statedAmountText,
          currency: instrument.currency,
          beneficiary: instrument.beneficiary,
          issuerName: instrument.issuerName,
          issuerType: instrument.issuerType,
          issueDate: instrument.issueDate,
          issueDateText: instrument.issueDateText,
          expiryDate: instrument.expiryDate,
          expiryDateText: instrument.expiryDateText,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        requirementId: requirement.requirementId,
        citations: local.citations,
      });
    }
  });
  instruments.sort((left, right) =>
    left.instrumentId.localeCompare(right.instrumentId),
  );

  const checks: BidSecurityCheck[] = requirements.map((requirement) => {
    const candidates = instruments.filter(
      (instrument) => instrument.requirementId === requirement.requirementId,
    );
    if (candidates.length > 1) {
      issues.push({
        code: "multiple_security_instruments",
        severity: "blocker",
        path: `requirements.${requirement.externalId}`,
        message:
          "A requirement has multiple candidate instruments and needs an explicit human selection.",
      });
    }
    const instrument = candidates.length === 1 ? candidates[0] : undefined;
    if (!instrument) {
      return {
        requirementId: requirement.requirementId,
        instrumentIds: candidates.map((candidate) => candidate.instrumentId),
        state: "missing",
        mismatches: [],
      };
    }
    const coreInstrumentValues = [
      instrument.statedAmountText,
      instrument.currency,
      instrument.beneficiary,
      instrument.issuerName,
      instrument.issuerType,
      instrument.issueDateText,
      instrument.expiryDateText,
    ];
    const requiredWordingCited = instrument.citations.some((citation) =>
      citationsContain(
        [citation],
        [...coreInstrumentValues, ...requirement.requiredPhrases],
      ),
    );
    const mismatches: BidSecurityMismatchCode[] = [];
    if (
      BigInt(instrument.statedAmountMinor) !==
      BigInt(requirement.requiredAmountMinor)
    ) {
      mismatches.push("amount_mismatch");
    }
    if (normalized(instrument.currency) !== normalized(requirement.currency)) {
      mismatches.push("currency_mismatch");
    }
    if (
      normalized(instrument.beneficiary) !== normalized(requirement.beneficiary)
    ) {
      mismatches.push("beneficiary_mismatch");
    }
    if (
      !requirement.permittedIssuerTypes.some(
        (issuerType) =>
          normalized(issuerType) === normalized(instrument.issuerType),
      )
    ) {
      mismatches.push("issuer_type_not_permitted");
    }
    if (
      requirement.issueNotBefore &&
      instrument.issueDate < requirement.issueNotBefore
    ) {
      mismatches.push("issued_too_early");
    }
    if (instrument.expiryDate < requirement.requiredValidUntil) {
      mismatches.push("validity_too_short");
    }
    if (!requiredWordingCited) {
      mismatches.push("required_wording_missing");
    }
    mismatches.sort();
    const pending =
      !reviewIsAccepted(requirement.review) ||
      !reviewIsAccepted(instrument.review);
    return {
      requirementId: requirement.requirementId,
      instrumentIds: [instrument.instrumentId],
      state: pending
        ? "pending_review"
        : mismatches.length
          ? "mismatch"
          : "matches",
      mismatches,
    };
  });
  checks.sort((left, right) =>
    left.requirementId.localeCompare(right.requirementId),
  );
  const deskId = deterministicId("bonddesk", {
    requirements: requirements.map((requirement) => [
      requirement.requirementId,
      requirement.review,
    ]),
    instruments: instruments.map((instrument) => [
      instrument.instrumentId,
      instrument.review,
    ]),
    checks,
  });
  const deskReviewResult = resolveSubjectReview(
    deskId,
    input.deskReview,
    "deskReview",
  );
  issues.push(...deskReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const allMatch =
    requirements.length > 0 &&
    checks.length === requirements.length &&
    checks.every((check) => check.state === "matches");
  const readyForHumanDecision =
    !hasBlockers(sortedIssues) &&
    allMatch &&
    reviewIsAccepted(deskReviewResult.review);
  const status: BidSecurityIntegrityResult["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : requirements.length === 0 ||
        checks.some((check) => check.state === "missing")
      ? "incomplete"
      : readyForHumanDecision
        ? "ready"
        : "review_required";
  return {
    deskId,
    status,
    readyForHumanDecision,
    requirements,
    instruments,
    checks,
    review: deskReviewResult.review,
    issues: sortedIssues,
    instrumentLegallyValidated: false,
    bankInstructionAuthorized: false,
    safety: nextCapabilitySafety(),
  };
}
