import { createHash } from "node:crypto";
import {
  SHA256,
  hasText,
  validIdentifier,
  validIsoTimestamp,
  validUnitScore as validScore,
} from "./aiFoundationValidation";

/**
 * Pure contracts for a future retrieval data plane. Nothing in this module is
 * wired to the production runtime, provider adapter, database, or routes.
 */
export const AI_RETRIEVAL_FOUNDATION_STATUS = Object.freeze({
  runtimeConnected: false,
  productionApproved: false,
  activation: "blocked" as const,
});

export const AI_RETRIEVAL_INPUT_BOUNDS = Object.freeze({
  maxQueryCodeUnits: 8_000,
  maxQueryBytes: 16_000,
  maxCandidateTextCodeUnits: 250_000,
  maxCandidateTextBytes: 500_000,
  maxActorPermissions: 128,
  maxCandidatePermissions: 32,
  maxAllowedDocumentVersions: 1_000,
  maxApprovedScannerVersions: 32,
});

export type AiDataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

export type AiRetrievedSourceChannel =
  | "parsed_text"
  | "ocr"
  | "table"
  | "metadata"
  | "tool_result";

export type AiInjectionSignal =
  | "instruction_override"
  | "system_prompt_probe"
  | "secret_exfiltration"
  | "tool_execution_request"
  | "cross_tenant_request";

export interface AiInjectionScan {
  status: "clean" | "flagged" | "unscanned";
  scannerVersion: string;
  scannedAt: string;
  textSha256: string;
  evidenceReference: string;
  signals: AiInjectionSignal[];
}

export interface AiEvidenceSpan {
  pageStart: number;
  pageEnd: number;
  sourceOffsetStart: number;
  sourceOffsetEnd: number;
  locator: string;
  paragraphId?: string | null;
  tableId?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
}

export interface AiRetrievalCandidate {
  chunkId: string;
  tenantId: string;
  projectId: string;
  documentId: string;
  documentVersionId: string;
  sourceSha256: string;
  textSha256: string;
  text: string;
  sourceChannel: AiRetrievedSourceChannel;
  span: AiEvidenceSpan;
  lifecycle: "active" | "superseded" | "deleted" | "quarantined";
  classification: AiDataClassification;
  requiredPermissions: string[];
  retrievalVersion: string;
  indexVersion: string;
  lexicalScore: number;
  vectorScore: number;
  rerankScore?: number | null;
  extractionQualityScore: number;
  injectionScan: AiInjectionScan;
}

export interface AiRetrievalPrivacyDecision {
  approved: boolean;
  tenantId: string;
  projectId: string;
  purpose: string;
  approvalReference: string;
  redactionPolicyReference: string;
  allowedClassifications: AiDataClassification[];
  piiMinimised: boolean;
  externalProcessingApproved: boolean;
  processingRegion: string;
  noTraining: boolean;
  maxRetentionDays: number;
}

export interface AiRetrievalLimits {
  maxCandidates: number;
  maxSelected: number;
  maxContextBytes: number;
  minLexicalScore: number;
  minVectorScore: number;
  minRerankScore: number;
  minExtractionQualityScore: number;
}

export interface AiHybridWeights {
  lexical: number;
  vector: number;
  rerank: number;
}

export interface AiRetrievalRequest {
  requestId: string;
  tenantId: string;
  projectId: string;
  queryText: string;
  retrievalVersion: string;
  indexVersion: string;
  evaluatedAt: string;
  approvedInjectionScannerVersions: string[];
  injectionScanMaxAgeMs: number;
  allowedDocumentVersionIds: string[];
  actor: {
    tenantId: string;
    projectId: string;
    permissions: string[];
  };
  disclosureTarget: "local_only" | "approved_model";
  privacyDecision: AiRetrievalPrivacyDecision;
  limits: AiRetrievalLimits;
  weights: AiHybridWeights;
}

export type AiRetrievalBlockerCode =
  | "request_invalid"
  | "privacy_decision_missing"
  | "privacy_scope_mismatch"
  | "external_processing_not_approved"
  | "tenant_scope_mismatch"
  | "project_scope_mismatch"
  | "document_version_not_allowed"
  | "retrieval_version_mismatch"
  | "index_version_mismatch"
  | "source_hash_invalid"
  | "text_hash_mismatch"
  | "lifecycle_not_active"
  | "privacy_classification_denied"
  | "permission_denied"
  | "injection_scan_missing"
  | "injection_detected"
  | "span_invalid"
  | "score_invalid"
  | "score_below_floor"
  | "extraction_quality_low"
  | "context_limit_exceeded";

