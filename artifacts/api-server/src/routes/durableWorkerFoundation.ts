import { Router, type IRouter, type Request, type Response } from "express";
import {
  DurableWorkerError,
  type DurableWorkerService,
  type WorkerScope,
} from "../lib/durableWorkerFoundation";
import {
  TransactionalOutboxError,
  type TransactionalOutboxService,
} from "../lib/transactionalOutbox";

export type DurableWorkerRouteAction =
  | "worker:enqueue"
  | "worker:claim"
  | "worker:heartbeat"
  | "worker:succeed"
  | "worker:fail"
  | "worker:cancel"
  | "worker:recover"
  | "outbox:prepare"
  | "outbox:block"
  | "outbox:recover"
  | "outbox:reconcile";

export interface DurableWorkerRouteDependencies {
  worker: Pick<
    DurableWorkerService,
    | "enqueue"
    | "claimNext"
    | "heartbeat"
    | "succeed"
    | "fail"
    | "cancel"
    | "recover"
  >;
  outbox: Pick<
    TransactionalOutboxService,
    | "prepare"
    | "blockPrepared"
    | "claimReconciliation"
    | "resolveReconciliation"
    | "recoverExpired"
  >;
  /** Resolve scope from authenticated server state; request bodies are ignored. */
  resolveScope(
    request: Request,
  ): WorkerScope | null | Promise<WorkerScope | null>;
  authorize(
    request: Request,
    action: DurableWorkerRouteAction,
    scope: WorkerScope,
  ): boolean | Promise<boolean>;
  resolveActorUserId?(request: Request): string | null;
}

type JsonRecord = Record<string, unknown>;

function body(request: Request): JsonRecord {
  if (
    typeof request.body !== "object" ||
    request.body == null ||
    Array.isArray(request.body)
  ) {
    throw new DurableWorkerError("invalid_input");
  }
  const value = request.body as JsonRecord;
  if ("organisationId" in value || "projectId" in value) {
    throw new DurableWorkerError("invalid_scope");
  }
  return value;
}

function textField(value: unknown): string {
  if (typeof value !== "string") throw new DurableWorkerError("invalid_input");
  return value;
}

function numberField(value: unknown): number {
  if (typeof value !== "number") throw new DurableWorkerError("invalid_input");
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  return textField(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined;
  return numberField(value);
}

function optionalDate(value: unknown): Date | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw new DurableWorkerError("invalid_input");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new DurableWorkerError("invalid_input");
  return parsed;
}

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new DurableWorkerError("invalid_input");
  return value;
}

function outboxBody(
  value: unknown,
  createdBy: string | null,
): Parameters<DurableWorkerService["succeed"]>[0]["outbox"] {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DurableWorkerError("invalid_input");
  }
  const record = value as JsonRecord;
  if (
    "organisationId" in record ||
    "projectId" in record ||
    "createdBy" in record
  ) {
    throw new DurableWorkerError("invalid_scope");
  }
  const deadlineAt = optionalDate(record.deadlineAt);
  if (!deadlineAt) throw new DurableWorkerError("invalid_input");
  return {
    eventName: textField(record.eventName),
    aggregateType: textField(record.aggregateType),
    aggregateId: optionalText(record.aggregateId),
    idempotencyDigest: textField(record.idempotencyDigest),
    payloadHash: textField(record.payloadHash),
    payloadRef: optionalText(record.payloadRef),
    maxAttempts: optionalNumber(record.maxAttempts),
    availableAt: optionalDate(record.availableAt),
    deadlineAt,
    createdBy,
  };
}

async function authorizedScope(
  request: Request,
  dependencies: DurableWorkerRouteDependencies,
  action: DurableWorkerRouteAction,
): Promise<WorkerScope> {
  const scope = await dependencies.resolveScope(request);
  if (!scope || !(await dependencies.authorize(request, action, scope))) {
    throw new DurableWorkerError("not_found_or_not_authorized");
  }
  return scope;
}

function statusForError(
  error: DurableWorkerError | TransactionalOutboxError,
): number {
  switch (error.code) {
    case "invalid_scope":
    case "invalid_input":
      return 400;
    case "not_found_or_not_authorized":
      return 404;
    case "provider_disconnected":
      return 503;
    case "admission_exceeded":
      return 429;
    case "no_work_available":
      return 204;
    case "stale_fence":
      return 409;
    case "invalid_transition":
    case "lease_mismatch":
    case "lease_not_expired":
    case "deadline_exceeded":
    case "attempts_exhausted":
    case "not_due":
    case "not_outbox_record":
      return 409;
    case "persistence_conflict":
      return 503;
    default:
      return 500;
  }
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response): void => {
    void handler(request, response).catch((error: unknown) => {
      if (
        error instanceof DurableWorkerError ||
        error instanceof TransactionalOutboxError
      ) {
        const status = statusForError(error);
        if (status === 204) {
          response.status(status).end();
          return;
        }
        response.status(status).json({ error: error.code });
        return;
      }
      response.status(500).json({ error: "internal_error" });
    });
  };
}

/**
 * Unmounted route factory. The application must inject authenticated tenant
 * resolution and explicit authorization when it chooses a private mount path.
 * No handler accepts an organisation/project scope from request JSON.
 */
