-- Deployed AI retrieval/index registry.
--
-- A global, deployment-scoped control-plane table holding the live,
-- content-addressed identity of the retrieval pipeline and corpus-index
-- definitions. It carries no tenant data and no organisation column: the
-- registered identity is a property of the deployment, exactly like
-- app_config. Tenant isolation of the retrieval corpus itself is attested
-- live against the FORCE-RLS source tables by the release-gate attestation,
-- and this table is part of the pinned public-table inventory verified at
-- startup, so an unregistered or drifted registry fails closed.
--
-- Rows are append-and-supersede only: the runtime may register a new active
-- identity (superseding the prior one) but may never delete history, so the
-- registry retains the full deployment lineage.
CREATE TABLE "ai_retrieval_registry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "component" text NOT NULL,
  "version" text NOT NULL,
  "content_sha256" text NOT NULL,
  "canonical_definition" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "registered_at" timestamp with time zone NOT NULL DEFAULT now(),
  "superseded_at" timestamp with time zone,
  CONSTRAINT "ai_retrieval_registry_component_check"
    CHECK ("component" IN ('retrieval', 'index')),
  CONSTRAINT "ai_retrieval_registry_status_check"
    CHECK ("status" IN ('active', 'superseded')),
  CONSTRAINT "ai_retrieval_registry_content_sha256_check"
    CHECK ("content_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_retrieval_registry_version_check"
    CHECK ("version" ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,199}$'),
  CONSTRAINT "ai_retrieval_registry_superseded_check"
    CHECK (("status" = 'active') = ("superseded_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_retrieval_registry_active_component_idx"
  ON "ai_retrieval_registry" USING btree ("component")
  WHERE "status" = 'active';
--> statement-breakpoint

-- Runtime may read the registry and register/supersede identities, but the
-- deployment lineage is immutable: DELETE and destructive lifecycle
-- privileges are withheld, mirroring the 0008 grant discipline.
DO $runtime_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT SELECT, INSERT, UPDATE
      ON TABLE public.ai_retrieval_registry
      TO valo_app_runtime;
    REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.ai_retrieval_registry
      FROM valo_app_runtime;
  END IF;
END;
$runtime_grant$;
