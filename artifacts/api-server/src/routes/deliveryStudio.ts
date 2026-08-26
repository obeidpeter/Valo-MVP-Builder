import { Router, type IRouter, type Request, type Response } from "express";
import { getLocalUser } from "../middlewares/auth";
import { commitTenantDatabaseBeforeResponse } from "../middlewares/databaseTenancy";
import { privateResponse } from "../middlewares/privateResponse";
import { getAccessContext, type AccessContext } from "../middlewares/tenancy";
import {
  createDrizzleDeliveryStudioRepository,
  DELIVERY_STUDIO_AUTHORITY_NOTE,
  DeliveryStudioError,
  DeliveryStudioService,
  type DeliveryStudioAction,
  type DeliveryStudioScope,
} from "../lib/deliveryStudio";
import {
  resolveCurrentDirectAuthority,
  type CurrentDirectAuthority,
} from "../lib/directMembershipAuthority";
import { UUID_PATTERN } from "../lib/identifierPatterns";
import { parseExpectedVersion, type Permission } from "../lib/permissions";
import type {
  ExactCitation,
  HumanReview,
  SourceDocument,
  SubjectReview,
} from "../lib/intelligence/domain";
import type {
  PortalFieldRequirementInput,
  PortalFileMappingInput,
  PortalPackageFileInput,
  PortalSubmissionRehearsalInput,
} from "../lib/intelligence/portalSubmissionRehearsal";
import { createBoundedJsonBody } from "./boundedJsonBody";

const DOMAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/iu;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/u;
const READ_PERMISSIONS = [
  "project:read",
  "draft:read",
  "defect:read",
  "package:read",
] as const satisfies readonly Permission[];
const PORTFOLIO_PERMISSIONS = [
  ...READ_PERMISSIONS,
  "analytics:read",
] as const satisfies readonly Permission[];

const ACTION_PERMISSIONS: Readonly<
  Record<DeliveryStudioAction["action"], readonly Permission[]>
> = {
  save_response: [
    ...READ_PERMISSIONS,
    "document:read",
    "evidence:read",
    "draft:write",
  ],
  review_response_claim: [...READ_PERMISSIONS, "draft:review"],
  start_red_team: [
    ...READ_PERMISSIONS,
    "draft:review",
    "defect:write",
    "intelligence:review",
  ],
  resolve_red_team_finding: [
    ...READ_PERMISSIONS,
    "defect:review",
    "intelligence:review",
  ],
  approve_red_team: [
    ...READ_PERMISSIONS,
    "draft:review",
    "defect:review",
    "package:sign_off",
    "intelligence:review",
  ],
  assemble_package: [...READ_PERMISSIONS, "package:generate"],
  rehearse_submission: [...READ_PERMISSIONS, "intelligence:review"],
};

export interface DeliveryStudioRouterOptions {
  readonly service?: Pick<
    DeliveryStudioService,
    "getStudio" | "execute" | "getPortfolio"
  >;
  readonly resolveAccess?: (request: Request) => AccessContext | undefined;
  readonly resolveActor?: (
    request: Request,
  ) => { readonly id: string; readonly name: string | null } | undefined;
  readonly resolveDirectAuthority?: (
    request: Request,
  ) => Promise<CurrentDirectAuthority | null>;
  readonly commitBeforeResponse?: (request: Request) => Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function textBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.length <= maximum
  );
}

function stringArray(value: unknown, maximum = 50): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => textBetween(entry, 1, 2_000))
  );
}

function parseHumanReview(value: unknown): HumanReview | null {
  if (
    !record(value) ||
    !exactKeys(value, ["state", "reviewerId", "reviewedAt", "note"]) ||
    !["unreviewed", "accepted", "rejected", "needs_changes"].includes(
      String(value.state),
    ) ||
    (value.reviewerId !== undefined &&
      !textBetween(value.reviewerId, 1, 128)) ||
    (value.reviewedAt !== undefined && !textBetween(value.reviewedAt, 1, 40)) ||
    (value.note !== undefined && !textBetween(value.note, 1, 5_000))
  ) {
    return null;
  }
  return value as unknown as HumanReview;
}

function parseSubjectReview(value: unknown): SubjectReview | null {
  if (
    !record(value) ||
    !exactKeys(value, ["subjectId", "review"]) ||
    !textBetween(value.subjectId, 1, 128)
  ) {
    return null;
  }
  const review = parseHumanReview(value.review);
  return review ? { subjectId: value.subjectId, review } : null;
}

