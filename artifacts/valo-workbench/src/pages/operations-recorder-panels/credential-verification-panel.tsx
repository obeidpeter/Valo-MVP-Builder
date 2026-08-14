import type {
  OperationsRecorderPermissions,
  OperationsRecorderRecords,
} from "../pursuit-operations-suite-recorder";
import {
  CONTROL,
  Field,
  Panel,
  Submit,
  TextArea,
  VaultItemSelect,
  optionalText,
  requiredIso,
  requiredSha,
  requiredText,
  selectedVaultItem,
  withOptional,
  type RecorderSend,
} from "./recorder-primitives";

export function CredentialVerificationPanel({
  permissions,
  records,
  vaultItemsState,
  disabled,
  send,
}: {
  permissions: OperationsRecorderPermissions;
  records: OperationsRecorderRecords;
  vaultItemsState: "loading" | "ready" | "error" | "unavailable";
  disabled: boolean;
  send: RecorderSend;
}) {
  return (
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
                outcome: requiredText(data, "credentialOutcome", "Outcome", 32),
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
  );
}
