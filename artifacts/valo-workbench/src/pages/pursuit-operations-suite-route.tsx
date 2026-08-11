import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  customFetch,
  getListDocumentsQueryKey,
  getListProjectsQueryKey,
  getListVaultItemsQueryKey,
  useGetMe,
  useListDocuments,
  useListProjects,
  useListVaultItems,
} from "@workspace/api-client-react";
import { Link, useSearchParams } from "wouter";
import { LowBandwidthMobileReviewer } from "@/components/operations-suite";
import type {
  ClientEvidenceRequest,
  CredentialCheckRecord,
  MobileReviewItem,
  OperationsSuiteActions,
  OperationsSuiteSnapshot,
  PostAwardObligation,
  PursuitMissionEvent,
  PursuitWorkItem,
  SubmissionPackageRecord,
  VisualQaCheck,
  WorkItemStatus,
} from "@/components/operations-suite";
import { StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { useOrganisationAccess } from "@/contexts/organisation-context";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToast } from "@/hooks/use-toast";
import PursuitOperationsSuite from "./pursuit-operations-suite";
import PursuitOperationsSuiteRecorder, {
  type OperationsRecorderCommand,
  type OperationsRecorderRecords,
  type CanonicalDocumentOption,
  type PackageVersionOption,
  type VaultItemOption,
} from "./pursuit-operations-suite-recorder";

const RECORD_KINDS = [
  "opportunity_intake",
  "work_item",
  "evidence_request",
  "submission_war_room",
  "visual_qa_report",
  "credential_verification",
  "mission",
  "post_award_item",
] as const;

type RecordKind = (typeof RECORD_KINDS)[number];
type JsonObject = Record<string, unknown>;

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_RECORDS = 1_000;
const MAX_PER_KIND = 250;
const MAX_TEXT = 4_096;
const OPERATIONS_QUERY_CAPABILITIES = [
  "project:read",
  "project:update",
  "project:assign",
  "evidence:read",
  "evidence:write",
  "evidence:approve",
  "document:read",
  "package:read",
  "package:export",
  "package:generate",
] as const;

function operationsCapabilityFingerprint(
  permissions: readonly string[],
): string {
  return OPERATIONS_QUERY_CAPABILITIES.map((permission) =>
    permissions.includes(permission) ? permission : `!${permission}`,
  ).join("|");
}

export class OperationsSuitePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationsSuitePayloadError";
  }
}

function invalid(label: string): never {
  throw new OperationsSuitePayloadError(
    `Invalid operations-suite response at ${label}.`,
  );
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(label);
  }
  return value as JsonObject;
}

function text(value: unknown, label: string, maximum = MAX_TEXT): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    return invalid(label);
  }
  return value;
}

function nullableText(
  value: unknown,
  label: string,
  maximum = MAX_TEXT,
): string | null {
  return value === null ? null : text(value, label, maximum);
}

function identifier(value: unknown, label: string): string {
  const parsed = text(value, label, 128);
  return ID_PATTERN.test(parsed) ? parsed : invalid(label);
}

function uuid(value: unknown, label: string): string {
  const parsed = text(value, label, 36);
  return UUID_PATTERN.test(parsed) ? parsed : invalid(label);
}

function nullableIdentifier(value: unknown, label: string): string | null {
  return value === null ? null : identifier(value, label);
}

function isoInstant(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  return Number.isNaN(Date.parse(parsed)) ? invalid(label) : parsed;
}

function nullableIsoInstant(value: unknown, label: string): string | null {
  return value === null ? null : isoInstant(value, label);
}

function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(label);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  return typeof value === "boolean" ? value : invalid(label);
}

function choice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  label: string,
): T[number] {
  return typeof value === "string" && choices.includes(value)
    ? (value as T[number])
    : invalid(label);
}

function boundedArray(
  value: unknown,
  label: string,
  maximum: number,
): unknown[] {
  return Array.isArray(value) && value.length <= maximum
    ? value
    : invalid(label);
}

function identifiers(value: unknown, label: string, maximum: number): string[] {
  const parsed = boundedArray(value, label, maximum).map((entry, index) =>
    identifier(entry, `${label}[${index}]`),
  );
  return new Set(parsed).size === parsed.length ? parsed : invalid(label);
}

function sha256(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  return SHA256_PATTERN.test(parsed) ? parsed : invalid(label);
}

function nullableSha256(value: unknown, label: string): string | null {
  return value === null ? null : sha256(value, label);
}

interface RawBase {
  id: string;
  kind: RecordKind;
  organisationId: string;
  projectId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface RawOpportunity extends RawBase {
  kind: "opportunity_intake";
  title: string;
  issuer: string;
  reference: string | null;
  source: {
    type: "manual_url" | "forwarded_email" | "licensed_csv" | "ocds";
    locator: string;
    receivedAt: string;
    authorisationBasis: string | null;
    contentSha256: string | null;
  };
  provenanceSha256: string;
  deadline: string | null;
  deadlineStatus: "unconfirmed" | "human_confirmed";
  deadlineConfirmedByUserId: string | null;
  status: "recorded" | "qualified" | "not_pursued";
}

interface RawStatusReason {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string;
  recordedByUserId: string;
  recordedAt: string;
}

interface RawWorkItem extends RawBase {
  kind: "work_item";
  title: string;
  ownerUserId: string | null;
  dueAt: string | null;
  status:
    | "backlog"
    | "ready"
    | "in_progress"
    | "blocked"
    | "in_review"
    | "done"
    | "cancelled";
  links: {
    requirementIds: string[];
    evidenceItemIds: string[];
    packageIds: string[];
  };
  dependsOnIds: string[];
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  statusReasonHistory: RawStatusReason[];
}

interface RawEvidenceSlot {
  id: string;
  label: string;
  required: boolean;
  acceptedContentTypes: string[];
  response: null | { sha256: string };
  acceptance: null | { decision: "accepted" | "rejected" };
  priorResponseCount: number;
}

interface RawEvidenceRequest extends RawBase {
  kind: "evidence_request";
  recipientLabel: string;
  dueAt: string | null;
  status:
    | "draft"
    | "shared_manually"
    | "response_recorded"
    | "accepted"
    | "closed";
  slots: RawEvidenceSlot[];
}

interface RawSubmission extends RawBase {
  kind: "submission_war_room";
  packageId: string;
  packageVersionId: string;
  manifestSha256: string;
  copyCount: number;
  status:
    | "planning"
    | "frozen"
    | "copies_prepared"
    | "sealed"
    | "dispatched"
    | "receipt_recorded"
    | "cancelled";
  dispatchMethod: string | null;
  receiptSha256: string | null;
  statusReasonHistory: RawStatusReason[];
}

interface RawVisualQa extends RawBase {
  kind: "visual_qa_report";
  packageVersionId: string;
  manifestSha256: string;
  result: {
    status: "pass" | "review" | "fail";
    findings: Array<{
      code:
        | "manifest_mismatch"
        | "unexpected_blank_page"
        | "clipped_content"
        | "broken_cross_reference"
        | "missing_signature";
      severity: "blocker" | "warning";
      message: string;
      pageNumber: number | null;
    }>;
  };
}

interface RawCredential extends RawBase {
  kind: "credential_verification";
  vaultItemId: string;
  vaultItemVersion: number;
  documentSha256: string;
  authorityName: string;
  officialSourceLocator: string;
  checkedAt: string;
  checkedByUserId: string;
  outcome: "verified" | "not_verified" | "inconclusive";
  receiptSha256: string;
}

interface RawMission extends RawBase {
  kind: "mission";
  missionType: "pre_bid" | "site_visit";
  title: string;
  location: string;
  startsAt: string;
  attendanceRequired: boolean;
  delegateUserId: string | null;
  delegateAuthorityNote: string | null;
  checklist: Array<{ id: string; label: string }>;
  proofs: Array<{ documentId: string }>;
  status: "planned" | "attended" | "missed" | "completed" | "cancelled";
  statusReasonHistory: RawStatusReason[];
}

interface RawPostAward extends RawBase {
  kind: "post_award_item";
  category:
    | "obligation"
    | "deliverable"
    | "variation"
    | "payment_milestone"
    | "notice"
    | "completion_record";
  title: string;
  dueAt: string | null;
  ownerUserId: string | null;
  evidenceDocumentIds: string[];
  valueMinorUnits: number | null;
  currency: string | null;
  status: "open" | "in_progress" | "satisfied" | "disputed" | "cancelled";
  statusReasonHistory: RawStatusReason[];
}

type RawRecord =
  | RawOpportunity
  | RawWorkItem
  | RawEvidenceRequest
  | RawSubmission
  | RawVisualQa
  | RawCredential
  | RawMission
  | RawPostAward;

function parseEvidenceResponse(
  value: unknown,
  label: string,
): NonNullable<RawEvidenceSlot["response"]> {
  const response = object(value, label);
  identifier(response.documentId, `${label}.documentId`);
  text(response.attestation, `${label}.attestation`);
  identifier(response.recordedByUserId, `${label}.recordedByUserId`);
  isoInstant(response.recordedAt, `${label}.recordedAt`);
  return { sha256: sha256(response.sha256, `${label}.sha256`) };
}

function parseEvidenceAcceptance(
  value: unknown,
  label: string,
): NonNullable<RawEvidenceSlot["acceptance"]> {
  const acceptance = object(value, label);
  text(acceptance.reason, `${label}.reason`);
  identifier(acceptance.decidedByUserId, `${label}.decidedByUserId`);
  isoInstant(acceptance.decidedAt, `${label}.decidedAt`);
  return {
    decision: choice(
      acceptance.decision,
      ["accepted", "rejected"] as const,
      `${label}.decision`,
    ),
  };
}

function parseBase(body: JsonObject, kind: RecordKind, label: string): RawBase {
  const parsedKind = choice(body.kind, RECORD_KINDS, `${label}.kind`);
  if (parsedKind !== kind) invalid(`${label}.kind`);
  identifier(body.createdByUserId, `${label}.createdByUserId`);
  identifier(body.updatedByUserId, `${label}.updatedByUserId`);
  return {
    id: identifier(body.id, `${label}.id`),
    kind,
    organisationId: identifier(body.organisationId, `${label}.organisationId`),
    projectId: identifier(body.projectId, `${label}.projectId`),
    version: integer(body.version, `${label}.version`, 1),
    createdAt: isoInstant(body.createdAt, `${label}.createdAt`),
    updatedAt: isoInstant(body.updatedAt, `${label}.updatedAt`),
  };
}

function parseStatusReasonHistory(
  value: unknown,
  label: string,
): RawStatusReason[] {
  const reasons = boundedArray(value, label, 100);
  const parsed = reasons.map((entry, index): RawStatusReason => {
    const itemLabel = `${label}[${index}]`;
    const reason = object(entry, itemLabel);
    return {
      id: identifier(reason.id, `${itemLabel}.id`),
      fromStatus: text(reason.fromStatus, `${itemLabel}.fromStatus`, 64),
      toStatus: text(reason.toStatus, `${itemLabel}.toStatus`, 64),
      reason: text(reason.reason, `${itemLabel}.reason`, 1_024),
      recordedByUserId: identifier(
        reason.recordedByUserId,
        `${itemLabel}.recordedByUserId`,
      ),
      recordedAt: isoInstant(reason.recordedAt, `${itemLabel}.recordedAt`),
    };
  });
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    invalid(`${label}.id`);
  }
  return parsed;
}

