import { useState, type FormEvent } from "react";
import { StateBadge, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
  QuoteProposalView,
  RetainerServiceRequestView,
} from "./commercial-retainer-contract";

function randomDigest(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function FormField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function QuoteForm({
  snapshot,
  busy,
  onMutate,
}: {
  snapshot: CommercialRetainerSnapshotView;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const orderable = snapshot.offers.filter((offer) => offer.orderable);
  const [digest, setDigest] = useState(randomDigest);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onMutate({
      path: "/api/commercial-retainer/quotes",
      body: {
        projectId: data.get("projectId") || null,
        customerReference: data.get("customerReference"),
        offerVersionId: data.get("offerVersionId"),
        scopeSummary: data.get("scopeSummary"),
        currency: data.get("currency"),
        amountMinor: Number(data.get("amountMinor")),
        validUntil: data.get("validUntil"),
        serviceStartsOn: data.get("serviceStartsOn"),
        serviceEndsOn: data.get("serviceEndsOn"),
        serviceUnits: Number(data.get("serviceUnits")),
        idempotencyDigest: digest,
      },
    });
    setDigest(randomDigest());
    event.currentTarget.reset();
  }

  return (
    <form
      className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"
      onSubmit={submit}
    >
      <FormField id="commercial-offer" label="Fixed offer version">
        <select
          id="commercial-offer"
          name="offerVersionId"
          required
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          disabled={busy || orderable.length === 0}
        >
          <option value="">Select an approved offer</option>
          {orderable.map((offer) => (
            <option key={offer.versionId} value={offer.versionId}>
              {offer.title} ({offer.versionId})
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="commercial-customer-reference" label="Customer reference">
        <Input
          id="commercial-customer-reference"
          name="customerReference"
          required
          maxLength={160}
        />
      </FormField>
      <FormField id="commercial-project-id" label="Project ID (optional)">
        <Input id="commercial-project-id" name="projectId" inputMode="text" />
      </FormField>
      <FormField id="commercial-currency" label="Currency">
        <Input
          id="commercial-currency"
          name="currency"
          required
          pattern="[A-Z]{3}"
          maxLength={3}
          placeholder="NGN"
        />
      </FormField>
      <FormField
        id="commercial-amount"
        label="Human-entered amount (minor units)"
      >
        <Input
          id="commercial-amount"
          name="amountMinor"
          required
          type="number"
          min={1}
          step={1}
        />
      </FormField>
      <FormField id="commercial-units" label="Service units">
        <Input
          id="commercial-units"
          name="serviceUnits"
          required
          type="number"
          min={1}
          max={100}
          step={1}
        />
      </FormField>
      <FormField id="commercial-valid-until" label="Quote valid until">
        <Input
          id="commercial-valid-until"
          name="validUntil"
          required
          type="date"
        />
      </FormField>
      <FormField id="commercial-service-start" label="Service starts">
        <Input
          id="commercial-service-start"
          name="serviceStartsOn"
          required
          type="date"
        />
      </FormField>
      <FormField id="commercial-service-end" label="Service ends">
        <Input
          id="commercial-service-end"
          name="serviceEndsOn"
          required
          type="date"
        />
      </FormField>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="commercial-scope">Human-agreed scope</Label>
        <Textarea
          id="commercial-scope"
          name="scopeSummary"
          required
          maxLength={1000}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || orderable.length === 0}>
          Create proposal for checker review
        </Button>
      </div>
    </form>
  );
}

function InvoiceForm({
  quote,
  busy,
  onMutate,
}: {
  quote: QuoteProposalView;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onMutate({
      path: `/api/commercial-retainer/quotes/${quote.id}/invoices`,
      body: {
        expectedOrderVersion: quote.version,
        invoiceNumber: data.get("invoiceNumber"),
        netAmountMinor: Number(data.get("netAmountMinor")),
        vatRateBasisPoints: Number(data.get("vatRateBasisPoints")),
        vatAmountMinor: Number(data.get("vatAmountMinor")),
        grossAmountMinor: Number(data.get("grossAmountMinor")),
        whtRateBasisPoints: data.get("whtRateBasisPoints")
          ? Number(data.get("whtRateBasisPoints"))
          : null,
        whtAmountMinor: data.get("whtAmountMinor")
          ? Number(data.get("whtAmountMinor"))
          : null,
        netPayableMinor: Number(data.get("netPayableMinor")),
        taxRuleId: data.get("taxRuleId"),
        taxPointAt: new Date(String(data.get("taxPointAt"))).toISOString(),
        dueAt: data.get("dueAt")
          ? new Date(String(data.get("dueAt"))).toISOString()
          : null,
      },
    });
  }
  return (
    <details className="mt-3 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Record manual invoice
      </summary>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
        <FormField id={`invoice-number-${quote.id}`} label="Invoice number">
          <Input
            id={`invoice-number-${quote.id}`}
            name="invoiceNumber"
            required
          />
        </FormField>
        <FormField
          id={`invoice-net-${quote.id}`}
          label="Net amount (minor units)"
        >
          <Input
            id={`invoice-net-${quote.id}`}
            name="netAmountMinor"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={quote.amountMinor}
          />
        </FormField>
        {[
          ["vatRateBasisPoints", "VAT rate (basis points)"],
          ["vatAmountMinor", "VAT amount (minor units)"],
          ["grossAmountMinor", "Gross amount (minor units)"],
          ["whtRateBasisPoints", "WHT rate (basis points, optional)"],
          ["whtAmountMinor", "WHT amount (minor units, optional)"],
          ["netPayableMinor", "Net payable (minor units)"],
        ].map(([name, label]) => (
          <FormField key={name} id={`${name}-${quote.id}`} label={label}>
            <Input
              id={`${name}-${quote.id}`}
              name={name}
              type="number"
              min={0}
              step={1}
              required={!name.startsWith("wht")}
            />
          </FormField>
        ))}
        <FormField
          id={`tax-rule-${quote.id}`}
          label="Tax rule/version reference"
        >
          <Input id={`tax-rule-${quote.id}`} name="taxRuleId" required />
        </FormField>
        <FormField id={`tax-point-${quote.id}`} label="Tax point">
          <Input
            id={`tax-point-${quote.id}`}
            name="taxPointAt"
            type="datetime-local"
            required
          />
        </FormField>
        <FormField id={`invoice-due-${quote.id}`} label="Due at (optional)">
          <Input
            id={`invoice-due-${quote.id}`}
            name="dueAt"
            type="datetime-local"
          />
        </FormField>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            Record invoice without provider call
          </Button>
        </div>
      </form>
    </details>
  );
}

function PaymentForm({
  invoice,
  busy,
  onMutate,
}: {
  invoice: CommercialRetainerSnapshotView["invoices"][number];
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const [digest, setDigest] = useState(randomDigest);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onMutate({
      path: `/api/commercial-retainer/invoices/${invoice.id}/payments`,
      body: {
        expectedInvoiceVersion: invoice.version,
        evidenceReference: data.get("evidenceReference"),
        evidenceSha256: data.get("evidenceSha256"),
        amountMinor: invoice.netPayableMinor,
        currency: invoice.currency,
        settledAt: new Date(String(data.get("settledAt"))).toISOString(),
        idempotencyDigest: digest,
      },
    });
    setDigest(randomDigest());
  }
  return (
    <details className="mt-3 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Record payment evidence
      </summary>
      <form className="mt-4 grid gap-3" onSubmit={submit}>
        <FormField
          id={`payment-reference-${invoice.id}`}
          label="Evidence reference"
        >
          <Input
            id={`payment-reference-${invoice.id}`}
            name="evidenceReference"
            required
          />
        </FormField>
        <FormField id={`payment-hash-${invoice.id}`} label="Evidence SHA-256">
          <Input
            id={`payment-hash-${invoice.id}`}
            name="evidenceSha256"
            required
            pattern="[a-f0-9]{64}"
          />
        </FormField>
        <FormField id={`payment-settled-${invoice.id}`} label="Settled at">
          <Input
            id={`payment-settled-${invoice.id}`}
            name="settledAt"
            type="datetime-local"
            required
          />
        </FormField>
        <Button type="submit" disabled={busy}>
          Record evidence for independent verification
        </Button>
      </form>
    </details>
  );
}

function RetainerRequestForm({
  snapshot,
  actorMembershipId,
  busy,
  onMutate,
}: {
  snapshot: CommercialRetainerSnapshotView;
  actorMembershipId: string;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const [digest, setDigest] = useState(randomDigest);
  const active = snapshot.entitlements.filter(
    (item) =>
      item.productKind === "evidence_readiness_retainer" &&
      item.status === "active" &&
      item.usageConsumed < item.usageLimit,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onMutate({
      path: "/api/commercial-retainer/retainer/requests",
      body: {
        projectId: data.get("projectId"),
        entitlementId: data.get("entitlementId"),
        purpose: data.get("purpose"),
        summary: data.get("summary"),
        ownerMembershipId: data.get("ownerMembershipId"),
        sla: data.get("sla"),
        idempotencyDigest: digest,
      },
    });
    setDigest(randomDigest());
    event.currentTarget.reset();
  }
  return (
    <form
      className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2"
      onSubmit={submit}
    >
      <FormField id="retainer-entitlement" label="Active retainer entitlement">
        <select
          id="retainer-entitlement"
          name="entitlementId"
          required
          disabled={busy || active.length === 0}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select entitlement</option>
          {active.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id} ({item.usageConsumed}/{item.usageLimit} used)
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="retainer-project" label="Project ID">
        <Input id="retainer-project" name="projectId" required />
      </FormField>
      <FormField id="retainer-purpose" label="Purpose">
        <select
          id="retainer-purpose"
          name="purpose"
          required
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="evidence_review">Evidence review</option>
          <option value="renewal_readiness">Renewal readiness</option>
          <option value="bid_evidence_pack">Bid evidence pack</option>
        </select>
      </FormField>
      <FormField id="retainer-sla" label="SLA">
        <select
          id="retainer-sla"
          name="sla"
          required
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="standard">Standard — 120 hours</option>
          <option value="priority">Priority — 48 hours</option>
        </select>
      </FormField>
      <FormField id="retainer-owner" label="Owner membership ID">
        <Input
          id="retainer-owner"
          name="ownerMembershipId"
          required
          defaultValue={actorMembershipId}
        />
      </FormField>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="retainer-summary">Purpose-bound request summary</Label>
        <Textarea
          id="retainer-summary"
          name="summary"
          required
          maxLength={1000}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy || active.length === 0}>
          Create service request
        </Button>
      </div>
    </form>
  );
}

function RetainerRequestCard({
  request,
  busy,
  onMutate,
}: {
  request: RetainerServiceRequestView;
  busy: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  const terminal =
    request.status === "completed" || request.status === "cancelled";
  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onMutate({
      path: `/api/commercial-retainer/retainer/requests/${request.id}/actions`,
      body: {
        action: "comment",
        expectedVersion: request.version,
        body: data.get("comment"),
      },
    });
  }
  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onMutate({
      path: `/api/commercial-retainer/retainer/requests/${request.id}/actions`,
      body: {
        action: "record_evidence",
        expectedVersion: request.version,
        reference: data.get("evidenceReference"),
        sha256: data.get("evidenceSha256"),
      },
    });
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{request.summary}</CardTitle>
          <StateBadge
            state={
              terminal
                ? request.status === "completed"
                  ? "active"
                  : "blocked"
                : "pending"
            }
            label={request.status.replaceAll("_", " ")}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Purpose</dt>
            <dd>{request.purpose.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Due</dt>
            <dd>{new Date(request.dueAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Owner membership</dt>
            <dd className="break-all font-mono text-xs">
              {request.ownerMembershipId}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Evidence receipts</dt>
            <dd>{request.evidenceReceipts.length}</dd>
          </div>
        </dl>
        {!terminal ? (
          <>
            <form className="flex gap-2" onSubmit={addComment}>
              <Label className="sr-only" htmlFor={`comment-${request.id}`}>
                Add internal comment
              </Label>
              <Input
                id={`comment-${request.id}`}
                name="comment"
                required
                maxLength={1000}
                placeholder="Bounded internal comment"
              />
              <Button type="submit" variant="outline" disabled={busy}>
                Add
              </Button>
            </form>
            <form
              className="grid gap-2 rounded-md border p-3 sm:grid-cols-2"
              onSubmit={addEvidence}
            >
              <FormField
                id={`evidence-reference-${request.id}`}
                label="Evidence reference"
              >
                <Input
                  id={`evidence-reference-${request.id}`}
                  name="evidenceReference"
                  required
                />
              </FormField>
              <FormField
                id={`evidence-sha-${request.id}`}
                label="Evidence SHA-256"
              >
                <Input
                  id={`evidence-sha-${request.id}`}
                  name="evidenceSha256"
                  required
                  pattern="[a-f0-9]{64}"
                />
              </FormField>
              <div className="sm:col-span-2">
                <Button type="submit" variant="outline" disabled={busy}>
                  Record evidence receipt
                </Button>
              </div>
            </form>
            <div
              className="flex flex-wrap gap-2"
              aria-label="Request status actions"
            >
              {(
                [
                  "in_progress",
                  "awaiting_evidence",
                  "completed",
                  "cancelled",
                ] as const
              ).map((status) => (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    busy ||
                    (status === "completed" &&
                      request.evidenceReceipts.length === 0)
                  }
                  onClick={() =>
                    onMutate({
                      path: `/api/commercial-retainer/retainer/requests/${request.id}/actions`,
                      body: {
                        action: "set_status",
                        expectedVersion: request.version,
                        status,
                      },
                    })
                  }
                >
                  {status.replaceAll("_", " ")}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CommercialControlCentre({
  snapshot,
  actorUserId,
  actorMembershipId,
  canCreateOrder,
  canApprove,
  canReconcile,
  canUseRetainer,
  busy = false,
  onMutate,
}: {
  snapshot: CommercialRetainerSnapshotView;
  actorUserId: string;
  actorMembershipId: string;
  canCreateOrder: boolean;
  canApprove: boolean;
  canReconcile: boolean;
  canUseRetainer: boolean;
  busy?: boolean;
  onMutate: (mutation: CommercialRetainerMutation) => Promise<void>;
}) {
  return (
    <div className="space-y-8">
      {!snapshot.activation.fixedPriceBookReady ? (
        <StatusPanel
          state="blocked"
          title="Fixed catalogue is not orderable"
          description="An approved, effective fixed price-book seed is missing. No quote control can invent a product or price."
        />
      ) : null}
      <StatusPanel
        state="partial"
        title="Manual commercial boundary"
        description="Prices are entered by a named human. Approval and payment verification require a different named human. Payment providers, external messaging and autonomous delivery remain disconnected."
      />

      <section
        aria-labelledby="commercial-offers-heading"
        className="space-y-4"
      >
        <h2
          id="commercial-offers-heading"
          className="font-serif text-xl font-semibold"
        >
          Fixed offer catalogue
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          {snapshot.offers.map((offer) => (
            <Card key={offer.versionId}>
              <CardHeader>
                <CardTitle className="text-base">{offer.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{offer.summary}</p>
                <StateBadge
                  state={offer.orderable ? "active" : "blocked"}
                  label={offer.orderable ? "Approved version" : "Seed missing"}
                />
                <p className="font-mono text-xs">{offer.versionId}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        {canCreateOrder ? (
          <QuoteForm snapshot={snapshot} busy={busy} onMutate={onMutate} />
        ) : null}
      </section>

      <section aria-labelledby="quote-ledger-heading" className="space-y-4">
        <h2
          id="quote-ledger-heading"
          className="font-serif text-xl font-semibold"
        >
          Quote-to-cash ledger
        </h2>
        {snapshot.quotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scoped quote proposals.
          </p>
        ) : null}
        {snapshot.quotes.map((quote) => {
          const selfApproval = quote.createdByUserId === actorUserId;
          return (
            <Card key={quote.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{quote.customerReference}</h3>
                    <p className="text-sm text-muted-foreground">
                      {quote.offerVersionId} · {quote.currency}{" "}
                      {quote.amountMinor} minor units
                    </p>
                  </div>
                  <StateBadge
                    state={quote.status === "paid" ? "active" : "pending"}
                    label={quote.status.replaceAll("_", " ")}
                  />
                </div>
                <p className="text-sm">{quote.scopeSummary}</p>
                {quote.status === "pending_checker" && canApprove ? (
                  <div>
                    <Button
                      type="button"
                      disabled={busy || selfApproval}
                      aria-describedby={
                        selfApproval ? `self-approval-${quote.id}` : undefined
                      }
                      onClick={() =>
                        onMutate({
                          path: `/api/commercial-retainer/quotes/${quote.id}/approve`,
                          body: { expectedVersion: quote.version },
                        })
                      }
                    >
                      Approve as checker
                    </Button>
                    {selfApproval ? (
                      <p
                        id={`self-approval-${quote.id}`}
                        className="mt-2 text-xs text-muted-foreground"
                      >
                        The proposal maker cannot approve their own terms.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {quote.status === "approved" && canReconcile ? (
                  <InvoiceForm quote={quote} busy={busy} onMutate={onMutate} />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
        {snapshot.invoices.map((invoice) => (
          <Card key={invoice.id}>
            <CardContent className="space-y-2 p-5 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <h3 className="font-semibold">
                  Invoice {invoice.invoiceNumber}
                </h3>
                <StateBadge
                  state={
                    invoice.status === "paid_manual" ? "active" : "pending"
                  }
                  label={invoice.status.replaceAll("_", " ")}
                />
              </div>
              <p>
                {invoice.currency} {invoice.netPayableMinor} minor units payable
              </p>
              {invoice.status === "issued_manual" && canReconcile ? (
                <PaymentForm
                  invoice={invoice}
                  busy={busy}
                  onMutate={onMutate}
                />
              ) : null}
            </CardContent>
          </Card>
        ))}
        {snapshot.payments.map((payment) => {
          const invoice = snapshot.invoices.find(
            (item) => item.id === payment.invoiceId,
          );
          const selfVerification = payment.recordedByUserId === actorUserId;
          return (
            <Card key={payment.id}>
              <CardContent className="space-y-2 p-5 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold">
                    Payment evidence {payment.id}
                  </h3>
                  <StateBadge
                    state={
                      payment.reconciliationStatus === "verified_manual"
                        ? "active"
                        : "pending"
                    }
                    label={payment.reconciliationStatus.replaceAll("_", " ")}
                  />
                </div>
                <p className="break-all font-mono text-xs">
                  SHA-256 {payment.evidenceSha256}
                </p>
                {payment.reconciliationStatus === "pending_checker" &&
                invoice &&
                canReconcile ? (
                  <Button
                    type="button"
                    disabled={busy || selfVerification}
                    onClick={() =>
                      onMutate({
                        path: `/api/commercial-retainer/payments/${payment.id}/verify`,
                        body: {
                          expectedPaymentVersion: payment.version,
                          expectedInvoiceVersion: invoice.version,
                        },
                      })
                    }
                  >
                    Verify evidence and provision entitlement
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section aria-labelledby="retainer-desk-heading" className="space-y-4">
        <h2
          id="retainer-desk-heading"
          className="font-serif text-xl font-semibold"
        >
          Retainer service desk
        </h2>
        <p className="text-sm text-muted-foreground">
          Requests consume one verified entitlement unit. They create internal
          work only; no external message or autonomous action is sent.
        </p>
        {canUseRetainer ? (
          <RetainerRequestForm
            snapshot={snapshot}
            actorMembershipId={actorMembershipId}
            busy={busy}
            onMutate={onMutate}
          />
        ) : null}
        <div className="grid gap-4 lg:grid-cols-2">
          {snapshot.serviceRequests.map((request) => (
            <RetainerRequestCard
              key={request.id}
              request={request}
              busy={busy}
              onMutate={onMutate}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
