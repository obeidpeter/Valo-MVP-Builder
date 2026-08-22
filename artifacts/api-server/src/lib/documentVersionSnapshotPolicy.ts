export interface CurrentDocumentVersionIdentity {
  readonly organisationId: string;
  readonly documentId: string;
  readonly objectPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface DocumentVersionCandidate extends CurrentDocumentVersionIdentity {
  readonly id: string;
  readonly addendumStatus: string;
}

/** Historical or duplicate candidates never win by recency. */
export function selectExactCurrentDocumentVersion(
  candidates: readonly DocumentVersionCandidate[],
  current: CurrentDocumentVersionIdentity,
): DocumentVersionCandidate | null {
  const exact = candidates.filter(
    (candidate) =>
      candidate.organisationId === current.organisationId &&
      candidate.documentId === current.documentId &&
      candidate.objectPath === current.objectPath &&
      candidate.sha256 === current.sha256 &&
      candidate.sizeBytes === current.sizeBytes,
  );
  return exact.length === 1 ? exact[0]! : null;
}

export const STRUCTURED_SNAPSHOT_SCHEMA =
  "valo.addendum-structured-snapshot/v2" as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CATEGORIES = new Set([
  "deadline",
  "opening",
  "eligibility",
  "requirement",
  "boq",
  "submission_instruction",
  "contact",
  "other",
]);

export type StructuredField = {
  readonly externalId: string;
  readonly category: string;
  readonly value: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly page?: number;
  readonly section?: string;
};

export type SetOperation = StructuredField & { readonly operation: "set" };
export type RemoveOperation = {
  readonly operation: "remove";
  readonly externalId: string;
  readonly category: string;
  readonly instruction: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly page?: number;
  readonly section?: string;
};

export interface ProposedStructuredSnapshot {
  readonly schema: typeof STRUCTURED_SNAPSHOT_SCHEMA;
  readonly sourceId: string;
  readonly sourceKind: "solicitation" | "addendum";
  readonly mode: "full" | "delta";
  readonly baseVersionId: string | null;
  readonly authority: "authoritative";
  readonly origin: string;
  readonly fields: readonly StructuredField[];
  readonly operations: readonly (SetOperation | RemoveOperation)[];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function exactSpan(
  value: Record<string, unknown>,
  canonicalText: string,
  contentKey: "value" | "instruction",
): boolean {
  const content = value[contentKey];
  return (
    typeof value.externalId === "string" &&
    EXTERNAL_ID.test(value.externalId) &&
    typeof value.category === "string" &&
    CATEGORIES.has(value.category) &&
    typeof content === "string" &&
    content.length >= 1 &&
    content.length <= 20_000 &&
    Number.isSafeInteger(value.startOffset) &&
    Number.isSafeInteger(value.endOffset) &&
    Number(value.startOffset) >= 0 &&
    Number(value.endOffset) > Number(value.startOffset) &&
    Number(value.endOffset) <= canonicalText.length &&
    canonicalText.slice(Number(value.startOffset), Number(value.endOffset)) ===
      content &&
    (value.page === undefined ||
      (Number.isSafeInteger(value.page) && Number(value.page) > 0)) &&
    (value.section === undefined ||
      (typeof value.section === "string" && value.section.length <= 2_000))
  );
}

function optionalLocationKeys(value: Record<string, unknown>): string[] {
  return [
    ...(value.page === undefined ? [] : ["page"]),
    ...(value.section === undefined ? [] : ["section"]),
  ];
}

function parseField(
  value: unknown,
  canonicalText: string,
): StructuredField | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "externalId",
      "category",
      "value",
      "startOffset",
      "endOffset",
      ...optionalLocationKeys(value),
    ]) ||
    !exactSpan(value, canonicalText, "value")
  ) {
    return null;
  }
  return value as StructuredField;
}

function parseOperation(
  value: unknown,
  canonicalText: string,
): SetOperation | RemoveOperation | null {
  if (!record(value)) return null;
  const common = [
    "operation",
    "externalId",
    "category",
    "startOffset",
    "endOffset",
    ...optionalLocationKeys(value),
  ];
  if (
    value.operation === "set" &&
    exactKeys(value, [...common, "value"]) &&
    exactSpan(value, canonicalText, "value")
  ) {
    return value as SetOperation;
  }
  if (
    value.operation === "remove" &&
    exactKeys(value, [...common, "instruction"]) &&
    exactSpan(value, canonicalText, "instruction")
  ) {
    return value as RemoveOperation;
  }
  return null;
}

/**
 * Validates an explicit human proposal only. It never infers kind, series,
 * predecessor, stable IDs or authoritative fields from filenames or text.
 */
