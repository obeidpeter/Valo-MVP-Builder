import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OperationalSignals,
  configureOperationsDelivery,
  operationsDeliveryStatus,
  requestCorrelationId,
} from "./observability";

describe("operational observability foundation", () => {
  it("accepts only bounded log-safe request correlation IDs", () => {
    assert.equal(
      requestCorrelationId({ "x-request-id": "edge-01:request_42" }),
      "edge-01:request_42",
    );
    assert.match(
      requestCorrelationId({ "x-request-id": "bad\nlog-entry" }),
      /^[0-9a-f-]{36}$/u,
    );
    assert.match(
      requestCorrelationId({ "x-request-id": ["ambiguous", "value"] }),
      /^[0-9a-f-]{36}$/u,
    );
  });

  it("records low-cardinality HTTP and database pool signals", () => {
    configureOperationsDelivery({});
    const signals = new OperationalSignals();
    const finishOk = signals.begin();
    const finishError = signals.begin();
    finishOk(204, 24);
    finishOk(500, 50_000);
    finishError(503, 750);

    const snapshot = signals.snapshot(
      { idle: 2, total: 4, waiting: 1 },
      "accepting",
    );
    assert.equal(snapshot.http.started, 2);
    assert.equal(snapshot.http.active, 0);
    assert.equal(snapshot.http.responses["2xx"], 1);
    assert.equal(snapshot.http.responses["5xx"], 1);
    assert.equal(snapshot.http.durationMilliseconds.le_25, 1);
    assert.equal(snapshot.http.durationMilliseconds.le_2000, 1);
    assert.deepEqual(snapshot.databasePool, { idle: 2, total: 4, waiting: 1 });
    assert.deepEqual(snapshot.delivery, {
      metrics: "disconnected",
      paging: "disconnected",
    });
  });

  it("never implies that absent delivery adapters are active", () => {
    configureOperationsDelivery({});
    assert.deepEqual(operationsDeliveryStatus(), {
      metrics: "disconnected",
      paging: "disconnected",
    });
  });
});