function parseExactCitation(value: unknown): ExactCitation | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "sourceId",
      "sourceVersionId",
      "contentSha256",
      "startOffset",
      "endOffset",
      "quote",
      "page",
      "section",
    ]) ||
    !textBetween(value.sourceId, 1, 128) ||
    !textBetween(value.sourceVersionId, 1, 128) ||
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256) ||
    !Number.isSafeInteger(value.startOffset) ||
    !Number.isSafeInteger(value.endOffset) ||
    (value.startOffset as number) < 0 ||
    (value.endOffset as number) <= (value.startOffset as number) ||
    !textBetween(value.quote, 1, 20_000) ||
    (value.page !== undefined &&
      (!Number.isSafeInteger(value.page) || (value.page as number) < 1)) ||
    (value.section !== undefined && !textBetween(value.section, 1, 2_000))
  ) {
    return null;
  }
  return value as unknown as ExactCitation;
}

function parseCitations(value: unknown): readonly ExactCitation[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const citations = value.map(parseExactCitation);
  return citations.every((citation) => citation !== null)
    ? (citations as ExactCitation[])
    : null;
}

function parseSource(value: unknown): SourceDocument | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "sourceId",
      "versionId",
      "kind",
      "title",
      "content",
      "contentSha256",
      "capturedAt",
      "authority",
      "origin",
    ]) ||
    !textBetween(value.sourceId, 1, 128) ||
    !textBetween(value.versionId, 1, 128) ||
    ![
      "solicitation",
      "addendum",
      "company_evidence",
      "official_opportunity",
      "other",
    ].includes(String(value.kind)) ||
    !textBetween(value.title, 1, 2_000) ||
    !textBetween(value.content, 1, 2_000_000) ||
    typeof value.contentSha256 !== "string" ||
    !SHA256.test(value.contentSha256) ||
    !textBetween(value.capturedAt, 1, 40) ||
    !["authoritative", "corroborating", "unverified"].includes(
      String(value.authority),
    ) ||
    !textBetween(value.origin, 1, 2_000)
  ) {
    return null;
  }
  return value as unknown as SourceDocument;
}

function parsePortalField(value: unknown): PortalFieldRequirementInput | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "externalId",
      "label",
      "fieldType",
      "required",
      "uploadOrder",
      "ruleText",
      "maxFileBytes",
      "maxFileBytesText",
      "allowedExtensions",
      "requiredFilenamePrefix",
      "declarationText",
      "citations",
      "review",
    ]) ||
    !textBetween(value.externalId, 1, 128) ||
    !textBetween(value.label, 1, 2_000) ||
    (value.fieldType !== "file" && value.fieldType !== "declaration") ||
    typeof value.required !== "boolean" ||
    !Number.isSafeInteger(value.uploadOrder) ||
    (value.uploadOrder as number) < 1 ||
    !textBetween(value.ruleText, 1, 20_000) ||
    (value.maxFileBytes !== undefined &&
      (!Number.isSafeInteger(value.maxFileBytes) ||
        (value.maxFileBytes as number) < 1)) ||
    (value.maxFileBytesText !== undefined &&
      !textBetween(value.maxFileBytesText, 1, 2_000)) ||
    (value.allowedExtensions !== undefined &&
      !stringArray(value.allowedExtensions)) ||
    (value.requiredFilenamePrefix !== undefined &&
      !textBetween(value.requiredFilenamePrefix, 1, 2_000)) ||
    (value.declarationText !== undefined &&
      !textBetween(value.declarationText, 1, 20_000))
  ) {
    return null;
  }
  const citations = parseCitations(value.citations);
  const review = parseHumanReview(value.review);
  return citations && review
    ? ({
        ...value,
        citations,
        review,
      } as unknown as PortalFieldRequirementInput)
    : null;
}

function parsePortalFile(value: unknown): PortalPackageFileInput | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "externalId",
      "filename",
      "sizeBytes",
      "sizeText",
      "sha256",
      "citations",
      "review",
    ]) ||
    !textBetween(value.externalId, 1, 128) ||
    !textBetween(value.filename, 1, 500) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 1 ||
    !textBetween(value.sizeText, 1, 2_000) ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256)
  ) {
    return null;
  }
  const citations = parseCitations(value.citations);
  const review = parseHumanReview(value.review);
  return citations && review
    ? ({ ...value, citations, review } as unknown as PortalPackageFileInput)
    : null;
}

