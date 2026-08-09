import {
  pgTable,
  text,
  integer,
  bigint as pgBigint,
  bigserial,
  boolean,
  doublePrecision,
  timestamp,
  uuid,
  foreignKey,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

const optimisticVersion = () => integer("version").notNull().default(1);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").notNull().default("none"),
  status: text("status").notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * A hard tenant boundary. `type` is one of client | valo | consultancy_partner.
 * The database columns deliberately use organisation (not account/workspace)
 * consistently so access checks do not need ambiguous identifier translation.
 */
export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull().default("client"),
  status: text("status").notNull().default("active"),
  countryCode: text("country_code").notNull().default("NG"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One membership per person and organisation; roles are separate grants. */
export const organisationMemberships = pgTable(
  "organisation_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    accessStartsAt: timestamp("access_starts_at", { withTimezone: true }),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    delegatedByMembershipId: uuid("delegated_by_membership_id"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.delegatedByMembershipId],
      foreignColumns: [t.id],
      name: "organisation_memberships_delegated_by_fk",
    }).onDelete("set null"),
    uniqueIndex("organisation_memberships_org_user_unique").on(
      t.organisationId,
      t.userId,
    ),
    index("organisation_memberships_user_status_idx").on(t.userId, t.status),
  ],
);

/**
 * Role grants are independently expirable/revocable. This supports temporary
 * reviewer access and segregation of duties without mutating identity rows.
 */
export const roleGrants = pgTable(
  "role_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => organisationMemberships.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    grantedByMembershipId: uuid("granted_by_membership_id").references(
      () => organisationMemberships.id,
      { onDelete: "set null" },
    ),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("role_grants_membership_active_idx").on(t.membershipId, t.revokedAt),
  ],
);

export const partnerRelationships = pgTable(
  "partner_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganisationId: uuid("partner_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientOrganisationId: uuid("client_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    clientOwnershipRule: text("client_ownership_rule")
      .notNull()
      .default("client_retained"),
    qaResponsibility: text("qa_responsibility"),
    coSigningRequired: boolean("co_signing_required").notNull().default(false),
    accessStartsAt: timestamp("access_starts_at", { withTimezone: true }),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
    approvedByMembershipId: uuid("approved_by_membership_id").references(
      () => organisationMemberships.id,
      { onDelete: "set null" },
    ),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("partner_relationships_partner_client_unique").on(
      t.partnerOrganisationId,
      t.clientOrganisationId,
    ),
  ],
);

/** Emergency access is explicit, short-lived, two-person approved and auditable. */
export const breakGlassSessions = pgTable(
  "break_glass_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    targetOrganisationId: uuid("target_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    reason: text("reason").notNull(),
    incidentReference: text("incident_reference").notNull(),
    requestedPermissions: text("requested_permissions").notNull(),
    status: text("status").notNull().default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("break_glass_target_status_expiry_idx").on(
      t.targetOrganisationId,
      t.status,
      t.expiresAt,
    ),
  ],
);