function parseRecord(value: unknown, label: string): RawRecord {
  const body = object(value, label);
  const kind = choice(body.kind, RECORD_KINDS, `${label}.kind`);
  const base = parseBase(body, kind, label);

  switch (kind) {
    case "opportunity_intake": {
      nullableText(body.lot, `${label}.lot`, 256);
      sha256(body.dedupeKey, `${label}.dedupeKey`);
      const source = object(body.source, `${label}.source`);
      const sourceType = choice(
        source.type,
        ["manual_url", "forwarded_email", "licensed_csv", "ocds"] as const,
        `${label}.source.type`,
      );
      const authorisationBasis = nullableText(
        source.authorisationBasis,
        `${label}.source.authorisationBasis`,
        1_024,
      );
      const contentSha256 = nullableSha256(
        source.contentSha256,
        `${label}.source.contentSha256`,
      );
      if (
        (["licensed_csv", "ocds"] as const).includes(
          sourceType as "licensed_csv" | "ocds",
        ) &&
        !authorisationBasis
      ) {
        invalid(`${label}.source.authorisationBasis`);
      }
      if (sourceType !== "manual_url" && !contentSha256) {
        invalid(`${label}.source.contentSha256`);
      }
      const deadline = nullableIsoInstant(body.deadline, `${label}.deadline`);
      const deadlineStatus = choice(
        body.deadlineStatus,
        ["unconfirmed", "human_confirmed"] as const,
        `${label}.deadlineStatus`,
      );
      const confirmedBy = nullableIdentifier(
        body.deadlineConfirmedByUserId,
        `${label}.deadlineConfirmedByUserId`,
      );
      const confirmedAt = nullableIsoInstant(
        body.deadlineConfirmedAt,
        `${label}.deadlineConfirmedAt`,
      );
      if (
        deadlineStatus === "human_confirmed" &&
        (!deadline || !confirmedBy || !confirmedAt)
      ) {
        invalid(`${label}.deadlineConfirmation`);
      }
      return {
        ...base,
        kind,
        title: text(body.title, `${label}.title`),
        issuer: text(body.issuer, `${label}.issuer`),
        reference: nullableText(body.reference, `${label}.reference`, 256),
        source: {
          type: sourceType,
          locator: text(source.locator, `${label}.source.locator`, 2_048),
          receivedAt: isoInstant(
            source.receivedAt,
            `${label}.source.receivedAt`,
          ),
          authorisationBasis,
          contentSha256,
        },
        provenanceSha256: sha256(
          body.provenanceSha256,
          `${label}.provenanceSha256`,
        ),
        deadline,
        deadlineStatus,
        deadlineConfirmedByUserId: confirmedBy,
        status: choice(
          body.status,
          ["recorded", "qualified", "not_pursued"] as const,
          `${label}.status`,
        ),
      };
    }

    case "work_item": {
      nullableText(body.description, `${label}.description`);
      choice(
        body.priority,
        ["low", "normal", "high", "critical"] as const,
        `${label}.priority`,
      );
      const links = object(body.links, `${label}.links`);
      const parsedLinks = {
        requirementIds: identifiers(
          links.requirementIds,
          `${label}.links.requirementIds`,
          100,
        ),
        evidenceItemIds: identifiers(
          links.evidenceItemIds,
          `${label}.links.evidenceItemIds`,
          100,
        ),
        packageIds: identifiers(
          links.packageIds,
          `${label}.links.packageIds`,
          100,
        ),
      };
      for (const [index, entry] of boundedArray(
        body.comments,
        `${label}.comments`,
        100,
      ).entries()) {
        const comment = object(entry, `${label}.comments[${index}]`);
        identifier(comment.id, `${label}.comments[${index}].id`);
        text(comment.body, `${label}.comments[${index}].body`);
        identifier(
          comment.authorUserId,
          `${label}.comments[${index}].authorUserId`,
        );
        isoInstant(comment.createdAt, `${label}.comments[${index}].createdAt`);
      }
      const approval = object(body.approval, `${label}.approval`);
      const approvalStatus = choice(
        approval.status,
        ["not_required", "pending", "approved", "rejected"] as const,
        `${label}.approval.status`,
      );
      nullableIdentifier(
        approval.decidedByUserId,
        `${label}.approval.decidedByUserId`,
      );
      nullableIsoInstant(approval.decidedAt, `${label}.approval.decidedAt`);
      nullableText(approval.reason, `${label}.approval.reason`);
      const statusReasonHistory = parseStatusReasonHistory(
        body.statusReasonHistory,
        `${label}.statusReasonHistory`,
      );
      return {
        ...base,
        kind,
        title: text(body.title, `${label}.title`),
        ownerUserId: nullableIdentifier(
          body.ownerUserId,
          `${label}.ownerUserId`,
        ),
        dueAt: nullableIsoInstant(body.dueAt, `${label}.dueAt`),
        status: choice(
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
          `${label}.status`,
        ),
        links: parsedLinks,
        dependsOnIds: identifiers(
          body.dependsOnIds,
          `${label}.dependsOnIds`,
          50,
        ),
        approvalStatus,
        statusReasonHistory,
      };
    }

    case "evidence_request": {
      text(body.requestMessage, `${label}.requestMessage`);
      if (body.deliveryMode !== "manual_out_of_band") {
        invalid(`${label}.deliveryMode`);
      }
      nullableIdentifier(body.sharedByUserId, `${label}.sharedByUserId`);
      nullableIsoInstant(body.sharedAt, `${label}.sharedAt`);
      nullableSha256(body.receiptSha256, `${label}.receiptSha256`);
      const slots = boundedArray(body.slots, `${label}.slots`, 50).map(
        (entry, index): RawEvidenceSlot => {
          const slotLabel = `${label}.slots[${index}]`;
          const slot = object(entry, slotLabel);
          const acceptedContentTypes = boundedArray(
            slot.acceptedContentTypes,
            `${slotLabel}.acceptedContentTypes`,
            50,
          ).map((contentType, contentTypeIndex) =>
            text(
              contentType,
              `${slotLabel}.acceptedContentTypes[${contentTypeIndex}]`,
              256,
            ),
          );
          let response: RawEvidenceSlot["response"] = null;
          if (slot.response !== null) {
            response = parseEvidenceResponse(
              slot.response,
              `${slotLabel}.response`,
            );
          }
          let acceptance: RawEvidenceSlot["acceptance"] = null;
          if (slot.acceptance !== null) {
            acceptance = parseEvidenceAcceptance(
              slot.acceptance,
              `${slotLabel}.acceptance`,
            );
          }
          const responseHistory = boundedArray(
            slot.responseHistory,
            `${slotLabel}.responseHistory`,
            20,
          );
          for (const [
            historyIndex,
            historyEntry,
          ] of responseHistory.entries()) {
            const historyLabel = `${slotLabel}.responseHistory[${historyIndex}]`;
            const history = object(historyEntry, historyLabel);
            parseEvidenceResponse(history.response, `${historyLabel}.response`);
            const priorAcceptance = parseEvidenceAcceptance(
              history.acceptance,
              `${historyLabel}.acceptance`,
            );
            if (priorAcceptance.decision !== "rejected") {
              invalid(`${historyLabel}.acceptance.decision`);
            }
          }
          return {
            id: identifier(slot.id, `${slotLabel}.id`),
            label: text(slot.label, `${slotLabel}.label`, 256),
            required: boolean(slot.required, `${slotLabel}.required`),
            acceptedContentTypes,
            response,
            acceptance,
            priorResponseCount: responseHistory.length,
          };
        },
      );
      return {
        ...base,
        kind,
        recipientLabel: text(
          body.recipientLabel,
          `${label}.recipientLabel`,
          256,
        ),
        dueAt: nullableIsoInstant(body.dueAt, `${label}.dueAt`),
        status: choice(
          body.status,
          [
            "draft",
            "shared_manually",
            "response_recorded",
            "accepted",
            "closed",
          ] as const,
          `${label}.status`,
        ),
        slots,
      };
    }

    case "submission_war_room": {
      identifiers(body.sealIdentifiers, `${label}.sealIdentifiers`, 100);
      if (body.externalActionPolicy !== "record_only") {
        invalid(`${label}.externalActionPolicy`);
      }
      nullableIdentifier(body.frozenByUserId, `${label}.frozenByUserId`);
      nullableIsoInstant(body.frozenAt, `${label}.frozenAt`);
      nullableIdentifier(
        body.dispatchedByUserId,
        `${label}.dispatchedByUserId`,
      );
      nullableIsoInstant(body.dispatchedAt, `${label}.dispatchedAt`);
      nullableIdentifier(
        body.receiptRecordedByUserId,
        `${label}.receiptRecordedByUserId`,
      );
      nullableIsoInstant(body.receiptRecordedAt, `${label}.receiptRecordedAt`);
      const statusReasonHistory = parseStatusReasonHistory(
        body.statusReasonHistory,
        `${label}.statusReasonHistory`,
      );
      return {
        ...base,
        kind,
        packageId: identifier(body.packageId, `${label}.packageId`),
        packageVersionId: identifier(
          body.packageVersionId,
          `${label}.packageVersionId`,
        ),
        manifestSha256: sha256(body.manifestSha256, `${label}.manifestSha256`),
        copyCount: integer(body.copyCount, `${label}.copyCount`, 0, 10_000),
        status: choice(
          body.status,
          [
            "planning",
            "frozen",
            "copies_prepared",
            "sealed",
            "dispatched",
            "receipt_recorded",
            "cancelled",
          ] as const,
          `${label}.status`,
        ),
        dispatchMethod: nullableText(
          body.dispatchMethod,
          `${label}.dispatchMethod`,
          256,
        ),
        receiptSha256: nullableSha256(
          body.receiptSha256,
          `${label}.receiptSha256`,
        ),
        statusReasonHistory,
      };
    }

    case "visual_qa_report": {
      sha256(body.expectedManifestSha256, `${label}.expectedManifestSha256`);
      const result = object(body.result, `${label}.result`);
      if (result.algorithmVersion !== "visual-qa-v1") {
        invalid(`${label}.result.algorithmVersion`);
      }
      sha256(result.inputSha256, `${label}.result.inputSha256`);
      const findings = boundedArray(
        result.findings,
        `${label}.result.findings`,
        10_000,
      ).map((entry, index) => {
        const findingLabel = `${label}.result.findings[${index}]`;
        const finding = object(entry, findingLabel);
        return {
          code: choice(
            finding.code,
            [
              "manifest_mismatch",
              "unexpected_blank_page",
              "clipped_content",
              "broken_cross_reference",
              "missing_signature",
            ] as const,
            `${findingLabel}.code`,
          ),
          severity: choice(
            finding.severity,
            ["blocker", "warning"] as const,
            `${findingLabel}.severity`,
          ),
          message: text(finding.message, `${findingLabel}.message`),
          pageNumber:
            finding.pageNumber === null
              ? null
              : integer(
                  finding.pageNumber,
                  `${findingLabel}.pageNumber`,
                  1,
                  2_000,
                ),
        };
      });
      return {
        ...base,
        kind,
        packageVersionId: identifier(
          body.packageVersionId,
          `${label}.packageVersionId`,
        ),
        manifestSha256: sha256(body.manifestSha256, `${label}.manifestSha256`),
        result: {
          status: choice(
            result.status,
            ["pass", "review", "fail"] as const,
            `${label}.result.status`,
          ),
          findings,
        },
      };
    }

    case "credential_verification": {
      nullableText(body.notes, `${label}.notes`);
      if (body.verificationMode !== "human_recorded") {
        invalid(`${label}.verificationMode`);
      }
      return {
        ...base,
        kind,
        vaultItemId: identifier(body.vaultItemId, `${label}.vaultItemId`),
        vaultItemVersion: integer(
          body.vaultItemVersion,
          `${label}.vaultItemVersion`,
          1,
        ),
        documentSha256: sha256(body.documentSha256, `${label}.documentSha256`),
        authorityName: text(body.authorityName, `${label}.authorityName`, 256),
        officialSourceLocator: text(
          body.officialSourceLocator,
          `${label}.officialSourceLocator`,
          2_048,
        ),
        checkedAt: isoInstant(body.checkedAt, `${label}.checkedAt`),
        checkedByUserId: identifier(
          body.checkedByUserId,
          `${label}.checkedByUserId`,
        ),
        outcome: choice(
          body.outcome,
          ["verified", "not_verified", "inconclusive"] as const,
          `${label}.outcome`,
        ),
        receiptSha256: sha256(body.receiptSha256, `${label}.receiptSha256`),
      };
    }

    case "mission": {
      const checklist = boundedArray(
        body.checklist,
        `${label}.checklist`,
        100,
      ).map((entry, index) => {
        const itemLabel = `${label}.checklist[${index}]`;
        const item = object(entry, itemLabel);
        identifier(item.id, `${itemLabel}.id`);
        boolean(item.required, `${itemLabel}.required`);
        nullableIdentifier(
          item.completedByUserId,
          `${itemLabel}.completedByUserId`,
        );
        nullableIsoInstant(item.completedAt, `${itemLabel}.completedAt`);
        return {
          id: identifier(item.id, `${itemLabel}.id`),
          label: text(item.label, `${itemLabel}.label`, 256),
        };
      });
      const proofs = boundedArray(body.proofs, `${label}.proofs`, 50).map(
        (entry, index) => {
          const proofLabel = `${label}.proofs[${index}]`;
          const proof = object(entry, proofLabel);
          sha256(proof.sha256, `${proofLabel}.sha256`);
          identifier(proof.recordedByUserId, `${proofLabel}.recordedByUserId`);
          isoInstant(proof.recordedAt, `${proofLabel}.recordedAt`);
          return {
            documentId: identifier(
              proof.documentId,
              `${proofLabel}.documentId`,
            ),
          };
        },
      );
      identifiers(body.followUpWorkItemIds, `${label}.followUpWorkItemIds`, 50);
      const statusReasonHistory = parseStatusReasonHistory(
        body.statusReasonHistory,
        `${label}.statusReasonHistory`,
      );
      return {
        ...base,
        kind,
        missionType: choice(
          body.missionType,
          ["pre_bid", "site_visit"] as const,
          `${label}.missionType`,
        ),
        title: text(body.title, `${label}.title`),
        location: text(body.location, `${label}.location`, 1_024),
        startsAt: isoInstant(body.startsAt, `${label}.startsAt`),
        attendanceRequired: boolean(
          body.attendanceRequired,
          `${label}.attendanceRequired`,
        ),
        delegateUserId: nullableIdentifier(
          body.delegateUserId,
          `${label}.delegateUserId`,
        ),
        delegateAuthorityNote: nullableText(
          body.delegateAuthorityNote,
          `${label}.delegateAuthorityNote`,
          1_024,
        ),
        checklist,
        proofs,
        statusReasonHistory,
        status: choice(
          body.status,
          ["planned", "attended", "missed", "completed", "cancelled"] as const,
          `${label}.status`,
        ),
      };
    }

    case "post_award_item": {
      nullableText(body.description, `${label}.description`);
      nullableIdentifier(body.sourceDocumentId, `${label}.sourceDocumentId`);
      nullableSha256(
        body.completionReceiptSha256,
        `${label}.completionReceiptSha256`,
      );
      nullableIdentifier(body.completedByUserId, `${label}.completedByUserId`);
      nullableIsoInstant(body.completedAt, `${label}.completedAt`);
      const valueMinorUnits =
        body.valueMinorUnits === null
          ? null
          : integer(body.valueMinorUnits, `${label}.valueMinorUnits`);
      const currency = nullableText(body.currency, `${label}.currency`, 3);
      if ((valueMinorUnits === null) !== (currency === null)) {
        invalid(`${label}.recordedAmount`);
      }
      if (currency !== null && !/^[A-Z]{3}$/u.test(currency)) {
        invalid(`${label}.currency`);
      }
      const statusReasonHistory = parseStatusReasonHistory(
        body.statusReasonHistory,
        `${label}.statusReasonHistory`,
      );
      return {
        ...base,
        kind,
        category: choice(
          body.category,
          [
            "obligation",
            "deliverable",
            "variation",
            "payment_milestone",
            "notice",
            "completion_record",
          ] as const,
          `${label}.category`,
        ),
        title: text(body.title, `${label}.title`),
        dueAt: nullableIsoInstant(body.dueAt, `${label}.dueAt`),
        ownerUserId: nullableIdentifier(
          body.ownerUserId,
          `${label}.ownerUserId`,
        ),
        evidenceDocumentIds: identifiers(
          body.evidenceDocumentIds,
          `${label}.evidenceDocumentIds`,
          100,
        ),
        valueMinorUnits,
        currency,
        statusReasonHistory,
        status: choice(
          body.status,
          [
            "open",
            "in_progress",
            "satisfied",
            "disputed",
            "cancelled",
          ] as const,
          `${label}.status`,
        ),
      };
    }
  }
}

