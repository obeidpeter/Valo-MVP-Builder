import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

const previousEnvironment = {
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_TELEMETRY_DISABLED: process.env.CLERK_TELEMETRY_DISABLED,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV,
};

process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from(
  "test.clerk.accounts.dev$",
).toString("base64url")}`;
process.env.CLERK_SECRET_KEY = ["sk", "test", "liveness-boundary"].join("_");
process.env.CLERK_TELEMETRY_DISABLED = "1";
process.env.CORS_ALLOWED_ORIGINS = "https://valo.example";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/valo_app_test";
process.env.NODE_ENV = "test";

const { default: app } = await import("./app");

describe("application liveness boundary", () => {
  let server: Server;
  let origin: string;

  before(async () => {
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address !== "string");
    origin = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("answers GET and HEAD probes sent through an internal Host without authentication", async () => {
    const getResponse = await fetch(`${origin}/api/healthz`, {
      headers: { Host: "127.0.0.1:8080" },
    });
    assert.equal(getResponse.status, 200);
    assert.equal(getResponse.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      getResponse.headers.get("content-security-policy") ?? "",
      /default-src 'none'/,
    );
    assert.deepEqual(await getResponse.json(), { status: "ok" });

    const headResponse = await fetch(`${origin}/api/healthz`, {
      method: "HEAD",
      headers: { Host: "127.0.0.1:8080" },
    });
    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), "");
  });

  it("does not derive liveness from hostile Host or forwarded-host input", async () => {
    const response = await fetch(`${origin}/api/healthz`, {
      headers: {
        Host: "attacker.invalid",
        "X-Forwarded-Host": "metadata.attacker.invalid",
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("keeps every protected endpoint behind Clerk", async () => {
    const [publicHostResponse, internalHostResponse] = await Promise.all([
      fetch(`${origin}/api/me`, {
        headers: { Host: "valo.example" },
      }),
      fetch(`${origin}/api/me`, {
        headers: { Host: "127.0.0.1:8080" },
      }),
    ]);
    assert.equal(publicHostResponse.status, 401);
    assert(
      internalHostResponse.status < 200 || internalHostResponse.status >= 300,
    );
  });

  it("does not bypass middleware for other methods or path prefixes", async () => {
    const [postResponse, nestedResponse] = await Promise.all([
      fetch(`${origin}/api/healthz`, {
        method: "POST",
        headers: { Host: "valo.example" },
      }),
      fetch(`${origin}/api/healthz/extra`, {
        headers: { Host: "valo.example" },
      }),
    ]);

    assert.notEqual(postResponse.status, 200);
    assert.notEqual(nestedResponse.status, 200);
  });
});
