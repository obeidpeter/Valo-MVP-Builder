import assert from "node:assert/strict";
import test from "node:test";
import { AiGatewayError } from "./aiGateway";
import { aiGatewayHttpStatus } from "./aiHttp";
import { ModelInputTooLargeError } from "./sourceGrounding";

test("AI HTTP mapping distinguishes validation, capacity and provider failures", () => {
  assert.equal(
    aiGatewayHttpStatus(new AiGatewayError("AI_INPUT_LIMIT_EXCEEDED")),
    422,
  );
  assert.equal(
    aiGatewayHttpStatus(new AiGatewayError("AI_BUDGET_EXCEEDED")),
    429,
  );
  assert.equal(
    aiGatewayHttpStatus(new AiGatewayError("AI_OUTPUT_SCHEMA_INVALID")),
    502,
  );
  assert.equal(
    aiGatewayHttpStatus(new AiGatewayError("AI_GLOBAL_DISABLED")),
    503,
  );
  assert.equal(aiGatewayHttpStatus(new AiGatewayError("AI_CANCELLED")), 499);
});

test("source-corpus overflow retains its explicit safe code", async () => {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const { sendAiGatewayError } = await import("./aiHttp");
  assert.equal(
    sendAiGatewayError(
      response as never,
      new ModelInputTooLargeError(61_000, 60_000),
    ),
    true,
  );
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.body, {
    error:
      "Selected source corpus is 61000 characters; the safe limit is 60000. No model output was produced. Narrow the document selection or use a versioned chunking workflow.",
    code: "AI_SOURCE_CORPUS_TOO_LARGE",
    actualChars: 61_000,
    maxChars: 60_000,
  });
});
