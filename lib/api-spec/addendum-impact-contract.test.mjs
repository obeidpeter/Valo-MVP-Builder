import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "..", "..");

test("the consolidated contract exposes all three strict Addendum Impact operations", async () => {
  const spec = await readFile(path.join(directory, "openapi.yaml"), "utf8");
  for (const [route, operationId] of [
    ["/projects/{id}/addendum-impact:", "getAddendumImpactCentre"],
    ["/projects/{id}/addendum-impact/review:", "reviewAddendumImpact"],
    ["/projects/{id}/addendum-impact/apply:", "applyAddendumImpact"],
  ]) {
    const start = spec.indexOf(`  ${route}`);
    assert.ok(start >= 0, route);
    const next = spec.indexOf("\n  /", start + route.length);
    const operation = spec.slice(start, next < 0 ? undefined : next);
    assert.match(operation, new RegExp(`operationId: ${operationId}`, "u"));
    assert.match(operation, /"500":/u);
  }
  assert.match(spec, /^    AddendumImpactCentreSnapshot:/mu);
  assert.match(spec, /^    AddendumImpactReviewRequest:/mu);
  assert.match(spec, /^    AddendumImpactApplyRequest:/mu);
  assert.match(spec, /^    AddendumImpactApplyResponse:/mu);
  assert.doesNotMatch(spec, /^    AddendumImpactVersionBoundCommand:/mu);
});

test("React and Zod codegen include usable strict Addendum Impact contracts", async () => {
  const [client, schemas, zod] = await Promise.all([
    readFile(
      path.join(root, "lib", "api-client-react", "src", "generated", "api.ts"),
      "utf8",
    ),
    readFile(
      path.join(
        root,
        "lib",
        "api-client-react",
        "src",
        "generated",
        "api.schemas.ts",
      ),
      "utf8",
    ),
    readFile(
      path.join(root, "lib", "api-zod", "src", "generated", "api.ts"),
      "utf8",
    ),
  ]);

  for (const operation of [
    "getAddendumImpactCentre",
    "reviewAddendumImpact",
    "applyAddendumImpact",
  ]) {
    assert.match(client, new RegExp(`export const ${operation}\\b`, "u"));
  }
  assert.match(client, /export function useGetAddendumImpactCentre/u);
  assert.match(client, /export const useReviewAddendumImpact\b/u);
  assert.match(client, /export const useApplyAddendumImpact\b/u);
  assert.match(schemas, /export interface AddendumImpactCentreSnapshot/u);
  assert.match(schemas, /export interface AddendumImpactReviewRequest/u);
  assert.match(schemas, /export interface AddendumImpactApplyRequest/u);

  for (const body of ["ReviewAddendumImpactBody", "ApplyAddendumImpactBody"]) {
    const start = zod.indexOf(`export const ${body}`);
    assert.ok(start >= 0, body);
    const next = zod.indexOf("\nexport const ", start + 20);
    assert.match(
      zod.slice(start, next < 0 ? undefined : next),
      /\.strict\(\)/u,
    );
  }
});
