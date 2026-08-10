import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, reviews, users } from "@workspace/db";
import { INTELLIGENCE_CAPABILITY_IDS } from "../lib/intelligence/snapshot";
import type { Permission } from "../lib/permissions";
import { getLocalUser } from "../middlewares/auth";
import {
  getAccessContext,
  getOrganisationId,
  hasRequestPermission,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import {
  EVIDENCE_LAYER_BOUNDS,
  EVIDENCE_LAYER_POLICY_VERSION,
  searchEvidenceLayer,
} from "../lib/intelligence/evidenceLayer";
import {
  buildIntelligenceReviewInbox,
  intelligenceCapabilityFromReviewType,
} from "../lib/intelligence/reviewInbox";
import {
  loadIntelligenceSourceBinding,
  loadIntelligenceSourceProjection,
} from "../lib/intelligence/intelligenceSourceBindingStore";
import { loadProjectEvidenceLayer } from "../lib/intelligence/evidenceLayerStore";
import {
  claimIntelligenceReview,
  decideIntelligenceReview,
  parseIntelligenceReviewFindings,
  IntelligenceReviewMutationError,
  isValidIntelligenceReviewerName,
  parseIntelligenceReviewClaimBody,
  parseIntelligenceReviewDecisionBody,
} from "../lib/intelligence/intelligenceReviewStore";

const router: IRouter = Router();

const INTELLIGENCE_READ_PERMISSIONS = [
  "client:read",
  "project:read",
  "document:read",
  "requirement:read",
  "evidence:read",
  "defect:read",
  "report:read",
  "draft:read",
  "package:read",
  "evaluation:read",
] as const satisfies readonly Permission[];

const REVIEW_PROJECTION_BOUNDS = Object.freeze({
  rows: INTELLIGENCE_CAPABILITY_IDS.length,
  codeUnitsPerRow: 32_768,
  bytesPerRow: 65_536,
  totalBytes: 1_048_576,
});

function boundedLength(value: number | string | null): number | null {
  if (value === null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicEnvironment(): "production" | "staging" | "development" {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.VALO_ENVIRONMENT === "staging") return "staging";
  return "development";
}

function publicReviewerName(value: unknown): string | null {
  return isValidIntelligenceReviewerName(value) ? value : null;
}

function parseEvidenceSearchBody(value: unknown): {
  query: string;
  expectedManifestSha256: string;
  limit: number;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) => !["query", "expectedManifestSha256", "limit"].includes(key),
    ) ||
    typeof body.query !== "string" ||
    body.query.trim().length === 0 ||
    body.query.length > EVIDENCE_LAYER_BOUNDS.maxQueryCodeUnits ||
    Buffer.byteLength(body.query, "utf8") >
      EVIDENCE_LAYER_BOUNDS.maxQueryBytes ||
    typeof body.expectedManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(body.expectedManifestSha256) ||
    (body.limit !== undefined &&
      (!Number.isSafeInteger(body.limit) ||
        (body.limit as number) < 1 ||
        (body.limit as number) > 20))
  ) {
    return null;
  }
  return {
    query: body.query,
    expectedManifestSha256: body.expectedManifestSha256,
    limit: typeof body.limit === "number" ? body.limit : 10,
  };
}

function sendIntelligenceReviewError(res: Response, error: unknown): boolean {
  if (!(error instanceof IntelligenceReviewMutationError)) return false;
  res.status(error.code === "invalid_request" ? 400 : 409).json({
    error: "The review could not be changed.",
    code: error.code,
  });
  return true;
}

