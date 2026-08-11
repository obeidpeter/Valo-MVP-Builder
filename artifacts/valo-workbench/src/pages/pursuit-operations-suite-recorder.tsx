import { useState, type FormEvent, type ReactNode } from "react";
import { ClipboardPenLine } from "lucide-react";
import { StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const WORK_STATUS_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  backlog: ["ready", "cancelled"],
  ready: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "in_review", "done", "cancelled"],
  blocked: ["ready", "in_progress", "cancelled"],
  in_review: ["in_progress", "blocked", "done", "cancelled"],
  done: [],
  cancelled: [],
};

export interface OperationsRecorderCommand {
  path: string;
  method: "POST" | "PATCH";
  body: Record<string, unknown>;
  successTitle: string;
}

export interface OperationsRecorderPermissions {
  projectUpdate: boolean;
  projectAssign: boolean;
  evidenceWrite: boolean;
  evidenceApprove: boolean;
  packageExport: boolean;
  packageGenerate: boolean;
}

export interface VersionedRecordOption {
  id: string;
  label: string;
  version: number;
  status: string;
}

export interface WorkRecordOption extends VersionedRecordOption {
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
}

export interface EvidenceRecordOption extends VersionedRecordOption {
  slots: Array<{
    id: string;
    label: string;
    hasResponse: boolean;
    acceptanceDecision: "accepted" | "rejected" | null;
    priorResponseCount: number;
    acceptedContentTypes: string[];
  }>;
}

export interface MissionRecordOption extends VersionedRecordOption {
  checklist: Array<{ id: string; label: string }>;
}

export interface PostAwardRecordOption extends VersionedRecordOption {
  evidenceDocumentIds: string[];
}

export interface PackageVersionOption {
  packageId: string;
  packageVersionId: string;
  versionNumber: number;
  manifestSha256: string;
  renderQaStatus: "pending" | "passed" | "failed";
  createdAt: string;
}

export interface CanonicalDocumentOption {
  id: string;
  filename: string;
  sha256: string;
  contentType: string;
  status: string;
}

export interface VaultItemOption {
  id: string;
  label: string;
  version: number;
  documentSha256: string;
  status: string;
}

export interface OperationsRecorderRecords {
  workItems: WorkRecordOption[];
  evidenceRequests: EvidenceRecordOption[];
  submissions: VersionedRecordOption[];
  missions: MissionRecordOption[];
  postAwardItems: PostAwardRecordOption[];
  packageVersions: PackageVersionOption[];
  documents: CanonicalDocumentOption[];
  vaultItems: VaultItemOption[];
}

export interface PursuitOperationsSuiteRecorderProps {
  permissions: OperationsRecorderPermissions;
  records: OperationsRecorderRecords;
  currentUserId?: string;
  online: boolean;
  pending?: boolean;
  packageVersionsState?: "loading" | "ready" | "error";
  packageVersionsTruncated?: boolean;
  documentsState?: "loading" | "ready" | "error" | "unavailable";
  vaultItemsState?: "loading" | "ready" | "error" | "unavailable";
  onCommand: (command: OperationsRecorderCommand) => void;
}

function value(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function selectedCurrentUser(
  data: FormData,
  name: string,
  currentUserId: string | undefined,
  label: string,
): string | undefined {
  const selectedUserId = value(data, name);
  if (!selectedUserId) return undefined;
  if (!currentUserId || selectedUserId !== currentUserId) {
    throw new Error(`${label} is not the current authenticated user.`);
  }
  return selectedUserId;
}

function requiredText(
  data: FormData,
  name: string,
  label: string,
  maximum = 4_096,
): string {
  const parsed = value(data, name);
  if (!parsed || parsed.length > maximum) {
    throw new Error(
      `${label} is required and must be within ${maximum} characters.`,
    );
  }
  return parsed;
}

function optionalText(
  data: FormData,
  name: string,
  label: string,
  maximum = 4_096,
): string | undefined {
  const parsed = value(data, name);
  if (!parsed) return undefined;
  if (parsed.length > maximum) {
    throw new Error(`${label} must be within ${maximum} characters.`);
  }
  return parsed;
}

function requiredId(data: FormData, name: string, label: string): string {
  const parsed = requiredText(data, name, label, 128);
  if (!ID_PATTERN.test(parsed))
    throw new Error(`${label} is not a valid record ID.`);
  return parsed;
}

function optionalId(
  data: FormData,
  name: string,
  label: string,
): string | undefined {
  const parsed = optionalText(data, name, label, 128);
  if (parsed && !ID_PATTERN.test(parsed)) {
    throw new Error(`${label} is not a valid record ID.`);
  }
  return parsed;
}

function requiredSha(data: FormData, name: string, label: string): string {
  const parsed = requiredText(data, name, label, 64).toLowerCase();
  if (!SHA256_PATTERN.test(parsed)) {
    throw new Error(`${label} must be a complete lowercase SHA-256.`);
  }
  return parsed;
}

function optionalSha(
  data: FormData,
  name: string,
  label: string,
): string | undefined {
  const parsed = optionalText(data, name, label, 64)?.toLowerCase();
  if (parsed && !SHA256_PATTERN.test(parsed)) {
    throw new Error(`${label} must be a complete lowercase SHA-256.`);
  }
  return parsed;
}

function requiredIso(data: FormData, name: string, label: string): string {
  const parsed = requiredText(data, name, label, 64);
  if (Number.isNaN(Date.parse(parsed)))
    throw new Error(`${label} must be an ISO date-time.`);
  return parsed;
}

function optionalIso(
  data: FormData,
  name: string,
  label: string,
): string | undefined {
  const parsed = optionalText(data, name, label, 64);
  if (parsed && Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${label} must be an ISO date-time.`);
  }
  return parsed;
}

function list(
  data: FormData,
  name: string,
  label: string,
  maximum: number,
): string[] {
  const items = value(data, name)
    .split(/[\n,]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length > maximum || new Set(items).size !== items.length) {
    throw new Error(`${label} must contain at most ${maximum} unique values.`);
  }
  return items;
}

function idList(
  data: FormData,
  name: string,
  label: string,
  maximum: number,
): string[] {
  const items = list(data, name, label, maximum);
  if (items.some((item) => !ID_PATTERN.test(item))) {
    throw new Error(`${label} contains an invalid record ID.`);
  }
  return items;
}

function integer(
  data: FormData,
  name: string,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const raw = requiredText(data, name, label, 32);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${label} must be a whole number from ${minimum} to ${maximum}.`,
    );
  }
  return parsed;
}

function optionalInteger(
  data: FormData,
  name: string,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!value(data, name)) return undefined;
  return integer(data, name, label, minimum, maximum);
}

