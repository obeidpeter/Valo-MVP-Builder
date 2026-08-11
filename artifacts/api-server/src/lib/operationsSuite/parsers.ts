import { OPERATIONS_SUITE_BOUNDS } from "./bounds";
import type {
  AddWorkItemCommentInput,
  AdvanceSubmissionWarRoomInput,
  CreateCredentialVerificationInput,
  CreateEvidenceRequestInput,
  CreateMissionInput,
  CreateOpportunityIntakeInput,
  CreatePostAwardItemInput,
  CreateSubmissionWarRoomInput,
  CreateVisualQaReportInput,
  CreateWorkItemInput,
  DecideEvidenceResponseInput,
  DecideWorkItemApprovalInput,
  RecordEvidenceResponseInput,
  UpdateMissionInput,
  UpdatePostAwardItemInput,
  UpdateWorkItemInput,
  WorkObjectLinks,
} from "./contracts";
import {
  assertOnlyKeys,
  boundedArray,
  expectedVersion,
  invalid,
  isoInstant,
  oneOf,
  optionalBoolean,
  optionalId,
  optionalIsoInstant,
  optionalSha256,
  optionalText,
  requiredBoolean,
  requiredId,
  requireObject,
  requiredReason,
  requiredSha256,
  requiredText,
  safeInteger,
  uniqueIds,
} from "./validation";

const SHORT = OPERATIONS_SUITE_BOUNDS.shortTextCodeUnits;

function nonEmptyPatch(value: Record<string, unknown>): void {
  if (Object.keys(value).every((key) => key === "expectedVersion")) {
    invalid("At least one mutation field is required.");
  }
}

function parseLinks(value: unknown, partial: true): Partial<WorkObjectLinks>;
function parseLinks(value: unknown, partial?: false): WorkObjectLinks;
function parseLinks(
  value: unknown,
  partial = false,
): Partial<WorkObjectLinks> | WorkObjectLinks {
  if (value === undefined && partial) return {};
  const body = value === undefined ? {} : requireObject(value, "links");
  assertOnlyKeys(
    body,
    ["requirementIds", "evidenceItemIds", "packageIds"],
    "links",
  );
  const output: Partial<WorkObjectLinks> = {};
  for (const key of [
    "requirementIds",
    "evidenceItemIds",
    "packageIds",
  ] as const) {
    if (!partial || body[key] !== undefined) {
      output[key] = uniqueIds(body[key], `links.${key}`);
    }
  }
  return output as WorkObjectLinks;
}

function parseStringList(
  value: unknown,
  label: string,
  maximum: number,
  maxText: number = SHORT,
): string[] {
  if (value === undefined) return [];
  const items = boundedArray(value, label, maximum).map((item, index) =>
    requiredText(item, `${label}[${index}]`, maxText),
  );
  if (new Set(items).size !== items.length)
    invalid(`${label} contains duplicates.`);
  return items;
}

export function parseCreateOpportunity(
  value: unknown,
): CreateOpportunityIntakeInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "title",
    "issuer",
    "reference",
    "lot",
    "deadline",
    "source",
  ]);
  const source = requireObject(body.source, "source");
  assertOnlyKeys(
    source,
    ["type", "locator", "receivedAt", "authorisationBasis", "contentSha256"],
    "source",
  );
  const type = oneOf(
    source.type,
    ["manual_url", "forwarded_email", "licensed_csv", "ocds"] as const,
    "source.type",
  );
  const locator = requiredText(source.locator, "source.locator", 2_048);
  if (type === "manual_url") {
    let url: URL;
    try {
      url = new URL(locator);
    } catch {
      invalid("source.locator must be a valid URL for manual_url intake.");
    }
    if (!url || !["https:", "http:"].includes(url.protocol)) {
      invalid("source.locator must use HTTP(S) for manual_url intake.");
    }
  }
  const authorisationBasis = optionalText(
    source.authorisationBasis,
    "source.authorisationBasis",
    1_024,
  );
  const contentSha256 = optionalSha256(
    source.contentSha256,
    "source.contentSha256",
  );
  if (["licensed_csv", "ocds"].includes(type) && !authorisationBasis) {
    invalid("Imported datasets require a recorded authorisationBasis.");
  }
  if (type !== "manual_url" && !contentSha256) {
    invalid("Content-bearing opportunity sources require contentSha256.");
  }
  return {
    title: requiredText(body.title, "title"),
    issuer: requiredText(body.issuer, "issuer"),
    reference: optionalText(body.reference, "reference", SHORT),
    lot: optionalText(body.lot, "lot", SHORT),
    deadline: optionalIsoInstant(body.deadline, "deadline"),
    source: {
      type,
      locator,
      receivedAt: isoInstant(source.receivedAt, "source.receivedAt"),
      authorisationBasis,
      contentSha256,
    },
  };
}

