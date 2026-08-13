import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXCLUDED_CONTROL_PLANE_PATHS,
  PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS,
  ROADMAP_API_OPERATIONS,
} from "./roadmap-api-parity.manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const specPath = resolve(here, "openapi.yaml");
const routesRoot = resolve(root, "artifacts", "api-server", "src", "routes");
const generatedClientPath = resolve(
  root,
  "lib",
  "api-client-react",
  "src",
  "generated",
  "api.ts",
);
const generatedZodPath = resolve(
  root,
  "lib",
  "api-zod",
  "src",
  "generated",
  "api.ts",
);

function parseOperations(source) {
  const operations = new Map();
  let inPaths = false;
  let currentPath = null;
  let current = null;

  for (const line of source.split(/\r?\n/u)) {
    if (line === "paths:") {
      inPaths = true;
      continue;
    }
    if (inPaths && line === "components:") break;
    if (!inPaths) continue;

    const pathMatch = /^  (\/[^:]+):$/u.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      current = null;
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete|head):$/u.exec(line);
    if (methodMatch && currentPath) {
      current = {
        path: currentPath,
        method: methodMatch[1],
        operationId: null,
        description: null,
        statuses: [],
        privateNoStore: false,
        varyOrganisation: false,
        etag: false,
        public: false,
      };
      operations.set(`${current.method} ${current.path}`, current);
      continue;
    }
    if (!current) continue;

    const operationIdMatch = /^      operationId: (\S+)$/u.exec(line);
    if (operationIdMatch) current.operationId = operationIdMatch[1];
    const descriptionMatch = /^      description: (.+)$/u.exec(line);
    if (descriptionMatch) current.description = descriptionMatch[1];
    const statusMatch = /^        "(\d{3})":/u.exec(line);
    if (statusMatch) current.statuses.push(statusMatch[1]);
    if (line.includes("#/components/headers/PrivateNoStore")) {
      current.privateNoStore = true;
    }
    if (line.includes("#/components/headers/CommercialPrivateNoStore")) {
      current.privateNoStore = true;
    }
    if (line.includes("#/components/headers/VaryOrganisationContext")) {
      current.varyOrganisation = true;
    }
    if (line.includes("#/components/headers/VersionETag")) {
      current.etag = true;
    }
    if (line === "      security: []") current.public = true;
  }
  return operations;
}

function pascalOperationId(operationId) {
  return `${operationId[0].toUpperCase()}${operationId.slice(1)}`;
}

function generatedBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing generated marker ${marker}`);
  const next = source.indexOf("\nexport const ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function schemaBlock(source, name) {
  const marker = `\n    ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing schema ${name}`);
  const remaining = source.slice(start + marker.length);
  const next = remaining.search(/\n    [A-Za-z][A-Za-z0-9]+:\n/u);
  return remaining.slice(0, next === -1 ? undefined : next);
}

function sourceRouteInventory(source) {
  return [...source.matchAll(/router\.(get|post|patch)\(\s*"([^"]+)"/gu)]
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();
}

test("every published OpenAPI operationId is globally unique", () => {
  const spec = readFileSync(specPath, "utf8");
  const operationIds = [...spec.matchAll(/^      operationId: (\S+)$/gmu)].map(
    (match) => match[1],
  );
  assert.ok(operationIds.length > 0);
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("roadmap manifest is unique and publishes exactly the frozen public operations", () => {
  assert.equal(ROADMAP_API_OPERATIONS.length, 62);
  assert.equal(PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS.length, 33);
  const routeKeys = ROADMAP_API_OPERATIONS.map(
    ({ method, path }) => `${method} ${path}`,
  );
  const operationIds = ROADMAP_API_OPERATIONS.map(
    ({ operationId }) => operationId,
  );
  assert.equal(new Set(routeKeys).size, routeKeys.length);
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("OpenAPI route, method, status and privacy contracts match the frozen manifest", () => {
  const spec = readFileSync(specPath, "utf8");
  const parsed = parseOperations(spec);

  for (const expected of ROADMAP_API_OPERATIONS) {
    const key = `${expected.method} ${expected.path}`;
    const actual = parsed.get(key);
    assert.ok(actual, `missing OpenAPI operation ${key}`);
    assert.equal(
      actual.operationId,
      expected.operationId,
      `${key} operationId`,
    );
    assert.deepEqual(
      [...actual.statuses].sort(),
      [...expected.statuses].sort(),
      `${key} statuses`,
    );
    assert.equal(
      actual.privateNoStore,
      expected.privateNoStore,
      `${key} Cache-Control privacy`,
    );
    assert.equal(
      actual.varyOrganisation,
      expected.varyOrganisation,
      `${key} tenant Vary privacy`,
    );
    assert.equal(actual.etag, Boolean(expected.etag), `${key} ETag parity`);
  }
});

test("public readiness publishes exact status, cache and authentication boundaries", () => {
  const parsed = parseOperations(readFileSync(specPath, "utf8"));
  const readiness = parsed.get("get /readyz");
  assert.ok(readiness, "missing OpenAPI operation get /readyz");
  assert.equal(readiness.operationId, "readinessCheck");
  assert.deepEqual(readiness.statuses, ["200", "503"]);
  assert.equal(readiness.privateNoStore, true);
  assert.equal(readiness.varyOrganisation, false);
  assert.equal(readiness.public, true);
});

test("every published operation exists in its mounted route source", () => {
  const sources = new Map();
  for (const operation of ROADMAP_API_OPERATIONS) {
    const source =
      sources.get(operation.source) ??
      readFileSync(resolve(routesRoot, operation.source), "utf8");
    sources.set(operation.source, source);
    assert.ok(
      source.includes(operation.sourcePattern),
      `${operation.operationId} is not present in ${operation.source}`,
    );
  }

  const index = readFileSync(resolve(routesRoot, "index.ts"), "utf8").replace(
    /\s+/gu,
    "",
  );
  for (const mount of [
    "router.use(workInboxRouter)",
    "router.use(canonicalEvidenceOptionsRouter)",
    'router.use("/commercial-retainer",commercialRetainerRouter)',
    "router.use(clientActionPortalRouter)",
    "router.use(clientActionUploadRouter)",
    "router.use(partnerConsortiumRoomRouter)",
    "router.use(reconciledCommunicationsRouter)",
    "router.use(opportunitySourceNetworkRouter)",
    "router.use(opportunityPursuitHandoffRouter)",
    "router.use(evidenceRenewalRouter)",
    "router.use(productionAcceptanceRouter)",
    "router.use(privacyOperationsRouter)",
    "router.use(claimsDeskRouter)",
    "router.use(aiShadowProgrammeRouter)",
  ]) {
    assert.ok(index.includes(mount), `missing guarded route mount ${mount}`);
  }
});

test("Wave 2 route sources expose exactly the frozen public descriptors", () => {
  const opportunity = readFileSync(
    resolve(routesRoot, "opportunityPursuitHandoff.ts"),
    "utf8",
  );
  assert.deepEqual(sourceRouteInventory(opportunity), [
    "get /opportunity-sources/:candidateId/pursuit-handoff",
    "post /opportunity-sources/:candidateId/pursuit-handoff/confirm",
  ]);
  const renewal = readFileSync(
    resolve(routesRoot, "evidenceRenewal.ts"),
    "utf8",
  );
  assert.deepEqual(sourceRouteInventory(renewal), [
    "get /projects/:projectId/evidence-renewals",
    "get /projects/:projectId/evidence-renewals/authorities",
    "post /projects/:projectId/evidence-renewals",
    "post /projects/:projectId/evidence-renewals/:planId/review",
    "post /projects/:projectId/evidence-renewals/:planId/staged-replacement",
  ]);
});

test("governed Client Action upload publishes the exact closed metadata and status boundary", () => {
  const spec = readFileSync(specPath, "utf8");
  const parsed = parseOperations(spec);
  const expected = [
    [
      "post /projects/{id}/client-actions/evidence-requests/{recordId}/slots/{slotId}/upload-leases",
      "issueClientActionUploadLease",
      [
        "200",
        "201",
        "400",
        "401",
        "403",
        "404",
        "409",
        "410",
        "413",
        "500",
        "503",
      ],
    ],
    [
      "post /projects/{id}/client-actions/evidence-requests/{recordId}/slots/{slotId}/upload-leases/{leaseId}/finalize",
      "finalizeClientActionUploadLease",
      [
        "200",
        "201",
        "400",
        "401",
        "403",
        "404",
        "409",
        "410",
        "413",
        "422",
        "500",
        "503",
      ],
    ],
  ];
  for (const [key, operationId, statuses] of expected) {
    const operation = parsed.get(key);
    assert.ok(operation, `missing ${key}`);
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.statuses, statuses);
    assert.equal(operation.privateNoStore, true);
    const start = spec.indexOf(`      operationId: ${operationId}`);
    assert.ok(start >= 0);
    const block = spec.slice(start, spec.indexOf("\n  /", start));
    for (const contract of [
      "ClientActionUploadIdempotencyKey",
      "ClientActionUploadLeaseRequest",
      "x-valo-request-body-max-bytes: 4096",
    ]) {
      assert.ok(block.includes(contract), `${operationId} omits ${contract}`);
    }
    if (operationId === "issueClientActionUploadLease") {
      for (const statement of [
        "server-disabled by default",
        "returns 503",
        "does not activate production use",
      ]) {
        assert.ok(
          block.includes(statement),
          `${operationId} omits ${statement}`,
        );
      }
    }
  }

  const request = schemaBlock(spec, "ClientActionUploadLeaseRequest");
  assert.match(request, /additionalProperties: false/u);
  assert.match(request, /required: \[expectedVersion, intentId\]/u);
  assert.match(request, /maximum: 9007199254740991/u);
  assert.doesNotMatch(request, /(?:rawFile|bytes|content|filename|sha256):/u);

  const grant = schemaBlock(spec, "ClientActionUploadLeaseGrant");
  for (const contract of [
    "lateRewriteClosure",
    "bounded-cushion-and-post-expiry-reconcile",
    "rawFileAcceptedByApi: { type: boolean, const: false }",
    "externalMessageSentByValo: { type: boolean, const: false }",
    "maximum: 52428800",
  ]) {
    assert.ok(grant.includes(contract), `lease grant omits ${contract}`);
  }
  const receipt = schemaBlock(spec, "ClientActionUploadFinalizationReceipt");
  for (const contract of [
    "receiptSha256",
    "extractionStarted: { type: boolean, const: false }",
    "rawFileAcceptedByApi: { type: boolean, const: false }",
    "externalMessageSentByValo: { type: boolean, const: false }",
  ]) {
    assert.ok(
      receipt.includes(contract),
      `finalization receipt omits ${contract}`,
    );
  }
  assert.match(
    spec,
    /ClientActionUploadConflictError:[\s\S]*?enum: \[stale_version, conflict, cleanup_unconfirmed\]/u,
  );
  assert.match(spec, /ClientActionUploadExpiredError:[\s\S]*?const: expired/u);
  assert.match(
    spec,
    /ClientActionUploadIntakeRejectedError:[\s\S]*?const: intake_rejected/u,
  );
  assert.match(
    schemaBlock(spec, "ClientActionUploadGovernedError"),
    /activation: \{ type: string, const: blocked \}[\s\S]*?sideEffectsApplied: \{ type: boolean, const: false \}/u,
  );

  const source = readFileSync(
    resolve(routesRoot, "clientActionUpload.ts"),
    "utf8",
  );
  assert.match(
    source,
    /CLIENT_UPLOAD_REQUEST_BODY_BYTES,[\s\S]*?"client-action"/u,
  );
  assert.match(source, /res\.status\(result\.replayed \? 200 : 201\)/u);
  assert.doesNotMatch(source, /req\.(?:file|files)|\.single\(|\.array\(/u);
  const service = readFileSync(
    resolve(
      root,
      "artifacts",
      "api-server",
      "src",
      "lib",
      "storageLifecycle",
      "clientUpload.ts",
    ),
    "utf8",
  );
  assert.match(service, /rawFileAcceptedByApi: false/u);
  assert.match(service, /externalMessageSentByValo: false/u);
});

test("retention completion truthfully publishes only its fail-closed refusal", () => {
  const spec = readFileSync(specPath, "utf8");
  const operation = parseOperations(spec).get(
    "post /retention-requests/{id}/complete",
  );
  assert.ok(operation);
  assert.equal(operation.operationId, "completeRetentionRequest");
  assert.deepEqual(operation.statuses, ["401", "403", "503"]);
  assert.equal(operation.privateNoStore, true);
  const start = spec.indexOf("      operationId: completeRetentionRequest");
  const block = spec.slice(start, spec.indexOf("\n  /", start));
  assert.match(block, /RetentionCompletionUnavailable/u);
  assert.doesNotMatch(block, /^        "(?:200|404|409|502)":/mu);
  const response = schemaBlock(spec, "RetentionCompletionUnavailable");
  for (const contract of [
    "additionalProperties: false",
    "RETENTION_COMPLETION_NOT_ACTIVATED",
    "sideEffectsApplied: { type: boolean, const: false }",
    "durable_two_phase_detach_reconcile_certify",
    "project_content_rows",
    "object_storage",
    "upload_sessions",
    "storage_lifecycle_control_rows",
    "minItems: 4",
    "maxItems: 4",
    "items: false",
  ]) {
    assert.ok(
      response.includes(contract),
      `retention refusal omits ${contract}`,
    );
  }
});

test("bounded pilots publish their lifetime capacity and retention limits on every operation", () => {
  const parsed = parseOperations(readFileSync(specPath, "utf8"));
  const byOperationId = new Map(
    [...parsed.values()].map((operation) => [operation.operationId, operation]),
  );
  for (const operationId of [
    "listOpportunitySourceCandidates",
    "getOpportunitySourceCandidate",
    "recordManualOpportunitySource",
    "decideOpportunitySourceCandidate",
  ]) {
    const description = byOperationId.get(operationId)?.description ?? "";
    for (const statement of [
      "250 lifetime source receipts per organisation",
      "no in-app archive",
      "reviewed retention/storage migration",
      "audit events must never be deleted",
    ]) {
      assert.ok(
        description.includes(statement),
        `${operationId} omits ${statement}`,
      );
    }
  }
  for (const operationId of [
    "prepareOpportunityPursuitHandoff",
    "confirmOpportunityPursuitHandoff",
  ]) {
    const description = byOperationId.get(operationId)?.description ?? "";
    for (const statement of [
      "250 lifetime handoff receipts per organisation",
      "no in-app archive",
      "reviewed retention/storage migration",
      "audit events must never be deleted",
    ]) {
      assert.ok(
        description.includes(statement),
        `${operationId} omits ${statement}`,
      );
    }
  }
  for (const operationId of [
    "getAiShadowProgramme",
    "createAiShadowPlan",
    "recordAiShadowObservation",
    "closeAiShadowPlan",
  ]) {
    const description = byOperationId.get(operationId)?.description ?? "";
    for (const statement of [
      "no-provider, no-output evidence register",
      "25 lifetime plans per organisation",
      "no in-app archive",
      "never grants production activation",
      "reviewed retention/storage migration",
      "audit events must never be deleted",
    ]) {
      assert.ok(
        description.includes(statement),
        `${operationId} omits ${statement}`,
      );
    }
  }
});

test("generated React and Zod clients contain every public roadmap operation", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");

  for (const operation of ROADMAP_API_OPERATIONS) {
    assert.ok(
      client.includes(`export const ${operation.operationId}`),
      `React client missing ${operation.operationId}`,
    );
    const pascal = pascalOperationId(operation.operationId);
    const response = generatedBlock(zod, `export const ${pascal}Response`);
    assert.ok(
      response.includes(".strict()"),
      `${pascal}Response is not strict`,
    );
    if (operation.method !== "get") {
      const body = generatedBlock(zod, `export const ${pascal}Body`);
      assert.ok(body.includes(".strict()"), `${pascal}Body is not strict`);
    }
  }
});

test("generated Client Action upload bodies, receipts and status literals stay strict", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  for (const operationId of [
    "issueClientActionUploadLease",
    "finalizeClientActionUploadLease",
  ]) {
    assert.ok(
      client.includes(`export const ${operationId}`),
      `React client missing ${operationId}`,
    );
    const pascal = pascalOperationId(operationId);
    const body = generatedBlock(zod, `export const ${pascal}Body`);
    assert.ok(body.includes('"expectedVersion"'));
    assert.ok(body.includes('"intentId"'));
    assert.ok(body.includes(".strict()"));
    const response = generatedBlock(zod, `export const ${pascal}Response`);
    assert.ok(response.includes(".strict()"));
  }
  const lease = generatedBlock(
    zod,
    "export const IssueClientActionUploadLeaseResponse",
  );
  for (const literal of [
    'zod.literal("bounded-cushion-and-post-expiry-reconcile")',
    '"rawFileAcceptedByApi": zod.literal(false)',
    '"externalMessageSentByValo": zod.literal(false)',
    '"replayed": zod.union([zod.literal(true), zod.literal(false)])',
  ]) {
    assert.ok(lease.includes(literal), `lease response widened ${literal}`);
  }
  const finalized = generatedBlock(
    zod,
    "export const FinalizeClientActionUploadLeaseResponse",
  );
  for (const literal of [
    '"extractionStarted": zod.literal(false)',
    '"rawFileAcceptedByApi": zod.literal(false)',
    '"externalMessageSentByValo": zod.literal(false)',
    '"replayed": zod.union([zod.literal(true), zod.literal(false)])',
  ]) {
    assert.ok(
      finalized.includes(literal),
      `finalization response widened ${literal}`,
    );
  }
});

test("generated retention completion exposes only the strict unavailable receipt", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  assert.ok(client.includes("export const completeRetentionRequest"));
  const clientResponse = generatedBlock(
    client,
    "export const completeRetentionRequest = async",
  );
  assert.ok(clientResponse.includes("Promise<RetentionCompletionUnavailable>"));
  assert.ok(
    clientResponse.includes("customFetch<RetentionCompletionUnavailable>"),
  );
  assert.ok(!clientResponse.includes("Promise<unknown>"));
  const response = generatedBlock(
    zod,
    "export const CompleteRetentionRequestResponse",
  );
  for (const literal of [
    '"code": zod.literal("RETENTION_COMPLETION_NOT_ACTIVATED")',
    '"sideEffectsApplied": zod.literal(false)',
    '"requiredWorkflow": zod.literal("durable_two_phase_detach_reconcile_certify")',
    'zod.literal("project_content_rows")',
    'zod.literal("object_storage")',
    'zod.literal("upload_sessions")',
    'zod.literal("storage_lifecycle_control_rows")',
    ".strict()",
  ]) {
    assert.ok(
      response.includes(literal),
      `retention response widened ${literal}`,
    );
  }
  assert.ok(!response.includes('"certificateText"'));
});

test("generated storage dead-letter commands require their CAS header", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  for (const [operationId, endMarker] of [
    [
      "replayStorageDeletionDeadLetter",
      "export const getResolveStorageDeletionDeadLetterUrl",
    ],
    [
      "resolveStorageDeletionDeadLetter",
      "export const getCompleteRetentionRequestUrl",
    ],
  ]) {
    const block = client.slice(
      client.indexOf(`export const ${operationId} = async`),
      client.indexOf(endMarker, client.indexOf(`export const ${operationId}`)),
    );
    assert.ok(block.includes("ifMatch: string"));
    assert.ok(block.includes("'If-Match': ifMatch"));
    assert.ok(block.includes("ifMatch,requestOptions"));
    assert.ok(block.includes("ifMatch} = props"));
  }
});

test("generated React and Zod trees preserve every published operation", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  const operationIds = [...spec.matchAll(/^      operationId: (\S+)$/gmu)].map(
    (match) => match[1],
  );
  for (const operationId of operationIds) {
    assert.ok(
      client.includes(`export const ${operationId}`),
      `React client lost ${operationId}`,
    );
    assert.ok(
      zod.includes(`export const ${pascalOperationId(operationId)}Response`),
      `Zod tree lost ${operationId}`,
    );
  }
});

test("generated readiness and Wave 1 read models stay strict and literal", () => {
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  assert.ok(client.includes("export const readinessCheck"));

  const readiness = generatedBlock(zod, "export const ReadinessCheckResponse");
  for (const contract of [
    '"status": zod.literal("ready")',
    '"lifecycle": zod.literal("ready")',
    '"database": zod.literal("ready")',
    ".strict()",
  ]) {
    assert.ok(readiness.includes(contract), `readiness widened ${contract}`);
  }

  const inbox = generatedBlock(zod, "export const GetWorkInboxResponse");
  for (const contract of [
    '"businessTimeZone": zod.literal("Africa/Lagos")',
    '"restrictedContent": zod.literal(true)',
    'zod.literal("/commercial-retainer")',
    ".strict()",
  ]) {
    assert.ok(inbox.includes(contract), `work inbox widened ${contract}`);
  }
  assert.ok(
    inbox.includes("HrefTwoRegExp"),
    "work inbox pursuit link pattern was not generated",
  );

  const evidence = generatedBlock(
    zod,
    "export const ListCanonicalEvidenceOptionsResponse",
  );
  assert.ok(evidence.includes('"privacyEligible": zod.boolean()'));
  assert.ok(evidence.includes(".strict()"));
});

test("generated Zod preserves closed authority and bounded-list literals", () => {
  const zod = readFileSync(generatedZodPath, "utf8");
  const exactLiterals = [
    [
      "GetProductionAcceptanceSnapshotResponse",
      [
        '"deploymentAuthorized": zod.literal(false)',
        '"requiresNamedHumanApproval": zod.literal(true)',
      ],
    ],
    [
      "ListProductionAcceptanceAuthoritiesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "GetClientActionSnapshotResponse",
      [
        '"externalMessaging": zod.literal(false)',
        '"uploadIntentOnly": zod.literal(true)',
      ],
    ],
    [
      "ListClientActionAuthoritiesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "ListOpportunitySourceCandidatesResponse",
      [
        '"externalAcquisitionConnected": zod.literal(false)',
        '"autonomousScrapingAllowed": zod.literal(false)',
      ],
    ],
    [
      "PrepareOpportunityPursuitHandoffResponse",
      [
        '"makerCheckerRequired": zod.literal(true)',
        '"pursuitActivated": zod.literal(false)',
        '"limit": zod.literal(100)',
      ],
    ],
    [
      "ConfirmOpportunityPursuitHandoffBody",
      ['"officialSourceReopened": zod.literal(true)'],
    ],
    [
      "GetEvidenceRenewalSnapshotResponse",
      [
        '"limit": zod.literal(100)',
        '"truncated": zod.literal(false)',
        '"externalMessagingConnected": zod.literal(false)',
        '"externalDeliveryReceipt": zod.null()',
      ],
    ],
    [
      "ListEvidenceRenewalAuthoritiesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "CreateEvidenceRenewalPlanResponse",
      ['"externalMessageSent": zod.literal(false)'],
    ],
    [
      "RecordManualOpportunitySourceBody",
      ['"sourceKind": zod.literal("manual_url")'],
    ],
    [
      "GetReconciledCommunicationsResponse",
      [
        '"deliveryRequiresVerifiedProviderReceipt": zod.literal(true)',
        '"autonomousDispatch": zod.literal(false)',
      ],
    ],
    [
      "ListProjectCommunicationReferencesResponse",
      ['"channel": zod.literal("email")', '"limit": zod.literal(100)'],
    ],
    [
      "GetCommercialRetainerManifestResponse",
      [
        '"openApiPublished": zod.literal(true)',
        '"automaticPricingAllowed": zod.literal(false)',
      ],
    ],
    [
      "GetPartnerConsortiumRoomResponse",
      [
        '"legalAgreementGeneration": zod.literal(false)',
        '"autonomousExternalAction": zod.literal(false)',
      ],
    ],
    [
      "ListConsortiumRoomParticipantsResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "GetAiShadowProgrammeResponse",
      [
        '"rawOutputPersistenceAllowed": zod.literal(false)',
        '"productionActivationGranted": zod.literal(false)',
      ],
    ],
    [
      "GetPrivacyOperationsResponse",
      [
        '"legalDecisionAutomated": zod.literal(false)',
        '"rawSubjectPiiIncluded": zod.literal(false)',
      ],
    ],
    [
      "ListPrivacyOperationsAssigneesResponse",
      ['"limit": zod.literal(100)', '"truncated": zod.literal(false)'],
    ],
    [
      "GetClaimsDeskResponse",
      [
        '"legalConclusionAutomated": zod.literal(false)',
        '"noticeDispatched": zod.literal(false)',
        '"paymentMutated": zod.literal(false)',
      ],
    ],
  ];

  for (const [name, literals] of exactLiterals) {
    const block = generatedBlock(zod, `export const ${name}`);
    for (const literal of literals) {
      assert.ok(block.includes(literal), `${name} widened ${literal}`);
    }
  }
});

test("opportunity handoff publishes its exact CAS, body and receipt boundary", () => {
  const spec = readFileSync(specPath, "utf8");
  const confirmation = schemaBlock(
    spec,
    "OpportunityPursuitHandoffConfirmation",
  );
  for (const property of [
    "expectedCandidateVersion",
    "expectedSourceReceiptSha256",
    "expectedTenderVersion",
    "expectedConflictBoundarySha256",
    "clientId",
    "expectedClientVersion",
    "tenderLotId",
    "expectedTenderLotVersion",
    "confirmedLotReference",
    "reviewerUserId",
    "officialSourceReopened",
    "confirmedBuyer",
    "confirmedReference",
    "confirmedSubmissionDeadline",
    "confirmationNote",
  ]) {
    assert.match(confirmation, new RegExp(`${property}:`, "u"));
  }
  assert.match(
    confirmation,
    /tenderLotId: \{ type: "null" \}[\s\S]*?expectedTenderLotVersion: \{ type: "null" \}[\s\S]*?confirmedLotReference: \{ type: "null" \}/u,
  );
  const receipt = schemaBlock(spec, "OpportunityPursuitHandoffReceipt");
  for (const property of [
    "clientVersion",
    "tenderLotVersion",
    "confirmedLotReference",
    "conflictBoundarySha256",
    "requestSha256",
    "receiptSha256",
  ]) {
    assert.match(receipt, new RegExp(`${property}:`, "u"));
  }
  assert.match(
    spec,
    /confirmOpportunityPursuitHandoff[\s\S]*?OpportunityHandoffIdempotencyKey[\s\S]*?x-valo-request-body-max-bytes: 16384/u,
  );
  assert.match(
    schemaBlock(spec, "OpportunityPursuitHandoffAuthority"),
    /createdPursuitState: \{ type: string, const: intake \}[\s\S]*?pursuitActivated: \{ type: boolean, const: false \}/u,
  );
});

test("evidence renewal publishes exact ledger, concurrency and no-delivery truth", () => {
  const spec = readFileSync(specPath, "utf8");
  for (const operationId of [
    "createEvidenceRenewalPlan",
    "stageEvidenceRenewalReplacement",
    "reviewEvidenceRenewalReplacement",
  ]) {
    const operation = [...parseOperations(spec).values()].find(
      (candidate) => candidate.operationId === operationId,
    );
    assert.ok(operation, `missing ${operationId}`);
    assert.equal(operation.privateNoStore, true);
    assert.equal(operation.varyOrganisation, true);
    assert.equal(operation.etag, true);
  }
  for (const operationId of [
    "stageEvidenceRenewalReplacement",
    "reviewEvidenceRenewalReplacement",
  ]) {
    const marker = `operationId: ${operationId}`;
    const start = spec.indexOf(marker);
    assert.ok(start >= 0);
    const block = spec.slice(start, spec.indexOf("\n  /", start));
    assert.match(block, /components\/parameters\/IfMatchVersion/u);
    assert.match(block, /x-valo-request-body-max-bytes: 65536/u);
    assert.match(block, /^        "428":/mu);
  }
  const plan = schemaBlock(spec, "EvidenceRenewalPlan");
  for (const contract of [
    "internalReminder:",
    "stagedReplacement:",
    "promotionReceiptSha256:",
    "externalMessageSent: { type: boolean, const: false }",
  ]) {
    assert.ok(plan.includes(contract), `renewal plan omits ${contract}`);
  }
  const reminder = schemaBlock(spec, "EvidenceRenewalInternalReminder");
  assert.match(
    reminder,
    /channel: \{ type: string, const: valo_evidence_renewal_register \}/u,
  );
  assert.match(reminder, /externalDeliveryReceipt: \{ type: "null" \}/u);
  const staged = schemaBlock(spec, "EvidenceRenewalStagedReplacement");
  for (const contract of [
    "documentVersionId",
    "documentVersionNumber",
    "expectedVaultItemVersion",
  ]) {
    assert.match(staged, new RegExp(`${contract}:`, "u"));
  }
  assert.doesNotMatch(spec, /vault_item_versions/u);
  const review = schemaBlock(spec, "EvidenceRenewalReviewDraft");
  assert.match(
    review,
    /decision: \{ type: string, const: approve \}[\s\S]*?reasonCode: \{ type: string, const: replacement_verified \}/u,
  );
  assert.match(
    review,
    /decision: \{ type: string, const: reject \}[\s\S]*?incorrect_document[\s\S]*?expiry_unacceptable[\s\S]*?quality_issue/u,
  );
  const source = readFileSync(
    resolve(routesRoot, "evidenceRenewal.ts"),
    "utf8",
  );
  assert.match(
    source,
    /EVIDENCE_RENEWAL_BOUNDS\.requestBodyBytes,[\s\S]*?"evidence-renewal"/u,
  );
});

test("the existing Pursuit Operations and Growth generated contract is preserved", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  for (const operationId of PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS) {
    assert.equal(
      spec.split(`operationId: ${operationId}`).length - 1,
      1,
      `OpenAPI drifted for ${operationId}`,
    );
    assert.ok(
      client.includes(`export const ${operationId}`),
      `generated client drifted for ${operationId}`,
    );
  }
});

test("untrusted durable-worker controls remain unmounted and unpublished", () => {
  const spec = readFileSync(specPath, "utf8");
  const client = readFileSync(generatedClientPath, "utf8");
  const zod = readFileSync(generatedZodPath, "utf8");
  const index = readFileSync(resolve(routesRoot, "index.ts"), "utf8");

  for (const denied of EXCLUDED_CONTROL_PLANE_PATHS) {
    assert.ok(!spec.includes(denied), `OpenAPI published ${denied}`);
    assert.ok(!client.includes(denied), `React client published ${denied}`);
    assert.ok(!zod.includes(denied), `Zod client published ${denied}`);
    assert.ok(!index.includes(denied), `route index mounted ${denied}`);
  }
  assert.ok(!index.includes("durableWorkerFoundationRouter"));
  assert.ok(!index.includes("createDurableWorkerFoundationRouter"));
});
