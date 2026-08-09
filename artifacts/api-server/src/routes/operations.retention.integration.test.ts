import { test, describe, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
  clients,
  projects,
  documents,
  requirements,
  evidenceItems,
  defects,
  boqChecks,
  llmRuns,
  reports,
  retentionRequests,
  vaultItems,
  auditEvents,
  organisations,
  organisationMemberships,
  roleGrants,
  withTenantDatabase,
} from "@workspace/db";
import operationsRouter from "./operations";
import type { LocalUser } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  attachTenantContext,
  enforceTenantResourceBoundary,
} from "../middlewares/tenancy";
import { attachTenantDatabase } from "../middlewares/databaseTenancy";

/**
 * End-to-end proof of the retention "deletion certificate" invariant:
 * completion may only be certified once EVERY class of stored engagement
 * content is gone — source blobs, extracted requirement text, evidence
 * excerpts, defect snapshots, BOQ lines, LLM run summaries — while
 * client-owned Certificate Vault blobs and the audit chain survive, and the
 * deterministic archive gate (physical-archive instruction) is enforced.
 */

let server: Server;
let baseUrl: string;
let currentUser: LocalUser | null = null;

let adminId: string;
let adminUser: LocalUser;
let organisationId: string;
let clientId: string;
let projectId: string;
let vaultBlobPath: string;
let engagementBlobPath: string;
const deletedBlobs: string[] = [];

before(async () => {
  const stamp = new Date().toISOString();

  const [admin] = await db
    .insert(users)
    .values({
      clerkUserId: `__retention_it_admin__${stamp}`,
      email: `admin-${stamp}@retention-it.local`,
      name: "Retention Admin",
      role: "admin",
      status: "active",
    })
    .returning();
  adminId = admin.id;
  adminUser = admin;

  const [organisation] = await db
    .insert(organisations)
    .values({
      name: `Retention integration ${stamp}`,
      slug: `retention-it-${randomUUID()}`,
      type: "valo",
      createdBy: admin.id,
    })
    .returning();
  organisationId = organisation.id;
  const [membership] = await db
    .insert(organisationMemberships)
    .values({ organisationId, userId: admin.id })
    .returning();
  await db.insert(roleGrants).values({
    membershipId: membership.id,
    role: "valo_operations_administrator",
  });

  await withTenantDatabase(organisationId, async () => {
    const [client] = await db
      .insert(clients)
      .values({ organisationId, name: `__RETENTION_IT__ ${stamp}` })
      .returning();
    clientId = client.id;

    const [project] = await db
      .insert(projects)
      .values({
        organisationId,
        clientId: client.id,
        tenderTitle: "Retention Integration RT-2026-001",
        status: "intake",
        reviewerId: admin.id,
        scope: "Full autopsy of tender RT-2026-001",
        limitations: "BOQ addendum 3 not provided",
        responsivenessReview:
          "Verbatim narrative with confidential clause text",
      })
      .returning();
    projectId = project.id;

    engagementBlobPath = `retention-it/${stamp}/tender.txt`;
    vaultBlobPath = `retention-it/${stamp}/cac-cert.pdf`;
    const [tenderDoc] = await db
      .insert(documents)
      .values([
        {
          organisationId,
          projectId,
          type: "tender",
          filename: "tender.txt",
          objectPath: engagementBlobPath,
        },
        {
          organisationId,
          projectId,
          type: "other",
          filename: "cac-cert.pdf",
          objectPath: vaultBlobPath,
        },
      ])
      .returning();

    // The second document's blob is claimed by the client's Certificate Vault —
    // the retention purge must leave that file alone.
    await db.insert(vaultItems).values({
      organisationId,
      clientId: client.id,
      artefactType: "CAC Certificate",
      objectPath: vaultBlobPath,
    });

    const [req1] = await db
      .insert(requirements)
      .values({
        organisationId,
        projectId,
        sourceDocId: tenderDoc.id,
        text: "Verbatim confidential clause: bid security of 2%",
        reviewStatus: "confirmed",
      })
      .returning();
    await db.insert(evidenceItems).values({
      organisationId,
      projectId,
      requirementId: req1.id,
      evidenceStatus: "present",
      excerpt: "Verbatim confidential bid excerpt",
    });
    await db.insert(defects).values({
      organisationId,
      projectId,
      requirementId: req1.id,
      type: "omission",
      severity: "scoring_risk",
      description: "Confidential defect narrative",
      evidenceSnapshot: "Verbatim snapshot",
      status: "open",
    });
    await db.insert(boqChecks).values({
      organisationId,
      projectId,
      lineRef: "1.1",
      description: "Confidential BOQ line",
      checkType: "extension",
      finding: "Extension mismatch",
    });
    await db.insert(llmRuns).values({
      organisationId,
      projectId,
      task: "extract_requirements",
      outputSummary: "Summary quoting confidential tender text",
    });
    await db.insert(reports).values({
      organisationId,
      projectId,
      version: 1,
      status: "draft",
      docxPath: `retention-it/${stamp}/report-v1.docx`,
    });
  });

  mock.method(
    ObjectStorageService.prototype,
    "deleteObjectEntity",
    async (objectPath: string) => {
      deletedBlobs.push(objectPath);
      return true;
    },
  );

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
  app.use(attachTenantContext);
  app.use(attachTenantDatabase);
  app.use(enforceTenantResourceBoundary);
  app.use(operationsRouter);

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  currentUser = adminUser;
});

