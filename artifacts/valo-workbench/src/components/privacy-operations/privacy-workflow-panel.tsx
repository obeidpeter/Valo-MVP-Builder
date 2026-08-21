import { useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CanonicalEvidencePicker } from "@/components/canonical-evidence-picker";
import type {
  CanonicalEvidenceBinding,
  CanonicalEvidenceOption,
} from "@/lib/canonical-evidence-options";
import type {
  PrivacyConsentWithdrawalDraft,
  PrivacyDsrTriageDraft,
  PrivacyHoldReviewDraft,
  PrivacyOperationsDashboard,
} from "./privacy-operations-contract";

function selectedVersion(
  id: string,
  rows: readonly { id: string; version: number }[],
): number | null {
  return rows.find((row) => row.id === id)?.version ?? null;
}

function isoFromForm(form: HTMLFormElement, name: string): string {
  const value = String(new FormData(form).get(name) ?? "");
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid workflow date");
  return parsed.toISOString();
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function PrivacyWorkflowPanel({
  dashboard,
  assigneeOptions,
  evidenceOptions = [],
  evidenceOptionsTruncated = false,
  evidenceOptionsPending = false,
  busy = false,
  onTriage,
  onWithdraw,
  onReviewHold,
}: {
  dashboard: PrivacyOperationsDashboard;
  assigneeOptions: readonly { id: string; name: string }[];
  evidenceOptions?: readonly CanonicalEvidenceOption[];
  evidenceOptionsTruncated?: boolean;
  evidenceOptionsPending?: boolean;
  busy?: boolean;
  onTriage: (
    id: string,
    version: number,
    draft: PrivacyDsrTriageDraft,
  ) => Promise<void>;
  onWithdraw: (
    id: string,
    version: number,
    draft: PrivacyConsentWithdrawalDraft,
  ) => Promise<void>;
  onReviewHold: (
    id: string,
    version: number,
    draft: PrivacyHoldReviewDraft,
  ) => Promise<void>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [triageEvidence, setTriageEvidence] = useState<
    CanonicalEvidenceBinding[]
  >([]);
  const [withdrawalEvidence, setWithdrawalEvidence] = useState<
    CanonicalEvidenceBinding[]
  >([]);
  const [holdEvidence, setHoldEvidence] = useState<CanonicalEvidenceBinding[]>(
    [],
  );
  const [triageLegacyDigest, setTriageLegacyDigest] = useState("");
  const [withdrawalLegacyDigest, setWithdrawalLegacyDigest] = useState("");
  const [holdLegacyDigest, setHoldLegacyDigest] = useState("");
  const triageDigest = triageEvidence[0]?.sha256 ?? triageLegacyDigest.trim();
  const withdrawalDigest =
    withdrawalEvidence[0]?.sha256 ?? withdrawalLegacyDigest.trim();
  const holdDigest = holdEvidence[0]?.sha256 ?? holdLegacyDigest.trim();
  const evidenceVerificationNote = evidenceOptionsPending
    ? "Governed document choices are loading. The external or legacy digest field remains available and is not a scanner attestation."
    : "This optional picker copies a digest from a recent governed-document snapshot. The privacy receipt records the digest; it is not a mutation-time scanner or canonical attestation.";
  const activeConsents = dashboard.consentRecords.filter(
    ({ state }) => state === "active",
  );
  const activeHolds = dashboard.legalHolds.filter(
    ({ status }) => status === "active",
  );

  const submitTriage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = String(data.get("dsrId") ?? "");
    const version = selectedVersion(id, dashboard.dataSubjectRequests);
    if (!version) return setFormError("Select a current DSR row.");
    if (!SHA256_PATTERN.test(triageDigest))
      return setFormError(
        "Select governed evidence or enter a SHA-256 digest.",
      );
    setFormError(null);
    try {
      await onTriage(id, version, {
        status: String(data.get("status")) as PrivacyDsrTriageDraft["status"],
        identityVerificationStatus: String(
          data.get("identityVerificationStatus"),
        ) as PrivacyDsrTriageDraft["identityVerificationStatus"],
        assignedToUserId: String(data.get("assignedToUserId") ?? ""),
        reasonCode: String(
          data.get("reasonCode"),
        ) as PrivacyDsrTriageDraft["reasonCode"],
        decisionEvidenceSha256: triageDigest,
      });
    } catch {
      setFormError("Triage evidence was not recorded. Reload before retrying.");
    }
  };

  const submitWithdrawal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = String(data.get("consentId") ?? "");
    const version = selectedVersion(id, activeConsents);
    if (!version) return setFormError("Select an active consent row.");
    if (!SHA256_PATTERN.test(withdrawalDigest))
      return setFormError(
        "Select governed evidence or enter a SHA-256 digest.",
      );
    setFormError(null);
    try {
      await onWithdraw(id, version, {
        withdrawnAt: isoFromForm(form, "withdrawnAt"),
        evidenceSha256: withdrawalDigest,
      });
    } catch {
      setFormError(
        "Withdrawal evidence was not recorded. Reload before retrying.",
      );
    }
  };

  const submitHoldReview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const id = String(data.get("holdId") ?? "");
    const version = selectedVersion(id, activeHolds);
    if (!version) return setFormError("Select an active legal hold.");
    if (!SHA256_PATTERN.test(holdDigest))
      return setFormError(
        "Select governed evidence or enter a SHA-256 digest.",
      );
    setFormError(null);
    try {
      await onReviewHold(id, version, {
        reviewOutcome: String(
          data.get("reviewOutcome"),
        ) as PrivacyHoldReviewDraft["reviewOutcome"],
        nextReviewAt: isoFromForm(form, "nextReviewAt"),
        evidenceSha256: holdDigest,
      });
    } catch {
      setFormError("Hold review was not recorded. Reload before retrying.");
    }
  };

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Record a named-human workflow
        </CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          Record identifiers, controlled decisions and evidence digests only. Do
          not enter names, contact details, request narratives or provider
          credentials. These forms cannot release a hold, delete data or send a
          provider request.
        </p>
      </CardHeader>
      <CardContent>
        {formError ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {formError}
          </p>
        ) : null}
        <Tabs defaultValue="triage" className="space-y-5">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="triage">Triage DSR</TabsTrigger>
            <TabsTrigger value="withdrawal">Record withdrawal</TabsTrigger>
            <TabsTrigger value="hold-review">Review hold</TabsTrigger>
          </TabsList>

          <TabsContent value="triage">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitTriage}>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="privacy-dsr-id">Data-subject request</Label>
                <select
                  id="privacy-dsr-id"
                  name="dsrId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a minimised queue row
                  </option>
                  {dashboard.dataSubjectRequests.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.requestType} · {item.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-dsr-status">Operational status</Label>
                <select
                  id="privacy-dsr-status"
                  name="status"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue="triaged"
                >
                  <option value="received">Received</option>
                  <option value="triaged">Triaged</option>
                  <option value="in_progress">In progress</option>
                  <option value="awaiting_identity">Awaiting identity</option>
                  <option value="on_hold">On hold</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-identity-status">
                  Identity check record
                </Label>
                <select
                  id="privacy-identity-status"
                  name="identityVerificationStatus"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue="pending"
                >
                  <option value="pending">Pending</option>
                  <option value="verified">Verified by human</option>
                  <option value="failed">Failed by human</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-assignee">Named privacy assignee</Label>
                <select
                  id="privacy-assignee"
                  name="assignedToUserId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                  required
                >
                  <option value="" disabled>
                    Select an active privacy manager
                  </option>
                  {assigneeOptions.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.name}
                    </option>
                  ))}
                </select>
                {assigneeOptions.length === 0 ? (
                  <p className="text-xs text-destructive">
                    No active named privacy manager is available. Triage stays
                    disabled.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-triage-reason">Controlled reason</Label>
                <select
                  id="privacy-triage-reason"
                  name="reasonCode"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue="initial_triage"
                >
                  <option value="initial_triage">Initial triage</option>
                  <option value="identity_pending">Identity pending</option>
                  <option value="scope_confirmation">Scope confirmation</option>
                  <option value="complexity_review">Complexity review</option>
                  <option value="deadline_risk">Deadline risk</option>
                  <option value="other_review_required">
                    Other review required
                  </option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <CanonicalEvidencePicker
                  id="privacy-triage-evidence"
                  label="Decision evidence"
                  options={evidenceOptions}
                  value={triageEvidence}
                  onChange={(value) => {
                    setTriageEvidence(value);
                    if (value.length > 0) setTriageLegacyDigest("");
                  }}
                  required={false}
                  disabled={busy || evidenceOptionsPending}
                  truncated={evidenceOptionsTruncated}
                  verificationNote={evidenceVerificationNote}
                />
                <Label htmlFor="privacy-triage-legacy-digest">
                  Decision external or legacy evidence digest — not a scanner
                  attestation
                </Label>
                <Input
                  id="privacy-triage-legacy-digest"
                  value={triageLegacyDigest}
                  onChange={(event) => {
                    setTriageLegacyDigest(
                      event.currentTarget.value.toLowerCase(),
                    );
                    setTriageEvidence([]);
                  }}
                  minLength={64}
                  maxLength={64}
                  pattern="[a-f0-9]{64}"
                  disabled={busy}
                />
              </div>
              <Button
                disabled={
                  busy ||
                  assigneeOptions.length === 0 ||
                  !SHA256_PATTERN.test(triageDigest)
                }
                type="submit"
                className="sm:col-span-2"
              >
                {busy ? "Recording…" : "Record triage with CAS"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="withdrawal">
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={submitWithdrawal}
            >
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="privacy-consent-id">
                  Active consent record
                </Label>
                <select
                  id="privacy-consent-id"
                  name="consentId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select a consent record
                  </option>
                  {activeConsents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-withdrawn-at">
                  Withdrawal observed at
                </Label>
                <Input
                  id="privacy-withdrawn-at"
                  name="withdrawnAt"
                  type="datetime-local"
                  required
                />
              </div>
              <div>
                <CanonicalEvidencePicker
                  id="privacy-withdrawal-evidence"
                  label="Withdrawal evidence"
                  options={evidenceOptions}
                  value={withdrawalEvidence}
                  onChange={(value) => {
                    setWithdrawalEvidence(value);
                    if (value.length > 0) setWithdrawalLegacyDigest("");
                  }}
                  required={false}
                  disabled={busy || evidenceOptionsPending}
                  truncated={evidenceOptionsTruncated}
                  verificationNote={evidenceVerificationNote}
                />
                <Label htmlFor="privacy-withdrawal-legacy-digest">
                  Withdrawal external or legacy evidence digest — not a scanner
                  attestation
                </Label>
                <Input
                  id="privacy-withdrawal-legacy-digest"
                  value={withdrawalLegacyDigest}
                  onChange={(event) => {
                    setWithdrawalLegacyDigest(
                      event.currentTarget.value.toLowerCase(),
                    );
                    setWithdrawalEvidence([]);
                  }}
                  minLength={64}
                  maxLength={64}
                  pattern="[a-f0-9]{64}"
                  disabled={busy}
                />
              </div>
              <Button
                disabled={busy || !SHA256_PATTERN.test(withdrawalDigest)}
                type="submit"
                className="sm:col-span-2"
              >
                {busy ? "Recording…" : "Record withdrawal evidence"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="hold-review">
            <form
              className="grid gap-4 sm:grid-cols-2"
              onSubmit={submitHoldReview}
            >
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="privacy-hold-id">Active legal hold</Label>
                <select
                  id="privacy-hold-id"
                  name="holdId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select an active hold
                  </option>
                  {activeHolds.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-hold-outcome">
                  Human review outcome
                </Label>
                <select
                  id="privacy-hold-outcome"
                  name="reviewOutcome"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue="continue"
                >
                  <option value="continue">Continue hold</option>
                  <option value="escalate_for_legal_review">
                    Escalate for legal review
                  </option>
                  <option value="release_recommended">
                    Recommend release (does not release)
                  </option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="privacy-next-review">Next review date</Label>
                <Input
                  id="privacy-next-review"
                  name="nextReviewAt"
                  type="datetime-local"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <CanonicalEvidencePicker
                  id="privacy-hold-evidence"
                  label="Review evidence"
                  options={evidenceOptions}
                  value={holdEvidence}
                  onChange={(value) => {
                    setHoldEvidence(value);
                    if (value.length > 0) setHoldLegacyDigest("");
                  }}
                  required={false}
                  disabled={busy || evidenceOptionsPending}
                  truncated={evidenceOptionsTruncated}
                  verificationNote={evidenceVerificationNote}
                />
                <Label htmlFor="privacy-hold-legacy-digest">
                  Hold-review external or legacy evidence digest — not a scanner
                  attestation
                </Label>
                <Input
                  id="privacy-hold-legacy-digest"
                  value={holdLegacyDigest}
                  onChange={(event) => {
                    setHoldLegacyDigest(
                      event.currentTarget.value.toLowerCase(),
                    );
                    setHoldEvidence([]);
                  }}
                  minLength={64}
                  maxLength={64}
                  pattern="[a-f0-9]{64}"
                  disabled={busy}
                />
              </div>
              <Button
                disabled={busy || !SHA256_PATTERN.test(holdDigest)}
                type="submit"
                className="sm:col-span-2"
              >
                {busy ? "Recording…" : "Record hold review"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
