import assert from "node:assert/strict";
import test from "node:test";
import { buildAddendumImpactAssessment } from "./addendumImpact";
import {
  AddendumImpactPersistenceConflict,
  isPendingAddendumImpactMutationTarget,
  parseAddendumStructuredSnapshot,
  resolveAddendumVersionChain,
} from "./addendumImpactDrizzleRepository";
import { sha256Text } from "./domain";

const SERIES_ID = "11111111-1111-4111-8111-111111111111";
const ROOT_VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ADDENDUM_ONE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ADDENDUM_TWO_VERSION_ID = "44444444-4444-4444-8444-444444444444";

type Category =
  | "deadline"
  | "opening"
  | "eligibility"
  | "requirement"
  | "boq"
  | "submission_instruction"
  | "contact"
  | "other";

function span(text: string, quote: string) {
  const startOffset = text.indexOf(quote);
  if (startOffset < 0) throw new Error(`Missing fixture quote: ${quote}`);
  return { startOffset, endOffset: startOffset + quote.length };
}

function field(
  text: string,
  externalId: string,
  category: Category,
  value: string,
) {
  return {
    externalId,
    category,
    value,
    ...span(text, value),
    page: 1,
    section: "Verified clause",
  };
}

function remove(
  text: string,
  externalId: string,
  category: Category,
  instruction: string,
) {
  return {
    operation: "remove" as const,
    externalId,
    category,
    instruction,
    ...span(text, instruction),
    page: 1,
    section: "Verified amendment",
  };
}

function set(
  text: string,
  externalId: string,
  category: Category,
  value: string,
) {
  return {
    operation: "set" as const,
    ...field(text, externalId, category, value),
  };
}

function structured(input: {
  text: string;
  documentId: string;
  documentVersionId: string;
  sourceKind: "solicitation" | "addendum";
  mode: "full" | "delta";
  baseVersionId: string | null;
  fields?: readonly Record<string, unknown>[];
  operations?: readonly Record<string, unknown>[];
}) {
  return JSON.stringify({
    schema: "valo.addendum-structured-snapshot/v2",
    sourceId: SERIES_ID,
    sourceKind: input.sourceKind,
    mode: input.mode,
    baseVersionId: input.baseVersionId,
    authority: "authoritative",
    origin: `document:${input.documentId}:version:${input.documentVersionId}`,
    fields: input.fields ?? [],
    operations: input.operations ?? [],
  });
}

function candidate(input: {
  documentId: string;
  documentVersionId: string;
  createdAt: string;
  text: string;
  sourceKind: "solicitation" | "addendum";
  mode: "full" | "delta";
  baseVersionId: string | null;
  supersedesVersionId?: string | null;
  fields?: readonly Record<string, unknown>[];
  operations?: readonly Record<string, unknown>[];
}) {
  const structuredSnapshot = structured(input);
  const snapshot = parseAddendumStructuredSnapshot(
    structuredSnapshot,
    input.text,
  );
  if (!snapshot) throw new Error("Fixture snapshot is invalid");
  return {
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    supersedesVersionId:
      input.supersedesVersionId === undefined
        ? input.baseVersionId
        : input.supersedesVersionId,
    filename: `${input.sourceKind}.pdf`,
    versionNumber: 1,
    bytesSha256: "a".repeat(64),
    documentVersionSha256: "a".repeat(64),
    malwareStatus: "clean",
    quarantineStatus: "cleared",
    redactionStatus: "included",
    capturedRedactionStatus: "included",
    createdAt: new Date(input.createdAt),
    canonicalText: input.text,
    canonicalTextSha256: sha256Text(input.text),
    structuredSnapshot,
    structuredSnapshotSha256: sha256Text(structuredSnapshot),
    snapshot,
  };
}

function sequentialChain() {
  const rootText =
    "Submit by 20 August 2026. Supplier must hold the old certificate.";
  const firstText = "The deadline is now 27 August 2026.";
  const secondText = "The old certificate requirement is withdrawn.";
  const root = candidate({
    documentId: SERIES_ID,
    documentVersionId: ROOT_VERSION_ID,
    createdAt: "2026-08-01T08:00:00.000Z",
    text: rootText,
    sourceKind: "solicitation",
    mode: "full",
    baseVersionId: null,
    fields: [
      field(rootText, "submission.deadline", "deadline", "20 August 2026"),
      field(
        rootText,
        "eligibility.old_certificate",
        "eligibility",
        "old certificate",
      ),
    ],
  });
  const first = candidate({
    documentId: "66666666-6666-4666-8666-666666666666",
    documentVersionId: ADDENDUM_ONE_VERSION_ID,
    createdAt: "2026-08-10T08:00:00.000Z",
    text: firstText,
    sourceKind: "addendum",
    mode: "delta",
    baseVersionId: ROOT_VERSION_ID,
    operations: [
      set(firstText, "submission.deadline", "deadline", "27 August 2026"),
    ],
  });
  const second = candidate({
    documentId: "77777777-7777-4777-8777-777777777777",
    documentVersionId: ADDENDUM_TWO_VERSION_ID,
    createdAt: "2026-08-18T08:00:00.000Z",
    text: secondText,
    sourceKind: "addendum",
    mode: "delta",
    baseVersionId: ADDENDUM_ONE_VERSION_ID,
    operations: [
      remove(
        secondText,
        "eligibility.old_certificate",
        "eligibility",
        "old certificate requirement is withdrawn",
      ),
    ],
  });
  return { root, first, second };
}

