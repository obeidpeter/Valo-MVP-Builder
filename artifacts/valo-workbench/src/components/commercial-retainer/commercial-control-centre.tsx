import { StateBadge, StatusPanel } from "@/components/platform-states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  CommercialRetainerMutation,
  CommercialRetainerSnapshotView,
} from "./commercial-retainer-contract";
import { InvoiceForm } from "./invoice-form";
import { PaymentForm } from "./payment-form";
import { QuoteForm } from "./quote-form";
import {
  RetainerRequestCard,
  RetainerRequestForm,
} from "./retainer-request-forms";

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
