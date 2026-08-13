import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

const repositoryUrl = new URL("./repository.ts", import.meta.url);
const routeUrl = new URL("../../routes/boqVerification.ts", import.meta.url);
const indexUrl = new URL("../../routes/index.ts", import.meta.url);

describe("BOQ verification static security contract", () => {
  test("runs are insert-only, tenant/project filtered, and audited", async () => {
    const source = await readFile(repositoryUrl, "utf8");
    assert.doesNotMatch(source, /\.update\(boqRuns\)|\.delete\(boqRuns\)/u);
    assert.doesNotMatch(source, /\.delete\(boqExceptions\)/u);
    assert.match(source, /withTenantDatabase\(scope\.organisationId/u);
    assert.match(
      source,
      /eq\(boqRuns\.organisationId, scope\.organisationId\)/u,
    );
    assert.match(source, /eq\(boqRuns\.projectId, scope\.projectId\)/u);
    assert.match(source, /writeAuditTx\(tx/u);
    assert.match(source, /pg_advisory_xact_lock/u);
    // A run binds only to the current cleared version of a governed document.
    assert.match(source, /malware_status = 'clean'/u);
    assert.match(source, /quarantine_status = 'cleared'/u);
    assert.match(
      source,
      /NOT EXISTS \([\s\S]*later_version\.version_number > current_version\.version_number/u,
    );
    // The pinned policy is the only policy the kernel ever receives.
    assert.match(source, /policy: NG_COMMERCIAL_BOQ_RULE_PACK/u);
    assert.equal((source.match(/verifyCommercialBoq\(/gu) ?? []).length, 1);
  });

  test("exception resolution is a guarded conditional update", async () => {
    const source = await readFile(repositoryUrl, "utf8");
    const updateAt = source.indexOf(".update(boqExceptions)");
    assert.ok(updateAt >= 0);
    const predicate = source.slice(updateAt, updateAt + 700);
    assert.match(predicate, /eq\(boqExceptions\.status, "open"\)/u);
    assert.match(predicate, /eq\(boqExceptions\.version, expectedVersion\)/u);
  });

  test("routes carry explicit permissions and no destructive verbs", async () => {
    const source = await readFile(routeUrl, "utf8");
    assert.doesNotMatch(source, /router\.(?:patch|put|delete)\(/u);
    assert.match(
      source,
      /requirePermissionOrLegacy\(BOQ_VERIFICATION_READ_PERMISSION\)/u,
    );
    assert.match(
      source,
      /requirePermissionOrLegacy\(BOQ_VERIFICATION_RUN_PERMISSION\)/u,
    );
    assert.match(
      source,
      /requirePermissionOrLegacy\(BOQ_VERIFICATION_RESOLVE_PERMISSION\)/u,
    );
    assert.match(source, /parseExpectedVersion\(request\.get\("If-Match"\)\)/u);
    assert.match(source, /Cache-Control", "private, no-store"/u);
  });

  test("the router is mounted after the tenant boundary pipeline", async () => {
    const source = await readFile(indexUrl, "utf8");
    const boundaryAt = source.indexOf(
      "router.use(enforceTenantResourceBoundary)",
    );
    const mountAt = source.indexOf("router.use(boqVerificationRouter)");
    assert.ok(boundaryAt >= 0, "tenant boundary mount missing");
    assert.ok(
      mountAt > boundaryAt,
      "BOQ verification must mount after the tenant boundary",
    );
  });
});
