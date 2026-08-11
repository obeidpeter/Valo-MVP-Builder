import "../test-env";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import express from "express";
import {
  createDurableWorkerFoundationRouter,
  type DurableWorkerRouteDependencies,
} from "./durableWorkerFoundation";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";

function dependencies(): {
  value: DurableWorkerRouteDependencies;
  calls: { enqueue: number; prepare: number; reconcile: number };
} {
  const calls = { enqueue: 0, prepare: 0, reconcile: 0 };
  const unavailable = async (): Promise<never> => {
    throw new Error("unexpected call");
  };
  return {
    calls,
    value: {
      worker: {
        enqueue: async () => {
          calls.enqueue += 1;
          return unavailable();
        },
        claimNext: unavailable,
        heartbeat: unavailable,
        succeed: unavailable,
        fail: unavailable,
        cancel: unavailable,
        recover: unavailable,
      },
      outbox: {
        prepare: async () => {
          calls.prepare += 1;
          return {
            event: { version: 2 },
            attempt: { id: EVENT },
            fenceToken: 2,
            providerInvocationAllowed: false,
          } as never;
        },
        blockPrepared: unavailable,
        claimReconciliation: unavailable,
        recoverExpired: unavailable,
        resolveReconciliation: async () => {
          calls.reconcile += 1;
          return unavailable();
        },
      },
      resolveScope: () => ({ organisationId: ORG, projectId: PROJECT }),
      authorize: () => true,
      resolveActorUserId: () => null,
    },
  };
}

async function withServer(
  dependencies: DurableWorkerRouteDependencies,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    "/internal/worker",
    createDurableWorkerFoundationRouter(dependencies),
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}/internal/worker`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("body tenant injection is rejected before enqueue", async () => {
  const fixture = dependencies();
  await withServer(fixture.value, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId: "99999999-9999-4999-8999-999999999999",
        capability: "documents.thumbnail@v1",
        idempotencyDigest: "a".repeat(64),
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_scope" });
  });
  assert.equal(fixture.calls.enqueue, 0);
});

test("prepared outbox attempts truthfully report provider invocation disabled", async () => {
  const fixture = dependencies();
  await withServer(fixture.value, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/outbox/${EVENT}/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fenceToken: 1,
        workerId: "worker-1",
        leaseMs: 30_000,
      }),
    });
    assert.equal(response.status, 202);
    const payload = (await response.json()) as {
      prepared: { providerInvocationAllowed: boolean };
    };
    assert.equal(payload.prepared.providerInvocationAllowed, false);
  });
  assert.equal(fixture.calls.prepare, 1);
});

test("reconciliation cannot assert delivery without a trusted receipt verifier", async () => {
  const fixture = dependencies();
  await withServer(fixture.value, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/outbox/${EVENT}/reconciliation/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fenceToken: 2,
          workerId: "reconciler-1",
          outcome: "delivered",
        }),
      },
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "provider_disconnected" });
  });
  assert.equal(fixture.calls.reconcile, 0);
});