function parsePortalMapping(value: unknown): PortalFileMappingInput | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "externalId",
      "fieldExternalId",
      "fileExternalId",
      "rationale",
      "citations",
      "review",
    ]) ||
    !textBetween(value.externalId, 1, 128) ||
    !textBetween(value.fieldExternalId, 1, 128) ||
    !textBetween(value.fileExternalId, 1, 128) ||
    !textBetween(value.rationale, 1, 20_000)
  ) {
    return null;
  }
  const citations = parseCitations(value.citations);
  const review = parseHumanReview(value.review);
  return citations && review
    ? ({ ...value, citations, review } as unknown as PortalFileMappingInput)
    : null;
}

function parseRehearsal(value: unknown): PortalSubmissionRehearsalInput | null {
  if (
    !record(value) ||
    !exactKeys(value, [
      "sources",
      "fields",
      "files",
      "mappings",
      "rehearsalReview",
    ]) ||
    !Array.isArray(value.sources) ||
    !Array.isArray(value.fields) ||
    !Array.isArray(value.files) ||
    !Array.isArray(value.mappings) ||
    value.sources.length > 500 ||
    value.fields.length > 500 ||
    value.files.length > 500 ||
    value.mappings.length > 500
  ) {
    return null;
  }
  const sources = value.sources.map(parseSource);
  const fields = value.fields.map(parsePortalField);
  const files = value.files.map(parsePortalFile);
  const mappings = value.mappings.map(parsePortalMapping);
  const rehearsalReview =
    value.rehearsalReview === undefined
      ? undefined
      : parseSubjectReview(value.rehearsalReview);
  if (
    sources.some((entry) => !entry) ||
    fields.some((entry) => !entry) ||
    files.some((entry) => !entry) ||
    mappings.some((entry) => !entry) ||
    rehearsalReview === null
  ) {
    return null;
  }
  return {
    sources: sources as SourceDocument[],
    fields: fields as PortalFieldRequirementInput[],
    files: files as PortalPackageFileInput[],
    mappings: mappings as PortalFileMappingInput[],
    ...(rehearsalReview ? { rehearsalReview } : {}),
  };
}