test("closed v2 snapshots require exact spans and reject legacy or extra fields", () => {
  const text = "Submit by 20 August 2026.";
  const accepted = structured({
    text,
    documentId: SERIES_ID,
    documentVersionId: ROOT_VERSION_ID,
    sourceKind: "solicitation",
    mode: "full",
    baseVersionId: null,
    fields: [field(text, "submission.deadline", "deadline", "20 August 2026")],
  });
  assert.equal(
    parseAddendumStructuredSnapshot(accepted, text)?.fields[0]?.value,
    "20 August 2026",
  );

  const wrongOffset = JSON.parse(accepted) as Record<string, unknown>;
  const fields = wrongOffset.fields as Array<Record<string, unknown>>;
  fields[0]!.startOffset = 9;
  assert.equal(
    parseAddendumStructuredSnapshot(JSON.stringify(wrongOffset), text),
    null,
  );

  const extra = JSON.parse(accepted) as Record<string, unknown>;
  extra.untrusted = true;
  assert.equal(
    parseAddendumStructuredSnapshot(JSON.stringify(extra), text),
    null,
  );
  assert.equal(
    parseAddendumStructuredSnapshot(
      JSON.stringify({
        schema: "valo.addendum-structured-snapshot/v1",
        sourceId: SERIES_ID,
        sourceKind: "solicitation",
        authority: "authoritative",
        origin: "legacy",
        fields: [],
      }),
      text,
    ),
    null,
  );
});

test("sequential deltas compare the selected revision with its exact effective predecessor", () => {
  const { root, first, second } = sequentialChain();
  const resolved = resolveAddendumVersionChain([second, root, first], {
    baselineVersionId: ADDENDUM_ONE_VERSION_ID,
    revisionVersionId: ADDENDUM_TWO_VERSION_ID,
  });
  assert.ok(resolved);
  assert.equal(resolved.baseline.documentVersionId, ADDENDUM_ONE_VERSION_ID);
  assert.equal(resolved.revision.documentVersionId, ADDENDUM_TWO_VERSION_ID);
  assert.deepEqual(
    resolved.baselineFields.map(({ externalId }) => externalId),
    ["eligibility.old_certificate", "submission.deadline"],
  );
  assert.deepEqual(
    resolved.revisionFields.map(({ externalId }) => externalId),
    ["submission.deadline"],
  );
  assert.equal(
    resolved.revisionFields[0]?.citation.sourceVersionId,
    ADDENDUM_ONE_VERSION_ID,
  );
  assert.equal(
    resolved.removals[0]?.citation.sourceVersionId,
    ADDENDUM_TWO_VERSION_ID,
  );

  const assessment = buildAddendumImpactAssessment({
    sources: resolved.chain.map((entry) => ({
      sourceId: entry.snapshot.sourceId,
      versionId: entry.documentVersionId,
      kind: entry.snapshot.sourceKind,
      title: entry.filename,
      content: entry.canonicalText,
      contentSha256: entry.canonicalTextSha256,
      capturedAt: entry.createdAt.toISOString(),
      authority: "authoritative" as const,
      origin: entry.snapshot.origin,
    })),
    baseline: {
      sourceId: SERIES_ID,
      sourceVersionId: ADDENDUM_ONE_VERSION_ID,
      fields: resolved.baselineFields,
    },
    revision: {
      sourceId: SERIES_ID,
      sourceVersionId: ADDENDUM_TWO_VERSION_ID,
      fields: resolved.revisionFields,
      removals: resolved.removals,
    },
    targets: [],
  });
  assert.equal(assessment.radar.changes.length, 1);
  assert.equal(assessment.radar.changes[0]?.kind, "removed");
  assert.equal(
    assessment.radar.changes[0]?.beforeCitation?.sourceVersionId,
    ROOT_VERSION_ID,
  );
  assert.equal(
    assessment.radar.changes[0]?.afterCitation?.sourceVersionId,
    ADDENDUM_TWO_VERSION_ID,
  );
});

