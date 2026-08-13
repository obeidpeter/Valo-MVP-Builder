import { createHash } from "node:crypto";
import { OPERATIONS_SUITE_BOUNDS } from "./bounds";
import { OperationsSuiteError } from "./errors";
import {
  assertOnlyKeys,
  boundedArray,
  expectedVersion,
  isoInstant,
  oneOf,
  requiredBoolean,
  requiredId,
  requireObject,
  requiredSha256,
  requiredText,
  safeInteger,
} from "./validation";

export const FIELD_DRAFT_PROMOTION_SCHEMA =
  "valo.encrypted-field-promotion/v1" as const;
export const FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA =
  "valo.field-draft-promotion-receipt/v1" as const;

export const FIELD_DRAFT_PROMOTION_FIELDS = [
  "title",
  "note",
  "checklist",
] as const;

export type FieldDraftPromotionField =
  (typeof FIELD_DRAFT_PROMOTION_FIELDS)[number];

export interface FieldDraftPromotionChecklistItem {
  id: string;
  label: string;
  completed: boolean;
}

export interface FieldDraftPromotionRequest {
  schema: typeof FIELD_DRAFT_PROMOTION_SCHEMA;
  draft: {
    id: string;
    version: number;
    organisationId: string;
    actorUserId: string;
    projectId: string;
    kind: "site_visit_note" | "delivery_receipt_note" | "checklist_progress";
    updatedAt: string;
  };
  expectedTargetVersion: number;
  selectedFields: FieldDraftPromotionField[];
  values: {
    title?: string;
    note?: string;
    checklist?: FieldDraftPromotionChecklistItem[];
  };
}

export interface StoredFieldDraftPromotionReceipt {
  schema: typeof FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA;
  organisationId: string;
  projectId: string;
  targetRecordId: string;
  targetKind: "work_item";
  targetVersion: number;
  draftId: string;
  draftVersion: number;
  promotedByUserId: string;
  selectedFields: FieldDraftPromotionField[];
  idempotencyKey: string;
  requestSha256: string;
  receiptSha256: string;
  promotedAt: string;
  authoritativeEvidenceCreated: false;
  localDraftDeleted: false;
}

export interface FieldDraftPromotionReceipt extends StoredFieldDraftPromotionReceipt {
  replayed: boolean;
}

export interface WorkItemWithFieldPromotionReceipts {
  fieldPromotionReceipts?: StoredFieldDraftPromotionReceipt[];
}

export const FIELD_DRAFT_PROMOTION_BOUNDS = Object.freeze({
  receiptsPerWorkItem: 25,
  checklistItems: 20,
  checklistLabelCodeUnits: 160,
  titleCodeUnits: 160,
  noteCodeUnits: 4_000,
} as const);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function invalid(message: string): never {
  throw new OperationsSuiteError("invalid_request", message);
}

function uuid(value: unknown, label: string): string {
  const parsed = requiredText(value, label, 36);
  if (!UUID.test(parsed)) invalid(`${label} must be a UUID.`);
  return parsed;
}

function exactBoundedText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(value)
  ) {
    invalid(`${label} is outside the field-draft promotion boundary.`);
  }
  return value;
}

function selectedFields(value: unknown): FieldDraftPromotionField[] {
  const parsed = boundedArray(
    value,
    "selectedFields",
    FIELD_DRAFT_PROMOTION_FIELDS.length,
  ).map((field, index) =>
    oneOf(field, FIELD_DRAFT_PROMOTION_FIELDS, `selectedFields[${index}]`),
  );
  if (parsed.length === 0 || new Set(parsed).size !== parsed.length) {
    invalid("selectedFields must be a non-empty unique field list.");
  }
  const canonical = FIELD_DRAFT_PROMOTION_FIELDS.filter((field) =>
    parsed.includes(field),
  );
  if (canonical.some((field, index) => field !== parsed[index])) {
    invalid("selectedFields must use canonical field order.");
  }
  return parsed;
}