export interface AiRetrievalBlocker {
  code: AiRetrievalBlockerCode;
  message: string;
  chunkId?: string;
}

export interface AiRetrievedEvidence {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  sourceSha256: string;
  textSha256: string;
  text: string;
  sourceChannel: AiRetrievedSourceChannel;
  span: AiEvidenceSpan;
  classification: AiDataClassification;
  hybridScore: number;
  extractionQualityScore: number;
  taint: "untrusted_evidence";
  instructionAuthority: "none";
}

export interface AiRetrievalResult {
  disposition: "ready" | "abstain" | "blocked";
  blockers: AiRetrievalBlocker[];
  rejected: AiRetrievalBlocker[];
  selected: AiRetrievedEvidence[];
  manifestSha256: string | null;
  contextBytes: number;
  abstentionReason?: "no_eligible_evidence" | "context_budget_exhausted";
}

export type AiClaimKind = "material_factual" | "non_factual";

export interface AiDraftClaim {
  claimId: string;
  tenantId: string;
  projectId: string;
  text: string;
  kind: AiClaimKind;
  citationIds: string[];
}

export interface AiClaimCitation {
  citationId: string;
  claimId: string;
  chunkId: string;
  quote: string;
  quoteStart: number;
  quoteEnd: number;
  verifierVerdict: "entailed" | "contradicted" | "insufficient";
  verifierScore: number;
  verifierVersion: string;
}

export type AiClaimGroundingBlockerCode =
  | "retrieval_not_ready"
  | "claim_scope_mismatch"
  | "material_claim_uncited"
  | "citation_not_found"
  | "claim_invalid"
  | "citation_invalid"
  | "citation_claim_mismatch"
  | "citation_chunk_not_selected"
  | "citation_span_invalid"
  | "citation_quote_mismatch"
  | "support_verifier_missing"
  | "support_score_invalid"
  | "support_insufficient"
  | "claim_contradicted";

export interface AiClaimGroundingBlocker {
  code: AiClaimGroundingBlockerCode;
  claimId?: string;
  citationId?: string;
  message: string;
}

export interface AiClaimGroundingResult {
  disposition: "grounded" | "abstain" | "blocked";
  blockers: AiClaimGroundingBlocker[];
  groundedClaimIds: string[];
  abstainedClaimIds: string[];
}

const CLASSIFICATIONS = new Set<AiDataClassification>([
  "public",
  "internal",
  "confidential",
  "restricted",
]);
const SOURCE_CHANNELS = new Set<AiRetrievedSourceChannel>([
  "parsed_text",
  "ocr",
  "table",
  "metadata",
  "tool_result",
]);
const INJECTION_STATUSES = new Set<AiInjectionScan["status"]>([
  "clean",
  "flagged",
  "unscanned",
]);
const INJECTION_SIGNALS = new Set<AiInjectionSignal>([
  "instruction_override",
  "system_prompt_probe",
  "secret_exfiltration",
  "tool_execution_request",
  "cross_tenant_request",
]);
const CLAIM_KINDS = new Set<AiClaimKind>(["material_factual", "non_factual"]);
const VERIFIER_VERDICTS = new Set<AiClaimCitation["verifierVerdict"]>([
  "entailed",
  "contradicted",
  "insufficient",
]);

const uniqueNonEmpty = (values: string[]): boolean =>
  values.length > 0 &&
  values.every((value) => validIdentifier(value)) &&
  new Set(values).size === values.length;

// Insertion-order JSON, deliberately NOT sorted-key canonical JSON: the
// persisted manifestSha256 depends on this exact serialization.
const insertionOrderJson = (value: unknown): string => JSON.stringify(value);

export function aiRetrievalTextSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function detectRetrievalInjectionSignals(
  text: string,
): AiInjectionSignal[] {
  const signals = new Set<AiInjectionSignal>();
  if (
    /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|system|developer)\s+instructions?\b/i.test(
      text,
    ) ||
    /\boverride\s+(?:the\s+)?(?:system|developer|safety)\b/i.test(text)
  ) {
    signals.add("instruction_override");
  }
  if (
    /\b(?:system prompt|developer message|hidden instructions?)\b/i.test(text)
  ) {
    signals.add("system_prompt_probe");
  }
  if (
    /\b(?:reveal|exfiltrate|leak|send|upload)\b[^\n]{0,80}\b(?:secret|credential|token|api key|customer data)\b/i.test(
      text,
    )
  ) {
    signals.add("secret_exfiltration");
  }
  if (
    /\b(?:call|invoke|execute|run)\b[^\n]{0,60}\b(?:tool|shell|command|browser|http request)\b/i.test(
      text,
    )
  ) {
    signals.add("tool_execution_request");
  }
  if (
    /\b(?:other tenant|cross[- ]tenant|all customers?|every client)\b/i.test(
      text,
    )
  ) {
    signals.add("cross_tenant_request");
  }
  return [...signals].sort();
}

