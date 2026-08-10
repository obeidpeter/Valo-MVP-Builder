import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredOpenAiBaseUrlApproved,
  configuredOpenAiDataGovernance,
  openAiResponseFormat,
} from "./openAiModelAdapter";

test("production endpoint approval is exact and rejects arbitrary proxy URLs", () => {
  const approved = "https://approved.example.invalid/openai/v1";
  assert.equal(
    configuredOpenAiBaseUrlApproved({
      AI_INTEGRATIONS_OPENAI_BASE_URL: approved,
      OPENAI_ADAPTER_APPROVED_BASE_URL: `${approved}/`,
    }),
    true,
  );
  assert.equal(
    configuredOpenAiBaseUrlApproved({
      AI_INTEGRATIONS_OPENAI_BASE_URL: "https://attacker.example.invalid/v1",
      OPENAI_ADAPTER_APPROVED_BASE_URL: approved,
    }),
    false,
  );
  assert.equal(
    configuredOpenAiBaseUrlApproved({
      AI_INTEGRATIONS_OPENAI_BASE_URL: `${approved}?redirect=1`,
      OPENAI_ADAPTER_APPROVED_BASE_URL: approved,
    }),
    false,
  );
  assert.equal(
    configuredOpenAiBaseUrlApproved({
      AI_INTEGRATIONS_OPENAI_BASE_URL: "http://approved.example.invalid/v1",
      OPENAI_ADAPTER_APPROVED_BASE_URL: "http://approved.example.invalid/v1",
    }),
    false,
  );
});

test("OpenAI governance defaults to unverified and Restricted Mode stays forbidden", () => {
  assert.deepEqual(configuredOpenAiDataGovernance({}), {
    externallyHosted: true,
    noTrainingVerified: false,
    retentionMode: "unknown",
    maxRetentionDays: null,
    regions: [],
    dpaApproved: false,
    restrictedModeEligible: false,
    evidenceVersion: null,
  });
});

test("OpenAI governance is derived only from explicit reviewed metadata", () => {
  assert.deepEqual(
    configuredOpenAiDataGovernance({
      OPENAI_ADAPTER_NO_TRAINING_VERIFIED: "true",
      OPENAI_ADAPTER_DPA_APPROVED: "true",
      OPENAI_ADAPTER_RETENTION_MODE: "bounded",
      OPENAI_ADAPTER_RETENTION_DAYS: "7",
      OPENAI_ADAPTER_APPROVED_REGIONS: " ZA,ng,NG ",
      OPENAI_ADAPTER_GOVERNANCE_EVIDENCE_VERSION: " legal-v4 ",
    }),
    {
      externallyHosted: true,
      noTrainingVerified: true,
      retentionMode: "bounded",
      maxRetentionDays: 7,
      regions: ["ng", "za"],
      dpaApproved: true,
      restrictedModeEligible: false,
      evidenceVersion: "legal-v4",
    },
  );
  assert.equal(
    configuredOpenAiDataGovernance({
      OPENAI_ADAPTER_RETENTION_MODE: "bounded",
      OPENAI_ADAPTER_RETENTION_DAYS: "not-a-number",
    }).maxRetentionDays,
    null,
  );
});

test("gateway schemas become strict OpenAI Structured Outputs without mutation", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { review: { type: "string" } },
    required: ["review"],
  } as const;
  assert.deepEqual(
    openAiResponseFormat({ name: "responsiveness_v1", strict: true, schema }),
    {
      type: "json_schema",
      json_schema: {
        name: "responsiveness_v1",
        strict: true,
        schema,
      },
    },
  );
  assert.deepEqual(openAiResponseFormat(undefined), { type: "json_object" });
});
