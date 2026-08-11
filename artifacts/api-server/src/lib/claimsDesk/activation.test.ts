import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CLAIMS_DESK_ACTIVATION_GATES,
  CLAIMS_DESK_RETENTION_WORK_TASK_LIKE,
  isClaimsDeskReleasedLedgerMutation,
} from "./activation";

describe("Claims Desk activation contract", () => {
  test("permits only the two exact append routes for released projects", () => {
    for (const status of ["signed_off", "exported"]) {
      assert.equal(
        isClaimsDeskReleasedLedgerMutation(
          status,
          "POST",
          "/projects/project-id/claims-desk/records",
        ),
        true,
      );
      assert.equal(
        isClaimsDeskReleasedLedgerMutation(
          status,
          "POST",
          "/projects/project-id/claims-desk/records/record-id/transitions",
        ),
        true,
      );
    }
    assert.equal(
      isClaimsDeskReleasedLedgerMutation(
        "archived",
        "POST",
        "/projects/project-id/claims-desk/records",
      ),
      false,
    );
    assert.equal(
      isClaimsDeskReleasedLedgerMutation(
        "exported",
        "DELETE",
        "/projects/project-id/claims-desk/records/record-id",
      ),
      false,
    );
  });

  test("publishes an honest retention and activation gate", () => {
    assert.equal(CLAIMS_DESK_RETENTION_WORK_TASK_LIKE, "[CLAIMS-DESK:%");
    assert.equal(
      CLAIMS_DESK_ACTIVATION_GATES.signedOffExportedExceptionIntegrated,
      true,
    );
    assert.equal(
      CLAIMS_DESK_ACTIVATION_GATES.retentionSelectorIntegrated,
      true,
    );
  });
});
