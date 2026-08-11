import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMMERCIAL_RETAINER_MANIFEST,
  type CommercialRetainerRepository,
  type CommercialScope,
  type QuoteProposal,
} from "./contracts";
import {
  createCommercialRetainerService,
  parseManualInvoiceTerms,
  parseQuoteTerms,
} from "./service";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-11T12:00:00.000Z");
const scope: CommercialScope = {
  organisationId: ORG,
  actorUserId: USER,
  actorMembershipId: MEMBERSHIP,
};

const VALID_QUOTE = {
  projectId: null,
  customerReference: "Customer 24",
  offerVersionId: "evidence_readiness_retainer@1",
  scopeSummary: "Named evidence readiness service",
  currency: "NGN",
  amountMinor: 250_000,
  validUntil: "2026-08-20",
  serviceStartsOn: "2026-08-12",
  serviceEndsOn: "2027-08-11",
  serviceUnits: 12,
  idempotencyDigest: "a".repeat(64),
};

function quote(): QuoteProposal {
  return {
    id: ORDER,
    organisationId: ORG,
    projectId: null,
    offerVersionId: "evidence_readiness_retainer@1",
    customerReference: "Customer 24",
    scopeSummary: "Named evidence readiness service",
    currency: "NGN",
    amountMinor: 250_000,
    validUntil: "2026-08-20",
    serviceStartsOn: "2026-08-12",
    serviceEndsOn: "2027-08-11",
    serviceUnits: 12,
    status: "pending_checker",
    createdByUserId: USER,
    approvedByUserId: null,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

class StubRepository implements CommercialRetainerRepository {
  createdTerms:
    | Parameters<CommercialRetainerRepository["createQuote"]>[1]
    | null = null;

  async readSnapshot(): Promise<never> {
    throw new Error("unused");
  }

  async createQuote(
    _scope: CommercialScope,
    terms: Parameters<CommercialRetainerRepository["createQuote"]>[1],
  ) {
    this.createdTerms = terms;
    return quote();
  }

  async approveQuote() {
    return { outcome: "not_found" as const };
  }

  async createInvoice() {
    return { outcome: "not_found" as const };
  }

  async recordPayment() {
    return { outcome: "not_found" as const };
  }

  async verifyPayment() {
    return { outcome: "not_found" as const };
  }

  async createRetainerRequest() {
    return { outcome: "not_found" as const };
  }

  async mutateRetainerRequest() {
    return { outcome: "not_found" as const };
  }
}

test("quote input accepts only fixed offer versions and human-entered terms", async () => {
  assert.equal(parseQuoteTerms({ ...VALID_QUOTE, autoPrice: true }, NOW), null);
  assert.equal(
    parseQuoteTerms(
      { ...VALID_QUOTE, offerVersionId: "custom-consulting@99" },
      NOW,
    ),
    null,
  );
  const repository = new StubRepository();
  const service = createCommercialRetainerService({
    repository,
    now: () => NOW,
  });
  await service.createQuote(scope, VALID_QUOTE);
  assert.equal(repository.createdTerms?.amountMinor, 250_000);
  assert.equal(
    repository.createdTerms?.offerVersionId,
    "evidence_readiness_retainer@1",
  );
});

test("manual invoice validation checks arithmetic without deriving a price", () => {
  const base = {
    orderId: ORDER,
    expectedOrderVersion: 2,
    invoiceNumber: "INV-24",
    netAmountMinor: 100_000,
    vatRateBasisPoints: 750,
    vatAmountMinor: 7_500,
    grossAmountMinor: 107_500,
    whtRateBasisPoints: 500,
    whtAmountMinor: 5_000,
    netPayableMinor: 102_500,
    taxRuleId: "ng-manual@v1",
    taxPointAt: "2026-08-11T12:00:00.000Z",
    dueAt: null,
  };
  assert.ok(parseManualInvoiceTerms(base));
  assert.equal(
    parseManualInvoiceTerms({ ...base, grossAmountMinor: 999_999 }),
    null,
  );
});

test("activation manifest remains fail closed", () => {
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.automaticPricingAllowed, false);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.paymentProviderConnected, false);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.externalMessagingConnected, false);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.autonomousWorkAllowed, false);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.routeMounted, true);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.navigationMounted, true);
  assert.equal(COMMERCIAL_RETAINER_MANIFEST.openApiPublished, true);
});

test("Drizzle adapter keeps tenant, direct authority, project locks and maker-checker gates explicit", async () => {
  const source = await readFile(
    new URL("./drizzleRepository.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /withTenantDatabase\(scope\.organisationId/u);
  assert.match(
    source,
    /isNull\(organisationMemberships\.delegatedByMembershipId\)/u,
  );
  assert.match(source, /eq\(organisations\.status, "active"\)/u);
  assert.match(source, /eq\(users\.status, "active"\)/u);
  assert.match(source, /isNull\(roleGrants\.revokedAt\)/u);
  assert.match(source, /lte\(roleGrants\.startsAt, now\)/u);
  assert.match(source, /gt\(roleGrants\.expiresAt, now\)/u);
  assert.match(source, /hasCommercialAuthority\(roles, input\.action\)/u);
  assert.match(
    source,
    /const MUTABLE_PROJECT_STATUSES = new Set\(\[[\s\S]*?"reporting",[\s\S]*?\]\);/u,
  );
  assert.match(
    source,
    /async approveQuote[\s\S]*?lockMutableProject\([\s\S]*?requireActor\([\s\S]*?"quote:approve"/u,
  );
  assert.match(
    source,
    /async createInvoice[\s\S]*?orderProbe[\s\S]*?lockMutableProject\([\s\S]*?"invoice:create"/u,
  );
  assert.match(
    source,
    /async recordPayment[\s\S]*?invoiceContexts[\s\S]*?lockMutableProject\([\s\S]*?"payment:record"/u,
  );
  assert.match(
    source,
    /async verifyPayment[\s\S]*?paymentContexts[\s\S]*?lockMutableProject\([\s\S]*?"payment:verify"/u,
  );
  assert.match(
    source,
    /async mutateRetainerRequest[\s\S]*?taskProbe[\s\S]*?lockMutableProject\([\s\S]*?"retainer:use"/u,
  );
  assert.match(source, /current\.placedByUserId === scope\.actorUserId/u);
  assert.match(source, /actors\.recordedByUserId === scope\.actorUserId/u);
  assert.match(source, /eq\(payments\.version, payment\.version\)/u);
  assert.match(source, /pg_advisory_xact_lock/u);
  assert.match(source, /existing\.providerReference !== providerReference/u);
  assert.match(source, /replay\.entitlementId !== command\.entitlementId/u);
  assert.match(source, /providerConnected: false/u);
  assert.match(source, /paymentState: "verified_manual"/u);
  const detailsStart = source.indexOf("const details: QuoteAuditDetails");
  const detailsEnd = source.indexOf("await writeAuditTx", detailsStart);
  assert.ok(detailsStart >= 0 && detailsEnd > detailsStart);
  const immutableQuoteDetails = source.slice(detailsStart, detailsEnd);
  assert.match(immutableQuoteDetails, /customerReferenceSha256/u);
  assert.match(immutableQuoteDetails, /scopeSummarySha256/u);
  assert.doesNotMatch(
    immutableQuoteDetails,
    /customerReference:\s*terms\.customerReference/u,
  );
  assert.doesNotMatch(
    immutableQuoteDetails,
    /scopeSummary:\s*terms\.scopeSummary/u,
  );
});