interface RawSnapshot {
  organisationId: string;
  projectId: string;
  records: RawRecord[];
  visibleKinds: RecordKind[];
  filtered: boolean;
}

function parseSnapshot(
  value: unknown,
  expectedOrganisationId: string,
  expectedProjectId: string,
): RawSnapshot {
  const body = object(value, "snapshot");
  const organisationId = identifier(
    body.organisationId,
    "snapshot.organisationId",
  );
  const projectId = identifier(body.projectId, "snapshot.projectId");
  if (
    organisationId !== expectedOrganisationId ||
    projectId !== expectedProjectId
  ) {
    invalid("snapshot.scope");
  }
  const records = boundedArray(
    body.records,
    "snapshot.records",
    MAX_RECORDS,
  ).map((record, index) => parseRecord(record, `snapshot.records[${index}]`));
  if (new Set(records.map(({ id }) => id)).size !== records.length) {
    invalid("snapshot.records.id");
  }
  for (const record of records) {
    if (
      record.organisationId !== organisationId ||
      record.projectId !== projectId
    ) {
      invalid(`snapshot.records.${record.id}.scope`);
    }
  }

  const counts = object(body.counts, "snapshot.counts");
  const countKeys = Object.keys(counts).sort();
  if (
    countKeys.length !== RECORD_KINDS.length ||
    !RECORD_KINDS.every((kind) => countKeys.includes(kind))
  ) {
    invalid("snapshot.counts");
  }
  for (const kind of RECORD_KINDS) {
    const count = integer(
      counts[kind],
      `snapshot.counts.${kind}`,
      0,
      MAX_PER_KIND,
    );
    if (count !== records.filter((record) => record.kind === kind).length) {
      invalid(`snapshot.counts.${kind}`);
    }
  }

  const authority = object(body.authority, "snapshot.authority");
  const expectedAuthority = {
    opportunityAcquisition: "record_only",
    clientDelivery: "manual_out_of_band",
    credentialVerification: "human_recorded",
    submission: "record_only",
  } as const;
  if (
    Object.keys(authority).length !== Object.keys(expectedAuthority).length ||
    Object.entries(expectedAuthority).some(
      ([key, expected]) => authority[key] !== expected,
    )
  ) {
    invalid("snapshot.authority");
  }

  const visibility = object(body.visibility, "snapshot.visibility");
  if (
    Object.keys(visibility).length !== 2 ||
    !("visibleKinds" in visibility) ||
    !("filtered" in visibility)
  ) {
    invalid("snapshot.visibility");
  }
  const visibleKinds = boundedArray(
    visibility.visibleKinds,
    "snapshot.visibility.visibleKinds",
    RECORD_KINDS.length,
  ).map((entry, index) =>
    choice(entry, RECORD_KINDS, `snapshot.visibility.visibleKinds[${index}]`),
  );
  if (
    new Set(visibleKinds).size !== visibleKinds.length ||
    records.some((record) => !visibleKinds.includes(record.kind))
  ) {
    invalid("snapshot.visibility.visibleKinds");
  }
  const filtered = boolean(visibility.filtered, "snapshot.visibility.filtered");
  if (filtered !== (visibleKinds.length !== RECORD_KINDS.length)) {
    invalid("snapshot.visibility.filtered");
  }

  return { organisationId, projectId, records, visibleKinds, filtered };
}