export function parseDeliveryStudioAction(
  value: unknown,
): DeliveryStudioAction | null {
  if (!record(value) || typeof value.action !== "string") return null;
  switch (value.action) {
    case "save_response": {
      if (
        !exactKeys(value, [
          "action",
          "sectionKey",
          "title",
          "content",
          "changeSummary",
          "claims",
        ]) ||
        typeof value.sectionKey !== "string" ||
        !DOMAIN_ID.test(value.sectionKey) ||
        !textBetween(value.title, 1, 300) ||
        !textBetween(value.content, 1, 60_000) ||
        (value.changeSummary !== undefined &&
          !textBetween(value.changeSummary, 1, 2_000)) ||
        !Array.isArray(value.claims) ||
        value.claims.length < 1 ||
        value.claims.length > 500
      ) {
        return null;
      }
      const claims = value.claims.flatMap((candidate) => {
        if (
          !record(candidate) ||
          !exactKeys(candidate, [
            "claimKey",
            "text",
            "kind",
            "supportMode",
            "citations",
          ]) ||
          typeof candidate.claimKey !== "string" ||
          !DOMAIN_ID.test(candidate.claimKey) ||
          !textBetween(candidate.text, 1, 5_000) ||
          !["factual", "instructional", "opinion"].includes(
            String(candidate.kind),
          ) ||
          (candidate.supportMode !== undefined &&
            candidate.supportMode !== "exact_quote" &&
            candidate.supportMode !== "paraphrase") ||
          !Array.isArray(candidate.citations) ||
          candidate.citations.length > 500
        ) {
          return [];
        }
        const citations = candidate.citations.flatMap((citation) => {
          if (
            !record(citation) ||
            !exactKeys(citation, [
              "documentId",
              "documentVersionId",
              "pageNumber",
              "quote",
              "startOffset",
              "endOffset",
            ]) ||
            typeof citation.documentId !== "string" ||
            !UUID_PATTERN.test(citation.documentId) ||
            typeof citation.documentVersionId !== "string" ||
            !UUID_PATTERN.test(citation.documentVersionId) ||
            !Number.isSafeInteger(citation.pageNumber) ||
            (citation.pageNumber as number) < 1 ||
            !textBetween(citation.quote, 1, 20_000) ||
            (citation.startOffset === undefined) !==
              (citation.endOffset === undefined) ||
            (citation.startOffset !== undefined &&
              (!Number.isSafeInteger(citation.startOffset) ||
                !Number.isSafeInteger(citation.endOffset) ||
                (citation.startOffset as number) < 0 ||
                (citation.endOffset as number) <=
                  (citation.startOffset as number)))
          ) {
            return [];
          }
          return [citation];
        });
        if (
          citations.length !== candidate.citations.length ||
          (candidate.kind !== "opinion" && citations.length === 0)
        )
          return [];
        return [{ ...candidate, citations }];
      });
      if (
        claims.length !== value.claims.length ||
        new Set(
          value.claims.map((claim) =>
            record(claim) ? String(claim.claimKey) : "",
          ),
        ).size !== value.claims.length
      ) {
        return null;
      }
      return { ...value, claims } as unknown as DeliveryStudioAction;
    }
    case "review_response_claim":
      return exactKeys(value, ["action", "claimId", "decision", "note"]) &&
        typeof value.claimId === "string" &&
        UUID_PATTERN.test(value.claimId) &&
        ["accepted", "rejected", "needs_changes"].includes(
          String(value.decision),
        ) &&
        textBetween(value.note, 2, 5_000)
        ? (value as unknown as DeliveryStudioAction)
        : null;
    case "start_red_team": {
      if (
        !exactKeys(value, ["action", "policyVersion", "findings"]) ||
        !textBetween(value.policyVersion, 1, 128) ||
        !Array.isArray(value.findings) ||
        value.findings.length > 500
      ) {
        return null;
      }
      const valid = value.findings.every(
        (finding) =>
          record(finding) &&
          exactKeys(finding, [
            "category",
            "severity",
            "finding",
            "objectType",
            "objectId",
          ]) &&
          textBetween(finding.category, 1, 120) &&
          ["fatal", "likely_fatal", "scoring_risk", "cosmetic"].includes(
            String(finding.severity),
          ) &&
          textBetween(finding.finding, 1, 10_000) &&
          (finding.objectType === undefined ||
            textBetween(finding.objectType, 1, 120)) &&
          (finding.objectId === undefined ||
            (typeof finding.objectId === "string" &&
              UUID_PATTERN.test(finding.objectId))),
      );
      return valid ? (value as unknown as DeliveryStudioAction) : null;
    }
    case "resolve_red_team_finding":
      return exactKeys(value, ["action", "runId", "findingId", "resolution"]) &&
        typeof value.runId === "string" &&
        UUID_PATTERN.test(value.runId) &&
        typeof value.findingId === "string" &&
        UUID_PATTERN.test(value.findingId) &&
        textBetween(value.resolution, 2, 5_000)
        ? (value as unknown as DeliveryStudioAction)
        : null;
    case "approve_red_team":
      return exactKeys(value, ["action", "runId", "attestation"]) &&
        typeof value.runId === "string" &&
        UUID_PATTERN.test(value.runId) &&
        textBetween(value.attestation, 10, 2_000)
        ? (value as unknown as DeliveryStudioAction)
        : null;
    case "assemble_package":
      return exactKeys(value, ["action", "packageType"]) &&
        value.packageType === "submission"
        ? (value as unknown as DeliveryStudioAction)
        : null;
    case "rehearse_submission": {
      if (
        !exactKeys(value, ["action", "packageVersionId", "rehearsal"]) ||
        typeof value.packageVersionId !== "string" ||
        !UUID_PATTERN.test(value.packageVersionId)
      ) {
        return null;
      }
      const rehearsal = parseRehearsal(value.rehearsal);
      return rehearsal
        ? ({ ...value, rehearsal } as unknown as DeliveryStudioAction)
        : null;
    }
    default:
      return null;
  }
}

function sendError(response: Response, error: unknown): boolean {
  if (!(error instanceof DeliveryStudioError)) return false;
  const status =
    error.code === "invalid_request"
      ? 400
      : error.code === "not_found"
        ? 404
        : error.code === "stale_version"
          ? 412
          : 409;
  response.status(status).json({
    error: error.message,
    code: error.code,
    authorityNote: DELIVERY_STUDIO_AUTHORITY_NOTE,
  });
  return true;
}

