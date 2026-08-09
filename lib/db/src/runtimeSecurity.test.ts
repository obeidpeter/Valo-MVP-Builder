import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isProductionRuntime,
  selectDatabaseConnectionString,
} from "./runtimeSecurity";

describe("production database selection", () => {
  test("uses DATABASE_URL only outside production", () => {
    assert.equal(
      selectDatabaseConnectionString({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://owner:secret@example.test/valo",
      }),
      "postgresql://owner:secret@example.test/valo",
    );
  });

  test("requires the dedicated runtime URL in production", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://owner:secret@example.test/valo",
        }),
      /VALO_RUNTIME_DATABASE_URL is required/,
    );
  });

  test("rejects a Replit deployment without NODE_ENV=production", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          REPLIT_DEPLOYMENT: "1",
          DATABASE_URL: "postgresql://owner:secret@example.test/valo",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo",
        }),
      /require NODE_ENV=production/,
    );
  });

  test("recognises a correctly configured Replit deployment", () => {
    const environment = {
      NODE_ENV: "production",
      REPLIT_DEPLOYMENT: "1",
      DATABASE_URL: "postgresql://owner:secret@example.test/valo",
      VALO_RUNTIME_DATABASE_URL:
        "postgresql://valo_app_runtime:runtime@example.test/valo",
    };
    assert.equal(isProductionRuntime(environment), true);
    assert.equal(
      selectDatabaseConnectionString(environment),
      environment.VALO_RUNTIME_DATABASE_URL,
    );
  });

  test("rejects a malformed production URL without echoing it", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "not a postgres URL with secret-owner-value",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo",
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "production database URL is malformed" &&
        !error.message.includes("secret-owner-value"),
    );
  });

  test("rejects a runtime URL for a different database target", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL: "postgresql://owner:secret@example.test/valo",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/other",
        }),
      /must preserve the managed target and TLS parameters/,
    );
  });

  test("requires runtime TLS parameters to match the managed URL", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://owner:secret@example.test/valo?sslmode=require&channel_binding=require",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo?sslmode=disable&channel_binding=require",
        }),
      /must preserve the managed target and TLS parameters/,
    );
  });

  test("rejects credentials in query parameters", () => {
    assert.throws(
      () =>
        selectDatabaseConnectionString({
          NODE_ENV: "production",
          DATABASE_URL:
            "postgresql://owner:secret@example.test/valo?sslmode=require&user=owner",
          VALO_RUNTIME_DATABASE_URL:
            "postgresql://valo_app_runtime:runtime@example.test/valo?sslmode=require&user=owner",
        }),
      /credentials must be carried only in URL userinfo/,
    );
  });
});
