import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RuntimeReadiness,
  createGracefulShutdown,
  shutdownTimeouts,
} from "./runtimeLifecycle";

function silentLogger() {
  return {
    error() {},
    info() {},
    warn() {},
  };
}

describe("runtime lifecycle", () => {
  it("moves only from starting to accepting to draining", () => {
    const readiness = new RuntimeReadiness();
    assert.equal(readiness.current(), "starting");
    assert.equal(readiness.isReady(), false);
    readiness.markAccepting();
    assert.equal(readiness.isReady(), true);
    assert.equal(readiness.beginDrain(), true);
    assert.equal(readiness.current(), "draining");
    assert.equal(readiness.beginDrain(), false);
    readiness.markAccepting();
    assert.equal(readiness.current(), "draining");
  });

  it("drains HTTP before closing the database and is idempotent", async () => {
    const events: string[] = [];
    const readiness = new RuntimeReadiness();
    readiness.markAccepting();
    const server = {
      close(callback: (error?: Error) => void) {
        events.push("http-close");
        queueMicrotask(() => {
          events.push("http-drained");
          callback();
        });
        return this;
      },
      closeAllConnections() {
        events.push("http-force");
      },
      closeIdleConnections() {
        events.push("http-idle-close");
      },
    };
    const graceful = createGracefulShutdown({
      closeDatabase: async () => {
        events.push("database-close");
      },
      databaseCloseTimeoutMillis: 1_000,
      drainTimeoutMillis: 1_000,
      logger: silentLogger(),
      readiness,
      server,
    });

    const first = graceful.request("SIGTERM");
    const second = graceful.request("SIGINT");
    assert.equal(first, second);
    assert.deepEqual(await first, {
      signal: "SIGTERM",
      http: "drained",
      database: "closed",
      exitCode: 0,
    });
    assert.equal(readiness.current(), "draining");
    assert.deepEqual(events, [
      "http-close",
      "http-idle-close",
      "http-drained",
      "database-close",
    ]);
  });

  it("forces active HTTP connections after the bounded drain deadline", async () => {
    let forced = 0;
    const graceful = createGracefulShutdown({
      closeDatabase: async () => {},
      databaseCloseTimeoutMillis: 1_000,
      drainTimeoutMillis: 5,
      logger: silentLogger(),
      readiness: new RuntimeReadiness(),
      server: {
        close() {
          return this;
        },
        closeAllConnections() {
          forced += 1;
        },
        closeIdleConnections() {},
      },
    });

    const outcome = await graceful.request("SIGTERM");
    assert.equal(outcome.http, "forced");
    assert.equal(outcome.database, "closed");
    assert.equal(forced, 1);
  });

  it("fails shutdown when the database pool misses its close deadline", async () => {
    const graceful = createGracefulShutdown({
      closeDatabase: () => new Promise<void>(() => {}),
      databaseCloseTimeoutMillis: 5,
      drainTimeoutMillis: 1_000,
      logger: silentLogger(),
      readiness: new RuntimeReadiness(),
      server: {
        close(callback) {
          callback();
          return this;
        },
        closeAllConnections() {},
        closeIdleConnections() {},
      },
    });

    const outcome = await graceful.request("SIGINT");
    assert.equal(outcome.database, "timed_out");
    assert.equal(outcome.exitCode, 1);
  });

  it("validates operator-configured shutdown budgets", () => {
    assert.deepEqual(shutdownTimeouts({}), {
      databaseCloseTimeoutMillis: 5_000,
      drainTimeoutMillis: 15_000,
    });
    assert.deepEqual(
      shutdownTimeouts({
        VALO_DB_CLOSE_TIMEOUT_MS: "3000",
        VALO_HTTP_DRAIN_TIMEOUT_MS: "20000",
      }),
      { databaseCloseTimeoutMillis: 3_000, drainTimeoutMillis: 20_000 },
    );
    assert.throws(
      () => shutdownTimeouts({ VALO_HTTP_DRAIN_TIMEOUT_MS: "forever" }),
      /must be numeric/u,
    );
  });
});
