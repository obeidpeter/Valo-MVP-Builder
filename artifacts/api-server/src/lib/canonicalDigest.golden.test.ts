import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canonicalJsonCodeUnit,
  canonicalJsonLocale,
  canonicalJsonStrict,
  sha256Hex,
} from "./canonicalDigest";
import { canonicalJson as claimsDeskCanonicalJson } from "./claimsDesk/service";
import { canonicalEvidenceRenewalJson } from "./evidenceRenewal/service";
import { storageLifecycleSha256 } from "./storageLifecycle/contracts";
import { hashOpportunityPursuitHandoff } from "./opportunityPursuitHandoff/service";

/**
 * Golden pins for the three canonical-JSON dialects. The serialized bytes
 * feed sha256 digests persisted in audit ledgers, so these outputs are a
 * compatibility contract: any change to a pinned string here is a breaking
 * change to persisted digests and must never happen silently.
 */
const FIXTURE = {
  zulu: 1,
  Alpha: "two",
  éclair: [3, { nested: true, Ångström: null }],
  amount: "12.50",
} as const;

const LOCALE_GOLDEN =
  '{"Alpha":"two","amount":"12.50","éclair":[3,{"Ångström":null,"nested":true}],"zulu":1}';
const CODE_UNIT_GOLDEN =
  '{"Alpha":"two","amount":"12.50","zulu":1,"éclair":[3,{"nested":true,"Ångström":null}]}';

describe("canonical digest dialect goldens", () => {
  test("locale dialect output is pinned", () => {
    assert.equal(canonicalJsonLocale(FIXTURE), LOCALE_GOLDEN);
    assert.equal(
      sha256Hex(LOCALE_GOLDEN),
      "d79a191253185022dd5c65492b690b94749ea8649000c10f205b0ce244359b1b",
    );
  });

  test("code-unit dialect output is pinned", () => {
    assert.equal(canonicalJsonCodeUnit(FIXTURE), CODE_UNIT_GOLDEN);
    assert.equal(
      sha256Hex(CODE_UNIT_GOLDEN),
      "e21585e2849b3d2358eead4ad3b27507c7dae20f167269fd18c17fe22a87faa1",
    );
  });

  test("strict dialect matches code-unit order and rejects non-JSON values", () => {
    assert.equal(
      canonicalJsonStrict(FIXTURE, () => {
        throw new Error("unreachable");
      }),
      CODE_UNIT_GOLDEN,
    );
    class Invalid extends Error {}
    assert.throws(
      () =>
        canonicalJsonStrict({ fine: 1, bad: undefined }, () => {
          throw new Invalid("invalid");
        }),
      Invalid,
    );
  });

  test("the dialects deliberately diverge on non-ASCII keys", () => {
    assert.notEqual(LOCALE_GOLDEN, CODE_UNIT_GOLDEN);
  });

  test("vertical wrappers stay bound to their historical dialect", () => {
    assert.equal(claimsDeskCanonicalJson(FIXTURE), LOCALE_GOLDEN);
    assert.equal(canonicalEvidenceRenewalJson(FIXTURE), LOCALE_GOLDEN);
    assert.equal(storageLifecycleSha256(FIXTURE), sha256Hex(CODE_UNIT_GOLDEN));
    assert.equal(
      hashOpportunityPursuitHandoff(FIXTURE),
      sha256Hex(CODE_UNIT_GOLDEN),
    );
  });
});
