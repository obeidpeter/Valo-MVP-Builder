import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { verifyCommercialBoq } from "../boqVerifier";
import { NG_COMMERCIAL_BOQ_RULE_PACK } from "./contracts";
import {
  buildWorkbookManifest,
  parseBoqExceptionResolutionDraft,
  parseBoqRunDraft,
  summariseResultStatus,
} from "./service";

const DOCUMENT = "60000000-0000-4000-8000-000000000006";

function cleanDraftBody(): Record<string, unknown> {
  return {
    documentId: DOCUMENT,
    lines: [
      {
        id: "A1",
        lotId: "lot-1",
        currency: "NGN",
        quantity: "100",
        unitRate: "40.00",
        displayedExtension: "4000.00",
      },
    ],
    lots: [
      {
        lotId: "lot-1",
        currency: "NGN",
        declaredNet: "4000.00",
        discountRateBasisPoints: 0,
        declaredDiscount: "0.00",
        declaredTaxableBase: "4000.00",
        vatRateBasisPoints: 750,
        declaredVat: "300.00",
        declaredGross: "4300.00",
        declaredNetPayable: "4300.00",
      },
    ],
  };
}

describe("BOQ verification request parsing", () => {
  test("accepts a bounded well-formed run request", () => {
    const draft = parseBoqRunDraft(cleanDraftBody());
    assert.ok(draft);
    assert.equal(draft.lines.length, 1);
    assert.equal(draft.lots.length, 1);
    assert.equal(draft.lines[0]?.hidden, false);
  });

  test("rejects structural and identity violations fail-closed", () => {
    assert.equal(parseBoqRunDraft(null), null);
    assert.equal(parseBoqRunDraft({}), null);
    for (const mutate of [
      (body: Record<string, unknown>) => {
        body.documentId = "not-a-uuid";
      },
      (body: Record<string, unknown>) => {
        body.lines = [];
      },
      (body: Record<string, unknown>) => {
        // A line pointing at an undeclared lot escapes reconciliation.
        (body.lines as Record<string, unknown>[])[0]!.lotId = "lot-9";
      },
      (body: Record<string, unknown>) => {
        (body.lines as Record<string, unknown>[])[0]!.quantity = "1e5";
      },
      (body: Record<string, unknown>) => {
        (body.lines as Record<string, unknown>[])[0]!.quantity = "1,000";
      },
      (body: Record<string, unknown>) => {
        (body.lots as Record<string, unknown>[])[0]!.vatRateBasisPoints = 750.5;
      },
      (body: Record<string, unknown>) => {
        (body.lots as Record<string, unknown>[])[0]!.currency = "ngn";
      },
      (body: Record<string, unknown>) => {
        body.lines = [
          (body.lines as Record<string, unknown>[])[0],
          (body.lines as Record<string, unknown>[])[0],
        ];
      },
      (body: Record<string, unknown>) => {
        (body.lots as Record<string, unknown>[])[0]!.bidSecurity = {
          rateBasisPoints: 200,
          basis: "grand",
          declaredAmount: "80.00",
        };
      },
    ]) {
      const body = cleanDraftBody();
      mutate(body);
      assert.equal(parseBoqRunDraft(body), null);
    }
  });

  test("the rule policy can never be supplied by the request", () => {
    const body = cleanDraftBody();
    body.policy = {
      rulePackId: "attacker/v9",
      currencyMinorDigits: { NGN: 0 },
      permittedRoundingMinor: "1000000",
      vatRateBasisPointsByCurrency: { NGN: 0 },
      whtEnabled: true,
      whtRateBasisPoints: 0,
    };
    const draft = parseBoqRunDraft(body);
    assert.ok(draft);
    assert.equal("policy" in draft, false);
  });
});

