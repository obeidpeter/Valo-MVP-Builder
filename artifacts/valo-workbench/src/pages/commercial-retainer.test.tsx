import { describe, expect, it } from "vitest";
import { adaptCommercialRetainerSnapshot } from "./commercial-retainer";

function envelope() {
  return {
    snapshot: {
      organisationId: "org-a",
      manifest: {
        moduleVersion: "valo.commercial-retainer@v1",
        routeMounted: true,
        navigationMounted: true,
        openApiPublished: true,
        automaticPricingAllowed: false,
        paymentProviderConnected: false,
        externalMessagingConnected: false,
        autonomousWorkAllowed: false,
        makerCheckerRequired: true,
      },
      activation: {
        fixedPriceBookReady: false,
        providerConnected: false,
        manualReconciliationReady: true,
        retainerDeskReady: false,
      },
      offers: [],
      quotes: [] as unknown[],
      invoices: [],
      payments: [],
      entitlements: [],
      serviceRequests: [],
    },
  };
}

describe("adaptCommercialRetainerSnapshot", () => {
  it("accepts only a bounded fail-closed authority contract", () => {
    expect(
      adaptCommercialRetainerSnapshot(envelope(), "org-a").activation,
    ).toEqual({
      fixedPriceBookReady: false,
      providerConnected: false,
      manualReconciliationReady: true,
      retainerDeskReady: false,
    });
  });

  it("rejects any server claim that a provider or autonomous action is connected", () => {
    const provider = envelope();
    provider.snapshot.manifest.paymentProviderConnected = true;
    expect(() => adaptCommercialRetainerSnapshot(provider, "org-a")).toThrow(
      /safety contract/u,
    );

    const autonomous = envelope();
    autonomous.snapshot.manifest.autonomousWorkAllowed = true;
    expect(() => adaptCommercialRetainerSnapshot(autonomous, "org-a")).toThrow(
      /safety contract/u,
    );
  });

  it("rejects oversized ledgers instead of truncating silently", () => {
    const oversized = envelope();
    oversized.snapshot.quotes = Array.from({ length: 51 }, () => ({}));
    expect(() => adaptCommercialRetainerSnapshot(oversized, "org-a")).toThrow(
      /bounded contract/u,
    );
  });

  it("rejects a snapshot issued for another active organisation", () => {
    expect(() => adaptCommercialRetainerSnapshot(envelope(), "org-b")).toThrow(
      /safety contract/u,
    );
  });
});