function jsonArray(
  data: FormData,
  name: string,
  label: string,
  maximum: number,
  required = false,
): unknown[] | undefined {
  const raw = value(data, name);
  if (!raw && !required) return undefined;
  if (!raw) throw new Error(`${label} is required.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length > maximum) {
    throw new Error(
      `${label} must be a JSON array with at most ${maximum} entries.`,
    );
  }
  return parsed;
}

function selected<T extends VersionedRecordOption>(
  records: readonly T[],
  data: FormData,
  name: string,
  label: string,
): T {
  const id = requiredId(data, name, label);
  const record = records.find((candidate) => candidate.id === id);
  if (!record)
    throw new Error(`${label} is no longer in the current snapshot.`);
  return record;
}

function shortId(id: string): string {
  return id.length <= 20 ? id : `${id.slice(0, 10)}…${id.slice(-7)}`;
}

function evidenceSlotToken(requestId: string, slotId: string): string {
  return `${requestId}/${slotId}`;
}

function selectedEvidenceSlot(
  records: readonly EvidenceRecordOption[],
  data: FormData,
  name: string,
  mode: "response" | "decision",
): {
  record: EvidenceRecordOption;
  slot: EvidenceRecordOption["slots"][number];
} {
  const token = requiredText(data, name, "Evidence request slot", 257);
  for (const record of records) {
    for (const slot of record.slots) {
      if (
        evidenceSlotToken(record.id, slot.id) === token &&
        (mode === "response"
          ? !slot.hasResponse || slot.acceptanceDecision === "rejected"
          : slot.hasResponse && slot.acceptanceDecision === null)
      ) {
        return { record, slot };
      }
    }
  }
  throw new Error(
    mode === "decision"
      ? "The selected slot has no undecided current response."
      : "The selected slot cannot currently accept a response or replacement.",
  );
}

function selectedPackageVersion(
  records: readonly PackageVersionOption[],
  data: FormData,
  name: string,
): PackageVersionOption {
  const packageVersionId = requiredId(data, name, "Canonical package version");
  const record = records.find(
    (candidate) => candidate.packageVersionId === packageVersionId,
  );
  if (!record) {
    throw new Error(
      "The selected package version is no longer in the current canonical list.",
    );
  }
  return record;
}

function selectedDocument(
  records: readonly CanonicalDocumentOption[],
  data: FormData,
  name: string,
  required: boolean,
): CanonicalDocumentOption | undefined {
  const documentId = value(data, name);
  if (!documentId && !required) return undefined;
  if (!ID_PATTERN.test(documentId)) {
    throw new Error("The selected canonical document ID is invalid.");
  }
  const record = records.find((candidate) => candidate.id === documentId);
  if (!record) {
    throw new Error(
      "The selected document is no longer in the current project document list.",
    );
  }
  return record;
}

function selectedVaultItem(
  records: readonly VaultItemOption[],
  data: FormData,
  name: string,
): VaultItemOption {
  const vaultItemId = requiredId(data, name, "Active Vault item");
  const record = records.find((candidate) => candidate.id === vaultItemId);
  if (!record) {
    throw new Error(
      "The selected Vault item is no longer in the active client Vault list.",
    );
  }
  return record;
}

function withOptional<T extends Record<string, unknown>>(
  body: T,
  values: Record<string, unknown>,
): T & Record<string, unknown> {
  return {
    ...body,
    ...Object.fromEntries(
      Object.entries(values).filter(([, entry]) => entry !== undefined),
    ),
  };
}

function Field({
  label,
  name,
  children,
  hint,
}: {
  label: string;
  name: string;
  children?: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium" htmlFor={name}>
      {label}
      {children ?? (
        <input
          id={name}
          name={name}
          className={CONTROL}
          data-control-size="44"
        />
      )}
      {hint ? (
        <span className="font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

function TextArea({
  id,
  name = id,
  required = false,
  maxLength = 4_096,
  placeholder,
}: {
  id: string;
  name?: string;
  required?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <textarea
      id={id}
      name={name}
      required={required}
      maxLength={maxLength}
      placeholder={placeholder}
      className={`${CONTROL} min-h-24`}
      data-control-size="44"
    />
  );
}

function RecordSelect({
  id,
  name = id,
  records,
  required = true,
  selectedValue,
  onValueChange,
}: {
  id: string;
  name?: string;
  records: readonly VersionedRecordOption[];
  required?: boolean;
  selectedValue?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <select
      id={id}
      name={name}
      required={required}
      value={selectedValue}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">
        {required ? "Choose a current record" : "No linked record"}
      </option>
      {records.map((record) => (
        <option key={record.id} value={record.id}>
          {record.label} · {shortId(record.id)} · {record.status} · v
          {record.version}
        </option>
      ))}
    </select>
  );
}

function EvidenceSlotSelect({
  id,
  records,
  mode,
}: {
  id: string;
  records: readonly EvidenceRecordOption[];
  mode: "response" | "decision";
}) {
  const slots = records.flatMap((record) =>
    record.slots
      .filter((slot) =>
        mode === "response"
          ? !slot.hasResponse || slot.acceptanceDecision === "rejected"
          : slot.hasResponse && slot.acceptanceDecision === null,
      )
      .map((slot) => ({ record, slot })),
  );
  return (
    <select
      id={id}
      name={id}
      required
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">Choose a current request slot</option>
      {slots.map(({ record, slot }) => (
        <option
          key={evidenceSlotToken(record.id, slot.id)}
          value={evidenceSlotToken(record.id, slot.id)}
        >
          {record.label} · {slot.label} · {shortId(slot.id)} ·{" "}
          {slot.acceptanceDecision === "rejected"
            ? "changes requested; replacement allowed"
            : slot.hasResponse
              ? "response awaiting decision"
              : "awaiting response"}
          {slot.priorResponseCount > 0
            ? ` · ${slot.priorResponseCount} prior rejected attempt${slot.priorResponseCount === 1 ? "" : "s"}`
            : ""}
        </option>
      ))}
    </select>
  );
}

function CurrentUserAssignmentSelect({
  id,
  currentUserId,
  emptyLabel,
}: {
  id: string;
  currentUserId?: string;
  emptyLabel: string;
}) {
  return (
    <select
      id={id}
      name={id}
      className={CONTROL}
      data-control-size="44"
      defaultValue=""
    >
      <option value="">{emptyLabel}</option>
      {currentUserId ? (
        <option value={currentUserId}>Assign to me</option>
      ) : null}
    </select>
  );
}

function PackageVersionSelect({
  id,
  records,
}: {
  id: string;
  records: readonly PackageVersionOption[];
}) {
  return (
    <select
      id={id}
      name={id}
      required
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">Choose a canonical project-export version</option>
      {records.map((record) => (
        <option key={record.packageVersionId} value={record.packageVersionId}>
          {shortId(record.packageId)} · v{record.versionNumber} · QA{" "}
          {record.renderQaStatus} · manifest{" "}
          {record.manifestSha256.slice(0, 12)}…
        </option>
      ))}
    </select>
  );
}

function DocumentSelect({
  id,
  records,
  required = false,
}: {
  id: string;
  records: readonly CanonicalDocumentOption[];
  required?: boolean;
}) {
  return (
    <select
      id={id}
      name={id}
      required={required}
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">
        {required
          ? "Choose a canonical project document"
          : "No document selected"}
      </option>
      {records.map((record) => (
        <option key={record.id} value={record.id}>
          {record.filename} · {record.id} · {record.contentType} ·{" "}
          {record.status}
          {" · SHA-256 "}
          {record.sha256}
        </option>
      ))}
    </select>
  );
}

function VaultItemSelect({
  id,
  records,
}: {
  id: string;
  records: readonly VaultItemOption[];
}) {
  return (
    <select
      id={id}
      name={id}
      required
      className={CONTROL}
      data-control-size="44"
    >
      <option value="">Choose an active client Vault item</option>
      {records.map((record) => (
        <option key={record.id} value={record.id}>
          {record.label} · {record.id} · v{record.version} · {record.status}
          {" · source SHA-256 "}
          {record.documentSha256}
        </option>
      ))}
    </select>
  );
}

function Panel({
  title,
  description,
  allowed,
  unavailableReason,
  disabled,
  children,
}: {
  title: string;
  description: string;
  allowed: boolean;
  unavailableReason: string;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}
      </summary>
      <div className="space-y-4 border-t border-border p-4">
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        {!allowed ? (
          <StatusPanel
            state="unavailable"
            title="Mutation permission required"
            description={unavailableReason}
          />
        ) : null}
        <fieldset
          disabled={disabled || !allowed}
          className="space-y-6 disabled:opacity-65"
        >
          {children}
        </fieldset>
      </div>
    </details>
  );
}

function Submit({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      className="min-h-11"
      data-control-size="44"
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function PermissionBoundary({
  allowed,
  label,
  children,
}: {
  allowed: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={!allowed} className="space-y-6 disabled:opacity-65">
      <legend className="sr-only">{label}</legend>
      {!allowed ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {label} controls are disabled for this organisation context.
        </p>
      ) : null}
      {children}
    </fieldset>
  );
}

export default function PursuitOperationsSuiteRecorder({
  permissions,
  records,
  currentUserId,
  online,
  pending = false,
  packageVersionsState = "ready",
  packageVersionsTruncated = false,
  documentsState = "ready",
  vaultItemsState = "ready",
  onCommand,
}: PursuitOperationsSuiteRecorderProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [updateMissionId, setUpdateMissionId] = useState("");
  const updateMission = records.missions.find(
    (mission) => mission.id === updateMissionId,
  );
  const disabled = pending || !online;
  const send =
    (factory: (data: FormData) => OperationsRecorderCommand) =>
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        const command = factory(new FormData(event.currentTarget));
        setFormError(null);
        onCommand(command);
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : "The command is invalid.",
        );
      }
    };

  return (
    <section
      aria-labelledby="operations-recorder-heading"
      className="mx-auto w-full max-w-7xl space-y-4 px-4 pb-4 sm:px-8 sm:pb-8"
    >
      <div className="space-y-2">
        <h2
          id="operations-recorder-heading"
          className="flex items-center gap-2 font-serif text-xl font-semibold"
        >
          <ClipboardPenLine aria-hidden="true" className="size-5" />
          Record bounded operations
        </h2>
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
          These forms record named human inputs in Valo. They never fetch an
          opportunity, send a client request, attend an event, verify a
          credential, dispatch a package, submit a bid or issue a contractual
          notice.
        </p>
      </div>
      {!online ? (
        <StatusPanel
          state="offline"
          title="Reconnect before recording operations"
          description="No form data is stored for offline submission. Reconnect, refresh the current versions and enter the command again."
        />
      ) : null}
      {formError ? (
        <StatusPanel
          state="error"
          title="Command needs attention"
          description={formError}
        />
      ) : null}
      {(permissions.packageExport || permissions.packageGenerate) &&
      packageVersionsState !== "ready" ? (
        <StatusPanel
          state={packageVersionsState === "loading" ? "pending" : "error"}
          title={
            packageVersionsState === "loading"
              ? "Loading canonical package versions"
              : "Canonical package versions could not be loaded"
          }
          description="War-room and visual-QA recording stays disabled until the bounded project-export list supplies exact package IDs and manifest hashes."
        />
      ) : null}
      {(permissions.packageExport || permissions.packageGenerate) &&
      packageVersionsState === "ready" &&
      records.packageVersions.length === 0 ? (
        <StatusPanel
          state="empty"
          title="No canonical project-export package is available"
          description="Create a canonical project export before recording custody or visual QA. Raw package IDs and manifest hashes are not accepted here."
        />
      ) : null}
      {packageVersionsTruncated ? (
        <StatusPanel
          state="partial"
          title="Canonical package list is bounded"
          description="Only the first 100 canonical project-export versions are shown. Refresh or narrow the project lifecycle before selecting an older version."
        />
      ) : null}
      {(permissions.projectUpdate || permissions.evidenceWrite) &&
      documentsState !== "ready" ? (
        <StatusPanel
          state={documentsState === "loading" ? "pending" : "error"}
          title={
            documentsState === "loading"
              ? "Loading canonical project documents"
              : documentsState === "unavailable"
                ? "Project document reference access unavailable"
                : "Canonical project documents could not be loaded"
          }
          description="Document-backed evidence responses, mission proofs and post-award evidence stay unavailable until the current project document list supplies exact IDs and source digests. Other record-only updates remain available."
        />
      ) : null}
      {permissions.evidenceApprove && vaultItemsState !== "ready" ? (
        <StatusPanel
          state={vaultItemsState === "loading" ? "pending" : "error"}
          title={
            vaultItemsState === "loading"
              ? "Loading active client Vault items"
              : vaultItemsState === "unavailable"
                ? "Client Vault reference access unavailable"
                : "Active client Vault items could not be loaded"
          }
          description="Credential recording stays unavailable until an active Vault item can supply its exact current version and matching source digest."
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="1. Opportunity intake"
          description="Record an authorised source and its provenance. For non-URL content, enter the content hash; licensed/OCDS sources also require the recorded authorisation basis."
          allowed={permissions.projectUpdate}
          unavailableReason="Project update permission is required."
          disabled={disabled}
        >
          <form
            className="grid gap-3"
            onSubmit={send((data) => {
              const sourceType = requiredText(
                data,
                "opportunitySourceType",
                "Source type",
                32,
              );
              const authorisationBasis = optionalText(
                data,
                "opportunityAuthorisation",
                "Authorisation basis",
                1_024,
              );
              const contentSha256 = optionalSha(
                data,
                "opportunityContentHash",
                "Source content hash",
              );
              if (sourceType !== "manual_url" && !contentSha256) {
                throw new Error(
                  "Non-URL sources require a source content SHA-256.",
                );
              }
              if (
                ["licensed_csv", "ocds"].includes(sourceType) &&
                !authorisationBasis
              ) {
                throw new Error(
                  "Licensed CSV and OCDS sources require an authorisation basis.",
                );
              }
              return {
                path: "/operations-suite/opportunities",
                method: "POST",
                successTitle: "Opportunity source recorded",
                body: withOptional(
                  {
                    title: requiredText(
                      data,
                      "opportunityTitle",
                      "Opportunity title",
                    ),
                    issuer: requiredText(data, "opportunityIssuer", "Issuer"),
                    source: withOptional(
                      {
                        type: sourceType,
                        locator: requiredText(
                          data,
                          "opportunityLocator",
                          "Source locator",
                          2_048,
                        ),
                        receivedAt: requiredIso(
                          data,
                          "opportunityReceivedAt",
                          "Source received time",
                        ),
                      },
                      { authorisationBasis, contentSha256 },
                    ),
                  },
                  {
                    reference: optionalText(
                      data,
                      "opportunityReference",
                      "Reference",
                      256,
                    ),
                    lot: optionalText(data, "opportunityLot", "Lot", 256),
                    deadline: optionalIso(
                      data,
                      "opportunityDeadline",
                      "Deadline",
                    ),
                  },
                ),
              };
            })}
          >
            <Field label="Opportunity title" name="opportunityTitle" />
            <Field label="Issuer" name="opportunityIssuer" />
            <Field label="Reference (optional)" name="opportunityReference" />
            <Field label="Lot (optional)" name="opportunityLot" />
            <Field
              label="Recorded deadline, ISO (optional)"
              name="opportunityDeadline"
            />
            <Field label="Source type" name="opportunitySourceType">
              <select
                id="opportunitySourceType"
                name="opportunitySourceType"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="manual_url">Manual URL</option>
                <option value="forwarded_email">Forwarded email</option>
                <option value="licensed_csv">Licensed CSV</option>
                <option value="ocds">OCDS</option>
              </select>
            </Field>
            <Field label="Source locator" name="opportunityLocator" />
            <Field
              label="Source received time, ISO"
              name="opportunityReceivedAt"
            />
            <Field
              label="Authorisation basis (when required)"
              name="opportunityAuthorisation"
            />
            <Field
              label="Source content SHA-256 (when required)"
              name="opportunityContentHash"
            />
            <Submit disabled={!permissions.projectUpdate}>
              Record opportunity source
            </Submit>
          </form>
        </Panel>

        <Panel
          title="2. Pursuit work"
          description="Create tenant-scoped work, then record comments or a reasoned approval decision against the current server version."
          allowed={permissions.projectUpdate || permissions.projectAssign}
          unavailableReason="Project update or assignment permission is required."
          disabled={disabled}
        >
          <PermissionBoundary
            allowed={permissions.projectUpdate}
            label="Project update"
          >
            <form
              className="grid gap-3"
              onSubmit={send((data) => ({
                path: "/operations-suite/work-items",
                method: "POST",
                successTitle: "Work item recorded",
                body: withOptional(
                  {
                    title: requiredText(data, "workTitle", "Work title"),
                    priority: requiredText(
                      data,
                      "workPriority",
                      "Priority",
                      16,
                    ),
                    links: {
                      requirementIds: idList(
                        data,
                        "workRequirements",
                        "Requirement IDs",
                        100,
                      ),
                      evidenceItemIds: idList(
                        data,
                        "workEvidence",
                        "Evidence IDs",
                        100,
                      ),
                      packageIds: idList(
                        data,
                        "workPackages",
                        "Package IDs",
                        100,
                      ),
                    },
                    dependsOnIds: idList(
                      data,
                      "workDependencies",
                      "Dependency IDs",
                      50,
                    ),
                    approvalRequired: data.get("workApprovalRequired") === "on",
                  },
                  {
                    description: optionalText(
                      data,
                      "workDescription",
                      "Description",
                    ),
                    ownerUserId: selectedCurrentUser(
                      data,
                      "workOwner",
                      currentUserId,
                      "Work owner",
                    ),
                    dueAt: optionalIso(data, "workDueAt", "Due time"),
                  },
                ),
              }))}
            >
              <h3 className="text-sm font-semibold">Create work item</h3>
              <Field label="Work title" name="workTitle" />
              <Field label="Description (optional)" name="workDescription" />
              <Field label="Work owner" name="workOwner">
                <CurrentUserAssignmentSelect
                  id="workOwner"
                  currentUserId={currentUserId}
                  emptyLabel="Leave unassigned"
                />
              </Field>
              <Field label="Due time, ISO (optional)" name="workDueAt" />
              <Field label="Priority" name="workPriority">
                <select
                  id="workPriority"
                  name="workPriority"
                  className={CONTROL}
                  data-control-size="44"
                >
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </Field>
              <Field
                label="Requirement IDs (comma/newline)"
                name="workRequirements"
              />
              <Field label="Evidence IDs (comma/newline)" name="workEvidence" />
              <Field label="Package IDs (comma/newline)" name="workPackages" />
              <Field
                label="Dependency work IDs (comma/newline)"
                name="workDependencies"
              />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="workApprovalRequired" /> Approval
                required
              </label>
              <Submit disabled={!permissions.projectUpdate}>
                Record work item
              </Submit>
            </form>
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={send((data) => {
                const record = selected(
                  records.workItems,
                  data,
                  "commentWorkId",
                  "Work item",
                );
                return {
                  path: `/operations-suite/work-items/${encodeURIComponent(record.id)}/comments`,
                  method: "POST",
                  successTitle: "Work comment recorded",
                  body: {
                    expectedVersion: record.version,
                    body: requiredText(data, "workComment", "Comment"),
                  },
                };
              })}
            >
              <h3 className="text-sm font-semibold">Record work comment</h3>
              <Field label="Current work item" name="commentWorkId">
                <RecordSelect id="commentWorkId" records={records.workItems} />
              </Field>
              <Field label="Comment" name="workComment">
                <TextArea id="workComment" required />
              </Field>
              <Submit disabled={!permissions.projectUpdate}>
                Record comment
              </Submit>
            </form>
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={send((data) => {
                const record = selected(
                  records.workItems,
                  data,
                  "statusWorkId",
                  "Work item",
                );
                const status = requiredText(
                  data,
                  "recordedWorkStatus",
                  "Work status",
                  32,
                );
                if (!WORK_STATUS_TRANSITIONS[record.status]?.includes(status)) {
                  throw new Error(
                    "That work transition is not available from the current status.",
                  );
                }
                const reason = optionalText(
                  data,
                  "workStatusReason",
                  "Work status reason",
                  1_024,
                );
                if (status === "cancelled" && !reason) {
                  throw new Error("Work cancellation requires a reason.");
                }
                return {
                  path: `/operations-suite/work-items/${encodeURIComponent(record.id)}`,
                  method: "PATCH",
                  successTitle: "Work status recorded",
                  body: withOptional(
                    { expectedVersion: record.version, status },
                    { reason },
                  ),
                };
              })}
            >
              <h3 className="text-sm font-semibold">
                Record work status with reason
              </h3>
              <Field label="Current work item" name="statusWorkId">
                <RecordSelect id="statusWorkId" records={records.workItems} />
              </Field>
              <Field label="Next status" name="recordedWorkStatus">
                <select
                  id="recordedWorkStatus"
                  name="recordedWorkStatus"
                  className={CONTROL}
                  data-control-size="44"
                >
                  <option value="ready">Ready</option>
                  <option value="in_progress">In progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="in_review">In review</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
              <Field
                label="Status reason (required for cancellation)"
                name="workStatusReason"
              >
                <TextArea id="workStatusReason" maxLength={1_024} />
              </Field>
              <Submit disabled={!permissions.projectUpdate}>
                Record work status
              </Submit>
            </form>
          </PermissionBoundary>
          <PermissionBoundary
            allowed={permissions.projectAssign}
            label="Project assignment"
          >
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={send((data) => {
                const record = selected(
                  records.workItems,
                  data,
                  "approvalWorkId",
                  "Work item",
                );
                return {
                  path: `/operations-suite/work-items/${encodeURIComponent(record.id)}/approval`,
                  method: "POST",
                  successTitle: "Work approval decision recorded",
                  body: {
                    expectedVersion: record.version,
                    decision: requiredText(
                      data,
                      "workDecision",
                      "Decision",
                      16,
                    ),
                    reason: requiredText(
                      data,
                      "workDecisionReason",
                      "Decision reason",
                      1_024,
                    ),
                  },
                };
              })}
            >
              <h3 className="text-sm font-semibold">
                Record approval decision
              </h3>
              <Field label="Current work item" name="approvalWorkId">
                <RecordSelect id="approvalWorkId" records={records.workItems} />
              </Field>
              <Field label="Decision" name="workDecision">
                <select
                  id="workDecision"
                  name="workDecision"
                  className={CONTROL}
                  data-control-size="44"
                >
                  <option value="approved">Approve</option>
                  <option value="rejected">Reject</option>
                </select>
              </Field>
              <Field label="Decision reason" name="workDecisionReason">
                <TextArea id="workDecisionReason" required maxLength={1_024} />
              </Field>
              <Submit disabled={!permissions.projectAssign}>
                Record approval decision
              </Submit>
            </form>
          </PermissionBoundary>
        </Panel>

        <Panel
          title="3. Client evidence request"
          description="Valo records the request and later records the named person's manual sharing, uploaded document hash/attestation and reasoned review decision. It sends nothing."
          allowed={permissions.evidenceWrite || permissions.evidenceApprove}
          unavailableReason="Evidence write or approval permission is required."
          disabled={disabled}
        >
          <PermissionBoundary
            allowed={permissions.evidenceWrite}
            label="Evidence write"
          >
            <form
              className="grid gap-3"
              onSubmit={send((data) => ({
                path: "/operations-suite/evidence-requests",
                method: "POST",
                successTitle: "Evidence request draft recorded",
                body: withOptional(
                  {
                    recipientLabel: requiredText(
                      data,
                      "evidenceRecipient",
                      "Recipient label",
                      256,
                    ),
                    requestMessage: requiredText(
                      data,
                      "evidenceMessage",
                      "Request message",
                    ),
                    slots: [
                      {
                        label: requiredText(
                          data,
                          "evidenceSlotLabel",
                          "Slot label",
                          256,
                        ),
                        required: data.get("evidenceSlotRequired") === "on",
                        acceptedContentTypes: list(
                          data,
                          "evidenceContentTypes",
                          "Accepted content types",
                          50,
                        ),
                      },
                    ],
                  },
                  { dueAt: optionalIso(data, "evidenceDueAt", "Due time") },
                ),
              }))}
            >
              <h3 className="text-sm font-semibold">Create request draft</h3>
              <Field label="Recipient label" name="evidenceRecipient" />
              <Field label="Due time, ISO (optional)" name="evidenceDueAt" />
              <Field label="Request message" name="evidenceMessage">
                <TextArea id="evidenceMessage" required />
              </Field>
              <Field label="Upload slot label" name="evidenceSlotLabel" />
              <Field
                label="Accepted content types (comma/newline)"
                name="evidenceContentTypes"
              />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="evidenceSlotRequired" /> Required
                slot
              </label>
              <Submit disabled={!permissions.evidenceWrite}>
                Record request draft
              </Submit>
            </form>
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={send((data) => {
                const record = selected(
                  records.evidenceRequests,
                  data,
                  "sharedEvidenceId",
                  "Evidence request",
                );
                return {
                  path: `/operations-suite/evidence-requests/${encodeURIComponent(record.id)}/mark-shared`,
                  method: "POST",
                  successTitle: "Manual sharing recorded",
                  body: { expectedVersion: record.version },
                };
              })}
            >
              <h3 className="text-sm font-semibold">Record manual sharing</h3>
              <Field label="Current request" name="sharedEvidenceId">
                <RecordSelect
                  id="sharedEvidenceId"
                  records={records.evidenceRequests}
                />
              </Field>
              <Submit disabled={!permissions.evidenceWrite}>
                Mark manually shared
              </Submit>
            </form>
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={send((data) => {
                const { record, slot } = selectedEvidenceSlot(
                  records.evidenceRequests,
                  data,
                  "responseEvidenceSlot",
                  "response",
                );
                const document = selectedDocument(
                  records.documents,
                  data,
                  "responseDocumentId",
                  true,
                );
                if (!document) {
                  throw new Error("A canonical response document is required.");
                }
                const acceptedContentTypes = slot.acceptedContentTypes.map(
                  (contentType) => contentType.trim().toLowerCase(),
                );
                if (
                  acceptedContentTypes.length > 0 &&
                  !acceptedContentTypes.includes(
                    document.contentType.trim().toLowerCase(),
                  )
                ) {
                  throw new Error(
                    "The selected document content type is not accepted by this request slot.",
                  );
                }
                return {
                  path: `/operations-suite/evidence-requests/${encodeURIComponent(record.id)}/responses`,
                  method: "POST",
                  successTitle: "Evidence response recorded",
                  body: {
                    expectedVersion: record.version,
                    slotId: slot.id,
                    documentId: document.id,
                    sha256: document.sha256,
                    attestation: requiredText(
                      data,
                      "responseAttestation",
                      "Attestation",
                    ),
                  },
                };
              })}
            >
              <h3 className="text-sm font-semibold">
                Record uploaded response
              </h3>
              <Field label="Current request slot" name="responseEvidenceSlot">
                <EvidenceSlotSelect
                  id="responseEvidenceSlot"
                  records={records.evidenceRequests}
                  mode="response"
                />
              </Field>
              <Field
                label="Canonical uploaded document"
                name="responseDocumentId"
              >
                <DocumentSelect
                  id="responseDocumentId"
                  records={records.documents}
                  required
                />
              </Field>
              <Field
                label="Named operator attestation"
                name="responseAttestation"
              >
                <TextArea id="responseAttestation" required />
              </Field>
              <Submit
                disabled={
                  !permissions.evidenceWrite ||
                  documentsState !== "ready" ||
                  records.documents.length === 0
                }
              >
                Record uploaded response
              </Submit>
            </form>
          </PermissionBoundary>
          <PermissionBoundary
            allowed={permissions.evidenceApprove}
            label="Evidence approval"
          >
            <form
              className="grid gap-3 border-t border-border pt-4"
              onSubmit={send((data) => {
                const { record, slot } = selectedEvidenceSlot(
                  records.evidenceRequests,
                  data,
                  "decisionEvidenceSlot",
                  "decision",
                );
                const decision = requiredText(
                  data,
                  "evidenceDecision",
                  "Decision",
                  16,
                );
                return {
                  path: `/operations-suite/evidence-requests/${encodeURIComponent(record.id)}/decisions`,
                  method: "POST",
                  successTitle:
                    decision === "accepted"
                      ? "Evidence acceptance recorded"
                      : "Evidence changes requested",
                  body: {
                    expectedVersion: record.version,
                    slotId: slot.id,
                    decision,
                    reason: requiredText(
                      data,
                      "evidenceDecisionReason",
                      "Decision reason",
                      1_024,
                    ),
                  },
                };
              })}
            >
              <h3 className="text-sm font-semibold">
                Record response decision
              </h3>
              <Field label="Responded request slot" name="decisionEvidenceSlot">
                <EvidenceSlotSelect
                  id="decisionEvidenceSlot"
                  records={records.evidenceRequests}
                  mode="decision"
                />
              </Field>
              <Field label="Decision" name="evidenceDecision">
                <select
                  id="evidenceDecision"
                  name="evidenceDecision"
                  className={CONTROL}
                  data-control-size="44"
                >
                  <option value="accepted">Accept</option>
                  <option value="rejected">Request changes</option>
                </select>
              </Field>
              <Field label="Decision reason" name="evidenceDecisionReason">
                <TextArea
                  id="evidenceDecisionReason"
                  required
                  maxLength={1_024}
                />
              </Field>
              <Submit disabled={!permissions.evidenceApprove}>
                Record response decision
              </Submit>
            </form>
          </PermissionBoundary>
        </Panel>

        <Panel
          title="4. Submission war room"
          description="Create custody against an existing package version, then record each human-completed stage in order. Dispatch method, receipt hash and cancellation reason must come from the operator."
          allowed={permissions.packageExport}
          unavailableReason="Package export permission is required."
          disabled={disabled || packageVersionsState !== "ready"}
        >
          <form
            className="grid gap-3"
            onSubmit={send((data) => {
              const packageVersion = selectedPackageVersion(
                records.packageVersions,
                data,
                "submissionPackageVersion",
              );
              return {
                path: "/operations-suite/submission-war-rooms",
                method: "POST",
                successTitle: "Submission custody room recorded",
                body: {
                  packageId: packageVersion.packageId,
                  packageVersionId: packageVersion.packageVersionId,
                  manifestSha256: packageVersion.manifestSha256,
                  copyCount: integer(
                    data,
                    "submissionCopyCount",
                    "Copy count",
                    0,
                    10_000,
                  ),
                  sealIdentifiers: list(
                    data,
                    "submissionSeals",
                    "Seal identifiers",
                    100,
                  ),
                },
              };
            })}
          >
            <h3 className="text-sm font-semibold">Create custody room</h3>
            <Field
              label="Canonical package version"
              name="submissionPackageVersion"
            >
              <PackageVersionSelect
                id="submissionPackageVersion"
                records={records.packageVersions}
              />
            </Field>
            <Field label="Physical copy count" name="submissionCopyCount">
              <input
                id="submissionCopyCount"
                name="submissionCopyCount"
                type="number"
                min="0"
                max="10000"
                defaultValue="0"
                className={CONTROL}
                data-control-size="44"
              />
            </Field>
            <Field
              label="Seal identifiers (comma/newline)"
              name="submissionSeals"
            />
            <Submit disabled={!permissions.packageExport}>
              Create submission custody room
            </Submit>
          </form>
          <form
            className="grid gap-3 border-t border-border pt-4"
            onSubmit={send((data) => {
              const record = selected(
                records.submissions,
                data,
                "advanceSubmissionId",
                "Submission room",
              );
              const toStatus = requiredText(
                data,
                "submissionNextStatus",
                "Next status",
                32,
              );
              const expectedNext: Record<string, string | undefined> = {
                planning: "frozen",
                frozen: "copies_prepared",
                copies_prepared: "sealed",
                sealed: "dispatched",
                dispatched: "receipt_recorded",
              };
              if (
                toStatus !== "cancelled" &&
                expectedNext[record.status] !== toStatus
              ) {
                throw new Error(
                  "War-room stages must be recorded exactly once in order.",
                );
              }
              const dispatchMethod = optionalText(
                data,
                "submissionDispatchMethod",
                "Dispatch method",
                256,
              );
              const receiptSha256 = optionalSha(
                data,
                "submissionReceiptHash",
                "Receipt hash",
              );
              const reason = optionalText(
                data,
                "submissionReason",
                "Reason",
                1_024,
              );
              if (toStatus === "dispatched" && !dispatchMethod) {
                throw new Error(
                  "Recording human dispatch requires the dispatch method.",
                );
              }
              if (toStatus === "receipt_recorded" && !receiptSha256) {
                throw new Error("Receipt recording requires its SHA-256.");
              }
              if (toStatus === "cancelled" && !reason) {
                throw new Error("Cancellation requires a reason.");
              }
              return {
                path: `/operations-suite/submission-war-rooms/${encodeURIComponent(record.id)}/advance`,
                method: "POST",
                successTitle: "Submission custody stage recorded",
                body: withOptional(
                  { expectedVersion: record.version, toStatus },
                  { dispatchMethod, receiptSha256, reason },
                ),
              };
            })}
          >
            <h3 className="text-sm font-semibold">Advance recorded custody</h3>
            <Field label="Current custody room" name="advanceSubmissionId">
              <RecordSelect
                id="advanceSubmissionId"
                records={records.submissions}
              />
            </Field>
            <Field
              label="Human-completed next stage"
              name="submissionNextStatus"
            >
              <select
                id="submissionNextStatus"
                name="submissionNextStatus"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="frozen">Freeze recorded hash</option>
                <option value="copies_prepared">Copies prepared</option>
                <option value="sealed">Sealed</option>
                <option value="dispatched">Human dispatch completed</option>
                <option value="receipt_recorded">Receipt obtained</option>
                <option value="cancelled">Cancel with reason</option>
              </select>
            </Field>
            <Field
              label="Dispatch method (dispatch only)"
              name="submissionDispatchMethod"
            />
            <Field
              label="Receipt SHA-256 (receipt only)"
              name="submissionReceiptHash"
            />
            <Field label="Reason (cancellation only)" name="submissionReason" />
            <Submit disabled={!permissions.packageExport}>
              Record custody stage
            </Submit>
          </form>
        </Panel>

        <Panel
          title="5. Visual package QA"
          description="Record operator-supplied render metrics. Valo evaluates only the entered metrics; it does not invent pages, signatures or cross-reference results."
          allowed={permissions.packageGenerate}
          unavailableReason="Package generation permission is required."
          disabled={disabled || packageVersionsState !== "ready"}
        >
          <form
            className="grid gap-3"
            onSubmit={send((data) => {
              const packageVersion = selectedPackageVersion(
                records.packageVersions,
                data,
                "qaPackageVersion",
              );
              return {
                path: "/operations-suite/visual-qa-reports",
                method: "POST",
                successTitle: "Visual QA metrics evaluated and recorded",
                body: withOptional(
                  {
                    packageVersionId: packageVersion.packageVersionId,
                    manifestSha256: packageVersion.manifestSha256,
                    expectedManifestSha256: packageVersion.manifestSha256,
                    pages:
                      jsonArray(data, "qaPages", "Page metrics", 2_000, true) ??
                      [],
                  },
                  {
                    crossReferences: jsonArray(
                      data,
                      "qaCrossReferences",
                      "Cross-reference checks",
                      5_000,
                    ),
                    signatures: jsonArray(
                      data,
                      "qaSignatures",
                      "Signature checks",
                      250,
                    ),
                  },
                ),
              };
            })}
          >
            <Field label="Canonical package version" name="qaPackageVersion">
              <PackageVersionSelect
                id="qaPackageVersion"
                records={records.packageVersions}
              />
            </Field>
            <Field
              label="Page metrics JSON"
              name="qaPages"
              hint='Array entries: {"pageNumber":1,"textCharacterCount":10,"nonWhitespacePixelRatio":0.2,"clippedElementCount":0}'
            >
              <TextArea
                id="qaPages"
                required
                maxLength={200_000}
                placeholder="[]"
              />
            </Field>
            <Field
              label="Cross-reference checks JSON (optional)"
              name="qaCrossReferences"
              hint='Array entries: {"label":"Section 2","resolved":true}'
            >
              <TextArea id="qaCrossReferences" maxLength={200_000} />
            </Field>
            <Field
              label="Signature checks JSON (optional)"
              name="qaSignatures"
              hint='Array entries: {"label":"Form of tender","required":true,"present":true}'
            >
              <TextArea id="qaSignatures" maxLength={100_000} />
            </Field>
            <Submit disabled={!permissions.packageGenerate}>
              Evaluate and record visual QA
            </Submit>
          </form>
        </Panel>

        <Panel
          title="6. Credential verification"
          description="After a named person checks the official issuer source, select the exact current Vault item version and source digest, then record the source locator, outcome and retained receipt hash. The server requires a matching source document currently not marked security-quarantined; this snapshot does not itself prove a malware-scanner receipt."
          allowed={permissions.evidenceApprove}
          unavailableReason="Evidence approval permission is required."
          disabled={disabled}
        >
          <form
            className="grid gap-3"
            onSubmit={send((data) => {
              const vaultItem = selectedVaultItem(
                records.vaultItems,
                data,
                "credentialVaultId",
              );
              return {
                path: "/operations-suite/credential-verifications",
                method: "POST",
                successTitle: "Human credential check recorded",
                body: withOptional(
                  {
                    vaultItemId: vaultItem.id,
                    vaultItemVersion: vaultItem.version,
                    documentSha256: vaultItem.documentSha256,
                    authorityName: requiredText(
                      data,
                      "credentialAuthority",
                      "Authority name",
                      256,
                    ),
                    officialSourceLocator: requiredText(
                      data,
                      "credentialSource",
                      "Official source locator",
                      2_048,
                    ),
                    checkedAt: requiredIso(
                      data,
                      "credentialCheckedAt",
                      "Checked time",
                    ),
                    outcome: requiredText(
                      data,
                      "credentialOutcome",
                      "Outcome",
                      32,
                    ),
                    receiptSha256: requiredSha(
                      data,
                      "credentialReceiptHash",
                      "Verification receipt hash",
                    ),
                  },
                  { notes: optionalText(data, "credentialNotes", "Notes") },
                ),
              };
            })}
          >
            <Field
              label="Active Vault item and exact source snapshot"
              name="credentialVaultId"
              hint="The selector supplies the Vault item ID, current version and full source SHA-256; the server revalidates all three."
            >
              <VaultItemSelect
                id="credentialVaultId"
                records={records.vaultItems}
              />
            </Field>
            <Field label="Official authority name" name="credentialAuthority" />
            <Field label="Official source locator" name="credentialSource" />
            <Field label="Human checked time, ISO" name="credentialCheckedAt" />
            <Field label="Recorded outcome" name="credentialOutcome">
              <select
                id="credentialOutcome"
                name="credentialOutcome"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="verified">Verified</option>
                <option value="not_verified">Not verified</option>
                <option value="inconclusive">Inconclusive</option>
              </select>
            </Field>
            <Field
              label="Verification receipt SHA-256"
              name="credentialReceiptHash"
            />
            <Field label="Notes (optional)" name="credentialNotes">
              <TextArea id="credentialNotes" />
            </Field>
            <Submit
              disabled={
                !permissions.evidenceApprove ||
                vaultItemsState !== "ready" ||
                records.vaultItems.length === 0
              }
            >
              Record human credential check
            </Submit>
          </form>
        </Panel>

        <Panel
          title="7. Pre-bid and site-visit mission"
          description="Record the plan and named delegate authority. Later updates use the current mission checklist, canonical project proof documents, discoverable follow-up work and operator-entered status reasons."
          allowed={permissions.projectUpdate}
          unavailableReason="Project update permission is required."
          disabled={disabled}
        >
          <form
            className="grid gap-3"
            onSubmit={send((data) => {
              const delegateUserId = selectedCurrentUser(
                data,
                "missionDelegate",
                currentUserId,
                "Mission delegate",
              );
              const delegateAuthorityNote = optionalText(
                data,
                "missionAuthority",
                "Delegate authority note",
                1_024,
              );
              if (delegateUserId && !delegateAuthorityNote) {
                throw new Error(
                  "A delegate requires a recorded authority note.",
                );
              }
              return {
                path: "/operations-suite/missions",
                method: "POST",
                successTitle: "Mission plan recorded",
                body: withOptional(
                  {
                    missionType: requiredText(
                      data,
                      "missionType",
                      "Mission type",
                      32,
                    ),
                    title: requiredText(data, "missionTitle", "Mission title"),
                    location: requiredText(
                      data,
                      "missionLocation",
                      "Location",
                      1_024,
                    ),
                    startsAt: requiredIso(
                      data,
                      "missionStartsAt",
                      "Start time",
                    ),
                    attendanceRequired:
                      data.get("missionAttendanceRequired") === "on",
                    checklist:
                      jsonArray(
                        data,
                        "missionChecklist",
                        "Mission checklist",
                        100,
                        true,
                      ) ?? [],
                  },
                  { delegateUserId, delegateAuthorityNote },
                ),
              };
            })}
          >
            <h3 className="text-sm font-semibold">Create mission plan</h3>
            <Field label="Mission type" name="missionType">
              <select
                id="missionType"
                name="missionType"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="pre_bid">Pre-bid meeting</option>
                <option value="site_visit">Site visit</option>
              </select>
            </Field>
            <Field label="Mission title" name="missionTitle" />
            <Field label="Location" name="missionLocation" />
            <Field label="Start time, ISO" name="missionStartsAt" />
            <Field label="Mission delegate" name="missionDelegate">
              <CurrentUserAssignmentSelect
                id="missionDelegate"
                currentUserId={currentUserId}
                emptyLabel="No delegate"
              />
            </Field>
            <Field
              label="Delegate authority note (required with delegate)"
              name="missionAuthority"
            >
              <TextArea id="missionAuthority" maxLength={1_024} />
            </Field>
            <Field
              label="Checklist JSON"
              name="missionChecklist"
              hint='Array entries: {"label":"Carry authority letter","required":true}'
            >
              <TextArea id="missionChecklist" required maxLength={100_000} />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="missionAttendanceRequired" />{" "}
              Attendance required
            </label>
            <Submit disabled={!permissions.projectUpdate}>
              Record mission plan
            </Submit>
          </form>
          <form
            className="grid gap-3 border-t border-border pt-4"
            onSubmit={send((data) => {
              const record = selected(
                records.missions,
                data,
                "updateMissionId",
                "Mission",
              );
              const status = optionalText(
                data,
                "missionUpdateStatus",
                "Status",
                32,
              );
              const completedChecklistItemId = optionalId(
                data,
                "missionChecklistItemId",
                "Checklist item ID",
              );
              const proofDocument = selectedDocument(
                records.documents,
                data,
                "missionProofDocumentId",
                false,
              );
              const proofDocumentId = proofDocument?.id;
              const proofSha256 = proofDocument?.sha256;
              const followUpWorkItemId = optionalId(
                data,
                "missionFollowUpWorkId",
                "Follow-up work ID",
              );
              const reason = optionalText(
                data,
                "missionUpdateReason",
                "Reason",
                1_024,
              );
              if (["missed", "cancelled"].includes(status ?? "") && !reason) {
                throw new Error(
                  "Missed or cancelled missions require a reason.",
                );
              }
              if (
                completedChecklistItemId &&
                !record.checklist.some(
                  ({ id }) => id === completedChecklistItemId,
                )
              ) {
                throw new Error(
                  "The checklist item is not in the selected mission.",
                );
              }
              const patch = withOptional(
                { expectedVersion: record.version },
                {
                  status,
                  completedChecklistItemId,
                  proofDocumentId,
                  proofSha256,
                  followUpWorkItemId,
                  reason,
                },
              );
              if (Object.keys(patch).length === 1) {
                throw new Error("Enter at least one mission update field.");
              }
              return {
                path: `/operations-suite/missions/${encodeURIComponent(record.id)}`,
                method: "PATCH",
                successTitle: "Mission update recorded",
                body: patch,
              };
            })}
          >
            <h3 className="text-sm font-semibold">Record mission update</h3>
            <Field label="Current mission" name="updateMissionId">
              <RecordSelect
                id="updateMissionId"
                records={records.missions}
                selectedValue={updateMissionId}
                onValueChange={setUpdateMissionId}
              />
            </Field>
            <Field label="Status (optional)" name="missionUpdateStatus">
              <select
                id="missionUpdateStatus"
                name="missionUpdateStatus"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="">No status change</option>
                <option value="planned">Planned</option>
                <option value="attended">Attended</option>
                <option value="missed">Missed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field
              label="Completed checklist item (optional)"
              name="missionChecklistItemId"
            >
              <select
                id="missionChecklistItemId"
                name="missionChecklistItemId"
                className={CONTROL}
                data-control-size="44"
                disabled={!updateMission}
              >
                <option value="">No checklist completion</option>
                {updateMission?.checklist.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {shortId(item.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Canonical mission proof document (optional)"
              name="missionProofDocumentId"
              hint="The selected project document supplies both the exact document ID and current SHA-256."
            >
              <DocumentSelect
                id="missionProofDocumentId"
                records={records.documents}
              />
            </Field>
            <Field
              label="Follow-up work item (optional)"
              name="missionFollowUpWorkId"
            >
              <RecordSelect
                id="missionFollowUpWorkId"
                records={records.workItems}
                required={false}
              />
            </Field>
            <Field
              label="Reason (required for missed/cancelled)"
              name="missionUpdateReason"
            >
              <TextArea id="missionUpdateReason" maxLength={1_024} />
            </Field>
            <Submit disabled={!permissions.projectUpdate}>
              Record mission update
            </Submit>
          </form>
        </Panel>

        <Panel
          title="8. Post-award delivery control"
          description="Record obligations and internal progress. Canonical project documents supply source, evidence and completion-receipt identities; disputed or cancelled reasons still come from the named operator."
          allowed={permissions.projectUpdate}
          unavailableReason="Project update permission is required."
          disabled={disabled}
        >
          <form
            className="grid gap-3"
            onSubmit={send((data) => {
              const valueMinorUnits = optionalInteger(
                data,
                "postValueMinor",
                "Recorded value",
                0,
                Number.MAX_SAFE_INTEGER,
              );
              const currency = optionalText(
                data,
                "postCurrency",
                "Currency",
                3,
              )?.toUpperCase();
              if (
                Boolean(valueMinorUnits !== undefined) !== Boolean(currency)
              ) {
                throw new Error(
                  "Recorded value and currency must be supplied together.",
                );
              }
              if (currency && !/^[A-Z]{3}$/u.test(currency)) {
                throw new Error("Currency must be a three-letter code.");
              }
              const sourceDocument = selectedDocument(
                records.documents,
                data,
                "postSourceDocument",
                false,
              );
              const evidenceDocument = selectedDocument(
                records.documents,
                data,
                "postEvidenceDocument",
                false,
              );
              return {
                path: "/operations-suite/post-award-items",
                method: "POST",
                successTitle: "Post-award item recorded",
                body: withOptional(
                  {
                    category: requiredText(
                      data,
                      "postCategory",
                      "Category",
                      32,
                    ),
                    title: requiredText(data, "postTitle", "Post-award title"),
                    evidenceDocumentIds: evidenceDocument
                      ? [evidenceDocument.id]
                      : [],
                  },
                  {
                    description: optionalText(
                      data,
                      "postDescription",
                      "Description",
                    ),
                    dueAt: optionalIso(data, "postDueAt", "Due time"),
                    ownerUserId: selectedCurrentUser(
                      data,
                      "postOwner",
                      currentUserId,
                      "Post-award owner",
                    ),
                    sourceDocumentId: sourceDocument?.id,
                    valueMinorUnits,
                    currency,
                  },
                ),
              };
            })}
          >
            <h3 className="text-sm font-semibold">Create post-award item</h3>
            <Field label="Category" name="postCategory">
              <select
                id="postCategory"
                name="postCategory"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="obligation">Obligation</option>
                <option value="deliverable">Deliverable</option>
                <option value="variation">Variation</option>
                <option value="payment_milestone">Payment milestone</option>
                <option value="notice">Notice</option>
                <option value="completion_record">Completion record</option>
              </select>
            </Field>
            <Field label="Title" name="postTitle" />
            <Field label="Description (optional)" name="postDescription">
              <TextArea id="postDescription" />
            </Field>
            <Field label="Due time, ISO (optional)" name="postDueAt" />
            <Field label="Post-award owner" name="postOwner">
              <CurrentUserAssignmentSelect
                id="postOwner"
                currentUserId={currentUserId}
                emptyLabel="Leave unassigned"
              />
            </Field>
            <Field
              label="Canonical source document (optional)"
              name="postSourceDocument"
            >
              <DocumentSelect
                id="postSourceDocument"
                records={records.documents}
              />
            </Field>
            <Field
              label="Initial canonical evidence document (optional)"
              name="postEvidenceDocument"
            >
              <DocumentSelect
                id="postEvidenceDocument"
                records={records.documents}
              />
            </Field>
            <Field
              label="Value in minor units (optional pair)"
              name="postValueMinor"
            />
            <Field label="Currency code (optional pair)" name="postCurrency" />
            <Submit disabled={!permissions.projectUpdate}>
              Record post-award item
            </Submit>
          </form>
          <form
            className="grid gap-3 border-t border-border pt-4"
            onSubmit={send((data) => {
              const record = selected(
                records.postAwardItems,
                data,
                "updatePostId",
                "Post-award item",
              );
              const status = optionalText(
                data,
                "postUpdateStatus",
                "Status",
                32,
              );
              const ownerUserId = selectedCurrentUser(
                data,
                "postUpdateOwner",
                currentUserId,
                "Updated post-award owner",
              );
              const dueAt = optionalIso(data, "postUpdateDueAt", "Due time");
              const completionDocument = selectedDocument(
                records.documents,
                data,
                "postCompletionDocument",
                false,
              );
              const evidenceDocumentIds = completionDocument
                ? [
                    ...new Set([
                      ...record.evidenceDocumentIds,
                      completionDocument.id,
                    ]),
                  ]
                : undefined;
              const completionReceiptSha256 = completionDocument?.sha256;
              const reason = optionalText(
                data,
                "postUpdateReason",
                "Reason",
                1_024,
              );
              const resultingEvidence =
                evidenceDocumentIds ?? record.evidenceDocumentIds;
              if (
                status === "satisfied" &&
                (!completionReceiptSha256 || resultingEvidence.length === 0)
              ) {
                throw new Error(
                  "Satisfied status requires at least one evidence document and a completion receipt SHA-256.",
                );
              }
              if (["disputed", "cancelled"].includes(status ?? "") && !reason) {
                throw new Error(
                  "Disputed or cancelled items require a reason.",
                );
              }
              const body = withOptional(
                { expectedVersion: record.version },
                {
                  status,
                  ownerUserId,
                  dueAt,
                  evidenceDocumentIds,
                  completionReceiptSha256,
                  reason,
                },
              );
              if (Object.keys(body).length === 1) {
                throw new Error("Enter at least one post-award update field.");
              }
              return {
                path: `/operations-suite/post-award-items/${encodeURIComponent(record.id)}`,
                method: "PATCH",
                successTitle: "Post-award update recorded",
                body,
              };
            })}
          >
            <h3 className="text-sm font-semibold">Record post-award update</h3>
            <Field label="Current post-award item" name="updatePostId">
              <RecordSelect
                id="updatePostId"
                records={records.postAwardItems}
              />
            </Field>
            <Field label="Status (optional)" name="postUpdateStatus">
              <select
                id="postUpdateStatus"
                name="postUpdateStatus"
                className={CONTROL}
                data-control-size="44"
              >
                <option value="">No status change</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="satisfied">
                  Satisfied with evidence and receipt
                </option>
                <option value="disputed">Disputed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </Field>
            <Field label="Updated post-award owner" name="postUpdateOwner">
              <CurrentUserAssignmentSelect
                id="postUpdateOwner"
                currentUserId={currentUserId}
                emptyLabel="No owner change"
              />
            </Field>
            <Field label="Due time, ISO (optional)" name="postUpdateDueAt" />
            <Field
              label="Canonical completion evidence / receipt document (optional)"
              name="postCompletionDocument"
              hint="Selecting a project document adds its ID to the evidence list and records its exact current SHA-256 as the completion receipt."
            >
              <DocumentSelect
                id="postCompletionDocument"
                records={records.documents}
              />
            </Field>
            <Field
              label="Reason (required for disputed/cancelled)"
              name="postUpdateReason"
            >
              <TextArea id="postUpdateReason" maxLength={1_024} />
            </Field>
            <Submit disabled={!permissions.projectUpdate}>
              Record post-award update
            </Submit>
          </form>
        </Panel>
      </div>
    </section>
  );
}
