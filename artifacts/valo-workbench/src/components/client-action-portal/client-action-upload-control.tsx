import { useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES,
  GOVERNED_CLIENT_UPLOAD_MIME_TYPES,
  type ClientActionUploadBinding,
  type ClientActionUploadFinalizationReceipt,
} from "./client-action-upload-contract";
import {
  ClientActionUploadFlowError,
  type ClientActionUploadProgress,
  type RunClientActionUploadInput,
} from "./client-action-upload-flow";
import {
  clearClientActionUploadRecovery,
  clientActionUploadRecoveryScope,
  pendingClientActionUploadRecovery,
  readClientActionUploadRecovery,
  writeClientActionUploadRecovery,
  type ClientActionUploadRecoveryMarker,
} from "./client-action-upload-recovery";

export interface ClientActionUploadControlProps {
  binding: ClientActionUploadBinding;
  membershipId: string;
  actorUserId: string;
  disabled?: boolean;
  onUpload(
    input: RunClientActionUploadInput,
    onProgress: (progress: ClientActionUploadProgress) => void,
  ): Promise<ClientActionUploadFinalizationReceipt>;
  onReload(): Promise<unknown> | unknown;
}

function recoveryStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function persistRecovery(
  marker: Parameters<typeof writeClientActionUploadRecovery>[1],
  leaseMayExist = false,
): void {
  const storage = recoveryStorage();
  if (!storage) {
    throw new ClientActionUploadFlowError(
      leaseMayExist
        ? "This browser cannot retain the issued lease recovery binding. No file bytes were transferred; reload the authoritative request state."
        : "This browser cannot safely retain an upload recovery key. No governed lease was requested.",
      leaseMayExist ? "leasing" : "checking",
      "none",
      leaseMayExist,
    );
  }
  try {
    writeClientActionUploadRecovery(storage, marker);
  } catch (cause) {
    throw new ClientActionUploadFlowError(
      leaseMayExist
        ? "The issued lease recovery binding could not be stored safely. No file bytes were transferred; reload the authoritative request state."
        : "The upload recovery key could not be stored safely. No governed lease was requested.",
      leaseMayExist ? "leasing" : "checking",
      "none",
      leaseMayExist,
      cause,
    );
  }
}

function clearRecovery(
  scope: Parameters<typeof clearClientActionUploadRecovery>[1],
): void {
  const storage = recoveryStorage();
  if (!storage) return;
  try {
    clearClientActionUploadRecovery(storage, scope);
  } catch {
    // The authoritative server receipt or reload remains valid even if this
    // tab cannot remove a stale recovery hint. Exact snapshot binding prevents
    // the marker from being offered for a changed or completed intent.
  }
}

type ViewState =
  | { state: "idle" | "selected"; message: string }
  | {
      state: "checking" | "leasing" | "transferring" | "finalizing";
      message: string;
      expiresAt: string | null;
    }
  | {
      state: "error";
      error: ClientActionUploadFlowError;
      expiresAt: string | null;
    }
  | {
      state: "completed";
      receipt: ClientActionUploadFinalizationReceipt;
    };

function operationKey(): string {
  return `client-upload:${globalThis.crypto.randomUUID()}`;
}

function asFlowError(error: unknown): ClientActionUploadFlowError {
  if (error instanceof ClientActionUploadFlowError) return error;
  return new ClientActionUploadFlowError(
    "The upload result is unknown. Reload the exact request before taking another action.",
    "finalizing",
    "reload_scope",
    true,
    error,
  );
}

function phaseMessage(progress: ClientActionUploadProgress): string {
  switch (progress.phase) {
    case "checking":
      return "Verifying the exact local bytes against the acknowledged intent.";
    case "leasing":
      return "Requesting a short-lived, purpose-bound upload lease. No file bytes are sent to the Valo API.";
    case "lease_ready":
      return `Upload lease ${progress.replayed ? "replayed" : "issued"}; it expires ${new Date(progress.expiresAt).toLocaleString("en-NG")}.`;
    case "transferring":
      return "Sending the exact file bytes directly to the signed storage URL.";
    case "finalizing":
      return "Finalizing secure intake and the exact request-slot attachment.";
    case "completed":
      return "The exact file passed secure intake and was attached to this request slot.";
  }
}