export interface OperationsSuiteAdapterContext {
  organisationId: string;
  projectId: string;
  projectTitle: string;
  currentUserId: string;
}

interface OpportunityMutationRecord {
  version: number;
  deadline: string | null;
  deadlineStatus: RawOpportunity["deadlineStatus"];
}

interface WorkMutationRecord {
  version: number;
  status: RawWorkItem["status"];
}

export interface AdaptedOperationsSuitePayload {
  snapshot: OperationsSuiteSnapshot;
  visibleKinds: readonly RecordKind[];
  opportunityMutations: ReadonlyMap<string, OpportunityMutationRecord>;
  workMutations: ReadonlyMap<string, WorkMutationRecord>;
  recorderRecords: OperationsRecorderRecords;
}

function qaChecks(report: RawVisualQa): VisualQaCheck[] {
  const status =
    report.result.status === "review" ? "warning" : report.result.status;
  const summary: VisualQaCheck = {
    id: `${report.id}:summary`,
    label: `Visual QA ${report.result.status}`,
    detail: `Deterministic ${report.result.status} result recorded for package version ${report.packageVersionId}.`,
    status,
  };
  return [
    summary,
    ...report.result.findings.map(
      (finding, index): VisualQaCheck => ({
        id: `${report.id}:finding:${index}`,
        label: finding.code.replaceAll("_", " "),
        detail: `${finding.message}${
          finding.pageNumber === null ? "" : ` Page ${finding.pageNumber}.`
        }`,
        status: finding.severity === "blocker" ? "fail" : "warning",
      }),
    ),
  ];
}

function submissionStatus(
  status: RawSubmission["status"],
): SubmissionPackageRecord["status"] {
  return status === "planning" ? "draft" : status;
}

function deliveryMethod(
  value: string | null,
): Pick<SubmissionPackageRecord, "deliveryMethod" | "deliveryMethodLabel"> {
  if (value === null) return { deliveryMethod: "not_recorded" };
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/gu, "_");
  const known = ["portal", "courier", "hand_delivery", "email"] as const;
  const deliveryMethod = known.includes(normalized as (typeof known)[number])
    ? (normalized as (typeof known)[number])
    : "other";
  return { deliveryMethod, deliveryMethodLabel: value };
}

function amountLabel(
  value: number | null,
  currency: string | null,
): string | null {
  if (value === null || currency === null) return null;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
    }).format(value / 100);
  } catch {
    return `${currency} ${value.toLocaleString("en-NG")} minor units`;
  }
}

function dueLabel(value: string | null, referenceTime: number): string {
  if (!value) return "No due date";
  const due = new Date(value);
  const reference = new Date(referenceTime);
  const dueDate = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
  );
  const referenceDate = Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  );
  if (dueDate < referenceDate) return "Overdue";
  if (dueDate === referenceDate) return "Today";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(due);
}

function applicableStatusReason(
  history: readonly RawStatusReason[],
  currentStatus: string,
  reasonRequiredStatuses: readonly string[],
): string | null {
  if (!reasonRequiredStatuses.includes(currentStatus)) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry.toStatus === currentStatus) {
      return `${entry.reason} Recorded ${entry.recordedAt} by user ID ${entry.recordedByUserId}.`;
    }
  }
  return null;
}

const MOBILE_QUEUE_KINDS = [
  "work_item",
  "evidence_request",
  "submission_war_room",
  "mission",
] as const;

const MOBILE_QUEUE_ACTIONS = [
  "continue_work",
  "review_evidence_response",
  "record_submission_receipt",
  "prepare_mission",
] as const;

