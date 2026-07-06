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
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  role: text("role").notNull().default("none"),
  status: text("status").notNull().default("active"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sector: text("sector"),
  segment: text("segment"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  ndaStatus: text("nda_status").notNull().default("pending"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  paymentConfirmedAt: timestamp("payment_confirmed_at", { withTimezone: true }),
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
  scope: text("scope"),
  limitations: text("limitations"),
  responsivenessReview: text("responsiveness_review"),
  responsivenessSuggested: boolean("responsiveness_suggested")
    .notNull()
    .default(false),
  createdAt: createdAt(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const requirements = pgTable("requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  reviewedBy: uuid("reviewed_by").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedByName: text("reviewed_by_name"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const evidenceItems = pgTable("evidence_items", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const defects = pgTable("defects", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const boqChecks = pgTable("boq_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  computedExtensionKobo: pgBigint("computed_extension_kobo", { mode: "number" }),
  checkType: text("check_type").notNull(),
  finding: text("finding").notNull(),
  severity: text("severity").notNull().default("scoring_risk"),
  status: text("status").notNull().default("flagged"),
  createdAt: createdAt(),
});

export const vaultItems = pgTable("vault_items", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const capabilityItems = pgTable("capability_items", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const conflictRecords = pgTable("conflict_records", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const notificationEvents = pgTable("notification_events", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const retentionRequests = pgTable("retention_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  createdAt: createdAt(),
});

export const sbdTemplates = pgTable("sbd_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("goods"),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  issuingCircular: text("issuing_circular"),
  summary: text("summary"),
  createdAt: createdAt(),
});

export const sbdAnnotations = pgTable("sbd_annotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => sbdTemplates.id, { onDelete: "cascade" }),
  agency: text("agency"),
  section: text("section"),
  kind: text("kind").notNull().default("format"),
  quirk: text("quirk").notNull(),
  createdAt: createdAt(),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
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
  // Full provenance stamp (NFR-AUD-01): which prompt pack and model were in
  // service when this report version was generated.
  promptPackVersion: text("prompt_pack_version"),
  modelId: text("model_id"),
  signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
  generatedBy: uuid("generated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name"),
    projectId: uuid("project_id"),
    eventType: text("event_type").notNull(),
    objectType: text("object_type"),
    objectId: text("object_id"),
    details: text("details"),
    // Tamper-evident hash chain (FR-WFM-02). `seq` is a contiguous 1-based
    // position assigned under an advisory lock; `hash` = SHA-256 over the
    // previous event's hash plus this event's canonical payload. Null on rows
    // that predate the chain (legacy prefix). The unique index is a backstop:
    // if serialisation ever fails, the fork errors out instead of silently
    // corrupting the chain.
    seq: integer("seq"),
    prevHash: text("prev_hash"),
    hash: text("hash"),
    // DB-assigned monotonic ordinal (cannot be backdated by a plain INSERT the
    // way created_at can); the verifier uses it to spot unchained rows written
    // after the chain started.
    rowNo: bigserial("row_no", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("audit_events_seq_unique").on(t.seq)],
);

export const llmRuns = pgTable("llm_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  task: text("task").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  inputHash: text("input_hash"),
  outputSummary: text("output_summary"),
  error: text("error"),
  createdAt: createdAt(),
});
