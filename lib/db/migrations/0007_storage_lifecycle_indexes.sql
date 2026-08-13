ALTER TABLE "app_config"
  ADD COLUMN "storage_lifecycle_cursor_organisation_id" uuid,
  ADD COLUMN "storage_lifecycle_lease_owner" text,
  ADD COLUMN "storage_lifecycle_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "notification_events"
  ADD COLUMN "available_at" timestamp with time zone NOT NULL DEFAULT now();
--> statement-breakpoint
CREATE INDEX "notification_events_storage_reconcile_idx"
  ON "notification_events" USING btree ("organisation_id", "available_at", "created_at", "id")
  WHERE "channel" = 'internal_storage'
    AND "template" = 'valo.storage-deletion-intent/v1'
    AND "status" IN ('queued', 'retry_wait');
--> statement-breakpoint
CREATE INDEX "upload_sessions_cleanup_project_expiry_idx"
  ON "upload_sessions" USING btree ("organisation_id", "project_id", "expires_at", "id")
  WHERE "status" IN ('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed');
--> statement-breakpoint
CREATE INDEX "upload_sessions_cleanup_expiry_idx"
  ON "upload_sessions" USING btree ("organisation_id", "expires_at", "id")
  WHERE "status" IN ('open', 'completed', 'rejected', 'quarantined', 'cleanup_unconfirmed');
--> statement-breakpoint
CREATE INDEX "documents_org_object_path_idx"
  ON "documents" USING btree ("organisation_id", "object_path");
--> statement-breakpoint
CREATE INDEX "document_versions_org_object_path_idx"
  ON "document_versions" USING btree ("organisation_id", "object_path");
--> statement-breakpoint
CREATE INDEX "vault_items_org_object_path_idx"
  ON "vault_items" USING btree ("organisation_id", "object_path");
--> statement-breakpoint
CREATE INDEX "reports_org_docx_path_idx"
  ON "reports" USING btree ("organisation_id", "docx_path");
--> statement-breakpoint
CREATE INDEX "reports_org_pdf_path_idx"
  ON "reports" USING btree ("organisation_id", "pdf_path");
--> statement-breakpoint
CREATE INDEX "package_versions_org_docx_path_idx"
  ON "package_versions" USING btree ("organisation_id", "docx_object_path");
--> statement-breakpoint
CREATE INDEX "package_versions_org_pdf_path_idx"
  ON "package_versions" USING btree ("organisation_id", "pdf_object_path");
--> statement-breakpoint
CREATE INDEX "package_versions_org_zip_path_idx"
  ON "package_versions" USING btree ("organisation_id", "zip_object_path");