function validateRequest(request: AiRetrievalRequest): AiRetrievalBlocker[] {
  const blockers: AiRetrievalBlocker[] = [];
  const limits = request.limits;
  const weights = request.weights;
  const privacy = request.privacyDecision;

  if (
    !validIdentifier(request.requestId) ||
    !validIdentifier(request.tenantId) ||
    !validIdentifier(request.projectId) ||
    !hasText(request.queryText) ||
    request.queryText.length > AI_RETRIEVAL_INPUT_BOUNDS.maxQueryCodeUnits ||
    Buffer.byteLength(request.queryText, "utf8") >
      AI_RETRIEVAL_INPUT_BOUNDS.maxQueryBytes ||
    !validIdentifier(request.retrievalVersion) ||
    !validIdentifier(request.indexVersion) ||
    !validIsoTimestamp(request.evaluatedAt) ||
    request.approvedInjectionScannerVersions.length >
      AI_RETRIEVAL_INPUT_BOUNDS.maxApprovedScannerVersions ||
    !uniqueNonEmpty(request.approvedInjectionScannerVersions) ||
    !Number.isSafeInteger(request.injectionScanMaxAgeMs) ||
    request.injectionScanMaxAgeMs <= 0 ||
    request.injectionScanMaxAgeMs > 24 * 60 * 60 * 1_000 ||
    request.allowedDocumentVersionIds.length >
      AI_RETRIEVAL_INPUT_BOUNDS.maxAllowedDocumentVersions ||
    !uniqueNonEmpty(request.allowedDocumentVersionIds) ||
    request.actor.permissions.length >
      AI_RETRIEVAL_INPUT_BOUNDS.maxActorPermissions ||
    !uniqueNonEmpty(request.actor.permissions) ||
    request.actor.tenantId !== request.tenantId ||
    request.actor.projectId !== request.projectId ||
    !new Set(["local_only", "approved_model"]).has(request.disclosureTarget) ||
    !Number.isSafeInteger(limits.maxCandidates) ||
    limits.maxCandidates <= 0 ||
    limits.maxCandidates > 1_000 ||
    !Number.isSafeInteger(limits.maxSelected) ||
    limits.maxSelected <= 0 ||
    limits.maxSelected > limits.maxCandidates ||
    !Number.isSafeInteger(limits.maxContextBytes) ||
    limits.maxContextBytes <= 0 ||
    limits.maxContextBytes > 1_000_000 ||
    !validScore(limits.minLexicalScore) ||
    !validScore(limits.minVectorScore) ||
    !validScore(limits.minRerankScore) ||
    !validScore(limits.minExtractionQualityScore) ||
    !validScore(weights.lexical) ||
    !validScore(weights.vector) ||
    !validScore(weights.rerank) ||
    Math.abs(weights.lexical + weights.vector + weights.rerank - 1) > 1e-9
  ) {
    blockers.push({
      code: "request_invalid",
      message: "The retrieval request or its defensive limits are invalid.",
    });
  }

  if (
    privacy.approved !== true ||
    !hasText(privacy.purpose) ||
    !validIdentifier(privacy.approvalReference) ||
    !validIdentifier(privacy.redactionPolicyReference) ||
    privacy.allowedClassifications.length === 0 ||
    new Set(privacy.allowedClassifications).size !==
      privacy.allowedClassifications.length ||
    !privacy.allowedClassifications.every((classification) =>
      CLASSIFICATIONS.has(classification),
    ) ||
    privacy.piiMinimised !== true ||
    privacy.noTraining !== true ||
    typeof privacy.externalProcessingApproved !== "boolean" ||
    !Number.isSafeInteger(privacy.maxRetentionDays) ||
    privacy.maxRetentionDays < 0
  ) {
    blockers.push({
      code: "privacy_decision_missing",
      message:
        "An approved, minimised, no-training privacy decision is required.",
    });
  }
  if (
    privacy.tenantId !== request.tenantId ||
    privacy.projectId !== request.projectId
  ) {
    blockers.push({
      code: "privacy_scope_mismatch",
      message: "The privacy decision does not cover this tenant and project.",
    });
  }
  if (
    request.disclosureTarget === "approved_model" &&
    (privacy.externalProcessingApproved !== true ||
      !hasText(privacy.processingRegion))
  ) {
    blockers.push({
      code: "external_processing_not_approved",
      message:
        "External model disclosure requires an approved processing region.",
    });
  }
  return blockers;
}

