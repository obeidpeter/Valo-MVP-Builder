export type RuntimeLifecycleState = "starting" | "accepting" | "draining";

export class RuntimeReadiness {
  private state: RuntimeLifecycleState = "starting";

  current(): RuntimeLifecycleState {
    return this.state;
  }

  markAccepting(): void {
    if (this.state === "starting") this.state = "accepting";
  }

  beginDrain(): boolean {
    if (this.state === "draining") return false;
    this.state = "draining";
    return true;
  }

  isReady(): boolean {
    return this.state === "accepting";
  }
}

export const runtimeReadiness = new RuntimeReadiness();

interface LifecycleLogger {
  error(bindings: object, message: string): void;
  info(bindings: object, message: string): void;
  warn(bindings: object, message: string): void;
}

export interface GracefulShutdownOptions {
  beforeDrain?: () => void;
  closeDatabase: () => Promise<void>;
  databaseCloseTimeoutMillis: number;
  drainTimeoutMillis: number;
  logger: LifecycleLogger;
  readiness?: RuntimeReadiness;
  server: {
    close(callback: (error?: Error) => void): unknown;
    closeAllConnections(): void;
    closeIdleConnections(): void;
  };
}

export interface ShutdownOutcome {
  database: "closed" | "failed" | "timed_out";
  exitCode: 0 | 1;
  http: "drained" | "forced";
  signal: NodeJS.Signals;
}

function isServerNotRunning(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING";
}

async function drainHttpServer(
  server: GracefulShutdownOptions["server"],
  timeoutMillis: number,
): Promise<"drained" | "forced"> {
  let timer: NodeJS.Timeout | undefined;
  const closed = new Promise<"drained">((resolve, reject) => {
    server.close((error?: Error) => {
      if (error && !isServerNotRunning(error)) {
        reject(error);
        return;
      }
      resolve("drained");
    });
    // Node 18+ closes keep-alive sockets that are not serving a request while
    // active requests retain the full bounded drain window.
    server.closeIdleConnections();
  });
  const deadline = new Promise<"forced">((resolve) => {
    // Keep the deadline referenced so shutdown settles before explicit exit.
    timer = setTimeout(() => {
      server.closeAllConnections();
      resolve("forced");
    }, timeoutMillis);
  });
  try {
    return await Promise.race([closed, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeDatabaseWithin(
  closeDatabase: () => Promise<void>,
  timeoutMillis: number,
): Promise<"closed" | "failed" | "timed_out"> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      closeDatabase()
        .then(() => "closed" as const)
        .catch(() => "failed" as const),
      new Promise<"timed_out">((resolve) => {
        // Keep the deadline referenced so shutdown settles before explicit exit.
        timer = setTimeout(() => resolve("timed_out"), timeoutMillis);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Stop admission, drain HTTP work up to a hard deadline, then close the pool.
 * Repeated signals share the same operation and cannot race a second pool end.
 */
export function createGracefulShutdown(options: GracefulShutdownOptions): {
  request(signal: NodeJS.Signals): Promise<ShutdownOutcome>;
} {
  let shutdown: Promise<ShutdownOutcome> | undefined;
  return {
    request(signal) {
      shutdown ??= (async () => {
        const readiness = options.readiness ?? runtimeReadiness;
        readiness.beginDrain();
        options.beforeDrain?.();
        options.logger.info(
          { signal, drainTimeoutMillis: options.drainTimeoutMillis },
          "Graceful shutdown started",
        );

        let http: ShutdownOutcome["http"];
        try {
          http = await drainHttpServer(
            options.server,
            options.drainTimeoutMillis,
          );
        } catch (error) {
          options.logger.error({ err: error, signal }, "HTTP drain failed");
          options.server.closeAllConnections();
          http = "forced";
        }
        if (http === "forced") {
          options.logger.warn(
            { signal, drainTimeoutMillis: options.drainTimeoutMillis },
            "HTTP drain deadline reached; active connections were closed",
          );
        }

        const database = await closeDatabaseWithin(
          options.closeDatabase,
          options.databaseCloseTimeoutMillis,
        );
        if (database !== "closed") {
          options.logger.error(
            { signal, database },
            "Database pool did not close cleanly",
          );
        }
        const exitCode = database === "closed" ? 0 : 1;
        options.logger.info(
          { signal, http, database, exitCode },
          "Graceful shutdown finished",
        );
        return { signal, http, database, exitCode };
      })();
      return shutdown;
    },
  };
}

function boundedTimeout(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/u.test(raw)) throw new Error("Shutdown timeout must be numeric");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 120_000) {
    throw new Error("Shutdown timeout must be between 1000 and 120000 ms");
  }
  return value;
}

export function shutdownTimeouts(
  environment: NodeJS.ProcessEnv = process.env,
): { databaseCloseTimeoutMillis: number; drainTimeoutMillis: number } {
  return {
    databaseCloseTimeoutMillis: boundedTimeout(
      environment.VALO_DB_CLOSE_TIMEOUT_MS,
      5_000,
    ),
    drainTimeoutMillis: boundedTimeout(
      environment.VALO_HTTP_DRAIN_TIMEOUT_MS,
      15_000,
    ),
  };
}

export function installGracefulShutdown(
  shutdown: ReturnType<typeof createGracefulShutdown>,
  exit: (code: number) => never = process.exit,
): () => void {
  let exiting = false;
  const handler = (signal: NodeJS.Signals) => {
    if (exiting) return;
    exiting = true;
    void shutdown.request(signal).then(({ exitCode }) => exit(exitCode));
  };
  process.once("SIGTERM", handler);
  process.once("SIGINT", handler);
  return () => {
    process.off("SIGTERM", handler);
    process.off("SIGINT", handler);
  };
}