function publicReviewMutation(
  result: Awaited<ReturnType<typeof claimIntelligenceReview>>,
  input: {
    capabilityId: string;
    reviewerName: string;
    sourceManifestSha256: string;
  },
) {
  return {
    replayed: result.replayed,
    authorityNote:
      "This review records a named person's assessment only. It does not approve source evidence, release a package or authorise model execution.",
    review: {
      id: result.review.id,
      capabilityId: input.capabilityId,
      status: result.review.status,
      reviewerName: input.reviewerName,
      sourceVersion: result.review.sourceVersion,
      sourceManifestSha256: input.sourceManifestSha256,
      version: result.review.version,
      completedAt: iso(result.review.completedAt),
      updatedAt: iso(result.review.updatedAt),
    },
  };
}

router.get(
  "/projects/:id/intelligence",
  ...INTELLIGENCE_READ_PERMISSIONS.map((permission) =>
    requirePermissionOrLegacy(permission),
  ),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const organisationId = getOrganisationId(req);
    const actor = getLocalUser(req);
    const access = getAccessContext(req);
    if (!organisationId || !actor || !access) {
      res.status(403).json({ error: "Organisation access denied" });
      return;
    }
    const projectId = String(req.params.id);
    const evaluatedAt = new Date();
    const [projection, loadedEvidence] = await Promise.all([
      loadIntelligenceSourceProjection(projectId, {
        organisationId,
        now: evaluatedAt,
        environment: publicEnvironment(),
      }),
      loadProjectEvidenceLayer({
        organisationId,
        projectId,
        actorUserId: actor.id,
        permissions: [...access.permissions],
        requestedMode: "verified_spans",
        now: evaluatedAt,
      }),
    ]);
    if (!projection || !loadedEvidence) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const snapshot = projection.snapshot;
    const sourceBinding = projection.source;
    const evidenceLayer = loadedEvidence.layer;
    const reviewWhere = and(
      eq(reviews.organisationId, organisationId),
      eq(reviews.projectId, projectId),
      eq(reviews.objectType, "intelligence_capability"),
      eq(reviews.objectId, projectId),
    );
    const reviewIdRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(reviewWhere)
      .limit(REVIEW_PROJECTION_BOUNDS.rows + 1);
    if (reviewIdRows.length > REVIEW_PROJECTION_BOUNDS.rows) {
      res.status(409).json({ error: "Review projection exceeds its bound" });
      return;
    }

    const reviewIds = reviewIdRows.map(({ id }) => id);
    const reviewLengthRows =
      reviewIds.length === 0
        ? []
        : await db
            .select({
              id: reviews.id,
              codeUnits: sql<number>`greatest(
                coalesce(char_length(${reviews.reviewType}), 0),
                coalesce(char_length(${reviews.objectType}), 0),
                coalesce(char_length(${reviews.status}), 0),
                coalesce(char_length(${reviews.findings}), 0),
                coalesce(char_length(${users.name}), 0)
              )`,
              bytes: sql<number>`
                coalesce(octet_length(${reviews.reviewType}), 0) +
                coalesce(octet_length(${reviews.objectType}), 0) +
                coalesce(octet_length(${reviews.status}), 0) +
                coalesce(octet_length(${reviews.findings}), 0) +
                coalesce(octet_length(${users.name}), 0)
              `,
            })
            .from(reviews)
            .leftJoin(users, eq(reviews.reviewerUserId, users.id))
            .where(and(reviewWhere, inArray(reviews.id, reviewIds)))
            .limit(REVIEW_PROJECTION_BOUNDS.rows);
    let reviewBytes = 0;
    const invalidReviewLengths =
      reviewLengthRows.length !== reviewIds.length ||
      reviewLengthRows.some(({ id, codeUnits, bytes }) => {
        const boundedCodeUnits = boundedLength(codeUnits);
        const boundedBytes = boundedLength(bytes);
        if (
          !reviewIds.includes(id) ||
          boundedCodeUnits === null ||
          boundedBytes === null ||
          boundedCodeUnits > REVIEW_PROJECTION_BOUNDS.codeUnitsPerRow ||
          boundedBytes > REVIEW_PROJECTION_BOUNDS.bytesPerRow
        ) {
          return true;
        }
        reviewBytes += boundedBytes;
        return (
          !Number.isSafeInteger(reviewBytes) ||
          reviewBytes > REVIEW_PROJECTION_BOUNDS.totalBytes
        );
      });
    if (invalidReviewLengths) {
      res.status(409).json({ error: "Review projection is invalid" });
      return;
    }

    const reviewRows =
      reviewIds.length === 0
        ? []
        : await db
            .select({
              review: reviews,
              reviewerName: users.name,
            })
            .from(reviews)
            .leftJoin(users, eq(reviews.reviewerUserId, users.id))
            .where(and(reviewWhere, inArray(reviews.id, reviewIds)))
            .limit(REVIEW_PROJECTION_BOUNDS.rows);
    if (
      reviewRows.length !== reviewIds.length ||
      reviewRows.some(({ review }) => !reviewIds.includes(review.id))
    ) {
      res
        .status(409)
        .json({ error: "Review projection changed while loading" });
      return;
    }
    const reviewCapabilityIds = reviewRows.map(({ review }) =>
      intelligenceCapabilityFromReviewType(review.reviewType),
    );
    if (
      reviewCapabilityIds.some((capabilityId) => capabilityId === null) ||
      new Set(reviewCapabilityIds).size !== reviewCapabilityIds.length
    ) {
      res.status(409).json({ error: "Review projection is invalid" });
      return;
    }

    const reviewInbox = buildIntelligenceReviewInbox({
      snapshot,
      sourceVersion: sourceBinding.version,
      sourceManifestSha256: sourceBinding.manifestHash,
      actorUserId: actor.id,
      reviews: reviewRows.map(({ review, reviewerName }) => {
        const findings = parseIntelligenceReviewFindings(review.findings);
        return {
          id: review.id,
          projectId: review.projectId,
          reviewType: review.reviewType,
          objectType: review.objectType,
          objectId: review.objectId,
          reviewerUserId: review.reviewerUserId,
          reviewerName: publicReviewerName(reviewerName),
          status: review.status,
          sourceVersion: review.sourceVersion,
          sourceManifestHash: findings?.sourceManifestSha256 ?? null,
          findingsValid: findings !== null,
          findingsDecision: findings?.decision ?? null,
          version: review.version,
          completedAt: iso(review.completedAt),
          updatedAt: iso(review.updatedAt),
        };
      }),
      readOnly: !hasRequestPermission(req, "intelligence:review"),
    });

    res.json({
      ...snapshot,
      evidenceLayer: {
        policyVersion: EVIDENCE_LAYER_POLICY_VERSION,
        disposition: evidenceLayer.disposition,
        requestedMode: evidenceLayer.requestedMode,
        actualMode: evidenceLayer.actualMode,
        manifestSha256: evidenceLayer.manifestSha256,
        versionSha256: evidenceLayer.versionSha256,
        sourceCount: evidenceLayer.sources.length,
        rejectedCount: evidenceLayer.rejected.length,
        blockers: evidenceLayer.blockers.map(({ code, path }) => ({
          code,
          path,
        })),
        coverage: evidenceLayer.coverage,
      },
      reviewInbox,
    });
  },
);

