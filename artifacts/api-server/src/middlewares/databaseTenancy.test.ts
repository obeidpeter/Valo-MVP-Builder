import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import type { AccessContext } from "./tenancy";
import {
  commitTenantDatabaseBeforeResponse,
  createAttachTenantDatabase,
  holdTenantDatabaseUntilComplete,
} from "./databaseTenancy";

const ORGANISATION_ID = "11111111-1111-4111-8111-111111111111";

function accessContext(): AccessContext {
  return {
    organisationId: ORGANISATION_ID,
    membershipId: "22222222-2222-4222-8222-222222222222",
    membershipOrganisationId: ORGANISATION_ID,
    source: "membership",
    roles: ["contributor"],
    permissions: new Set(),
    breakGlassSessionId: null,
    partnerRelationshipId: null,
    partnerCoSigningRequired: false,
  };
}

async function startBoundaryServer(options: { failCommit?: boolean }) {
  let commitReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    commitReached = resolve;
  });
  let releaseCommit!: () => void;
  const released = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const app = express();
  app.use((request, _response, next) => {
    Object.assign(request as Request & Record<string, unknown>, {
      accessContext: accessContext(),
    });
    next();
  });
  app.use(
    createAttachTenantDatabase(async (_organisationId, work) => {
      await work();
      commitReached();
      await released;
      if (options.failCommit) throw new Error("database commit failed");
    }),
  );
  app.post("/capability", async (request, response, next) => {
    holdTenantDatabaseUntilComplete(request);
    try {
      const firstCommit = commitTenantDatabaseBeforeResponse(request);
      const repeatedCommit = commitTenantDatabaseBeforeResponse(request);
      assert.equal(repeatedCommit, firstCommit);
      await repeatedCommit;
      response
        .status(201)
        .json({ uploadUrl: "https://storage.example/signed" });
    } catch (error) {
      next(error);
    }
  });
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      response.status(500).json({
        error: error instanceof Error ? error.message : "request failed",
      });
    },
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    reached,
    releaseCommit,
    url: `http://127.0.0.1:${address.port}/capability`,
  };
}

test("commit-before-response waits for the outer database commit", async () => {
  const fixture = await startBoundaryServer({});
  let settled = false;
  const responsePromise = fetch(fixture.url, { method: "POST" }).then(
    (response) => {
      settled = true;
      return response;
    },
  );
  await fixture.reached;
  assert.equal(settled, false);
  fixture.releaseCommit();
  const response = await responsePromise;
  assert.equal(response.status, 201);
  assert.equal(
    ((await response.json()) as Record<string, unknown>).uploadUrl,
    "https://storage.example/signed",
  );
  fixture.server.close();
  await once(fixture.server, "close");
});

test("commit failure suppresses the irreversible capability response", async () => {
  const fixture = await startBoundaryServer({ failCommit: true });
  const responsePromise = fetch(fixture.url, { method: "POST" });
  await fixture.reached;
  fixture.releaseCommit();
  const response = await responsePromise;
  assert.equal(response.status, 500);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.error, "database commit failed");
  assert.equal(body.uploadUrl, undefined);
  fixture.server.close();
  await once(fixture.server, "close");
});
