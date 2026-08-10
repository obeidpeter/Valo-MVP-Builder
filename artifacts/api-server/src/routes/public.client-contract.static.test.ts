import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { SubmitBidAutopsyRequestBody } from "@workspace/api-zod";

const openApi = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);
const generatedReactClient = readFileSync(
  new URL(
    "../../../../lib/api-client-react/src/generated/api.ts",
    import.meta.url,
  ),
  "utf8",
);
const generatedZodClient = readFileSync(
  new URL("../../../../lib/api-zod/src/generated/api.ts", import.meta.url),
  "utf8",
);

describe("public intake generated-client contract", () => {
  test("requires and transmits the stable idempotency key", () => {
    assert.match(
      openApi,
      /\/public\/bid-autopsy-requests:[\s\S]*?name: Idempotency-Key[\s\S]*?in: header[\s\S]*?required: true/,
    );
    assert.match(
      generatedReactClient,
      /submitBidAutopsyRequest = async \([\s\S]*?idempotencyKey: string,[\s\S]*?headers: \{[\s\S]*?'Idempotency-Key': idempotencyKey/,
    );
    assert.match(
      generatedReactClient,
      /UseMutationOptions<[\s\S]*?idempotencyKey: string[\s\S]*?submitBidAutopsyRequest\(data,idempotencyKey,requestOptions\)/,
    );
    assert.match(
      generatedZodClient,
      /SubmitBidAutopsyRequestHeader = zod\.object\(\{[\s\S]*?"Idempotency-Key": zod\.string\(\)\.uuid\(\)/,
    );
  });

  test("enforces the closed consent-bearing request body", () => {
    assert.match(
      openApi,
      /BidAutopsyRequestCreate:[\s\S]*?additionalProperties: false[\s\S]*?privacyNoticeAcknowledged:[\s\S]*?const: true/,
    );
    assert.match(
      generatedZodClient,
      /SubmitBidAutopsyRequestBody = zod\.object\(\{[\s\S]*?"privacyNoticeAcknowledged": zod\.literal\(true\)[\s\S]*?\}\)\.strict\(\)/,
    );

    const validBody = {
      contactName: "Ada Reviewer",
      companyName: "Example Limited",
      businessEmail: "ada@example.test",
      businessTelephone: "+234 800 000 0000",
      tenderCategory: "other",
      bidStage: "draft",
      preferredContactMethod: "email",
      privacyNoticeAcknowledged: true,
      formStartedAt: "2026-08-10T12:00:00.000Z",
    } as const;

    assert.equal(
      SubmitBidAutopsyRequestBody.safeParse(validBody).success,
      true,
    );
    assert.equal(
      SubmitBidAutopsyRequestBody.safeParse({
        ...validBody,
        privacyNoticeAcknowledged: false,
      }).success,
      false,
    );
    assert.equal(
      SubmitBidAutopsyRequestBody.safeParse({
        ...validBody,
        unexpectedField: "must not be stripped",
      }).success,
      false,
    );
  });
});