export function ClientActionUploadControl({
  binding,
  membershipId,
  actorUserId,
  disabled = false,
  onUpload,
  onReload,
}: ClientActionUploadControlProps) {
  const inputId = useId();
  const recoveryScope = useMemo(
    () =>
      clientActionUploadRecoveryScope({
        binding,
        membershipId,
        actorUserId,
      }),
    [actorUserId, binding, membershipId],
  );
  const initialRecovery = useMemo(() => {
    const storage = recoveryStorage();
    if (!storage) return null;
    try {
      return readClientActionUploadRecovery(storage, recoveryScope);
    } catch {
      return null;
    }
  }, [recoveryScope]);
  const [inputGeneration, setInputGeneration] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ViewState>({
    state: "idle",
    message: initialRecovery
      ? initialRecovery.leaseId
        ? "A pending governed lease was recovered for this exact tenant, membership, actor, request slot, intent, and record version. Reselect the exact file to replay transfer and finalization with the same operation key."
        : "A pending lease request was recovered for this exact scope. Reselect the exact file to replay it with the same operation key."
      : "Select the exact file recorded by the current upload intent.",
  });
  const retryKey = useRef<string | null>(
    initialRecovery?.idempotencyKey ?? null,
  );
  const recoveryMarker = useRef<ClientActionUploadRecoveryMarker | null>(
    initialRecovery,
  );
  const leaseId = useRef<string | null>(initialRecovery?.leaseId ?? null);
  const leaseExpiry = useRef<string | null>(initialRecovery?.expiresAt ?? null);

  const acceptedTypes = (
    binding.acceptedContentTypes.length > 0
      ? binding.acceptedContentTypes
      : GOVERNED_CLIENT_UPLOAD_MIME_TYPES
  ).filter((contentType) =>
    GOVERNED_CLIENT_UPLOAD_MIME_TYPES.includes(
      contentType as (typeof GOVERNED_CLIENT_UPLOAD_MIME_TYPES)[number],
    ),
  );
  const intentWithinPolicy =
    binding.sizeBytes >= 1 &&
    binding.sizeBytes <= CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES &&
    acceptedTypes.includes(binding.contentType) &&
    /^[0-9a-f]{64}$/u.test(binding.declaredSha256) &&
    /^[^/\\\u0000-\u001f\u007f\ud800-\udfff]{1,255}$/u.test(binding.filename);

  const startUpload = async () => {
    if (!file || busy || disabled) return;
    const key = retryKey.current ?? operationKey();
    retryKey.current = key;
    setBusy(true);
    try {
      const receipt = await onUpload(
        { binding, file, idempotencyKey: key },
        (progress) => {
          if (progress.phase === "leasing" && !recoveryMarker.current) {
            const pending = pendingClientActionUploadRecovery(
              recoveryScope,
              key,
            );
            persistRecovery(pending);
            recoveryMarker.current = pending;
          }
          if (progress.phase === "lease_ready") {
            if (
              recoveryMarker.current?.leaseId &&
              recoveryMarker.current.leaseId !== progress.leaseId
            ) {
              throw new ClientActionUploadFlowError(
                "The replayed lease identity changed. No file bytes were transferred; reload the authoritative request state.",
                "leasing",
                "none",
                true,
              );
            }
            leaseId.current = progress.leaseId;
            leaseExpiry.current = progress.expiresAt;
            const enriched: ClientActionUploadRecoveryMarker = {
              schema: "valo.client-action-upload-recovery/v1",
              scope: recoveryScope,
              idempotencyKey: key,
              leaseId: progress.leaseId,
              expiresAt: progress.expiresAt,
              lateRewriteClosure: progress.lateRewriteClosure,
            };
            persistRecovery(enriched, true);
            recoveryMarker.current = enriched;
          }
          if (progress.phase === "completed") {
            setView({ state: "completed", receipt: progress.receipt });
            return;
          }
          if (progress.phase === "lease_ready") {
            setView({
              state: "transferring",
              message: phaseMessage(progress),
              expiresAt: progress.expiresAt,
            });
            return;
          }
          setView({
            state: progress.phase,
            message: phaseMessage(progress),
            expiresAt: leaseExpiry.current,
          });
        },
      );
      clearRecovery(recoveryScope);
      recoveryMarker.current = null;
      retryKey.current = null;
      leaseId.current = null;
      leaseExpiry.current = null;
      setView({ state: "completed", receipt });
    } catch (error) {
      setView({
        state: "error",
        error: asFlowError(error),
        expiresAt: leaseExpiry.current,
      });
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onReload();
      clearRecovery(recoveryScope);
      recoveryMarker.current = null;
      retryKey.current = null;
      leaseId.current = null;
      leaseExpiry.current = null;
      setView({
        state: file ? "selected" : "idle",
        message:
          "The request was reloaded. Review this exact intent before requesting a new lease.",
      });
    } catch {
      setView({
        state: "error",
        error: new ClientActionUploadFlowError(
          "The current request could not be reloaded. Do not request another lease.",
          "checking",
          "none",
          false,
        ),
        expiresAt: leaseExpiry.current,
      });
    } finally {
      setBusy(false);
    }
  };

  const discardLocalSelection = () => {
    const leaseMayExist =
      leaseId.current !== null ||
      recoveryMarker.current !== null ||
      (view.state === "error" && view.error.serverLeaseMayExist);
    setFile(null);
    if (!leaseMayExist) {
      clearRecovery(recoveryScope);
      recoveryMarker.current = null;
      retryKey.current = null;
      leaseId.current = null;
      leaseExpiry.current = null;
    }
    setInputGeneration((value) => value + 1);
    setView({
      state: "idle",
      message: leaseMayExist
        ? "Local selection discarded. This does not cancel a server lease or claim deletion; expiry and durable reconciliation remain authoritative for staged bytes."
        : "Local selection discarded before a server lease was confirmed.",
    });
  };

  const statusMessage = !intentWithinPolicy
    ? "This recorded intent is outside governed size, filename, digest, or MIME policy. Record a new valid intent before selecting file bytes."
    : view.state === "error"
      ? view.error.message
      : view.state === "completed"
        ? "The exact file passed secure intake and was attached to this request slot."
        : view.message;
  const visibleLeaseExpiry =
    ("expiresAt" in view ? view.expiresAt : null) ??
    recoveryMarker.current?.expiresAt ??
    null;

  return (
    <section
      className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-4"
      aria-labelledby={`${inputId}-heading`}
      aria-busy={busy}
    >
      <div>
        <h5 id={`${inputId}-heading`} className="font-medium">
          Upload the acknowledged file
        </h5>
        <p className="mt-1 text-xs text-muted-foreground">
          Maximum {CLIENT_ACTION_UPLOAD_MAXIMUM_BYTES / 1024 / 1024} MB.
          Accepted MIME for this slot: {acceptedTypes.join(", ")}. Bytes go
          directly to the short-lived signed storage URL; the Valo API receives
          metadata and finalization only.
        </p>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          Exact intent: {binding.filename} /{" "}
          {binding.sizeBytes.toLocaleString("en-NG")} bytes /{" "}
          {binding.contentType} / SHA-256 {binding.declaredSha256}
        </p>
      </div>

      {view.state !== "completed" ? (
        <div className="space-y-2">
          <Label htmlFor={inputId}>Exact file for {binding.filename}</Label>
          <Input
            key={inputGeneration}
            id={inputId}
            type="file"
            accept={acceptedTypes.join(",")}
            disabled={busy || disabled || !intentWithinPolicy}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0] ?? null;
              setFile(selected);
              if (!recoveryMarker.current) {
                retryKey.current = null;
                leaseId.current = null;
                leaseExpiry.current = null;
              }
              setView({
                state: selected ? "selected" : "idle",
                message: selected
                  ? recoveryMarker.current?.leaseId
                    ? `${selected.name} selected for same-operation replay of the recovered governed lease.`
                    : recoveryMarker.current
                      ? `${selected.name} selected for replay of the pending governed lease request.`
                      : `${selected.name} selected. Verification has not requested a server lease yet.`
                  : "Select the exact file recorded by the current upload intent.",
              });
            }}
          />
        </div>
      ) : null}

      <div
        className={
          view.state === "error" || !intentWithinPolicy
            ? "text-sm text-destructive"
            : "text-sm"
        }
        role={
          view.state === "error" || !intentWithinPolicy ? "alert" : "status"
        }
        aria-live={
          view.state === "error" || !intentWithinPolicy ? "assertive" : "polite"
        }
        aria-atomic="true"
      >
        <p>{statusMessage}</p>
        {visibleLeaseExpiry ? (
          <p className="mt-1 text-xs">
            Lease expiry recorded as{" "}
            {new Date(visibleLeaseExpiry).toLocaleString("en-NG")}; the signed
            write window closes earlier by its bounded safety cushion.
          </p>
        ) : null}
        {view.state === "error" &&
        (view.error.serverLeaseMayExist || recoveryMarker.current) ? (
          <p className="mt-1 text-xs">
            Staged bytes or a lease may exist. The server-side lease and durable
            reconciler, not this browser, determine cleanup.
          </p>
        ) : null}
        {view.state === "completed" ? (
          <p className="mt-1 break-all font-mono text-xs">
            Receipt SHA-256 {view.receipt.receiptSha256}
          </p>
        ) : null}
      </div>

      {view.state !== "completed" ? (
        <div className="flex flex-wrap gap-2">
          {view.state === "error" && view.error.retry === "same_operation" ? (
            <Button
              type="button"
              disabled={!file || busy || disabled || !intentWithinPolicy}
              onClick={() => void startUpload()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Retry same operation
            </Button>
          ) : view.state === "error" &&
            ["new_lease", "reload_scope"].includes(view.error.retry) ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || disabled}
              onClick={() => void reload()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reload exact request
            </Button>
          ) : view.state === "error" && view.error.retry === "none" ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || disabled}
              onClick={() => void reload()}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reload authoritative state
            </Button>
          ) : (
            <Button
              type="button"
              disabled={!file || busy || disabled || !intentWithinPolicy}
              onClick={() => void startUpload()}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              Verify, upload and finalize
            </Button>
          )}
          {file ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={discardLocalSelection}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Discard local selection
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Governed document attached
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        A lease lasts at most 15 minutes. Closing this page, discarding a local
        selection, or seeing an error is not proof that staged server bytes were
        deleted. The signed write window closes with a bounded cushion before
        lease expiry; post-expiry reconciliation is the bounded cleanup control
        for potential late rewrites and remains subject to authoritative worker
        evidence.
      </p>
    </section>
  );
}
