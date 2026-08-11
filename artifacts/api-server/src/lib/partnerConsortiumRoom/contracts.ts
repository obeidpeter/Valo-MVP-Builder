export type ConsortiumParty = "client" | "partner";

export const CONSORTIUM_QA_CODES = [
  "evidence_quality_review",
  "requirement_coverage_review",
  "client_release_readiness",
  "partner_cosign",
] as const;
export type ConsortiumQaCode = (typeof CONSORTIUM_QA_CODES)[number];

export const CONSORTIUM_REASON_CODES = [
  "ownership_mismatch",
  "scope_unclear",
  "deadline_unworkable",
  "quality_control_gap",
  "evidence_not_sufficient",
  "offline_discussion_required",
] as const;
export type ConsortiumReasonCode = (typeof CONSORTIUM_REASON_CODES)[number];

export interface ConsortiumScope {
  organisationId: string;
  projectId: string;
  relationshipId: string;
  actorUserId: string;
  actorMembershipId: string;
  membershipOrganisationId: string;
  accessSource: "membership" | "partner";
  contextPartnerRelationshipId: string | null;
}

export interface ConsortiumParticipantOption {
  userId: string;
  name: string;
  party: ConsortiumParty;
}

export interface ConsortiumParticipantDirectory {
  organisationId: string;
  projectId: string;
  relationshipId: string;
  items: ConsortiumParticipantOption[];
  limit: number;
  truncated: false;
}

export interface ConsortiumAcceptance {
  party: ConsortiumParty;
  decision: "accepted" | "changes_requested";
  reasonCode: ConsortiumReasonCode | null;
  decidedByUserId: string;
  decidedAt: string;
}

export interface ConsortiumResponsibility {
  id: string;
  iteration: number;
  workstreamLabel: string;
  responsibleParty: ConsortiumParty;
  accountableParty: ConsortiumParty;
  ownerUserId: string;
  dueAt: string | null;
  status: "proposed" | "changes_requested" | "active";
  requiredAcceptance: "both_parties";
  acceptances: {
    client: ConsortiumAcceptance | null;
    partner: ConsortiumAcceptance | null;
  };
  createdByUserId: string;
  createdAt: string;
  updatedByUserId: string;
  updatedAt: string;
}

export interface ConsortiumQaDecision {
  decision: "checked" | "rejected";
  reasonCode: ConsortiumReasonCode | null;
  decidedByUserId: string;
  decidedAt: string;
}

export interface ConsortiumQaItem {
  id: string;
  code: ConsortiumQaCode;
  required: boolean;
  preparerParty: ConsortiumParty;
  checkerParty: ConsortiumParty;
  ownerUserId: string;
  status: "open" | "ready_for_check" | "checked";
  evidenceSha256: string | null;
  preparedByUserId: string | null;
  preparedAt: string | null;
  lastDecision: ConsortiumQaDecision | null;
}

export type ConsortiumAuditAction =
  | "room_created"
  | "responsibility_added"
  | "responsibility_revised"
  | "responsibility_decided"
  | "qa_prepared"
  | "qa_decided";

export interface ConsortiumAuditReceipt {
  id: string;
  sequence: number;
  action: ConsortiumAuditAction;
  objectId: string;
  actorUserId: string;
  actorParty: ConsortiumParty;
  priorVersion: number;
  nextVersion: number;
  factsSha256: string;
  previousReceiptSha256: string | null;
  receiptSha256: string;
  occurredAt: string;
}

export interface PartnerConsortiumRoom {
  id: string;
  organisationId: string;
  projectId: string;
  relationshipId: string;
  clientOrganisationId: string;
  partnerOrganisationId: string;
  clientCoordinatorUserId: string;
  partnerCoordinatorUserId: string;
  coSigningRequired: boolean;
  status: "draft" | "active" | "qa_in_progress" | "ready_for_client_release";
  version: number;
  responsibilities: ConsortiumResponsibility[];
  qaChecklist: ConsortiumQaItem[];
  auditReceipts: ConsortiumAuditReceipt[];
  idempotencyDigest: string;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
  retention: {
    namespace: "valo.partner-consortium-room/v1";
    class: "project_coordination";
    owner: "client_organisation";
    trigger: "owning_project_retention_policy";
    independentDeletionAllowed: false;
  };
  authorityBoundaries: {
    legalAgreementGeneration: false;
    revenueSettlement: false;
    messaging: false;
    crossClientLearning: false;
    autonomousExternalAction: false;
  };
}

export interface ConsortiumSnapshot {
  organisationId: string;
  projectId: string;
  relationshipId: string;
  actorParty: ConsortiumParty;
  room: PartnerConsortiumRoom;
  relationship: {
    version: number;
    coSigningRequired: boolean;
    qaResponsibilitySha256: string | null;
  };
}

export const CONSORTIUM_BOUNDS = Object.freeze({
  requestBytes: 65_536,
  envelopeBytes: 1_048_576,
  responsibilities: 40,
  receipts: 500,
  workstreamLabel: 160,
  idempotencyKey: 160,
  maximumDueDays: 366,
  participants: 100,
  participantName: 512,
});
