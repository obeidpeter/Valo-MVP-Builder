export type IntelligenceCapabilityId =
  | "evidence_graph"
  | "addendum_radar"
  | "eligibility_passport"
  | "grounded_copilot"
  | "opportunity_radar"
  | "response_studio"
  | "submission_preflight"
  | "clarification_assistant"
  | "boq_sanity"
  | "award_handoff";

export type IntelligenceDecisionLevel = 1 | 2;

export type IntelligenceCapabilityState =
  | "review_ready"
  | "partial"
  | "empty"
  | "restricted"
  | "production_disabled";

export interface IntelligenceCitation {
  id: string;
  sourceName: string;
  locator: string;
  excerpt?: string;
}

export interface IntelligenceCapabilitySnapshot {
  id: IntelligenceCapabilityId;
  state: IntelligenceCapabilityState;
  stateReason: string;
  summary?: string;
  reviewItemCount?: number | null;
  citationCount?: number | null;
  citations?: readonly IntelligenceCitation[];
  lastUpdatedAt?: string | null;
}

export interface IntelligenceCentreSnapshot {
  environment: "production" | "staging" | "development";
  productionAiEnabled: boolean;
  restrictedMode: boolean;
  generatedAt: string | null;
  project?: {
    id: string;
    title: string;
    status: string;
    deadline: string | null;
  };
  capabilities: readonly IntelligenceCapabilitySnapshot[];
}

export type IntelligenceCentreLoadState =
  | { status: "loading" }
  | {
      status: "error";
      message: string;
      retry?: () => void;
    }
  | {
      status: "ready";
      snapshot: IntelligenceCentreSnapshot;
    };

export interface IntelligenceCapabilityDefinition {
  id: IntelligenceCapabilityId;
  title: string;
  shortLabel: string;
  level: IntelligenceDecisionLevel;
  description: string;
  humanControl: string;
  evidenceBasis: string;
}

export const INTELLIGENCE_CAPABILITY_CATALOG: readonly IntelligenceCapabilityDefinition[] =
  [
    {
      id: "evidence_graph",
      title: "Evidence Graph",
      shortLabel: "Evidence graph",
      level: 2,
      description:
        "Connects reviewed requirements, exact source citations, approved evidence and reusable capability claims.",
      humanControl:
        "A named reviewer verifies every citation and decides whether a proposed evidence link is applicable.",
      evidenceBasis:
        "Versioned tender sources, requirement citations, confirmed evidence and approved capability records.",
    },
    {
      id: "addendum_radar",
      title: "Addendum & Deadline Radar",
      shortLabel: "Addendum radar",
      level: 2,
      description:
        "Drafts a source-version diff and shows which requirements, deadlines, BOQ checks and approvals may be stale.",
      humanControl:
        "A reviewer compares both authoritative versions and confirms each impact before work is reopened.",
      evidenceBasis:
        "Immutable tender and addendum versions with captured timestamps, hashes and exact changed passages.",
    },
    {
      id: "eligibility_passport",
      title: "Tender Eligibility Passport",
      shortLabel: "Eligibility",
      level: 1,
      description:
        "Previews tender-specific eligibility coverage and expiring company evidence without inventing a universal checklist.",
      humanControl:
        "Client owners verify applicability, dates, issuing authority and remediation ownership for every item.",
      evidenceBasis:
        "Reviewed solicitation clauses, approved Vault versions and verified capability evidence.",
    },
    {
      id: "grounded_copilot",
      title: "Grounded Tender Copilot",
      shortLabel: "Copilot",
      level: 1,
      description:
        "Plans extractive answers from accepted facts and abstains when an exact, authorised citation cannot support the question.",
      humanControl:
        "Users inspect the cited source before relying on an answer or copying it into work product.",
      evidenceBasis:
        "Selected tender, addendum, approved evidence and active SBD source versions only.",
    },
    {
      id: "opportunity_radar",
      title: "Opportunity Radar",
      shortLabel: "Opportunities",
      level: 1,
      description:
        "Prioritises recorded opportunities against explicit capability, geography, lot, deadline and capacity criteria.",
      humanControl:
        "Business-development leaders decide bid or no-bid; the system never predicts an award or implies evaluator influence.",
      evidenceBasis:
        "Authoritative opportunity records, approved capability facts and current workload signals.",
    },
    {
      id: "response_studio",
      title: "Citation-first Response Studio",
      shortLabel: "Response studio",
      level: 2,
      description:
        "Validates reversible response drafts so every factual claim is linked to approved, current evidence.",
      humanControl:
        "Named authors and reviewers edit, accept or reject every draft claim before report or package sign-off.",
      evidenceBasis:
        "Reviewed requirements, approved capability versions, exact citations and versioned draft claims.",
    },
    {
      id: "submission_preflight",
      title: "Submission Pack Preflight",
      shortLabel: "Preflight",
      level: 1,
      description:
        "Runs deterministic release checks for citations, signatures, dates, BOQ exceptions, readiness and package provenance.",
      humanControl:
        "The named signatory makes the release decision; the system cannot mark a package submitted.",
      evidenceBasis:
        "Frozen package manifest, deterministic readiness rules, reviewer decisions and sign-off evidence.",
    },
    {
      id: "clarification_assistant",
      title: "Clarification Question Assistant",
      shortLabel: "Clarifications",
      level: 2,
      description:
        "Drafts source-linked questions for ambiguous, contradictory or unpriceable tender terms.",
      humanControl:
        "An authorised tender lead decides whether and how to send a question; Valo never sends it.",
      evidenceBasis:
        "Exact tender clauses, addenda, recorded conflicts and the authoritative clarification deadline.",
    },
    {
      id: "boq_sanity",
      title: "BOQ & Commercial Sanity Checker",
      shortLabel: "BOQ sanity",
      level: 1,
      description:
        "Explains deterministic arithmetic, formula, unit, tax and anomaly checks without selecting or changing a price.",
      humanControl:
        "Commercial reviewers resolve every exception and remain responsible for rates, assumptions and approvals.",
      evidenceBasis:
        "Uploaded BOQ values, formula lineage and an approved versioned rule pack.",
    },
    {
      id: "award_handoff",
      title: "Award-to-Delivery Handoff",
      shortLabel: "Delivery handoff",
      level: 2,
      description:
        "Drafts obligations, milestones, notices and evidence tasks from an explicitly recorded award or contract.",
      humanControl:
        "A contract or project manager accepts owners and dates; Valo never issues a notice or changes an external system.",
      evidenceBasis:
        "Client-confirmed outcome, signed contract or award source, approved submission and retained obligations.",
    },
  ] as const;

export function createProductionDisabledIntelligenceSnapshot(): IntelligenceCentreSnapshot {
  return {
    environment: "production",
    productionAiEnabled: false,
    restrictedMode: false,
    generatedAt: null,
    capabilities: INTELLIGENCE_CAPABILITY_CATALOG.map((capability) => ({
      id: capability.id,
      state: "production_disabled",
      stateReason:
        "No connected production evidence is available for this capability.",
      reviewItemCount: null,
      citationCount: null,
      citations: [],
      lastUpdatedAt: null,
    })),
  };
}