export function parseProposedStructuredSnapshot(input: {
  readonly value: unknown;
  readonly canonicalText: string;
  readonly documentId: string;
  readonly documentVersionId: string;
}): ProposedStructuredSnapshot | null {
  const value = input.value;
  if (
    !record(value) ||
    !exactKeys(value, [
      "schema",
      "sourceId",
      "sourceKind",
      "mode",
      "baseVersionId",
      "authority",
      "origin",
      "fields",
      "operations",
    ]) ||
    value.schema !== STRUCTURED_SNAPSHOT_SCHEMA ||
    typeof value.sourceId !== "string" ||
    !UUID.test(value.sourceId) ||
    (value.sourceKind !== "solicitation" && value.sourceKind !== "addendum") ||
    (value.mode !== "full" && value.mode !== "delta") ||
    (value.baseVersionId !== null &&
      (typeof value.baseVersionId !== "string" ||
        !UUID.test(value.baseVersionId))) ||
    value.authority !== "authoritative" ||
    value.origin !==
      `document:${input.documentId}:version:${input.documentVersionId}` ||
    value.origin.length > 1_000 ||
    !Array.isArray(value.fields) ||
    !Array.isArray(value.operations) ||
    value.fields.length > 512 ||
    value.operations.length > 512
  ) {
    return null;
  }
  const fields = value.fields.map((field) =>
    parseField(field, input.canonicalText),
  );
  const operations = value.operations.map((operation) =>
    parseOperation(operation, input.canonicalText),
  );
  if (
    fields.some((field) => field === null) ||
    operations.some((operation) => operation === null) ||
    new Set(fields.map((field) => field?.externalId)).size !== fields.length ||
    new Set(operations.map((operation) => operation?.externalId)).size !==
      operations.length
  ) {
    return null;
  }
  if (
    value.sourceKind === "solicitation" &&
    (value.mode !== "full" ||
      value.baseVersionId !== null ||
      value.sourceId !== input.documentId ||
      fields.length === 0 ||
      operations.length !== 0)
  ) {
    return null;
  }
  if (
    value.sourceKind === "addendum" &&
    (value.baseVersionId === null ||
      value.baseVersionId === input.documentVersionId ||
      (value.mode === "delta" &&
        (fields.length !== 0 || operations.length === 0)) ||
      (value.mode === "full" &&
        (fields.length + operations.length === 0 ||
          operations.some((operation) => operation?.operation !== "remove"))))
  ) {
    return null;
  }
  const parsed: ProposedStructuredSnapshot = {
    schema: STRUCTURED_SNAPSHOT_SCHEMA,
    sourceId: value.sourceId,
    sourceKind: value.sourceKind as ProposedStructuredSnapshot["sourceKind"],
    mode: value.mode as ProposedStructuredSnapshot["mode"],
    baseVersionId: value.baseVersionId as string | null,
    authority: "authoritative" as const,
    origin: value.origin as string,
    fields: fields as StructuredField[],
    operations: operations as Array<SetOperation | RemoveOperation>,
  };
  return JSON.stringify(parsed).length <= 256_000 ? parsed : null;
}

/**
 * Reconstructs one explicit step of the effective state. Full addenda must
 * prove every omitted predecessor with a remove instruction; delta omissions
 * mean unchanged. Category drift and unknown removals fail closed.
 */
export function resolveEffectiveStructuredFields(
  snapshot: ProposedStructuredSnapshot,
  predecessor: ReadonlyMap<string, StructuredField> | null,
): ReadonlyMap<string, StructuredField> | null {
  if (snapshot.sourceKind === "solicitation") {
    if (predecessor !== null) return null;
    return new Map(snapshot.fields.map((field) => [field.externalId, field]));
  }
  if (predecessor === null) return null;
  const operations = new Map(
    snapshot.operations.map((operation) => [operation.externalId, operation]),
  );
  for (const operation of snapshot.operations) {
    const prior = predecessor.get(operation.externalId);
    if (
      (operation.operation === "remove" &&
        (!prior || prior.category !== operation.category)) ||
      (operation.operation === "set" &&
        prior &&
        prior.category !== operation.category)
    ) {
      return null;
    }
  }
  if (snapshot.mode === "delta") {
    const effective = new Map(predecessor);
    for (const operation of snapshot.operations) {
      if (operation.operation === "remove") {
        effective.delete(operation.externalId);
      } else {
        const { operation: _operation, ...field } = operation;
        effective.set(field.externalId, field);
      }
    }
    return effective;
  }
  const effective = new Map(
    snapshot.fields.map((field) => [field.externalId, field]),
  );
  for (const field of snapshot.fields) {
    const prior = predecessor.get(field.externalId);
    if (prior && prior.category !== field.category) return null;
    if (operations.has(field.externalId)) return null;
  }
  const omitted = [...predecessor.keys()].filter(
    (externalId) => !effective.has(externalId),
  );
  const removals = snapshot.operations
    .filter((operation) => operation.operation === "remove")
    .map(({ externalId }) => externalId)
    .sort();
  if (JSON.stringify(omitted.sort()) !== JSON.stringify(removals)) return null;
  return effective;
}
