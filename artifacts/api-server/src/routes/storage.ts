import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  DiscardUploadBody,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  ObjectStorageService,
  ObjectNotFoundError,
} from "../lib/objectStorage";
import { getMaxUploadBytes } from "../lib/intakeLimits";
import {
  getOrganisationId,
  requirePermissionOrLegacy,
} from "../middlewares/tenancy";
import { getLocalUser } from "../middlewares/auth";
import { writeAudit } from "../lib/audit";
import {
  discardStagedUpload,
  isOwnedStagedUploadPath,
  UnsafeStagedUploadPathError,
} from "../lib/stagedUploadCleanup";
import { lockStagedUploadObject } from "../lib/stagedUploadLock";
import {
  hasSecurityQuarantinedDocumentReference,
  storagePathReferenceKinds,
} from "../lib/storageReferences";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post(
  "/storage/uploads/request-url",
  requirePermissionOrLegacy("document:upload"),
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      const maxUploadBytes = getMaxUploadBytes();
      if (size > maxUploadBytes) {
        res.status(413).json({
          error: "Upload exceeds the configured byte limit",
          maxUploadBytes,
        });
        return;
      }

      const organisationId = getOrganisationId(req);
      const uploadURL =
        await objectStorageService.getObjectEntityUploadURL(organisationId);
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * POST /storage/uploads/discard
 *
 * Best-effort rollback for the narrow failure window after a signed PUT has
 * succeeded but document registration has failed. The client submits only the
 * normalised object path; this authenticated endpoint derives deletion
 * authority from the active tenant and never follows or reuses a signed URL.
 */
router.post(
  "/storage/uploads/discard",
  requirePermissionOrLegacy("document:upload"),
  async (req: Request, res: Response) => {
    const parsed = DiscardUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid object path" });
      return;
    }
    const organisationId = getOrganisationId(req);
    if (!organisationId) {
      res.status(400).json({
        error: "An active organisation is required to discard a staged upload",
      });
      return;
    }
    const user = getLocalUser(req);

    try {
      if (!isOwnedStagedUploadPath(parsed.data.objectPath, organisationId)) {
        throw new UnsafeStagedUploadPathError();
      }
      // Registration takes this identical transaction-scoped lock before its
      // final existence check and insert. Holding it across the reference
      // check and object deletion closes the check/delete TOCTOU window.
      await lockStagedUploadObject(parsed.data.objectPath);
      const result = await discardStagedUpload(
        { objectPath: parsed.data.objectPath, organisationId },
        {
          isReferenced: async (objectPath) =>
            (await storagePathReferenceKinds(objectPath)).length > 0,
          deleteObject: (objectPath) =>
            objectStorageService.deleteObjectEntity(objectPath),
        },
      );

      if (result === "referenced") {
        await writeAudit({
          user,
          organisationId,
          eventType: "storage.upload_discard_denied",
          objectType: "staged_upload",
          objectId: parsed.data.objectPath.split("/").at(-1) ?? null,
          details:
            "Cleanup denied because a persisted tenant artefact already references this staged object; storage was not changed.",
        });
        res.status(409).json({
          error:
            "The uploaded object is already referenced by a tenant artefact and was not deleted.",
        });
        return;
      }

      await writeAudit({
        user,
        organisationId,
        eventType: "storage.upload_discarded",
        objectType: "staged_upload",
        objectId: parsed.data.objectPath.split("/").at(-1) ?? null,
        details:
          result === "deleted"
            ? "Unreferenced staged object purged after document registration failed."
            : "The original staging path was already absent. This does not assert that a controlled security-quarantine copy was purged.",
      });
      res.status(200).json({
        disposition: result,
        quarantineMayRetainCopy: result === "already_absent",
      });
    } catch (error) {
      if (error instanceof UnsafeStagedUploadPathError) {
        await writeAudit({
          user,
          organisationId,
          eventType: "storage.upload_discard_denied",
          objectType: "staged_upload",
          details:
            "Cleanup denied because the supplied path was outside the active tenant's staging namespace.",
        });
        res.status(400).json({
          error: "Upload object is outside the authorised staging namespace",
        });
        return;
      }
      req.log.error(
        { err: error, objectPath: parsed.data.objectPath },
        "failed to discard unreferenced staged upload",
      );
      await writeAudit({
        user,
        organisationId,
        eventType: "storage.upload_discard_failed",
        objectType: "staged_upload",
        objectId: parsed.data.objectPath.split("/").at(-1) ?? null,
        details:
          "Staged-object cleanup could not be confirmed after document registration failed.",
      }).catch((auditError) => {
        req.log.error(
          { err: auditError },
          "failed to audit staged-upload cleanup failure",
        );
      });
      res.status(500).json({
        error:
          "The document was not registered, but cleanup of its staged object could not be confirmed. Contact an administrator before retrying.",
      });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  "/storage/public-objects/*filePath",
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join("/") : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, "Error serving public object");
      res.status(500).json({ error: "Failed to serve public object" });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve only registered document and Certificate Vault source objects. The
 * tenant/permission gate is followed by persisted-reference classification;
 * unreferenced staging, quarantine/version objects and controlled report or
 * package outputs fail closed. Documents in the persisted logical security-
 * quarantine state also fail closed without a storage read. Every role
 * admitted to Vault reads also carries document:read (enforced by a
 * permission-policy invariant test). Allowed reads are audited as authorised
 * before streaming; the event does not overclaim stream completion.
 */
router.get(
  "/storage/objects/*path",
  requirePermissionOrLegacy("document:read"),
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const organisationId = getOrganisationId(req);
      if (
        organisationId &&
        !wildcardPath.startsWith(`tenants/${organisationId}/`)
      ) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      if (/^tenants\/[0-9a-f-]{36}\/quarantine\//i.test(wildcardPath)) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const objectPath = `/objects/${wildcardPath}`;
      const references = await storagePathReferenceKinds(objectPath);
      const securityQuarantined =
        await hasSecurityQuarantinedDocumentReference(objectPath);
      const controlledOutput = references.some((reference) =>
        ["report", "package_version", "partner_branding"].includes(reference),
      );
      const readableSource = references.some((reference) =>
        ["document", "vault_item"].includes(reference),
      );
      // Generic object reads are for registered source/vault artefacts only.
      // Report/package outputs must flow through their guarded export routes;
      // unreferenced staging and version/quarantine objects fail closed.
      if (securityQuarantined || controlledOutput || !readableSource) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      const objectFile =
        await objectStorageService.getObjectEntityFile(objectPath);

      // Sensitive source downloads are part of the immutable tenant audit
      // chain. Audit before streaming; an audit failure fails closed and no
      // object bytes are sent.
      await writeAudit({
        user: getLocalUser(req),
        organisationId,
        eventType: "storage.object_download_authorized",
        objectType: "storage_object",
        objectId: objectPath.split("/").at(-1) ?? null,
        details: JSON.stringify({
          referenceKinds: references,
          disposition: "authorized_before_stream",
        }),
      });

      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