export function parseConfirmDeadline(value: unknown): {
  expectedVersion: number;
  deadline: string;
} {
  const body = requireObject(value);
  assertOnlyKeys(body, ["expectedVersion", "deadline"]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    deadline: isoInstant(body.deadline, "deadline"),
  };
}

export function parseCreateWorkItem(value: unknown): CreateWorkItemInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "title",
    "description",
    "ownerUserId",
    "dueAt",
    "priority",
    "links",
    "dependsOnIds",
    "approvalRequired",
  ]);
  return {
    title: requiredText(body.title, "title"),
    description: optionalText(body.description, "description"),
    ownerUserId: optionalId(body.ownerUserId, "ownerUserId"),
    dueAt: optionalIsoInstant(body.dueAt, "dueAt"),
    priority:
      body.priority === undefined
        ? "normal"
        : oneOf(
            body.priority,
            ["low", "normal", "high", "critical"] as const,
            "priority",
          ),
    links: parseLinks(body.links),
    dependsOnIds: uniqueIds(
      body.dependsOnIds,
      "dependsOnIds",
      OPERATIONS_SUITE_BOUNDS.dependenciesPerWorkItem,
    ),
    approvalRequired: optionalBoolean(
      body.approvalRequired,
      "approvalRequired",
      false,
    ),
  };
}

export function parseUpdateWorkItem(value: unknown): UpdateWorkItemInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "expectedVersion",
    "title",
    "description",
    "ownerUserId",
    "dueAt",
    "priority",
    "status",
    "links",
    "dependsOnIds",
    "reason",
  ]);
  nonEmptyPatch(body);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    ...(body.title === undefined
      ? {}
      : { title: requiredText(body.title, "title") }),
    ...(body.description === undefined
      ? {}
      : { description: optionalText(body.description, "description") }),
    ...(body.ownerUserId === undefined
      ? {}
      : { ownerUserId: optionalId(body.ownerUserId, "ownerUserId") }),
    ...(body.dueAt === undefined
      ? {}
      : { dueAt: optionalIsoInstant(body.dueAt, "dueAt") }),
    ...(body.priority === undefined
      ? {}
      : {
          priority: oneOf(
            body.priority,
            ["low", "normal", "high", "critical"] as const,
            "priority",
          ),
        }),
    ...(body.status === undefined
      ? {}
      : {
          status: oneOf(
            body.status,
            [
              "backlog",
              "ready",
              "in_progress",
              "blocked",
              "in_review",
              "done",
              "cancelled",
            ] as const,
            "status",
          ),
        }),
    ...(body.links === undefined
      ? {}
      : { links: parseLinks(body.links, true) }),
    ...(body.dependsOnIds === undefined
      ? {}
      : {
          dependsOnIds: uniqueIds(
            body.dependsOnIds,
            "dependsOnIds",
            OPERATIONS_SUITE_BOUNDS.dependenciesPerWorkItem,
          ),
        }),
    ...(body.reason === undefined
      ? {}
      : { reason: requiredReason(body.reason) }),
  };
}

export function parseAddComment(value: unknown): AddWorkItemCommentInput {
  const body = requireObject(value);
  assertOnlyKeys(body, ["expectedVersion", "body"]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    body: requiredText(body.body, "body", 2_048),
  };
}

export function parseApprovalDecision(
  value: unknown,
): DecideWorkItemApprovalInput {
  const body = requireObject(value);
  assertOnlyKeys(body, ["expectedVersion", "decision", "reason"]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    decision: oneOf(
      body.decision,
      ["approved", "rejected"] as const,
      "decision",
    ),
    reason: requiredReason(body.reason),
  };
}

export function parseCreateEvidenceRequest(
  value: unknown,
): CreateEvidenceRequestInput {
  const body = requireObject(value);
  assertOnlyKeys(body, ["recipientLabel", "dueAt", "requestMessage", "slots"]);
  const slots = boundedArray(
    body.slots,
    "slots",
    OPERATIONS_SUITE_BOUNDS.evidenceSlotsPerRequest,
  );
  if (slots.length === 0) invalid("slots must not be empty.");
  return {
    recipientLabel: requiredText(body.recipientLabel, "recipientLabel", SHORT),
    dueAt: optionalIsoInstant(body.dueAt, "dueAt"),
    requestMessage: requiredText(body.requestMessage, "requestMessage"),
    slots: slots.map((slot, index) => {
      const item = requireObject(slot, `slots[${index}]`);
      assertOnlyKeys(
        item,
        ["label", "required", "acceptedContentTypes"],
        `slots[${index}]`,
      );
      return {
        label: requiredText(item.label, `slots[${index}].label`, SHORT),
        required: requiredBoolean(item.required, `slots[${index}].required`),
        acceptedContentTypes: parseStringList(
          item.acceptedContentTypes,
          `slots[${index}].acceptedContentTypes`,
          20,
          128,
        ),
      };
    }),
  };
}