function validSpan(span: AiEvidenceSpan): boolean {
  const rowPairValid =
    (span.rowStart == null && span.rowEnd == null) ||
    (Number.isSafeInteger(span.rowStart) &&
      Number.isSafeInteger(span.rowEnd) &&
      (span.rowStart ?? -1) >= 0 &&
      (span.rowEnd ?? -1) >= (span.rowStart ?? 0));
  const optionalIdsValid =
    (span.paragraphId == null || validIdentifier(span.paragraphId)) &&
    (span.tableId == null || validIdentifier(span.tableId));
  const tableCoordinatesValid = span.rowStart == null || span.tableId != null;
  return (
    Number.isSafeInteger(span.pageStart) &&
    Number.isSafeInteger(span.pageEnd) &&
    span.pageStart >= 1 &&
    span.pageEnd >= span.pageStart &&
    Number.isSafeInteger(span.sourceOffsetStart) &&
    Number.isSafeInteger(span.sourceOffsetEnd) &&
    span.sourceOffsetStart >= 0 &&
    span.sourceOffsetEnd > span.sourceOffsetStart &&
    hasText(span.locator) &&
    span.locator.length <= 512 &&
    rowPairValid &&
    optionalIdsValid &&
    tableCoordinatesValid
  );
}

function candidateBlockers(
  request: AiRetrievalRequest,
  candidate: AiRetrievalCandidate,
): AiRetrievalBlocker[] {
  const blockers: AiRetrievalBlocker[] = [];
  const add = (code: AiRetrievalBlockerCode, message: string): void => {
    blockers.push({ code, message, chunkId: candidate.chunkId });
  };
  const candidateTextBounded =
    hasText(candidate.text) &&
    candidate.text.length <=
      AI_RETRIEVAL_INPUT_BOUNDS.maxCandidateTextCodeUnits &&
    Buffer.byteLength(candidate.text, "utf8") <=
      Math.min(
        AI_RETRIEVAL_INPUT_BOUNDS.maxCandidateTextBytes,
        request.limits.maxContextBytes,
      );

  if (candidate.tenantId !== request.tenantId) {
    add("tenant_scope_mismatch", "A candidate belongs to another tenant.");
  }
  if (candidate.projectId !== request.projectId) {
    add("project_scope_mismatch", "A candidate belongs to another project.");
  }
  if (
    !request.allowedDocumentVersionIds.includes(candidate.documentVersionId)
  ) {
    add(
      "document_version_not_allowed",
      "A candidate is outside the explicit document-version allowlist.",
    );
  }
  if (candidate.retrievalVersion !== request.retrievalVersion) {
    add(
      "retrieval_version_mismatch",
      "The candidate retrieval version is not the requested version.",
    );
  }
  if (candidate.indexVersion !== request.indexVersion) {
    add(
      "index_version_mismatch",
      "The candidate index version is not the requested version.",
    );
  }
  if (
    !validIdentifier(candidate.chunkId) ||
    !validIdentifier(candidate.documentId) ||
    !validIdentifier(candidate.documentVersionId) ||
    !candidateTextBounded ||
    !SOURCE_CHANNELS.has(candidate.sourceChannel)
  ) {
    add("request_invalid", "The candidate identity or text is invalid.");
  }
  if (!SHA256.test(candidate.sourceSha256)) {
    add("source_hash_invalid", "The immutable source hash is invalid.");
  }
  if (
    !SHA256.test(candidate.textSha256) ||
    !candidateTextBounded ||
    aiRetrievalTextSha256(candidate.text) !== candidate.textSha256
  ) {
    add("text_hash_mismatch", "The retrieved text hash does not match.");
  }
  if (candidate.lifecycle !== "active") {
    add("lifecycle_not_active", "Only active source versions may be used.");
  }
  if (
    !request.privacyDecision.allowedClassifications.includes(
      candidate.classification,
    )
  ) {
    add(
      "privacy_classification_denied",
      "The privacy decision does not allow this classification.",
    );
  }
  if (
    candidate.requiredPermissions.length >
    AI_RETRIEVAL_INPUT_BOUNDS.maxCandidatePermissions
  ) {
    add("request_invalid", "The candidate permission set exceeds its bound.");
  } else if (
    candidate.requiredPermissions.length === 0 ||
    !candidate.requiredPermissions.every(validIdentifier) ||
    new Set(candidate.requiredPermissions).size !==
      candidate.requiredPermissions.length ||
    !candidate.requiredPermissions.every((permission) =>
      request.actor.permissions.includes(permission),
    )
  ) {
    add("permission_denied", "The actor lacks a required source permission.");
  }
  const scan = candidate.injectionScan;
  const scanTimestampValid = validIsoTimestamp(scan.scannedAt);
  if (
    !INJECTION_STATUSES.has(scan.status) ||
    scan.status === "unscanned" ||
    !validIdentifier(scan.scannerVersion) ||
    !request.approvedInjectionScannerVersions.includes(scan.scannerVersion) ||
    !scanTimestampValid ||
    (scanTimestampValid &&
      (Date.parse(scan.scannedAt) > Date.parse(request.evaluatedAt) ||
        Date.parse(request.evaluatedAt) - Date.parse(scan.scannedAt) >
          request.injectionScanMaxAgeMs)) ||
    !SHA256.test(scan.textSha256) ||
    scan.textSha256 !== candidate.textSha256 ||
    !validIdentifier(scan.evidenceReference) ||
    scan.signals.length > INJECTION_SIGNALS.size ||
    new Set(scan.signals).size !== scan.signals.length ||
    !scan.signals.every((signal) => INJECTION_SIGNALS.has(signal))
  ) {
    add(
      "injection_scan_missing",
      "Retrieved content requires a current, approved, text-bound injection scan.",
    );
  }
  const injectionSignals = new Set<AiInjectionSignal>([
    ...scan.signals.filter((signal) => INJECTION_SIGNALS.has(signal)),
    ...(candidateTextBounded
      ? detectRetrievalInjectionSignals(candidate.text)
      : []),
  ]);
  if (scan.status === "flagged" || injectionSignals.size > 0) {
    add(
      "injection_detected",
      `Retrieved content is quarantined by the injection firewall: ${
        [...injectionSignals].sort().join(", ") || "scanner_flag"
      }.`,
    );
  }
  if (!validSpan(candidate.span)) {
    add("span_invalid", "The candidate lacks a valid page/span locator.");
  }
  if (
    !validScore(candidate.lexicalScore) ||
    !validScore(candidate.vectorScore) ||
    (request.weights.rerank > 0 &&
      !validScore(candidate.rerankScore ?? Number.NaN))
  ) {
    add("score_invalid", "Retrieval scores must be finite values in [0, 1].");
  } else if (
    candidate.lexicalScore < request.limits.minLexicalScore &&
    candidate.vectorScore < request.limits.minVectorScore
  ) {
    add(
      "score_below_floor",
      "The candidate meets neither the lexical nor vector evidence floor.",
    );
  } else if (
    request.weights.rerank > 0 &&
    (candidate.rerankScore ?? 0) < request.limits.minRerankScore
  ) {
    add("score_below_floor", "The candidate is below the reranker floor.");
  }
  if (!validScore(candidate.extractionQualityScore)) {
    add("score_invalid", "The extraction-quality score is invalid.");
  } else if (
    candidate.extractionQualityScore < request.limits.minExtractionQualityScore
  ) {
    add(
      "extraction_quality_low",
      "The parser/OCR quality evidence is below the approved floor.",
    );
  }
  return blockers;
}

