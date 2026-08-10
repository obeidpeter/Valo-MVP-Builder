import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function routeSource(name: string): string {
  return readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
}

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0, `missing section start: ${start}`);
  assert.ok(endAt > startAt, `missing section end: ${end}`);
  return source.slice(startAt, endAt);
}

test("requirement proposals are grounded, persist their quote, and do not advance project state", () => {
  const source = routeSource("requirements");
  const workflow = between(
    source,
    '"/projects/:id/extract-requirements"',
    '"/projects/:id/requirements"',
  );
  assert.match(workflow, /isQuoteGroundedInSourceMap\(/);
  assert.match(workflow, /const grounded = extracted\.filter/);
  assert.match(workflow, /mergedCitations: JSON\.stringify/);
  assert.match(workflow, /grounded\.map\(\(r\) =>/);
  assert.match(workflow, /if \(!parsed\.success\)/);
  assert.match(workflow, /res\.status\(400\)/);
  assert.match(workflow, /const docIds = parsed\.data\?\.documentIds/);
  assert.match(workflow, /if \(tenderDocs\.length === 0\)/);
  assert.match(
    workflow,
    /No tender documents are classified for requirement extraction/,
  );
  assert.match(workflow, /docs = tenderDocs/);
  assert.doesNotMatch(workflow, /\.update\(projects\)/);
  assert.match(workflow, /AI_SOURCE_CORPUS_TOO_LARGE|error\.code/);
});

test("evidence positive assertions are grounded before insert and cannot advance project state", () => {
  const source = routeSource("evidence");
  const workflow = between(
    source,
    '"/projects/:id/map-evidence"',
    '"/evidence"',
  );
  assert.match(workflow, /groundedEvidenceStatus\(/);
  assert.match(workflow, /groundedItems\.map/);
  assert.doesNotMatch(workflow, /\.update\(projects\)/);
  assert.match(workflow, /AI_SOURCE_CORPUS_TOO_LARGE|error\.code/);
});

test("evidence patch treats an explicit null source as removal, not omission", () => {
  const source = routeSource("evidence");
  const workflow = between(source, '"/evidence/:id"', "router.delete(");
  assert.match(workflow, /parsed\.data\.documentId !== undefined/);
  assert.match(workflow, /parsed\.data\.excerpt !== undefined/);
  assert.doesNotMatch(
    workflow,
    /parsed\.data\.documentId \?\? existing\.documentId/,
  );
  assert.doesNotMatch(workflow, /parsed\.data\.excerpt \?\? existing\.excerpt/);
});

test("defect suggestions consume reviewed requirements and confirmed evidence only", () => {
  const source = routeSource("defects");
  const workflow = between(
    source,
    '"/projects/:id/suggest-defects"',
    '"/defects"',
  );
  assert.match(workflow, /\["confirmed", "edited"\]/);
  assert.match(workflow, /isApprovedEvidence\(evidence\)/);
  assert.match(workflow, /reviewedRequirements\.map/);
  assert.match(workflow, /confirmedEvidence\.map/);
  assert.doesNotMatch(workflow, /\.update\(projects\)/);
});

test("responsiveness suggestions use reviewed inputs and require explicit sign-off approval", () => {
  const source = routeSource("projects");
  const workflow = between(
    source,
    '"/projects/:id/responsiveness-review"',
    "export default router",
  );
  assert.match(workflow, /inArray\(requirements\.reviewStatus/);
  assert.match(workflow, /ne\(defects\.status, "suggested"\)/);
  assert.match(workflow, /signal: disconnectController\.signal/);

  assert.match(source, /hasRequestPermission\(req, "report:sign_off"\)/);
  assert.match(source, /responsivenessSuggested: false/);
  assert.match(source, /project\.responsiveness_approved/);
});

test("sign-off and export both pass pending responsiveness state to readiness", () => {
  const source = routeSource("reports");
  assert.equal((source.match(/responsivenessSuggested:/g) ?? []).length, 2);
});

test("all text model inputs fail closed instead of truncating and use the strict registry", () => {
  const source = readFileSync(
    new URL("../lib/llm.ts", import.meta.url),
    "utf8",
  );
  const requirements = between(
    source,
    "export async function extractRequirements",
    "export interface MappedEvidence",
  );
  const evidence = between(
    source,
    "export async function mapEvidence",
    "export interface SuggestedDefect",
  );
  const defects = between(
    source,
    "export async function suggestDefects",
    "export async function responsivenessReview",
  );
  const responsiveness = source.slice(
    source.indexOf("export async function responsivenessReview"),
  );
  const registry = readFileSync(
    new URL("../lib/aiPromptRegistry.ts", import.meta.url),
    "utf8",
  );
  assert.match(requirements, /buildRegisteredRequirementPrompt\(docs\)/);
  assert.match(evidence, /completeBoundedInput\(/);
  assert.match(defects, /completeBoundedInput\(/);
  assert.match(responsiveness, /completeBoundedInput\(/);
  assert.doesNotMatch(requirements, /truncate\(/);
  assert.doesNotMatch(evidence, /truncate\(/);
  assert.doesNotMatch(defects, /truncate\(/);
  assert.doesNotMatch(responsiveness, /truncate\(/);
  assert.match(requirements, /"extract_requirements"/);
  assert.match(registry, /sourceQuote/);
});