export function parseExpectedVersionOnly(value: unknown): {
  expectedVersion: number;
} {
  const body = requireObject(value);
  assertOnlyKeys(body, ["expectedVersion"]);
  return { expectedVersion: expectedVersion(body.expectedVersion) };
}

export function parseEvidenceResponse(
  value: unknown,
): RecordEvidenceResponseInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "expectedVersion",
    "slotId",
    "documentId",
    "sha256",
    "attestation",
  ]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    slotId: requiredId(body.slotId, "slotId"),
    documentId: requiredId(body.documentId, "documentId"),
    sha256: requiredSha256(body.sha256, "sha256"),
    attestation: requiredText(body.attestation, "attestation", 2_048),
  };
}

export function parseEvidenceDecision(
  value: unknown,
): DecideEvidenceResponseInput {
  const body = requireObject(value);
  assertOnlyKeys(body, ["expectedVersion", "slotId", "decision", "reason"]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    slotId: requiredId(body.slotId, "slotId"),
    decision: oneOf(
      body.decision,
      ["accepted", "rejected"] as const,
      "decision",
    ),
    reason: requiredReason(body.reason),
  };
}

export function parseCreateSubmission(
  value: unknown,
): CreateSubmissionWarRoomInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "packageId",
    "packageVersionId",
    "manifestSha256",
    "copyCount",
    "sealIdentifiers",
  ]);
  return {
    packageId: requiredId(body.packageId, "packageId"),
    packageVersionId: requiredId(body.packageVersionId, "packageVersionId"),
    manifestSha256: requiredSha256(body.manifestSha256, "manifestSha256"),
    copyCount:
      body.copyCount === undefined
        ? 0
        : safeInteger(body.copyCount, "copyCount", 0, 10_000),
    sealIdentifiers: parseStringList(
      body.sealIdentifiers,
      "sealIdentifiers",
      OPERATIONS_SUITE_BOUNDS.sealIdentifiers,
    ),
  };
}

export function parseAdvanceSubmission(
  value: unknown,
): AdvanceSubmissionWarRoomInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "expectedVersion",
    "toStatus",
    "dispatchMethod",
    "receiptSha256",
    "reason",
  ]);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    toStatus: oneOf(
      body.toStatus,
      [
        "frozen",
        "copies_prepared",
        "sealed",
        "dispatched",
        "receipt_recorded",
        "cancelled",
      ] as const,
      "toStatus",
    ),
    dispatchMethod: optionalText(body.dispatchMethod, "dispatchMethod", SHORT),
    receiptSha256: optionalSha256(body.receiptSha256, "receiptSha256"),
    reason: optionalText(body.reason, "reason", 1_024),
  };
}

