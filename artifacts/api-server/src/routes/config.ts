import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, appConfig } from "@workspace/db";
import { UpdateAppConfigBody } from "@workspace/api-zod";
import { getLocalUser } from "../middlewares/auth";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { writeAudit } from "../lib/audit";
import {
  getActiveConfigRow,
  toActiveConfig,
  APP_CONFIG_ID,
} from "../lib/appConfig";

const router: IRouter = Router();

function serializeConfig(row: Awaited<ReturnType<typeof getActiveConfigRow>>) {
  const active = toActiveConfig(row);
  return {
    severityWeights: active.risk.severityWeights,
    missingEvidenceWeight: active.risk.missingEvidenceWeight,
    bandCutoffs: active.risk.bandCutoffs,
    firmName: active.template.firmName,
    confidentialityLegend: active.template.confidentialityLegend,
    retentionDefaultDays: active.retentionDefaultDays,
    updatedAt: active.updatedAt.toISOString(),
    updatedBy: active.updatedBy,
  };
}

router.get(
  "/config",
  requirePermissionOrLegacy("configuration:read"),
  async (_req: Request, res: Response) => {
    const row = await getActiveConfigRow();
    res.json(serializeConfig(row));
  },
);

router.patch(
  "/config",
  requirePermissionOrLegacy("configuration:manage"),
  async (req: Request, res: Response) => {
    const parsed = UpdateAppConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const d = parsed.data;

    // The OpenAPI contract types every numeric field as an integer, but the
    // generated zod only enforces min/max. Reject non-integers here so a decimal
    // payload fails cleanly at the boundary instead of blowing up on the DB write.
    const numerics = [
      d.severityWeights?.fatal,
      d.severityWeights?.likely_fatal,
      d.severityWeights?.scoring_risk,
      d.severityWeights?.cosmetic,
      d.missingEvidenceWeight,
      d.bandCutoffs?.medium,
      d.bandCutoffs?.high,
      d.bandCutoffs?.critical,
      d.retentionDefaultDays,
    ];
    if (numerics.some((n) => n !== undefined && !Number.isInteger(n))) {
      res
        .status(400)
        .json({ error: "Numeric configuration values must be integers." });
      return;
    }

    // Band cutoffs must be strictly ordered and in range so the bands stay
    // meaningful (low < medium < high < critical). Resolve each against the
    // current value when the caller omits it, then validate the merged set.
    const current = toActiveConfig(await getActiveConfigRow());
    const medium = d.bandCutoffs?.medium ?? current.risk.bandCutoffs.medium;
    const high = d.bandCutoffs?.high ?? current.risk.bandCutoffs.high;
    const critical =
      d.bandCutoffs?.critical ?? current.risk.bandCutoffs.critical;
    if (!(medium > 0 && medium < high && high < critical && critical <= 100)) {
      res.status(400).json({
        error: "Band cutoffs must satisfy 0 < medium < high < critical <= 100.",
      });
      return;
    }

    const user = getLocalUser(req);
    const updates: Partial<typeof appConfig.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: user?.id ?? null,
    };
    if (d.severityWeights) {
      updates.severityWeightFatal = d.severityWeights.fatal;
      updates.severityWeightLikelyFatal = d.severityWeights.likely_fatal;
      updates.severityWeightScoringRisk = d.severityWeights.scoring_risk;
      updates.severityWeightCosmetic = d.severityWeights.cosmetic;
    }
    if (d.missingEvidenceWeight !== undefined) {
      updates.missingEvidenceWeight = d.missingEvidenceWeight;
    }
    if (d.bandCutoffs) {
      updates.bandMediumCutoff = medium;
      updates.bandHighCutoff = high;
      updates.bandCriticalCutoff = critical;
    }
    if (d.firmName !== undefined) updates.firmName = d.firmName;
    if (d.confidentialityLegend !== undefined) {
      updates.confidentialityLegend = d.confidentialityLegend;
    }
    if (d.retentionDefaultDays !== undefined) {
      updates.retentionDefaultDays = d.retentionDefaultDays;
    }

    // Ensure the singleton exists before updating (first-ever write).
    await getActiveConfigRow();
    const [updated] = await db
      .update(appConfig)
      .set(updates)
      .where(eq(appConfig.id, APP_CONFIG_ID))
      .returning();

    await writeAudit({
      user,
      organisationId: getOrganisationId(req),
      eventType: "config.updated",
      objectType: "app_config",
      objectId: APP_CONFIG_ID,
      details: `Configuration updated by ${user?.name || user?.email || "admin"}.`,
    });

    res.json(serializeConfig(updated));
  },
);

export default router;
