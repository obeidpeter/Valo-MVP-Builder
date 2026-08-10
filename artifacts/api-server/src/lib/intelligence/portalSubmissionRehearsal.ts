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
  nextCapabilitySafety,
  validateNextCapabilityCollection,
  validateNextCapabilitySources,
  validateNextCapabilityText,
  type NextCapabilitySafetyEnvelope,
} from "./nextCapabilityContracts";

export type PortalFieldType = "file" | "declaration";

export interface PortalFieldRequirementInput {
  readonly externalId: string;
  readonly label: string;
  readonly fieldType: PortalFieldType;
  readonly required: boolean;
  readonly uploadOrder: number;
  readonly ruleText: string;
  readonly maxFileBytes?: number;
  readonly maxFileBytesText?: string;
  readonly allowedExtensions?: readonly string[];
  readonly requiredFilenamePrefix?: string;
  readonly declarationText?: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface PortalPackageFileInput {
  readonly externalId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly sizeText: string;
  readonly sha256: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface PortalFileMappingInput {
  readonly externalId: string;
  readonly fieldExternalId: string;
  readonly fileExternalId: string;
  readonly rationale: string;
  readonly citations: readonly ExactCitation[];
  readonly review: HumanReview;
}

export interface PortalSubmissionRehearsalInput {
  readonly sources: readonly SourceDocument[];
  readonly fields: readonly PortalFieldRequirementInput[];
  readonly files: readonly PortalPackageFileInput[];
  readonly mappings: readonly PortalFileMappingInput[];
  readonly rehearsalReview?: SubjectReview;
}

export interface PortalFieldRequirementRecord extends PortalFieldRequirementInput {
  readonly fieldId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface PortalPackageFileRecord extends PortalPackageFileInput {
  readonly fileId: string;
  readonly citations: readonly GroundedCitation[];
}

export interface PortalFileMappingRecord extends PortalFileMappingInput {
  readonly mappingId: string;
  readonly fieldId: string;
  readonly fileId: string;
  readonly citations: readonly GroundedCitation[];
}

export type PortalFileViolation =
  | "file_too_large"
  | "extension_not_allowed"
  | "filename_prefix_mismatch";

export interface PortalFieldRehearsalCheck {
  readonly fieldId: string;
  readonly uploadOrder: number;
  readonly state:
    | "manual_confirmation_required"
    | "optional_unmapped"
    | "missing"
    | "pending_review"
    | "invalid_file"
    | "ready";
  readonly mappingIds: readonly string[];
  readonly fileIds: readonly string[];
  readonly violations: readonly PortalFileViolation[];
}

export interface PortalSubmissionRehearsalResult {
  readonly rehearsalId: string;
  readonly status:
    | "blocked"
    | "incomplete"
    | "review_required"
    | "rehearsal_ready";
  readonly readyForOperatorRehearsal: boolean;
  readonly manualDeclarationCount: number;
  readonly fields: readonly PortalFieldRequirementRecord[];
  readonly files: readonly PortalPackageFileRecord[];
  readonly mappings: readonly PortalFileMappingRecord[];
  readonly checks: readonly PortalFieldRehearsalCheck[];
  readonly review: HumanReview;
  readonly issues: readonly DomainIssue[];
  readonly portalSubmissionReady: false;
  readonly credentialsUsed: false;
  readonly portalActionAuthorized: false;
  readonly safety: NextCapabilitySafetyEnvelope;
}

const SHA_256 = /^[a-f0-9]{64}$/iu;
const EXTENSION = /^\.[a-z0-9][a-z0-9._-]{0,15}$/u;

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

function containsExactIntegerPhrase(
  text: string,
  prefix: string,
  value: number,
  suffix: string,
): boolean {
  const haystack = normalized(text);
  const sought = normalized(`${prefix}${value}${suffix}`);
  const valueOffset = sought.indexOf(String(value));
  let offset = haystack.indexOf(sought);
  while (offset >= 0) {
    const numberOffset = offset + valueOffset;
    const numberLength = String(value).length;
    const before = numberOffset === 0 ? "" : (haystack[numberOffset - 1] ?? "");
    const after = haystack[numberOffset + numberLength] ?? "";
    if (!/\d/u.test(before) && !/\d/u.test(after)) return true;
    offset = haystack.indexOf(sought, offset + 1);
  }
  return false;
}

function portalFieldMachineFactsCited(
  field: PortalFieldRequirementInput,
): boolean {
  const text = normalized(field.ruleText);
  const requiredness = field.required ? "required" : "optional";
  return (
    text.includes(
      normalized(`${requiredness} ${field.fieldType} field ${field.label},`),
    ) &&
    containsExactIntegerPhrase(text, "upload order ", field.uploadOrder, "") &&
    (field.maxFileBytes === undefined ||
      containsExactIntegerPhrase(text, "", field.maxFileBytes, " bytes"))
  );
}

function isPortalRuleSource(citations: readonly GroundedCitation[]): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceAuthority === "authoritative" &&
        (citation.sourceKind === "solicitation" ||
          citation.sourceKind === "addendum" ||
          citation.sourceKind === "other"),
    )
  );
}