function checklist(value: unknown): FieldDraftPromotionChecklistItem[] {
  const ids = new Set<string>();
  return boundedArray(
    value,
    "values.checklist",
    FIELD_DRAFT_PROMOTION_BOUNDS.checklistItems,
  ).map((entry, index) => {
    const label = `values.checklist[${index}]`;
    const item = requireObject(entry, label);
    assertOnlyKeys(item, ["id", "label", "completed"], label);
    const id = requiredId(item.id, `${label}.id`);
    if (ids.has(id)) invalid("values.checklist contains duplicate IDs.");
    ids.add(id);
    return {
      id,
      label: exactBoundedText(
        item.label,
        `${label}.label`,
        FIELD_DRAFT_PROMOTION_BOUNDS.checklistLabelCodeUnits,
      ),
      completed: requiredBoolean(item.completed, `${label}.completed`),
    };
  });
}

export function parseFieldDraftPromotionRequest(
  value: unknown,
): FieldDraftPromotionRequest {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "schema",
    "draft",
    "expectedTargetVersion",
    "selectedFields",
    "values",
  ]);
  if (body.schema !== FIELD_DRAFT_PROMOTION_SCHEMA) {
    invalid("Unsupported field-draft promotion schema.");
  }
  const draft = requireObject(body.draft, "draft");
  assertOnlyKeys(draft, [
    "id",
    "version",
    "organisationId",
    "actorUserId",
    "projectId",
    "kind",
    "updatedAt",
  ]);
  const fields = selectedFields(body.selectedFields);
  const values = requireObject(body.values, "values");
  assertOnlyKeys(values, [...FIELD_DRAFT_PROMOTION_FIELDS], "values");
  const suppliedValueFields = FIELD_DRAFT_PROMOTION_FIELDS.filter(
    (field) => values[field] !== undefined,
  );
  if (
    suppliedValueFields.length !== fields.length ||
    suppliedValueFields.some((field, index) => field !== fields[index])
  ) {
    invalid("values must contain exactly the selected fields.");
  }

  return {
    schema: FIELD_DRAFT_PROMOTION_SCHEMA,
    draft: {
      id: uuid(draft.id, "draft.id"),
      version: safeInteger(
        draft.version,
        "draft.version",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      organisationId: uuid(draft.organisationId, "draft.organisationId"),
      actorUserId: uuid(draft.actorUserId, "draft.actorUserId"),
      projectId: uuid(draft.projectId, "draft.projectId"),
      kind: oneOf(
        draft.kind,
        [
          "site_visit_note",
          "delivery_receipt_note",
          "checklist_progress",
        ] as const,
        "draft.kind",
      ),
      updatedAt: isoInstant(draft.updatedAt, "draft.updatedAt"),
    },
    expectedTargetVersion: expectedVersion(body.expectedTargetVersion),
    selectedFields: fields,
    values: {
      ...(fields.includes("title")
        ? {
            title: exactBoundedText(
              values.title,
              "values.title",
              FIELD_DRAFT_PROMOTION_BOUNDS.titleCodeUnits,
            ),
          }
        : {}),
      ...(fields.includes("note")
        ? {
            note: exactBoundedText(
              values.note,
              "values.note",
              FIELD_DRAFT_PROMOTION_BOUNDS.noteCodeUnits,
              true,
            ),
          }
        : {}),
      ...(fields.includes("checklist")
        ? { checklist: checklist(values.checklist) }
        : {}),
    },
  };
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export function fieldDraftPromotionRequestSha256(
  input: FieldDraftPromotionRequest,
  targetRecordId: string,
  idempotencyKey: string,
): string {
  return sha256({
    schema: input.schema,
    draft: {
      id: input.draft.id,
      version: input.draft.version,
      organisationId: input.draft.organisationId,
      actorUserId: input.draft.actorUserId,
      projectId: input.draft.projectId,
      kind: input.draft.kind,
      updatedAt: input.draft.updatedAt,
    },
    targetRecordId,
    expectedTargetVersion: input.expectedTargetVersion,
    selectedFields: input.selectedFields,
    values: {
      ...(input.selectedFields.includes("title")
        ? { title: input.values.title }
        : {}),
      ...(input.selectedFields.includes("note")
        ? { note: input.values.note }
        : {}),
      ...(input.selectedFields.includes("checklist")
        ? { checklist: input.values.checklist }
        : {}),
    },
    idempotencyKey,
  });
}

function receiptMaterial(
  receipt: Omit<StoredFieldDraftPromotionReceipt, "receiptSha256">,
) {
  return {
    schema: receipt.schema,
    organisationId: receipt.organisationId,
    projectId: receipt.projectId,
    targetRecordId: receipt.targetRecordId,
    targetKind: receipt.targetKind,
    targetVersion: receipt.targetVersion,
    draftId: receipt.draftId,
    draftVersion: receipt.draftVersion,
    promotedByUserId: receipt.promotedByUserId,
    selectedFields: receipt.selectedFields,
    idempotencyKey: receipt.idempotencyKey,
    requestSha256: receipt.requestSha256,
    promotedAt: receipt.promotedAt,
    authoritativeEvidenceCreated: receipt.authoritativeEvidenceCreated,
    localDraftDeleted: receipt.localDraftDeleted,
  };
}

export function createFieldDraftPromotionReceipt(input: {
  organisationId: string;
  projectId: string;
  targetRecordId: string;
  targetVersion: number;
  draftId: string;
  draftVersion: number;
  promotedByUserId: string;
  selectedFields: FieldDraftPromotionField[];
  idempotencyKey: string;
  requestSha256: string;
  promotedAt: string;
}): StoredFieldDraftPromotionReceipt {
  const receipt: Omit<StoredFieldDraftPromotionReceipt, "receiptSha256"> = {
    schema: FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA,
    organisationId: input.organisationId,
    projectId: input.projectId,
    targetRecordId: input.targetRecordId,
    targetKind: "work_item",
    targetVersion: input.targetVersion,
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    promotedByUserId: input.promotedByUserId,
    selectedFields: [...input.selectedFields],
    idempotencyKey: input.idempotencyKey,
    requestSha256: input.requestSha256,
    promotedAt: input.promotedAt,
    authoritativeEvidenceCreated: false,
    localDraftDeleted: false,
  };
  return { ...receipt, receiptSha256: sha256(receiptMaterial(receipt)) };
}

function parseStoredReceipt(
  value: unknown,
  index: number,
): StoredFieldDraftPromotionReceipt {
  const label = `fieldPromotionReceipts[${index}]`;
  const receipt = requireObject(value, label);
  assertOnlyKeys(
    receipt,
    [
      "schema",
      "organisationId",
      "projectId",
      "targetRecordId",
      "targetKind",
      "targetVersion",
      "draftId",
      "draftVersion",
      "promotedByUserId",
      "selectedFields",
      "idempotencyKey",
      "requestSha256",
      "receiptSha256",
      "promotedAt",
      "authoritativeEvidenceCreated",
      "localDraftDeleted",
    ],
    label,
  );
  const parsed: StoredFieldDraftPromotionReceipt = {
    schema:
      receipt.schema === FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA
        ? FIELD_DRAFT_PROMOTION_RECEIPT_SCHEMA
        : invalid(`${label}.schema is unsupported.`),
    organisationId: uuid(receipt.organisationId, `${label}.organisationId`),
    projectId: uuid(receipt.projectId, `${label}.projectId`),
    targetRecordId: requiredId(
      receipt.targetRecordId,
      `${label}.targetRecordId`,
    ),
    targetKind:
      receipt.targetKind === "work_item"
        ? "work_item"
        : invalid(`${label}.targetKind is unsupported.`),
    targetVersion: safeInteger(
      receipt.targetVersion,
      `${label}.targetVersion`,
      2,
      Number.MAX_SAFE_INTEGER,
    ),
    draftId: uuid(receipt.draftId, `${label}.draftId`),
    draftVersion: safeInteger(
      receipt.draftVersion,
      `${label}.draftVersion`,
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    promotedByUserId: uuid(
      receipt.promotedByUserId,
      `${label}.promotedByUserId`,
    ),
    selectedFields: selectedFields(receipt.selectedFields),
    idempotencyKey: uuid(receipt.idempotencyKey, `${label}.idempotencyKey`),
    requestSha256: requiredSha256(
      receipt.requestSha256,
      `${label}.requestSha256`,
    ),
    receiptSha256: requiredSha256(
      receipt.receiptSha256,
      `${label}.receiptSha256`,
    ),
    promotedAt: isoInstant(receipt.promotedAt, `${label}.promotedAt`),
    authoritativeEvidenceCreated:
      requiredBoolean(
        receipt.authoritativeEvidenceCreated,
        `${label}.authoritativeEvidenceCreated`,
      ) === false
        ? false
        : invalid(`${label} cannot create authoritative evidence.`),
    localDraftDeleted:
      requiredBoolean(
        receipt.localDraftDeleted,
        `${label}.localDraftDeleted`,
      ) === false
        ? false
        : invalid(`${label} cannot claim local deletion.`),
  };
  const { receiptSha256: _receiptSha256, ...material } = parsed;
  const expected = sha256(receiptMaterial(material));
  if (parsed.receiptSha256 !== expected) {
    throw new OperationsSuiteError(
      "policy_denied",
      "A field-draft promotion receipt failed its integrity check.",
    );
  }
  return parsed;
}

export function readFieldDraftPromotionReceipts(
  record: WorkItemWithFieldPromotionReceipts,
): StoredFieldDraftPromotionReceipt[] {
  const raw = record.fieldPromotionReceipts ?? [];
  if (!Array.isArray(raw)) {
    throw new OperationsSuiteError(
      "policy_denied",
      "Field-draft promotion receipts are malformed.",
    );
  }
  const receipts = boundedArray(
    raw,
    "fieldPromotionReceipts",
    FIELD_DRAFT_PROMOTION_BOUNDS.receiptsPerWorkItem,
  ).map(parseStoredReceipt);
  if (
    new Set(receipts.map(({ idempotencyKey }) => idempotencyKey)).size !==
    receipts.length
  ) {
    throw new OperationsSuiteError(
      "policy_denied",
      "Field-draft promotion receipt identities are not unique.",
    );
  }
  if (
    new Set(
      receipts.map(
        ({ organisationId, projectId, draftId, draftVersion }) =>
          `${organisationId}\u0000${projectId}\u0000${draftId}\u0000${draftVersion}`,
      ),
    ).size !== receipts.length
  ) {
    throw new OperationsSuiteError(
      "policy_denied",
      "Field-draft promotion receipt revisions are not unique.",
    );
  }
  return receipts;
}

export function fieldDraftPromotionResponse(
  receipt: StoredFieldDraftPromotionReceipt,
  replayed: boolean,
): FieldDraftPromotionReceipt {
  return { ...structuredClone(receipt), replayed };
}

export function parseFieldDraftPromotionIdempotencyKey(value: unknown): string {
  return uuid(value, "Idempotency-Key");
}

export function fieldDraftChecklistComment(
  item: FieldDraftPromotionChecklistItem,
): string {
  const body = `[Field draft checklist] ${item.completed ? "Completed" : "Open"}: ${item.label}`;
  if (body.length > 2_048) {
    throw new OperationsSuiteError(
      "capacity_exceeded",
      "A promoted checklist item exceeds the governed comment boundary.",
    );
  }
  return body;
}

export function assertFieldDraftPromotionReceiptCapacity(count: number): void {
  if (count >= FIELD_DRAFT_PROMOTION_BOUNDS.receiptsPerWorkItem) {
    throw new OperationsSuiteError(
      "capacity_exceeded",
      "The work item's field-draft promotion receipt limit has been reached.",
    );
  }
}

export function assertFieldDraftChecklistCommentCapacity(
  existingCommentCount: number,
  additionalChecklistItems: number,
): void {
  if (
    existingCommentCount + additionalChecklistItems >
    OPERATIONS_SUITE_BOUNDS.commentsPerWorkItem
  ) {
    throw new OperationsSuiteError(
      "capacity_exceeded",
      "The selected checklist does not fit the governed work-item comment boundary.",
    );
  }
}