/** Global defaults plus tenant overrides; later-stage flags default disabled. */
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    configuration: text("configuration"),
    commercialGate: text("commercial_gate"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("feature_flags_tenant_key_unique")
      .on(t.organisationId, t.key)
      .where(sql`${t.organisationId} is not null`),
    uniqueIndex("feature_flags_global_key_unique")
      .on(t.key)
      .where(sql`${t.organisationId} is null`),
  ],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    sector: text("sector"),
    segment: text("segment"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    ndaStatus: text("nda_status").notNull().default("pending"),
    notes: text("notes"),
    // Gate 0 founder metric (Build Brief §17): decision-maker conversations are
    // counted against the >=8 threshold, kept distinct from junior bid staff.
    decisionMakerConversations: integer("decision_maker_conversations")
      .notNull()
      .default(0),
    juniorConversations: integer("junior_conversations").notNull().default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_org_created_idx").on(t.organisationId, t.createdAt)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    tenderTitle: text("tender_title").notNull(),
    issuingEntity: text("issuing_entity"),
    tenderRef: text("tender_ref"),
    lot: text("lot"),
    deadline: text("deadline"),
    valueBand: text("value_band"),
    segment: text("segment"),
    submissionStatus: text("submission_status"),
    status: text("status").notNull().default("intake"),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    slaClass: text("sla_class").notNull().default("standard"),
    paymentStatus: text("payment_status").notNull().default("not_required"),
    paymentConfirmedByFounder: boolean("payment_confirmed_by_founder")
      .notNull()
      .default(false),
    paymentConfirmedByAdvisor: boolean("payment_confirmed_by_advisor")
      .notNull()
      .default(false),
    paymentConfirmedAt: timestamp("payment_confirmed_at", {
      withTimezone: true,
    }),
    // Dual-confirmation identity stamps (FR-BIL-01): the payment gate requires
    // two *distinct* people, so each leg records who confirmed it, derived
    // server-side from the session — never accepted from the client.
    paymentFounderConfirmedBy: uuid("payment_founder_confirmed_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    paymentFounderConfirmedByName: text("payment_founder_confirmed_by_name"),
    paymentFounderConfirmedAt: timestamp("payment_founder_confirmed_at", {
      withTimezone: true,
    }),
    paymentAdvisorConfirmedBy: uuid("payment_advisor_confirmed_by").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    paymentAdvisorConfirmedByName: text("payment_advisor_confirmed_by_name"),
    paymentAdvisorConfirmedAt: timestamp("payment_advisor_confirmed_at", {
      withTimezone: true,
    }),
    conflictStatus: text("conflict_status").notNull().default("clear"),
    conflictDecision: text("conflict_decision"),
    conflictRationale: text("conflict_rationale"),
    physicalArchiveInstruction: text("physical_archive_instruction"),
    redactionScope: text("redaction_scope"),
    restrictedMode: boolean("restricted_mode").notNull().default(false),
    riskScore: doublePrecision("risk_score"),
    riskBand: text("risk_band"),
    riskOverrideBand: text("risk_override_band"),
    riskOverrideNote: text("risk_override_note"),
    riskOverrideBy: text("risk_override_by"),
    outcome: text("outcome").notNull().default("none"),
    // Gate 0 mandate-quality metric (Build Brief §17): distinguishes autopsy-only
    // revenue from a real assisted-bid/retainer mandate so ">=1 quality mandate"
    // is visible. none | autopsy_only | assisted_bid | retainer.
    mandateQuality: text("mandate_quality").notNull().default("none"),
    scope: text("scope"),
    limitations: text("limitations"),
    responsivenessReview: text("responsiveness_review"),
    responsivenessSuggested: boolean("responsiveness_suggested")
      .notNull()
      .default(false),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("projects_org_created_idx").on(t.organisationId, t.createdAt),
    index("projects_org_client_idx").on(t.organisationId, t.clientId),
    index("projects_org_tender_lot_idx").on(
      t.organisationId,
      t.tenderRef,
      t.lot,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("other"),
    filename: text("filename").notNull(),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    // SHA-256 of the stored object, computed server-side at intake (FR-INT-02).
    // Null only for legacy rows or when the object could not be read at intake.
    sha256: text("sha256"),
    source: text("source"),
    dateReceived: text("date_received"),
    redactionStatus: text("redaction_status").notNull().default("excluded"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    contentText: text("content_text"),
    extractedChars: integer("extracted_chars"),
    extractionStatus: text("extraction_status").default("pending"),
    // Extraction telemetry (FR-OCR-01/02): how the text was obtained, a coarse
    // deterministic confidence heuristic, and per-document notes that feed the
    // OCR evaluation set the roadmap requires.
    extractionMethod: text("extraction_method"),
    extractionConfidence: doublePrecision("extraction_confidence"),
    extractionNotes: text("extraction_notes"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("documents_org_project_idx").on(t.organisationId, t.projectId)],
);

export const requirements = pgTable("requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceDocId: uuid("source_doc_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  pageRef: text("page_ref"),
  clauseRef: text("clause_ref"),
  text: text("text").notNull(),
  category: text("category").notNull().default("other"),
  expectedEvidence: text("expected_evidence"),
  isMandatory: boolean("is_mandatory").notNull().default(true),
  confidence: text("confidence"),
  reviewStatus: text("review_status").notNull().default("suggested"),
  reviewerNotes: text("reviewer_notes"),
  // Gate 0 Technical Scorecard fields (FR-EXT-03/04): who surfaced the row
  // ("engine" | "manual"; null = legacy), the frozen engine proposal so edits
  // stay diffable, and the server-derived reviewer stamp on review actions.
  origin: text("origin"),
  engineText: text("engine_text"),
  // Citations folded in from rows merged away by a reviewer (JSON array of
  // {sourceDocId, sourceDocName, pageRef, clauseRef, text}). The survivor keeps
  // its own primary citation in the native columns above; this preserves the
  // originals' page/clause refs so no provenance is lost on merge.
  mergedCitations: text("merged_citations"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const evidenceItems = pgTable("evidence_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id")
    .notNull()
    .references(() => requirements.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  evidenceStatus: text("evidence_status").notNull().default("pending"),
  excerpt: text("excerpt"),
  notes: text("notes"),
  suggested: boolean("suggested").notNull().default(false),
  confirmedBy: uuid("confirmed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const defects = pgTable("defects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id").references(() => requirements.id, {
    onDelete: "set null",
  }),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  evidenceSnapshot: text("evidence_snapshot"),
  remediation: text("remediation"),
  owner: text("owner"),
  status: text("status").notNull().default("open"),
  suggested: boolean("suggested").notNull().default(false),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const boqChecks = pgTable("boq_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sourceDocId: uuid("source_doc_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  lineRef: text("line_ref"),
  description: text("description"),
  quantity: doublePrecision("quantity"),
  unitRate: doublePrecision("unit_rate"),
  extension: doublePrecision("extension"),
  computedExtension: doublePrecision("computed_extension"),
  quantityRaw: text("quantity_raw"),
  unitRateKobo: pgBigint("unit_rate_kobo", { mode: "number" }),
  extensionKobo: pgBigint("extension_kobo", { mode: "number" }),
  computedExtensionKobo: pgBigint("computed_extension_kobo", {
    mode: "number",
  }),
  checkType: text("check_type").notNull(),
  finding: text("finding").notNull(),
  severity: text("severity").notNull().default("scoring_risk"),
  status: text("status").notNull().default("flagged"),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vaultItems = pgTable("vault_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  artefactType: text("artefact_type").notNull(),
  issuer: text("issuer"),
  issueDate: text("issue_date"),
  expiryDate: text("expiry_date"),
  renewalLeadDays: integer("renewal_lead_days"),
  status: text("status").notNull().default("active"),
  objectPath: text("object_path"),
  sha256: text("sha256"),
  sourceDocumentId: uuid("source_document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const capabilityItems = pgTable("capability_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  claimType: text("claim_type").notNull(),
  description: text("description"),
  evidenceDocId: uuid("evidence_doc_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  approvedStatus: text("approved_status").notNull().default("pending"),
  verifierId: uuid("verifier_id").references(() => users.id, {
    onDelete: "set null",
  }),
  verifierName: text("verifier_name"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const conflictRecords = pgTable("conflict_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "set null",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  tenderRef: text("tender_ref"),
  lot: text("lot"),
  matchedProjectId: uuid("matched_project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("blocked"),
  decision: text("decision"),
  rationale: text("rationale"),
  decidedBy: uuid("decided_by").references(() => users.id, {
    onDelete: "set null",
  }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const notificationEvents = pgTable("notification_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  clientId: uuid("client_id").references(() => clients.id, {
    onDelete: "cascade",
  }),
  vaultItemId: uuid("vault_item_id").references(() => vaultItems.id, {
    onDelete: "cascade",
  }),
  channel: text("channel").notNull().default("manual"),
  template: text("template").notNull(),
  recipient: text("recipient"),
  payload: text("payload"),
  status: text("status").notNull().default("queued"),
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const retentionRequests = pgTable(
  "retention_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    certificateText: text("certificate_text"),
    status: text("status").notNull().default("pending"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // At most one OPEN request per project: the manual endpoint and the retention
  // scheduler both dedup in code, but this partial unique index is the last-line
  // guarantee that concurrent runs can never create duplicate pending requests.
  (t) => [
    uniqueIndex("retention_requests_one_pending_per_project")
      .on(t.projectId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// Global, admin-configurable settings (single-row table). Holds the scoring
// parameters the deterministic risk engine reads at runtime, report-template
// details, and retention defaults. The `id` is pinned to a fixed value so
// there is exactly one active configuration; historic reports keep their own
// engine-version stamp and are never rewritten when this changes.
export const appConfig = pgTable("app_config", {
  id: text("id").primaryKey().default("singleton"),
  severityWeightFatal: integer("severity_weight_fatal").notNull().default(40),
  severityWeightLikelyFatal: integer("severity_weight_likely_fatal")
    .notNull()
    .default(25),
  severityWeightScoringRisk: integer("severity_weight_scoring_risk")
    .notNull()
    .default(10),
  severityWeightCosmetic: integer("severity_weight_cosmetic")
    .notNull()
    .default(3),
  missingEvidenceWeight: integer("missing_evidence_weight")
    .notNull()
    .default(5),
  bandMediumCutoff: integer("band_medium_cutoff").notNull().default(15),
  bandHighCutoff: integer("band_high_cutoff").notNull().default(40),
  bandCriticalCutoff: integer("band_critical_cutoff").notNull().default(70),
  firmName: text("firm_name").notNull().default("VALO"),
  confidentialityLegend: text("confidentiality_legend")
    .notNull()
    .default(
      "CONFIDENTIAL — Prepared for internal review. Not for external distribution.",
    ),
  retentionDefaultDays: integer("retention_default_days").notNull().default(14),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const sbdTemplates = pgTable("sbd_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("goods"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  issuingCircular: text("issuing_circular"),
  summary: text("summary"),
  optimisticLockVersion: integer("optimistic_lock_version")
    .notNull()
    .default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sbdAnnotations = pgTable("sbd_annotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  templateId: uuid("template_id")
    .notNull()
    .references(() => sbdTemplates.id, { onDelete: "cascade" }),
  agency: text("agency"),
  section: text("section"),
  kind: text("kind").notNull().default("format"),
  quirk: text("quirk").notNull(),
  version: optimisticVersion(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    docxPath: text("docx_path"),
    pdfPath: text("pdf_path"),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewerName: text("reviewer_name"),
    attestation: text("attestation"),
    engineVersion: text("engine_version"),
    // Full provenance stamp (NFR-AUD-01): which prompt pack, model, and defect
    // taxonomy were in service when this report version was generated.
    promptPackVersion: text("prompt_pack_version"),
    modelId: text("model_id"),
    taxonomyVersion: text("taxonomy_version"),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    generatedBy: uuid("generated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    optimisticLockVersion: integer("optimistic_lock_version")
      .notNull()
      .default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reports_project_version_unique").on(t.projectId, t.version),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    // Historical actor identity is a hash-covered snapshot. It deliberately
    // has no users FK: deleting an identity must never rewrite an audit row.
    userId: uuid("user_id"),
    userName: text("user_name"),
    projectId: uuid("project_id"),
    eventType: text("event_type").notNull(),
    objectType: text("object_type"),
    objectId: text("object_id"),
    details: text("details"),
    // Tamper-evident hash chain (FR-WFM-02). `seq` is a contiguous 1-based
    // position assigned under an advisory lock; `hash` = SHA-256 over the
    // previous event's hash plus this event's canonical payload. Every active
    // row is chained; preserved v1 evidence lives only in legacyAuditEvents.
    // The unique index is a backstop: if serialisation ever fails, the fork
    // errors out instead of silently corrupting the chain.
    seq: integer("seq").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    // The active chain is always v2 and binds the organisation ID. Legacy v1
    // bytes live only in legacy_audit_events with an explicit assessment.
    hashVersion: integer("hash_version").notNull().default(2),
    // DB-assigned monotonic ordinal (cannot be backdated by a plain INSERT the
    // way created_at can); the verifier uses it to spot unchained rows written
    // after the chain started.
    rowNo: bigserial("row_no", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  // RLS exposes one organisation at a time, so each tenant owns an independent
  // contiguous chain beginning at seq=1. The tenant key is therefore part of
  // the uniqueness boundary; a global seq constraint makes tenant #2 collide.
  (t) => [
    check("audit_events_hash_version_check", sql`${t.hashVersion} = 2`),
    check("audit_events_seq_positive_check", sql`${t.seq} > 0`),
    check(
      "audit_events_prev_hash_format_check",
      sql`${t.prevHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("audit_events_hash_format_check", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    uniqueIndex("audit_events_organisation_seq_unique").on(
      t.organisationId,
      t.seq,
    ),
  ],
);

/**
 * One immutable assessment of a migrated legacy audit stream. The active v2
 * chain does not claim continuity across a known legacy payload mutation.
 */
export const legacyAuditIntegrityAssessments = pgTable(
  "legacy_audit_integrity_assessments",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    sourceCommit: text("source_commit").notNull(),
    sourceEventCount: integer("source_event_count").notNull(),
    verifiedRanges: text("verified_ranges").notNull(),
    discontinuityRanges: text("discontinuity_ranges").notNull(),
    finding: text("finding").notNull(),
    probableCause: text("probable_cause"),
    externalHeadSeq: integer("external_head_seq").notNull(),
    externalHeadHash: text("external_head_hash").notNull(),
    sourceBackupSha256: text("source_backup_sha256").notNull(),
    sourceAuditExportSha256: text("source_audit_export_sha256").notNull(),
    rehearsalEvidenceSha256: text("rehearsal_evidence_sha256").notNull(),
    archiveDigest: text("archive_digest").notNull(),
    assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("legacy_audit_assessments_org_digest_unique").on(
      t.organisationId,
      t.archiveDigest,
    ),
  ],
);

/** Byte-preserving, read-only archive of the pre-tenancy audit relation. */
export const legacyAuditEvents = pgTable(
  "legacy_audit_events",
  {
    id: uuid("id").primaryKey(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => legacyAuditIntegrityAssessments.id, {
        onDelete: "restrict",
      }),
    // These UUIDs are historical values only; no mutable parent FKs exist.
    userId: uuid("user_id"),
    userName: text("user_name"),
    projectId: uuid("project_id"),
    eventType: text("event_type").notNull(),
    objectType: text("object_type"),
    objectId: text("object_id"),
    details: text("details"),
    seq: integer("seq").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    rowNo: pgBigint("row_no", { mode: "number" }).notNull(),
    integrityStatus: text("integrity_status").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "legacy_audit_events_integrity_status_check",
      sql`${t.integrityStatus} in ('payload_hash_verified', 'known_discontinuity')`,
    ),
    uniqueIndex("legacy_audit_events_org_seq_unique").on(
      t.organisationId,
      t.seq,
    ),
    uniqueIndex("legacy_audit_events_org_row_no_unique").on(
      t.organisationId,
      t.rowNo,
    ),
  ],
);

export const llmRuns = pgTable("llm_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organisationId: uuid("organisation_id").references(() => organisations.id, {
    onDelete: "restrict",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  task: text("task").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  inputHash: text("input_hash"),
  outputSummary: text("output_summary"),
  // Cost telemetry (FR-ANL-03): raw token counts per call, rolled up to
  // per-engagement cost records against the BP unit assumption.
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  error: text("error"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------
// v1.0-v2.5 governed platform domains. These tables deliberately keep tenant
// identity on every mutable record, exact money in integer minor units, and
// immutable version/provenance references at release boundaries.
// ---------------------------------------------------------------------------

export const ndaRecords = pgTable(
  "nda_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    documentVersion: text("document_version").notNull(),
    status: text("status").notNull().default("pending"),
    signerName: text("signer_name"),
    signerAuthority: text("signer_authority"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    documentHash: text("document_hash"),
    signatureEvidence: text("signature_evidence"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("nda_records_org_client_status_idx").on(
      t.organisationId,
      t.clientId,
      t.status,
    ),
  ],
);

export const privacyRecords = pgTable(
  "privacy_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    recordType: text("record_type").notNull(),
    controllerProcessorRole: text("controller_processor_role").notNull(),
    purpose: text("purpose").notNull(),
    lawfulBasis: text("lawful_basis").notNull(),
    dataCategories: text("data_categories").notNull(),
    subjectCategories: text("subject_categories").notNull(),
    noticeVersion: text("notice_version"),
    retentionSchedule: text("retention_schedule").notNull(),
    dpiaStatus: text("dpia_status").notNull().default("not_required"),
    dcpmiDesignation: text("dcpmi_designation"),
    designationConfirmedBy: text("designation_confirmed_by"),
    legalReviewStatus: text("legal_review_status").notNull().default("pending"),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("privacy_records_org_type_effective_idx").on(
      t.organisationId,
      t.recordType,
      t.effectiveFrom,
    ),
  ],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    privacyRecordId: uuid("privacy_record_id").references(
      () => privacyRecords.id,
      { onDelete: "restrict" },
    ),
    subjectReference: text("subject_reference").notNull(),
    purpose: text("purpose").notNull(),
    noticeVersion: text("notice_version").notNull(),
    affirmativeAction: text("affirmative_action").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    evidenceHash: text("evidence_hash").notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("consent_records_org_subject_idx").on(
      t.organisationId,
      t.subjectReference,
    ),
  ],
);

export const dataSubjectRequests = pgTable(
  "data_subject_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    requestType: text("request_type").notNull(),
    requesterReference: text("requester_reference").notNull(),
    identityVerificationStatus: text("identity_verification_status")
      .notNull()
      .default("pending"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("received"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    responseEvidence: text("response_evidence"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dsr_org_status_due_idx").on(t.organisationId, t.status, t.dueAt),
  ],
);

export const legalHolds = pgTable(
  "legal_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    scope: text("scope").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("active"),
    placedByUserId: uuid("placed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    releasedByUserId: uuid("released_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("legal_holds_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const subprocessors = pgTable(
  "subprocessors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    legalName: text("legal_name").notNull(),
    service: text("service").notNull(),
    countryCode: text("country_code").notNull(),
    dpaStatus: text("dpa_status").notNull().default("pending"),
    securityReviewStatus: text("security_review_status")
      .notNull()
      .default("pending"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subprocessors_org_name_service_unique").on(
      t.organisationId,
      t.legalName,
      t.service,
    ),
  ],
);

export const crossBorderTransfers = pgTable(
  "cross_border_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    subprocessorId: uuid("subprocessor_id").references(() => subprocessors.id, {
      onDelete: "restrict",
    }),
    exporterRole: text("exporter_role").notNull(),
    importerRole: text("importer_role").notNull(),
    originCountry: text("origin_country").notNull(),
    destinationCountry: text("destination_country").notNull(),
    dataCategories: text("data_categories").notNull(),
    purpose: text("purpose").notNull(),
    transferBasis: text("transfer_basis").notNull(),
    approvalEvidence: text("approval_evidence"),
    legalReviewStatus: text("legal_review_status").notNull().default("pending"),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }).notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cross_border_transfers_org_review_idx").on(
      t.organisationId,
      t.nextReviewAt,
    ),
  ],
);

export const tenders = pgTable(
  "tenders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    procuringEntity: text("procuring_entity").notNull(),
    jurisdiction: text("jurisdiction").notNull().default("NG"),
    fundingSource: text("funding_source"),
    procurementCategory: text("procurement_category"),
    sourceType: text("source_type").notNull(),
    sourceLicenceReference: text("source_licence_reference"),
    submissionDeadline: timestamp("submission_deadline", {
      withTimezone: true,
    }),
    status: text("status").notNull().default("identified"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tenders_org_reference_unique").on(
      t.organisationId,
      t.reference,
    ),
  ],
);

export const tenderLots = pgTable(
  "tender_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "cascade" }),
    lotReference: text("lot_reference").notNull(),
    title: text("title"),
    submissionDeadline: timestamp("submission_deadline", {
      withTimezone: true,
    }),
    status: text("status").notNull().default("active"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tender_lots_tender_reference_unique").on(
      t.tenderId,
      t.lotReference,
    ),
  ],
);

export const engagementTenderLots = pgTable(
  "engagement_tender_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tenderId: uuid("tender_id")
      .notNull()
      .references(() => tenders.id, { onDelete: "restrict" }),
    tenderLotId: uuid("tender_lot_id")
      .notNull()
      .references(() => tenderLots.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("engagement_tender_lots_project_lot_unique").on(
      t.projectId,
      t.tenderLotId,
    ),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    expectedBytes: pgBigint("expected_bytes", { mode: "number" }).notNull(),
    receivedBytes: pgBigint("received_bytes", { mode: "number" })
      .notNull()
      .default(0),
    expectedSha256: text("expected_sha256"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("upload_sessions_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    supersedesVersionId: uuid("supersedes_version_id"),
    objectPath: text("object_path").notNull(),
    sha256: text("sha256").notNull(),
    detectedMime: text("detected_mime").notNull(),
    detectedFormat: text("detected_format").notNull(),
    sizeBytes: pgBigint("size_bytes", { mode: "number" }).notNull(),
    pageCount: integer("page_count"),
    malwareStatus: text("malware_status").notNull().default("pending"),
    quarantineStatus: text("quarantine_status")
      .notNull()
      .default("quarantined"),
    integrityManifest: text("integrity_manifest").notNull(),
    addendumStatus: text("addendum_status").notNull().default("not_assessed"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("document_versions_document_number_unique").on(
      t.documentId,
      t.versionNumber,
    ),
    uniqueIndex("document_versions_org_hash_unique").on(
      t.organisationId,
      t.sha256,
    ),
  ],
);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    documentVersionId: uuid("document_version_id").references(
      () => documentVersions.id,
      { onDelete: "cascade" },
    ),
    jobType: text("job_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorSummary: text("last_error_summary"),
    progressPercent: integer("progress_percent").notNull().default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("processing_jobs_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
    index("processing_jobs_status_available_priority_idx").on(
      t.status,
      t.availableAt,
      t.priority,
    ),
  ],
);

export const modelConfigurations = pgTable(
  "model_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    configuration: text("configuration").notNull(),
    status: text("status").notNull().default("draft"),
    evaluationRunId: uuid("evaluation_run_id"),
    promotedByUserId: uuid("promoted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("model_configs_scope_task_version_unique").on(
      t.organisationId,
      t.task,
      t.configurationVersion,
    ),
  ],
);

export const promptConfigurations = pgTable(
  "prompt_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    task: text("task").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    templateHash: text("template_hash").notNull(),
    schemaVersion: text("schema_version").notNull(),
    status: text("status").notNull().default("draft"),
    evaluationRunId: uuid("evaluation_run_id"),
    promotedByUserId: uuid("promoted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_configs_scope_task_version_unique").on(
      t.organisationId,
      t.task,
      t.promptVersion,
    ),
  ],
);

export const processingRuns = pgTable(
  "processing_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => processingJobs.id, { onDelete: "cascade" }),
    runType: text("run_type").notNull(),
    provider: text("provider").notNull(),
    modelConfigurationId: uuid("model_configuration_id").references(
      () => modelConfigurations.id,
      { onDelete: "restrict" },
    ),
    promptConfigurationId: uuid("prompt_configuration_id").references(
      () => promptConfigurations.id,
      { onDelete: "restrict" },
    ),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    status: text("status").notNull().default("running"),
    latencyMs: integer("latency_ms"),
    costMinor: pgBigint("cost_minor", { mode: "bigint" }),
    costCurrency: text("cost_currency"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    confidenceCalibrationVersion: text("confidence_calibration_version"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("processing_runs_org_job_idx").on(t.organisationId, t.jobId)],
);

export const requirementCitations = pgTable(
  "requirement_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    pageNumber: integer("page_number"),
    paragraphRef: text("paragraph_ref"),
    tableRef: text("table_ref"),
    coordinateJson: text("coordinate_json"),
    sourceSnippet: text("source_snippet").notNull(),
    sourceSnippetHash: text("source_snippet_hash").notNull(),
    verificationStatus: text("verification_status")
      .notNull()
      .default("pending"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("requirement_citations_requirement_idx").on(
      t.requirementId,
      t.verificationStatus,
    ),
  ],
);

export const workTasks = pgTable(
  "work_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id").references(() => requirements.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    ownerMembershipId: uuid("owner_membership_id").references(
      () => organisationMemberships.id,
      { onDelete: "set null" },
    ),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("work_tasks_org_owner_status_due_idx").on(
      t.organisationId,
      t.ownerMembershipId,
      t.status,
      t.dueAt,
    ),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    body: text("body").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("comments_org_object_idx").on(
      t.organisationId,
      t.objectType,
      t.objectId,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    reviewType: text("review_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    reviewerUserId: uuid("reviewer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    findings: text("findings"),
    sourceVersion: integer("source_version").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reviews_org_type_status_idx").on(
      t.organisationId,
      t.reviewType,
      t.status,
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    approvalType: text("approval_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    decision: text("decision").notNull().default("pending"),
    reason: text("reason"),
    evidenceSnapshotHash: text("evidence_snapshot_hash"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("approvals_org_type_decision_idx").on(
      t.organisationId,
      t.approvalType,
      t.decision,
    ),
  ],
);

export const defectDecisions = pgTable(
  "defect_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    defectId: uuid("defect_id")
      .notNull()
      .references(() => defects.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    fromSeverity: text("from_severity").notNull(),
    proposedSeverity: text("proposed_severity"),
    reason: text("reason").notNull(),
    evidenceIds: text("evidence_ids").notNull(),
    initiatedByUserId: uuid("initiated_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("defect_decisions_defect_status_idx").on(t.defectId, t.status)],
);

export const vaultItemVersions = pgTable(
  "vault_item_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vaultItemId: uuid("vault_item_id")
      .notNull()
      .references(() => vaultItems.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    issueDate: timestamp("issue_date", { withTimezone: true }),
    expiryDate: timestamp("expiry_date", { withTimezone: true }),
    issuingAuthority: text("issuing_authority"),
    verificationState: text("verification_state")
      .notNull()
      .default("unverified"),
    restrictions: text("restrictions"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("vault_item_versions_item_number_unique").on(
      t.vaultItemId,
      t.versionNumber,
    ),
  ],
);

export const vaultUsage = pgTable(
  "vault_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vaultItemVersionId: uuid("vault_item_version_id")
      .notNull()
      .references(() => vaultItemVersions.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    usedByUserId: uuid("used_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vault_usage_org_project_idx").on(t.organisationId, t.projectId),
  ],
);

export const capabilityVersions = pgTable(
  "capability_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    capabilityItemId: uuid("capability_item_id")
      .notNull()
      .references(() => capabilityItems.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    approvedClaim: text("approved_claim").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    restrictions: text("restrictions"),
    approvalState: text("approval_state").notNull().default("draft"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("capability_versions_item_number_unique").on(
      t.capabilityItemId,
      t.versionNumber,
    ),
  ],
);

export const capabilityEvidenceLinks = pgTable(
  "capability_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    capabilityVersionId: uuid("capability_version_id")
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: "cascade" }),
    vaultItemVersionId: uuid("vault_item_version_id").references(
      () => vaultItemVersions.id,
      { onDelete: "restrict" },
    ),
    documentVersionId: uuid("document_version_id").references(
      () => documentVersions.id,
      { onDelete: "restrict" },
    ),
    citation: text("citation").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("capability_evidence_links_version_idx").on(t.capabilityVersionId),
  ],
);

export const capabilityUsage = pgTable(
  "capability_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    capabilityVersionId: uuid("capability_version_id")
      .notNull()
      .references(() => capabilityVersions.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    draftClaimId: uuid("draft_claim_id"),
    usedByUserId: uuid("used_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("capability_usage_org_project_idx").on(t.organisationId, t.projectId),
  ],
);

export const boqRuns = pgTable(
  "boq_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "restrict" }),
    rulePackId: text("rule_pack_id").notNull(),
    verifierVersion: text("verifier_version").notNull(),
    workbookManifest: text("workbook_manifest").notNull(),
    status: text("status").notNull().default("running"),
    exceptionCount: integer("exception_count").notNull().default(0),
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    version: optimisticVersion(),
  },
  (t) => [
    index("boq_runs_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const boqExceptions = pgTable(
  "boq_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    boqRunId: uuid("boq_run_id")
      .notNull()
      .references(() => boqRuns.id, { onDelete: "cascade" }),
    lotReference: text("lot_reference"),
    sheetName: text("sheet_name"),
    cellReference: text("cell_reference"),
    exceptionCode: text("exception_code").notNull(),
    severity: text("severity").notNull(),
    expectedMinor: pgBigint("expected_minor", { mode: "bigint" }),
    actualMinor: pgBigint("actual_minor", { mode: "bigint" }),
    currency: text("currency"),
    finding: text("finding").notNull(),
    status: text("status").notNull().default("open"),
    resolutionReason: text("resolution_reason"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("boq_exceptions_run_status_idx").on(t.boqRunId, t.status)],
);

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    currentVersionNumber: integer("current_version_number")
      .notNull()
      .default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("drafts_project_section_unique").on(t.projectId, t.sectionKey),
  ],
);

export const draftVersions = pgTable(
  "draft_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceRequirementVersionSnapshot: text(
      "source_requirement_version_snapshot",
    ).notNull(),
    authorType: text("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    modelRunId: uuid("model_run_id").references(() => processingRuns.id, {
      onDelete: "restrict",
    }),
    changeSummary: text("change_summary"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("draft_versions_draft_number_unique").on(
      t.draftId,
      t.versionNumber,
    ),
  ],
);

export const draftClaims = pgTable(
  "draft_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    draftVersionId: uuid("draft_version_id")
      .notNull()
      .references(() => draftVersions.id, { onDelete: "cascade" }),
    claimKey: text("claim_key").notNull(),
    claimText: text("claim_text").notNull(),
    claimKind: text("claim_kind").notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    groundingStatus: text("grounding_status").notNull().default("unverified"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("draft_claims_version_key_unique").on(
      t.draftVersionId,
      t.claimKey,
    ),
  ],
);

export const claimEvidenceLinks = pgTable(
  "claim_evidence_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    draftClaimId: uuid("draft_claim_id")
      .notNull()
      .references(() => draftClaims.id, { onDelete: "cascade" }),
    capabilityVersionId: uuid("capability_version_id").references(
      () => capabilityVersions.id,
      { onDelete: "restrict" },
    ),
    vaultItemVersionId: uuid("vault_item_version_id").references(
      () => vaultItemVersions.id,
      { onDelete: "restrict" },
    ),
    documentVersionId: uuid("document_version_id").references(
      () => documentVersions.id,
      { onDelete: "restrict" },
    ),
    evidenceCitation: text("evidence_citation").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("claim_evidence_links_claim_idx").on(t.draftClaimId)],
);

export const redTeamRuns = pgTable(
  "red_team_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    policyVersion: text("policy_version").notNull(),
    status: text("status").notNull().default("running"),
    initiatedByUserId: uuid("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("red_team_runs_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const redTeamFindings = pgTable(
  "red_team_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    redTeamRunId: uuid("red_team_run_id")
      .notNull()
      .references(() => redTeamRuns.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    severity: text("severity").notNull(),
    objectType: text("object_type"),
    objectId: uuid("object_id"),
    finding: text("finding").notNull(),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("red_team_findings_run_status_idx").on(t.redTeamRunId, t.status),
  ],
);

export const packages = pgTable(
  "packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    packageType: text("package_type").notNull(),
    status: text("status").notNull().default("draft"),
    currentVersionNumber: integer("current_version_number")
      .notNull()
      .default(0),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("packages_org_project_status_idx").on(
      t.organisationId,
      t.projectId,
      t.status,
    ),
  ],
);

export const packageVersions = pgTable(
  "package_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageId: uuid("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    sourceSnapshotHash: text("source_snapshot_hash").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    docxObjectPath: text("docx_object_path"),
    docxSha256: text("docx_sha256"),
    pdfObjectPath: text("pdf_object_path"),
    pdfSha256: text("pdf_sha256"),
    zipObjectPath: text("zip_object_path"),
    zipSha256: text("zip_sha256"),
    renderQaStatus: text("render_qa_status").notNull().default("pending"),
    readinessSnapshot: text("readiness_snapshot").notNull(),
    generatedByUserId: uuid("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("package_versions_package_number_unique").on(
      t.packageId,
      t.versionNumber,
    ),
  ],
);

export const packageManifestItems = pgTable(
  "package_manifest_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageVersionId: uuid("package_version_id")
      .notNull()
      .references(() => packageVersions.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    itemType: text("item_type").notNull(),
    sourceObjectId: uuid("source_object_id"),
    sourceVersion: integer("source_version"),
    filename: text("filename").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: pgBigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("package_manifest_items_version_ordinal_unique").on(
      t.packageVersionId,
      t.ordinal,
    ),
  ],
);

export const packageSignoffs = pgTable(
  "package_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageVersionId: uuid("package_version_id")
      .notNull()
      .references(() => packageVersions.id, { onDelete: "restrict" }),
    signerUserId: uuid("signer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signerRole: text("signer_role").notNull(),
    signerAuthority: text("signer_authority").notNull(),
    intentStatement: text("intent_statement").notNull(),
    documentHash: text("document_hash").notNull(),
    trustedTimestamp: timestamp("trusted_timestamp", {
      withTimezone: true,
    }).notNull(),
    mfaEvidence: text("mfa_evidence").notNull(),
    deviceEventEvidence: text("device_event_evidence").notNull(),
    certificateVerification: text("certificate_verification"),
    auditEventId: uuid("audit_event_id")
      .notNull()
      .references(() => auditEvents.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("package_signoffs_version_signer_unique").on(
      t.packageVersionId,
      t.signerUserId,
    ),
  ],
);

export const exportDeliveries = pgTable(
  "export_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    packageVersionId: uuid("package_version_id")
      .notNull()
      .references(() => packageVersions.id, { onDelete: "restrict" }),
    deliveryChannel: text("delivery_channel").notNull(),
    recipientReference: text("recipient_reference"),
    signedUrlExpiresAt: timestamp("signed_url_expires_at", {
      withTimezone: true,
    }),
    deliveryReceiptHash: text("delivery_receipt_hash"),
    status: text("status").notNull().default("pending"),
    exportedByUserId: uuid("exported_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    exportedAt: timestamp("exported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: optimisticVersion(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("export_deliveries_org_status_idx").on(t.organisationId, t.status),
  ],
);

export const priceBooks = pgTable(
  "price_books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_books_scope_name_version_unique").on(
      t.organisationId,
      t.name,
      t.versionNumber,
    ),
  ],
);

export const priceBookEntries = pgTable(
  "price_book_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    productKind: text("product_kind").notNull(),
    currency: text("currency").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    minorUnitDigits: integer("minor_unit_digits").notNull().default(2),
    billingCadence: text("billing_cadence"),
    usageConfiguration: text("usage_configuration"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("price_book_entries_book_product_unique").on(
      t.priceBookId,
      t.productCode,
    ),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    priceBookEntryId: uuid("price_book_entry_id")
      .notNull()
      .references(() => priceBookEntries.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull().default(1),
    unitAmountMinor: pgBigint("unit_amount_minor", {
      mode: "bigint",
    }).notNull(),
    totalAmountMinor: pgBigint("total_amount_minor", {
      mode: "bigint",
    }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    placedByUserId: uuid("placed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    priceBookEntryId: uuid("price_book_entry_id")
      .notNull()
      .references(() => priceBookEntries.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    currentPeriodEndsAt: timestamp("current_period_ends_at", {
      withTimezone: true,
    }),
    cancelsAt: timestamp("cancels_at", { withTimezone: true }),
    providerReference: text("provider_reference"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscriptions_org_status_idx").on(t.organisationId, t.status)],
);

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "restrict",
    }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "restrict",
    }),
    productKind: text("product_kind").notNull(),
    status: text("status").notNull().default("pending"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    usageLimit: integer("usage_limit"),
    usageConsumed: integer("usage_consumed").notNull().default(0),
    paymentState: text("payment_state").notNull().default("pending"),
    featureFlagKey: text("feature_flag_key"),
    rulesVersion: text("rules_version").notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("entitlements_org_kind_status_idx").on(
      t.organisationId,
      t.productKind,
      t.status,
    ),
  ],
);

export const entitlementUsage = pgTable(
  "entitlement_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => entitlements.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    units: integer("units").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("entitlement_usage_entitlement_key_unique").on(
      t.entitlementId,
      t.idempotencyKey,
    ),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull(),
    currency: text("currency").notNull(),
    netAmountMinor: pgBigint("net_amount_minor", { mode: "bigint" }).notNull(),
    vatRateBasisPoints: integer("vat_rate_basis_points").notNull(),
    vatAmountMinor: pgBigint("vat_amount_minor", { mode: "bigint" }).notNull(),
    grossAmountMinor: pgBigint("gross_amount_minor", {
      mode: "bigint",
    }).notNull(),
    whtRateBasisPoints: integer("wht_rate_basis_points"),
    whtAmountMinor: pgBigint("wht_amount_minor", { mode: "bigint" }),
    netPayableMinor: pgBigint("net_payable_minor", {
      mode: "bigint",
    }).notNull(),
    taxRuleId: text("tax_rule_id").notNull(),
    taxPointAt: timestamp("tax_point_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_org_number_unique").on(
      t.organisationId,
      t.invoiceNumber,
    ),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => orders.id, {
    onDelete: "restrict",
  }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitAmountMinor: pgBigint("unit_amount_minor", { mode: "bigint" }).notNull(),
  lineAmountMinor: pgBigint("line_amount_minor", { mode: "bigint" }).notNull(),
  createdAt: createdAt(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id").references(() => invoices.id, {
      onDelete: "restrict",
    }),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    amountMinor: pgBigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    status: text("status").notNull().default("pending"),
    reconciliationStatus: text("reconciliation_status")
      .notNull()
      .default("pending"),
    providerEventHash: text("provider_event_hash"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_reference_unique").on(
      t.provider,
      t.providerReference,
    ),
    uniqueIndex("payments_org_idempotency_unique").on(
      t.organisationId,
      t.idempotencyKey,
    ),
  ],
);

export const integrationConfigurations = pgTable(
  "integration_configurations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    adapterType: text("adapter_type").notNull(),
    provider: text("provider").notNull(),
    environment: text("environment").notNull(),
    secretReference: text("secret_reference"),
    configuration: text("configuration").notNull(),
    productionApproved: boolean("production_approved").notNull().default(false),
    status: text("status").notNull().default("disabled"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("integration_configs_scope_type_provider_unique").on(
      t.organisationId,
      t.adapterType,
      t.provider,
    ),
  ],
);

export const integrationReceipts = pgTable(
  "integration_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    adapterType: text("adapter_type").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    payloadHash: text("payload_hash").notNull(),
    signatureStatus: text("signature_status").notNull(),
    processingStatus: text("processing_status").notNull().default("received"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("integration_receipts_type_event_unique").on(
      t.adapterType,
      t.providerEventId,
    ),
  ],
);

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    notificationEventId: uuid("notification_event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    provider: text("provider").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    responseCode: text("response_code"),
    responseSummary: text("response_summary"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notification_attempt_event_number_unique").on(
      t.notificationEventId,
      t.attemptNumber,
    ),
    uniqueIndex("notification_attempt_idempotency_unique").on(t.idempotencyKey),
  ],
);

export const retentionActions = pgTable(
  "retention_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    retentionRequestId: uuid("retention_request_id").references(
      () => retentionRequests.id,
      { onDelete: "restrict" },
    ),
    legalHoldId: uuid("legal_hold_id").references(() => legalHolds.id, {
      onDelete: "restrict",
    }),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull().default("pending"),
    evidence: text("evidence"),
    executedByUserId: uuid("executed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("retention_actions_org_status_idx").on(t.organisationId, t.status),
  ],
);

export const deletionCertificates = pgTable(
  "deletion_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    retentionActionId: uuid("retention_action_id")
      .notNull()
      .references(() => retentionActions.id, { onDelete: "restrict" }),
    certificateNumber: text("certificate_number").notNull(),
    scopeManifestHash: text("scope_manifest_hash").notNull(),
    method: text("method").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    exceptions: text("exceptions"),
    signedByUserId: uuid("signed_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signatureEvidence: text("signature_evidence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deletion_certificates_org_number_unique").on(
      t.organisationId,
      t.certificateNumber,
    ),
  ],
);

export const evaluationCases = pgTable(
  "evaluation_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    corpusVersion: text("corpus_version").notNull(),
    split: text("split").notNull(),
    task: text("task").notNull(),
    fixtureReference: text("fixture_reference").notNull(),
    labelHash: text("label_hash").notNull(),
    fatalLabelCount: integer("fatal_label_count").notNull().default(0),
    likelyFatalLabelCount: integer("likely_fatal_label_count")
      .notNull()
      .default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("evaluation_cases_corpus_fixture_unique").on(
      t.corpusVersion,
      t.fixtureReference,
    ),
  ],
);

export const evaluationRuns = pgTable(
  "evaluation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "restrict",
    }),
    task: text("task").notNull(),
    corpusVersion: text("corpus_version").notNull(),
    modelConfigurationId: uuid("model_configuration_id").references(
      () => modelConfigurations.id,
      { onDelete: "restrict" },
    ),
    promptConfigurationId: uuid("prompt_configuration_id").references(
      () => promptConfigurations.id,
      { onDelete: "restrict" },
    ),
    status: text("status").notNull().default("running"),
    sampleSize: integer("sample_size").notNull().default(0),
    metrics: text("metrics"),
    limitations: text("limitations"),
    releaseDecision: text("release_decision").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("evaluation_runs_task_status_idx").on(t.task, t.status)],
);

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    evaluationRunId: uuid("evaluation_run_id")
      .notNull()
      .references(() => evaluationRuns.id, { onDelete: "cascade" }),
    evaluationCaseId: uuid("evaluation_case_id")
      .notNull()
      .references(() => evaluationCases.id, { onDelete: "restrict" }),
    passed: boolean("passed").notNull(),
    resultMetrics: text("result_metrics").notNull(),
    outputHash: text("output_hash"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("evaluation_results_run_case_unique").on(
      t.evaluationRunId,
      t.evaluationCaseId,
    ),
  ],
);

export const jurisdictionRulePacks = pgTable(
  "jurisdiction_rule_packs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packKey: text("pack_key").notNull(),
    version: text("version").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    sourceManifestHash: text("source_manifest_hash").notNull(),
    advisoryOnly: boolean("advisory_only").notNull().default(true),
    status: text("status").notNull().default("draft"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("jurisdiction_rule_packs_key_version_unique").on(
      t.packKey,
      t.version,
    ),
  ],
);

export const jurisdictionRules = pgTable(
  "jurisdiction_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rulePackId: uuid("rule_pack_id")
      .notNull()
      .references(() => jurisdictionRulePacks.id, { onDelete: "cascade" }),
    ruleKey: text("rule_key").notNull(),
    domain: text("domain").notNull(),
    instrument: text("instrument").notNull(),
    sourceUrls: text("source_urls").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    entityScope: text("entity_scope").notNull(),
    categoryScope: text("category_scope").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    monetaryBands: text("monetary_bands"),
    approvalOwner: text("approval_owner"),
    evidenceRequirements: text("evidence_requirements").notNull(),
    severity: text("severity").notNull(),
    legalReviewStatus: text("legal_review_status").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    supersedes: text("supersedes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("jurisdiction_rules_pack_key_unique").on(
      t.rulePackId,
      t.ruleKey,
    ),
  ],
);

export const ruleEvaluations = pgTable(
  "rule_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    jurisdictionRuleId: uuid("jurisdiction_rule_id")
      .notNull()
      .references(() => jurisdictionRules.id, { onDelete: "restrict" }),
    inputSnapshotHash: text("input_snapshot_hash").notNull(),
    result: text("result").notNull(),
    advisoryMessage: text("advisory_message").notNull(),
    evidenceSnapshot: text("evidence_snapshot"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("rule_evaluations_org_project_idx").on(t.organisationId, t.projectId),
  ],
);

export const ruleOverrides = pgTable(
  "rule_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    ruleEvaluationId: uuid("rule_evaluation_id")
      .notNull()
      .references(() => ruleEvaluations.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    evidence: text("evidence").notNull(),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("rule_overrides_evaluation_unique").on(t.ruleEvaluationId),
  ],
);

export const partnerBranding = pgTable(
  "partner_branding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganisationId: uuid("partner_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    brandName: text("brand_name").notNull(),
    logoObjectPath: text("logo_object_path"),
    primaryColour: text("primary_colour"),
    secondaryColour: text("secondary_colour"),
    footerText: text("footer_text"),
    status: text("status").notNull().default("draft"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("partner_branding_partner_unique").on(t.partnerOrganisationId),
  ],
);

export const partnerRevenueShareEntries = pgTable(
  "partner_revenue_share_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerOrganisationId: uuid("partner_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    clientOrganisationId: uuid("client_organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    currency: text("currency").notNull(),
    grossRevenueMinor: pgBigint("gross_revenue_minor", {
      mode: "bigint",
    }).notNull(),
    shareRateBasisPoints: integer("share_rate_basis_points").notNull(),
    shareAmountMinor: pgBigint("share_amount_minor", {
      mode: "bigint",
    }).notNull(),
    ruleVersion: text("rule_version").notNull(),
    status: text("status").notNull().default("pending"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("partner_revenue_share_partner_period_idx").on(
      t.partnerOrganisationId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export const benchmarkConsents = pgTable(
  "benchmark_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    consentRecordId: uuid("consent_record_id")
      .notNull()
      .references(() => consentRecords.id, { onDelete: "restrict" }),
    scope: text("scope").notNull(),
    status: text("status").notNull().default("active"),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("benchmark_consents_org_status_idx").on(t.organisationId, t.status),
  ],
);

export const benchmarkCohorts = pgTable(
  "benchmark_cohorts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortKey: text("cohort_key").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    definition: text("definition").notNull(),
    minimumCohortSize: integer("minimum_cohort_size").notNull(),
    differencingControls: text("differencing_controls").notNull(),
    suppressionPolicy: text("suppression_policy").notNull(),
    status: text("status").notNull().default("draft"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("benchmark_cohorts_key_version_unique").on(
      t.cohortKey,
      t.definitionVersion,
    ),
  ],
);

export const benchmarkReleases = pgTable(
  "benchmark_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cohortId: uuid("cohort_id")
      .notNull()
      .references(() => benchmarkCohorts.id, { onDelete: "restrict" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    consentSnapshotHash: text("consent_snapshot_hash").notNull(),
    contributingOrganisationCount: integer(
      "contributing_organisation_count",
    ).notNull(),
    suppressed: boolean("suppressed").notNull().default(true),
    aggregatePayload: text("aggregate_payload"),
    disclosureReview: text("disclosure_review").notNull(),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("benchmark_releases_cohort_period_unique").on(
      t.cohortId,
      t.periodStart,
      t.periodEnd,
    ),
  ],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    capturedByUserId: uuid("captured_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    clientConfirmed: boolean("client_confirmed").notNull().default(false),
    debriefReference: text("debrief_reference"),
    reasons: text("reasons"),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("outcomes_project_unique").on(t.projectId)],
);

export const renewalMonitors = pgTable(
  "renewal_monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    vaultItemVersionId: uuid("vault_item_version_id")
      .notNull()
      .references(() => vaultItemVersions.id, { onDelete: "cascade" }),
    nextNotificationAt: timestamp("next_notification_at", {
      withTimezone: true,
    }).notNull(),
    cadenceDays: integer("cadence_days").notNull(),
    status: text("status").notNull().default("active"),
    lastNotificationEventId: uuid("last_notification_event_id").references(
      () => notificationEvents.id,
      { onDelete: "set null" },
    ),
    version: optimisticVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("renewal_monitors_status_next_idx").on(
      t.status,
      t.nextNotificationAt,
    ),
  ],
);

export const auditAnchors = pgTable(
  "audit_anchors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "restrict" }),
    firstSequence: integer("first_sequence").notNull(),
    lastSequence: integer("last_sequence").notNull(),
    chainHeadHash: text("chain_head_hash").notNull(),
    provider: text("provider").notNull(),
    immutableObjectReference: text("immutable_object_reference").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    receiptSignature: text("receipt_signature"),
    anchoredAt: timestamp("anchored_at", { withTimezone: true }).notNull(),
    verificationStatus: text("verification_status")
      .notNull()
      .default("pending"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("audit_anchors_provider_reference_unique").on(
      t.provider,
      t.immutableObjectReference,
    ),
    index("audit_anchors_organisation_sequence_idx").on(
      t.organisationId,
      t.lastSequence,
    ),
  ],
);
