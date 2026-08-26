-- Delivery guard least privilege.
--
-- 0012 created the four delivery-source release-boundary functions in the
-- public schema (their trigger bodies call each other schema-qualified, so
-- they must stay there), but left the default PUBLIC EXECUTE grant in place
-- and no startup attestation covered them. This migration closes both gaps:
--
-- 1. Remove EXECUTE from PUBLIC on all four functions.
-- 2. Grant EXECUTE back to the constrained runtime role only on the two
--    helpers the SECURITY INVOKER trigger bodies call as the mutating role
--    (project resolution and mutability assertion). The two trigger entry
--    points need no grant at all: PostgreSQL checks trigger-function EXECUTE
--    when the owner creates the trigger, never when the trigger fires.
--
-- The functions' shape and normalized source are pinned by the startup
-- attestation in lib/db/src/runtimeSecurity.ts from this migration onward.
REVOKE ALL ON FUNCTION public.valo_delivery_source_project_id(name, jsonb)
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION
  public.valo_assert_delivery_project_mutable(uuid, boolean)
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_delivery_project_delete()
  FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.valo_guard_delivery_source_mutation()
  FROM PUBLIC;
--> statement-breakpoint

DO $runtime_grant$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'valo_app_runtime'
  ) THEN
    GRANT EXECUTE
      ON FUNCTION public.valo_delivery_source_project_id(name, jsonb)
      TO valo_app_runtime;
    GRANT EXECUTE
      ON FUNCTION public.valo_assert_delivery_project_mutable(uuid, boolean)
      TO valo_app_runtime;
    REVOKE EXECUTE
      ON FUNCTION public.valo_guard_delivery_project_delete()
      FROM valo_app_runtime;
    REVOKE EXECUTE
      ON FUNCTION public.valo_guard_delivery_source_mutation()
      FROM valo_app_runtime;
  END IF;
END;
$runtime_grant$;
