import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOpportunitySourceRepository } from "./memoryRepository";
import { OpportunitySourceNetworkService } from "./service";

const scope = {
  organisationId: "11111111-1111-4111-8111-111111111111",
  actorUserId: "22222222-2222-4222-8222-222222222222",
  actorName: "Named Bid Manager",
};

const input = {
  sourceKind: "manual_url" as const,
  sourceSystem: "bpp_nocopo",
  sourceAuthority: "Bureau of Public Procurement",
  sourceLocator: "https://nocopo.bpp.gov.ng/opportunities/NG-2026-0042",
  sourceLicenceReference: "Operator-recorded public notice",
  externalReference: "NG-2026-0042",
  title: "Supply and installation of equipment",
  procuringEntity: "Representative procuring entity",
  jurisdiction: "NG",
  fundingSource: null,
  procurementCategory: "goods",
  publishedAt: "2026-08-01T08:00:00.000Z",
  submissionDeadline: "2026-09-01T12:00:00.000Z",
  observedAt: "2026-08-11T08:00:00.000Z",
  sourceContentSha256: "a".repeat(64),
};

test("manual receipts are canonical, idempotent and require human confirmation", async () => {
  const service = new OpportunitySourceNetworkService(
    new InMemoryOpportunitySourceRepository(),
  );
  const first = await service.recordManual(scope, input);
  const replay = await service.recordManual(scope, input);
  assert.equal(first.id, replay.id);
  assert.equal(first.status, "pending_review");
  assert.equal(first.provenance, "operator_recorded");
  assert.match(first.receiptSha256, /^[0-9a-f]{64}$/u);

  const accepted = await service.decide(scope, first.id, {
    expectedVersion: 1,
    decision: "accept",
    reason: "The named reviewer checked the official notice and deadline.",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.version, 2);
  assert.ok(accepted.tenderId);

  await assert.rejects(
    service.decide(scope, first.id, {
      expectedVersion: 1,
      decision: "reject",
      reason: "A stale replay must fail.",
    }),
    /changed before the decision/u,
  );
});

test("manual acquisition rejects token-bearing locators and feed impersonation", async () => {
  const service = new OpportunitySourceNetworkService(
    new InMemoryOpportunitySourceRepository(),
  );
  await assert.rejects(
    service.recordManual(scope, {
      ...input,
      sourceLocator: `${input.sourceLocator}?token=secret`,
    }),
    /must not contain credentials, query data or a fragment/u,
  );
  await assert.rejects(
    service.recordManual(scope, { ...input, sourceKind: "licensed_feed" }),
    /manual_url receipts only/u,
  );
});

test("adapter provenance requires an approved production licence boundary", async () => {
  const service = new OpportunitySourceNetworkService(
    new InMemoryOpportunitySourceRepository(),
  );
  await assert.rejects(
    service.recordFromApprovedAdapter(
      scope,
      {
        kind: "licensed_tender_feed",
        provider: "Example",
        mode: "development",
        productionApproved: false,
        licenceEvidenceVersion: null,
      },
      { ...input, sourceKind: "licensed_feed" },
    ),
    /not approved/u,
  );
  const accepted = await service.recordFromApprovedAdapter(
    scope,
    {
      kind: "licensed_tender_feed",
      provider: "Approved source",
      mode: "production",
      productionApproved: true,
      licenceEvidenceVersion: "licence-review-2026-08",
    },
    {
      ...input,
      sourceKind: "ocds",
      externalReference: "ocds-b5fd17-NG-2026-42",
    },
  );
  assert.equal(accepted.provenance, "adapter_verified");
});

test("same source reference with changed metadata fails closed", async () => {
  const service = new OpportunitySourceNetworkService(
    new InMemoryOpportunitySourceRepository(),
  );
  await service.recordManual(scope, input);
  await assert.rejects(
    service.recordManual(scope, { ...input, title: "Changed title" }),
    /different metadata/u,
  );
});
