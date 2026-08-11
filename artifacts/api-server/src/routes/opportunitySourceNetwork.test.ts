import assert from "node:assert/strict";
import test from "node:test";
import {
  parseManualOpportunitySourceBody,
  parseOpportunitySourceDecisionBody,
} from "../lib/opportunitySourceNetwork/routeParsing";

const validInput = {
  sourceKind: "manual_url",
  sourceSystem: "nocopo",
  sourceAuthority: "Bureau of Public Procurement",
  sourceLocator: "https://nocopo.bpp.gov.ng/opportunities/42",
  sourceLicenceReference: "Public notice",
  externalReference: "NG-42",
  title: "Representative opportunity",
  procuringEntity: "Representative entity",
  jurisdiction: "NG",
  fundingSource: null,
  procurementCategory: "goods",
  publishedAt: null,
  submissionDeadline: null,
  observedAt: "2026-08-11T08:00:00.000Z",
  sourceContentSha256: null,
};

test("manual source route rejects missing and unknown fields", () => {
  assert.ok(parseManualOpportunitySourceBody(validInput));
  assert.equal(
    parseManualOpportunitySourceBody({
      ...validInput,
      rawPayload: "never store me",
    }),
    null,
  );
  const { sourceLocator: _removed, ...missing } = validInput;
  assert.equal(parseManualOpportunitySourceBody(missing), null);
});

test("decision route requires exact optimistic-concurrency input", () => {
  assert.deepEqual(
    parseOpportunitySourceDecisionBody({
      expectedVersion: 1,
      decision: "accept",
      reason: "Checked by the named reviewer.",
    }),
    {
      expectedVersion: 1,
      decision: "accept",
      reason: "Checked by the named reviewer.",
    },
  );
  assert.equal(
    parseOpportunitySourceDecisionBody({
      expectedVersion: 0,
      decision: "accept",
      reason: "Invalid stale version.",
    }),
    null,
  );
});
