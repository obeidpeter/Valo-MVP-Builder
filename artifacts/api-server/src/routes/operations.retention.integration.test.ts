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
  notificationAttempts,
  notificationEvents,
  reports,
  retentionRequests,
  vaultItems,
  auditEvents,
  organisations,
  organisationMemberships,
  packageManifestItems,
  packageVersions,
  packages,
  priceBookEntries,
  priceBooks,
  orders,
  roleGrants,
  workTasks,
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
import { RETAINER_TASK_PREFIX } from "../lib/commercialRetainer/contracts";

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
let reportBlobPath: string;
let packagePdfBlobPath: string;
let packageZipBlobPath: string;
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
    reportBlobPath = `retention-it/${stamp}/report-v1.docx`;
    packagePdfBlobPath = `retention-it/${stamp}/project-package.pdf`;
    packageZipBlobPath = `retention-it/${stamp}/project-package.zip`;
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
      docxPath: reportBlobPath,
    });
    const [notificationEvent] = await db
      .insert(notificationEvents)
      .values({
        organisationId,
        projectId,
        channel: "email",
        template: "[RECONCILED-COMMS:v1]evidence_request_ready_v1",
        recipient: `user:${adminId}`,
        payload: JSON.stringify({
          requestId: randomUUID(),
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
        status: "prepared",
        createdBy: adminId,
      })
      .returning();
    await db.insert(notificationAttempts).values({
      organisationId,
      notificationEventId: notificationEvent.id,
      attemptNumber: 1,
      provider: "disconnected:test",
      idempotencyKey: `retention-${randomUUID()}`,
      status: "provider_disconnected",
      responseSummary: JSON.stringify({ receiptVerified: false }),
    });
    await db.insert(workTasks).values([
      {
        organisationId,
        projectId,
        title: "[OPS:evidence_request] Confidential evidence request",
        description: JSON.stringify({
          schema: "valo.operations-suite/v1",
          confidentialRequestMessage: "Provide the unpublished tax record",
        }),
      },
      {
        organisationId,
        projectId,
        title: `[CLIENT-ACTION:evidence_request] ${randomUUID()}`,
        description: JSON.stringify({
          schema: "valo.client-action-portal/v1",
          confidentialRequestMessage:
            "Provide the unpublished client evidence record",
        }),
      },
      {
        organisationId,
        projectId,
        title: `${RETAINER_TASK_PREFIX}${randomUUID()}] Confidential retainer request`,
        description: JSON.stringify({
          schemaVersion: "valo.retainer-service-request@v1",
          confidentialRequestMessage: "Review the unpublished tax record",
        }),
      },
      {
        organisationId,
        projectId,
        title: `[CONSORTIUM-ROOM:v1:${randomUUID()}]`,
        description: JSON.stringify({
          schema: "valo.partner-consortium-room/v1",
          confidentialResponsibility: "Prepare the unpublished pricing file",
        }),
      },
      {
        organisationId,
        projectId,
        title: `[CLAIMS-DESK:record_created] ${randomUUID()}`,
        description: JSON.stringify({
          schema: "valo.claims-desk-ledger/v1",
          receiptSha256: "a".repeat(64),
        }),
      },
    ]);
    const [projectPackage] = await db
      .insert(packages)
      .values({
        organisationId,
        projectId,
        packageType: "project_export",
        currentVersionNumber: 1,
      })
      .returning();
    const [packageVersion] = await db
      .insert(packageVersions)
      .values({
        organisationId,
        packageId: projectPackage.id,
        versionNumber: 1,
        sourceSnapshotHash: "c".repeat(64),
        manifestHash: "d".repeat(64),
        renderQaStatus: "pending",
        readinessSnapshot: JSON.stringify({ confidential: "snapshot" }),
        generatedByUserId: adminId,
        // DOCX intentionally overlaps the report row to prove purge planning
        // deduplicates shared object paths before storage deletion.
        docxObjectPath: reportBlobPath,
        docxSha256: "f".repeat(64),
        pdfObjectPath: packagePdfBlobPath,
        pdfSha256: "1".repeat(64),
        zipObjectPath: packageZipBlobPath,
        zipSha256: "2".repeat(64),
      })
      .returning();
    await db.insert(packageManifestItems).values({
      organisationId,
      packageVersionId: packageVersion.id,
      ordinal: 1,
      itemType: "signed_report",
      filename: "confidential-report.docx",
      sha256: "e".repeat(64),
      sizeBytes: 128,
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
  commercialFinancialBlockers?: {
    orders: number;
    invoiceLines: number;
    invoices: number;
    payments: number;
    entitlements: number;
    subscriptions: number;
    entitlementUsage: number;
  };
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

async function tenantRowCount(table: any): Promise<number> {
  return withTenantDatabase(organisationId, async () => {
    const rows = await db.select().from(table);
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
    assert.equal(await rowCount(workTasks), 5);
    assert.equal(await rowCount(notificationEvents), 1);
    assert.equal(await tenantRowCount(notificationAttempts), 1);
    assert.equal(await rowCount(packages), 1);
    const [reqRow] = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(retentionRequests)
        .where(eq(retentionRequests.id, requestId)),
    );
    assert.equal(reqRow.status, "pending");
    assert.equal(deletedBlobs.length, 0);
  });

  test("withholds the certificate before purge when linked financial records survive", async () => {
    const seeded = await withTenantDatabase(organisationId, async () => {
      await db
        .update(projects)
        .set({
          physicalArchiveInstruction:
            "Return all hard copies to client within 7 days",
        })
        .where(eq(projects.id, projectId));
      const now = new Date();
      const [book] = await db
        .insert(priceBooks)
        .values({
          organisationId,
          name: `retention-block-${randomUUID()}`,
          versionNumber: 1,
          status: "active",
          effectiveFrom: now,
          approvedByUserId: adminId,
          approvedAt: now,
        })
        .returning();
      const [entry] = await db
        .insert(priceBookEntries)
        .values({
          priceBookId: book.id,
          productCode: "retention-block-proof@1",
          productKind: "bid_autopsy",
          currency: "NGN",
          amountMinor: 100_000n,
          billingCadence: "one_off",
        })
        .returning();
      const [order] = await db
        .insert(orders)
        .values({
          organisationId,
          projectId,
          priceBookEntryId: entry.id,
          quantity: 1,
          unitAmountMinor: 100_000n,
          totalAmountMinor: 100_000n,
          currency: "NGN",
          status: "quote_pending_checker",
          idempotencyKey: `retention-block-${randomUUID()}`,
          placedByUserId: adminId,
        })
        .returning();
      return { bookId: book.id, entryId: entry.id, orderId: order.id };
    });

    try {
      const res = await fetch(
        `${baseUrl}/retention-requests/${requestId}/complete`,
        { method: "POST", headers: headers() },
      );
      assert.equal(res.status, 409);
      const body = await json(res);
      assert.match(body.error, /financial-retention policy/i);
      assert.equal(body.commercialFinancialBlockers?.orders, 1);
      assert.equal(body.commercialFinancialBlockers?.invoices, 0);
      assert.equal(body.commercialFinancialBlockers?.entitlementUsage, 0);
      assert.equal(deletedBlobs.length, 0, "blob purge did not begin");
      assert.equal(await rowCount(requirements), 1, "rows remain intact");
      const [pending] = await withTenantDatabase(organisationId, () =>
        db
          .select()
          .from(retentionRequests)
          .where(eq(retentionRequests.id, requestId)),
      );
      assert.equal(pending.status, "pending");
    } finally {
      await withTenantDatabase(organisationId, async () => {
        await db.delete(orders).where(eq(orders.id, seeded.orderId));
        await db
          .delete(priceBookEntries)
          .where(eq(priceBookEntries.id, seeded.entryId));
        await db.delete(priceBooks).where(eq(priceBooks.id, seeded.bookId));
      });
    }
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
    assert.match(body.certificateText, /claims_desk_events=1/u);
    assert.match(body.certificateText, /client_action_records=1/u);
    assert.match(body.certificateText, /notification_events=1/u);
    assert.match(body.certificateText, /notification_attempts=1/u);

    // Every derived content class is gone.
    assert.equal(await rowCount(requirements), 0, "requirements purged");
    assert.equal(await rowCount(evidenceItems), 0, "evidence purged");
    assert.equal(await rowCount(defects), 0, "defects purged");
    assert.equal(await rowCount(boqChecks), 0, "boq checks purged");
    assert.equal(await rowCount(llmRuns), 0, "llm run summaries purged");
    assert.equal(await rowCount(documents), 0, "document rows purged");
    assert.equal(await rowCount(reports), 0, "report rows purged");
    assert.equal(await rowCount(workTasks), 0, "operations records purged");
    assert.equal(
      await rowCount(notificationEvents),
      0,
      "notification events purged",
    );
    assert.equal(
      await tenantRowCount(notificationAttempts),
      0,
      "notification attempts purged",
    );
    assert.equal(await rowCount(packages), 0, "packages purged");
    assert.equal(
      await tenantRowCount(packageVersions),
      0,
      "package versions purged",
    );
    assert.equal(
      await tenantRowCount(packageManifestItems),
      0,
      "package manifests purged",
    );

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
    assert.equal(
      deletedBlobs.filter((path) => path === reportBlobPath).length,
      1,
      "report/package DOCX path purged once",
    );
    assert.ok(
      deletedBlobs.includes(packagePdfBlobPath),
      "package PDF blob purged",
    );
    assert.ok(
      deletedBlobs.includes(packageZipBlobPath),
      "package ZIP blob purged",
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
    assert.match(body.certificateText, /operations_records=5/);
    assert.match(body.certificateText, /client_action_records=1/);
    assert.match(body.certificateText, /notification_events=1/);
    assert.match(body.certificateText, /notification_attempts=1/);
    assert.match(body.certificateText, /retainer_service_requests=1/);
    assert.match(body.certificateText, /consortium_rooms=1/);
    assert.match(body.certificateText, /packages=1/);
    assert.match(body.certificateText, /package_versions=1/);
    assert.match(body.certificateText, /package_manifest_items=1/);
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
