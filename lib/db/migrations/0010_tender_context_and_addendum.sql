-- Version-bound source material and tender-specific decision support.
-- These records are additive, tenant-scoped and advisory. They do not confer
-- legal/compliance clearance, responsiveness, submission approval or award.
CREATE TABLE "document_version_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "document_version_sha256" text NOT NULL,
  "captured_redaction_status" text NOT NULL,
  "canonical_text" text NOT NULL,
  "canonical_text_sha256" text NOT NULL,
  "structured_snapshot" text,
  "structured_snapshot_sha256" text,
  "extraction_method" text NOT NULL,
  "parser_version" text NOT NULL,
  "status" text DEFAULT 'captured' NOT NULL,
  "captured_by_user_id" uuid NOT NULL,
  "captured_by_name" text NOT NULL,
  "verified_by_user_id" uuid,
  "verified_by_name" text,
  "verified_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "document_version_snapshots_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "document_version_snapshots_document_version_id_document_versions_id_fk"
    FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "document_version_snapshots_captured_by_user_id_users_id_fk"
    FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "document_version_snapshots_verified_by_user_id_users_id_fk"
    FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "document_version_snapshots_version_sha256_check"
    CHECK ("document_version_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "document_version_snapshots_text_sha256_check"
    CHECK ("canonical_text_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "document_version_snapshots_structured_pair_check"
    CHECK (("structured_snapshot" IS NULL) = ("structured_snapshot_sha256" IS NULL)),
  CONSTRAINT "document_version_snapshots_structured_sha256_check"
    CHECK ("structured_snapshot_sha256" IS NULL OR "structured_snapshot_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "document_version_snapshots_status_check"
    CHECK ("status" IN ('captured', 'verified', 'rejected')),
  CONSTRAINT "document_version_snapshots_redaction_status_check"
    CHECK ("captured_redaction_status" IN ('included', 'redacted')),
  CONSTRAINT "document_version_snapshots_review_stamp_check"
    CHECK (
      ("status" = 'captured' AND "verified_by_user_id" IS NULL
        AND "verified_by_name" IS NULL AND "verified_at" IS NULL)
      OR
      ("status" IN ('verified', 'rejected') AND "verified_by_user_id" IS NOT NULL
        AND "verified_by_user_id" <> "captured_by_user_id"
        AND "verified_by_name" IS NOT NULL AND "verified_at" IS NOT NULL)
    ),
  CONSTRAINT "document_version_snapshots_content_bounds_check"
    CHECK (
      char_length("canonical_text") BETWEEN 1 AND 2000000
      AND ("structured_snapshot" IS NULL
        OR char_length("structured_snapshot") BETWEEN 1 AND 256000)
      AND char_length("extraction_method") BETWEEN 1 AND 120
      AND char_length("parser_version") BETWEEN 1 AND 120
    ),
  CONSTRAINT "document_version_snapshots_reviewer_name_bounds_check"
    CHECK (char_length("captured_by_name") BETWEEN 1 AND 200
      AND ("verified_by_name" IS NULL
        OR char_length("verified_by_name") BETWEEN 1 AND 200))
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_version_snapshots_version_unique"
  ON "document_version_snapshots" ("document_version_id");
--> statement-breakpoint
CREATE INDEX "document_version_snapshots_org_created_idx"
  ON "document_version_snapshots" ("organisation_id", "created_at", "id");
--> statement-breakpoint

CREATE TABLE "tender_context_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "supersedes_context_version_id" uuid,
  "primary_document_version_id" uuid NOT NULL,
  "jurisdiction_rule_pack_id" uuid NOT NULL,
  "legal_entity_name" text NOT NULL,
  "submission_date" date NOT NULL,
  "jurisdiction" text NOT NULL,
  "entity_scopes" text NOT NULL,
  "category_scopes" text NOT NULL,
  "source_manifest" text NOT NULL,
  "source_manifest_sha256" text NOT NULL,
  "context_snapshot" text NOT NULL,
  "context_sha256" text NOT NULL,
  "rule_advisories" text NOT NULL,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "reviewed_by_name" text,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tender_context_versions_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_versions_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "tender_context_versions_supersedes_fk"
    FOREIGN KEY ("supersedes_context_version_id") REFERENCES "public"."tender_context_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_versions_primary_document_version_id_document_versions_id_fk"
    FOREIGN KEY ("primary_document_version_id") REFERENCES "public"."document_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_versions_jurisdiction_rule_pack_id_jurisdiction_rule_packs_id_fk"
    FOREIGN KEY ("jurisdiction_rule_pack_id") REFERENCES "public"."jurisdiction_rule_packs"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_versions_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "tender_context_versions_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "tender_context_versions_source_sha256_check"
    CHECK ("source_manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_context_versions_context_sha256_check"
    CHECK ("context_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_context_versions_status_check"
    CHECK ("status" IN ('pending_review', 'accepted', 'needs_changes', 'rejected', 'superseded')),
  CONSTRAINT "tender_context_versions_review_stamp_check"
    CHECK (
      ("status" = 'pending_review' AND "reviewed_by_user_id" IS NULL
        AND "reviewed_by_name" IS NULL AND "reviewed_at" IS NULL)
      OR
      ("status" IN ('accepted', 'needs_changes', 'rejected')
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reviewed_by_name" IS NOT NULL AND "reviewed_at" IS NOT NULL)
      OR "status" = 'superseded'
    ),
  CONSTRAINT "tender_context_versions_bounds_check"
    CHECK (
      "version_number" > 0
      AND char_length("legal_entity_name") BETWEEN 1 AND 300
      AND char_length("jurisdiction") BETWEEN 2 AND 32
      AND char_length("entity_scopes") BETWEEN 2 AND 10000
      AND char_length("category_scopes") BETWEEN 2 AND 10000
      AND char_length("source_manifest") BETWEEN 2 AND 200000
      AND char_length("context_snapshot") BETWEEN 2 AND 500000
      AND char_length("rule_advisories") BETWEEN 2 AND 200000
      AND ("reviewed_by_name" IS NULL
        OR char_length("reviewed_by_name") BETWEEN 1 AND 200)
      AND ("review_note" IS NULL
        OR char_length("review_note") BETWEEN 1 AND 5000)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tender_context_versions_project_number_unique"
  ON "tender_context_versions" ("project_id", "version_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "tender_context_versions_org_project_hash_unique"
  ON "tender_context_versions" ("organisation_id", "project_id", "context_sha256");
--> statement-breakpoint
CREATE INDEX "tender_context_versions_org_project_created_idx"
  ON "tender_context_versions" ("organisation_id", "project_id", "created_at", "id");
--> statement-breakpoint

CREATE TABLE "tender_context_requirements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "tender_context_version_id" uuid NOT NULL,
  "requirement_id" uuid NOT NULL,
  "requirement_citation_id" uuid NOT NULL,
  "evidence_kind" text NOT NULL,
  "mandatory" boolean NOT NULL,
  "requires_current_on_submission_date" boolean NOT NULL,
  "requires_exact_legal_entity_match" boolean NOT NULL,
  "binding_sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tender_context_requirements_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_requirements_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "tender_context_requirements_tender_context_version_id_tender_context_versions_id_fk"
    FOREIGN KEY ("tender_context_version_id") REFERENCES "public"."tender_context_versions"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "tender_context_requirements_requirement_id_requirements_id_fk"
    FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_requirements_requirement_citation_id_requirement_citations_id_fk"
    FOREIGN KEY ("requirement_citation_id") REFERENCES "public"."requirement_citations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_requirements_binding_sha256_check"
    CHECK ("binding_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_context_requirements_evidence_kind_bounds_check"
    CHECK (char_length("evidence_kind") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tender_context_requirements_context_requirement_unique"
  ON "tender_context_requirements" ("tender_context_version_id", "requirement_id");
--> statement-breakpoint
CREATE INDEX "tender_context_requirements_org_project_idx"
  ON "tender_context_requirements" ("organisation_id", "project_id", "tender_context_version_id");
--> statement-breakpoint

CREATE TABLE "tender_context_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "tender_context_version_id" uuid NOT NULL,
  "vault_item_version_id" uuid NOT NULL,
  "document_version_id" uuid NOT NULL,
  "evidence_kind" text NOT NULL,
  "legal_entity_name" text,
  "citation_start_offset" integer NOT NULL,
  "citation_end_offset" integer NOT NULL,
  "citation_quote" text NOT NULL,
  "citation_quote_sha256" text NOT NULL,
  "binding_sha256" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tender_context_artifacts_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_artifacts_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "tender_context_artifacts_tender_context_version_id_tender_context_versions_id_fk"
    FOREIGN KEY ("tender_context_version_id") REFERENCES "public"."tender_context_versions"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "tender_context_artifacts_vault_item_version_id_vault_item_versions_id_fk"
    FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_artifacts_document_version_id_document_versions_id_fk"
    FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_context_artifacts_offsets_check"
    CHECK ("citation_start_offset" >= 0 AND "citation_end_offset" > "citation_start_offset"),
  CONSTRAINT "tender_context_artifacts_quote_sha256_check"
    CHECK ("citation_quote_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_context_artifacts_binding_sha256_check"
    CHECK ("binding_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_context_artifacts_bounds_check"
    CHECK (
      char_length("evidence_kind") BETWEEN 1 AND 120
      AND ("legal_entity_name" IS NULL
        OR char_length("legal_entity_name") BETWEEN 1 AND 300)
      AND char_length("citation_quote") BETWEEN 1 AND 20000
      AND "citation_end_offset" <= 5000000
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tender_context_artifacts_context_vault_kind_unique"
  ON "tender_context_artifacts" ("tender_context_version_id", "vault_item_version_id", "evidence_kind");
--> statement-breakpoint
CREATE INDEX "tender_context_artifacts_org_project_idx"
  ON "tender_context_artifacts" ("organisation_id", "project_id", "tender_context_version_id");
--> statement-breakpoint

CREATE TABLE "tender_eligibility_passports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "tender_context_version_id" uuid NOT NULL,
  "passport_id" text NOT NULL,
  "source_manifest_sha256" text NOT NULL,
  "result_snapshot" text NOT NULL,
  "result_snapshot_sha256" text NOT NULL,
  "result_status" text NOT NULL,
  "review_state" text DEFAULT 'pending_review' NOT NULL,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "reviewed_by_name" text,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tender_eligibility_passports_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_eligibility_passports_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "tender_eligibility_passports_tender_context_version_id_tender_context_versions_id_fk"
    FOREIGN KEY ("tender_context_version_id") REFERENCES "public"."tender_context_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "tender_eligibility_passports_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "tender_eligibility_passports_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "tender_eligibility_passports_source_sha256_check"
    CHECK ("source_manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_eligibility_passports_result_sha256_check"
    CHECK ("result_snapshot_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "tender_eligibility_passports_result_status_check"
    CHECK ("result_status" IN ('blocked', 'incomplete', 'review_required', 'ready_for_human_tender_review')),
  CONSTRAINT "tender_eligibility_passports_review_state_check"
    CHECK ("review_state" IN ('pending_review', 'accepted', 'needs_changes', 'rejected')),
  CONSTRAINT "tender_eligibility_passports_review_stamp_check"
    CHECK (
      ("review_state" = 'pending_review' AND "reviewed_by_user_id" IS NULL
        AND "reviewed_by_name" IS NULL AND "reviewed_at" IS NULL)
      OR
      ("review_state" IN ('accepted', 'needs_changes', 'rejected')
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reviewed_by_name" IS NOT NULL AND "reviewed_at" IS NOT NULL)
    ),
  CONSTRAINT "tender_eligibility_passports_bounds_check"
    CHECK (
      char_length("passport_id") BETWEEN 1 AND 128
      AND "passport_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND char_length("result_snapshot") BETWEEN 2 AND 1000000
      AND ("reviewed_by_name" IS NULL
        OR char_length("reviewed_by_name") BETWEEN 1 AND 200)
      AND ("review_note" IS NULL
        OR char_length("review_note") BETWEEN 1 AND 5000)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tender_eligibility_passports_org_project_passport_unique"
  ON "tender_eligibility_passports" ("organisation_id", "project_id", "passport_id");
--> statement-breakpoint
CREATE INDEX "tender_eligibility_passports_org_project_created_idx"
  ON "tender_eligibility_passports" ("organisation_id", "project_id", "created_at", "id");
--> statement-breakpoint

CREATE TABLE "addendum_impact_assessments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "baseline_document_version_id" uuid NOT NULL,
  "revision_document_version_id" uuid NOT NULL,
  "radar_id" text NOT NULL,
  "assessment_id" text NOT NULL,
  "source_manifest_sha256" text NOT NULL,
  "impact_manifest_sha256" text NOT NULL,
  "assessment_snapshot" text NOT NULL,
  "review_state" text DEFAULT 'pending_review' NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_by_name" text,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "applied_state" text DEFAULT 'not_applied' NOT NULL,
  "applied_by_user_id" uuid,
  "applied_by_name" text,
  "applied_at" timestamp with time zone,
  "apply_note" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "addendum_impact_assessments_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "addendum_impact_assessments_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "addendum_impact_assessments_baseline_document_version_id_document_versions_id_fk"
    FOREIGN KEY ("baseline_document_version_id") REFERENCES "public"."document_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "addendum_impact_assessments_revision_document_version_id_document_versions_id_fk"
    FOREIGN KEY ("revision_document_version_id") REFERENCES "public"."document_versions"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "addendum_impact_assessments_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "addendum_impact_assessments_applied_by_user_id_users_id_fk"
    FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "addendum_impact_assessments_distinct_versions_check"
    CHECK ("baseline_document_version_id" <> "revision_document_version_id"),
  CONSTRAINT "addendum_impact_assessments_source_sha256_check"
    CHECK ("source_manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "addendum_impact_assessments_impact_sha256_check"
    CHECK ("impact_manifest_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "addendum_impact_assessments_review_state_check"
    CHECK ("review_state" IN ('pending_review', 'accepted', 'needs_changes', 'rejected')),
  CONSTRAINT "addendum_impact_assessments_review_stamp_check"
    CHECK (
      ("review_state" = 'pending_review' AND "reviewed_by_user_id" IS NULL
        AND "reviewed_by_name" IS NULL AND "reviewed_at" IS NULL)
      OR
      ("review_state" IN ('accepted', 'needs_changes', 'rejected')
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reviewed_by_name" IS NOT NULL AND "reviewed_at" IS NOT NULL)
    ),
  CONSTRAINT "addendum_impact_assessments_applied_state_check"
    CHECK ("applied_state" IN ('not_applied', 'applied', 'application_rejected')),
  CONSTRAINT "addendum_impact_assessments_applied_stamp_check"
    CHECK (
      ("applied_state" = 'not_applied' AND "applied_by_user_id" IS NULL
        AND "applied_by_name" IS NULL AND "applied_at" IS NULL)
      OR
      ("applied_state" IN ('applied', 'application_rejected')
        AND "applied_by_user_id" IS NOT NULL
        AND "applied_by_name" IS NOT NULL AND "applied_at" IS NOT NULL)
    ),
  CONSTRAINT "addendum_impact_assessments_bounds_check"
    CHECK (
      char_length("radar_id") BETWEEN 1 AND 128
      AND "radar_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND char_length("assessment_id") BETWEEN 1 AND 128
      AND "assessment_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND char_length("assessment_snapshot") BETWEEN 2 AND 1000000
      AND ("reviewed_by_name" IS NULL
        OR char_length("reviewed_by_name") BETWEEN 1 AND 200)
      AND ("applied_by_name" IS NULL
        OR char_length("applied_by_name") BETWEEN 1 AND 200)
      AND ("review_note" IS NULL
        OR char_length("review_note") BETWEEN 1 AND 5000)
      AND ("apply_note" IS NULL
        OR char_length("apply_note") BETWEEN 1 AND 5000)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "addendum_impact_assessments_revision_unique"
  ON "addendum_impact_assessments" (
    "organisation_id", "project_id", "baseline_document_version_id",
    "revision_document_version_id", "assessment_id"
  );
--> statement-breakpoint
CREATE INDEX "addendum_impact_assessments_org_project_radar_history_idx"
  ON "addendum_impact_assessments" (
    "organisation_id", "project_id", "radar_id", "created_at", "id"
  );
--> statement-breakpoint

CREATE TABLE "addendum_impact_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "assessment_id" uuid NOT NULL,
  "change_id" text NOT NULL,
  "category" text NOT NULL,
  "kind" text NOT NULL,
  "before_text" text,
  "after_text" text,
  "citation_data" text NOT NULL,
  "field_external_id" text,
  "affected_object_type" text,
  "affected_object_id" text,
  "affected_object_version" integer,
  "proposed_action" text NOT NULL,
  "review_state" text DEFAULT 'pending_review' NOT NULL,
  "reviewed_by_user_id" uuid,
  "reviewed_by_name" text,
  "reviewed_at" timestamp with time zone,
  "review_note" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "addendum_impact_items_organisation_id_organisations_id_fk"
    FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id")
      ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "addendum_impact_items_assessment_id_addendum_impact_assessments_id_fk"
    FOREIGN KEY ("assessment_id") REFERENCES "public"."addendum_impact_assessments"("id")
      ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "addendum_impact_items_reviewed_by_user_id_users_id_fk"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id")
      ON DELETE set null ON UPDATE no action,
  CONSTRAINT "addendum_impact_items_text_bounds_check"
    CHECK (
      coalesce(char_length("before_text"), 0) <= 20000
      AND coalesce(char_length("after_text"), 0) <= 20000
      AND char_length("citation_data") <= 40000
      AND char_length("proposed_action") <= 5000
    ),
  CONSTRAINT "addendum_impact_items_affected_object_tuple_check"
    CHECK (
      ("affected_object_type" IS NULL AND "affected_object_id" IS NULL
        AND "affected_object_version" IS NULL)
      OR
      ("affected_object_type" IS NOT NULL AND "affected_object_id" IS NOT NULL
        AND "affected_object_version" IS NOT NULL AND "affected_object_version" > 0)
    ),
  CONSTRAINT "addendum_impact_items_review_state_check"
    CHECK ("review_state" IN ('pending_review', 'accepted', 'needs_changes', 'rejected')),
  CONSTRAINT "addendum_impact_items_review_stamp_check"
    CHECK (
      ("review_state" = 'pending_review' AND "reviewed_by_user_id" IS NULL
        AND "reviewed_by_name" IS NULL AND "reviewed_at" IS NULL)
      OR
      ("review_state" IN ('accepted', 'needs_changes', 'rejected')
        AND "reviewed_by_user_id" IS NOT NULL
        AND "reviewed_by_name" IS NOT NULL AND "reviewed_at" IS NOT NULL)
    ),
  CONSTRAINT "addendum_impact_items_identifier_bounds_check"
    CHECK (
      char_length("change_id") BETWEEN 1 AND 128
      AND char_length("category") BETWEEN 1 AND 120
      AND char_length("kind") BETWEEN 1 AND 120
      AND ("field_external_id" IS NULL
        OR char_length("field_external_id") BETWEEN 1 AND 128)
      AND ("affected_object_type" IS NULL
        OR char_length("affected_object_type") BETWEEN 1 AND 120)
      AND ("affected_object_id" IS NULL
        OR char_length("affected_object_id") BETWEEN 1 AND 128)
      AND char_length("citation_data") BETWEEN 2 AND 40000
      AND char_length("proposed_action") BETWEEN 1 AND 5000
      AND (coalesce(char_length("before_text"), 0) > 0
        OR coalesce(char_length("after_text"), 0) > 0)
      AND ("reviewed_by_name" IS NULL
        OR char_length("reviewed_by_name") BETWEEN 1 AND 200)
      AND ("review_note" IS NULL
        OR char_length("review_note") BETWEEN 1 AND 5000)
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "addendum_impact_items_target_unique"
  ON "addendum_impact_items"
    ("assessment_id", "change_id", "affected_object_type", "affected_object_id")
  WHERE "affected_object_type" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "addendum_impact_items_no_target_unique"
  ON "addendum_impact_items" ("assessment_id", "change_id")
  WHERE "affected_object_type" IS NULL;
--> statement-breakpoint
CREATE INDEX "addendum_impact_items_org_assessment_idx"
  ON "addendum_impact_items" ("organisation_id", "assessment_id", "created_at", "id");
--> statement-breakpoint

-- Source bytes, text, parser identity and version binding can never be rewritten
-- after capture. Named verification may update only status/stamp fields.
CREATE FUNCTION valo_security.reject_versioned_record_content_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'versioned record content is immutable for %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  valo_security.reject_versioned_record_content_mutation()
  FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER document_version_snapshot_content_immutable
  BEFORE UPDATE OF id, organisation_id, document_version_id,
    document_version_sha256, captured_redaction_status, canonical_text,
    canonical_text_sha256,
    structured_snapshot, structured_snapshot_sha256, extraction_method,
    parser_version, captured_by_user_id, captured_by_name, created_at
  ON public.document_version_snapshots
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER document_version_content_immutable
  BEFORE UPDATE OF id, organisation_id, document_id, version_number,
    supersedes_version_id, object_path, sha256, detected_mime,
    detected_format, size_bytes, integrity_manifest, uploaded_by, created_at
  ON public.document_versions
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER tender_context_version_content_immutable
  BEFORE UPDATE OF id, organisation_id, project_id, version_number,
    supersedes_context_version_id, primary_document_version_id,
    jurisdiction_rule_pack_id, legal_entity_name, submission_date,
    jurisdiction, entity_scopes, category_scopes, source_manifest,
    source_manifest_sha256, context_snapshot, context_sha256,
    rule_advisories, created_by_user_id, created_at
  ON public.tender_context_versions
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER tender_context_requirement_immutable
  BEFORE UPDATE ON public.tender_context_requirements
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER tender_context_artifact_immutable
  BEFORE UPDATE ON public.tender_context_artifacts
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER tender_eligibility_passport_content_immutable
  BEFORE UPDATE OF id, organisation_id, project_id,
    tender_context_version_id, passport_id, source_manifest_sha256,
    result_snapshot, result_snapshot_sha256, result_status,
    created_by_user_id, created_at
  ON public.tender_eligibility_passports
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER addendum_impact_assessment_content_immutable
  BEFORE UPDATE OF id, organisation_id, project_id,
    baseline_document_version_id, revision_document_version_id, radar_id,
    assessment_id, source_manifest_sha256, impact_manifest_sha256,
    assessment_snapshot, created_at
  ON public.addendum_impact_assessments
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint
CREATE TRIGGER addendum_impact_item_content_immutable
  BEFORE UPDATE OF id, organisation_id, assessment_id, change_id, category,
    kind, before_text, after_text, citation_data, field_external_id,
    affected_object_type, affected_object_id, affected_object_version,
    proposed_action, created_at
  ON public.addendum_impact_items
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.reject_versioned_record_content_mutation();
--> statement-breakpoint

-- Guard initial and monotonic review/application transitions. Terminal state
-- and stamps cannot be rewritten. Actor authority remains an application and
-- audit boundary; this trigger does not treat session actor text as proof.
CREATE FUNCTION valo_security.enforce_governed_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  old_row jsonb := pg_catalog.to_jsonb(OLD);
  new_row jsonb := pg_catalog.to_jsonb(NEW);
  old_state text;
  new_state text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (new_row->>'version')::integer <> 1
       OR (new_row->>'created_at')::timestamptz IS DISTINCT FROM
          (new_row->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'governed record must begin at version one for %',
        TG_TABLE_NAME USING ERRCODE = '55000';
    END IF;

    IF TG_TABLE_NAME = 'document_version_snapshots' THEN
      IF new_row->>'status' <> 'captured'
         OR new_row->>'captured_by_user_id' IS NULL
         OR new_row->>'captured_by_name' IS NULL
         OR new_row->>'verified_by_user_id' IS NOT NULL
         OR new_row->>'verified_by_name' IS NOT NULL
         OR new_row->>'verified_at' IS NOT NULL THEN
        RAISE EXCEPTION 'invalid initial snapshot state'
          USING ERRCODE = '55000';
      END IF;
    ELSIF TG_TABLE_NAME = 'tender_context_versions' THEN
      IF new_row->>'status' <> 'pending_review'
         OR new_row->>'created_by_user_id' IS NULL
         OR new_row->>'reviewed_by_user_id' IS NOT NULL
         OR new_row->>'reviewed_by_name' IS NOT NULL
         OR new_row->>'reviewed_at' IS NOT NULL
         OR new_row->>'review_note' IS NOT NULL THEN
        RAISE EXCEPTION 'invalid initial tender-context state'
          USING ERRCODE = '55000';
      END IF;
    ELSIF TG_TABLE_NAME = 'tender_eligibility_passports' THEN
      IF new_row->>'review_state' <> 'pending_review'
         OR new_row->>'created_by_user_id' IS NULL
         OR new_row->>'reviewed_by_user_id' IS NOT NULL
         OR new_row->>'reviewed_by_name' IS NOT NULL
         OR new_row->>'reviewed_at' IS NOT NULL
         OR new_row->>'review_note' IS NOT NULL THEN
        RAISE EXCEPTION 'invalid initial eligibility-passport state'
          USING ERRCODE = '55000';
      END IF;
    ELSIF TG_TABLE_NAME = 'addendum_impact_assessments' THEN
      IF new_row->>'review_state' <> 'pending_review'
         OR new_row->>'applied_state' <> 'not_applied'
         OR new_row->>'reviewed_by_user_id' IS NOT NULL
         OR new_row->>'reviewed_by_name' IS NOT NULL
         OR new_row->>'reviewed_at' IS NOT NULL
         OR new_row->>'review_note' IS NOT NULL
         OR new_row->>'applied_by_user_id' IS NOT NULL
         OR new_row->>'applied_by_name' IS NOT NULL
         OR new_row->>'applied_at' IS NOT NULL
         OR new_row->>'apply_note' IS NOT NULL THEN
        RAISE EXCEPTION 'invalid initial addendum-impact assessment state'
          USING ERRCODE = '55000';
      END IF;
    ELSIF TG_TABLE_NAME = 'addendum_impact_items' THEN
      IF new_row->>'review_state' <> 'pending_review'
         OR new_row->>'reviewed_by_user_id' IS NOT NULL
         OR new_row->>'reviewed_by_name' IS NOT NULL
         OR new_row->>'reviewed_at' IS NOT NULL
         OR new_row->>'review_note' IS NOT NULL THEN
        RAISE EXCEPTION 'invalid initial addendum-impact item state'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported governed state table %', TG_TABLE_NAME
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF (new_row->>'version')::integer <> (old_row->>'version')::integer + 1
     OR (new_row->>'updated_at')::timestamptz <
        (old_row->>'updated_at')::timestamptz THEN
    RAISE EXCEPTION 'governed state transition must advance version once for %',
      TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;

  IF TG_TABLE_NAME = 'document_version_snapshots' THEN
    old_state := old_row->>'status';
    new_state := new_row->>'status';
    IF old_state <> 'captured'
       OR new_state NOT IN ('verified', 'rejected')
       OR new_row->>'verified_by_user_id' IS NULL
       OR new_row->>'verified_by_name' IS NULL
       OR new_row->>'verified_at' IS NULL
       OR new_row->>'verified_by_user_id' = new_row->>'captured_by_user_id'
       OR (new_row->>'verified_at')::timestamptz IS DISTINCT FROM
          (new_row->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'invalid snapshot review transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'tender_context_versions' THEN
    old_state := old_row->>'status';
    new_state := new_row->>'status';
    IF old_state = 'pending_review' THEN
      IF new_state NOT IN ('accepted', 'needs_changes', 'rejected')
         OR new_row->>'reviewed_by_user_id' IS NULL
         OR new_row->>'reviewed_by_name' IS NULL
         OR new_row->>'reviewed_at' IS NULL
         OR new_row->>'reviewed_by_user_id' = new_row->>'created_by_user_id'
         OR (new_row->>'reviewed_at')::timestamptz IS DISTINCT FROM
            (new_row->>'updated_at')::timestamptz THEN
        RAISE EXCEPTION 'invalid tender-context review transition'
          USING ERRCODE = '55000';
      END IF;
    ELSIF old_state = 'accepted' AND new_state = 'superseded' THEN
      IF new_row->'reviewed_by_user_id' IS DISTINCT FROM old_row->'reviewed_by_user_id'
         OR new_row->'reviewed_by_name' IS DISTINCT FROM old_row->'reviewed_by_name'
         OR new_row->'reviewed_at' IS DISTINCT FROM old_row->'reviewed_at'
         OR new_row->'review_note' IS DISTINCT FROM old_row->'review_note' THEN
        RAISE EXCEPTION 'superseding cannot rewrite tender-context review'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'tender-context review is final'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'tender_eligibility_passports' THEN
    old_state := old_row->>'review_state';
    new_state := new_row->>'review_state';
    IF old_state <> 'pending_review'
       OR new_state NOT IN ('accepted', 'needs_changes', 'rejected')
       OR new_row->>'reviewed_by_user_id' IS NULL
       OR new_row->>'reviewed_by_name' IS NULL
       OR new_row->>'reviewed_at' IS NULL
       OR new_row->>'reviewed_by_user_id' = new_row->>'created_by_user_id'
       OR (new_row->>'reviewed_at')::timestamptz IS DISTINCT FROM
          (new_row->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'invalid eligibility-passport review transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'addendum_impact_assessments' THEN
    old_state := old_row->>'review_state';
    new_state := new_row->>'review_state';
    IF old_state = 'pending_review' THEN
      IF new_state NOT IN ('accepted', 'needs_changes', 'rejected')
         OR new_row->>'reviewed_by_user_id' IS NULL
         OR new_row->>'reviewed_by_name' IS NULL
         OR new_row->>'reviewed_at' IS NULL
         OR new_row->>'applied_state' <> 'not_applied'
         OR (new_row->>'reviewed_at')::timestamptz IS DISTINCT FROM
            (new_row->>'updated_at')::timestamptz THEN
        RAISE EXCEPTION 'invalid addendum-impact review transition'
          USING ERRCODE = '55000';
      END IF;
    ELSIF old_state = 'accepted'
          AND new_state = 'accepted'
          AND old_row->>'applied_state' = 'not_applied'
          AND new_row->>'applied_state' IN ('applied', 'application_rejected') THEN
      IF new_row->>'applied_by_user_id' IS NULL
         OR new_row->>'applied_by_name' IS NULL
         OR new_row->>'applied_at' IS NULL
         OR new_row->>'applied_by_user_id' = new_row->>'reviewed_by_user_id'
         OR (new_row->>'applied_at')::timestamptz IS DISTINCT FROM
            (new_row->>'updated_at')::timestamptz
         OR new_row->'reviewed_by_user_id' IS DISTINCT FROM old_row->'reviewed_by_user_id'
         OR new_row->'reviewed_by_name' IS DISTINCT FROM old_row->'reviewed_by_name'
         OR new_row->'reviewed_at' IS DISTINCT FROM old_row->'reviewed_at'
         OR new_row->'review_note' IS DISTINCT FROM old_row->'review_note' THEN
        RAISE EXCEPTION 'invalid addendum-impact application transition'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      RAISE EXCEPTION 'addendum-impact review/application is final'
        USING ERRCODE = '55000';
    END IF;
  ELSIF TG_TABLE_NAME = 'addendum_impact_items' THEN
    old_state := old_row->>'review_state';
    new_state := new_row->>'review_state';
    IF old_state <> 'pending_review'
       OR new_state NOT IN ('accepted', 'needs_changes', 'rejected')
       OR new_row->>'reviewed_by_user_id' IS NULL
       OR new_row->>'reviewed_by_name' IS NULL
       OR new_row->>'reviewed_at' IS NULL
       OR (new_row->>'reviewed_at')::timestamptz IS DISTINCT FROM
          (new_row->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'invalid addendum-impact item review transition'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported governed state table %', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  valo_security.enforce_governed_state_transition()
  FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER document_version_snapshot_state_transition
  BEFORE INSERT OR UPDATE ON public.document_version_snapshots
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_governed_state_transition();
--> statement-breakpoint
CREATE TRIGGER tender_context_version_state_transition
  BEFORE INSERT OR UPDATE ON public.tender_context_versions
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_governed_state_transition();
--> statement-breakpoint
CREATE TRIGGER tender_eligibility_passport_state_transition
  BEFORE INSERT OR UPDATE ON public.tender_eligibility_passports
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_governed_state_transition();
--> statement-breakpoint
CREATE TRIGGER addendum_impact_assessment_state_transition
  BEFORE INSERT OR UPDATE ON public.addendum_impact_assessments
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_governed_state_transition();
--> statement-breakpoint
CREATE TRIGGER addendum_impact_item_state_transition
  BEFORE INSERT OR UPDATE ON public.addendum_impact_items
  FOR EACH ROW EXECUTE FUNCTION
    valo_security.enforce_governed_state_transition();
--> statement-breakpoint

-- Preserve the original v2.5 98-edge function as an independently attestable
-- boundary and extend the active manifest with only the new explicit edges.
ALTER FUNCTION valo_security.expected_tenant_parent_edges()
  RENAME TO expected_tenant_parent_edges_v25;
--> statement-breakpoint
CREATE FUNCTION valo_security.expected_tenant_parent_edges()
RETURNS TABLE (
  child_table text,
  child_column text,
  parent_table text,
  parent_column text,
  allow_global_parent boolean
)
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT *
  FROM valo_security.expected_tenant_parent_edges_v25()
  UNION ALL
  SELECT *
  FROM (VALUES
    ('addendum_impact_assessments','baseline_document_version_id','document_versions','id',false),
    ('addendum_impact_assessments','project_id','projects','id',false),
    ('addendum_impact_assessments','revision_document_version_id','document_versions','id',false),
    ('addendum_impact_items','assessment_id','addendum_impact_assessments','id',false),
    ('document_version_snapshots','document_version_id','document_versions','id',false),
    ('tender_context_artifacts','document_version_id','document_versions','id',false),
    ('tender_context_artifacts','project_id','projects','id',false),
    ('tender_context_artifacts','tender_context_version_id','tender_context_versions','id',false),
    ('tender_context_artifacts','vault_item_version_id','vault_item_versions','id',false),
    ('tender_context_requirements','project_id','projects','id',false),
    ('tender_context_requirements','requirement_citation_id','requirement_citations','id',false),
    ('tender_context_requirements','requirement_id','requirements','id',false),
    ('tender_context_requirements','tender_context_version_id','tender_context_versions','id',false),
    ('tender_context_versions','primary_document_version_id','document_versions','id',false),
    ('tender_context_versions','project_id','projects','id',false),
    ('tender_context_versions','supersedes_context_version_id','tender_context_versions','id',false),
    ('tender_eligibility_passports','project_id','projects','id',false),
    ('tender_eligibility_passports','tender_context_version_id','tender_context_versions','id',false)
  ) AS edge(child_table, child_column, parent_table, parent_column, allow_global_parent);
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.expected_tenant_parent_edges_v25()
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION valo_security.expected_tenant_parent_edges()
  FROM PUBLIC;
--> statement-breakpoint

-- Install owner-independent tenant-parent guards for every new direct edge.
DO $new_tenant_parent_triggers$
DECLARE
  edge record;
  trigger_name text;
BEGIN
  FOR edge IN
    SELECT * FROM (VALUES
      ('addendum_impact_assessments','baseline_document_version_id','document_versions','id',false),
      ('addendum_impact_assessments','project_id','projects','id',false),
      ('addendum_impact_assessments','revision_document_version_id','document_versions','id',false),
      ('addendum_impact_items','assessment_id','addendum_impact_assessments','id',false),
      ('document_version_snapshots','document_version_id','document_versions','id',false),
      ('tender_context_artifacts','document_version_id','document_versions','id',false),
      ('tender_context_artifacts','project_id','projects','id',false),
      ('tender_context_artifacts','tender_context_version_id','tender_context_versions','id',false),
      ('tender_context_artifacts','vault_item_version_id','vault_item_versions','id',false),
      ('tender_context_requirements','project_id','projects','id',false),
      ('tender_context_requirements','requirement_citation_id','requirement_citations','id',false),
      ('tender_context_requirements','requirement_id','requirements','id',false),
      ('tender_context_requirements','tender_context_version_id','tender_context_versions','id',false),
      ('tender_context_versions','primary_document_version_id','document_versions','id',false),
      ('tender_context_versions','project_id','projects','id',false),
      ('tender_context_versions','supersedes_context_version_id','tender_context_versions','id',false),
      ('tender_eligibility_passports','project_id','projects','id',false),
      ('tender_eligibility_passports','tender_context_version_id','tender_context_versions','id',false)
    ) AS manifest(child_table, child_column, parent_table, parent_column, allow_global_parent)
    ORDER BY child_table, child_column
  LOOP
    trigger_name := pg_catalog.left('tenant_parent_' || edge.child_column, 63);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF organisation_id, %I ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION valo_security.enforce_tenant_parent(%L, %L, %L, %L)',
      trigger_name,
      edge.child_column,
      edge.child_table,
      edge.parent_table,
      edge.parent_column,
      edge.child_column,
      edge.allow_global_parent::text
    );
  END LOOP;
END;
$new_tenant_parent_triggers$;
--> statement-breakpoint

-- All new tenant data is owner-resistant and fails closed without the
-- transaction-local organisation context.
DO $new_tenant_rls$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'addendum_impact_assessments',
    'addendum_impact_items',
    'document_version_snapshots',
    'tender_context_artifacts',
    'tender_context_requirements',
    'tender_context_versions',
    'tender_eligibility_passports'
  ]::text[]
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table
    );
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY tenant_isolation ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC ' ||
      'USING (organisation_id = valo_security.current_organisation_id()) ' ||
      'WITH CHECK (organisation_id = valo_security.current_organisation_id())',
      tenant_table
    );
  END LOOP;
END;
$new_tenant_rls$;
--> statement-breakpoint

-- Production runtime gets only ordinary row operations; FORCE RLS and the
-- parent guards remain in force, and schema/destructive privileges stay denied.
DO $runtime_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.addendum_impact_assessments,
      public.addendum_impact_items,
      public.document_version_snapshots,
      public.tender_context_versions,
      public.tender_eligibility_passports
      TO valo_app_runtime;
    GRANT SELECT, INSERT ON TABLE
      public.tender_context_artifacts,
      public.tender_context_requirements
      TO valo_app_runtime;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
      public.addendum_impact_assessments,
      public.addendum_impact_items,
      public.document_version_snapshots,
      public.tender_context_artifacts,
      public.tender_context_requirements,
      public.tender_context_versions,
      public.tender_eligibility_passports
      FROM valo_app_runtime;
    REVOKE UPDATE ON TABLE
      public.document_versions,
      public.tender_context_artifacts,
      public.tender_context_requirements
      FROM valo_app_runtime;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
      public.jurisdiction_rule_packs,
      public.jurisdiction_rules
      FROM valo_app_runtime;
  END IF;
END;
$runtime_grant$;