export function adaptOperationsMobileQueuePayload(
  value: unknown,
  projectId: string,
): MobileReviewItem[] {
  const renderedAt = Date.now();
  const body = object(value, "mobileQueue");
  const topLevelKeys = Object.keys(body).sort();
  if (
    topLevelKeys.length !== 3 ||
    !["items", "maxItems", "restrictedContent"].every((key) =>
      topLevelKeys.includes(key),
    ) ||
    boolean(body.restrictedContent, "mobileQueue.restrictedContent") !== true ||
    integer(body.maxItems, "mobileQueue.maxItems", 250, 250) !== 250
  ) {
    invalid("mobileQueue");
  }

  const expectedAction = {
    work_item: "continue_work",
    evidence_request: "review_evidence_response",
    submission_war_room: "record_submission_receipt",
    mission: "prepare_mission",
  } as const;
  const projectHref = `/pursuit-operations?project=${encodeURIComponent(projectId)}`;
  const mapped = boundedArray(body.items, "mobileQueue.items", 250).map(
    (entry, index): MobileReviewItem => {
      const label = `mobileQueue.items[${index}]`;
      const item = object(entry, label);
      const itemKeys = Object.keys(item).sort();
      if (
        itemKeys.length !== 10 ||
        ![
          "action",
          "dueAt",
          "id",
          "kind",
          "label",
          "priority",
          "recordId",
          "restrictedContent",
          "status",
          "subresourceId",
        ].every((key) => itemKeys.includes(key)) ||
        boolean(item.restrictedContent, `${label}.restrictedContent`) !== true
      ) {
        invalid(label);
      }
      const id = text(item.id, `${label}.id`, 257);
      const recordId = identifier(item.recordId, `${label}.recordId`);
      const subresourceId = nullableIdentifier(
        item.subresourceId,
        `${label}.subresourceId`,
      );
      const kind = choice(item.kind, MOBILE_QUEUE_KINDS, `${label}.kind`);
      const action = choice(
        item.action,
        MOBILE_QUEUE_ACTIONS,
        `${label}.action`,
      );
      if (action !== expectedAction[kind]) invalid(`${label}.action`);
      if (
        (kind === "evidence_request" && subresourceId === null) ||
        (kind !== "evidence_request" && subresourceId !== null) ||
        (kind === "evidence_request" &&
          id !== `${recordId}:${subresourceId}`) ||
        (kind !== "evidence_request" && id !== recordId)
      ) {
        invalid(`${label}.identity`);
      }

      const priority =
        item.priority === null
          ? null
          : choice(
              item.priority,
              ["low", "normal", "high", "critical"] as const,
              `${label}.priority`,
            );
      if (
        (kind === "work_item" && priority === null) ||
        (kind !== "work_item" && priority !== null)
      ) {
        invalid(`${label}.priority`);
      }

      const status = text(item.status, `${label}.status`, 64);
      const validStatus =
        (kind === "work_item" &&
          ["backlog", "ready", "in_progress", "blocked", "in_review"].includes(
            status,
          )) ||
        (kind === "evidence_request" &&
          ["awaiting_decision", "rejected"].includes(status)) ||
        (kind === "submission_war_room" && status === "dispatched") ||
        (kind === "mission" && ["planned", "attended"].includes(status));
      if (!validStatus) invalid(`${label}.status`);

      const dueAt = nullableIsoInstant(item.dueAt, `${label}.dueAt`);
      const kindMap = {
        work_item: "work",
        evidence_request: "evidence",
        submission_war_room: "receipt",
        mission: "event",
      } as const;
      const prefix = kindMap[kind];
      return {
        id: `${prefix}:${id}`,
        title: text(item.label, `${label}.label`),
        kind: prefix,
        statusLabel: `${priority ? `${priority} priority · ` : ""}${status.replaceAll("_", " ")}`,
        dueLabel: dueLabel(dueAt, renderedAt),
        restrictedContent: true,
        href: projectHref,
      };
    },
  );
  return new Set(mapped.map(({ id }) => id)).size === mapped.length
    ? mapped
    : invalid("mobileQueue.items.id");
}

export interface AdaptedPackageVersionList {
  items: PackageVersionOption[];
  truncated: boolean;
}

export function adaptPackageVersionListPayload(
  value: unknown,
): AdaptedPackageVersionList {
  const body = object(value, "packageVersions");
  if (
    Object.keys(body).length !== 3 ||
    !("items" in body) ||
    !("limit" in body) ||
    !("truncated" in body) ||
    integer(body.limit, "packageVersions.limit", 100, 100) !== 100
  ) {
    invalid("packageVersions");
  }
  const items = boundedArray(body.items, "packageVersions.items", 100).map(
    (entry, index): PackageVersionOption => {
      const label = `packageVersions.items[${index}]`;
      const item = object(entry, label);
      if (
        Object.keys(item).length !== 7 ||
        ![
          "createdAt",
          "manifestSha256",
          "packageId",
          "packageType",
          "packageVersionId",
          "renderQaStatus",
          "versionNumber",
        ].every((key) => key in item) ||
        item.packageType !== "project_export"
      ) {
        invalid(label);
      }
      return {
        packageId: uuid(item.packageId, `${label}.packageId`),
        packageVersionId: uuid(
          item.packageVersionId,
          `${label}.packageVersionId`,
        ),
        versionNumber: integer(item.versionNumber, `${label}.versionNumber`, 1),
        manifestSha256: sha256(item.manifestSha256, `${label}.manifestSha256`),
        renderQaStatus: choice(
          item.renderQaStatus,
          ["pending", "passed", "failed"] as const,
          `${label}.renderQaStatus`,
        ),
        createdAt: isoInstant(item.createdAt, `${label}.createdAt`),
      };
    },
  );
  if (
    new Set(items.map(({ packageVersionId }) => packageVersionId)).size !==
    items.length
  ) {
    invalid("packageVersions.items.packageVersionId");
  }
  return {
    items,
    truncated: boolean(body.truncated, "packageVersions.truncated"),
  };
}

export function adaptProjectDocumentOptions(
  value: unknown,
  projectId: string,
): CanonicalDocumentOption[] {
  const rows = boundedArray(value, "documents", 1_000);
  const identifiersSeen = new Set<string>();
  const documents = rows.flatMap((entry, index): CanonicalDocumentOption[] => {
    const label = `documents[${index}]`;
    const item = object(entry, label);
    const id = identifier(item.id, `${label}.id`);
    if (identifiersSeen.has(id)) invalid(`${label}.id`);
    identifiersSeen.add(id);
    if (identifier(item.projectId, `${label}.projectId`) !== projectId) {
      invalid(`${label}.projectId`);
    }
    const filename = text(item.filename, `${label}.filename`, 512);
    const contentType = nullableText(
      item.contentType,
      `${label}.contentType`,
      256,
    );
    const documentSha256 = nullableSha256(item.sha256, `${label}.sha256`);
    const extractionStatus = nullableText(
      item.extractionStatus,
      `${label}.extractionStatus`,
      64,
    );
    const redactionStatus = text(
      item.redactionStatus,
      `${label}.redactionStatus`,
      64,
    );
    if (!documentSha256 || extractionStatus === "quarantined") return [];
    return [
      {
        id,
        filename,
        sha256: documentSha256,
        contentType: contentType ?? "content type not recorded",
        status: `extraction ${extractionStatus ?? "pending"}; redaction ${redactionStatus}`,
      },
    ];
  });
  return documents;
}

export function adaptVaultItemOptions(
  value: unknown,
  clientId: string,
  documents: readonly CanonicalDocumentOption[],
): VaultItemOption[] {
  const rows = boundedArray(value, "vaultItems", 1_000);
  const identifiersSeen = new Set<string>();
  return rows.flatMap((entry, index): VaultItemOption[] => {
    const label = `vaultItems[${index}]`;
    const item = object(entry, label);
    const id = identifier(item.id, `${label}.id`);
    if (identifiersSeen.has(id)) invalid(`${label}.id`);
    identifiersSeen.add(id);
    if (identifier(item.clientId, `${label}.clientId`) !== clientId) {
      invalid(`${label}.clientId`);
    }
    const artefactType = text(item.artefactType, `${label}.artefactType`, 256);
    const issuer = nullableText(item.issuer, `${label}.issuer`, 256);
    const status = text(item.status, `${label}.status`, 64);
    const version = integer(item.version, `${label}.version`, 1);
    const documentSha256 = nullableSha256(item.sha256, `${label}.sha256`);
    const sourceDocumentId = nullableIdentifier(
      item.sourceDocumentId,
      `${label}.sourceDocumentId`,
    );
    if (
      status !== "active" ||
      !documentSha256 ||
      !sourceDocumentId ||
      !documents.some(
        (document) =>
          document.id === sourceDocumentId &&
          document.sha256 === documentSha256,
      )
    ) {
      return [];
    }
    return [
      {
        id,
        label: issuer ? `${artefactType} — ${issuer}` : artefactType,
        version,
        documentSha256,
        status,
      },
    ];
  });
}

