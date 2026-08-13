import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPERATIONAL_SIGNAL_REGISTRY_VERSION,
  OperationalSignals,
  configureOperationsDelivery,
  operationalSignalBatch,
  operationsDeliveryStatus,
  requestCorrelationId,
  startOperationalSignalHeartbeat,
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

  it("publishes only stable low-cardinality points and leaves ratios derived", () => {
    configureOperationsDelivery({});
    const signals = new OperationalSignals();
    signals.begin()(503, 600);
    const batch = operationalSignalBatch(
      signals.snapshot({ idle: 1, total: 2, waiting: 0 }, "accepting"),
      new Date("2026-08-13T12:00:00.000Z"),
    );

    assert.equal(batch.registryVersion, OPERATIONAL_SIGNAL_REGISTRY_VERSION);
    assert.equal(batch.source, "api_runtime");
    assert.equal(batch.emittedAt, "2026-08-13T12:00:00.000Z");
    assert.ok(
      batch.points.some(
        (point) =>
          point.name === "http.server.responses_total" &&
          point.labels?.status_class === "5xx" &&
          point.value === 1,
      ),
    );
    assert.equal(
      batch.points.some((point) => point.name === "http.server.error_ratio"),
      false,
    );
  });

  it("rejects adapters that claim connection without verification evidence", () => {
    assert.throws(
      () =>
        configureOperationsDelivery({
          metrics: {
            status: "connected",
            registryVersion: OPERATIONAL_SIGNAL_REGISTRY_VERSION,
            verificationEvidenceReference: null,
            publish: async () => undefined,
          },
        }),
      /verification evidence/u,
    );
    assert.throws(
      () =>
        configureOperationsDelivery({
          paging: {
            status: "connected",
            verificationEvidenceReference: "short",
          },
        }),
      /synthetic delivery evidence/u,
    );
    configureOperationsDelivery({});
  });

  it("keeps delivery disconnected until a bounded adapter publish succeeds", async () => {
    let publishCalls = 0;
    configureOperationsDelivery({
      metrics: {
        status: "connected",
        registryVersion: OPERATIONAL_SIGNAL_REGISTRY_VERSION,
        verificationEvidenceReference: "immutable-metrics-receipt-2026-08-13",
        publish: async (_batch, { signal }) => {
          publishCalls += 1;
          assert.equal(signal.aborted, false);
        },
      },
      paging: {
        status: "connected",
        verificationEvidenceReference: "immutable-paging-receipt-2026-08-13",
      },
    });
    assert.deepEqual(operationsDeliveryStatus(), {
      metrics: "disconnected",
      paging: "connected",
    });
    const stop = startOperationalSignalHeartbeat({
      getDatabasePool: () => ({ idle: 1, total: 1, waiting: 0 }),
      getLifecycle: () => "accepting",
      intervalMillis: 10_000,
      logger: {
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
      publishDeadlineMillis: 200,
    });
    assert.equal(publishCalls, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(operationsDeliveryStatus().metrics, "connected");
    stop();
    assert.equal(operationsDeliveryStatus().metrics, "disconnected");
    configureOperationsDelivery({});
  });

  it("aborts a hung publish, suppresses overlap, and degrades delivery", async () => {
    let publishCalls = 0;
    let aborts = 0;
    const logs: string[] = [];
    configureOperationsDelivery({
      metrics: {
        status: "connected",
        registryVersion: OPERATIONAL_SIGNAL_REGISTRY_VERSION,
        verificationEvidenceReference: "immutable-metrics-receipt-2026-08-13",
        publish: async (_batch, { signal }) => {
          publishCalls += 1;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborts += 1;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
    });
    const stop = startOperationalSignalHeartbeat({
      getDatabasePool: () => ({ idle: 1, total: 1, waiting: 0 }),
      getLifecycle: () => "accepting",
      intervalMillis: 10_000,
      logger: {
        error: (_bindings, message) => logs.push(message),
        info: () => undefined,
        warn: (_bindings, message) => logs.push(message),
      },
      publishDeadlineMillis: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(publishCalls, 1);
    assert.equal(aborts, 1);
    assert.equal(operationsDeliveryStatus().metrics, "disconnected");
    assert.ok(logs.includes("Operational signals adapter publish failed"));
    stop();
    configureOperationsDelivery({});
  });

  it("settles its own deadline when an adapter ignores abort", async () => {
    let publishCalls = 0;
    let scheduledTick: (() => void) | undefined;
    const errors: string[] = [];
    configureOperationsDelivery({
      metrics: {
        status: "connected",
        registryVersion: OPERATIONAL_SIGNAL_REGISTRY_VERSION,
        verificationEvidenceReference: "immutable-metrics-receipt-2026-08-13",
        publish: async () => {
          publishCalls += 1;
          await new Promise<void>(() => undefined);
        },
      },
    });
    const stop = startOperationalSignalHeartbeat({
      getDatabasePool: () => ({ idle: 1, total: 1, waiting: 0 }),
      getLifecycle: () => "accepting",
      intervalMillis: 10_000,
      logger: {
        error: (_bindings, message) => errors.push(message),
        info: () => undefined,
        warn: () => undefined,
      },
      publishDeadlineMillis: 100,
      scheduler: {
        clear: () => undefined,
        set: (callback) => {
          scheduledTick = callback;
          return { unref: () => undefined };
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(publishCalls, 1);
    scheduledTick?.();
    scheduledTick?.();
    assert.equal(publishCalls, 1);
    assert.equal(operationsDeliveryStatus().metrics, "disconnected");
    assert.deepEqual(errors, ["Operational signals adapter publish failed"]);
    stop();
    configureOperationsDelivery({});
  });
});