after(async () => {
  mock.restoreAll();
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await withTenantDatabase(organisationId, async () => {
    await db.execute(
      sql`SELECT set_config('valo.audit_test_cleanup', 'approved', true)`,
    );
    await db.delete(auditEvents).where(eq(auditEvents.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(clients).where(eq(clients.id, clientId));
  });
  await db.delete(organisations).where(eq(organisations.id, organisationId));
  await db.delete(users).where(eq(users.id, adminId));
});

interface RetentionBody {
  id: string;
  status: string;
  certificateText: string;
  error: string;
}

async function json(res: globalThis.Response): Promise<RetentionBody> {
  return (await res.json()) as RetentionBody;
}

function headers(jsonBody = false): Record<string, string> {
  return {
    "X-Valo-Organisation-Id": organisationId,
    ...(jsonBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function rowCount(table: any): Promise<number> {
  return withTenantDatabase(organisationId, async () => {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.projectId, projectId));
    return rows.length;
  });
}

describe("retention request lifecycle", () => {
  let requestId: string;

  test("opens a retention request for the engagement", async () => {
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/retention-requests`,
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ reason: "Client requested deletion" }),
      },
    );
    assert.equal(res.status, 201);
    const body = await json(res);
    requestId = body.id;
    assert.equal(body.status, "pending");
  });

  test("rejects a duplicate open request for the same engagement", async () => {
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/retention-requests`,
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ reason: "duplicate" }),
      },
    );
    assert.equal(res.status, 409);
  });

  test("rejects a past dueAt", async () => {
    const res = await fetch(
      `${baseUrl}/projects/${projectId}/retention-requests`,
      {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ dueAt: "2001-01-01T00:00:00.000Z" }),
      },
    );
    assert.equal(res.status, 400);
  });

  test("refuses to certify while the archive gate fails (no physical-archive instruction)", async () => {
    const res = await fetch(
      `${baseUrl}/retention-requests/${requestId}/complete`,
      {
        method: "POST",
        headers: headers(),
      },
    );
    assert.equal(res.status, 409);
    const body = await json(res);
    assert.match(body.error, /archive/i);

    // Nothing may have been purged by the refused attempt.
    assert.equal(await rowCount(requirements), 1);
    assert.equal(await rowCount(documents), 2);
    const [reqRow] = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(retentionRequests)
        .where(eq(retentionRequests.id, requestId)),
    );
    assert.equal(reqRow.status, "pending");
    assert.equal(deletedBlobs.length, 0);
  });

  test("certifies only after purging every stored content class", async () => {
    await withTenantDatabase(organisationId, () =>
      db
        .update(projects)
        .set({
          physicalArchiveInstruction:
            "Return all hard copies to client within 7 days",
        })
        .where(eq(projects.id, projectId)),
    );

    const res = await fetch(
      `${baseUrl}/retention-requests/${requestId}/complete`,
      {
        method: "POST",
        headers: headers(),
      },
    );
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, "completed");

    // Every derived content class is gone.
    assert.equal(await rowCount(requirements), 0, "requirements purged");
    assert.equal(await rowCount(evidenceItems), 0, "evidence purged");
    assert.equal(await rowCount(defects), 0, "defects purged");
    assert.equal(await rowCount(boqChecks), 0, "boq checks purged");
    assert.equal(await rowCount(llmRuns), 0, "llm run summaries purged");
    assert.equal(await rowCount(documents), 0, "document rows purged");
    assert.equal(await rowCount(reports), 0, "report rows purged");

    // Narrative fields cleared, project archived.
    const [project] = await withTenantDatabase(organisationId, () =>
      db.select().from(projects).where(eq(projects.id, projectId)),
    );
    assert.equal(project.status, "archived");
    assert.equal(project.scope, null);
    assert.equal(project.limitations, null);
    assert.equal(project.responsivenessReview, null);

    // Engagement blobs purged; the vault-owned blob survives.
    assert.ok(
      deletedBlobs.includes(engagementBlobPath),
      "engagement blob purged",
    );
    assert.ok(
      !deletedBlobs.includes(vaultBlobPath),
      "vault artefact blob retained",
    );

    // The certificate enumerates what was purged and what was retained.
    assert.match(body.certificateText, /requirements=1/);
    assert.match(body.certificateText, /evidence=1/);
    assert.match(body.certificateText, /defects=1/);
    assert.match(body.certificateText, /boq_checks=1/);
    assert.match(body.certificateText, /llm_runs=1/);
    assert.match(body.certificateText, /audit chain/i);
    assert.match(body.certificateText, /Certificate Vault/i);
  });

  test("completing an already-completed request is idempotent", async () => {
    const res = await fetch(
      `${baseUrl}/retention-requests/${requestId}/complete`,
      {
        method: "POST",
        headers: headers(),
      },
    );
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.status, "completed");
  });
});
