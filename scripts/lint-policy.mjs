import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function source(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

const app = await source("artifacts/api-server/src/app.ts");
const auth = await source("artifacts/api-server/src/middlewares/auth.ts");
const audit = await source("artifacts/api-server/src/lib/audit.ts");
const defects = await source("artifacts/api-server/src/routes/defects.ts");
const dbPackage = await source("lib/db/package.json");
const postMerge = await source("scripts/post-merge.sh");

assert.doesNotMatch(
  app,
  /origin\s*:\s*true/,
  "credentialed wildcard CORS is prohibited",
);
assert.doesNotMatch(
  auth,
  /first\s+(?:database\s+)?user.*admin/i,
  "first-user auto-admin is prohibited",
);
assert.match(
  audit,
  /export async function writeAudit[\s\S]*await db\.transaction/,
  "audit writes must propagate",
);
assert.doesNotMatch(
  defects,
  /(?:db|tx)\s*\.\s*delete\(\s*defects\s*\)/,
  "defect rows must never be deleted",
);
if (/router\.delete\(\s*["']\/defects\/:id/.test(defects)) {
  assert.match(
    defects,
    /router\.delete\([\s\S]*?res\.status\(409\)[\s\S]*?immutable/,
    "a retained legacy defect DELETE endpoint must fail closed",
  );
}
assert.doesNotMatch(
  dbPackage,
  /push-force|drizzle-kit\s+push/,
  "schema push is prohibited outside development",
);
assert.doesNotMatch(
  postMerge,
  /push-force|drizzle-kit\s+push/,
  "post-merge must apply source-controlled migrations",
);

console.log("security policy lint passed");
