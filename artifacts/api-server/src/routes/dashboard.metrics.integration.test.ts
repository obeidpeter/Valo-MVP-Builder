// MUST be first: route modules transitively import the OpenAI client, which
// throws at load time without its env vars (absent in CI).
import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, users, clients, projects } from "@workspace/db";
import dashboardRouter from "./dashboard";
import type { LocalUser } from "../middlewares/auth";

/**
 * Gate 0 mandate-quality is a SUBSET of paid mandates (Build Brief §17): a
 * quality label on a project whose outcome is not `paid_mandate` must never
 * inflate readiness. This proves the aggregation gates on outcome, not just on
 * the mandateQuality field.
 */

interface Gate0Metric {
  key: string;
  value: number;
  threshold: number;
  met: boolean;
}
interface MetricsBody {
  paidMandates: number;
  gate0: { metrics: Gate0Metric[]; metCount: number; totalCount: number };
}

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let memberId: string;
let clientId: string;

before(async () => {
  const stamp = new Date().toISOString();

  const [member] = await db
    .insert(users)
    .values({
      clerkUserId: `__dash_it_member__${stamp}`,
      email: `member-${stamp}@dash-it.local`,
      name: "Dash Member",
      role: "admin",
      status: "active",
    })
    .returning();
  memberId = member.id;

  const [client] = await db
    .insert(clients)
    .values({ name: `__DASH_IT__ ${stamp}` })
    .returning();
  clientId = client.id;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    (req as unknown as { log: unknown }).log = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    next();
  });
  app.use(dashboardRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(clients).where(eq(clients.id, clientId)); // cascades projects
  await db.delete(users).where(eq(users.id, memberId));
});

async function metrics(): Promise<MetricsBody> {
  const res = await fetch(`${baseUrl}/dashboard/metrics`);
  assert.equal(res.status, 200);
  return (await res.json()) as MetricsBody;
}

function quality(body: MetricsBody): Gate0Metric {
  const m = body.gate0.metrics.find((x) => x.key === "mandateQuality");
  assert.ok(m, "gate0 exposes a mandateQuality metric");
  return m;
}

describe("Gate 0 mandate quality only counts paid mandates", () => {
  before(() => {
    currentUser = { id: memberId, role: "admin", name: "Dash Member" } as LocalUser;
  });

  test("a quality label on a non-paid project does NOT count", async () => {
    await db.insert(projects).values({
      clientId,
      reviewerId: memberId,
      tenderTitle: "Assisted bid but not yet paid",
      outcome: "none",
      mandateQuality: "assisted_bid",
    });
    const body = await metrics();
    assert.equal(quality(body).value, 0);
  });

  test("a paid mandate that is autopsy-only does NOT count", async () => {
    await db.insert(projects).values({
      clientId,
      reviewerId: memberId,
      tenderTitle: "Paid but autopsy-only",
      outcome: "paid_mandate",
      mandateQuality: "autopsy_only",
    });
    const body = await metrics();
    assert.equal(quality(body).value, 0);
  });

  test("a paid mandate that is assisted-bid/retainer DOES count", async () => {
    await db.insert(projects).values({
      clientId,
      reviewerId: memberId,
      tenderTitle: "Paid assisted bid",
      outcome: "paid_mandate",
      mandateQuality: "retainer",
    });
    const body = await metrics();
    const m = quality(body);
    assert.equal(m.value, 1);
    assert.equal(m.threshold, 1);
    assert.equal(m.met, true);
  });
});