describe("BOQ verification kernel integration", () => {
  test("a clean parsed draft passes under the pinned NG rule pack", () => {
    const draft = parseBoqRunDraft(cleanDraftBody());
    assert.ok(draft);
    const result = verifyCommercialBoq({
      lines: [...draft.lines],
      lots: [...draft.lots],
      policy: NG_COMMERCIAL_BOQ_RULE_PACK,
    });
    assert.equal(result.passed, true);
    assert.equal(result.policyVersion, "ng-commercial-boq/v1");
    assert.deepEqual(result.computedLotTotalsMinor, { "lot-1": "400000" });
    assert.equal(summariseResultStatus(result), "passed");
  });

  test("declared WHT raises wht_rule_disabled until legal sign-off", () => {
    const body = cleanDraftBody();
    const lot = (body.lots as Record<string, unknown>[])[0]!;
    lot.whtRateBasisPoints = 500;
    lot.declaredWht = "200.00";
    lot.declaredNetPayable = "4100.00";
    const draft = parseBoqRunDraft(body);
    assert.ok(draft);
    const result = verifyCommercialBoq({
      lines: [...draft.lines],
      lots: [...draft.lots],
      policy: NG_COMMERCIAL_BOQ_RULE_PACK,
    });
    assert.equal(result.passed, false);
    assert.ok(
      result.exceptions.some(
        (exception) => exception.code === "wht_rule_disabled",
      ),
    );
    assert.equal(summariseResultStatus(result), "exceptions_recorded");
  });

  test("a seeded arithmetic defect is recorded with exact minor amounts", () => {
    const body = cleanDraftBody();
    (body.lines as Record<string, unknown>[])[0]!.displayedExtension =
      "4001.00";
    const draft = parseBoqRunDraft(body);
    assert.ok(draft);
    const result = verifyCommercialBoq({
      lines: [...draft.lines],
      lots: [...draft.lots],
      policy: NG_COMMERCIAL_BOQ_RULE_PACK,
    });
    const mismatch = result.exceptions.find(
      (exception) => exception.code === "extension_mismatch",
    );
    assert.ok(mismatch);
    assert.equal(mismatch.expectedMinor, "400000");
    assert.equal(mismatch.actualMinor, "400100");
  });
});

describe("workbook manifest", () => {
  test("is deterministic and content-addressed", () => {
    const draft = parseBoqRunDraft(cleanDraftBody());
    assert.ok(draft);
    const manifest = buildWorkbookManifest({
      documentId: DOCUMENT,
      documentVersionId: "70000000-0000-4000-8000-000000000007",
      documentSha256: "a".repeat(64),
      draft,
    });
    const again = buildWorkbookManifest({
      documentId: DOCUMENT,
      documentVersionId: "70000000-0000-4000-8000-000000000007",
      documentSha256: "a".repeat(64),
      draft,
    });
    assert.equal(manifest, again);
    const parsed = JSON.parse(manifest) as Record<string, unknown>;
    assert.equal(parsed.schema, "valo.boq-workbook-manifest/v1");
    assert.equal(parsed.lineCount, 1);
    assert.match(String(parsed.figuresSha256), /^[0-9a-f]{64}$/u);
    // The manifest records identity and digests, never the figures.
    assert.doesNotMatch(manifest, /4000\.00|40\.00/u);
  });
});

describe("exception resolution parsing", () => {
  test("accepts bounded resolved/waived decisions and rejects the rest", () => {
    assert.deepEqual(
      parseBoqExceptionResolutionDraft({
        status: "waived",
        reason: "  Client confirmed rounding convention in addendum 2. ",
      }),
      {
        status: "waived",
        reason: "Client confirmed rounding convention in addendum 2.",
      },
    );
    assert.equal(
      parseBoqExceptionResolutionDraft({ status: "open", reason: "x" }),
      null,
    );
    assert.equal(
      parseBoqExceptionResolutionDraft({ status: "resolved", reason: "   " }),
      null,
    );
    assert.equal(
      parseBoqExceptionResolutionDraft({
        status: "resolved",
        reason: "y".repeat(501),
      }),
      null,
    );
  });
});
