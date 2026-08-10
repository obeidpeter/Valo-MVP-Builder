import { readFileSync, writeFileSync } from "node:fs";

const generatedClientPath = new URL(
  "../api-client-react/src/generated/api.ts",
  import.meta.url,
);
const generatedSchemasPath = new URL(
  "../api-client-react/src/generated/api.schemas.ts",
  import.meta.url,
);
const generatedZodPath = new URL(
  "../api-zod/src/generated/api.ts",
  import.meta.url,
);

function withTrailingLineFeeds(source, count) {
  return source.replace(/(?:\r?\n)*$/, "\n".repeat(count));
}
const startMarker = "export const submitBidAutopsyRequest = async";
const endMarker = "export const getGetMeUrl";
const generatedClient = readFileSync(generatedClientPath, "utf8");
const start = generatedClient.indexOf(startMarker);
const end = generatedClient.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error("Generated Bid Autopsy operation markers were not found");
}

let operation = generatedClient.slice(start, end);

function replaceExact(search, replacement, expectedCount = 1) {
  const count = operation.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `Generated Bid Autopsy client drifted: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
    );
  }
  operation = operation.split(search).join(replacement);
}

replaceExact(
  "export const submitBidAutopsyRequest = async (bidAutopsyRequestCreate: BidAutopsyRequestCreate, options?: RequestInit)",
  "export const submitBidAutopsyRequest = async (bidAutopsyRequestCreate: BidAutopsyRequestCreate, idempotencyKey: string, options?: RequestInit)",
);
replaceExact(
  "headers: { 'Content-Type': 'application/json', ...options?.headers },",
  "headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...options?.headers },",
);
replaceExact(
  "{data: BodyType<BidAutopsyRequestCreate>}",
  "{data: BodyType<BidAutopsyRequestCreate>; idempotencyKey: string}",
  5,
);
replaceExact(
  "const {data} = props ?? {};",
  "const {data, idempotencyKey} = props ?? {};",
);
replaceExact(
  "submitBidAutopsyRequest(data,requestOptions)",
  "submitBidAutopsyRequest(data,idempotencyKey,requestOptions)",
);

writeFileSync(
  generatedClientPath,
  withTrailingLineFeeds(
    generatedClient.slice(0, start) + operation + generatedClient.slice(end),
    5,
  ),
);

const generatedZod = readFileSync(generatedZodPath, "utf8");
const zodStartMarker =
  "export const SubmitBidAutopsyRequestBody = zod.object({";
const zodEndMarker = "export const SubmitBidAutopsyRequestResponse";
const zodStart = generatedZod.indexOf(zodStartMarker);
const zodEnd = generatedZod.indexOf(zodEndMarker, zodStart);

if (zodStart < 0 || zodEnd < 0) {
  throw new Error("Generated Bid Autopsy Zod schema markers were not found");
}

let requestBodySchema = generatedZod.slice(zodStart, zodEnd);

function replaceZodExact(search, replacement, expectedCount = 1) {
  const count = requestBodySchema.split(search).length - 1;
  if (count !== expectedCount) {
    throw new Error(
      `Generated Bid Autopsy Zod schema drifted: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
    );
  }
  requestBodySchema = requestBodySchema.split(search).join(replacement);
}

replaceZodExact(
  '"privacyNoticeAcknowledged": zod.boolean(),',
  '"privacyNoticeAcknowledged": zod.literal(true),',
);
replaceZodExact("\n})\n\n", "\n}).strict()\n\n");

writeFileSync(
  generatedZodPath,
  withTrailingLineFeeds(
    generatedZod.slice(0, zodStart) +
      requestBodySchema +
      generatedZod.slice(zodEnd),
    1,
  ),
);

const generatedSchemas = readFileSync(generatedSchemasPath, "utf8");
writeFileSync(generatedSchemasPath, withTrailingLineFeeds(generatedSchemas, 1));