export function parseCreateVisualQa(value: unknown): CreateVisualQaReportInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "packageVersionId",
    "manifestSha256",
    "expectedManifestSha256",
    "pages",
    "crossReferences",
    "signatures",
  ]);
  const pages = boundedArray(
    body.pages,
    "pages",
    OPERATIONS_SUITE_BOUNDS.visualQaPages,
  ).map((page, index) => {
    const item = requireObject(page, `pages[${index}]`);
    assertOnlyKeys(
      item,
      [
        "pageNumber",
        "textCharacterCount",
        "nonWhitespacePixelRatio",
        "clippedElementCount",
      ],
      `pages[${index}]`,
    );
    if (
      typeof item.nonWhitespacePixelRatio !== "number" ||
      !Number.isFinite(item.nonWhitespacePixelRatio) ||
      item.nonWhitespacePixelRatio < 0 ||
      item.nonWhitespacePixelRatio > 1
    ) {
      invalid(
        `pages[${index}].nonWhitespacePixelRatio must be between 0 and 1.`,
      );
    }
    return {
      pageNumber: safeInteger(
        item.pageNumber,
        `pages[${index}].pageNumber`,
        1,
        100_000,
      ),
      textCharacterCount: safeInteger(
        item.textCharacterCount,
        `pages[${index}].textCharacterCount`,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      nonWhitespacePixelRatio: item.nonWhitespacePixelRatio,
      clippedElementCount: safeInteger(
        item.clippedElementCount,
        `pages[${index}].clippedElementCount`,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  });
  const crossReferences = boundedArray(
    body.crossReferences ?? [],
    "crossReferences",
    OPERATIONS_SUITE_BOUNDS.visualQaCrossReferences,
  ).map((reference, index) => {
    const item = requireObject(reference, `crossReferences[${index}]`);
    assertOnlyKeys(item, ["label", "resolved"], `crossReferences[${index}]`);
    return {
      label: requiredText(item.label, `crossReferences[${index}].label`, SHORT),
      resolved: requiredBoolean(
        item.resolved,
        `crossReferences[${index}].resolved`,
      ),
    };
  });
  const signatures = boundedArray(
    body.signatures ?? [],
    "signatures",
    OPERATIONS_SUITE_BOUNDS.visualQaSignatures,
  ).map((signature, index) => {
    const item = requireObject(signature, `signatures[${index}]`);
    assertOnlyKeys(
      item,
      ["label", "required", "present"],
      `signatures[${index}]`,
    );
    return {
      label: requiredText(item.label, `signatures[${index}].label`, SHORT),
      required: requiredBoolean(item.required, `signatures[${index}].required`),
      present: requiredBoolean(item.present, `signatures[${index}].present`),
    };
  });
  return {
    packageVersionId: requiredId(body.packageVersionId, "packageVersionId"),
    manifestSha256: requiredSha256(body.manifestSha256, "manifestSha256"),
    expectedManifestSha256: requiredSha256(
      body.expectedManifestSha256,
      "expectedManifestSha256",
    ),
    pages,
    crossReferences,
    signatures,
  };
}

export function parseCreateCredential(
  value: unknown,
): CreateCredentialVerificationInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "vaultItemId",
    "vaultItemVersion",
    "documentSha256",
    "authorityName",
    "officialSourceLocator",
    "checkedAt",
    "outcome",
    "receiptSha256",
    "notes",
  ]);
  return {
    vaultItemId: requiredId(body.vaultItemId, "vaultItemId"),
    vaultItemVersion: safeInteger(
      body.vaultItemVersion,
      "vaultItemVersion",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    documentSha256: requiredSha256(body.documentSha256, "documentSha256"),
    authorityName: requiredText(body.authorityName, "authorityName", SHORT),
    officialSourceLocator: requiredText(
      body.officialSourceLocator,
      "officialSourceLocator",
      2_048,
    ),
    checkedAt: isoInstant(body.checkedAt, "checkedAt"),
    outcome: oneOf(
      body.outcome,
      ["verified", "not_verified", "inconclusive"] as const,
      "outcome",
    ),
    receiptSha256: requiredSha256(body.receiptSha256, "receiptSha256"),
    notes: optionalText(body.notes, "notes"),
  };
}

export function parseCreateMission(value: unknown): CreateMissionInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "missionType",
    "title",
    "location",
    "startsAt",
    "attendanceRequired",
    "delegateUserId",
    "delegateAuthorityNote",
    "checklist",
  ]);
  const checklist = boundedArray(
    body.checklist,
    "checklist",
    OPERATIONS_SUITE_BOUNDS.checklistItemsPerMission,
  ).map((entry, index) => {
    const item = requireObject(entry, `checklist[${index}]`);
    assertOnlyKeys(item, ["label", "required"], `checklist[${index}]`);
    return {
      label: requiredText(item.label, `checklist[${index}].label`, SHORT),
      required: requiredBoolean(item.required, `checklist[${index}].required`),
    };
  });
  const delegateUserId = optionalId(body.delegateUserId, "delegateUserId");
  const delegateAuthorityNote = optionalText(
    body.delegateAuthorityNote,
    "delegateAuthorityNote",
    1_024,
  );
  if (delegateUserId && !delegateAuthorityNote) {
    invalid("A delegated mission requires delegateAuthorityNote.");
  }
  return {
    missionType: oneOf(
      body.missionType,
      ["pre_bid", "site_visit"] as const,
      "missionType",
    ),
    title: requiredText(body.title, "title"),
    location: requiredText(body.location, "location", 1_024),
    startsAt: isoInstant(body.startsAt, "startsAt"),
    attendanceRequired: requiredBoolean(
      body.attendanceRequired,
      "attendanceRequired",
    ),
    delegateUserId,
    delegateAuthorityNote,
    checklist,
  };
}

