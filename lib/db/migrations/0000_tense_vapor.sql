CREATE TABLE "app_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"severity_weight_fatal" integer DEFAULT 40 NOT NULL,
	"severity_weight_likely_fatal" integer DEFAULT 25 NOT NULL,
	"severity_weight_scoring_risk" integer DEFAULT 10 NOT NULL,
	"severity_weight_cosmetic" integer DEFAULT 3 NOT NULL,
	"missing_evidence_weight" integer DEFAULT 5 NOT NULL,
	"band_medium_cutoff" integer DEFAULT 15 NOT NULL,
	"band_high_cutoff" integer DEFAULT 40 NOT NULL,
	"band_critical_cutoff" integer DEFAULT 70 NOT NULL,
	"firm_name" text DEFAULT 'VALO' NOT NULL,
	"confidentiality_legend" text DEFAULT 'CONFIDENTIAL — Prepared for internal review. Not for external distribution.' NOT NULL,
	"retention_default_days" integer DEFAULT 14 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"approval_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"decided_by_user_id" uuid,
	"decision" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"evidence_snapshot_hash" text,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_anchors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"first_sequence" integer NOT NULL,
	"last_sequence" integer NOT NULL,
	"chain_head_hash" text NOT NULL,
	"provider" text NOT NULL,
	"immutable_object_reference" text NOT NULL,
	"receipt_hash" text NOT NULL,
	"receipt_signature" text,
	"anchored_at" timestamp with time zone NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"user_id" uuid,
	"user_name" text,
	"project_id" uuid,
	"event_type" text NOT NULL,
	"object_type" text,
	"object_id" text,
	"details" text,
	"seq" integer,
	"prev_hash" text,
	"hash" text,
	"row_no" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_cohorts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_key" text NOT NULL,
	"definition_version" integer NOT NULL,
	"definition" text NOT NULL,
	"minimum_cohort_size" integer NOT NULL,
	"differencing_controls" text NOT NULL,
	"suppression_policy" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"consent_record_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cohort_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"consent_snapshot_hash" text NOT NULL,
	"contributing_organisation_count" integer NOT NULL,
	"suppressed" boolean DEFAULT true NOT NULL,
	"aggregate_payload" text,
	"disclosure_review" text NOT NULL,
	"approved_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"line_ref" text,
	"description" text,
	"quantity" double precision,
	"unit_rate" double precision,
	"extension" double precision,
	"computed_extension" double precision,
	"quantity_raw" text,
	"unit_rate_kobo" bigint,
	"extension_kobo" bigint,
	"computed_extension_kobo" bigint,
	"check_type" text NOT NULL,
	"finding" text NOT NULL,
	"severity" text DEFAULT 'scoring_risk' NOT NULL,
	"status" text DEFAULT 'flagged' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"boq_run_id" uuid NOT NULL,
	"lot_reference" text,
	"sheet_name" text,
	"cell_reference" text,
	"exception_code" text NOT NULL,
	"severity" text NOT NULL,
	"expected_minor" bigint,
	"actual_minor" bigint,
	"currency" text,
	"finding" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_reason" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"rule_pack_id" text NOT NULL,
	"verifier_version" text NOT NULL,
	"workbook_manifest" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"exception_count" integer DEFAULT 0 NOT NULL,
	"started_by_user_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_organisation_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"reason" text NOT NULL,
	"incident_reference" text NOT NULL,
	"requested_permissions" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"capability_version_id" uuid NOT NULL,
	"vault_item_version_id" uuid,
	"document_version_id" uuid,
	"citation" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"description" text,
	"evidence_doc_id" uuid,
	"approved_status" text DEFAULT 'pending' NOT NULL,
	"verifier_id" uuid,
	"verifier_name" text,
	"verified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"capability_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"draft_claim_id" uuid,
	"used_by_user_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capability_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"capability_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"approved_claim" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"restrictions" text,
	"approval_state" text DEFAULT 'draft' NOT NULL,
	"reviewer_user_id" uuid,
	"approved_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_evidence_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"draft_claim_id" uuid NOT NULL,
	"capability_version_id" uuid,
	"vault_item_version_id" uuid,
	"document_version_id" uuid,
	"evidence_citation" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"name" text NOT NULL,
	"sector" text,
	"segment" text,
	"contact_name" text,
	"contact_email" text,
	"nda_status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"decision_maker_conversations" integer DEFAULT 0 NOT NULL,
	"junior_conversations" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"tender_ref" text,
	"lot" text,
	"matched_project_id" uuid,
	"status" text DEFAULT 'blocked' NOT NULL,
	"decision" text,
	"rationale" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"privacy_record_id" uuid,
	"subject_reference" text NOT NULL,
	"purpose" text NOT NULL,
	"notice_version" text NOT NULL,
	"affirmative_action" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"evidence_hash" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cross_border_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"subprocessor_id" uuid,
	"exporter_role" text NOT NULL,
	"importer_role" text NOT NULL,
	"origin_country" text NOT NULL,
	"destination_country" text NOT NULL,
	"data_categories" text NOT NULL,
	"purpose" text NOT NULL,
	"transfer_basis" text NOT NULL,
	"approval_evidence" text,
	"legal_review_status" text DEFAULT 'pending' NOT NULL,
	"next_review_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"requester_reference" text NOT NULL,
	"identity_verification_status" text DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"assigned_to_user_id" uuid,
	"response_evidence" text,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defect_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"defect_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_severity" text NOT NULL,
	"proposed_severity" text,
	"reason" text NOT NULL,
	"evidence_ids" text NOT NULL,
	"initiated_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "defects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"evidence_snapshot" text,
	"remediation" text,
	"owner" text,
	"status" text DEFAULT 'open' NOT NULL,
	"suggested" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"retention_action_id" uuid NOT NULL,
	"certificate_number" text NOT NULL,
	"scope_manifest_hash" text NOT NULL,
	"method" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"exceptions" text,
	"signed_by_user_id" uuid NOT NULL,
	"signature_evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"supersedes_version_id" uuid,
	"object_path" text NOT NULL,
	"sha256" text NOT NULL,
	"detected_mime" text NOT NULL,
	"detected_format" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"page_count" integer,
	"malware_status" text DEFAULT 'pending' NOT NULL,
	"quarantine_status" text DEFAULT 'quarantined' NOT NULL,
	"integrity_manifest" text NOT NULL,
	"addendum_status" text DEFAULT 'not_assessed' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"filename" text NOT NULL,
	"object_path" text NOT NULL,
	"content_type" text,
	"size" integer,
	"sha256" text,
	"source" text,
	"date_received" text,
	"redaction_status" text DEFAULT 'excluded' NOT NULL,
	"uploaded_by" uuid,
	"content_text" text,
	"extracted_chars" integer,
	"extraction_status" text DEFAULT 'pending',
	"extraction_method" text,
	"extraction_confidence" double precision,
	"extraction_notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"draft_version_id" uuid NOT NULL,
	"claim_key" text NOT NULL,
	"claim_text" text NOT NULL,
	"claim_kind" text NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"grounding_status" text DEFAULT 'unverified' NOT NULL,
	"reviewer_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_requirement_version_snapshot" text NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" uuid,
	"model_run_id" uuid,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_number" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_tender_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"tender_lot_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"project_id" uuid,
	"units" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_user_id" uuid,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"order_id" uuid,
	"subscription_id" uuid,
	"product_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"usage_consumed" integer DEFAULT 0 NOT NULL,
	"payment_state" text DEFAULT 'pending' NOT NULL,
	"feature_flag_key" text,
	"rules_version" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"corpus_version" text NOT NULL,
	"split" text NOT NULL,
	"task" text NOT NULL,
	"fixture_reference" text NOT NULL,
	"label_hash" text NOT NULL,
	"fatal_label_count" integer DEFAULT 0 NOT NULL,
	"likely_fatal_label_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"evaluation_case_id" uuid NOT NULL,
	"passed" boolean NOT NULL,
	"result_metrics" text NOT NULL,
	"output_hash" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"task" text NOT NULL,
	"corpus_version" text NOT NULL,
	"model_configuration_id" uuid,
	"prompt_configuration_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"metrics" text,
	"limitations" text,
	"release_decision" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"document_id" uuid,
	"evidence_status" text DEFAULT 'pending' NOT NULL,
	"excerpt" text,
	"notes" text,
	"suggested" boolean DEFAULT false NOT NULL,
	"confirmed_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"delivery_channel" text NOT NULL,
	"recipient_reference" text,
	"signed_url_expires_at" timestamp with time zone,
	"delivery_receipt_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"exported_by_user_id" uuid NOT NULL,
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"configuration" text,
	"commercial_gate" text,
	"updated_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"adapter_type" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"secret_reference" text,
	"configuration" text NOT NULL,
	"production_approved" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"adapter_type" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload_hash" text NOT NULL,
	"signature_status" text NOT NULL,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"order_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"line_amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"currency" text NOT NULL,
	"net_amount_minor" bigint NOT NULL,
	"vat_rate_basis_points" integer NOT NULL,
	"vat_amount_minor" bigint NOT NULL,
	"gross_amount_minor" bigint NOT NULL,
	"wht_rate_basis_points" integer,
	"wht_amount_minor" bigint,
	"net_payable_minor" bigint NOT NULL,
	"tax_rule_id" text NOT NULL,
	"tax_point_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_rule_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_key" text NOT NULL,
	"version" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"source_manifest_hash" text NOT NULL,
	"advisory_only" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jurisdiction_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_pack_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"domain" text NOT NULL,
	"instrument" text NOT NULL,
	"source_urls" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"entity_scope" text NOT NULL,
	"category_scope" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"monetary_bands" text,
	"approval_owner" text,
	"evidence_requirements" text NOT NULL,
	"severity" text NOT NULL,
	"legal_review_status" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"supersedes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"placed_by_user_id" uuid NOT NULL,
	"released_by_user_id" uuid,
	"released_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid,
	"task" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_hash" text,
	"output_summary" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task" text NOT NULL,
	"configuration_version" integer NOT NULL,
	"configuration" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"evaluation_run_id" uuid,
	"promoted_by_user_id" uuid,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nda_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid,
	"document_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"signer_name" text,
	"signer_authority" text,
	"signed_at" timestamp with time zone,
	"document_hash" text,
	"signature_evidence" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"notification_event_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"provider" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"response_code" text,
	"response_summary" text,
	"next_attempt_at" timestamp with time zone,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid,
	"client_id" uuid,
	"vault_item_id" uuid,
	"channel" text DEFAULT 'manual' NOT NULL,
	"template" text NOT NULL,
	"recipient" text,
	"payload" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid,
	"price_book_entry_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_minor" bigint NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"placed_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_starts_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"delegated_by_membership_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text DEFAULT 'client' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"country_code" text DEFAULT 'NG' NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"captured_by_user_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_confirmed" boolean DEFAULT false NOT NULL,
	"debrief_reference" text,
	"reasons" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_manifest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"item_type" text NOT NULL,
	"source_object_id" uuid,
	"source_version" integer,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_version_id" uuid NOT NULL,
	"signer_user_id" uuid NOT NULL,
	"signer_role" text NOT NULL,
	"signer_authority" text NOT NULL,
	"intent_statement" text NOT NULL,
	"document_hash" text NOT NULL,
	"trusted_timestamp" timestamp with time zone NOT NULL,
	"mfa_evidence" text NOT NULL,
	"device_event_evidence" text NOT NULL,
	"certificate_verification" text,
	"audit_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"manifest_hash" text NOT NULL,
	"docx_object_path" text,
	"docx_sha256" text,
	"pdf_object_path" text,
	"pdf_sha256" text,
	"zip_object_path" text,
	"zip_sha256" text,
	"render_qa_status" text DEFAULT 'pending' NOT NULL,
	"readiness_snapshot" text NOT NULL,
	"generated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"package_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_number" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_branding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_organisation_id" uuid NOT NULL,
	"brand_name" text NOT NULL,
	"logo_object_path" text,
	"primary_colour" text,
	"secondary_colour" text,
	"footer_text" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_organisation_id" uuid NOT NULL,
	"client_organisation_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"client_ownership_rule" text DEFAULT 'client_retained' NOT NULL,
	"qa_responsibility" text,
	"co_signing_required" boolean DEFAULT false NOT NULL,
	"access_starts_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"approved_by_membership_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_revenue_share_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_organisation_id" uuid NOT NULL,
	"client_organisation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"gross_revenue_minor" bigint NOT NULL,
	"share_rate_basis_points" integer NOT NULL,
	"share_amount_minor" bigint NOT NULL,
	"rule_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"invoice_id" uuid,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reconciliation_status" text DEFAULT 'pending' NOT NULL,
	"provider_event_hash" text,
	"settled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_book_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"product_code" text NOT NULL,
	"product_kind" text NOT NULL,
	"currency" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"minor_unit_digits" integer DEFAULT 2 NOT NULL,
	"billing_cadence" text,
	"usage_configuration" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"name" text NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"record_type" text NOT NULL,
	"controller_processor_role" text NOT NULL,
	"purpose" text NOT NULL,
	"lawful_basis" text NOT NULL,
	"data_categories" text NOT NULL,
	"subject_categories" text NOT NULL,
	"notice_version" text,
	"retention_schedule" text NOT NULL,
	"dpia_status" text DEFAULT 'not_required' NOT NULL,
	"dcpmi_designation" text,
	"designation_confirmed_by" text,
	"legal_review_status" text DEFAULT 'pending' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid,
	"document_version_id" uuid,
	"job_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_summary" text,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"run_type" text NOT NULL,
	"provider" text NOT NULL,
	"model_configuration_id" uuid,
	"prompt_configuration_id" uuid,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"status" text DEFAULT 'running' NOT NULL,
	"latency_ms" integer,
	"cost_minor" bigint,
	"cost_currency" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"confidence_calibration_version" text,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid NOT NULL,
	"tender_title" text NOT NULL,
	"issuing_entity" text,
	"tender_ref" text,
	"lot" text,
	"deadline" text,
	"value_band" text,
	"segment" text,
	"submission_status" text,
	"status" text DEFAULT 'intake' NOT NULL,
	"reviewer_id" uuid,
	"sla_class" text DEFAULT 'standard' NOT NULL,
	"payment_status" text DEFAULT 'not_required' NOT NULL,
	"payment_confirmed_by_founder" boolean DEFAULT false NOT NULL,
	"payment_confirmed_by_advisor" boolean DEFAULT false NOT NULL,
	"payment_confirmed_at" timestamp with time zone,
	"payment_founder_confirmed_by" uuid,
	"payment_founder_confirmed_by_name" text,
	"payment_founder_confirmed_at" timestamp with time zone,
	"payment_advisor_confirmed_by" uuid,
	"payment_advisor_confirmed_by_name" text,
	"payment_advisor_confirmed_at" timestamp with time zone,
	"conflict_status" text DEFAULT 'clear' NOT NULL,
	"conflict_decision" text,
	"conflict_rationale" text,
	"physical_archive_instruction" text,
	"redaction_scope" text,
	"restricted_mode" boolean DEFAULT false NOT NULL,
	"risk_score" double precision,
	"risk_band" text,
	"risk_override_band" text,
	"risk_override_note" text,
	"risk_override_by" text,
	"outcome" text DEFAULT 'none' NOT NULL,
	"mandate_quality" text DEFAULT 'none' NOT NULL,
	"scope" text,
	"limitations" text,
	"responsiveness_review" text,
	"responsiveness_suggested" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"task" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"template_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"evaluation_run_id" uuid,
	"promoted_by_user_id" uuid,
	"promoted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "red_team_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"red_team_run_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"object_type" text,
	"object_id" uuid,
	"finding" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "red_team_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"initiated_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renewal_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vault_item_version_id" uuid NOT NULL,
	"next_notification_at" timestamp with time zone NOT NULL,
	"cadence_days" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_notification_event_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"docx_path" text,
	"pdf_path" text,
	"reviewer_id" uuid,
	"reviewer_name" text,
	"attestation" text,
	"engine_version" text,
	"prompt_pack_version" text,
	"model_id" text,
	"taxonomy_version" text,
	"signed_off_at" timestamp with time zone,
	"generated_by" uuid,
	"optimistic_lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"page_number" integer,
	"paragraph_ref" text,
	"table_ref" text,
	"coordinate_json" text,
	"source_snippet" text NOT NULL,
	"source_snippet_hash" text NOT NULL,
	"verification_status" text DEFAULT 'pending' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"page_ref" text,
	"clause_ref" text,
	"text" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"expected_evidence" text,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"confidence" text,
	"review_status" text DEFAULT 'suggested' NOT NULL,
	"reviewer_notes" text,
	"origin" text,
	"engine_text" text,
	"merged_citations" text,
	"reviewed_by" uuid,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"retention_request_id" uuid,
	"legal_hold_id" uuid,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" text,
	"executed_by_user_id" uuid,
	"executed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"project_id" uuid NOT NULL,
	"requested_by" uuid,
	"reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"certificate_text" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"review_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"findings" text,
	"source_version" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_membership_id" uuid,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"jurisdiction_rule_id" uuid NOT NULL,
	"input_snapshot_hash" text NOT NULL,
	"result" text NOT NULL,
	"advisory_message" text NOT NULL,
	"evidence_snapshot" text,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"rule_evaluation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"evidence" text NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sbd_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"template_id" uuid NOT NULL,
	"agency" text,
	"section" text,
	"kind" text DEFAULT 'format' NOT NULL,
	"quirk" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sbd_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'goods' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issuing_circular" text,
	"summary" text,
	"optimistic_lock_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subprocessors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"service" text NOT NULL,
	"country_code" text NOT NULL,
	"dpa_status" text DEFAULT 'pending' NOT NULL,
	"security_review_status" text DEFAULT 'pending' NOT NULL,
	"approved_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"price_book_entry_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"current_period_ends_at" timestamp with time zone,
	"cancels_at" timestamp with time zone,
	"provider_reference" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tender_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"lot_reference" text NOT NULL,
	"title" text,
	"submission_deadline" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"procuring_entity" text NOT NULL,
	"jurisdiction" text DEFAULT 'NG' NOT NULL,
	"funding_source" text,
	"procurement_category" text,
	"source_type" text NOT NULL,
	"source_licence_reference" text,
	"submission_deadline" timestamp with time zone,
	"status" text DEFAULT 'identified' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"expected_sha256" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "vault_item_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vault_item_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"document_version_id" uuid NOT NULL,
	"issue_date" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"issuing_authority" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"restrictions" text,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid,
	"client_id" uuid NOT NULL,
	"artefact_type" text NOT NULL,
	"issuer" text,
	"issue_date" text,
	"expiry_date" text,
	"renewal_lead_days" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"object_path" text,
	"sha256" text,
	"source_document_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"vault_item_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"used_by_user_id" uuid NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"requirement_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"owner_membership_id" uuid,
	"due_at" timestamp with time zone,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_anchors" ADD CONSTRAINT "audit_anchors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_consents" ADD CONSTRAINT "benchmark_consents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_consents" ADD CONSTRAINT "benchmark_consents_consent_record_id_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_releases" ADD CONSTRAINT "benchmark_releases_cohort_id_benchmark_cohorts_id_fk" FOREIGN KEY ("cohort_id") REFERENCES "public"."benchmark_cohorts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_releases" ADD CONSTRAINT "benchmark_releases_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_checks" ADD CONSTRAINT "boq_checks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_checks" ADD CONSTRAINT "boq_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_checks" ADD CONSTRAINT "boq_checks_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_exceptions" ADD CONSTRAINT "boq_exceptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_exceptions" ADD CONSTRAINT "boq_exceptions_boq_run_id_boq_runs_id_fk" FOREIGN KEY ("boq_run_id") REFERENCES "public"."boq_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_exceptions" ADD CONSTRAINT "boq_exceptions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_runs" ADD CONSTRAINT "boq_runs_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_target_organisation_id_organisations_id_fk" FOREIGN KEY ("target_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_evidence_links" ADD CONSTRAINT "capability_evidence_links_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_evidence_doc_id_documents_id_fk" FOREIGN KEY ("evidence_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_items" ADD CONSTRAINT "capability_items_verifier_id_users_id_fk" FOREIGN KEY ("verifier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_usage" ADD CONSTRAINT "capability_usage_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_capability_item_id_capability_items_id_fk" FOREIGN KEY ("capability_item_id") REFERENCES "public"."capability_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_versions" ADD CONSTRAINT "capability_versions_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_draft_claim_id_draft_claims_id_fk" FOREIGN KEY ("draft_claim_id") REFERENCES "public"."draft_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_capability_version_id_capability_versions_id_fk" FOREIGN KEY ("capability_version_id") REFERENCES "public"."capability_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence_links" ADD CONSTRAINT "claim_evidence_links_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_matched_project_id_projects_id_fk" FOREIGN KEY ("matched_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_records" ADD CONSTRAINT "conflict_records_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_privacy_record_id_privacy_records_id_fk" FOREIGN KEY ("privacy_record_id") REFERENCES "public"."privacy_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_border_transfers" ADD CONSTRAINT "cross_border_transfers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cross_border_transfers" ADD CONSTRAINT "cross_border_transfers_subprocessor_id_subprocessors_id_fk" FOREIGN KEY ("subprocessor_id") REFERENCES "public"."subprocessors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_defect_id_defects_id_fk" FOREIGN KEY ("defect_id") REFERENCES "public"."defects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defect_decisions" ADD CONSTRAINT "defect_decisions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "defects" ADD CONSTRAINT "defects_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_retention_action_id_retention_actions_id_fk" FOREIGN KEY ("retention_action_id") REFERENCES "public"."retention_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deletion_certificates" ADD CONSTRAINT "deletion_certificates_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_draft_version_id_draft_versions_id_fk" FOREIGN KEY ("draft_version_id") REFERENCES "public"."draft_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_claims" ADD CONSTRAINT "draft_claims_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_versions" ADD CONSTRAINT "draft_versions_model_run_id_processing_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."processing_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_tender_lots" ADD CONSTRAINT "engagement_tender_lots_tender_lot_id_tender_lots_id_fk" FOREIGN KEY ("tender_lot_id") REFERENCES "public"."tender_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_usage" ADD CONSTRAINT "entitlement_usage_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_cases" ADD CONSTRAINT "evaluation_cases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_run_id_evaluation_runs_id_fk" FOREIGN KEY ("evaluation_run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_case_id_evaluation_cases_id_fk" FOREIGN KEY ("evaluation_case_id") REFERENCES "public"."evaluation_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_model_configuration_id_model_configurations_id_fk" FOREIGN KEY ("model_configuration_id") REFERENCES "public"."model_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_prompt_configuration_id_prompt_configurations_id_fk" FOREIGN KEY ("prompt_configuration_id") REFERENCES "public"."prompt_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_deliveries" ADD CONSTRAINT "export_deliveries_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_deliveries" ADD CONSTRAINT "export_deliveries_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_deliveries" ADD CONSTRAINT "export_deliveries_exported_by_user_id_users_id_fk" FOREIGN KEY ("exported_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_configurations" ADD CONSTRAINT "integration_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_receipts" ADD CONSTRAINT "integration_receipts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_rule_packs" ADD CONSTRAINT "jurisdiction_rule_packs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jurisdiction_rules" ADD CONSTRAINT "jurisdiction_rules_rule_pack_id_jurisdiction_rule_packs_id_fk" FOREIGN KEY ("rule_pack_id") REFERENCES "public"."jurisdiction_rule_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_records" ADD CONSTRAINT "nda_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_records" ADD CONSTRAINT "nda_records_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_attempts" ADD CONSTRAINT "notification_attempts_notification_event_id_notification_events_id_fk" FOREIGN KEY ("notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_vault_item_id_vault_items_id_fk" FOREIGN KEY ("vault_item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_price_book_entry_id_price_book_entries_id_fk" FOREIGN KEY ("price_book_entry_id") REFERENCES "public"."price_book_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_memberships" ADD CONSTRAINT "organisation_memberships_delegated_by_fk" FOREIGN KEY ("delegated_by_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisations" ADD CONSTRAINT "organisations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_captured_by_user_id_users_id_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_manifest_items" ADD CONSTRAINT "package_manifest_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_manifest_items" ADD CONSTRAINT "package_manifest_items_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_package_version_id_package_versions_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_signer_user_id_users_id_fk" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_signoffs" ADD CONSTRAINT "package_signoffs_audit_event_id_audit_events_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_branding" ADD CONSTRAINT "partner_branding_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_branding" ADD CONSTRAINT "partner_branding_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_relationships" ADD CONSTRAINT "partner_relationships_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_relationships" ADD CONSTRAINT "partner_relationships_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_relationships" ADD CONSTRAINT "partner_relationships_approved_by_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("approved_by_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_revenue_share_entries" ADD CONSTRAINT "partner_revenue_share_entries_partner_organisation_id_organisations_id_fk" FOREIGN KEY ("partner_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_revenue_share_entries" ADD CONSTRAINT "partner_revenue_share_entries_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_revenue_share_entries" ADD CONSTRAINT "partner_revenue_share_entries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_records" ADD CONSTRAINT "privacy_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_job_id_processing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."processing_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_model_configuration_id_model_configurations_id_fk" FOREIGN KEY ("model_configuration_id") REFERENCES "public"."model_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_prompt_configuration_id_prompt_configurations_id_fk" FOREIGN KEY ("prompt_configuration_id") REFERENCES "public"."prompt_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_payment_founder_confirmed_by_users_id_fk" FOREIGN KEY ("payment_founder_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_payment_advisor_confirmed_by_users_id_fk" FOREIGN KEY ("payment_advisor_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_configurations" ADD CONSTRAINT "prompt_configurations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_configurations" ADD CONSTRAINT "prompt_configurations_promoted_by_user_id_users_id_fk" FOREIGN KEY ("promoted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_red_team_run_id_red_team_runs_id_fk" FOREIGN KEY ("red_team_run_id") REFERENCES "public"."red_team_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_findings" ADD CONSTRAINT "red_team_findings_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "red_team_runs" ADD CONSTRAINT "red_team_runs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_monitors" ADD CONSTRAINT "renewal_monitors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_monitors" ADD CONSTRAINT "renewal_monitors_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_monitors" ADD CONSTRAINT "renewal_monitors_last_notification_event_id_notification_events_id_fk" FOREIGN KEY ("last_notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_citations" ADD CONSTRAINT "requirement_citations_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_retention_request_id_retention_requests_id_fk" FOREIGN KEY ("retention_request_id") REFERENCES "public"."retention_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_legal_hold_id_legal_holds_id_fk" FOREIGN KEY ("legal_hold_id") REFERENCES "public"."legal_holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_actions" ADD CONSTRAINT "retention_actions_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_requests" ADD CONSTRAINT "retention_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_requests" ADD CONSTRAINT "retention_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_requests" ADD CONSTRAINT "retention_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("granted_by_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_jurisdiction_rule_id_jurisdiction_rules_id_fk" FOREIGN KEY ("jurisdiction_rule_id") REFERENCES "public"."jurisdiction_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_rule_evaluation_id_rule_evaluations_id_fk" FOREIGN KEY ("rule_evaluation_id") REFERENCES "public"."rule_evaluations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_overrides" ADD CONSTRAINT "rule_overrides_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sbd_annotations" ADD CONSTRAINT "sbd_annotations_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sbd_annotations" ADD CONSTRAINT "sbd_annotations_template_id_sbd_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."sbd_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sbd_templates" ADD CONSTRAINT "sbd_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subprocessors" ADD CONSTRAINT "subprocessors_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_book_entry_id_price_book_entries_id_fk" FOREIGN KEY ("price_book_entry_id") REFERENCES "public"."price_book_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_lots" ADD CONSTRAINT "tender_lots_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tender_lots" ADD CONSTRAINT "tender_lots_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_vault_item_id_vault_items_id_fk" FOREIGN KEY ("vault_item_id") REFERENCES "public"."vault_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_item_versions" ADD CONSTRAINT "vault_item_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_items" ADD CONSTRAINT "vault_items_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_vault_item_version_id_vault_item_versions_id_fk" FOREIGN KEY ("vault_item_version_id") REFERENCES "public"."vault_item_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_usage" ADD CONSTRAINT "vault_usage_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_tasks" ADD CONSTRAINT "work_tasks_owner_membership_id_organisation_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."organisation_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_org_type_decision_idx" ON "approvals" USING btree ("organisation_id","approval_type","decision");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_anchors_provider_reference_unique" ON "audit_anchors" USING btree ("provider","immutable_object_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_seq_unique" ON "audit_events" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_cohorts_key_version_unique" ON "benchmark_cohorts" USING btree ("cohort_key","definition_version");--> statement-breakpoint
CREATE INDEX "benchmark_consents_org_status_idx" ON "benchmark_consents" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_releases_cohort_period_unique" ON "benchmark_releases" USING btree ("cohort_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "boq_exceptions_run_status_idx" ON "boq_exceptions" USING btree ("boq_run_id","status");--> statement-breakpoint
CREATE INDEX "boq_runs_org_project_status_idx" ON "boq_runs" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE INDEX "break_glass_target_status_expiry_idx" ON "break_glass_sessions" USING btree ("target_organisation_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "capability_evidence_links_version_idx" ON "capability_evidence_links" USING btree ("capability_version_id");--> statement-breakpoint
CREATE INDEX "capability_usage_org_project_idx" ON "capability_usage" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "capability_versions_item_number_unique" ON "capability_versions" USING btree ("capability_item_id","version_number");--> statement-breakpoint
CREATE INDEX "claim_evidence_links_claim_idx" ON "claim_evidence_links" USING btree ("draft_claim_id");--> statement-breakpoint
CREATE INDEX "clients_org_created_idx" ON "clients" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_org_object_idx" ON "comments" USING btree ("organisation_id","object_type","object_id");--> statement-breakpoint
CREATE INDEX "consent_records_org_subject_idx" ON "consent_records" USING btree ("organisation_id","subject_reference");--> statement-breakpoint
CREATE INDEX "cross_border_transfers_org_review_idx" ON "cross_border_transfers" USING btree ("organisation_id","next_review_at");--> statement-breakpoint
CREATE INDEX "dsr_org_status_due_idx" ON "data_subject_requests" USING btree ("organisation_id","status","due_at");--> statement-breakpoint
CREATE INDEX "defect_decisions_defect_status_idx" ON "defect_decisions" USING btree ("defect_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deletion_certificates_org_number_unique" ON "deletion_certificates" USING btree ("organisation_id","certificate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_document_number_unique" ON "document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_org_hash_unique" ON "document_versions" USING btree ("organisation_id","sha256");--> statement-breakpoint
CREATE INDEX "documents_org_project_idx" ON "documents" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_claims_version_key_unique" ON "draft_claims" USING btree ("draft_version_id","claim_key");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_versions_draft_number_unique" ON "draft_versions" USING btree ("draft_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "drafts_project_section_unique" ON "drafts" USING btree ("project_id","section_key");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_tender_lots_project_lot_unique" ON "engagement_tender_lots" USING btree ("project_id","tender_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entitlement_usage_entitlement_key_unique" ON "entitlement_usage" USING btree ("entitlement_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "entitlements_org_kind_status_idx" ON "entitlements" USING btree ("organisation_id","product_kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_cases_corpus_fixture_unique" ON "evaluation_cases" USING btree ("corpus_version","fixture_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_results_run_case_unique" ON "evaluation_results" USING btree ("evaluation_run_id","evaluation_case_id");--> statement-breakpoint
CREATE INDEX "evaluation_runs_task_status_idx" ON "evaluation_runs" USING btree ("task","status");--> statement-breakpoint
CREATE INDEX "export_deliveries_org_status_idx" ON "export_deliveries" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_tenant_key_unique" ON "feature_flags" USING btree ("organisation_id","key") WHERE "feature_flags"."organisation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_global_key_unique" ON "feature_flags" USING btree ("key") WHERE "feature_flags"."organisation_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_configs_scope_type_provider_unique" ON "integration_configurations" USING btree ("organisation_id","adapter_type","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_receipts_type_event_unique" ON "integration_receipts" USING btree ("adapter_type","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_number_unique" ON "invoices" USING btree ("organisation_id","invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_rule_packs_key_version_unique" ON "jurisdiction_rule_packs" USING btree ("pack_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_rules_pack_key_unique" ON "jurisdiction_rules" USING btree ("rule_pack_id","rule_key");--> statement-breakpoint
CREATE INDEX "legal_holds_org_project_status_idx" ON "legal_holds" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "model_configs_scope_task_version_unique" ON "model_configurations" USING btree ("organisation_id","task","configuration_version");--> statement-breakpoint
CREATE INDEX "nda_records_org_client_status_idx" ON "nda_records" USING btree ("organisation_id","client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempt_event_number_unique" ON "notification_attempts" USING btree ("notification_event_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempt_idempotency_unique" ON "notification_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_org_idempotency_unique" ON "orders" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_memberships_org_user_unique" ON "organisation_memberships" USING btree ("organisation_id","user_id");--> statement-breakpoint
CREATE INDEX "organisation_memberships_user_status_idx" ON "organisation_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_project_unique" ON "outcomes" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_manifest_items_version_ordinal_unique" ON "package_manifest_items" USING btree ("package_version_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "package_signoffs_version_signer_unique" ON "package_signoffs" USING btree ("package_version_id","signer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "package_versions_package_number_unique" ON "package_versions" USING btree ("package_id","version_number");--> statement-breakpoint
CREATE INDEX "packages_org_project_status_idx" ON "packages" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_branding_partner_unique" ON "partner_branding" USING btree ("partner_organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_relationships_partner_client_unique" ON "partner_relationships" USING btree ("partner_organisation_id","client_organisation_id");--> statement-breakpoint
CREATE INDEX "partner_revenue_share_partner_period_idx" ON "partner_revenue_share_entries" USING btree ("partner_organisation_id","period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_reference_unique" ON "payments" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_idempotency_unique" ON "payments" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "price_book_entries_book_product_unique" ON "price_book_entries" USING btree ("price_book_id","product_code");--> statement-breakpoint
CREATE UNIQUE INDEX "price_books_scope_name_version_unique" ON "price_books" USING btree ("organisation_id","name","version_number");--> statement-breakpoint
CREATE INDEX "privacy_records_org_type_effective_idx" ON "privacy_records" USING btree ("organisation_id","record_type","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_org_idempotency_unique" ON "processing_jobs" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "processing_jobs_status_available_priority_idx" ON "processing_jobs" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX "processing_runs_org_job_idx" ON "processing_runs" USING btree ("organisation_id","job_id");--> statement-breakpoint
CREATE INDEX "projects_org_created_idx" ON "projects" USING btree ("organisation_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_org_client_idx" ON "projects" USING btree ("organisation_id","client_id");--> statement-breakpoint
CREATE INDEX "projects_org_tender_lot_idx" ON "projects" USING btree ("organisation_id","tender_ref","lot");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_configs_scope_task_version_unique" ON "prompt_configurations" USING btree ("organisation_id","task","prompt_version");--> statement-breakpoint
CREATE INDEX "red_team_findings_run_status_idx" ON "red_team_findings" USING btree ("red_team_run_id","status");--> statement-breakpoint
CREATE INDEX "red_team_runs_org_project_status_idx" ON "red_team_runs" USING btree ("organisation_id","project_id","status");--> statement-breakpoint
CREATE INDEX "renewal_monitors_status_next_idx" ON "renewal_monitors" USING btree ("status","next_notification_at");--> statement-breakpoint
CREATE INDEX "requirement_citations_requirement_idx" ON "requirement_citations" USING btree ("requirement_id","verification_status");--> statement-breakpoint
CREATE INDEX "retention_actions_org_status_idx" ON "retention_actions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_requests_one_pending_per_project" ON "retention_requests" USING btree ("project_id") WHERE "retention_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "reviews_org_type_status_idx" ON "reviews" USING btree ("organisation_id","review_type","status");--> statement-breakpoint
CREATE INDEX "role_grants_membership_active_idx" ON "role_grants" USING btree ("membership_id","revoked_at");--> statement-breakpoint
CREATE INDEX "rule_evaluations_org_project_idx" ON "rule_evaluations" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_overrides_evaluation_unique" ON "rule_overrides" USING btree ("rule_evaluation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subprocessors_org_name_service_unique" ON "subprocessors" USING btree ("organisation_id","legal_name","service");--> statement-breakpoint
CREATE INDEX "subscriptions_org_status_idx" ON "subscriptions" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_lots_tender_reference_unique" ON "tender_lots" USING btree ("tender_id","lot_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "tenders_org_reference_unique" ON "tenders" USING btree ("organisation_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_org_idempotency_unique" ON "upload_sessions" USING btree ("organisation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_item_versions_item_number_unique" ON "vault_item_versions" USING btree ("vault_item_id","version_number");--> statement-breakpoint
CREATE INDEX "vault_usage_org_project_idx" ON "vault_usage" USING btree ("organisation_id","project_id");--> statement-breakpoint
CREATE INDEX "work_tasks_org_owner_status_due_idx" ON "work_tasks" USING btree ("organisation_id","owner_membership_id","status","due_at");