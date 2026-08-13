import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticatedActorRateLimitKey,
  authenticatedActorRateLimitPolicy,
  authenticatedRateLimitKey,
  authenticatedRateLimitOperation,
  authenticatedRateLimitPolicy,
} from "./authenticatedRateLimitPolicy";

test("authenticated limiter configuration is bounded and deterministic", () => {
  assert.deepEqual(authenticatedRateLimitPolicy({}), {
    max: 120,
    windowSeconds: 60,
  });
  assert.deepEqual(
    authenticatedRateLimitPolicy({
      AUTHENTICATED_RATE_LIMIT_MAX_REQUESTS: "250",
      AUTHENTICATED_RATE_LIMIT_WINDOW_SECONDS: "300",
    }),
    { max: 250, windowSeconds: 300 },
  );
  assert.deepEqual(authenticatedActorRateLimitPolicy({}), {
    max: 180,
    windowSeconds: 60,
  });
  assert.deepEqual(
    authenticatedRateLimitPolicy({
      AUTHENTICATED_RATE_LIMIT_MAX_REQUESTS: "0",
      AUTHENTICATED_RATE_LIMIT_WINDOW_SECONDS: "99999",
    }),
    { max: 120, windowSeconds: 60 },
  );
});

test("hostile paths share one durable actor bucket", () => {
  const actorKey = authenticatedActorRateLimitKey(
    "00000000-0000-4000-8000-000000000001",
  );
  assert.match(actorKey, /^[0-9a-f]{64}$/u);
  assert.equal(
    actorKey,
    authenticatedActorRateLimitKey("00000000-0000-4000-8000-000000000001"),
  );
  assert.notEqual(
    actorKey,
    authenticatedActorRateLimitKey("00000000-0000-4000-8000-000000000002"),
  );
});

test("operation classes collapse identifiers and hostile path cardinality", () => {
  assert.equal(
    authenticatedRateLimitOperation({
      method: "patch",
      path: "/projects/00000000-0000-4000-8000-000000000001/reports/123",
    }),
    "PATCH:projects",
  );
  assert.equal(
    authenticatedRateLimitOperation({
      method: "post",
      path: "/projects/%2F-unbounded-client-value/actions",
    }),
    "POST:projects",
  );
  const hostileClasses = new Set(
    Array.from({ length: 1_000 }, (_value, index) =>
      authenticatedRateLimitOperation({
        method: "post",
        path: `/hostile-${index}/arbitrary-${index}`,
      }),
    ),
  );
  assert.deepEqual([...hostileClasses], ["POST:other"]);
});

test("opaque keys bind tenant, actor, authority source and operation", () => {
  const baseline = {
    actorId: "actor-a",
    accessSource: "membership",
    operation: "POST:/evidence",
    organisationId: "org-a",
  };
  const key = authenticatedRateLimitKey(baseline);
  assert.match(key, /^[0-9a-f]{64}$/u);
  assert.notEqual(
    key,
    authenticatedRateLimitKey({ ...baseline, organisationId: "org-b" }),
  );
  assert.notEqual(
    key,
    authenticatedRateLimitKey({ ...baseline, actorId: "actor-b" }),
  );
});
