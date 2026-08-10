import assert from "node:assert/strict";
import test from "node:test";
import { AI_CAPABILITY_IDS } from "./aiPolicy";
import {
  AI_PROMPT_REGISTRY,
  AiOutputValidationError,
  buildRegisteredDefectPrompt,
  buildRegisteredEvidencePrompt,
  buildRegisteredPdfOcrContent,
  buildRegisteredRequirementPrompt,
  buildRegisteredResponsivenessPrompt,
  canonicalJson,
  deterministicPromptHash,
  deterministicSchemaHash,
  parseAndValidateAiOutput,
  sha256,
} from "./aiPromptRegistry";

function assertEveryObjectIsStrict(schema: unknown): void {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;
  const record = schema as Record<string, unknown>;
  if (record.type === "object") {
    assert.equal(record.additionalProperties, false);
    const properties = record.properties as Record<string, unknown>;
    assert.deepEqual(
      [...((record.required as string[]) ?? [])].sort(),
      Object.keys(properties).sort(),
    );
  }
  for (const value of Object.values(record)) assertEveryObjectIsStrict(value);
}

const validRequirement = {
  text: "Submit a current tax clearance certificate.",
  sourceQuote: "The bidder shall submit a current tax clearance certificate.",
  category: "eligibility",
  expectedEvidence: "Tax clearance certificate",
  isMandatory: true,
  confidence: "high",
  pageRef: "12",
  clauseRef: "3.1",
  sourceDocId: "doc-1",
};

test("registry covers every capability with deterministic prompt and exact schema hashes", () => {
  assert.deepEqual(Object.keys(AI_PROMPT_REGISTRY), AI_CAPABILITY_IDS);
  for (const capability of AI_CAPABILITY_IDS) {
    const definition = AI_PROMPT_REGISTRY[capability];
    assert.match(definition.promptHash, /^[a-f0-9]{64}$/);
    assert.match(definition.schemaHash, /^[a-f0-9]{64}$/);
    assert.equal(definition.promptHash, deterministicPromptHash(definition));
    assert.equal(definition.schemaHash, deterministicSchemaHash(definition));
    assert.equal(
      definition.promptHash,
      sha256(
        canonicalJson({
          systemTemplate: definition.systemTemplate,
          promptConstruction: definition.promptConstruction,
        }),
      ),
    );
    assert.equal(
      definition.schemaHash,
      sha256(canonicalJson(definition.outputSchema)),
    );
    assert.equal(Object.isFrozen(definition), true);
    assert.equal(Object.isFrozen(definition.outputSchema), true);
    assertEveryObjectIsStrict(definition.outputSchema);
  }
  assert.equal(Object.isFrozen(AI_PROMPT_REGISTRY), true);
});

test("canonical JSON and hashes do not depend on object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: true, a: null }, a: [2, 1] }),
    '{"a":[2,1],"nested":{"a":null,"b":true},"z":1}',
  );
  const definition = AI_PROMPT_REGISTRY.responsiveness_review;
  assert.equal(
    definition.promptHash,
    deterministicPromptHash({
      ...definition,
      promptVersion: `${definition.promptVersion}-changed`,
    }),
  );
  assert.equal(
    definition.schemaHash,
    deterministicSchemaHash({
      ...definition,
      schemaVersion: `${definition.schemaVersion}-changed`,
    }),
  );
  assert.notEqual(
    definition.promptHash,
    deterministicPromptHash({
      ...definition,
      systemTemplate: `${definition.systemTemplate} changed`,
    }),
  );
  assert.notEqual(
    definition.promptHash,
    deterministicPromptHash({
      ...definition,
      promptConstruction: {
        ...definition.promptConstruction,
        userTemplate: `${definition.promptConstruction.userTemplate} changed`,
      },
    }),
  );
  assert.notEqual(
    definition.schemaHash,
    deterministicSchemaHash({
      ...definition,
      outputSchema: { ...definition.outputSchema, title: "changed" },
    }),
  );
});

