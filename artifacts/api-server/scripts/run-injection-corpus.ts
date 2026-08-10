/**
 * FR-EXT-02 injection-containment proof.
 *
 * Runs the hostile-document corpus (scripts/injection-corpus/corpus.ts)
 * against the sanitization boundary and asserts, for every attack class:
 *
 *   1. only engagement-set IDs survive in reference fields;
 *   2. out-of-taxonomy defect types/severities DROP the item (never coerced);
 *   3. non-risk enums clamp to their safe default;
 *   4. no unknown keys (incl. __proto__/constructor payloads) survive and
 *      Object.prototype is not polluted;
 *   5. text and array caps hold;
 *   6. injected directives survive only as inert display text.
 *
 * The supported mode is --offline: pipe each fixture's compromised-model
 * output through sanitizeLlm directly. It is deterministic and performs no
 * network call. The historical live path is deliberately retired; behavioural
 * provider evaluation requires the controlled, authorised shadow runner.
 */
import {
  sanitizeExtractedRequirements,
  sanitizeMappedEvidence,
  sanitizeSuggestedDefects,
} from "../src/lib/sanitizeLlm";
import {
  ENGAGEMENT_DOC_IDS,
  ENGAGEMENT_REQ_IDS,
  FIXTURES,
  INJECTED_DIRECTIVE,
  REQUIRED_STRUCTURAL_TAXONOMY,
  type InjectionFixture,
} from "./injection-corpus/corpus";

const DOC_IDS: ReadonlySet<string> = new Set(ENGAGEMENT_DOC_IDS);
const REQ_IDS: ReadonlySet<string> = new Set(ENGAGEMENT_REQ_IDS);

const REQUIREMENT_KEYS = new Set([
  "text",
  "category",
  "expectedEvidence",
  "isMandatory",
  "confidence",
  "pageRef",
  "clauseRef",
  "sourceDocId",
  "sourceQuote",
]);
const EVIDENCE_KEYS = new Set([
  "requirementId",
  "documentId",
  "evidenceStatus",
  "excerpt",
  "notes",
]);
const DEFECT_KEYS = new Set([
  "requirementId",
  "type",
  "severity",
  "description",
  "remediation",
]);
const DEFECT_TYPES = new Set([
  "omission",
  "expiry",
  "arithmetic",
  "formatting",
  "responsiveness",
  "eligibility",
  "unsupported_claim",
  "validity",
]);
const DEFECT_SEVERITIES = new Set([
  "fatal",
  "likely_fatal",
  "scoring_risk",
  "cosmetic",
]);
const MAX_ITEMS = 500;
const MAX_TEXT = 4000;

