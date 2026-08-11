import type { OrganisationRole } from "../permissions";

export interface OnboardingChecklistItem {
  id: string;
  title: string;
  purpose: string;
  completionEvidence: string;
}

export interface SyntheticTourStep {
  id: string;
  title: string;
  instruction: string;
  syntheticObjectReference: string;
}

export interface OnboardingJourney {
  policyVersion: "2026-08-11.2";
  derivedFromRoles: readonly OrganisationRole[];
  checklist: readonly OnboardingChecklistItem[];
  syntheticTour: {
    dataClassification: "synthetic_non_customer";
    writesAuthoritativeState: false;
    title: string;
    steps: readonly SyntheticTourStep[];
  };
}

export const ONBOARDING_POLICY_VERSION = "2026-08-11.2" as const;

const CHECKLIST: Readonly<Record<string, OnboardingChecklistItem>> = {
  access: {
    id: "confirm-active-workspace",
    title: "Confirm the active workspace",
    purpose:
      "Verify the organisation banner and your effective role before opening pursuit material.",
    completionEvidence:
      "Workspace and role confirmation recorded in the tenant audit trail.",
  },
  boundaries: {
    id: "review-authority-boundaries",
    title: "Review authority boundaries",
    purpose:
      "Understand that findings, drafts and scenarios do not approve evidence or submit a bid.",
    completionEvidence: "Authority notice acknowledged.",
  },
  pursuit: {
    id: "walk-synthetic-pursuit",
    title: "Walk a synthetic pursuit",
    purpose:
      "Learn the end-to-end workspace without exposing or changing client data.",
    completionEvidence: "Synthetic tour completed.",
  },
  membership: {
    id: "review-role-assignments",
    title: "Review role assignments",
    purpose:
      "Check that contributors, reviewers and administrators have the minimum required access.",
    completionEvidence:
      "Role review checkpoint acknowledged; no membership is changed by the tour.",
  },
  plan: {
    id: "plan-first-pursuit",
    title: "Plan the first pursuit",
    purpose:
      "Identify the source owner, bid manager, reviewer and submission operator.",
    completionEvidence: "Named-responsibility planning checkpoint completed.",
  },
  contribute: {
    id: "map-synthetic-evidence",
    title: "Map synthetic evidence",
    purpose: "Practise linking a requirement to a verified evidence span.",
    completionEvidence: "Synthetic evidence link reviewed.",
  },
  review: {
    id: "review-synthetic-finding",
    title: "Review a synthetic finding",
    purpose:
      "Practise claiming an item and recording a bounded human decision.",
    completionEvidence:
      "Synthetic review decision completed; no approval authority is exercised.",
  },
  audit: {
    id: "inspect-synthetic-receipt",
    title: "Inspect a synthetic receipt",
    purpose:
      "Learn how source versions, named actions and outcome receipts are traced.",
    completionEvidence: "Synthetic provenance receipt inspected.",
  },
  operations: {
    id: "triage-synthetic-queue",
    title: "Triage a synthetic operations queue",
    purpose:
      "Practise assignment, SLA and escalation decisions without contacting a lead.",
    completionEvidence: "Synthetic queue item triaged.",
  },
  quality: {
    id: "inspect-release-gates",
    title: "Inspect release gates",
    purpose:
      "Review evaluation, evidence and named-approval gates before activation.",
    completionEvidence: "Synthetic release-gate review completed.",
  },
};

const ROLE_CHECKLIST: Readonly<Record<OrganisationRole, readonly string[]>> = {
  client_organisation_owner: ["membership", "plan", "review"],
  client_administrator: ["membership", "plan"],
  bid_manager: ["plan", "contribute", "review"],
  contributor: ["contribute"],
  client_reviewer_approver: ["review", "audit"],
  valo_operations_administrator: ["operations", "membership", "quality"],
  restricted_platform_administrator: ["membership", "audit"],
  consultancy_partner_administrator: ["membership", "plan", "review"],
  consultancy_partner_analyst_reviewer: ["contribute", "review"],
  read_only_auditor: ["audit"],
  valo_analyst: ["operations", "contribute"],
  valo_quality_adviser: ["review", "quality", "audit"],
};

const SYNTHETIC_TOUR: readonly SyntheticTourStep[] = Object.freeze([
  {
    id: "tour-requirement",
    title: "Open a mandatory requirement",
    instruction:
      "Inspect the exact synthetic clause and its immutable source reference.",
    syntheticObjectReference: "SYN-PURSUIT-001/REQ-004",
  },
  {
    id: "tour-evidence",
    title: "Check the evidence mapping",
    instruction:
      "Compare the cited span with the requirement; do not infer issuer authenticity.",
    syntheticObjectReference: "SYN-PURSUIT-001/EVD-002",
  },
  {
    id: "tour-finding",
    title: "Resolve a review finding",
    instruction:
      "Choose a synthetic review outcome and inspect the resulting receipt.",
    syntheticObjectReference: "SYN-PURSUIT-001/REV-003",
  },
  {
    id: "tour-preflight",
    title: "Read the package preflight",
    instruction:
      "Confirm why a blocked rehearsal never becomes a submission action.",
    syntheticObjectReference: "SYN-PURSUIT-001/PKG-001",
  },
]);

export function deriveOnboardingJourney(
  roles: readonly OrganisationRole[],
): OnboardingJourney {
  const uniqueRoles = [...new Set(roles)].sort();
  const itemIds = [
    "access",
    "boundaries",
    "pursuit",
    ...uniqueRoles.flatMap((role) => ROLE_CHECKLIST[role]),
  ];
  const checklist = [...new Set(itemIds)].map((id) => CHECKLIST[id]!);
  return {
    policyVersion: ONBOARDING_POLICY_VERSION,
    derivedFromRoles: uniqueRoles,
    checklist,
    syntheticTour: {
      dataClassification: "synthetic_non_customer",
      writesAuthoritativeState: false,
      title: "First verified finding",
      steps: SYNTHETIC_TOUR,
    },
  };
}