router.post(
  "/projects/:id/intelligence/evidence-search",
  ...(
    [
      "project:read",
      "document:read",
      "requirement:read",
      "evidence:read",
    ] as const
  ).map((permission) => requirePermissionOrLegacy(permission)),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const body = parseEvidenceSearchBody(req.body);
    if (!body) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organisationId = getOrganisationId(req);
    const actor = getLocalUser(req);
    const access = getAccessContext(req);
    if (!organisationId || !actor || !access) {
      res.status(403).json({ error: "Organisation access denied" });
      return;
    }
    const loaded = await loadProjectEvidenceLayer({
      organisationId,
      projectId: String(req.params.id),
      actorUserId: actor.id,
      permissions: [...access.permissions],
    });
    if (!loaded) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const result = searchEvidenceLayer(loaded.layer, {
      actor: loaded.actor,
      expectedManifestSha256: body.expectedManifestSha256,
      query: body.query,
      limit: body.limit,
    });
    res.json({
      disposition: result.disposition,
      abstentionReason: result.abstentionReason ?? null,
      querySha256: result.querySha256,
      searchManifestSha256: result.searchManifestSha256,
      blockers: result.blockers.map(({ code, path }) => ({ code, path })),
      matches: result.matches.map((match) => ({
        citationId: match.source.citationId,
        requirementId: match.source.requirementId,
        documentId: match.source.documentId,
        documentVersionId: match.source.documentVersionId,
        documentVersionNumber: match.source.documentVersionNumber,
        sourceName: match.source.sourceName,
        sourceSha256: match.source.sourceSha256,
        snippetSha256: match.source.snippetSha256,
        excerpt: match.source.text,
        locator: match.source.locator,
        verifierName: match.source.verifier.name,
        verifiedAt: match.source.verifier.verifiedAt,
        lexicalScoreBasisPoints: match.lexicalScoreBasisPoints,
        exactPhraseMatch: match.exactPhraseMatch,
        matchedTokens: match.matchedTokens,
        instructionAuthority: match.source.instructionAuthority,
      })),
    });
  },
);

