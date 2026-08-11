export const CLIENT_ACTION_PURPOSES = [
  "tender_evidence",
  "credential_refresh",
  "clarification_support",
  "delivery_evidence",
] as const;

export type ClientActionPurpose = (typeof CLIENT_ACTION_PURPOSES)[number];

export interface ClientActionScope {
  organisationId: string;
  projectId: string;
  actorUserId: string;
}

export interface ClientActionAuthorityOption {
  userId: string;
  name: string;
}

export interface ClientActionAuthorityDirectory {
  organisationId: string;
  projectId: string;
  items: ClientActionAuthorityOption[];
  limit: number;
  truncated: false;
}

export interface ClientActionBase<K extends ClientActionRecordKind> {
  id: string;
  kind: K;
  organisationId: string;
  projectId: string;
  version: number;
  createdByUserId: string;
  createdAt: string;
  updatedByUserId: string;
  updatedAt: string;
}

export interface ClientUploadIntent {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  declaredSha256: string;
  recordedByUserId: string;
  recordedAt: string;
}

export interface ClientAttachedDocument {
  documentId: string;
  sha256: string;
  attachedByUserId: string;
  attachedAt: string;
}

export interface ClientSlotReview {
  decision: "accepted" | "correction_required";
  reason: string;
  reviewedByUserId: string;
  reviewedAt: string;
}

export interface ClientCorrectionAcknowledgement {
  statement: string;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
}

export interface ClientEvidenceAttempt {
  id: string;
  intent: ClientUploadIntent;
  document: ClientAttachedDocument | null;
  review: ClientSlotReview | null;
  correctionAcknowledgement: ClientCorrectionAcknowledgement | null;
}

export interface ClientEvidenceSlot {
  id: string;
  label: string;
  required: boolean;
  acceptedContentTypes: string[];
  attempts: ClientEvidenceAttempt[];
}

export interface ClientRequestAcknowledgement {
  statement: string;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
}

export type ClientEvidenceRequestStatus =
  | "open"
  | "acknowledged"
  | "in_progress"
  | "submitted"
  | "changes_required"
  | "completed";

export interface ClientEvidenceRequestRecord extends ClientActionBase<"evidence_request"> {
  purpose: ClientActionPurpose;
  purposeStatement: string;
  recipientUserId: string;
  dueAt: string | null;
  status: ClientEvidenceRequestStatus;
  requestAcknowledgement: ClientRequestAcknowledgement | null;
  slots: ClientEvidenceSlot[];
  completionReceiptSha256: string | null;
  externalMessageSentByValo: false;
}

export interface PackageDeliveryAcknowledgement {
  statement: string;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
  receiptSha256: string;
}

export interface ClientPackageDeliveryRecord extends ClientActionBase<"package_delivery"> {
  recipientUserId: string;
  packageVersionId: string;
  manifestSha256: string;
  releaseReceiptSha256: string;
  status: "available_for_acknowledgement" | "acknowledged";
  deliveryMode: "metadata_record_only";
  acknowledgement: PackageDeliveryAcknowledgement | null;
  externalDeliveryPerformedByValo: false;
}

export type ClientActionRecordKind = "evidence_request" | "package_delivery";
export type ClientActionRecord =
  | ClientEvidenceRequestRecord
  | ClientPackageDeliveryRecord;

export interface CreateClientEvidenceRequestInput {
  purpose: ClientActionPurpose;
  purposeStatement: string;
  recipientUserId: string;
  dueAt?: string | null;
  slots: Array<{
    label: string;
    required: boolean;
    acceptedContentTypes?: string[];
  }>;
}

export interface ClientActionSnapshot {
  organisationId: string;
  projectId: string;
  records: ClientActionRecord[];
  authority: {
    externalMessaging: false;
    rawUpload: false;
    packageTransfer: false;
    uploadIntentOnly: true;
  };
}

export const CLIENT_ACTION_BOUNDS = Object.freeze({
  recordsPerProject: 200,
  requestBodyBytes: 65_536,
  slotsPerRequest: 20,
  attemptsPerSlot: 10,
  contentTypesPerSlot: 8,
  shortText: 160,
  statement: 1_000,
  filename: 255,
  maximumIntentBytes: 52_428_800,
  envelopeBytes: 1_048_576,
  snapshotBytes: 4_194_304,
  authorities: 100,
  authorityName: 512,
});
