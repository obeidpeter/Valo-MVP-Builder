import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  AI_RETRIEVAL_REGISTRY_REQUIREMENTS,
  RETRIEVAL_REGISTRY_BLOCKER,
  attestDeployedRetrievalRegistry,
} from "./aiRetrievalRegistry";

const registrySource = readFileSync(
  new URL("./aiRetrievalRegistry.ts", import.meta.url),
  "utf8",
);
const runtimeSource = readFileSync(
  new URL("./aiRuntime.ts", import.meta.url),
  "utf8",
);

describe("deployed retrieval registry attestation", () => {
  test("attests unavailable with every named requirement unmet", () => {
    const attestation = attestDeployedRetrievalRegistry();
    assert.equal(attestation.available, false);
    if (attestation.available) return;
    assert.equal(attestation.blocker, RETRIEVAL_REGISTRY_BLOCKER);
    assert.deepEqual(
      attestation.unmetRequirements.map((requirement) => requirement.code),
      [
        "registry_deployment_absent",
        "tenant_isolation_unattested",
        "content_digest_attestation_absent",
        "version_identity_recomputation_absent",
      ],
    );
    for (const requirement of AI_RETRIEVAL_REGISTRY_REQUIREMENTS) {
      assert.ok(
        requirement.description.length > 40,
        `${requirement.code} needs a substantive description`,
      );
    }
  });

  test("the attestation reads no environment, file, or network input", () => {
    assert.doesNotMatch(
      registrySource,
      /process\.env|readFile|readFileSync|fetch\(|require\(/u,
      "Availability must never be assertable from outside the code",
    );
  });

  test("the runtime consumes only the attestation for retrieval identity", () => {
    assert.match(runtimeSource, /attestDeployedRetrievalRegistry\(\)/u);
    assert.doesNotMatch(
      runtimeSource,
      /DEPLOYED_RETRIEVAL_REGISTRY_AVAILABLE|VALO_AI_RETRIEVAL_VERSION|VALO_AI_INDEX_VERSION/u,
      "No boolean constant or operator label may reappear beside the attestation",
    );
  });
});