export function createDurableWorkerFoundationRouter(
  dependencies: DurableWorkerRouteDependencies,
): IRouter {
  const router = Router();

  router.post(
    "/jobs",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "worker:enqueue",
      );
      const value = body(request);
      const job = await dependencies.worker.enqueue({
        ...scope,
        capability: textField(value.capability),
        idempotencyDigest: textField(value.idempotencyDigest),
        documentVersionId: optionalText(value.documentVersionId),
        priority: optionalNumber(value.priority),
        availableAt: optionalDate(value.availableAt),
      });
      response.status(201).json({ job });
    }),
  );

  router.post(
    "/jobs/claim",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "worker:claim",
      );
      const value = body(request);
      const claim = await dependencies.worker.claimNext({
        ...scope,
        capability: textField(value.capability),
        workerId: textField(value.workerId),
        inputHash: textField(value.inputHash),
      });
      response.status(200).json({ claim });
    }),
  );

  router.post(
    "/jobs/:jobId/heartbeat",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "worker:heartbeat",
      );
      const value = body(request);
      const job = await dependencies.worker.heartbeat({
        ...scope,
        jobId: routeParam(request, "jobId"),
        runId: textField(value.runId),
        workerId: textField(value.workerId),
        fenceToken: numberField(value.fenceToken),
        progressPercent: numberField(value.progressPercent),
      });
      response.status(200).json({ job, fenceToken: job.version });
    }),
  );

  router.post(
    "/jobs/:jobId/succeed",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "worker:succeed",
      );
      const value = body(request);
      const result = await dependencies.worker.succeed({
        ...scope,
        jobId: routeParam(request, "jobId"),
        runId: textField(value.runId),
        workerId: textField(value.workerId),
        fenceToken: numberField(value.fenceToken),
        outputHash: textField(value.outputHash),
        outbox: outboxBody(
          value.outbox,
          dependencies.resolveActorUserId?.(request) ?? null,
        ),
      });
      response.status(200).json({ result });
    }),
  );

  router.post(
    "/jobs/:jobId/fail",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(request, dependencies, "worker:fail");
      const value = body(request);
      const result = await dependencies.worker.fail({
        ...scope,
        jobId: routeParam(request, "jobId"),
        runId: textField(value.runId),
        workerId: textField(value.workerId),
        fenceToken: numberField(value.fenceToken),
        errorCode: textField(value.errorCode),
      });
      response.status(200).json({ result });
    }),
  );

  router.post(
    "/jobs/:jobId/cancel",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "worker:cancel",
      );
      const value = body(request);
      const result = await dependencies.worker.cancel({
        ...scope,
        jobId: routeParam(request, "jobId"),
        fenceToken: numberField(value.fenceToken),
        reasonCode: textField(value.reasonCode),
        actorUserId: dependencies.resolveActorUserId?.(request) ?? null,
      });
      response.status(200).json({ result });
    }),
  );

  router.post(
    "/jobs/:jobId/recover",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "worker:recover",
      );
      const value = body(request);
      const result = await dependencies.worker.recover({
        ...scope,
        jobId: routeParam(request, "jobId"),
        fenceToken: numberField(value.fenceToken),
      });
      response.status(200).json({ result });
    }),
  );

  router.post(
    "/outbox/:eventId/prepare",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "outbox:prepare",
      );
      const value = body(request);
      const prepared = await dependencies.outbox.prepare({
        scope,
        eventId: routeParam(request, "eventId"),
        expectedFence: numberField(value.fenceToken),
        workerId: textField(value.workerId),
        leaseMs: numberField(value.leaseMs),
      });
      // 202 is intentional: the attempt exists, but provider invocation is false.
      response.status(202).json({ prepared });
    }),
  );

  router.post(
    "/outbox/:eventId/block",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "outbox:block",
      );
      const value = body(request);
      const disposition = textField(value.disposition);
      if (
        disposition !== "known_not_delivered" &&
        disposition !== "outcome_unknown"
      ) {
        throw new TransactionalOutboxError("invalid_input");
      }
      const event = await dependencies.outbox.blockPrepared({
        scope,
        eventId: routeParam(request, "eventId"),
        attemptId: textField(value.attemptId),
        expectedFence: numberField(value.fenceToken),
        workerId: textField(value.workerId),
        disposition,
      });
      response.status(200).json({ event, fenceToken: event.version });
    }),
  );

  router.post(
    "/outbox/:eventId/reconciliation/claim",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "outbox:reconcile",
      );
      const value = body(request);
      const event = await dependencies.outbox.claimReconciliation({
        scope,
        eventId: routeParam(request, "eventId"),
        expectedFence: numberField(value.fenceToken),
        workerId: textField(value.workerId),
      });
      response.status(200).json({ event, fenceToken: event.version });
    }),
  );

  router.post(
    "/outbox/:eventId/recover",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "outbox:recover",
      );
      const value = body(request);
      const event = await dependencies.outbox.recoverExpired({
        scope,
        eventId: routeParam(request, "eventId"),
        expectedFence: numberField(value.fenceToken),
      });
      response.status(200).json({ event, fenceToken: event.version });
    }),
  );

  router.post(
    "/outbox/:eventId/reconciliation/resolve",
    asyncRoute(async (request, response) => {
      const scope = await authorizedScope(
        request,
        dependencies,
        "outbox:reconcile",
      );
      const value = body(request);
      const outcome = textField(value.outcome);
      if (outcome !== "known_not_delivered" && outcome !== "still_unknown") {
        // There is intentionally no `delivered` option without trusted receipts.
        throw new TransactionalOutboxError("provider_disconnected");
      }
      const event = await dependencies.outbox.resolveReconciliation({
        scope,
        eventId: routeParam(request, "eventId"),
        expectedFence: numberField(value.fenceToken),
        workerId: textField(value.workerId),
        outcome,
      });
      response.status(200).json({ event, fenceToken: event.version });
    }),
  );

  return router;
}