export function adaptOperationsSuitePayload(
  value: unknown,
  context: OperationsSuiteAdapterContext,
): AdaptedOperationsSuitePayload {
  const renderedAt = Date.now();
  const raw = parseSnapshot(value, context.organisationId, context.projectId);
  const opportunities = raw.records.filter(
    (record): record is RawOpportunity => record.kind === "opportunity_intake",
  );
  const workItems = raw.records.filter(
    (record): record is RawWorkItem => record.kind === "work_item",
  );
  const evidenceRequests = raw.records.filter(
    (record): record is RawEvidenceRequest =>
      record.kind === "evidence_request",
  );
  const submissions = raw.records.filter(
    (record): record is RawSubmission => record.kind === "submission_war_room",
  );
  const visualReports = raw.records.filter(
    (record): record is RawVisualQa => record.kind === "visual_qa_report",
  );
  const credentials = raw.records.filter(
    (record): record is RawCredential =>
      record.kind === "credential_verification",
  );
  const missions = raw.records.filter(
    (record): record is RawMission => record.kind === "mission",
  );
  const postAward = raw.records.filter(
    (record): record is RawPostAward => record.kind === "post_award_item",
  );
  const projectHref = `/projects/${encodeURIComponent(context.projectId)}`;
  const visualByPackageVersion = new Map<string, RawVisualQa[]>();
  for (const report of visualReports) {
    const current = visualByPackageVersion.get(report.packageVersionId) ?? [];
    current.push(report);
    visualByPackageVersion.set(report.packageVersionId, current);
  }
  for (const reports of visualByPackageVersion.values()) {
    reports.sort(
      (left, right) =>
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.id.localeCompare(right.id),
    );
  }

  const mappedSubmissions: SubmissionPackageRecord[] = submissions.map(
    (record) => {
      const packageReports =
        visualByPackageVersion.get(record.packageVersionId) ?? [];
      const latestMatchingReport = packageReports
        .filter(
          ({ manifestSha256 }) => manifestSha256 === record.manifestSha256,
        )
        .at(-1);
      const currentQaChecks = latestMatchingReport
        ? qaChecks(latestMatchingReport)
        : packageReports.length > 0
          ? [
              {
                id: `${record.id}:qa-not-current`,
                label: "Visual QA is not current",
                detail:
                  "Recorded visual-QA reports do not match this package manifest. Render and inspect the current package before relying on QA.",
                status: "warning" as const,
              },
            ]
          : [];
      return {
        id: record.id,
        name: `Submission custody record ${record.packageId}`,
        version: record.packageVersionId,
        sha256: record.manifestSha256,
        status: submissionStatus(record.status),
        copyCount: record.copyCount,
        ...deliveryMethod(record.dispatchMethod),
        qaChecks: currentQaChecks,
        receiptHash: record.receiptSha256,
        statusReason: applicableStatusReason(
          record.statusReasonHistory,
          record.status,
          ["cancelled"],
        ),
        previewHref: projectHref,
      };
    },
  );
  const joinedPackageVersions = new Set(
    submissions.map(({ packageVersionId }) => packageVersionId),
  );
  for (const report of visualReports) {
    if (joinedPackageVersions.has(report.packageVersionId)) continue;
    mappedSubmissions.push({
      id: report.id,
      name: "Standalone visual QA record",
      version: report.packageVersionId,
      sha256: report.manifestSha256,
      status: "qa_only",
      copyCount: 0,
      deliveryMethod: "not_recorded",
      qaChecks: qaChecks(report),
      receiptHash: null,
      previewHref: projectHref,
    });
  }

  const mappedEvidence: ClientEvidenceRequest[] = evidenceRequests.map(
    (record) => {
      const rejected = record.slots.some(
        ({ acceptance }) => acceptance?.decision === "rejected",
      );
      const overdue =
        record.dueAt !== null &&
        Date.parse(record.dueAt) < renderedAt &&
        ["draft", "shared_manually"].includes(record.status);
      const status: ClientEvidenceRequest["status"] = overdue
        ? "overdue"
        : record.status === "response_recorded" && rejected
          ? "changes_requested"
          : record.status;
      return {
        id: record.id,
        title: record.slots[0]?.label ?? "Evidence request",
        recipientName: record.recipientLabel,
        status,
        dueAt: record.dueAt,
        attestationRequired: record.slots.length > 0,
        uploadCount: record.slots.filter(({ response }) => response !== null)
          .length,
        priorRejectedResponseCount: record.slots.reduce(
          (total, slot) => total + slot.priorResponseCount,
          0,
        ),
        acceptedByName: record.slots.some(
          ({ acceptance }) => acceptance?.decision === "accepted",
        )
          ? "Recorded reviewer"
          : null,
        href: projectHref,
      };
    },
  );

  const mappedWork: PursuitWorkItem[] = workItems.map((record) => ({
    id: record.id,
    title: record.title,
    pursuitName: context.projectTitle,
    ownerName: record.ownerUserId ? "Assigned user" : null,
    assignedToCurrentUser: record.ownerUserId === context.currentUserId,
    status: record.status,
    dueAt: record.dueAt,
    dependencyCount: record.dependsOnIds.length,
    linkedRequirementCount: record.links.requirementIds.length,
    evidenceCount: record.links.evidenceItemIds.length,
    statusReason: applicableStatusReason(
      record.statusReasonHistory,
      record.status,
      ["cancelled"],
    ),
    href: projectHref,
  }));

  const mappedMissions: PursuitMissionEvent[] = missions.map((record) => ({
    id: record.id,
    title: record.title,
    type: record.missionType,
    status: record.status,
    required: record.attendanceRequired,
    startsAt: record.startsAt,
    location: record.location,
    delegateName: record.delegateUserId ? "Assigned user" : null,
    authorityConfirmed: Boolean(record.delegateAuthorityNote),
    proofStatus: record.proofs.length > 0 ? "recorded" : "missing",
    checklist: record.checklist.map(({ label }) => label),
    statusReason: applicableStatusReason(
      record.statusReasonHistory,
      record.status,
      ["missed", "cancelled"],
    ),
    href: projectHref,
  }));

  const mappedCredentials: CredentialCheckRecord[] = credentials.map(
    (record) => ({
      id: record.id,
      credentialName: "Vault credential record",
      issuerName: record.authorityName,
      reference: record.vaultItemId,
      vaultItemVersion: record.vaultItemVersion,
      documentHash: record.documentSha256,
      status: record.outcome,
      officialUrl: record.officialSourceLocator,
      checkedAt: record.checkedAt,
      checkedByName: "Recorded user",
      receiptHash: record.receiptSha256,
    }),
  );

  const mappedPostAward: PostAwardObligation[] = postAward.map((record) => ({
    id: record.id,
    title: record.title,
    contractName: context.projectTitle,
    category: record.category,
    ownerName: record.ownerUserId ? "Assigned user" : null,
    dueAt: record.dueAt,
    status: record.status,
    evidenceCount: record.evidenceDocumentIds.length,
    amountLabel: amountLabel(record.valueMinorUnits, record.currency),
    statusReason: applicableStatusReason(
      record.statusReasonHistory,
      record.status,
      ["disputed", "cancelled"],
    ),
    href: projectHref,
  }));

  const mobileReviewItems: MobileReviewItem[] = [
    ...workItems
      .filter(
        (record) =>
          record.ownerUserId === context.currentUserId &&
          !["done", "cancelled"].includes(record.status),
      )
      .map(
        (record): MobileReviewItem => ({
          id: `work:${record.id}`,
          title: record.title,
          kind: "work",
          statusLabel: record.status.replaceAll("_", " "),
          dueLabel: dueLabel(record.dueAt, renderedAt),
          restrictedContent: true,
          href: projectHref,
        }),
      ),
    ...evidenceRequests.flatMap((record) =>
      record.slots.flatMap((slot): MobileReviewItem[] =>
        slot.response && slot.acceptance?.decision !== "accepted"
          ? [
              {
                id: `evidence:${record.id}:${slot.id}`,
                title: slot.label,
                kind: "evidence",
                statusLabel:
                  slot.acceptance?.decision === "rejected"
                    ? "changes requested"
                    : "response awaiting review",
                dueLabel: dueLabel(record.dueAt, renderedAt),
                restrictedContent: true,
                href: projectHref,
              },
            ]
          : [],
      ),
    ),
    ...submissions
      .filter(
        (record) =>
          record.status === "dispatched" && record.receiptSha256 === null,
      )
      .map(
        (record): MobileReviewItem => ({
          id: `receipt:${record.id}`,
          title: `Record receipt for ${record.packageId}`,
          kind: "receipt",
          statusLabel: "dispatch recorded; receipt missing",
          dueLabel: "No due date",
          restrictedContent: true,
          href: projectHref,
        }),
      ),
    ...missions
      .filter((record) => ["planned", "attended"].includes(record.status))
      .map(
        (record): MobileReviewItem => ({
          id: `event:${record.id}`,
          title: record.title,
          kind: "event",
          statusLabel: record.status,
          dueLabel: dueLabel(record.startsAt, renderedAt),
          restrictedContent: true,
          href: projectHref,
        }),
      ),
  ];

  return {
    snapshot: {
      generatedAt: null,
      opportunities: opportunities.map((record) => ({
        id: record.id,
        title: record.title,
        buyer: record.issuer,
        reference: record.reference ?? "Not recorded",
        sourceType: record.source.type,
        sourceLabel: `Source received ${record.source.receivedAt}`,
        sourceUrl:
          record.source.type === "manual_url" ? record.source.locator : null,
        deadline: record.deadline,
        provenance: `Provenance SHA-256 ${record.provenanceSha256}`,
        status:
          record.status === "qualified"
            ? "qualified"
            : record.status === "not_pursued"
              ? "not_pursued"
              : record.deadlineStatus === "human_confirmed"
                ? "confirmed"
                : record.deadline
                  ? "needs_confirmation"
                  : "deadline_missing",
        confirmedByName: record.deadlineConfirmedByUserId
          ? "Recorded user"
          : null,
      })),
      workItems: mappedWork,
      evidenceRequests: mappedEvidence,
      submissionPackages: mappedSubmissions,
      credentialChecks: mappedCredentials,
      missionEvents: mappedMissions,
      obligations: mappedPostAward,
      mobileReviewItems,
    },
    visibleKinds: raw.visibleKinds,
    opportunityMutations: new Map(
      opportunities.map((record) => [
        record.id,
        {
          version: record.version,
          deadline: record.deadline,
          deadlineStatus: record.deadlineStatus,
        },
      ]),
    ),
    workMutations: new Map(
      workItems.map((record) => [
        record.id,
        { version: record.version, status: record.status },
      ]),
    ),
    recorderRecords: {
      workItems: workItems.map((record) => ({
        id: record.id,
        label: record.title,
        version: record.version,
        status: record.status,
        approvalStatus: record.approvalStatus,
      })),
      evidenceRequests: evidenceRequests.map((record) => ({
        id: record.id,
        label: record.recipientLabel,
        version: record.version,
        status: record.status,
        slots: record.slots.map((slot) => ({
          id: slot.id,
          label: slot.label,
          hasResponse: slot.response !== null,
          acceptanceDecision: slot.acceptance?.decision ?? null,
          priorResponseCount: slot.priorResponseCount,
          acceptedContentTypes: slot.acceptedContentTypes,
        })),
      })),
      submissions: submissions.map((record) => ({
        id: record.id,
        label: record.packageId,
        version: record.version,
        status: record.status,
      })),
      missions: missions.map((record) => ({
        id: record.id,
        label: record.title,
        version: record.version,
        status: record.status,
        checklist: record.checklist,
      })),
      postAwardItems: postAward.map((record) => ({
        id: record.id,
        label: record.title,
        version: record.version,
        status: record.status,
        evidenceDocumentIds: record.evidenceDocumentIds,
      })),
      packageVersions: [],
      documents: [],
      vaultItems: [],
    },
  };
}

