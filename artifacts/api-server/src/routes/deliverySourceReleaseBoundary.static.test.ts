import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../../../lib/db/migrations/0012_delivery_source_release_boundary.sql",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const leastPrivilegeMigration = readFileSync(
  new URL(
    "../../../../lib/db/migrations/0013_delivery_guard_least_privilege.sql",
    import.meta.url,
  ),
  "utf8",
).replaceAll("\r\n", "\n");
const runtimeSecuritySource = readFileSync(
  new URL("../../../../lib/db/src/runtimeSecurity.ts", import.meta.url),
  "utf8",
);

test("every exact-source table shares the terminal-project release lock", () => {
  for (const table of [
    "documents",
    "document_versions",
    "document_version_snapshots",
    "requirements",
    "evidence_items",
    "drafts",
    "draft_versions",
    "draft_claims",
    "claim_evidence_links",
    "defects",
    "boq_checks",
    "red_team_runs",
    "red_team_findings",
    "reviews",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `BEFORE INSERT OR UPDATE OR DELETE ON public\\.${table}\\nFOR EACH ROW EXECUTE FUNCTION public\\.valo_guard_delivery_source_mutation\\(\\);`,
        "u",
      ),
    );
  }
  assert.match(migration, /FOR KEY SHARE;/u);
  assert.match(
    migration,
    /project_status IN \('signed_off', 'exported', 'archived'\)/u,
  );
  assert.match(migration, /TG_OP = 'DELETE'/u);
  assert.match(migration, /FK cascades run after their guarded owner/u);
  assert.match(
    migration,
    /to_regprocedure\([\s\S]*valo_security\.purge_retention_project/u,
  );
  assert.match(migration, /CURRENT_USER::name = retention_purge_owner/u);
  assert.match(
    migration,
    /previous_project_id IS DISTINCT FROM next_project_id/u,
  );
  assert.match(
    migration,
    /allow_terminal_delete OR authorized_retention_owner/u,
  );
  assert.match(
    migration,
    /WHEN 'red_team_findings' THEN[\s\S]*FROM public\.red_team_runs AS run/u,
  );
});

test("project deletion is reserved for the governed retention purge owner", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.valo_guard_delivery_project_delete\(\)[\s\S]*routine\.prosecdef[\s\S]*CURRENT_USER::name IS DISTINCT FROM retention_purge_owner/u,
  );
  assert.match(
    migration,
    /CREATE TRIGGER delivery_project_delete_guard\nBEFORE DELETE ON public\.projects\nFOR EACH ROW EXECUTE FUNCTION public\.valo_guard_delivery_project_delete\(\);/u,
  );
  assert.match(
    migration,
    /REVOKE DELETE ON TABLE public\.clients, public\.projects[\s\S]*FROM valo_app_runtime/u,
  );
  assert.equal(
    [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\./gu)].length,
    4,
  );
  assert.equal([...migration.matchAll(/CREATE TRIGGER /gu)].length, 15);
});

test("the guard functions carry the 0013 least-privilege posture", () => {
  for (const signature of [
    "public.valo_delivery_source_project_id(name, jsonb)",
    "public.valo_assert_delivery_project_mutable(uuid, boolean)",
    "public.valo_guard_delivery_project_delete()",
    "public.valo_guard_delivery_source_mutation()",
  ]) {
    assert.match(
      leastPrivilegeMigration,
      new RegExp(
        `REVOKE ALL ON FUNCTION\\s+${signature
          .replaceAll(".", "\\.")
          .replaceAll("(", "\\(")
          .replaceAll(")", "\\)")}\\s+FROM PUBLIC`,
        "u",
      ),
      `${signature} must lose the default PUBLIC execute grant`,
    );
  }
  // The SECURITY INVOKER trigger bodies call these two helpers as the
  // mutating role, so only they are granted back to the runtime; the two
  // trigger entry points stay owner-only.
  assert.match(
    leastPrivilegeMigration,
    /GRANT EXECUTE\s+ON FUNCTION public\.valo_delivery_source_project_id\(name, jsonb\)\s+TO valo_app_runtime/u,
  );
  assert.match(
    leastPrivilegeMigration,
    /GRANT EXECUTE\s+ON FUNCTION public\.valo_assert_delivery_project_mutable\(uuid, boolean\)\s+TO valo_app_runtime/u,
  );
  assert.match(
    leastPrivilegeMigration,
    /REVOKE EXECUTE\s+ON FUNCTION public\.valo_guard_delivery_project_delete\(\)\s+FROM valo_app_runtime/u,
  );
  assert.match(
    leastPrivilegeMigration,
    /REVOKE EXECUTE\s+ON FUNCTION public\.valo_guard_delivery_source_mutation\(\)\s+FROM valo_app_runtime/u,
  );
  assert.doesNotMatch(
    leastPrivilegeMigration,
    /GRANT EXECUTE[\s\S]{0,120}valo_guard_delivery/u,
    "trigger entry points must never be granted to the runtime role",
  );
});

test("startup attestation pins the guard functions independently", () => {
  assert.match(
    runtimeSecuritySource,
    /EXPECTED_DELIVERY_GUARD_FUNCTIONS/u,
    "the delivery guard functions must have their own pinned inventory",
  );
  assert.match(
    runtimeSecuritySource,
    /assertDeliveryGuardFunctionAttestation\(deliveryGuardFunctionProofs\.rows\)/u,
    "the delivery guard attestation must run inside the startup proof",
  );
  for (const functionName of [
    "valo_assert_delivery_project_mutable",
    "valo_delivery_source_project_id",
    "valo_guard_delivery_project_delete",
    "valo_guard_delivery_source_mutation",
  ]) {
    assert.match(runtimeSecuritySource, new RegExp(functionName, "u"));
  }
});
