import {
  deterministicId,
  hasBlockers,
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
  boundedNextCapabilityRecordKeys,
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export type CommercialEventBasis = "tender_term" | "company_assumption";
export type CommercialEventDirection = "inflow" | "outflow";
export type CommercialEventType =
  | "mobilisation"
  | "payment"
  | "retention_hold"
  | "retention_release"
  | "security_posting"
  | "security_release"
  | "tax_withholding"
  | "project_cost"
  | "other";

export interface CommercialOpeningBalanceInput {
  readonly externalId: string;
  readonly currency: string;
  readonly amountDecimal: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface CommercialCashflowEventInput {
  readonly externalId: string;
  readonly label: string;
  readonly eventType: CommercialEventType;
  readonly basis: CommercialEventBasis;
  readonly direction: CommercialEventDirection;
  readonly currency: string;
  readonly amountDecimal: string;
  readonly dayOffset: number;
  readonly timingText: string;
  readonly sourceTermText: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface CommercialExposureInput {
  readonly policyVersion: string;
  readonly currencyMinorDigits: Readonly<Record<string, number>>;
  readonly sources: readonly SourceDocument[];
  readonly openingBalances: readonly CommercialOpeningBalanceInput[];
  readonly events: readonly CommercialCashflowEventInput[];
  readonly projectionReview?: SubjectReview;
}

export interface CommercialOpeningBalanceRecord extends CommercialOpeningBalanceInput {
  readonly openingBalanceId: string;
  readonly amountMinor: string;
  readonly citations: readonly GroundedCitation[];
}

export interface CommercialCashflowEventRecord extends CommercialCashflowEventInput {
  readonly eventId: string;
  readonly amountMinor: string;
  readonly signedAmountMinor: string;
  readonly includedInProjection: boolean;
  readonly citations: readonly GroundedCitation[];
}

export interface CommercialCashflowPoint {
  readonly currency: string;
  readonly dayOffset: number;
  readonly eventIds: readonly string[];
  readonly deltaMinor: string;
  readonly cumulativeBalanceMinor: string;
}

export interface CommercialCurrencyExposure {
  readonly currency: string;
  readonly openingBalanceMinor: string;
  readonly closingBalanceMinor: string;
  readonly peakFundingRequirementMinor: string;
  readonly points: readonly CommercialCashflowPoint[];
}

export interface CommercialExposureResult {
  readonly projectionId: string;
  readonly status: "blocked" | "incomplete" | "review_required" | "ready";
  readonly readyForFinanceReview: boolean;
  readonly policyVersion: string;
  readonly openingBalances: readonly CommercialOpeningBalanceRecord[];
  readonly events: readonly CommercialCashflowEventRecord[];
  readonly exposures: readonly CommercialCurrencyExposure[];
  readonly currenciesMissingOpeningBalance: readonly string[];
  readonly mixedCurrencyNoFx: boolean;
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly financingDecisionAuthorized: false;
  readonly priceChangeAuthorized: false;
  readonly taxOrLegalAdvice: false;
  readonly safety: NextCapabilitySafetyEnvelope;
}

const CURRENCY = /^[A-Z][A-Z0-9]{2,11}$/u;
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const EVENT_TYPES: readonly CommercialEventType[] = [
  "mobilisation",
  "payment",
  "retention_hold",
  "retention_release",
  "security_posting",
  "security_release",
  "tax_withholding",
  "project_cost",
  "other",
];

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

function containsExactDecimalToken(text: string, value: string): boolean {
  const haystack = normalized(text);
  const sought = normalized(value);
  let offset = haystack.indexOf(sought);
  while (offset >= 0) {
    const before = offset === 0 ? "" : (haystack[offset - 1] ?? "");
    const after = haystack[offset + sought.length] ?? "";
    if (!/[\d.]/u.test(before) && !/[\d.]/u.test(after)) return true;
    offset = haystack.indexOf(sought, offset + 1);
  }
  return false;
}

function containsExactTextToken(text: string, value: string): boolean {
  const haystack = normalized(text);
  const sought = normalized(value);
  let offset = haystack.indexOf(sought);
  while (offset >= 0) {
    const before = offset === 0 ? "" : (haystack[offset - 1] ?? "");
    const after = haystack[offset + sought.length] ?? "";
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) {
      return true;
    }
    offset = haystack.indexOf(sought, offset + 1);
  }
  return false;
}

function containsExactDay(text: string, dayOffset: number): boolean {
  const haystack = normalized(text);
  const sought = `day ${dayOffset}`;
  let offset = haystack.indexOf(sought);
  while (offset >= 0) {
    const after = haystack[offset + sought.length] ?? "";
    if (!/\d/u.test(after)) return true;
    offset = haystack.indexOf(sought, offset + 1);
  }
  return false;
}

function eventMachineFactsCited(event: CommercialCashflowEventInput): boolean {
  const sourceTerm = normalized(event.sourceTermText);
  const classification = normalized(
    `${event.basis.replaceAll("_", " ")} ${event.eventType.replaceAll("_", " ")} ${event.direction}`,
  );
  return (
    sourceTerm.startsWith(`${classification}: ${normalized(event.label)} `) &&
    containsExactTextToken(sourceTerm, event.currency) &&
    containsExactDecimalToken(sourceTerm, event.amountDecimal) &&
    sourceTerm.includes(normalized(event.timingText)) &&
    containsExactDay(sourceTerm, event.dayOffset)
  );
}

function parseMinorUnits(value: string, minorDigits: number): bigint | null {
  if (value.length > 100 || !Number.isInteger(minorDigits)) return null;
  const match = DECIMAL.exec(value);
  if (!match) return null;
  const fraction = match[1] ?? "";
  if (minorDigits < 0 || minorDigits > 6 || fraction.length > minorDigits) {
    return null;
  }
  const [whole = "0"] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(minorDigits, "0")}`);
}

function isOpeningSource(citations: readonly GroundedCitation[]): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceKind === "company_evidence" &&
        citation.sourceAuthority !== "unverified",
    )
  );
}

function isEventSource(
  basis: CommercialEventBasis,
  citations: readonly GroundedCitation[],
): boolean {
  if (citations.length === 0) return false;
  if (basis === "tender_term") {
    return citations.every(
      (citation) =>
        citation.sourceAuthority === "authoritative" &&
        (citation.sourceKind === "solicitation" ||
          citation.sourceKind === "addendum"),
    );
  }
  return (
    basis === "company_assumption" &&
    citations.every(
      (citation) =>
        citation.sourceKind === "company_evidence" &&
        citation.sourceAuthority !== "unverified",
    )
  );
}

/**
 * Aggregates accepted, exactly cited cashflow events by currency and relative
 * day. It does not infer FX, tax treatment, prices, financing, calendar dates,
 * or an uncited opening balance.
 */
export function buildCommercialExposureProjection(
  input: CommercialExposureInput,
): CommercialExposureResult {
  const sourceValidation = validateNextCapabilitySources(
    input.sources,
    "Commercial source documents",
  );
  const sourceSet = sourceValidation.sourceSet;
  const issues: DomainIssue[] = [
    ...sourceValidation.issues,
    ...validateNextCapabilityText(
      input.policyVersion,
      "policyVersion",
      "Commercial projection policy version",
      { maximum: 128 },
    ),
    ...validateNextCapabilityCollection(
      input.openingBalances,
      "openingBalances",
      "Commercial opening balances",
    ),
    ...validateNextCapabilityCollection(
      input.events,
      "events",
      "Commercial cashflow events",
    ),
  ];
  const currencyKeyResult = boundedNextCapabilityRecordKeys(
    input.currencyMinorDigits,
    "currencyMinorDigits",
    "Currency policy",
    50,
  );
  issues.push(...currencyKeyResult.issues);
  const currencyEntries = currencyKeyResult.keys.map(
    (currency): [string, number] => [
      currency,
      input.currencyMinorDigits[currency]!,
    ],
  );
  if (currencyEntries.length === 0) {
    issues.push({
      code: "invalid_currency_policy",
      severity: "blocker",
      path: "currencyMinorDigits",
      message:
        "Currency policy must contain between one and fifty configured currencies.",
    });
  }
  for (const [currency, minorDigits] of currencyEntries) {
    if (
      !CURRENCY.test(currency) ||
      !Number.isInteger(minorDigits) ||
      minorDigits < 0 ||
      minorDigits > 6
    ) {
      issues.push({
        code: "invalid_currency_policy",
        severity: "blocker",
        path: `currencyMinorDigits.${currency}`,
        message:
          "Currency codes and minor-unit digits must use the bounded deterministic policy format.",
      });
    }
  }
  const openingInputs = input.openingBalances.slice(
    0,
    NEXT_CAPABILITY_MAX_ITEMS,
  );
  const eventInputs = input.events.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  issues.push(
    ...uniqueIds(openingInputs, "openingBalances"),
    ...uniqueIds(eventInputs, "events"),
  );

  const seenOpeningCurrencies = new Set<string>();
  const openingBalances: CommercialOpeningBalanceRecord[] = [];
  openingInputs.forEach((opening, index) => {
    const path = `openingBalances[${index}]`;
    const citationIssues = validateNextCapabilityCollection(
      opening.citations,
      `${path}.citations`,
      "Opening-balance citations",
    );
    const local = validateCitations(
      opening.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(
        opening.currency,
        `${path}.currency`,
        "Opening-balance currency",
        { maximum: 12 },
      ),
      ...validateNextCapabilityText(
        opening.amountDecimal,
        `${path}.amountDecimal`,
        "Opening-balance amount",
        { maximum: 100 },
      ),
    ];
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(opening.review, `${path}.review`),
    );
    const minorDigits = input.currencyMinorDigits[opening.currency];
    const amountMinor =
      minorDigits === undefined
        ? null
        : parseMinorUnits(opening.amountDecimal, minorDigits);
    if (!CURRENCY.test(opening.currency) || minorDigits === undefined) {
      issues.push({
        code: "commercial_currency_not_configured",
        severity: "blocker",
        path: `${path}.currency`,
        message:
          "Opening-balance currency is absent from the versioned policy.",
      });
    }
    if (amountMinor === null) {
      issues.push({
        code: "invalid_commercial_amount",
        severity: "blocker",
        path: `${path}.amountDecimal`,
        message:
          "Opening balance must be a non-negative exact decimal supported by the currency policy without rounding.",
      });
    }
    if (seenOpeningCurrencies.has(opening.currency)) {
      issues.push({
        code: "duplicate_opening_balance_currency",
        severity: "blocker",
        path: `${path}.currency`,
        message: "Each currency may have only one reviewed opening balance.",
      });
    } else {
      seenOpeningCurrencies.add(opening.currency);
    }
    if (local.citations.length && !isOpeningSource(local.citations)) {
      issues.push({
        code: "opening_balance_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Opening balances require verified company-evidence provenance.",
      });
    }
    const openingFactsCited = local.citations.some((citation) => {
      const text = normalized(citation.quote);
      return (
        containsExactTextToken(text, opening.currency) &&
        containsExactDecimalToken(text, opening.amountDecimal)
      );
    });
    if (local.citations.length && !openingFactsCited) {
      issues.push({
        code: "opening_balance_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Opening-balance currency and exact decimal must occur in the cited source text.",
      });
    }
    if (
      isValidId(opening.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      CURRENCY.test(opening.currency) &&
      minorDigits !== undefined &&
      amountMinor !== null &&
      local.issues.length === 0 &&
      isOpeningSource(local.citations) &&
      openingFactsCited
    ) {
      openingBalances.push({
        ...opening,
        openingBalanceId: deterministicId("cashopen", {
          externalId: opening.externalId,
          currency: opening.currency,
          amountDecimal: opening.amountDecimal,
          amountMinor: String(amountMinor),
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        amountMinor: String(amountMinor),
        citations: local.citations,
      });
    }
  });
  openingBalances.sort((left, right) =>
    left.openingBalanceId.localeCompare(right.openingBalanceId),
  );
  const openingByCurrency = new Map(
    openingBalances.map((opening) => [opening.currency, opening]),
  );

  const events: CommercialCashflowEventRecord[] = [];
  eventInputs.forEach((event, index) => {
    const path = `events[${index}]`;
    const citationIssues = validateNextCapabilityCollection(
      event.citations,
      `${path}.citations`,
      "Commercial-event citations",
    );
    const local = validateCitations(
      event.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(
        event.label,
        `${path}.label`,
        "Commercial event label",
      ),
      ...validateNextCapabilityText(
        event.amountDecimal,
        `${path}.amountDecimal`,
        "Commercial event amount",
        { maximum: 100 },
      ),
      ...validateNextCapabilityText(
        event.timingText,
        `${path}.timingText`,
        "Commercial event timing text",
      ),
      ...validateNextCapabilityText(
        event.sourceTermText,
        `${path}.sourceTermText`,
        "Commercial source term",
      ),
    ];
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(event.review, `${path}.review`),
    );
    const minorDigits = input.currencyMinorDigits[event.currency];
    const amountMinor =
      minorDigits === undefined
        ? null
        : parseMinorUnits(event.amountDecimal, minorDigits);
    if (!CURRENCY.test(event.currency) || minorDigits === undefined) {
      issues.push({
        code: "commercial_currency_not_configured",
        severity: "blocker",
        path: `${path}.currency`,
        message: "Event currency is absent from the versioned policy.",
      });
    }
    if (amountMinor === null || amountMinor <= 0n) {
      issues.push({
        code: "invalid_commercial_amount",
        severity: "blocker",
        path: `${path}.amountDecimal`,
        message:
          "Commercial events require a positive exact decimal supported without rounding.",
      });
    }
    if (
      !Number.isSafeInteger(event.dayOffset) ||
      event.dayOffset < -365 ||
      event.dayOffset > 3_650
    ) {
      issues.push({
        code: "invalid_commercial_day_offset",
        severity: "blocker",
        path: `${path}.dayOffset`,
        message:
          "Commercial event timing must be a safe relative day between -365 and 3650.",
      });
    }
    if (!EVENT_TYPES.includes(event.eventType)) {
      issues.push({
        code: "invalid_commercial_event_type",
        severity: "blocker",
        path: `${path}.eventType`,
        message: "Commercial event type is not recognized.",
      });
    }
    if (event.direction !== "inflow" && event.direction !== "outflow") {
      issues.push({
        code: "invalid_commercial_direction",
        severity: "blocker",
        path: `${path}.direction`,
        message: "Commercial direction must be inflow or outflow.",
      });
    }
    if (event.basis !== "tender_term" && event.basis !== "company_assumption") {
      issues.push({
        code: "invalid_commercial_basis",
        severity: "blocker",
        path: `${path}.basis`,
        message: "Commercial event basis is not recognized.",
      });
    }
    if (
      local.citations.length &&
      !isEventSource(event.basis, local.citations)
    ) {
      issues.push({
        code: "commercial_event_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Tender terms require authoritative tender citations and company assumptions require verified company evidence.",
      });
    }
    const citedValues = [
      event.label,
      event.sourceTermText,
      event.currency,
      event.amountDecimal,
      event.timingText,
    ];
    const machineFactsCited = eventMachineFactsCited(event);
    if (
      local.citations.length &&
      (!citationsContain(local.citations, citedValues) || !machineFactsCited)
    ) {
      issues.push({
        code: "commercial_event_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Event term, type, basis, direction, currency, exact decimal, and machine-compared day must occur in the cited source.",
      });
    }
    if (
      isValidId(event.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      CURRENCY.test(event.currency) &&
      minorDigits !== undefined &&
      amountMinor !== null &&
      amountMinor > 0n &&
      Number.isSafeInteger(event.dayOffset) &&
      event.dayOffset >= -365 &&
      event.dayOffset <= 3_650 &&
      EVENT_TYPES.includes(event.eventType) &&
      (event.direction === "inflow" || event.direction === "outflow") &&
      (event.basis === "tender_term" || event.basis === "company_assumption") &&
      local.issues.length === 0 &&
      isEventSource(event.basis, local.citations) &&
      citationsContain(local.citations, citedValues) &&
      machineFactsCited
    ) {
      const signedAmount =
        event.direction === "inflow" ? amountMinor : -amountMinor;
      events.push({
        ...event,
        eventId: deterministicId("cashevent", {
          externalId: event.externalId,
          label: event.label,
          eventType: event.eventType,
          basis: event.basis,
          direction: event.direction,
          currency: event.currency,
          amountDecimal: event.amountDecimal,
          amountMinor: String(amountMinor),
          dayOffset: event.dayOffset,
          timingText: event.timingText,
          sourceTermText: event.sourceTermText,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        amountMinor: String(amountMinor),
        signedAmountMinor: String(signedAmount),
        includedInProjection: reviewIsAccepted(event.review),
        citations: local.citations,
      });
    }
  });
  events.sort((left, right) => left.eventId.localeCompare(right.eventId));

  const eventCurrencies = [
    ...new Set(events.map((event) => event.currency)),
  ].sort();
  const currenciesMissingOpeningBalance = eventCurrencies.filter(
    (currency) => !openingByCurrency.has(currency),
  );
  for (const currency of currenciesMissingOpeningBalance) {
    issues.push({
      code: "opening_balance_required",
      severity: "warning",
      path: `currencies.${currency}`,
      message:
        "No opening balance was supplied, so this currency is excluded rather than inferred as zero.",
    });
  }

  const exposures: CommercialCurrencyExposure[] = [];
  for (const currency of eventCurrencies) {
    const opening = openingByCurrency.get(currency);
    if (!opening || !reviewIsAccepted(opening.review)) continue;
    const acceptedEvents = events
      .filter(
        (event) => event.currency === currency && event.includedInProjection,
      )
      .sort(
        (left, right) =>
          left.dayOffset - right.dayOffset ||
          left.eventId.localeCompare(right.eventId),
      );
    const grouped = new Map<number, CommercialCashflowEventRecord[]>();
    for (const event of acceptedEvents) {
      grouped.set(event.dayOffset, [
        ...(grouped.get(event.dayOffset) ?? []),
        event,
      ]);
    }
    let cumulative = BigInt(opening.amountMinor);
    let minimum = cumulative;
    const points: CommercialCashflowPoint[] = [];
    for (const [dayOffset, dayEvents] of [...grouped].sort(
      ([left], [right]) => left - right,
    )) {
      const delta = dayEvents.reduce(
        (total, event) => total + BigInt(event.signedAmountMinor),
        0n,
      );
      cumulative += delta;
      if (cumulative < minimum) minimum = cumulative;
      points.push({
        currency,
        dayOffset,
        eventIds: dayEvents.map((event) => event.eventId).sort(),
        deltaMinor: String(delta),
        cumulativeBalanceMinor: String(cumulative),
      });
    }
    exposures.push({
      currency,
      openingBalanceMinor: opening.amountMinor,
      closingBalanceMinor: String(cumulative),
      peakFundingRequirementMinor: String(minimum < 0n ? -minimum : 0n),
      points,
    });
  }
  exposures.sort((left, right) => left.currency.localeCompare(right.currency));

  const projectionId = deterministicId("cashplan", {
    policyVersion: input.policyVersion,
    currencyMinorDigits: Object.fromEntries(
      currencyEntries.sort(([left], [right]) => left.localeCompare(right)),
    ),
    openingBalances: openingBalances.map((opening) => [
      opening.openingBalanceId,
      opening.review,
    ]),
    events: events.map((event) => [event.eventId, event.review]),
    exposures,
    currenciesMissingOpeningBalance,
  });
  const projectionReviewResult = resolveSubjectReview(
    projectionId,
    input.projectionReview,
    "projectionReview",
  );
  issues.push(...projectionReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const allReviewed =
    events.length > 0 &&
    events.every((event) => reviewIsAccepted(event.review)) &&
    eventCurrencies.every((currency) => {
      const opening = openingByCurrency.get(currency);
      return opening ? reviewIsAccepted(opening.review) : false;
    });
  const incomplete =
    events.length === 0 || currenciesMissingOpeningBalance.length > 0;
  const readyForFinanceReview =
    !hasBlockers(sortedIssues) &&
    !incomplete &&
    allReviewed &&
    reviewIsAccepted(projectionReviewResult.review);
  const status: CommercialExposureResult["status"] = hasBlockers(sortedIssues)
    ? "blocked"
    : incomplete
      ? "incomplete"
      : readyForFinanceReview
        ? "ready"
        : "review_required";
  return {
    projectionId,
    status,
    readyForFinanceReview,
    policyVersion: input.policyVersion,
    openingBalances,
    events,
    exposures,
    currenciesMissingOpeningBalance,
    mixedCurrencyNoFx: eventCurrencies.length > 1,
    review: projectionReviewResult.review,
    issues: sortedIssues,
    financingDecisionAuthorized: false,
    priceChangeAuthorized: false,
    taxOrLegalAdvice: false,
    safety: nextCapabilitySafety(),
  };
}
