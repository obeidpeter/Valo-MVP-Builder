/**
 * Schema containment for LLM output (FR-EXT-02, untrusted-input doctrine):
 * tender documents are hostile input, so model output derived from them can
 * be hostile too. Nothing a model returns may touch the database except
 * through these sanitizers, which copy ONLY known primitive fields into fresh
 * objects (no prototype traversal, no extra keys), clamp every enum, cap
 * every string and array, and null or drop anything referencing an entity
 * outside the caller-supplied ID sets.
 *
 * Containment posture per field class:
 *  - free text (descriptions, excerpts, notes): kept as DATA, length-capped —
 *    injected instructions in text are harmless once they can only ever be
 *    displayed to a reviewer;
 *  - enums (category, status, severity, type): clamped to the schema, and
 *    where the value drives risk maths (defect type/severity) an invalid
 *    value DROPS the item entirely — fail closed, never guess a taxonomy;
 *  - references (documentId, requirementId): must be in the supplied ID set
 *    or they are nulled/dropped, so a hostile document cannot point findings
 *    at entities outside the engagement.
 */
import type {
  ExtractedRequirement,
  MappedEvidence,
  SuggestedDefect,
} from "./llm";

const MAX_ITEMS = 500;
const MAX_TEXT = 4000;
const MAX_NOTE = 1000;

const REQUIREMENT_CATEGORIES = new Set([
  "eligibility",
  "administrative",
  "technical",
  "financial_format",
  "other",
]);
const CONFIDENCE_LEVELS = new Set(["high", "medium", "low", "unclear"]);
const EVIDENCE_STATUSES = new Set([
  "present",
  "missing",
  "expired",
  "unclear",
  "not_applicable",
  "pending",
]);
const DEFECT_TYPES = new Set([
  "omission",
  "expiry",
  "arithmetic",
  "formatting",
  "responsiveness",
  "eligibility",
  "unsupported_claim",
  "validity",
]);
const DEFECT_SEVERITIES = new Set([
  "fatal",
  "likely_fatal",
  "scoring_risk",
  "cosmetic",
]);

function asText(value: unknown, cap: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, MAX_ITEMS) : [];
}

import { isRecord } from "./typeGuards";

export function sanitizeExtractedRequirements(
  raw: unknown,
  validDocIds: ReadonlySet<string>,
): ExtractedRequirement[] {
  const out: ExtractedRequirement[] = [];
  for (const item of asArray(raw)) {
    if (!isRecord(item)) continue;
    const text = asText(item.text, MAX_TEXT);
    if (!text) continue; // a requirement without text is not a requirement

    const category = asText(item.category, 50);
    const confidence = asText(item.confidence, 20);
    const sourceDocId = asText(item.sourceDocId, 100);
    out.push({
      text,
      category: (category && REQUIREMENT_CATEGORIES.has(category)
        ? category
        : "other") as ExtractedRequirement["category"],
      expectedEvidence: asText(item.expectedEvidence, MAX_NOTE),
      isMandatory: item.isMandatory === true,
      confidence: (confidence && CONFIDENCE_LEVELS.has(confidence)
        ? confidence
        : "unclear") as ExtractedRequirement["confidence"],
      pageRef: asText(item.pageRef, 100),
      clauseRef: asText(item.clauseRef, 100),
      sourceDocId:
        sourceDocId && validDocIds.has(sourceDocId) ? sourceDocId : null,
      sourceQuote: asText(item.sourceQuote, MAX_TEXT),
    });
  }
  return out;
}

export function sanitizeMappedEvidence(
  raw: unknown,
  validReqIds: ReadonlySet<string>,
  validDocIds: ReadonlySet<string>,
): MappedEvidence[] {
  const out: MappedEvidence[] = [];
  for (const item of asArray(raw)) {
    if (!isRecord(item)) continue;
    const requirementId = asText(item.requirementId, 100);
    // Evidence must attach to a requirement in this engagement — drop it
    // outright if it points anywhere else.
    if (!requirementId || !validReqIds.has(requirementId)) continue;

    const documentId = asText(item.documentId, 100);
    const safeDocumentId =
      documentId && validDocIds.has(documentId) ? documentId : null;
    const excerpt = asText(item.excerpt, MAX_TEXT);
    const proposedStatus = asText(item.evidenceStatus, 30);
    let evidenceStatus = (
      proposedStatus && EVIDENCE_STATUSES.has(proposedStatus)
        ? proposedStatus
        : "unclear"
    ) as MappedEvidence["evidenceStatus"];
    // A positive evidence assertion is never allowed to survive without both
    // an in-scope source and a quote. Exact quote grounding is then enforced
    // against source text by the route before persistence.
    if (
      (evidenceStatus === "present" || evidenceStatus === "expired") &&
      (!safeDocumentId || !excerpt)
    ) {
      evidenceStatus = "unclear";
    }
    out.push({
      requirementId,
      documentId: safeDocumentId,
      evidenceStatus,
      excerpt,
      notes: asText(item.notes, MAX_NOTE),
    });
  }
  return out;
}

export function sanitizeSuggestedDefects(
  raw: unknown,
  validReqIds: ReadonlySet<string>,
): SuggestedDefect[] {
  const out: SuggestedDefect[] = [];
  for (const item of asArray(raw)) {
    if (!isRecord(item)) continue;
    const description = asText(item.description, MAX_TEXT);
    const type = asText(item.type, 40);
    const severity = asText(item.severity, 20);
    // Type and severity drive the defect register and (once confirmed) the
    // risk score: an out-of-taxonomy value means the item is dropped, never
    // coerced into a guess.
    if (!description || !type || !DEFECT_TYPES.has(type)) continue;
    if (!severity || !DEFECT_SEVERITIES.has(severity)) continue;

    const requirementId = asText(item.requirementId, 100);
    out.push({
      requirementId:
        requirementId && validReqIds.has(requirementId) ? requirementId : null,
      type: type as SuggestedDefect["type"],
      severity: severity as SuggestedDefect["severity"],
      description,
      remediation: asText(item.remediation, MAX_NOTE),
    });
  }
  return out;
}
