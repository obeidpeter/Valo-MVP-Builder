import {
  pgTable,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  uuid,
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
  deadline: text("deadline"),
  valueBand: text("value_band"),
  segment: text("segment"),
  submissionStatus: text("submission_status"),
  status: text("status").notNull().default("intake"),
  reviewerId: uuid("reviewer_id").references(() => users.id, {
    onDelete: "set null",
  }),
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
  reviewerId: uuid("reviewer_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewerName: text("reviewer_name"),
  attestation: text("attestation"),
  engineVersion: text("engine_version"),
  signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
  generatedBy: uuid("generated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  userName: text("user_name"),
  projectId: uuid("project_id"),
  eventType: text("event_type").notNull(),
  objectType: text("object_type"),
  objectId: text("object_id"),
  details: text("details"),
  createdAt: createdAt(),
});

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