const FATAL_CANDIDATE_BLOCKERS = new Set<AiRetrievalBlockerCode>([
  "request_invalid",
  "tenant_scope_mismatch",
  "project_scope_mismatch",
  "document_version_not_allowed",
  "retrieval_version_mismatch",
  "index_version_mismatch",
  "source_hash_invalid",
  "text_hash_mismatch",
  "lifecycle_not_active",
  "privacy_classification_denied",
  "permission_denied",
  "injection_scan_missing",
  "injection_detected",
  "span_invalid",
  "score_invalid",
]);

/**
 * Validates and deterministically ranks already-computed lexical/vector scores.
 * It does not implement an index or embedding model and cannot activate one.
 */
function blockedResult(
  blockers: AiRetrievalBlocker[],
  rejected: AiRetrievalBlocker[] = [],
): AiRetrievalResult {
  return {
    disposition: "blocked",
    blockers,
    rejected,
    selected: [],
    manifestSha256: null,
    contextBytes: 0,
  };
}

export function buildEvidenceGradeRetrievalContext(input: {
  request: AiRetrievalRequest;
  candidates: AiRetrievalCandidate[];
}): AiRetrievalResult {
  const requestBlockers = validateRequest(input.request);
  if (requestBlockers.length > 0) {
    return blockedResult(requestBlockers);
  }
  if (input.candidates.length > input.request.limits.maxCandidates) {
    return blockedResult([
      {
        code: "request_invalid",
        message: "The candidate set exceeds the approved retrieval bound.",
      },
    ]);
  }
  const candidateIds = input.candidates.map((candidate) => candidate.chunkId);
  if (new Set(candidateIds).size !== candidateIds.length) {
    return blockedResult([
      {
        code: "request_invalid",
        message: "Retrieved chunk identifiers must be unique.",
      },
    ]);
  }

  const rejected: AiRetrievalBlocker[] = [];
  const accepted: Array<{
    candidate: AiRetrievalCandidate;
    hybridScore: number;
  }> = [];
  for (const candidate of input.candidates) {
    const blockers = candidateBlockers(input.request, candidate);
    if (blockers.length > 0) {
      rejected.push(...blockers);
      continue;
    }
    accepted.push({
      candidate,
      hybridScore:
        candidate.lexicalScore * input.request.weights.lexical +
        candidate.vectorScore * input.request.weights.vector +
        (candidate.rerankScore ?? 0) * input.request.weights.rerank,
    });
  }

  const fatal = rejected.filter((blocker) =>
    FATAL_CANDIDATE_BLOCKERS.has(blocker.code),
  );
  if (fatal.length > 0) {
    return blockedResult(fatal, rejected);
  }

  accepted.sort(
    (left, right) =>
      right.hybridScore - left.hybridScore ||
      right.candidate.extractionQualityScore -
        left.candidate.extractionQualityScore ||
      left.candidate.chunkId.localeCompare(right.candidate.chunkId),
  );
  const selected: AiRetrievedEvidence[] = [];
  let contextBytes = 0;
  let contextBudgetExhausted = false;
  for (const entry of accepted) {
    if (selected.length >= input.request.limits.maxSelected) break;
    const nextBytes = Buffer.byteLength(entry.candidate.text, "utf8");
    if (contextBytes + nextBytes > input.request.limits.maxContextBytes) {
      rejected.push({
        code: "context_limit_exceeded",
        chunkId: entry.candidate.chunkId,
        message: "The evidence chunk would exceed the approved context bound.",
      });
      contextBudgetExhausted = true;
      continue;
    }
    contextBytes += nextBytes;
    selected.push({
      chunkId: entry.candidate.chunkId,
      documentId: entry.candidate.documentId,
      documentVersionId: entry.candidate.documentVersionId,
      sourceSha256: entry.candidate.sourceSha256,
      textSha256: entry.candidate.textSha256,
      text: entry.candidate.text,
      sourceChannel: entry.candidate.sourceChannel,
      span: { ...entry.candidate.span },
      classification: entry.candidate.classification,
      hybridScore: entry.hybridScore,
      extractionQualityScore: entry.candidate.extractionQualityScore,
      taint: "untrusted_evidence",
      instructionAuthority: "none",
    });
  }

  if (selected.length === 0) {
    return {
      disposition: "abstain",
      blockers: [],
      rejected,
      selected: [],
      manifestSha256: null,
      contextBytes: 0,
      abstentionReason: contextBudgetExhausted
        ? "context_budget_exhausted"
        : "no_eligible_evidence",
    };
  }

  const manifestSha256 = createHash("sha256")
    .update(
      insertionOrderJson({
        requestId: input.request.requestId,
        tenantId: input.request.tenantId,
        projectId: input.request.projectId,
        retrievalVersion: input.request.retrievalVersion,
        indexVersion: input.request.indexVersion,
        evidence: selected.map((item) => ({
          chunkId: item.chunkId,
          documentVersionId: item.documentVersionId,
          sourceSha256: item.sourceSha256,
          textSha256: item.textSha256,
          span: {
            pageStart: item.span.pageStart,
            pageEnd: item.span.pageEnd,
            sourceOffsetStart: item.span.sourceOffsetStart,
            sourceOffsetEnd: item.span.sourceOffsetEnd,
            locator: item.span.locator,
            paragraphId: item.span.paragraphId ?? null,
            tableId: item.span.tableId ?? null,
            rowStart: item.span.rowStart ?? null,
            rowEnd: item.span.rowEnd ?? null,
          },
        })),
      }),
    )
    .digest("hex");

  return {
    disposition: "ready",
    blockers: [],
    rejected,
    selected,
    manifestSha256,
    contextBytes,
  };
}

