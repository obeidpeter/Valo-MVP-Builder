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

test("roadmap manifest is unique and publishes exactly the frozen public operations", () => {
  assert.equal(ROADMAP_API_OPERATIONS.length, 53);
  assert.equal(PRESERVED_OPERATIONS_GROWTH_OPERATION_IDS.length, 32);
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
    "router.use(partnerConsortiumRoomRouter)",
    "router.use(reconciledCommunicationsRouter)",
    "router.use(opportunitySourceNetworkRouter)",
    "router.use(productionAcceptanceRouter)",
    "router.use(privacyOperationsRouter)",
    "router.use(claimsDeskRouter)",
    "router.use(aiShadowProgrammeRouter)",
  ]) {
    assert.ok(index.includes(mount), `missing guarded route mount ${mount}`);
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
