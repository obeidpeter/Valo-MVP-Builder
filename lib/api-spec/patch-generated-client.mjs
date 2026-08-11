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

let generatedZod = readFileSync(generatedZodPath, "utf8");
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

generatedZod =
  generatedZod.slice(0, zodStart) +
  requestBodySchema +
  generatedZod.slice(zodEnd);

function patchZodBlock(startMarker, endMarker, patch) {
  const start = generatedZod.indexOf(startMarker);
  const end = generatedZod.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error(
      `Generated Zod operation markers were not found for ${startMarker}`,
    );
  }
  const source = generatedZod.slice(start, end);
  const replacement = patch(source);
  if (replacement === source) {
    throw new Error(
      `Generated Zod operation was not patched for ${startMarker}`,
    );
  }
  generatedZod =
    generatedZod.slice(0, start) + replacement + generatedZod.slice(end);
}

function replaceZodBlockExact(startMarker, endMarker, replacements) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    for (const [search, replacement, expectedCount = 1] of replacements) {
      const count = operation.split(search).length - 1;
      if (count !== expectedCount) {
        throw new Error(
          `Generated Zod contract drifted for ${startMarker}: expected ${expectedCount} occurrence(s) of ${JSON.stringify(search)}, found ${count}`,
        );
      }
      operation = operation.split(search).join(replacement);
    }
    return operation;
  });
}

replaceZodBlockExact(
  "export const ListProjectPackageVersionsResponse = zod.object({",
  "export const ExportProjectParams",
  [
    ['"limit": zod.number(),', '"limit": zod.literal(100),'],
    [
      "}).describe('Metadata-only identity for the current canonical project-export package version. Archive contents and storage locations are excluded.')).max",
      "}).strict().describe('Metadata-only identity for the current canonical project-export package version. Archive contents and storage locations are excluded.')).max",
    ],
    ["\n})\n\n", "\n}).strict()\n\n"],
  ],
);

replaceZodBlockExact(
  "export const ListGrowthLeadsResponse = zod.object({",
  "export const MutateGrowthLeadParams",
  [
    [
      '"contactDataIncluded": zod.boolean(),',
      '"contactDataIncluded": zod.literal(false),',
    ],
  ],
);

replaceZodBlockExact(
  "export const MutateGrowthLeadBody = zod.union([zod.object({",
  "export const mutateGrowthLeadResponseItemIdMax",
  [
    [
      '"assigneeUserId": zod.string().min(1).max(mutateGrowthLeadBodyOneAssigneeUserIdMax)\n}),zod.union',
      '"assigneeUserId": zod.string().min(1).max(mutateGrowthLeadBodyOneAssigneeUserIdMax)\n}).strict(),zod.union',
    ],
    [
      '"reason": zod.string().min(1).max(mutateGrowthLeadBodyTwoOneReasonMax)\n}),zod.object',
      '"reason": zod.string().min(1).max(mutateGrowthLeadBodyTwoOneReasonMax)\n}).strict(),zod.object',
    ],
    [
      '"receiptSha256": zod.string().regex(mutateGrowthLeadBodyTwoTwoReceiptSha256RegExp)\n})]),zod.object',
      '"receiptSha256": zod.string().regex(mutateGrowthLeadBodyTwoTwoReceiptSha256RegExp)\n}).strict()]),zod.object',
    ],
    [
      '"slaDueAt": zod.coerce.date()\n}),zod.object',
      '"slaDueAt": zod.coerce.date()\n}).strict(),zod.object',
    ],
    [
      '"rationale": zod.string().min(1).max(mutateGrowthLeadBodyFourRationaleMax)\n})])',
      '"rationale": zod.string().min(1).max(mutateGrowthLeadBodyFourRationaleMax)\n}).strict()])',
    ],
  ],
);

replaceZodBlockExact(
  "export const OpenGrowthLeadContactHandoffBody = zod.object({",
  "export const openGrowthLeadContactHandoffResponseHandoffOneLeadIdMax",
  [["\n})\n\n", "\n}).strict()\n\n"]],
);

replaceZodBlockExact(
  "export const OpenGrowthLeadContactHandoffResponse = zod.object({",
  "export const listGrowthQuotesQueryLimitDefault",
  [
    [
      '"contactDataIncluded": zod.boolean(),',
      '"contactDataIncluded": zod.literal(true),',
    ],
    [
      '"version": zod.number().min(1)\n}),zod.object',
      '"version": zod.number().min(1)\n}).strict(),zod.object',
    ],
    [
      '"version": zod.number().min(1)\n})]).describe',
      '"version": zod.number().min(1)\n}).strict()]).describe',
    ],
    ["\n})\n\n", "\n}).strict()\n\n"],
  ],
);

patchZodBlock(
  "export const GetOperationsMobileQueueResponse = zod.object({",
  "export const GetOperationsRecordParams",
  (operation) => {
    const replacements = [
      [
        '"restrictedContent": zod.boolean(),',
        '"restrictedContent": zod.literal(true),',
      ],
      ['"maxItems": zod.number(),', '"maxItems": zod.literal(250),'],
      [
        '"restrictedContent": zod.boolean()\n}))',
        '"restrictedContent": zod.literal(true)\n}))',
      ],
    ];
    for (const [search, replacement] of replacements) {
      const count = operation.split(search).length - 1;
      if (count !== 1) {
        throw new Error(
          `Generated mobile-queue Zod contract drifted: expected one ${JSON.stringify(search)}, found ${count}`,
        );
      }
      operation = operation.replace(search, replacement);
    }
    return operation;
  },
);

function requireCancellationReason(startMarker, endMarker, statusField) {
  patchZodBlock(startMarker, endMarker, (operation) => {
    const end = operation.lastIndexOf("}))");
    if (end < 0) {
      throw new Error(
        `Generated cancellation Zod contract drifted for ${startMarker}`,
      );
    }
    return `${operation.slice(0, end + 3)}.superRefine((value, context) => {
  if (value.${statusField} === "cancelled" && !value.reason) {
    context.addIssue({
      code: zod.ZodIssueCode.custom,
      path: ["reason"],
      message: "reason is required when status is cancelled",
    });
  }
})${operation.slice(end + 3)}`;
  });
}

requireCancellationReason(
  "export const UpdateOperationsWorkItemBody =",
  "export const updateOperationsWorkItemResponseTwoTitleMax",
  "status",
);
requireCancellationReason(
  "export const AdvanceOperationsSubmissionWarRoomBody =",
  "export const advanceOperationsSubmissionWarRoomResponseTwoManifestSha256RegExp",
  "toStatus",
);
requireCancellationReason(
  "export const UpdateOperationsMissionBody =",
  "export const updateOperationsMissionResponseTwoTitleMax",
  "status",
);
requireCancellationReason(
  "export const UpdateOperationsPostAwardItemBody =",
  "export const updateOperationsPostAwardItemResponseTwoTitleMax",
  "status",
);

writeFileSync(generatedZodPath, withTrailingLineFeeds(generatedZod, 1));

const generatedSchemas = readFileSync(generatedSchemasPath, "utf8");
writeFileSync(generatedSchemasPath, withTrailingLineFeeds(generatedSchemas, 1));
