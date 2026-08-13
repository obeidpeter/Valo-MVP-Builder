import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACTIVATION_STATUS_INVENTORY,
  ACTIVATION_WIRING_INVENTORY,
  externalEffectViolations,
} from "./activationInventory";

describe("activation status inventory", () => {
  test("every declaration is frozen and non-empty", () => {
    for (const [vertical, status] of Object.entries({
      ...ACTIVATION_STATUS_INVENTORY,
      ...ACTIVATION_WIRING_INVENTORY,
    })) {
      assert.ok(Object.isFrozen(status), `${vertical} must be frozen`);
      assert.ok(
        Object.keys(status).length > 0,
        `${vertical} must declare at least one flag`,
      );
    }
  });

  test("no vertical claims an external effect, autonomy, or production activation", () => {
    assert.deepEqual(
      externalEffectViolations(),
      [],
      "The cross-wave release rule forbids inferring provider calls, " +
        "scraping, production AI activation or autonomous action from an " +
        "implemented evidence workflow. Activating one requires a deliberate " +
        "review of both the vertical and this inventory.",
    );
  });

  test("named-human authority strings stay explicit where declared", () => {
    for (const [vertical, status] of Object.entries(
      ACTIVATION_STATUS_INVENTORY,
    )) {
      const authority = (status as Record<string, unknown>).authority;
      if (authority !== undefined) {
        assert.match(
          String(authority),
          /named_human/u,
          `${vertical} declares an authority that is not a named human`,
        );
      }
    }
  });
});
