import assert from "node:assert/strict";
import test from "node:test";
import {
  formatReplitProductionStartupError,
  startReplitProduction,
} from "./start-replit-production.mjs";

test("runs the migration gate before importing the API in the inherited environment", async () => {
  const environment = {
    NODE_ENV: "production",
    REPLIT_DEPLOYMENT: "1",
    PORT: "8080",
  };
  const events = [];

  await startReplitProduction({
    environment,
    runMigrations: async (receivedEnvironment) => {
      assert.equal(receivedEnvironment, environment);
      events.push("migration");
    },
    importApiServer: async () => {
      events.push("api");
    },
  });

  assert.deepEqual(events, ["migration", "api"]);
});

test("never imports the API when the migration gate fails", async () => {
  let apiImported = false;
  const migrationError = new Error(
    "Replit intake migration gate failed: production journal is drifted",
  );

  await assert.rejects(
    startReplitProduction({
      runMigrations: async () => {
        throw migrationError;
      },
      importApiServer: async () => {
        apiImported = true;
      },
    }),
    migrationError,
  );
  assert.equal(apiImported, false);
});

test("delegates the Replit-production environment boundary to the bounded launcher", async () => {
  let apiImported = false;

  await assert.rejects(
    startReplitProduction({
      environment: {
        NODE_ENV: "development",
        REPLIT_DEPLOYMENT: "1",
      },
      importApiServer: async () => {
        apiImported = true;
      },
    }),
    /restricted to Replit production/,
  );
  assert.equal(apiImported, false);
});

test("preserves bounded gate reasons and redacts operational failures", () => {
  const boundedFailure = new Error(
    "Replit intake migration gate failed: DATABASE_URL is required for the migration owner",
  );
  assert.equal(
    formatReplitProductionStartupError(boundedFailure),
    boundedFailure.message,
  );
  assert.equal(
    formatReplitProductionStartupError(
      new Error(
        "connect ECONNREFUSED postgresql://owner:secret@database.example/valo",
      ),
    ),
    "Replit production startup failed: migration gate or server bootstrap operation failed",
  );
});