const INTEGRITY_GROUNDING_BLOCKERS = new Set<AiClaimGroundingBlockerCode>([
  "claim_invalid",
  "citation_invalid",
  "claim_scope_mismatch",
  "citation_not_found",
  "citation_claim_mismatch",
  "citation_chunk_not_selected",
  "citation_span_invalid",
  "citation_quote_mismatch",
  "support_verifier_missing",
  "support_score_invalid",
  "claim_contradicted",
]);

/**
 * Requires exact selected-chunk quotes plus an independent support verdict for
 * every material claim. Missing evidence produces abstention; corrupted scope
 * or provenance blocks the whole draft.
 */
export function evaluateClaimGroundingAndAbstention(input: {
  tenantId: string;
  projectId: string;
  retrieval: AiRetrievalResult;
  claims: AiDraftClaim[];
  citations: AiClaimCitation[];
  minSupportScore: number;
}): AiClaimGroundingResult {
  if (input.retrieval.disposition !== "ready") {
    return {
      disposition:
        input.retrieval.disposition === "blocked" ? "blocked" : "abstain",
      blockers: [
        {
          code: "retrieval_not_ready",
          message: "Claim generation cannot proceed without ready evidence.",
        },
      ],
      groundedClaimIds: [],
      abstainedClaimIds: input.claims.map((claim) => claim.claimId).sort(),
    };
  }
  if (!validScore(input.minSupportScore)) {
    return {
      disposition: "blocked",
      blockers: [
        {
          code: "support_score_invalid",
          message: "The claim-support floor is invalid.",
        },
      ],
      groundedClaimIds: [],
      abstainedClaimIds: input.claims.map((claim) => claim.claimId).sort(),
    };
  }

  const selectedIds = input.retrieval.selected.map((chunk) => chunk.chunkId);
  if (
    !validIdentifier(input.tenantId) ||
    !validIdentifier(input.projectId) ||
    !SHA256.test(input.retrieval.manifestSha256 ?? "") ||
    input.retrieval.selected.length === 0 ||
    new Set(selectedIds).size !== selectedIds.length ||
    input.retrieval.selected.some(
      (chunk) =>
        !validIdentifier(chunk.chunkId) ||
        !SHA256.test(chunk.textSha256) ||
        aiRetrievalTextSha256(chunk.text) !== chunk.textSha256,
    )
  ) {
    return {
      disposition: "blocked",
      blockers: [
        {
          code: "retrieval_not_ready",
          message: "The ready retrieval result failed its integrity contract.",
        },
      ],
      groundedClaimIds: [],
      abstainedClaimIds: input.claims.map((claim) => claim.claimId).sort(),
    };
  }

  const claimIds = input.claims.map((claim) => claim.claimId);
  const citationIds = input.citations.map((citation) => citation.citationId);
  const referencedCitationIds = new Set(
    input.claims.flatMap((claim) => claim.citationIds),
  );
  const claimsInvalid =
    input.claims.length === 0 ||
    input.claims.length > 1_000 ||
    new Set(claimIds).size !== claimIds.length ||
    input.claims.some(
      (claim) =>
        !validIdentifier(claim.claimId) ||
        !hasText(claim.text) ||
        claim.text.length > 20_000 ||
        !CLAIM_KINDS.has(claim.kind) ||
        claim.citationIds.length > 20 ||
        new Set(claim.citationIds).size !== claim.citationIds.length ||
        !claim.citationIds.every(validIdentifier),
    );
  const citationsInvalid =
    input.citations.length > 5_000 ||
    new Set(citationIds).size !== citationIds.length ||
    input.citations.some(
      (citation) =>
        !validIdentifier(citation.citationId) ||
        !validIdentifier(citation.claimId) ||
        !validIdentifier(citation.chunkId) ||
        !VERIFIER_VERDICTS.has(citation.verifierVerdict) ||
        !referencedCitationIds.has(citation.citationId),
    );
  if (claimsInvalid || citationsInvalid) {
    return {
      disposition: "blocked",
      blockers: [
        {
          code: claimsInvalid ? "claim_invalid" : "citation_invalid",
          message: "Claim and citation identifiers must be unique and bounded.",
        },
      ],
      groundedClaimIds: [],
      abstainedClaimIds: claimIds.sort(),
    };
  }

  const selected = new Map(
    input.retrieval.selected.map((chunk) => [chunk.chunkId, chunk]),
  );
  const citations = new Map(
    input.citations.map((citation) => [citation.citationId, citation]),
  );
  const blockers: AiClaimGroundingBlocker[] = [];
  const groundedClaimIds: string[] = [];
  const abstainedClaimIds: string[] = [];

  for (const claim of input.claims) {
    const blockerStart = blockers.length;
    if (
      claim.tenantId !== input.tenantId ||
      claim.projectId !== input.projectId
    ) {
      blockers.push({
        code: "claim_scope_mismatch",
        claimId: claim.claimId,
        message: "A draft claim is outside the authorised tenant/project.",
      });
      abstainedClaimIds.push(claim.claimId);
      continue;
    }
    if (claim.kind === "non_factual") continue;
    if (claim.citationIds.length === 0) {
      blockers.push({
        code: "material_claim_uncited",
        claimId: claim.claimId,
        message: "A material factual claim has no citation.",
      });
      abstainedClaimIds.push(claim.claimId);
      continue;
    }

    let supported = false;
    for (const citationId of claim.citationIds) {
      const citation = citations.get(citationId);
      if (!citation) {
        blockers.push({
          code: "citation_not_found",
          claimId: claim.claimId,
          citationId,
          message: "The claim references an unknown citation.",
        });
        continue;
      }
      if (citation.claimId !== claim.claimId) {
        blockers.push({
          code: "citation_claim_mismatch",
          claimId: claim.claimId,
          citationId,
          message: "The citation is bound to a different claim.",
        });
        continue;
      }
      const chunk = selected.get(citation.chunkId);
      if (!chunk) {
        blockers.push({
          code: "citation_chunk_not_selected",
          claimId: claim.claimId,
          citationId,
          message: "The citation is not in the pinned retrieval manifest.",
        });
        continue;
      }
      if (
        !Number.isSafeInteger(citation.quoteStart) ||
        !Number.isSafeInteger(citation.quoteEnd) ||
        citation.quoteStart < 0 ||
        citation.quoteEnd <= citation.quoteStart ||
        citation.quoteEnd > chunk.text.length
      ) {
        blockers.push({
          code: "citation_span_invalid",
          claimId: claim.claimId,
          citationId,
          message: "The citation offsets are invalid.",
        });
        continue;
      }
      if (
        !hasText(citation.quote) ||
        chunk.text.slice(citation.quoteStart, citation.quoteEnd) !==
          citation.quote
      ) {
        blockers.push({
          code: "citation_quote_mismatch",
          claimId: claim.claimId,
          citationId,
          message: "The citation quote does not match the selected source.",
        });
        continue;
      }
      if (!validIdentifier(citation.verifierVersion)) {
        blockers.push({
          code: "support_verifier_missing",
          claimId: claim.claimId,
          citationId,
          message: "An independent support-verifier version is required.",
        });
        continue;
      }
      if (!validScore(citation.verifierScore)) {
        blockers.push({
          code: "support_score_invalid",
          claimId: claim.claimId,
          citationId,
          message: "The support score is invalid.",
        });
        continue;
      }
      if (citation.verifierVerdict === "contradicted") {
        blockers.push({
          code: "claim_contradicted",
          claimId: claim.claimId,
          citationId,
          message: "The selected evidence contradicts the claim.",
        });
        continue;
      }
      if (
        citation.verifierVerdict !== "entailed" ||
        citation.verifierScore < input.minSupportScore
      ) {
        blockers.push({
          code: "support_insufficient",
          claimId: claim.claimId,
          citationId,
          message: "Independent evidence support is below the required floor.",
        });
        continue;
      }
      supported = true;
    }

    if (supported && blockers.length === blockerStart) {
      groundedClaimIds.push(claim.claimId);
    } else {
      abstainedClaimIds.push(claim.claimId);
    }
  }

  const integrityFailure = blockers.some((blocker) =>
    INTEGRITY_GROUNDING_BLOCKERS.has(blocker.code),
  );
  return {
    disposition: integrityFailure
      ? "blocked"
      : abstainedClaimIds.length > 0
        ? "abstain"
        : "grounded",
    blockers,
    groundedClaimIds: groundedClaimIds.sort(),
    abstainedClaimIds: abstainedClaimIds.sort(),
  };
}