router.post(
  "/projects/:id/intelligence/reviews/claim",
  ...INTELLIGENCE_READ_PERMISSIONS.map((permission) =>
    requirePermissionOrLegacy(permission),
  ),
  requirePermissionOrLegacy("intelligence:review"),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const body = parseIntelligenceReviewClaimBody(req.body);
    if (!body) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organisationId = getOrganisationId(req);
    const actor = getLocalUser(req);
    if (!organisationId || !actor) {
      res.status(403).json({ error: "Organisation access denied" });
      return;
    }
    const reviewerName = publicReviewerName(actor.name);
    if (!reviewerName) {
      res
        .status(400)
        .json({ error: "A valid named reviewer profile is required" });
      return;
    }
    const projectId = String(req.params.id);
    const source = await loadIntelligenceSourceBinding(projectId, {
      organisationId,
    });
    if (!source) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const result = await claimIntelligenceReview({
        organisationId,
        projectId,
        actor,
        source,
        body,
      });
      res.json(
        publicReviewMutation(result, {
          capabilityId: body.capabilityId,
          reviewerName,
          sourceManifestSha256: source.manifestHash,
        }),
      );
    } catch (error) {
      if (!sendIntelligenceReviewError(res, error)) throw error;
    }
  },
);

router.post(
  "/projects/:id/intelligence/reviews/decision",
  ...INTELLIGENCE_READ_PERMISSIONS.map((permission) =>
    requirePermissionOrLegacy(permission),
  ),
  requirePermissionOrLegacy("intelligence:review"),
  async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    const body = parseIntelligenceReviewDecisionBody(req.body);
    if (!body) {
      res.status(400).json({ error: "Invalid request" });
      return;
    }
    const organisationId = getOrganisationId(req);
    const actor = getLocalUser(req);
    if (!organisationId || !actor) {
      res.status(403).json({ error: "Organisation access denied" });
      return;
    }
    const reviewerName = publicReviewerName(actor.name);
    if (!reviewerName) {
      res
        .status(400)
        .json({ error: "A valid named reviewer profile is required" });
      return;
    }
    const projectId = String(req.params.id);
    const source = await loadIntelligenceSourceBinding(projectId, {
      organisationId,
    });
    if (!source) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      const result = await decideIntelligenceReview({
        organisationId,
        projectId,
        actor,
        source,
        body,
      });
      res.json(
        publicReviewMutation(result, {
          capabilityId: body.capabilityId,
          reviewerName,
          sourceManifestSha256: source.manifestHash,
        }),
      );
    } catch (error) {
      if (!sendIntelligenceReviewError(res, error)) throw error;
    }
  },
);

export default router;
