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
  | "award_handoff"
  | "evaluation_score_planner"
  | "bid_security_integrity"
  | "regulatory_watchtower"
  | "consortium_responsibility"
  | "portal_submission_rehearsal"
  | "commercial_exposure"
  | "nigerian_content_composer"
  | "personnel_tailoring"
  | "contract_deviation"
  | "critical_path_simulator"
  | "integrity_sentinel"
  | "outcome_learning";

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
    {
      id: "evaluation_score_planner",
      title: "Published-Evaluation Score Planner",
      shortLabel: "Score planner",
      level: 1,
      description:
        "Maps only published evaluation criteria, weights and supporting evidence without predicting evaluator behaviour or award probability.",
      humanControl:
        "A named bid reviewer confirms every criterion, score allocation and evidence mapping before it can guide the response plan.",
      evidenceBasis:
        "Authoritative solicitation criteria, exact citations, accepted requirements and reviewed evidence links.",
    },
    {
      id: "bid_security_integrity",
      title: "Bid Security & Guarantee Integrity Desk",
      shortLabel: "Security desk",
      level: 1,
      description:
        "Compares cited security terms with a verified instrument for amount, currency, beneficiary, wording, issuer and validity gaps.",
      humanControl:
        "Authorised legal, commercial and treasury reviewers decide remediation; Valo never instructs a bank or represents validity.",
      evidenceBasis:
        "Exact tender clauses, prescribed forms and immutable issued-instrument versions with named review.",
    },
    {
      id: "regulatory_watchtower",
      title: "Regulatory Rule-Pack Watchtower",
      shortLabel: "Rule watchtower",
      level: 1,
      description:
        "Shows potential pursuit and template impacts from verified official procurement or sector rule changes.",
      humanControl:
        "Compliance or legal owners approve source authority, interpretation and activation before any control or template changes.",
      evidenceBasis:
        "Immutable official rule versions, effective dates, exact changed passages and approved impact records.",
    },
    {
      id: "consortium_responsibility",
      title: "JV / Consortium Responsibility Matrix",
      shortLabel: "Consortium matrix",
      level: 2,
      description:
        "Proposes entity-bound ownership for eligibility, technical, commercial and signing obligations without treating credentials as transferable.",
      humanControl:
        "Authorised representatives accept each responsibility; Valo never binds a partner or edits consortium terms.",
      evidenceBasis:
        "Reviewed tender obligations, signed partner instruments, entity-specific evidence and named acceptance.",
    },
    {
      id: "portal_submission_rehearsal",
      title: "Portal Submission Rehearsal & Form Mapper",
      shortLabel: "Portal rehearsal",
      level: 1,
      description:
        "Checks a frozen package against an approved portal profile, field map, naming, size and upload-order rules.",
      humanControl:
        "An authorised operator runs the real submission; Valo never logs in, clicks submit or acknowledges declarations.",
      evidenceBasis:
        "Frozen package hashes, versioned portal rules, rehearsal receipts and operator review.",
    },
    {
      id: "commercial_exposure",
      title: "Commercial Assumption & Cashflow Exposure Simulator",
      shortLabel: "Commercial exposure",
      level: 1,
      description:
        "Models deterministic scenarios for payment timing, retention, mobilisation, tax, bonds, FX and price-adjustment terms.",
      humanControl:
        "Finance reviewers approve assumptions and decisions; Valo never selects a price, rate or financing commitment.",
      evidenceBasis:
        "Cited tender clauses, safe BOQ versions and explicitly reviewed scenario assumptions.",
    },
    {
      id: "nigerian_content_composer",
      title: "Nigerian-Content Evidence Composer",
      shortLabel: "Local-content plan",
      level: 2,
      description:
        "Composes source-exact plan lines for verified personnel, equipment, facilities, subcontracting and training evidence.",
      humanControl:
        "Evidence owners confirm availability and every quantity or percentage before a plan line can be used.",
      evidenceBasis:
        "Tender-specific local-content clauses and current, named-review company evidence.",
    },
    {
      id: "personnel_tailoring",
      title: "Past-Performance & Key-Personnel Tailoring Studio",
      shortLabel: "Personnel tailoring",
      level: 2,
      description:
        "Proposes criterion-relevant verified project and personnel facts while blocking unavailable people and unsupported claims.",
      humanControl:
        "HR, project and bid owners attest currency, availability and selection; Valo never embellishes credentials.",
      evidenceBasis:
        "Reviewed criteria, active CV/project evidence, exact citations and current owner attestations.",
    },
    {
      id: "contract_deviation",
      title: "Tender-to-Contract Deviation Desk",
      shortLabel: "Contract deviations",
      level: 1,
      description:
        "Compares solicitation, bid, clarification, award and draft-contract clauses to surface changed, omitted or new obligations.",
      humanControl:
        "Legal and commercial owners decide every issue; Valo never accepts terms or communicates a redline.",
      evidenceBasis:
        "Reviewed exact clauses from immutable versions across each contractual stage.",
    },
    {
      id: "critical_path_simulator",
      title: "Pursuit Critical-Path & Capacity Simulator",
      shortLabel: "Critical path",
      level: 1,
      description:
        "Builds bounded dependency and resource scenarios from accepted milestones and shows deadline or capacity conflicts.",
      humanControl:
        "Task owners confirm all owner and date changes; the simulator changes no authoritative plan state.",
      evidenceBasis:
        "Source-backed milestones, accepted dependencies, capacity records and reviewed scenarios.",
    },
    {
      id: "integrity_sentinel",
      title: "Procurement-Integrity & Conflict Sentinel",
      shortLabel: "Integrity sentinel",
      level: 1,
      description:
        "Produces restricted control signals for segregation-of-duties, contact-channel, relationship and override review—never allegations.",
      humanControl:
        "Only authorised ethics or legal reviewers assess a signal; Valo makes no misconduct finding or external report.",
      evidenceBasis:
        "Tenant-bound immutable audit events, declared relationships and named confidential review.",
    },
    {
      id: "outcome_learning",
      title: "Outcome Learning & Repeat-Defect Coach",
      shortLabel: "Outcome learning",
      level: 2,
      description:
        "Proposes tenant-local lessons from client-confirmed outcomes and repeated cited defects without training on confidential content by default.",
      humanControl:
        "A governance owner approves each lesson, its reuse scope and retention; cross-tenant reuse remains disabled.",
      evidenceBasis:
        "Client-confirmed outcomes, authorised debrief sources, reviewed defects and subject-bound lesson approval.",
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