export function parseUpdateMission(value: unknown): UpdateMissionInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "expectedVersion",
    "status",
    "completedChecklistItemId",
    "proofDocumentId",
    "proofSha256",
    "followUpWorkItemId",
    "reason",
  ]);
  nonEmptyPatch(body);
  if (
    (body.proofDocumentId === undefined) !==
    (body.proofSha256 === undefined)
  ) {
    invalid("proofDocumentId and proofSha256 must be supplied together.");
  }
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    ...(body.status === undefined
      ? {}
      : {
          status: oneOf(
            body.status,
            [
              "planned",
              "attended",
              "missed",
              "completed",
              "cancelled",
            ] as const,
            "status",
          ),
        }),
    ...(body.completedChecklistItemId === undefined
      ? {}
      : {
          completedChecklistItemId: requiredId(
            body.completedChecklistItemId,
            "completedChecklistItemId",
          ),
        }),
    ...(body.proofDocumentId === undefined
      ? {}
      : {
          proofDocumentId: requiredId(body.proofDocumentId, "proofDocumentId"),
          proofSha256: requiredSha256(body.proofSha256, "proofSha256"),
        }),
    ...(body.followUpWorkItemId === undefined
      ? {}
      : {
          followUpWorkItemId: requiredId(
            body.followUpWorkItemId,
            "followUpWorkItemId",
          ),
        }),
    ...(body.reason === undefined
      ? {}
      : { reason: requiredReason(body.reason) }),
  };
}

export function parseCreatePostAward(value: unknown): CreatePostAwardItemInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "category",
    "title",
    "description",
    "dueAt",
    "ownerUserId",
    "sourceDocumentId",
    "evidenceDocumentIds",
    "valueMinorUnits",
    "currency",
  ]);
  const valueMinorUnits =
    body.valueMinorUnits === undefined || body.valueMinorUnits === null
      ? null
      : safeInteger(
          body.valueMinorUnits,
          "valueMinorUnits",
          0,
          Number.MAX_SAFE_INTEGER,
        );
  const currency =
    optionalText(body.currency, "currency", 3)?.toUpperCase() ?? null;
  if ((valueMinorUnits === null) !== (currency === null)) {
    invalid("valueMinorUnits and currency must be supplied together.");
  }
  if (currency && !/^[A-Z]{3}$/u.test(currency)) {
    invalid("currency must be a three-letter ISO-style code.");
  }
  return {
    category: oneOf(
      body.category,
      [
        "obligation",
        "deliverable",
        "variation",
        "payment_milestone",
        "notice",
        "completion_record",
      ] as const,
      "category",
    ),
    title: requiredText(body.title, "title"),
    description: optionalText(body.description, "description"),
    dueAt: optionalIsoInstant(body.dueAt, "dueAt"),
    ownerUserId: optionalId(body.ownerUserId, "ownerUserId"),
    sourceDocumentId: optionalId(body.sourceDocumentId, "sourceDocumentId"),
    evidenceDocumentIds: uniqueIds(
      body.evidenceDocumentIds,
      "evidenceDocumentIds",
    ),
    valueMinorUnits,
    currency,
  };
}

export function parseUpdatePostAward(value: unknown): UpdatePostAwardItemInput {
  const body = requireObject(value);
  assertOnlyKeys(body, [
    "expectedVersion",
    "status",
    "ownerUserId",
    "dueAt",
    "evidenceDocumentIds",
    "completionReceiptSha256",
    "reason",
  ]);
  nonEmptyPatch(body);
  return {
    expectedVersion: expectedVersion(body.expectedVersion),
    ...(body.status === undefined
      ? {}
      : {
          status: oneOf(
            body.status,
            [
              "open",
              "in_progress",
              "satisfied",
              "disputed",
              "cancelled",
            ] as const,
            "status",
          ),
        }),
    ...(body.ownerUserId === undefined
      ? {}
      : { ownerUserId: optionalId(body.ownerUserId, "ownerUserId") }),
    ...(body.dueAt === undefined
      ? {}
      : { dueAt: optionalIsoInstant(body.dueAt, "dueAt") }),
    ...(body.evidenceDocumentIds === undefined
      ? {}
      : {
          evidenceDocumentIds: uniqueIds(
            body.evidenceDocumentIds,
            "evidenceDocumentIds",
          ),
        }),
    ...(body.completionReceiptSha256 === undefined
      ? {}
      : {
          completionReceiptSha256: optionalSha256(
            body.completionReceiptSha256,
            "completionReceiptSha256",
          ),
        }),
    ...(body.reason === undefined
      ? {}
      : { reason: requiredReason(body.reason) }),
  };
}
