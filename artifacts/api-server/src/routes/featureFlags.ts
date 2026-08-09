import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  db,
  featureFlags,
  organisations,
  withTenantDatabase,
} from "@workspace/db";
import { getLocalUser } from "../middlewares/auth";
import {
  attachTenantContext,
  getAccessContext,
  parseExpectedVersion,
  requirePermission,
} from "../middlewares/tenancy";
import { writeAuditTx } from "../lib/audit";

const router: IRouter = Router();

export const COMMERCIALLY_GATED_FEATURES = [
  "partner_edition",
  "white_label_branding",
  "benchmark_reporting",
  "licensed_tender_discovery",
  "controlled_bid_drafting",
] as const;

/** Platform-controlled commercial activation for a tenant. */
router.patch(
  "/platform/organisations/:organisationId/feature-flags/:key",
  async (req: Request, res: Response) => {
    const user = getLocalUser(req);
    if (!user || user.role !== "restricted_platform_administrator") {
      res
        .status(403)
        .json({ error: "Restricted platform administrator required" });
      return;
    }
    const organisationId = String(req.params.organisationId);
    const key = String(req.params.key).trim().toLowerCase();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const enabled = body.enabled;
    const activationReference =
      typeof body.activationReference === "string"
        ? body.activationReference.trim()
        : "";
    if (
      typeof enabled !== "boolean" ||
      !/^[a-z][a-z0-9_]{2,79}$/.test(key) ||
      (enabled && activationReference.length < 5)
    ) {
      res.status(400).json({ error: "Invalid commercial feature activation" });
      return;
    }
    const [organisation] = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    if (!organisation) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const [existing] = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(featureFlags)
        .where(
          and(
            eq(featureFlags.organisationId, organisationId),
            eq(featureFlags.key, key),
          ),
        ),
    );
    const expectedVersion = existing
      ? parseExpectedVersion(req.get("If-Match"))
      : null;
    if (existing && !expectedVersion) {
      res
        .status(428)
        .json({ error: "If-Match feature flag version is required" });
      return;
    }
    const saved = await withTenantDatabase(organisationId, () =>
      db.transaction(
        async (tx) => {
          const [flag] = existing
            ? await tx
                .update(featureFlags)
                .set({
                  enabled,
                  commercialGate: enabled
                    ? `approved:${activationReference}`
                    : null,
                  updatedByUserId: user.id,
                  version: sql`${featureFlags.version} + 1`,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(featureFlags.id, existing.id),
                    eq(featureFlags.version, expectedVersion!),
                  ),
                )
                .returning()
            : await tx
                .insert(featureFlags)
                .values({
                  organisationId,
                  key,
                  enabled,
                  commercialGate: enabled
                    ? `approved:${activationReference}`
                    : null,
                  updatedByUserId: user.id,
                })
                .returning();
          if (!flag) return undefined;
          await writeAuditTx(tx, {
            user,
            organisationId,
            eventType: "feature_flag.commercial_activation_updated",
            objectType: "feature_flag",
            objectId: flag.id,
            details: JSON.stringify({ key, enabled, activationReference }),
          });
          return flag;
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (!saved) {
      res
        .status(409)
        .json({ error: "Feature flag changed; reload before updating" });
      return;
    }
    res.setHeader("ETag", `"${saved.version}"`).json(saved);
  },
);

router.get(
  "/feature-flags",
  attachTenantContext,
  requirePermission("feature_flag:read"),
  async (req: Request, res: Response) => {
    const organisationId = getAccessContext(req)!.organisationId;
    const rows = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(featureFlags)
        .where(
          or(
            isNull(featureFlags.organisationId),
            eq(featureFlags.organisationId, organisationId),
          ),
        ),
    );
    const global = new Map(
      rows.filter((row) => !row.organisationId).map((row) => [row.key, row]),
    );
    const tenant = new Map(
      rows
        .filter((row) => row.organisationId === organisationId)
        .map((row) => [row.key, row]),
    );
    const keys = new Set<string>([
      ...COMMERCIALLY_GATED_FEATURES,
      ...global.keys(),
      ...tenant.keys(),
    ]);
    res.json(
      [...keys].sort().map((key) => {
        const row = tenant.get(key) ?? global.get(key);
        return {
          key,
          enabled: row?.enabled ?? false,
          configuration: row?.configuration
            ? JSON.parse(row.configuration)
            : null,
          source: tenant.has(key)
            ? "tenant"
            : global.has(key)
              ? "global"
              : "default",
          version: row?.version ?? 0,
        };
      }),
    );
  },
);

router.patch(
  "/feature-flags/:key",
  attachTenantContext,
  requirePermission("feature_flag:manage"),
  async (req: Request, res: Response) => {
    const context = getAccessContext(req)!;
    if (context.source === "break_glass") {
      res
        .status(403)
        .json({ error: "Emergency access cannot change feature flags" });
      return;
    }
    const key = String(req.params.key).trim().toLowerCase();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const enabled = body.enabled;
    const activationReference =
      typeof body.activationReference === "string"
        ? body.activationReference.trim()
        : "";
    if (
      !/^[a-z][a-z0-9_]{2,79}$/.test(key) ||
      typeof enabled !== "boolean" ||
      (enabled && activationReference.length < 5)
    ) {
      res.status(400).json({
        error:
          "Enabled features require a valid commercial activation reference",
      });
      return;
    }
    let configuration: string | null = null;
    if (body.configuration !== undefined && body.configuration !== null) {
      try {
        configuration = JSON.stringify(body.configuration);
      } catch {
        res
          .status(400)
          .json({ error: "Feature configuration must be JSON serialisable" });
        return;
      }
      if (configuration.length > 20_000) {
        res.status(400).json({ error: "Feature configuration is too large" });
        return;
      }
    }
    const organisationId = context.organisationId;
    const [existing] = await withTenantDatabase(organisationId, () =>
      db
        .select()
        .from(featureFlags)
        .where(
          and(
            eq(featureFlags.organisationId, organisationId),
            eq(featureFlags.key, key),
          ),
        ),
    );
    const user = getLocalUser(req)!;
    const expectedVersion = existing
      ? parseExpectedVersion(req.get("If-Match"))
      : null;
    if (existing && !expectedVersion) {
      res
        .status(428)
        .json({ error: "If-Match feature flag version is required" });
      return;
    }
    const saved = await withTenantDatabase(organisationId, () =>
      db.transaction(
        async (tx) => {
          const [flag] = existing
            ? await tx
                .update(featureFlags)
                .set({
                  enabled,
                  configuration,
                  commercialGate: enabled
                    ? `approved:${activationReference}`
                    : null,
                  updatedByUserId: user.id,
                  version: sql`${featureFlags.version} + 1`,
                  updatedAt: new Date(),
                })
                .where(
                  and(
                    eq(featureFlags.id, existing.id),
                    eq(featureFlags.version, expectedVersion!),
                  ),
                )
                .returning()
            : await tx
                .insert(featureFlags)
                .values({
                  organisationId,
                  key,
                  enabled,
                  configuration,
                  commercialGate: enabled
                    ? `approved:${activationReference}`
                    : null,
                  updatedByUserId: user.id,
                })
                .returning();
          if (!flag) return undefined;
          await writeAuditTx(tx, {
            user,
            organisationId,
            eventType: "feature_flag.updated",
            objectType: "feature_flag",
            objectId: flag.id,
            details: JSON.stringify({ key, enabled, activationReference }),
          });
          return flag;
        },
        { isolationLevel: "read committed" },
      ),
    );
    if (!saved) {
      res
        .status(409)
        .json({ error: "Feature flag changed; reload before updating" });
      return;
    }
    res.setHeader("ETag", `"${saved.version}"`).json({
      key: saved.key,
      enabled: saved.enabled,
      configuration: saved.configuration
        ? JSON.parse(saved.configuration)
        : null,
      version: saved.version,
    });
  },
);

export default router;