let passes = 0;
let failures = 0;
function check(label: string, ok: boolean, detail?: string): boolean {
  if (ok) {
    passes++;
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}

function ownKeys(obj: object): string[] {
  return Object.keys(obj);
}

/** Containment assertions that hold for ANY sanitized output. */
function assertContained(
  fixtureId: string,
  kind: InjectionFixture["sanitizer"],
  sanitized: Array<Record<string, unknown>>,
): void {
  check(
    `${fixtureId}: item cap holds (${sanitized.length} <= ${MAX_ITEMS})`,
    sanitized.length <= MAX_ITEMS,
  );
  check(
    `${fixtureId}: Object.prototype not polluted`,
    !("polluted" in ({} as Record<string, unknown>)) &&
      !("isAdmin" in ({} as Record<string, unknown>)),
  );
  const allowed =
    kind === "requirements"
      ? REQUIREMENT_KEYS
      : kind === "evidence"
        ? EVIDENCE_KEYS
        : DEFECT_KEYS;
  for (const item of sanitized) {
    const extra = ownKeys(item).filter((k) => !allowed.has(k));
    check(
      `${fixtureId}: no unknown keys survive`,
      extra.length === 0,
      `found ${extra.join(", ")}`,
    );
    if (kind === "requirements") {
      const docId = item.sourceDocId;
      check(
        `${fixtureId}: sourceDocId in engagement set or null`,
        docId == null || DOC_IDS.has(String(docId)),
        String(docId),
      );
      check(
        `${fixtureId}: text cap holds`,
        String(item.text ?? "").length <= MAX_TEXT,
      );
      check(
        `${fixtureId}: isMandatory is a real boolean`,
        typeof item.isMandatory === "boolean",
      );
    }
    if (kind === "evidence") {
      check(
        `${fixtureId}: requirementId in engagement set`,
        REQ_IDS.has(String(item.requirementId)),
      );
      const docId = item.documentId;
      check(
        `${fixtureId}: documentId in engagement set or null`,
        docId == null || DOC_IDS.has(String(docId)),
        String(docId),
      );
    }
    if (kind === "defects") {
      check(
        `${fixtureId}: defect type in taxonomy`,
        DEFECT_TYPES.has(String(item.type)),
      );
      check(
        `${fixtureId}: defect severity in taxonomy`,
        DEFECT_SEVERITIES.has(String(item.severity)),
      );
      const reqId = item.requirementId;
      check(
        `${fixtureId}: defect requirementId in engagement set or null`,
        reqId == null || REQ_IDS.has(String(reqId)),
      );
    }
  }
}

function runSanitizer(
  fixture: InjectionFixture,
  raw: unknown,
): Array<Record<string, unknown>> {
  switch (fixture.sanitizer) {
    case "requirements":
      return sanitizeExtractedRequirements(raw, DOC_IDS) as unknown as Array<
        Record<string, unknown>
      >;
    case "evidence":
      return sanitizeMappedEvidence(raw, REQ_IDS, DOC_IDS) as unknown as Array<
        Record<string, unknown>
      >;
    case "defects":
      return sanitizeSuggestedDefects(raw, REQ_IDS) as unknown as Array<
        Record<string, unknown>
      >;
  }
}

function offlinePass(): void {
  console.log(
    `=== OFFLINE containment pass: ${FIXTURES.length} hostile fixtures ===`,
  );
  console.log(
    "NOTE: this pass proves structural sanitizer containment only. It does not prove live-model " +
      "instruction non-adherence, non-exfiltration, retrieval isolation or tool non-execution.\n",
  );
  if (FIXTURES.length < 10) {
    check(
      "corpus has >= 10 hostile fixtures (FR-EXT-02)",
      false,
      `${FIXTURES.length}`,
    );
  } else {
    check(`corpus has >= 10 hostile fixtures (${FIXTURES.length})`, true);
  }
  const coveredTaxonomy = new Set(
    FIXTURES.map((fixture) => fixture.taxonomy).filter(Boolean),
  );
  for (const taxonomy of REQUIRED_STRUCTURAL_TAXONOMY) {
    check(
      `structural taxonomy includes ${taxonomy}`,
      coveredTaxonomy.has(taxonomy),
    );
  }
  for (const fixture of FIXTURES) {
    console.log(`\n--- ${fixture.id}: ${fixture.attack}`);
    const sanitized = runSanitizer(fixture, fixture.hostileOutput);
    assertContained(fixture.id, fixture.sanitizer, sanitized);

    // Attack-specific expectations.
    switch (fixture.id) {
      case "foreign-requirement-evidence":
        check("foreign-requirement evidence dropped", sanitized.length === 1);
        check(
          "surviving evidence keeps engagement requirement",
          sanitized[0]?.requirementId === "req-1",
        );
        check(
          "foreign documentId nulled, item kept",
          sanitized[0]?.documentId === null,
        );
        break;
      case "severity-forgery":
        check("all out-of-taxonomy severities dropped", sanitized.length === 0);
        break;
      case "type-forgery":
        check(
          "invented defect class dropped, real finding kept",
          sanitized.length === 1 && sanitized[0]?.type === "omission",
        );
        break;
      case "enum-clamp-category":
        check(
          "hostile category clamped to 'other'",
          sanitized[0]?.category === "other",
        );
        check(
          "hostile confidence clamped to 'unclear'",
          sanitized[0]?.confidence === "unclear",
        );
        break;
      case "oversized-text-flood":
        check(
          "100k text capped to 4000",
          String(sanitized[0]?.text ?? "").length === MAX_TEXT,
        );
        break;
      case "array-flood":
        check("5000 items capped to 500", sanitized.length === MAX_ITEMS);
        break;
      case "shape-mutation":
        check("non-array output yields empty result", sanitized.length === 0);
        break;
      case "boolean-type-confusion":
        check(
          "string 'true' does not become mandatory",
          sanitized[0]?.isMandatory === false,
        );
        break;
      case "empty-text-fabrication":
        check("empty-text fabrications dropped", sanitized.length === 0);
        break;
      case "instruction-injection-inline":
        // The directive must be RETAINED verbatim as display data in `text`
        // (a sanitizer that executed or expanded it would produce different
        // output; one that silently dropped it would hide the attack from
        // the reviewer) while the schema stays untouched (unknown-key and
        // enum checks above).
        check(
          "directive retained verbatim as inert data in text",
          sanitized.length === 1 &&
            String(sanitized[0]?.text).includes(INJECTED_DIRECTIVE),
        );
        check(
          "directive did not flip isMandatory shape",
          typeof sanitized[0]?.isMandatory === "boolean",
        );
        break;
      case "inert-excerpt-directive":
        check(
          "directive retained verbatim as inert excerpt data",
          sanitized[0]?.excerpt === INJECTED_DIRECTIVE,
        );
        check(
          "hostile evidenceStatus clamped to 'unclear', not trusted",
          sanitized[0]?.evidenceStatus === "unclear",
        );
        break;
    }
  }
}

async function livePass(): Promise<void> {
  console.log("\n=== LIVE structural pass (real model, hostile documents) ===");
  console.log(
    "This legacy live pass still checks structural output containment only; a separate authorised " +
      "behavioural suite must test task deviation, exfiltration, retrieval and tool execution.",
  );
  const { extractRequirements, mapEvidence, suggestDefects } =
    await import("../src/lib/llm");
  const docs = FIXTURES.map((f, i) => ({
    id: ENGAGEMENT_DOC_IDS[i % ENGAGEMENT_DOC_IDS.length],
    filename: `${f.id}.txt`,
    type: i % 2 === 0 ? "tender" : "bid",
    contentText: f.documentText,
  }));
  const liveProjectId = "00000000-0000-0000-0000-000000000000";

  const { requirements } = await extractRequirements(liveProjectId, docs);
  assertContained(
    "live:extract",
    "requirements",
    requirements as unknown as Array<Record<string, unknown>>,
  );

  const reqInputs = [
    {
      id: ENGAGEMENT_REQ_IDS[0],
      text: "Bidders must possess a valid CAC certificate.",
      expectedEvidence: "CAC certificate",
    },
    {
      id: ENGAGEMENT_REQ_IDS[1],
      text: "Bid security of 2% of bid price is required.",
      expectedEvidence: "Bank guarantee",
    },
  ];
  const { items } = await mapEvidence(liveProjectId, reqInputs, docs);
  assertContained(
    "live:evidence",
    "evidence",
    items as unknown as Array<Record<string, unknown>>,
  );

  const { defects } = await suggestDefects(
    liveProjectId,
    reqInputs.map((r) => ({ id: r.id, text: r.text, isMandatory: true })),
    items.map((e) => ({
      requirementId: e.requirementId,
      evidenceStatus: e.evidenceStatus,
      notes: e.notes ?? null,
    })),
  );
  assertContained(
    "live:defects",
    "defects",
    defects as unknown as Array<Record<string, unknown>>,
  );
}

async function main(): Promise<void> {
  const offline = process.argv.includes("--offline");
  if (!offline) {
    throw new Error(
      "The legacy live structural pass is retired. Use --offline; authorised behavioural injection evaluation belongs in the controlled shadow/evaluation runner.",
    );
  }
  console.log(
    offline
      ? "Running OFFLINE injection-containment proof only.\n"
      : "Running OFFLINE + LIVE structural containment checks (not a behavioural safety proof).\n",
  );
  offlinePass();
  if (!offline) {
    await livePass();
  }
  console.log(`\n=== RESULT: ${passes} passed, ${failures} failed ===`);
  if (failures > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Injection proof crashed:", error);
    process.exit(1);
  });