export function createDeliveryStudioRouter(
  options: DeliveryStudioRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const service =
    options.service ??
    new DeliveryStudioService(createDrizzleDeliveryStudioRepository());
  const resolveAccess = options.resolveAccess ?? getAccessContext;
  const resolveActor =
    options.resolveActor ??
    ((request: Request) => {
      const actor = getLocalUser(request);
      return actor ? { id: actor.id, name: actor.name } : undefined;
    });
  const resolveDirectAuthority =
    options.resolveDirectAuthority ??
    ((request: Request) =>
      resolveCurrentDirectAuthority(
        resolveAccess(request),
        resolveActor(request)?.id,
      ));
  const commitBeforeResponse =
    options.commitBeforeResponse ?? commitTenantDatabaseBeforeResponse;

  const scope = async (
    request: Request,
    required: readonly Permission[],
  ): Promise<DeliveryStudioScope | null> => {
    const context = resolveAccess(request);
    const actor = resolveActor(request);
    const actorName = actor?.name?.trim();
    const authority = await resolveDirectAuthority(request);
    if (
      !context ||
      context.source !== "membership" ||
      !context.membershipId ||
      !actor ||
      !actorName ||
      !authority ||
      authority.organisationId !== context.organisationId ||
      authority.actorUserId !== actor.id ||
      authority.membershipId !== context.membershipId ||
      !required.every((permission) => authority.permissions.has(permission))
    ) {
      return null;
    }
    return {
      organisationId: authority.organisationId,
      actorUserId: authority.actorUserId,
      actorName,
      membershipId: authority.membershipId,
    };
  };

  router.use("/projects/:projectId/delivery-studio", privateResponse);
  router.use(
    "/projects/:projectId/delivery-studio/actions",
    createBoundedJsonBody(4_000_000, "operations"),
  );
  router.use("/portfolio-intelligence", privateResponse);

  router.get(
    "/projects/:projectId/delivery-studio",
    async (request, response, next) => {
      try {
        const requestScope = await scope(request, READ_PERMISSIONS);
        if (!requestScope) {
          response.status(403).json({ error: "Delivery Studio access denied" });
          return;
        }
        const result = await service.getStudio(
          requestScope,
          String(request.params.projectId),
        );
        response.setHeader("ETag", `"${result.version}"`);
        response.json(result);
      } catch (error) {
        if (!sendError(response, error)) next(error);
      }
    },
  );

  router.post(
    "/projects/:projectId/delivery-studio/actions",
    async (request, response, next) => {
      const data = parseDeliveryStudioAction(request.body);
      const ifMatch = parseExpectedVersion(request.get("If-Match"));
      const idempotencyKey = request.get("Idempotency-Key")?.trim() ?? "";
      try {
        const requestScope = await scope(
          request,
          data ? ACTION_PERMISSIONS[data.action] : READ_PERMISSIONS,
        );
        if (!requestScope) {
          response.status(403).json({ error: "Delivery Studio action denied" });
          return;
        }
        if (!ifMatch) {
          response.status(428).json({
            error: "A valid If-Match project version is required.",
            authorityNote: DELIVERY_STUDIO_AUTHORITY_NOTE,
          });
          return;
        }
        if (!data || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
          response.status(400).json({
            error:
              "A valid action body, If-Match, and Idempotency-Key are required.",
            authorityNote: DELIVERY_STUDIO_AUTHORITY_NOTE,
          });
          return;
        }
        const projectId = String(request.params.projectId);
        const result = await service.execute({
          scope: requestScope,
          projectId,
          data,
          ifMatch,
          idempotencyKey,
        });
        await commitBeforeResponse(request);
        response.setHeader("ETag", `"${result.data.version}"`);
        response.status(result.outcome === "recorded" ? 201 : 200).json(result);
      } catch (error) {
        if (!sendError(response, error)) next(error);
      }
    },
  );

  router.get("/portfolio-intelligence", async (request, response, next) => {
    try {
      const requestScope = await scope(request, PORTFOLIO_PERMISSIONS);
      if (!requestScope) {
        response
          .status(403)
          .json({ error: "Portfolio intelligence access denied" });
        return;
      }
      response.json(await service.getPortfolio(requestScope));
    } catch (error) {
      if (!sendError(response, error)) next(error);
    }
  });

  return router;
}

export default createDeliveryStudioRouter();