test("registered construction owns every material user-prompt frame", () => {
  assert.deepEqual(
    buildRegisteredPdfOcrContent(
      "tender.pdf",
      "data:application/pdf;base64,AA==",
    ),
    [
      {
        type: "text",
        text: "Transcribe every readable line of this document.",
      },
      {
        type: "file",
        file: {
          filename: "tender.pdf",
          file_data: "data:application/pdf;base64,AA==",
        },
      },
    ],
  );
  assert.equal(
    buildRegisteredRequirementPrompt([
      {
        id: "doc-1",
        filename: "tender.pdf",
        type: "tender",
        contentText: "Submit a bid security.",
      },
    ]),
    'Documents:\n\n=== DOCUMENT [doc-1] "tender.pdf" (type: tender) ===\nSubmit a bid security.',
  );
  assert.equal(
    buildRegisteredEvidencePrompt(
      [
        {
          id: "req-1",
          text: "Submit a bid security.",
          expectedEvidence: "Bid security",
        },
      ],
      [
        {
          id: "doc-1",
          filename: "response.pdf",
          contentText: "Bid security enclosed.",
        },
      ],
    ),
    'Requirements:\n[req-1] Submit a bid security. (expected: Bid security)\n\nBid documents:\n=== DOCUMENT [doc-1] "response.pdf" ===\nBid security enclosed.',
  );
  assert.equal(
    buildRegisteredDefectPrompt(
      [{ id: "req-1", text: "Bid security", isMandatory: true }],
      [
        {
          requirementId: "req-1",
          evidenceStatus: "missing",
          notes: "No current evidence",
        },
      ],
    ),
    "Requirements:\n[req-1] (MANDATORY) Bid security\n\nEvidence:\nreq req-1: missing — No current evidence",
  );
  assert.equal(
    buildRegisteredResponsivenessPrompt({
      tenderTitle: "Road tender",
      requirements: [
        { text: "Mandatory one", isMandatory: true },
        { text: "Optional one", isMandatory: false },
      ],
      defects: [
        {
          severity: "fatal",
          type: "omission",
          description: "Bid security missing",
        },
      ],
    }),
    "Tender: Road tender\n\nMandatory requirements:\n- Mandatory one\n\nDefects:\n- [fatal/omission] Bid security missing",
  );
});

test("requirement Structured Output requires a bounded, non-empty sourceQuote", () => {
  const schema = AI_PROMPT_REGISTRY.extract_requirements.outputSchema as {
    properties: {
      requirements: {
        items: { properties: Record<string, unknown>; required: string[] };
      };
    };
  };
  const item = schema.properties.requirements.items;
  assert.ok(item.required.includes("sourceQuote"));
  assert.deepEqual(item.properties.sourceQuote, {
    type: "string",
    minLength: 1,
    maxLength: 4000,
  });
  assert.deepEqual(
    parseAndValidateAiOutput(
      "extract_requirements",
      JSON.stringify({ requirements: [validRequirement] }),
    ),
    { requirements: [validRequirement] },
  );
  for (const invalid of [
    { ...validRequirement, sourceQuote: "" },
    { ...validRequirement, sourceQuote: "   " },
    Object.fromEntries(
      Object.entries(validRequirement).filter(([key]) => key !== "sourceQuote"),
    ),
    { ...validRequirement, unexpected: true },
  ]) {
    assert.throws(
      () =>
        parseAndValidateAiOutput(
          "extract_requirements",
          JSON.stringify({ requirements: [invalid] }),
        ),
      AiOutputValidationError,
    );
  }
});

test("all registered validators accept their exact envelope and reject extra fields", () => {
  const samples = {
    extract_pdf_multimodal: { text: "verbatim text" },
    extract_requirements: { requirements: [validRequirement] },
    map_evidence: {
      items: [
        {
          requirementId: "req-1",
          documentId: null,
          evidenceStatus: "missing",
          excerpt: null,
          notes: "No supplied evidence",
        },
      ],
    },
    suggest_defects: {
      defects: [
        {
          requirementId: null,
          type: "omission",
          severity: "fatal",
          description: "Mandatory evidence is absent.",
          remediation: null,
        },
      ],
    },
    responsiveness_review: { review: "Pending named-human confirmation." },
  } as const;
  for (const capability of AI_CAPABILITY_IDS) {
    assert.deepEqual(
      parseAndValidateAiOutput(capability, JSON.stringify(samples[capability])),
      samples[capability],
    );
    assert.throws(
      () =>
        parseAndValidateAiOutput(
          capability,
          JSON.stringify({ ...samples[capability], unexpected: true }),
        ),
      AiOutputValidationError,
    );
  }
  assert.throws(
    () => parseAndValidateAiOutput("responsiveness_review", "not-json"),
    AiOutputValidationError,
  );
});
