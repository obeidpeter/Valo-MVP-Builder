import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function loadJson(relativePath) {
  const source = await readFile(resolve(root, relativePath), "utf8");
  return JSON.parse(source);
}

async function loadText(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

const rulePack = await loadJson("config/rules/nigeria/v2026-08-08.json");
const alerts = await loadJson("config/observability/alerts.v2.5.json");
const replitConfiguration = await loadText(".replit");

assert.match(
  replitConfiguration,
  /^build = "PORT=3000 BASE_PATH=\/ NODE_ENV=production pnpm run build"$/m,
  "Replit publishing must build both production artifacts",
);
assert.match(
  replitConfiguration,
  /^run = "CORS_ALLOWED_ORIGINS=https:\/\/valo-mvp-builder\.replit\.app TRUST_PROXY=1 NODE_ENV=production pnpm --filter @workspace\/api-server start"$/m,
  "Replit publishing must start the combined production web/API service with the exact public origin and trusted proxy posture",
);

assert.equal(
  rulePack.jurisdiction,
  "NG",
  "Nigeria rule pack must be jurisdiction scoped",
);
assert.ok(
  Array.isArray(rulePack.rules) && rulePack.rules.length > 0,
  "Nigeria rules are required",
);
for (const rule of rulePack.rules) {
  assert.match(
    rule.ruleId,
    /^NG-/,
    `Rule ${rule.ruleId ?? "<missing>"} needs a stable NG id`,
  );
  assert.ok(
    Array.isArray(rule.sourceUrls) && rule.sourceUrls.length > 0,
    `${rule.ruleId} needs an authoritative source URL`,
  );
  assert.ok(rule.effectiveFrom, `${rule.ruleId} needs an effective-from date`);
  assert.ok(rule.jurisdiction, `${rule.ruleId} needs jurisdiction scope`);
  assert.ok(rule.legalReviewStatus, `${rule.ruleId} needs legal-review status`);
}

const requiredAlerts = new Set([
  "api_error_rate",
  "processing_job_failure_rate",
  "extraction_quality_regression",
  "tenant_access_denials_spike",
  "sla_breach",
  "notification_delivery_failure",
  "unit_cost_budget",
  "deployment_health",
  "backup_freshness",
  "audit_anchor_failure",
  "break_glass_use",
]);
for (const alert of alerts.alerts ?? []) {
  assert.ok(alert.id, "Every alert needs an id");
  assert.ok(alert.severity, `${alert.id} needs a severity`);
  assert.ok(alert.signal, `${alert.id} needs a signal`);
  assert.ok(alert.condition, `${alert.id} needs a condition`);
  assert.ok(alert.runbook, `${alert.id} needs a runbook`);
  requiredAlerts.delete(alert.id);
}
assert.deepEqual(
  [...requiredAlerts],
  [],
  "Mandatory operational alerts are missing",
);

console.log(
  `release configuration valid: ${rulePack.rules.length} rules, ${alerts.alerts.length} alerts`,
);
