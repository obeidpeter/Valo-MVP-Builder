export const COMMUNICATION_CHANNELS = ["email", "whatsapp_business"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_TEMPLATE_IDS = [
  "deadline_reminder_v1",
  "evidence_request_ready_v1",
  "evidence_correction_required_v1",
  "package_ready_v1",
] as const;
export type CommunicationTemplateId =
  (typeof COMMUNICATION_TEMPLATE_IDS)[number];

export type CommunicationTemplateContext =
  | { kind: "deadline"; deadlineAt: string }
  | { kind: "evidence_request"; requestId: string; dueAt: string | null }
  | {
      kind: "evidence_correction";
      requestId: string;
      correctionSequence: number;
    }
  | {
      kind: "released_package";
      packageVersionId: string;
      manifestSha256: string;
    };

export type CommunicationEventStatus =
  | "queued"
  | "prepared"
  | "accepted_pending_receipt"
  | "retry_wait"
  | "reconciliation_required"
  | "delivered"
  | "dead_letter";

export type CommunicationAttemptStatus =
  | "prepared"
  | "provider_disconnected"
  | "policy_blocked"
  | "provider_rejected"
  | "outcome_unknown"
  | "accepted_pending_receipt"
  | "receipt_verified_delivered"
  | "receipt_verified_failed";

export interface CommunicationScope {
  organisationId: string;
  projectId: string;
  actorUserId: string;
}

export interface CommunicationAttempt {
  id: string;
  attemptNumber: number;
  provider: string;
  idempotencyKey: string;
  status: CommunicationAttemptStatus;
  providerMessageId: string | null;
  receiptSha256: string | null;
  responseCode: string | null;
  attemptedAt: string;
  nextAttemptAt: string | null;
}

export interface CommunicationEvent {
  id: string;
  organisationId: string;
  projectId: string;
  channel: CommunicationChannel;
  templateId: CommunicationTemplateId;
  recipientUserId: string;
  consentEvidenceSha256: string;
  context: CommunicationTemplateContext;
  status: CommunicationEventStatus;
  requestedByUserId: string;
  requestedAt: string;
  deadlineAt: string;
  maxAttempts: number;
  version: number;
  attempts: CommunicationAttempt[];
  deliveryAuthority: "verified_provider_receipt_only";
  arbitraryBodyAccepted: false;
  rawRecipientPersisted: false;
}

export interface QueueCommunicationInput {
  idempotencyKey: string;
  channel: CommunicationChannel;
  templateId: CommunicationTemplateId;
  recipientUserId: string;
  consentEvidenceSha256: string;
  context: CommunicationTemplateContext;
  deadlineAt: string;
  maxAttempts?: number;
}

export interface CommunicationSnapshot {
  organisationId: string;
  projectId: string;
  events: CommunicationEvent[];
  policy: {
    approvedTemplatesOnly: true;
    arbitraryBodyAccepted: false;
    arbitraryRecipientAccepted: false;
    deliveryRequiresVerifiedProviderReceipt: true;
    autonomousDispatch: false;
    providersConnected: boolean;
  };
}

export interface CommunicationRecipientReference {
  userId: string;
  name: string;
  channel: "email";
  consentEvidenceSha256: string;
}

export interface CommunicationContextReference {
  id: string;
  recipientUserId: string | null;
  label: string;
  templateId: CommunicationTemplateId;
  context: CommunicationTemplateContext;
}

export interface CommunicationReferenceSet {
  organisationId: string;
  projectId: string;
  recipients: CommunicationRecipientReference[];
  contexts: CommunicationContextReference[];
  limit: 100;
  truncated: boolean;
}

export const COMMUNICATION_BOUNDS = Object.freeze({
  requestBytes: 32_768,
  envelopeBytes: 16_384,
  snapshotBytes: 2_000_000,
  eventsPerProject: 250,
  attemptsPerEvent: 5,
  idempotencyKey: 160,
  providerReference: 256,
  receiptReference: 256,
  responseCode: 96,
  maximumDeadlineDays: 30,
  referenceItems: 100,
  referenceLabel: 160,
});
