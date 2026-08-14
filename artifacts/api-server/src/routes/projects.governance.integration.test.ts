// MUST be first: route modules transitively import the OpenAI client, which
// throws at load time without its env vars (absent in CI).
import "../test-env";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  users,
  organisations,
  organisationMemberships,
  roleGrants,
  clients,
  projects,
  conflictRecords,
  auditEvents,
} from "@workspace/db";
import projectsRouter from "./projects";
import usersRouter from "./users";
import type { LocalUser } from "../middlewares/auth";
import { type AccessContext } from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";
import { normalizeLegacyRole, permissionsForRoles } from "../lib/permissions";

/**
 * End-to-end proof of the two governance invariants hardened in the sweep:
 *
 *  1. Direct payment confirmation remains disabled until founder/adviser
 *     authority is bound to server-side grants; legacy role-shaped requests
 *     cannot stamp either identity leg.
 *
 *  2. Generic PATCH cannot decide conflicts. Ordinary versioned edits preserve
 *     a block, while changing tenderRef onto a different active tender opens a
 *     fresh blocked conflict record.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let founderId: string;
let advisorId: string;
let organisationId: string;
let clientId: string;
let founderMembershipId: string;
let advisorMembershipId: string;
let otherOrganisationId: string;
let alternateReviewerId: string;

const seededUserIds: string[] = [];
const ineligibleReviewerIds: string[] = [];

const projectIds: string[] = [];

interface ProjectBody {
  id: string;
  version: number;
  status: string;
  conflictStatus: string;
  paymentConfirmedByFounder: boolean;
  paymentConfirmedByAdvisor: boolean;
  paymentFounderConfirmedByName: string | null;
  paymentAdvisorConfirmedByName: string | null;
  paymentConfirmedAt: string | null;
  error: string;
}

async function json(res: globalThis.Response): Promise<ProjectBody> {
  return (await res.json()) as ProjectBody;
}

before(async () => {
  const stamp = new Date().toISOString();

  const [founder] = await db
    .insert(users)
    .values({
      clerkUserId: `__gov_it_founder__${stamp}`,
      email: `founder-${stamp}@gov-it.local`,
      name: "Founder One",
      role: "client_owner",
      status: "active",
    })
    .returning();
  founderId = founder.id;
  const [advisor] = await db
    .insert(users)
    .values({
      clerkUserId: `__gov_it_advisor__${stamp}`,
      email: `advisor-${stamp}@gov-it.local`,
      name: "Advisor Two",
      role: "client_reviewer",
      status: "active",
    })
    .returning();
  advisorId = advisor.id;

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `__GOV_IT_ORG__ ${stamp}`,
      slug: `gov-it-${Date.now()}`,
      type: "client",
    })
    .returning();
  organisationId = organisation.id;

  const [otherOrganisation] = await db
    .insert(organisations)
    .values({
      name: `__GOV_IT_OTHER_ORG__ ${stamp}`,
      slug: `gov-it-other-${Date.now()}`,
      type: "client",
    })
    .returning();
  otherOrganisationId = otherOrganisation.id;

  const [founderMembership] = await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: founderId, status: "active" })
    .returning();
  founderMembershipId = founderMembership.id;
  const [advisorMembership] = await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: advisorId, status: "active" })
    .returning();
  advisorMembershipId = advisorMembership.id;
  await db.insert(roleGrants).values([
    {
      membershipId: founderMembershipId,
      role: "client_organisation_owner",
    },
    {
      membershipId: advisorMembershipId,
      role: "client_reviewer_approver",
    },
  ]);

  const [alternateReviewer] = await db
    .insert(users)
    .values({
      clerkUserId: `__gov_it_alternate_reviewer__${stamp}`,
      email: `alternate-reviewer-${stamp}@gov-it.local`,
      name: "Alternate Reviewer",
      role: "none",
      status: "active",
    })
    .returning();
  alternateReviewerId = alternateReviewer.id;
  seededUserIds.push(alternateReviewerId);
  const [alternateMembership] = await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: alternateReviewerId, status: "active" })
    .returning();
  await db.insert(roleGrants).values({
    membershipId: alternateMembership.id,
    role: "client_reviewer_approver",
  });

  async function seedIneligibleReviewer(input: {
    label: string;
    name?: string;
    userStatus?: string;
    organisation?: string;
    membershipStatus?: string;
    accessStartsAt?: Date;
    accessExpiresAt?: Date;
    role?: string;
    roleStartsAt?: Date;
    roleExpiresAt?: Date;
    revokedAt?: Date;
    delegatedByMembershipId?: string;
  }) {
    const [candidate] = await db
      .insert(users)
      .values({
        clerkUserId: `__gov_it_${input.label}__${stamp}`,
        email: `${input.label}-${stamp}@gov-it.local`,
        name: input.name ?? `${input.label} Reviewer`,
        role: "none",
        status: input.userStatus ?? "active",
      })
      .returning();
    seededUserIds.push(candidate.id);
    ineligibleReviewerIds.push(candidate.id);
    const [membership] = await db
      .insert(organisationMemberships)
      .values({
        organisationId: input.organisation ?? organisationId,
        userId: candidate.id,
        status: input.membershipStatus ?? "active",
        accessStartsAt: input.accessStartsAt,
        accessExpiresAt: input.accessExpiresAt,
        delegatedByMembershipId: input.delegatedByMembershipId,
      })
      .returning();
    await db.insert(roleGrants).values({
      membershipId: membership.id,
      role: input.role ?? "client_reviewer_approver",
      startsAt: input.roleStartsAt,
      expiresAt: input.roleExpiresAt,
      revokedAt: input.revokedAt,
    });
  }

  const now = Date.now();
  await seedIneligibleReviewer({
    label: "cross_tenant",
    organisation: otherOrganisationId,
  });
  await seedIneligibleReviewer({
    label: "suspended",
    membershipStatus: "suspended",
  });
  await seedIneligibleReviewer({
    label: "membership_scheduled",
    accessStartsAt: new Date(now + 60_000),
  });
  await seedIneligibleReviewer({
    label: "membership_expired",
    accessExpiresAt: new Date(now - 60_000),
  });
  await seedIneligibleReviewer({
    label: "grant_scheduled",
    roleStartsAt: new Date(now + 60_000),
  });
  await seedIneligibleReviewer({
    label: "grant_expired",
    roleExpiresAt: new Date(now - 60_000),
  });
  await seedIneligibleReviewer({
    label: "grant_revoked",
    revokedAt: new Date(now - 60_000),
  });
  await seedIneligibleReviewer({ label: "non_reviewer", role: "contributor" });
  await seedIneligibleReviewer({
    label: "delegated",
    delegatedByMembershipId: founderMembershipId,
  });
  await seedIneligibleReviewer({
    label: "disabled_user",
    userStatus: "disabled",
  });
  await seedIneligibleReviewer({ label: "control_name", name: "\n" });

  const [client] = await db
    .insert(clients)
    .values({ name: `__GOV_IT__ ${stamp}`, organisationId })
    .returning();
  clientId = client.id;

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { localUser: LocalUser | null }).localUser = currentUser;
    const role = currentUser ? normalizeLegacyRole(currentUser.role) : null;
    if (role) {
      const membershipId =
        currentUser!.id === founderId
          ? founderMembershipId
          : currentUser!.id === advisorId
            ? advisorMembershipId
            : currentUser!.id;
      (req as Request & { accessContext?: AccessContext }).accessContext = {
        organisationId,
        membershipId,
        membershipOrganisationId: organisationId,
        source: "membership",
        roles: [role],
        permissions: permissionsForRoles([role]),
        breakGlassSessionId: null,
        partnerRelationshipId: null,
        partnerCoSigningRequired: false,
      };
    }
    (req as unknown as { log: unknown }).log = {
      error() {},
      warn() {},
      info() {},
      debug() {},
    };
    next();
  });
  app.use(attachTenantDatabase);
  app.use(usersRouter);
  app.use(projectsRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    for (const id of projectIds) {
      await tx.delete(auditEvents).where(eq(auditEvents.projectId, id));
    }
  });
  await db.delete(clients).where(eq(clients.id, clientId)); // cascades projects + conflict records
  await db.delete(organisations).where(eq(organisations.id, organisationId));
  await db
    .delete(organisations)
    .where(eq(organisations.id, otherOrganisationId));
  for (const userId of [founderId, advisorId, ...seededUserIds]) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

async function createProject(
  body: Record<string, unknown>,
): Promise<ProjectBody> {
  const res = await postProject(body);
  assert.equal(res.status, 201);
  const created = await json(res);
  projectIds.push(created.id);
  return created;
}

async function postProject(
  body: Record<string, unknown>,
): Promise<globalThis.Response> {
  const res = await fetch(`${baseUrl}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, reviewerId: advisorId, ...body }),
  });
  return res;
}

async function patchProject(
  id: string,
  body: Record<string, unknown>,
  expectedVersion?: number,
): Promise<globalThis.Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (expectedVersion !== undefined) {
    headers["If-Match"] = `"${expectedVersion}"`;
  }
  return fetch(`${baseUrl}/projects/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

async function confirmPayment(
  id: string,
  role: "founder" | "advisor",
): Promise<globalThis.Response> {
  return fetch(`${baseUrl}/projects/${id}/payment-confirmations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

async function conflictRecordCount(projectId: string): Promise<number> {
  const rows = await db
    .select()
    .from(conflictRecords)
    .where(eq(conflictRecords.projectId, projectId));
  return rows.length;
}

async function waitForProjectVisibility(projectId: string): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (project) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(`Expected project ${projectId} to be committed within 2 seconds`);
}

async function waitForConflictRecordCount(
  projectId: string,
  expectedCount: number,
): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (Date.now() < deadline) {
    if ((await conflictRecordCount(projectId)) === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.fail(
    `Expected ${expectedCount} conflict record(s) for ${projectId} to be committed within 2 seconds`,
  );
}

describe("payment confirmation is fail-closed until authority is bound", () => {
  let projectId: string;

  test("an organisation owner cannot stamp the founder leg", async () => {
    currentUser = {
      id: founderId,
      role: "client_owner",
      name: "Founder One",
    } as LocalUser;
    const project = await createProject({
      tenderTitle: "Payment identity proof",
    });
    projectId = project.id;
    await waitForProjectVisibility(projectId);

    const res = await confirmPayment(projectId, "founder");
    assert.equal(res.status, 503);
    const body = await json(res);
    assert.match(body.error, /disabled.*authority|authority.*bound/i);
  });

  test("a reviewer cannot use the legacy adviser-shaped payload", async () => {
    currentUser = {
      id: advisorId,
      role: "client_reviewer",
      name: "Advisor Two",
    } as LocalUser;
    const res = await confirmPayment(projectId, "advisor");
    assert.equal(res.status, 403);
  });

  test("denied attempts leave both identity legs and the audit stream untouched", async () => {
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    assert.equal(row.paymentConfirmedByFounder, false);
    assert.equal(row.paymentConfirmedByAdvisor, false);
    assert.equal(row.paymentFounderConfirmedBy, null);
    assert.equal(row.paymentAdvisorConfirmedBy, null);
    assert.equal(row.paymentConfirmedAt, null);
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.projectId, projectId));
    assert.equal(
      events.some((event) => event.eventType === "project.payment_confirmed"),
      false,
    );
  });
});

describe("conflict decisions require a dedicated authorised workflow", () => {
  let blockedId: string;
  let blockedVersion: number;

  test("a same-tender/lot project is created blocked with a conflict record", async () => {
    currentUser = {
      id: founderId,
      role: "client_owner",
      name: "Founder One",
    } as LocalUser;
    const original = await createProject({
      tenderTitle: "Original holder",
      tenderRef: "TX-100",
      lot: "L1",
    });
    await waitForProjectVisibility(original.id);
    const blocked = await createProject({
      tenderTitle: "Challenger",
      tenderRef: "TX-100",
      lot: "L1",
    });
    blockedId = blocked.id;
    blockedVersion = blocked.version;
    assert.equal(blocked.conflictStatus, "blocked");
    await waitForConflictRecordCount(blockedId, 1);
  });

  test("generic PATCH cannot stamp a consent decision", async () => {
    const res = await patchProject(blockedId, {
      conflictStatus: "consented",
      conflictDecision: "Client consented in writing",
    });
    assert.equal(res.status, 409);
    assert.match((await json(res)).error, /dedicated authorised workflows/i);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, blockedId));
    assert.equal(project.conflictStatus, "blocked");
    const [record] = await db
      .select()
      .from(conflictRecords)
      .where(eq(conflictRecords.projectId, blockedId));
    assert.equal(record.status, "blocked");
    assert.equal(record.decidedBy, null);
    assert.equal(record.decidedAt, null);
  });

  test("an unrelated versioned PATCH preserves the block and adds no duplicate", async () => {
    const res = await patchProject(
      blockedId,
      { deadline: "2026-12-31T00:00:00+01:00" },
      blockedVersion,
    );
    assert.equal(res.status, 200);
    const body = await json(res);
    blockedVersion = body.version;
    assert.equal(body.conflictStatus, "blocked");
    await waitForConflictRecordCount(blockedId, 1);
  });

  test("moving the project onto a different conflict creates a fresh blocked record", async () => {
    // A third project holds tender TZ-200. Changing the tender identity must
    // open a fresh record; the existing TX-100 block does not cover it.
    const otherHolder = await createProject({
      tenderTitle: "Other tender holder",
      tenderRef: "TZ-200",
      lot: "L1",
    });
    await waitForProjectVisibility(otherHolder.id);

    const res = await patchProject(
      blockedId,
      { tenderRef: "TZ-200" },
      blockedVersion,
    );
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.conflictStatus, "blocked");
    await waitForConflictRecordCount(blockedId, 2);
  });
});

async function organisationProjectCount(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.organisationId, organisationId));
  return Number(rows[0]?.count ?? 0);
}

async function organisationAuditCount(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, organisationId));
  return Number(rows[0]?.count ?? 0);
}

describe("project creation authority is current and server governed", () => {
  test("the selected-organisation directory computes reviewer eligibility fail-closed", async () => {
    currentUser = {
      id: founderId,
      role: "client_owner",
      name: "Founder One",
    } as LocalUser;
    const response = await fetch(`${baseUrl}/users`);
    assert.equal(response.status, 200);
    const directory = (await response.json()) as Array<{
      id: string;
      membershipStatus: string;
      role: string;
      reviewerEligible: boolean;
    }>;
    const eligibleIds = directory
      .filter(({ reviewerEligible }) => reviewerEligible)
      .map(({ id }) => id)
      .sort();
    assert.deepEqual(eligibleIds, [advisorId, alternateReviewerId].sort());
    assert.equal(
      directory.some(({ id }) => id === ineligibleReviewerIds[0]),
      false,
      "cross-tenant membership must not appear in the selected directory",
    );
    for (const reviewerId of ineligibleReviewerIds.slice(1)) {
      assert.equal(
        directory.find(({ id }) => id === reviewerId)?.reviewerEligible,
        false,
        reviewerId,
      );
    }
  });

  test("cross-tenant, suspended, expired, revoked and non-reviewer candidates fail without mutation", async () => {
    currentUser = {
      id: founderId,
      role: "client_owner",
      name: "Founder One",
    } as LocalUser;
    const projectsBefore = await organisationProjectCount();
    const auditBefore = await organisationAuditCount();

    for (const reviewerId of ineligibleReviewerIds) {
      const response = await postProject({
        tenderTitle: `Rejected reviewer ${reviewerId}`,
        reviewerId,
      });
      assert.equal(response.status, 403, reviewerId);
      assert.match((await json(response)).error, /not currently eligible/i);
    }

    assert.equal(await organisationProjectCount(), projectsBefore);
    assert.equal(await organisationAuditCount(), auditBefore);
  });

  test("crafted payment/conflict state and naive deadlines fail without mutation", async () => {
    const projectsBefore = await organisationProjectCount();
    const auditBefore = await organisationAuditCount();
    for (const body of [
      { tenderTitle: "Crafted payment", paymentStatus: "confirmed" },
      { tenderTitle: "Crafted conflict", conflictStatus: "consented" },
      { tenderTitle: "Crafted decision", conflictDecision: "accepted" },
      { tenderTitle: "Crafted rationale", conflictRationale: "accepted" },
      { tenderTitle: "Naive deadline", deadline: "2026-12-31T12:30:00" },
      { tenderTitle: "Malformed deadline", deadline: "2026-02-29T12:30:00Z" },
    ]) {
      const response = await postProject(body);
      assert.equal(response.status, 400, JSON.stringify(body));
    }
    assert.equal(await organisationProjectCount(), projectsBefore);
    assert.equal(await organisationAuditCount(), auditBefore);
  });

  test("an explicit offset deadline is stored as one canonical UTC instant", async () => {
    const project = await createProject({
      tenderTitle: "Canonical deadline",
      deadline: "2026-12-31T12:30:00+01:00",
    });
    assert.equal(
      (project as ProjectBody & { deadline?: string }).deadline,
      "2026-12-31T11:30:00.000Z",
    );
  });
});

describe("reviewer reassignment revalidates authority in the update transaction", () => {
  test("ineligible assignments and naive deadlines leave project and audit unchanged", async () => {
    currentUser = {
      id: founderId,
      role: "client_owner",
      name: "Founder One",
    } as LocalUser;
    const project = await createProject({ tenderTitle: "Assignment boundary" });
    // The request-scoped tenant transaction commits on response finish, so the
    // 201 can reach the client marginally before the commit lands. The project
    // row and its creation audit event commit atomically, so waiting for the
    // row pins the audit baseline before it is snapshotted.
    await waitForProjectVisibility(project.id);
    const eventsBefore = (
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.projectId, project.id))
    ).length;
    assert.ok(
      eventsBefore >= 1,
      "the committed creation must already be in the audit baseline",
    );

    for (const reviewerId of ineligibleReviewerIds) {
      const response = await patchProject(
        project.id,
        { reviewerId },
        project.version,
      );
      assert.equal(response.status, 403, reviewerId);
    }
    const naiveDeadline = await patchProject(
      project.id,
      { deadline: "2026-12-31T12:30:00" },
      project.version,
    );
    assert.equal(naiveDeadline.status, 400);

    const [persisted] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id));
    assert.equal(persisted.reviewerId, advisorId);
    assert.equal(persisted.version, project.version);
    assert.equal(persisted.deadline, null);
    const eventsAfter = (
      await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.projectId, project.id))
    ).length;
    assert.equal(eventsAfter, eventsBefore);
  });

  test("a current same-organisation reviewer can be assigned", async () => {
    currentUser = {
      id: founderId,
      role: "client_owner",
      name: "Founder One",
    } as LocalUser;
    const project = await createProject({
      tenderTitle: "Valid assignment boundary",
    });
    await waitForProjectVisibility(project.id);
    const response = await patchProject(
      project.id,
      { reviewerId: alternateReviewerId },
      project.version,
    );
    assert.equal(response.status, 200);
    const updated = (await json(response)) as ProjectBody & {
      reviewerId?: string | null;
    };
    assert.equal(updated.reviewerId, alternateReviewerId);
    assert.equal(updated.version, project.version + 1);
  });
});
