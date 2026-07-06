/**
 * Test-only environment shim. Route modules transitively import the OpenAI
 * integration client, which throws at module load when its env vars are
 * absent. Tests that never call the model still need those imports to
 * succeed (in CI there is no OpenAI provisioning), so import this module
 * FIRST in any test file that pulls in a route module — ESM evaluates
 * imports in order, so the placeholders land before the client evaluates.
 * Real values, when present (deploy environment), always win.
 */
process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??= "http://127.0.0.1:9/test-openai-unreachable";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??= "test-placeholder-key";

export {};