function isManifestSource(citations: readonly GroundedCitation[]): boolean {
  return (
    citations.length > 0 &&
    citations.every(
      (citation) =>
        citation.sourceKind === "company_evidence" &&
        citation.sourceAuthority !== "unverified",
    )
  );
}

function mappingClaimCited(
  field: PortalFieldRequirementRecord,
  file: PortalPackageFileRecord,
  rationale: string,
  citations: readonly GroundedCitation[],
): boolean {
  const relationship = normalized(
    `mapping: ${file.filename} assigned to ${field.label}.`,
  );
  return citations.some((citation) => {
    const text = normalized(citation.quote);
    return (
      isManifestSource([citation]) &&
      text.includes(relationship) &&
      text.includes(normalized(rationale))
    );
  });
}

function filenameExtension(filename: string): string {
  const separator = filename.lastIndexOf(".");
  return separator < 0 ? "" : filename.slice(separator).toLowerCase();
}

/**
 * Rehearses deterministic file-to-field mappings from cited portal rules and
 * a cited package manifest. It never authenticates to a portal, fills a legal
 * declaration, uploads a file, clicks submit, or treats a rehearsal as proof
 * of submission.
 */
export function buildPortalSubmissionRehearsal(
  input: PortalSubmissionRehearsalInput,
): PortalSubmissionRehearsalResult {
  const sourceValidation = validateNextCapabilitySources(
    input.sources,
    "Portal rehearsal source documents",
  );
  const sourceSet = sourceValidation.sourceSet;
  const issues: DomainIssue[] = [
    ...sourceValidation.issues,
    ...validateNextCapabilityCollection(
      input.fields,
      "fields",
      "Portal fields",
    ),
    ...validateNextCapabilityCollection(input.files, "files", "Package files"),
    ...validateNextCapabilityCollection(
      input.mappings,
      "mappings",
      "Portal file mappings",
    ),
  ];
  const fieldInputs = input.fields.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const fileInputs = input.files.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  const mappingInputs = input.mappings.slice(0, NEXT_CAPABILITY_MAX_ITEMS);
  issues.push(
    ...uniqueIds(fieldInputs, "fields"),
    ...uniqueIds(fileInputs, "files"),
    ...uniqueIds(mappingInputs, "mappings"),
  );

  const seenUploadOrders = new Set<number>();
  const fields: PortalFieldRequirementRecord[] = [];
  fieldInputs.forEach((field, index) => {
    const path = `fields[${index}]`;
    const citationIssues = validateNextCapabilityCollection(
      field.citations,
      `${path}.citations`,
      "Portal field citations",
    );
    const local = validateCitations(
      field.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const extensionIssues = validateNextCapabilityCollection(
      field.allowedExtensions ?? [],
      `${path}.allowedExtensions`,
      "Allowed file extensions",
      50,
    );
    const allowedExtensions = (field.allowedExtensions ?? []).slice(0, 50);
    const textIssues = [
      ...validateNextCapabilityText(
        field.label,
        `${path}.label`,
        "Portal field label",
      ),
      ...validateNextCapabilityText(
        field.ruleText,
        `${path}.ruleText`,
        "Portal field rule text",
      ),
      ...(field.maxFileBytesText === undefined
        ? []
        : validateNextCapabilityText(
            field.maxFileBytesText,
            `${path}.maxFileBytesText`,
            "Portal file-size rule text",
          )),
      ...(field.requiredFilenamePrefix === undefined
        ? []
        : validateNextCapabilityText(
            field.requiredFilenamePrefix,
            `${path}.requiredFilenamePrefix`,
            "Required filename prefix",
          )),
      ...(field.declarationText === undefined
        ? []
        : validateNextCapabilityText(
            field.declarationText,
            `${path}.declarationText`,
            "Portal declaration text",
          )),
    ];
    issues.push(
      ...citationIssues,
      ...extensionIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(field.review, `${path}.review`),
    );
    if (!Number.isSafeInteger(field.uploadOrder) || field.uploadOrder < 1) {
      issues.push({
        code: "invalid_portal_upload_order",
        severity: "blocker",
        path: `${path}.uploadOrder`,
        message: "Portal upload order must be a positive safe integer.",
      });
    } else if (seenUploadOrders.has(field.uploadOrder)) {
      issues.push({
        code: "duplicate_portal_upload_order",
        severity: "blocker",
        path: `${path}.uploadOrder`,
        message: "Portal field upload order must be unique.",
      });
    } else {
      seenUploadOrders.add(field.uploadOrder);
    }
    if (field.fieldType !== "file" && field.fieldType !== "declaration") {
      issues.push({
        code: "invalid_portal_field_type",
        severity: "blocker",
        path: `${path}.fieldType`,
        message: "Portal field type must be file or declaration.",
      });
    }
    const fileOptionsPresent =
      field.maxFileBytes !== undefined ||
      field.maxFileBytesText !== undefined ||
      field.allowedExtensions !== undefined ||
      field.requiredFilenamePrefix !== undefined;
    if (field.fieldType === "declaration" && fileOptionsPresent) {
      issues.push({
        code: "declaration_has_file_rules",
        severity: "blocker",
        path,
        message: "A declaration field cannot carry file-upload constraints.",
      });
    }
    if (field.fieldType === "declaration" && !field.declarationText?.trim()) {
      issues.push({
        code: "declaration_text_required",
        severity: "blocker",
        path: `${path}.declarationText`,
        message: "A declaration field requires exact cited declaration text.",
      });
    }
    if (field.fieldType === "file" && field.declarationText !== undefined) {
      issues.push({
        code: "file_field_has_declaration",
        severity: "blocker",
        path: `${path}.declarationText`,
        message: "A file field cannot carry declaration text.",
      });
    }
    if (
      Boolean(field.maxFileBytes) !== Boolean(field.maxFileBytesText?.trim())
    ) {
      issues.push({
        code: "file_size_rule_incomplete",
        severity: "blocker",
        path,
        message:
          "A portal file-size limit and its exact source text must be supplied together.",
      });
    }
    if (
      field.maxFileBytes !== undefined &&
      (!Number.isSafeInteger(field.maxFileBytes) || field.maxFileBytes < 1)
    ) {
      issues.push({
        code: "invalid_file_size_limit",
        severity: "blocker",
        path: `${path}.maxFileBytes`,
        message: "Portal file-size limit must be a positive safe integer.",
      });
    }
    if (
      allowedExtensions.some(
        (extension) => !EXTENSION.test(extension.toLowerCase()),
      )
    ) {
      issues.push({
        code: "invalid_allowed_extension",
        severity: "blocker",
        path: `${path}.allowedExtensions`,
        message:
          "Allowed file extensions must be a bounded list of dot-prefixed literals.",
      });
    }
    if (local.citations.length && !isPortalRuleSource(local.citations)) {
      issues.push({
        code: "portal_rule_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Portal rules require authoritative solicitation, addendum, or official portal citations.",
      });
    }
    const citedValues = [
      field.label,
      field.ruleText,
      ...(field.maxFileBytesText ? [field.maxFileBytesText] : []),
      ...allowedExtensions,
      ...(field.requiredFilenamePrefix ? [field.requiredFilenamePrefix] : []),
      ...(field.declarationText ? [field.declarationText] : []),
    ];
    const machineFactsCited = portalFieldMachineFactsCited(field);
    if (
      local.citations.length &&
      (!citationsContain(local.citations, citedValues) || !machineFactsCited)
    ) {
      issues.push({
        code: "portal_rule_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Portal rule text, field type, requiredness, upload order, and every machine-enforced upload constraint must occur in the cited official text.",
      });
    }
    const valid =
      isValidId(field.externalId) &&
      citationIssues.length === 0 &&
      extensionIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      isPortalRuleSource(local.citations) &&
      citationsContain(local.citations, citedValues) &&
      machineFactsCited &&
      (field.fieldType === "file" || field.fieldType === "declaration") &&
      Number.isSafeInteger(field.uploadOrder) &&
      field.uploadOrder >= 1 &&
      (field.fieldType !== "declaration" ||
        (!fileOptionsPresent && Boolean(field.declarationText?.trim()))) &&
      (field.fieldType !== "file" || field.declarationText === undefined) &&
      Boolean(field.maxFileBytes) === Boolean(field.maxFileBytesText?.trim()) &&
      (field.maxFileBytes === undefined ||
        (Number.isSafeInteger(field.maxFileBytes) &&
          field.maxFileBytes >= 1)) &&
      allowedExtensions.every((extension) =>
        EXTENSION.test(extension.toLowerCase()),
      );
    if (valid) {
      fields.push({
        ...field,
        allowedExtensions: allowedExtensions.map((extension) =>
          extension.toLowerCase(),
        ),
        fieldId: deterministicId("portalfield", {
          externalId: field.externalId,
          label: field.label,
          fieldType: field.fieldType,
          required: field.required,
          uploadOrder: field.uploadOrder,
          ruleText: field.ruleText,
          maxFileBytes: field.maxFileBytes,
          maxFileBytesText: field.maxFileBytesText,
          allowedExtensions: allowedExtensions
            .map((extension) => extension.toLowerCase())
            .sort(),
          requiredFilenamePrefix: field.requiredFilenamePrefix,
          declarationText: field.declarationText,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        citations: local.citations,
      });
    }
  });
  fields.sort(
    (left, right) =>
      left.uploadOrder - right.uploadOrder ||
      left.fieldId.localeCompare(right.fieldId),
  );
  const fieldByExternalId = new Map(
    fields.map((field) => [field.externalId, field]),
  );

  const files: PortalPackageFileRecord[] = [];
  fileInputs.forEach((file, index) => {
    const path = `files[${index}]`;
    const citationIssues = validateNextCapabilityCollection(
      file.citations,
      `${path}.citations`,
      "Package-file citations",
    );
    const local = validateCitations(
      file.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = [
      ...validateNextCapabilityText(
        file.filename,
        `${path}.filename`,
        "Package filename",
        { maximum: 255 },
      ),
      ...validateNextCapabilityText(
        file.sizeText,
        `${path}.sizeText`,
        "Package file-size source text",
      ),
    ];
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(file.review, `${path}.review`),
    );
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1) {
      issues.push({
        code: "invalid_package_file_size",
        severity: "blocker",
        path: `${path}.sizeBytes`,
        message: "Package file size must be a positive safe integer.",
      });
    }
    if (!SHA_256.test(file.sha256)) {
      issues.push({
        code: "invalid_package_file_hash",
        severity: "blocker",
        path: `${path}.sha256`,
        message: "Package files require a SHA-256 manifest identity.",
      });
    }
    if (local.citations.length && !isManifestSource(local.citations)) {
      issues.push({
        code: "package_manifest_source_invalid",
        severity: "blocker",
        path: `${path}.citations`,
        message: "Package files require verified company-manifest provenance.",
      });
    }
    if (
      local.citations.length &&
      (!citationsContain(local.citations, [
        file.filename,
        file.sizeText,
        file.sha256,
      ]) ||
        !containsExactIntegerPhrase(
          file.sizeText,
          "",
          file.sizeBytes,
          " bytes",
        ))
    ) {
      issues.push({
        code: "package_manifest_facts_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "Filename, exact byte size, recorded size text, and SHA-256 must occur in the cited package manifest.",
      });
    }
    if (
      isValidId(file.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      isManifestSource(local.citations) &&
      citationsContain(local.citations, [
        file.filename,
        file.sizeText,
        file.sha256,
      ]) &&
      containsExactIntegerPhrase(file.sizeText, "", file.sizeBytes, " bytes") &&
      Number.isSafeInteger(file.sizeBytes) &&
      file.sizeBytes >= 1 &&
      SHA_256.test(file.sha256)
    ) {
      files.push({
        ...file,
        fileId: deterministicId("portalfile", {
          externalId: file.externalId,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          sizeText: file.sizeText,
          sha256: file.sha256.toLowerCase(),
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        sha256: file.sha256.toLowerCase(),
        citations: local.citations,
      });
    }
  });
  files.sort((left, right) => left.fileId.localeCompare(right.fileId));
  const fileByExternalId = new Map(
    files.map((file) => [file.externalId, file]),
  );

  const mappings: PortalFileMappingRecord[] = [];
  mappingInputs.forEach((mapping, index) => {
    const path = `mappings[${index}]`;
    const field = fieldByExternalId.get(mapping.fieldExternalId);
    const file = fileByExternalId.get(mapping.fileExternalId);
    const citationIssues = validateNextCapabilityCollection(
      mapping.citations,
      `${path}.citations`,
      "Portal mapping citations",
    );
    const local = validateCitations(
      mapping.citations.slice(0, NEXT_CAPABILITY_MAX_ITEMS),
      sourceSet.byKey,
      `${path}.citations`,
    );
    const textIssues = validateNextCapabilityText(
      mapping.rationale,
      `${path}.rationale`,
      "Portal mapping rationale",
    );
    issues.push(
      ...citationIssues,
      ...local.issues,
      ...textIssues,
      ...validateHumanReview(mapping.review, `${path}.review`),
    );
    if (!field || !file) {
      issues.push({
        code: "portal_mapping_target_missing",
        severity: "blocker",
        path,
        message:
          "A mapping must reference a valid portal field and package file.",
      });
    } else if (field.fieldType !== "file") {
      issues.push({
        code: "declaration_cannot_be_file_mapped",
        severity: "blocker",
        path: `${path}.fieldExternalId`,
        message:
          "A legal declaration cannot be satisfied by a file mapping or automation.",
      });
    }
    const mappingCitationIds = new Set(
      local.citations.map((citation) => citation.citationId),
    );
    const expectedCitationIds = new Set([
      ...(field?.citations.map((citation) => citation.citationId) ?? []),
      ...(file?.citations.map((citation) => citation.citationId) ?? []),
    ]);
    const boundToSpecificInputs =
      Boolean(field) &&
      Boolean(file) &&
      expectedCitationIds.size > 0 &&
      local.citations.length === expectedCitationIds.size &&
      [...expectedCitationIds].every((citationId) =>
        mappingCitationIds.has(citationId),
      ) &&
      local.citations.every((citation) =>
        expectedCitationIds.has(citation.citationId),
      );
    if (field && file && local.citations.length > 0 && !boundToSpecificInputs) {
      issues.push({
        code: "portal_mapping_rule_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "A field mapping must contain exactly the cited ranges that define its target portal field and package file.",
      });
    }
    const claimCited =
      field && file
        ? mappingClaimCited(field, file, mapping.rationale, local.citations)
        : false;
    if (field && file && local.citations.length > 0 && !claimCited) {
      issues.push({
        code: "portal_mapping_claim_not_cited",
        severity: "blocker",
        path: `${path}.citations`,
        message:
          "The exact package manifest citation must bind the filename to the target field label and contain the mapping rationale.",
      });
    }
    if (
      field &&
      file &&
      field.fieldType === "file" &&
      isValidId(mapping.externalId) &&
      citationIssues.length === 0 &&
      textIssues.length === 0 &&
      local.issues.length === 0 &&
      boundToSpecificInputs &&
      claimCited
    ) {
      mappings.push({
        ...mapping,
        mappingId: deterministicId("portalmap", {
          externalId: mapping.externalId,
          fieldId: field.fieldId,
          fileId: file.fileId,
          rationale: mapping.rationale,
          citationIds: local.citations.map((citation) => citation.citationId),
        }),
        fieldId: field.fieldId,
        fileId: file.fileId,
        citations: local.citations,
      });
    }
  });
  mappings.sort((left, right) => left.mappingId.localeCompare(right.mappingId));

  const checks: PortalFieldRehearsalCheck[] = fields.map((field) => {
    if (field.fieldType === "declaration") {
      return {
        fieldId: field.fieldId,
        uploadOrder: field.uploadOrder,
        state: "manual_confirmation_required",
        mappingIds: [],
        fileIds: [],
        violations: [],
      };
    }
    const candidates = mappings.filter(
      (mapping) => mapping.fieldId === field.fieldId,
    );
    if (candidates.length > 1) {
      issues.push({
        code: "multiple_files_for_portal_field",
        severity: "blocker",
        path: `fields.${field.externalId}`,
        message:
          "A portal field has multiple mapped files and needs an explicit operator selection.",
      });
    }
    const mapping = candidates.length === 1 ? candidates[0] : undefined;
    const file = mapping
      ? files.find((candidate) => candidate.fileId === mapping.fileId)
      : undefined;
    if (!mapping || !file) {
      return {
        fieldId: field.fieldId,
        uploadOrder: field.uploadOrder,
        state: field.required ? "missing" : "optional_unmapped",
        mappingIds: candidates.map((candidate) => candidate.mappingId).sort(),
        fileIds: candidates.map((candidate) => candidate.fileId).sort(),
        violations: [],
      };
    }
    const violations: PortalFileViolation[] = [];
    if (
      field.maxFileBytes !== undefined &&
      file.sizeBytes > field.maxFileBytes
    ) {
      violations.push("file_too_large");
    }
    const allowedExtensions = field.allowedExtensions ?? [];
    if (
      allowedExtensions.length > 0 &&
      !allowedExtensions.includes(filenameExtension(file.filename))
    ) {
      violations.push("extension_not_allowed");
    }
    if (
      field.requiredFilenamePrefix &&
      !normalized(file.filename).startsWith(
        normalized(field.requiredFilenamePrefix),
      )
    ) {
      violations.push("filename_prefix_mismatch");
    }
    violations.sort();
    const pending =
      !reviewIsAccepted(field.review) ||
      !reviewIsAccepted(file.review) ||
      !reviewIsAccepted(mapping.review);
    return {
      fieldId: field.fieldId,
      uploadOrder: field.uploadOrder,
      state: pending
        ? "pending_review"
        : violations.length
          ? "invalid_file"
          : "ready",
      mappingIds: [mapping.mappingId],
      fileIds: [file.fileId],
      violations,
    };
  });
  checks.sort(
    (left, right) =>
      left.uploadOrder - right.uploadOrder ||
      left.fieldId.localeCompare(right.fieldId),
  );
  const rehearsalId = deterministicId("portalrun", {
    fields: fields.map((field) => [field.fieldId, field.review]),
    files: files.map((file) => [file.fileId, file.review]),
    mappings: mappings.map((mapping) => [mapping.mappingId, mapping.review]),
    checks,
  });
  const rehearsalReviewResult = resolveSubjectReview(
    rehearsalId,
    input.rehearsalReview,
    "rehearsalReview",
  );
  issues.push(...rehearsalReviewResult.issues);
  const sortedIssues = sortIssues(issues);
  const incomplete = checks.some(
    (check) => check.state === "missing" || check.state === "invalid_file",
  );
  const reviewed =
    fields.length > 0 &&
    fields.every((field) => reviewIsAccepted(field.review)) &&
    mappings.every((mapping) => reviewIsAccepted(mapping.review)) &&
    checks.every((check) => {
      if (check.state === "manual_confirmation_required") return true;
      return check.fileIds.every((fileId) => {
        const file = files.find((candidate) => candidate.fileId === fileId);
        return file ? reviewIsAccepted(file.review) : false;
      });
    });
  const readyForOperatorRehearsal =
    !hasBlockers(sortedIssues) &&
    !incomplete &&
    reviewed &&
    reviewIsAccepted(rehearsalReviewResult.review);
  const status: PortalSubmissionRehearsalResult["status"] = hasBlockers(
    sortedIssues,
  )
    ? "blocked"
    : fields.length === 0 || incomplete
      ? "incomplete"
      : readyForOperatorRehearsal
        ? "rehearsal_ready"
        : "review_required";
  return {
    rehearsalId,
    status,
    readyForOperatorRehearsal,
    manualDeclarationCount: checks.filter(
      (check) => check.state === "manual_confirmation_required",
    ).length,
    fields,
    files,
    mappings,
    checks,
    review: rehearsalReviewResult.review,
    issues: sortedIssues,
    portalSubmissionReady: false,
    credentialsUsed: false,
    portalActionAuthorized: false,
    safety: nextCapabilitySafety(),
  };
}
