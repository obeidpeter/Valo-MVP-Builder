import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  createBoundedJsonBody,
  type BoundedJsonBodyDomain,
} from "./boundedJsonBody";

interface InvocationResult {
  nextCalls: number;
  status: number | null;
  body: unknown;
}

function invoke(
  method: string,
  body: unknown,
  maximumBytes: number,
  domain: BoundedJsonBodyDomain = "operations",
): InvocationResult {
  let nextCalls = 0;
  let status: number | null = null;
  let responseBody: unknown;
  const response = {
    status(code: number) {
      status = code;
      return this;
    },
    json(value: unknown) {
      responseBody = value;
      return this;
    },
  } as Response;
  const next = (() => {
    nextCalls += 1;
  }) as NextFunction;

  createBoundedJsonBody(maximumBytes, domain)(
    { method, body } as Request,
    response,
    next,
  );

  return { nextCalls, status, body: responseBody };
}

test("GET and HEAD bypass serialization and domain bounds", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;

  for (const method of ["GET", "HEAD"]) {
    assert.deepEqual(invoke(method, cyclic, 0), {
      nextCalls: 1,
      status: null,
      body: undefined,
    });
  }
});

test("accepts a serializable body at the exact UTF-8 byte limit", () => {
  const body = { label: "Lagos — é" };
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");

  assert.deepEqual(invoke("POST", body, bytes), {
    nextCalls: 1,
    status: null,
    body: undefined,
  });
});

test("measures non-ASCII JSON as UTF-8 bytes", () => {
  const body = { label: "é" };
  const serialized = JSON.stringify(body);
  assert.ok(Buffer.byteLength(serialized, "utf8") > serialized.length);

  assert.deepEqual(invoke("POST", body, serialized.length), {
    nextCalls: 0,
    status: 413,
    body: { error: "Request body exceeds the operations bound." },
  });
});

test("rejects bodies that JSON.stringify cannot serialize", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;

  for (const body of [cyclic, { value: 1n }]) {
    assert.deepEqual(invoke("PATCH", body, Number.MAX_SAFE_INTEGER), {
      nextCalls: 0,
      status: 400,
      body: { error: "Request body must be JSON serializable." },
    });
  }
});

test("preserves each route domain's exact oversized-body response", () => {
  const domains: readonly BoundedJsonBodyDomain[] = [
    "client-action",
    "communications",
    "consortium-room",
    "operations",
  ];

  for (const domain of domains) {
    assert.deepEqual(invoke("POST", { value: true }, 1, domain), {
      nextCalls: 0,
      status: 413,
      body: { error: `Request body exceeds the ${domain} bound.` },
    });
  }
});

test("normalizes a nullish body to an empty JSON object", () => {
  const emptyObjectBytes = Buffer.byteLength("{}", "utf8");

  assert.equal(invoke("DELETE", undefined, emptyObjectBytes).nextCalls, 1);
  assert.equal(invoke("DELETE", null, emptyObjectBytes).nextCalls, 1);
  assert.equal(invoke("DELETE", undefined, emptyObjectBytes - 1).status, 413);
});