test("a full addendum requires exact removal instructions for every omitted field", () => {
  const { root } = sequentialChain();
  const text =
    "Submit by 27 August 2026. The old certificate clause is deleted.";
  const valid = candidate({
    documentId: "88888888-8888-4888-8888-888888888888",
    documentVersionId: ADDENDUM_ONE_VERSION_ID,
    createdAt: "2026-08-10T08:00:00.000Z",
    text,
    sourceKind: "addendum",
    mode: "full",
    baseVersionId: ROOT_VERSION_ID,
    fields: [field(text, "submission.deadline", "deadline", "27 August 2026")],
    operations: [
      remove(
        text,
        "eligibility.old_certificate",
        "eligibility",
        "old certificate clause is deleted",
      ),
    ],
  });
  assert.ok(resolveAddendumVersionChain([valid, root], {}));

  const implicitText = "Submit by 30 August 2026.";
  const implicit = candidate({
    documentId: "99999999-9999-4999-8999-999999999999",
    documentVersionId: ADDENDUM_TWO_VERSION_ID,
    createdAt: "2026-08-18T08:00:00.000Z",
    text: implicitText,
    sourceKind: "addendum",
    mode: "full",
    baseVersionId: ROOT_VERSION_ID,
    fields: [
      field(implicitText, "submission.deadline", "deadline", "30 August 2026"),
    ],
  });
  assert.throws(
    () => resolveAddendumVersionChain([implicit, root], {}),
    (error: unknown) =>
      error instanceof AddendumImpactPersistenceConflict &&
      error.reason === "invalid_snapshot",
  );
});

test("chains fail closed on missing predecessors, category drift and non-monotonic order", () => {
  const { root, first } = sequentialChain();
  const missing = {
    ...first,
    snapshot: { ...first.snapshot, baseVersionId: ADDENDUM_TWO_VERSION_ID },
  };
  assert.throws(() => resolveAddendumVersionChain([missing, root], {}));

  const driftText = "The deadline is now open to all suppliers.";
  const drift = candidate({
    documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    documentVersionId: ADDENDUM_TWO_VERSION_ID,
    createdAt: "2026-08-18T08:00:00.000Z",
    text: driftText,
    sourceKind: "addendum",
    mode: "delta",
    baseVersionId: ROOT_VERSION_ID,
    operations: [
      set(
        driftText,
        "submission.deadline",
        "eligibility",
        "open to all suppliers",
      ),
    ],
  });
  assert.throws(() => resolveAddendumVersionChain([drift, root], {}));

  const nonMonotonic = {
    ...first,
    createdAt: new Date("2026-07-31T08:00:00.000Z"),
  };
  assert.throws(() => resolveAddendumVersionChain([nonMonotonic, root], {}));
});

test("chains bind root identity and every version origin to stored document identities", () => {
  const { root, first } = sequentialChain();
  assert.throws(() =>
    resolveAddendumVersionChain(
      [{ ...root, documentId: "55555555-5555-4555-8555-555555555555" }, first],
      {},
    ),
  );
  assert.throws(() =>
    resolveAddendumVersionChain(
      [
        root,
        {
          ...first,
          snapshot: { ...first.snapshot, origin: "verified-project-document" },
        },
      ],
      {},
    ),
  );
});

test("a document redaction relabel cannot reuse an older verified snapshot", () => {
  const { root, first } = sequentialChain();
  assert.throws(() =>
    resolveAddendumVersionChain(
      [root, { ...first, redactionStatus: "redacted" }],
      {},
    ),
  );
});

test("chains reject skipped predecessors and contradictory supersedes metadata", () => {
  const { root, first, second } = sequentialChain();
  const skipped = {
    ...second,
    snapshot: { ...second.snapshot, baseVersionId: ROOT_VERSION_ID },
    supersedesVersionId: null,
  };
  assert.throws(() => resolveAddendumVersionChain([root, first, skipped], {}));

  const contradictory = {
    ...first,
    supersedesVersionId: ADDENDUM_TWO_VERSION_ID,
  };
  assert.throws(() => resolveAddendumVersionChain([root, contradictory], {}));

  assert.ok(
    resolveAddendumVersionChain(
      [{ ...first, supersedesVersionId: null }, root],
      {},
    ),
    "legacy null supersedes metadata remains safe when no verified predecessor is skipped",
  );
});

test("an ineligible verified intermediary is never skipped in favour of an older eligible version", () => {
  const { root, first, second } = sequentialChain();
  const ineligible = { ...first, quarantineStatus: "quarantined" };
  assert.throws(() =>
    resolveAddendumVersionChain([root, ineligible, second], {}),
  );

  const skipsIneligible = {
    ...second,
    snapshot: { ...second.snapshot, baseVersionId: ROOT_VERSION_ID },
    supersedesVersionId: null,
  };
  assert.throws(() =>
    resolveAddendumVersionChain([root, ineligible, skipsIneligible], {}),
  );
});

test("a post-apply reload excludes every terminal target and cannot plan a no-op reapplication", () => {
  const appliedStates = [
    ["project", "review"],
    ["requirement", "reopened"],
    ["work_task", "reopened"],
    ["draft", "reopened"],
    ["boq_check", "review_required"],
    ["approval", "invalidated"],
    ["package", "invalidated"],
    ["report", "invalidated"],
  ] as const;

  assert.deepEqual(
    appliedStates.filter(([objectType, state]) =>
      isPendingAddendumImpactMutationTarget(objectType, state),
    ),
    [],
  );
});