const WORK_TRANSITIONS: Readonly<
  Record<RawWorkItem["status"], readonly RawWorkItem["status"][]>
> = {
  backlog: ["ready"],
  ready: ["in_progress", "blocked"],
  in_progress: ["blocked", "in_review", "done"],
  blocked: ["ready", "in_progress"],
  in_review: ["in_progress", "blocked", "done"],
  done: [],
  cancelled: [],
};

function commandPermission(command: OperationsRecorderCommand): string {
  if (command.path.includes("/approval")) return "project:assign";
  if (command.path.startsWith("/operations-suite/evidence-requests")) {
    return command.path.includes("/decisions")
      ? "evidence:approve"
      : "evidence:write";
  }
  if (command.path.startsWith("/operations-suite/credential-verifications")) {
    return "evidence:approve";
  }
  if (command.path.startsWith("/operations-suite/submission-war-rooms")) {
    return "package:export";
  }
  if (command.path.startsWith("/operations-suite/visual-qa-reports")) {
    return "package:generate";
  }
  return "project:update";
}

export default function PursuitOperationsSuiteRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const compactMode = searchParams.get("view") === "mobile";
  const online = useOnlineStatus();
  const { toast } = useToast();
  const organisationAccess = useOrganisationAccess();
  const meQuery = useGetMe();
  const organisationId = organisationAccess?.activeOrganisation?.id ?? "";
  const actorUserId = meQuery.data?.id ?? "";
  const effectivePermissions = organisationAccess?.effectivePermissions ?? [];
  const capabilityKey = operationsCapabilityFingerprint(effectivePermissions);
  const hasProjectRead = effectivePermissions.includes("project:read");
  const activeActorContext = useRef({
    organisationId,
    actorUserId,
    capabilityKey,
  });
  activeActorContext.current = {
    organisationId,
    actorUserId,
    capabilityKey,
  };
  const projectsQuery = useListProjects(undefined, {
    query: {
      queryKey: [
        ...getListProjectsQueryKey(),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      enabled: Boolean(organisationId && actorUserId && hasProjectRead),
      select: (availableProjects) => {
        if (
          activeActorContext.current.organisationId !== organisationId ||
          activeActorContext.current.actorUserId !== actorUserId ||
          activeActorContext.current.capabilityKey !== capabilityKey
        ) {
          throw new Error("Operations authority changed while pursuits loaded");
        }
        return availableProjects;
      },
    },
  });
  const projects = projectsQuery.data ?? [];
  const requestedProjectId = searchParams.get("project");
  const selectedProject =
    projects.find(({ id }) => id === requestedProjectId) ?? projects[0];
  const projectId = selectedProject?.id ?? "";
  const clientId = selectedProject?.clientId ?? "";
  const canRead = Boolean(organisationId && actorUserId && hasProjectRead);
  const canMutate = Boolean(
    canRead && effectivePermissions.includes("project:update"),
  );
  const canReadEvidence = effectivePermissions.includes("evidence:read");
  const canReadDocuments = effectivePermissions.includes("document:read");
  const canReadPackages = effectivePermissions.includes("package:read");
  const canExportPackages = effectivePermissions.includes("package:export");
  const canGeneratePackages = effectivePermissions.includes("package:generate");
  const canLoadPackageVersions = Boolean(
    !compactMode &&
    canReadPackages &&
    (canExportPackages || canGeneratePackages) &&
    projectId,
  );
  const recorderPermissions = {
    projectUpdate: effectivePermissions.includes("project:update"),
    projectAssign: effectivePermissions.includes("project:assign"),
    evidenceWrite:
      canReadEvidence && effectivePermissions.includes("evidence:write"),
    evidenceApprove:
      canReadEvidence && effectivePermissions.includes("evidence:approve"),
    packageExport: canReadPackages && canExportPackages,
    packageGenerate: canReadPackages && canGeneratePackages,
  };
  const canRecordAnyOperation =
    Object.values(recorderPermissions).some(Boolean);
  const canLoadDocumentReferences = Boolean(
    !compactMode &&
    canReadDocuments &&
    projectId &&
    (recorderPermissions.projectUpdate ||
      recorderPermissions.evidenceWrite ||
      recorderPermissions.evidenceApprove),
  );
  const activeReadScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  });
  activeReadScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  };
  const readScopeIsCurrent = (requested: typeof activeReadScope.current) =>
    activeReadScope.current.organisationId === requested.organisationId &&
    activeReadScope.current.projectId === requested.projectId &&
    activeReadScope.current.actorUserId === requested.actorUserId &&
    activeReadScope.current.capabilityKey === requested.capabilityKey;

  const suiteQuery = useQuery({
    queryKey: [
      "operations-suite",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    ],
    enabled: Boolean(!compactMode && canRead && projectId && actorUserId),
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite`,
        { responseType: "json", cache: "no-store" },
      );
      const result = adaptOperationsSuitePayload(payload, {
        organisationId,
        projectId,
        projectTitle: selectedProject?.tenderTitle ?? "Selected pursuit",
        currentUserId: actorUserId,
      });
      if (!readScopeIsCurrent(requestedScope)) {
        throw new Error("Operations authority changed while records loaded");
      }
      return result;
    },
  });
  const mobileQueueQuery = useQuery({
    queryKey: [
      "operations-suite-mobile-queue",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    ],
    enabled: Boolean(compactMode && canRead && projectId && actorUserId),
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite/mobile-queue`,
        { responseType: "json", cache: "no-store" },
      );
      const result = adaptOperationsMobileQueuePayload(payload, projectId);
      if (!readScopeIsCurrent(requestedScope)) {
        throw new Error("Operations authority changed while queue loaded");
      }
      return result;
    },
  });
  const packageVersionQuery = useQuery({
    queryKey: [
      "project-export-package-versions",
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    ],
    enabled: canLoadPackageVersions,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const requestedScope = {
        organisationId,
        projectId,
        actorUserId,
        capabilityKey,
      };
      const payload = await customFetch<unknown>(
        `/api/projects/${encodeURIComponent(projectId)}/package-versions`,
        { responseType: "json", cache: "no-store" },
      );
      const result = adaptPackageVersionListPayload(payload);
      if (!readScopeIsCurrent(requestedScope)) {
        throw new Error("Operations authority changed while packages loaded");
      }
      return result;
    },
  });
  const documentsQuery = useListDocuments<CanonicalDocumentOption[]>(
    projectId,
    {
      query: {
        queryKey: [
          ...getListDocumentsQueryKey(projectId),
          organisationId,
          actorUserId,
          capabilityKey,
        ],
        enabled: canLoadDocumentReferences,
        staleTime: 0,
        gcTime: 0,
        select: (documents) => {
          if (
            !readScopeIsCurrent({
              organisationId,
              projectId,
              actorUserId,
              capabilityKey,
            })
          ) {
            throw new Error(
              "Operations authority changed while documents loaded",
            );
          }
          return adaptProjectDocumentOptions(documents, projectId);
        },
      },
      request: { cache: "no-store" },
    },
  );
  const canLoadVaultItems = Boolean(
    !compactMode &&
    canReadEvidence &&
    recorderPermissions.evidenceApprove &&
    clientId &&
    documentsQuery.isSuccess,
  );
  const vaultItemsQuery = useListVaultItems<VaultItemOption[]>(clientId, {
    query: {
      queryKey: [
        ...getListVaultItemsQueryKey(clientId),
        organisationId,
        actorUserId,
        capabilityKey,
      ],
      enabled: canLoadVaultItems,
      staleTime: 0,
      gcTime: 0,
      select: (vaultItems) => {
        if (
          !readScopeIsCurrent({
            organisationId,
            projectId,
            actorUserId,
            capabilityKey,
          })
        ) {
          throw new Error("Operations authority changed while Vault loaded");
        }
        return adaptVaultItemOptions(
          vaultItems,
          clientId,
          documentsQuery.data ?? [],
        );
      },
    },
    request: { cache: "no-store" },
  });
  const activeMutationScope = useRef({
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  });
  activeMutationScope.current = {
    organisationId,
    projectId,
    actorUserId,
    capabilityKey,
  };
  const executeScopedCommand = async (
    path: string,
    options: Parameters<typeof customFetch>[1],
  ) => {
    const requestedScope = {
      organisationId,
      projectId,
      actorUserId,
      capabilityKey,
    };
    const releaseCriticalWorkflow = organisationAccess?.beginCriticalWorkflow();
    try {
      const result = await customFetch(path, options);
      if (
        activeMutationScope.current.organisationId !==
          requestedScope.organisationId ||
        activeMutationScope.current.projectId !== requestedScope.projectId ||
        activeMutationScope.current.actorUserId !==
          requestedScope.actorUserId ||
        activeMutationScope.current.capabilityKey !==
          requestedScope.capabilityKey
      ) {
        throw new Error("Pursuit changed while the operation was recorded");
      }
      return result;
    } finally {
      releaseCriticalWorkflow?.();
    }
  };

  const refreshAfterMutation = (title: string) => {
    toast({ title });
    void suiteQuery.refetch();
    if (canLoadPackageVersions) void packageVersionQuery.refetch();
    if (canLoadDocumentReferences) void documentsQuery.refetch();
    if (canLoadVaultItems) void vaultItemsQuery.refetch();
  };
  const mutationFailure = (title: string) => {
    toast({
      variant: "destructive",
      title,
      description:
        "Refresh the selected pursuit before trying again. No external action was taken.",
    });
    void suiteQuery.refetch();
    if (canLoadPackageVersions) void packageVersionQuery.refetch();
    if (canLoadDocumentReferences) void documentsQuery.refetch();
    if (canLoadVaultItems) void vaultItemsQuery.refetch();
  };
  const deadlineMutation = useMutation({
    mutationFn: ({
      recordId,
      expectedVersion,
      deadline,
    }: {
      recordId: string;
      expectedVersion: number;
      deadline: string;
    }) =>
      executeScopedCommand(
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite/opportunities/${encodeURIComponent(recordId)}/confirm-deadline`,
        {
          method: "POST",
          body: JSON.stringify({ expectedVersion, deadline }),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onSuccess: () => refreshAfterMutation("Deadline confirmation recorded"),
    onError: () => mutationFailure("Deadline confirmation was not recorded"),
  });
  const workMutation = useMutation({
    mutationFn: ({
      recordId,
      expectedVersion,
      status,
    }: {
      recordId: string;
      expectedVersion: number;
      status: WorkItemStatus;
    }) =>
      executeScopedCommand(
        `/api/projects/${encodeURIComponent(projectId)}/operations-suite/work-items/${encodeURIComponent(recordId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion, status }),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onSuccess: () => refreshAfterMutation("Work status recorded"),
    onError: () => mutationFailure("Work status was not recorded"),
  });
  const recorderMutation = useMutation({
    mutationFn: (command: OperationsRecorderCommand) =>
      executeScopedCommand(
        `/api/projects/${encodeURIComponent(projectId)}${command.path}`,
        {
          method: command.method,
          body: JSON.stringify(command.body),
          responseType: "json",
          cache: "no-store",
        },
      ),
    onSuccess: (_result, command) => refreshAfterMutation(command.successTitle),
    onError: () => mutationFailure("The operations command was not recorded"),
  });
  const operationPending =
    recorderMutation.isPending ||
    deadlineMutation.isPending ||
    workMutation.isPending;

  if (!canRead) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="blocked"
          title="Pursuit read access required"
          description="The selected organisation context does not grant access to tenant-scoped pursuit records. No operations data was requested."
        />
      </div>
    );
  }

  if (projectsQuery.isLoading || meQuery.isLoading) {
    return <PursuitOperationsSuite loadState={{ status: "loading" }} />;
  }

  if (projectsQuery.isError || meQuery.isError || !meQuery.data) {
    return (
      <PursuitOperationsSuite
        loadState={{
          status: "error",
          message: "The authorised project list could not be loaded.",
          retry: () => {
            void projectsQuery.refetch();
            void meQuery.refetch();
          },
        }}
      />
    );
  }

  if (!selectedProject) {
    return (
      <div className="p-5 sm:p-8">
        <StatusPanel
          state="empty"
          title="No authorised pursuits are available"
          description="No server-authorised project was returned for this organisation. This does not establish that the organisation has no pursuits."
        />
      </div>
    );
  }

  const projectSelector = (
    <section
      aria-labelledby="operations-project-heading"
      className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-8 sm:pt-8"
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="operations-project-heading" className="text-sm font-semibold">
            Active pursuit
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Records and requests remain limited to this selected,
            server-authorised pursuit.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label
            className="grid gap-1.5 text-xs font-medium"
            htmlFor="operations-project"
          >
            Pursuit
            <select
              id="operations-project"
              className="min-h-11 min-w-64 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-control-size="44"
              value={projectId}
              disabled={operationPending}
              onChange={(event) => {
                const nextProjectId = event.currentTarget.value;
                setSearchParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.set("project", nextProjectId);
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.tenderTitle}
                </option>
              ))}
            </select>
          </label>
          <Button
            asChild
            variant="outline"
            className="min-h-11"
            data-control-size="44"
          >
            <Link
              href={`/pursuit-operations?project=${encodeURIComponent(projectId)}${compactMode ? "" : "&view=mobile"}`}
              aria-disabled={operationPending}
              onClick={(event) => {
                if (operationPending) event.preventDefault();
              }}
            >
              {compactMode
                ? "Back to full pursuit operations"
                : "Open low-bandwidth mobile queue"}
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );

  if (compactMode) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-6 pb-8">
        {projectSelector}
        <div className="px-4 sm:px-8">
          <LowBandwidthMobileReviewer
            items={mobileQueueQuery.data ?? []}
            state={
              mobileQueueQuery.isLoading
                ? "loading"
                : mobileQueueQuery.isError
                  ? "error"
                  : "ready"
            }
            error={
              mobileQueueQuery.isError
                ? "The compact authorised queue was unavailable or invalid. No empty queue should be inferred."
                : undefined
            }
            onRetry={() => void mobileQueueQuery.refetch()}
            readOnly
            online={online}
          />
        </div>
      </main>
    );
  }

  const adapter = suiteQuery.data;
  const actions: OperationsSuiteActions =
    canMutate && online
      ? {
          onConfirmOpportunity: (recordId) => {
            const record = adapter?.opportunityMutations.get(recordId);
            if (
              !record ||
              !record.deadline ||
              record.deadlineStatus !== "unconfirmed" ||
              deadlineMutation.isPending
            ) {
              mutationFailure("Current deadline confirmation is unavailable");
              return;
            }
            deadlineMutation.mutate({
              recordId,
              expectedVersion: record.version,
              deadline: record.deadline,
            });
          },
          onChangeWorkStatus: (recordId, status) => {
            const record = adapter?.workMutations.get(recordId);
            if (
              !record ||
              !WORK_TRANSITIONS[record.status].includes(status) ||
              workMutation.isPending
            ) {
              mutationFailure("That work transition is unavailable");
              return;
            }
            workMutation.mutate({
              recordId,
              expectedVersion: record.version,
              status,
            });
          },
        }
      : {};

  const loadState = suiteQuery.isLoading
    ? ({ status: "loading" } as const)
    : suiteQuery.isError || !adapter
      ? ({
          status: "error" as const,
          message:
            "The tenant-scoped operations snapshot was unavailable or invalid.",
          retry: () => void suiteQuery.refetch(),
        } as const)
      : ({ status: "ready" as const, snapshot: adapter.snapshot } as const);

  return (
    <div>
      {projectSelector}
      <PursuitOperationsSuite
        loadState={loadState}
        actions={actions}
        readOnly={!canRecordAnyOperation || !online}
        online={online}
        visibility={{
          opportunities: Boolean(
            adapter?.visibleKinds.includes("opportunity_intake"),
          ),
          work: Boolean(adapter?.visibleKinds.includes("work_item")),
          evidence: Boolean(
            canReadEvidence &&
            adapter?.visibleKinds.includes("evidence_request"),
          ),
          submissions: Boolean(
            canReadPackages &&
            adapter?.visibleKinds.includes("submission_war_room") &&
            adapter.visibleKinds.includes("visual_qa_report"),
          ),
          credentials: Boolean(
            canReadEvidence &&
            adapter?.visibleKinds.includes("credential_verification"),
          ),
          missions: Boolean(adapter?.visibleKinds.includes("mission")),
          postAward: Boolean(adapter?.visibleKinds.includes("post_award_item")),
          mobile: false,
        }}
      />
      {adapter ? (
        <PursuitOperationsSuiteRecorder
          key={`${organisationId}:${projectId}:${actorUserId}:${capabilityKey}`}
          permissions={recorderPermissions}
          currentUserId={meQuery.data?.id}
          records={{
            ...adapter.recorderRecords,
            packageVersions: packageVersionQuery.data?.items ?? [],
            documents: documentsQuery.data ?? [],
            vaultItems: vaultItemsQuery.data ?? [],
          }}
          online={online}
          pending={operationPending}
          packageVersionsState={
            packageVersionQuery.isLoading
              ? "loading"
              : packageVersionQuery.isError
                ? "error"
                : "ready"
          }
          packageVersionsTruncated={
            packageVersionQuery.data?.truncated ?? false
          }
          documentsState={
            !canReadDocuments
              ? "unavailable"
              : documentsQuery.isLoading
                ? "loading"
                : documentsQuery.isError
                  ? "error"
                  : "ready"
          }
          vaultItemsState={
            !canReadEvidence || !canReadDocuments || !clientId
              ? "unavailable"
              : documentsQuery.isLoading || vaultItemsQuery.isLoading
                ? "loading"
                : documentsQuery.isError || vaultItemsQuery.isError
                  ? "error"
                  : "ready"
          }
          onCommand={(command) => {
            const requiredPermission = commandPermission(command);
            if (
              !online ||
              !effectivePermissions.includes(requiredPermission) ||
              recorderMutation.isPending
            ) {
              mutationFailure("This operations command is unavailable");
              return;
            }
            recorderMutation.mutate(command);
          }}
        />
      ) : null}
    </div>
  );
}
