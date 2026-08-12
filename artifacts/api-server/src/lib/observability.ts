import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import type { DatabasePoolSnapshot } from "@workspace/db";
import type { RuntimeLifecycleState } from "./runtimeLifecycle";

const CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const DURATION_BUCKETS = [25, 100, 500, 2_000, 10_000] as const;

type ResponseClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
type DeliveryState = "connected" | "disconnected";

export interface DeliveryStatus {
  metrics: DeliveryState;
  paging: DeliveryState;
}

export interface OperationalSignalsSnapshot {
  databasePool: DatabasePoolSnapshot;
  delivery: DeliveryStatus;
  http: {
    active: number;
    durationMilliseconds: Record<string, number>;
    responses: Record<ResponseClass, number>;
    started: number;
  };
  runtime: {
    lifecycle: RuntimeLifecycleState;
    uptimeSeconds: number;
  };
}

export interface OperationalSignalsAdapter {
  readonly status: DeliveryState;
  publish(snapshot: OperationalSignalsSnapshot): Promise<void>;
}

export interface PagingAdapter {
  readonly status: DeliveryState;
}

let metricsAdapter: OperationalSignalsAdapter | undefined;
let pagingAdapter: PagingAdapter | undefined;

/** Provider adapters are installed explicitly by the deployment composition. */
export function configureOperationsDelivery(adapters: {
  metrics?: OperationalSignalsAdapter;
  paging?: PagingAdapter;
}): void {
  metricsAdapter = adapters.metrics;
  pagingAdapter = adapters.paging;
}

export function operationsDeliveryStatus(): DeliveryStatus {
  return {
    metrics: metricsAdapter?.status ?? "disconnected",
    paging: pagingAdapter?.status ?? "disconnected",
  };
}

export function requestCorrelationId(headers: IncomingHttpHeaders): string {
  const supplied = headers["x-request-id"];
  if (typeof supplied === "string" && CORRELATION_ID.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

function responseClass(statusCode: number): ResponseClass {
  if (statusCode >= 500) return "5xx";
  if (statusCode >= 400) return "4xx";
  if (statusCode >= 300) return "3xx";
  if (statusCode >= 200) return "2xx";
  return "1xx";
}

export class OperationalSignals {
  private active = 0;
  private readonly durations = new Map<string, number>([
    ...DURATION_BUCKETS.map((bound) => [`le_${bound}`, 0] as const),
    ["overflow", 0],
  ]);
  private readonly responses: Record<ResponseClass, number> = {
    "1xx": 0,
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
  };
  private started = 0;

  begin(): (statusCode: number, durationMilliseconds: number) => void {
    this.active += 1;
    this.started += 1;
    let finished = false;
    return (statusCode, durationMilliseconds) => {
      if (finished) return;
      finished = true;
      this.active = Math.max(0, this.active - 1);
      this.responses[responseClass(statusCode)] += 1;
      const bound = DURATION_BUCKETS.find(
        (candidate) => durationMilliseconds <= candidate,
      );
      const key = bound === undefined ? "overflow" : `le_${bound}`;
      this.durations.set(key, (this.durations.get(key) ?? 0) + 1);
    };
  }

  middleware(): RequestHandler {
    return (_request, response, next) => {
      const startedAt = process.hrtime.bigint();
      const finish = this.begin();
      let complete = false;
      const record = () => {
        if (complete) return;
        complete = true;
        const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        finish(response.statusCode, elapsed);
      };
      response.once("finish", record);
      response.once("close", record);
      next();
    };
  }

  snapshot(
    databasePool: DatabasePoolSnapshot,
    lifecycle: RuntimeLifecycleState,
  ): OperationalSignalsSnapshot {
    return {
      databasePool: { ...databasePool },
      delivery: operationsDeliveryStatus(),
      http: {
        active: this.active,
        durationMilliseconds: Object.fromEntries(this.durations),
        responses: { ...this.responses },
        started: this.started,
      },
      runtime: {
        lifecycle,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    };
  }
}

export const operationalSignals = new OperationalSignals();

interface SignalsLogger {
  error(bindings: object, message: string): void;
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
}

export function startOperationalSignalHeartbeat(options: {
  getDatabasePool: () => DatabasePoolSnapshot;
  getLifecycle: () => RuntimeLifecycleState;
  intervalMillis?: number;
  logger: SignalsLogger;
  signals?: OperationalSignals;
}): () => void {
  const intervalMillis = options.intervalMillis ?? 60_000;
  if (
    !Number.isSafeInteger(intervalMillis) ||
    intervalMillis < 10_000 ||
    intervalMillis > 300_000
  ) {
    throw new Error(
      "Operational signal interval must be between 10000 and 300000 ms",
    );
  }
  const signals = options.signals ?? operationalSignals;
  const delivery = operationsDeliveryStatus();
  if (
    delivery.metrics === "disconnected" ||
    delivery.paging === "disconnected"
  ) {
    options.logger.warn(
      { delivery },
      "External observability delivery is not connected",
    );
  }
  const publish = () => {
    const snapshot = signals.snapshot(
      options.getDatabasePool(),
      options.getLifecycle(),
    );
    // Structured logs provide an immediately deployable, privacy-safe signal
    // stream. An external metrics adapter remains explicitly disconnected until
    // deployment composition installs and verifies one.
    options.logger.info(
      { operationalSignals: snapshot },
      "Operational signals",
    );
    if (metricsAdapter?.status === "connected") {
      void metricsAdapter.publish(snapshot).catch((error: unknown) => {
        options.logger.error(
          { err: error },
          "Operational signals adapter publish failed",
        );
      });
    }
  };
  publish();
  const interval = setInterval(publish, intervalMillis);
  interval.unref();
  return () => clearInterval(interval);
}
