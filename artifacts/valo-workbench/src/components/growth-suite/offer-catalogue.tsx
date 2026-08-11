import { CheckCircle2, LockKeyhole, Shield } from "lucide-react";
import type { OfferCatalogueItem } from "./growth-suite-contract";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GrowthOfferCatalogue({
  catalogueVersion,
  offers,
}: {
  catalogueVersion: string;
  offers: readonly OfferCatalogueItem[];
}) {
  return (
    <section aria-labelledby="growth-offers-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Productised offers
          </p>
          <h2
            id="growth-offers-heading"
            className="mt-1 font-serif text-2xl font-semibold"
          >
            Versioned scope before price
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            Every SKU fixes its included and excluded outcomes. The current
            catalogue stores no quote or price. Once a dedicated quote ledger is
            approved, one named operator may enter terms for approval by a
            different person; Valo neither calculates nor collects payment.
          </p>
        </div>
        <Badge variant="outline">Catalogue {catalogueVersion}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {offers.map((offer) => (
          <Card key={offer.versionId} className="flex flex-col">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-lg">{offer.title}</CardTitle>
                <Badge variant="secondary">v{offer.revision}</Badge>
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                {offer.versionId}
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <p className="text-sm leading-6 text-muted-foreground">
                {offer.summary}
              </p>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide">
                  Included outcomes
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {offer.includedOutcomes.map((outcome) => (
                    <li key={outcome} className="flex gap-2">
                      <CheckCircle2
                        className="mt-0.5 shrink-0 text-emerald-600"
                        size={16}
                        aria-hidden="true"
                      />
                      {outcome}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide">
                  Explicit exclusions
                </h3>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  {offer.excludedActions.map((action) => (
                    <li key={action} className="flex gap-2">
                      <Shield
                        className="mt-0.5 shrink-0"
                        size={16}
                        aria-hidden="true"
                      />
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mt-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
                Human quote required · External manual payment only
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card aria-labelledby="quote-ledger-gate-heading">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id="quote-ledger-gate-heading" className="text-base">
              Durable quote ledger unavailable
            </CardTitle>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              The shipped product has no connected durable quote repository or
              approval ledger. Catalogue scope remains available, but Valo does
              not load, draft, save or approve quote terms from this page.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            <LockKeyhole size={14} aria-hidden="true" />
            Unavailable
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-xs leading-5 text-muted-foreground">
            Do not treat this gate as an empty quote queue. Pricing and payment
            remain outside Valo until a separately approved, tenant-scoped
            human-entry and second-operator approval ledger is deployed.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
