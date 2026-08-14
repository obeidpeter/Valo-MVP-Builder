import { useState, type FormEvent } from "react";
import { ClipboardPenLine } from "lucide-react";
import { StatusPanel } from "@/components/platform-states";
import { ClientEvidenceRequestPanel } from "./operations-recorder-panels/client-evidence-request-panel";
import { CredentialVerificationPanel } from "./operations-recorder-panels/credential-verification-panel";
import { MissionPanel } from "./operations-recorder-panels/mission-panel";
import { OpportunityIntakePanel } from "./operations-recorder-panels/opportunity-intake-panel";
import { PostAwardPanel } from "./operations-recorder-panels/post-award-panel";
import { PursuitWorkPanel } from "./operations-recorder-panels/pursuit-work-panel";
import { SubmissionWarRoomPanel } from "./operations-recorder-panels/submission-war-room-panel";
import { VisualPackageQaPanel } from "./operations-recorder-panels/visual-package-qa-panel";

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
        <OpportunityIntakePanel
          permissions={permissions}
          disabled={disabled}
          send={send}
        />
        <PursuitWorkPanel
          permissions={permissions}
          records={records}
          currentUserId={currentUserId}
          disabled={disabled}
          send={send}
        />
        <ClientEvidenceRequestPanel
          permissions={permissions}
          records={records}
          documentsState={documentsState}
          disabled={disabled}
          send={send}
        />
        <SubmissionWarRoomPanel
          permissions={permissions}
          records={records}
          packageVersionsState={packageVersionsState}
          disabled={disabled}
          send={send}
        />
        <VisualPackageQaPanel
          permissions={permissions}
          records={records}
          packageVersionsState={packageVersionsState}
          disabled={disabled}
          send={send}
        />
        <CredentialVerificationPanel
          permissions={permissions}
          records={records}
          vaultItemsState={vaultItemsState}
          disabled={disabled}
          send={send}
        />
        <MissionPanel
          permissions={permissions}
          records={records}
          currentUserId={currentUserId}
          disabled={disabled}
          send={send}
        />
        <PostAwardPanel
          permissions={permissions}
          records={records}
          currentUserId={currentUserId}
          disabled={disabled}
          send={send}
        />
      </div>
    </section>
  );
}
