import { describe, expect, it, vi } from "vitest";
import {
  completeDocumentUpload,
  DocumentRegistrationError,
} from "./document-upload";

const projectId = "project-1";
const file = new File(["tender contents"], "ITT-response.pdf", {
  type: "application/pdf",
});
const deletedCleanup = {
  disposition: "deleted" as const,
  quarantineMayRetainCopy: false,
};

describe("completeDocumentUpload", () => {
  it("does not create a document record when the signed PUT is rejected", async () => {
    const requestUploadTarget = vi.fn().mockResolvedValue({
      uploadURL: "https://objects.example.test/signed-upload",
      objectPath: "objects/project-1/itt-response.pdf",
    });
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );
    const createDocumentRecord = vi.fn();
    const discardUploadedObject = vi.fn().mockResolvedValue(deletedCleanup);

    await expect(
      completeDocumentUpload({
        projectId,
        file,
        requestUploadTarget,
        createDocumentRecord,
        discardUploadedObject,
        fetchImpl,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "SignedUploadError",
        status: 503,
        message: expect.stringMatching(/no document record was created/i),
      }),
    );

    expect(createDocumentRecord).not.toHaveBeenCalled();
    expect(discardUploadedObject).toHaveBeenCalledWith({
      objectPath: "objects/project-1/itt-response.pdf",
    });
  });

  it("creates the excluded document record only after a successful PUT", async () => {
    const events: string[] = [];
    const requestUploadTarget = vi.fn().mockResolvedValue({
      uploadURL: "https://objects.example.test/signed-upload",
      objectPath: "objects/project-1/itt-response.pdf",
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      events.push("put");
      return new Response(null, { status: 200 });
    });
    const createDocumentRecord = vi.fn().mockImplementation(async () => {
      events.push("record");
    });
    const discardUploadedObject = vi.fn();

    await completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget,
      createDocumentRecord,
      discardUploadedObject,
      fetchImpl,
    });

    expect(events).toEqual(["put", "record"]);
    expect(createDocumentRecord).toHaveBeenCalledWith({
      id: projectId,
      data: expect.objectContaining({
        filename: "ITT-response.pdf",
        type: "tender",
        redactionStatus: "excluded",
      }),
    });
    expect(discardUploadedObject).not.toHaveBeenCalled();
  });

  it("pauses retry when the signed PUT response is ambiguous", async () => {
    const createDocumentRecord = vi.fn();
    const discardUploadedObject = vi.fn().mockResolvedValue(deletedCleanup);

    const result = completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget: vi.fn().mockResolvedValue({
        uploadURL: "https://objects.example.test/signed-upload",
        objectPath: "objects/project-1/itt-response.pdf",
      }),
      createDocumentRecord,
      discardUploadedObject,
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("Network error")),
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: "SignedUploadOutcomeUnknownError",
        retrySafe: false,
        cleanupConfirmed: true,
        message: expect.stringMatching(/late storage write may still arrive/i),
      }),
    );
    expect(createDocumentRecord).not.toHaveBeenCalled();
    expect(discardUploadedObject).toHaveBeenCalledTimes(1);
  });

  it("discards the staged object and rejects when record creation fails after PUT", async () => {
    const registrationFailure = Object.assign(
      new Error("registration unavailable"),
      {
        data: {
          error: "registration unavailable",
          cleanupConfirmed: true,
          storedObjectDisposition: "no promoted copy was retained",
        },
      },
    );
    const discardUploadedObject = vi.fn().mockResolvedValue(deletedCleanup);

    await expect(
      completeDocumentUpload({
        projectId,
        file,
        requestUploadTarget: vi.fn().mockResolvedValue({
          uploadURL: "https://objects.example.test/signed-upload",
          objectPath: "/objects/tenants/tenant-1/uploads/object-1",
        }),
        createDocumentRecord: vi.fn().mockRejectedValue(registrationFailure),
        discardUploadedObject,
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 200 })),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "DocumentRegistrationError",
        cleanupConfirmed: true,
        cleanupDisposition: "deleted",
        registrationCause: registrationFailure,
      }),
    );

    expect(discardUploadedObject).toHaveBeenCalledWith({
      objectPath: "/objects/tenants/tenant-1/uploads/object-1",
    });
  });

  it("does not claim purge when secure intake moved the object out of staging", async () => {
    const quarantineFailure = Object.assign(
      new Error("secure intake quarantined the object"),
      {
        data: {
          storedObjectDisposition: "moved to inaccessible quarantine",
          quarantineRetained: true,
          cleanupConfirmed: true,
          findings: ["malware_scan_incomplete"],
        },
      },
    );
    const result = completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget: vi.fn().mockResolvedValue({
        uploadURL: "https://objects.example.test/signed-upload",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
      }),
      createDocumentRecord: vi.fn().mockRejectedValue(quarantineFailure),
      discardUploadedObject: vi.fn().mockResolvedValue({
        disposition: "already_absent",
        quarantineMayRetainCopy: true,
      }),
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        cleanupConfirmed: true,
        cleanupDisposition: "already_absent",
        quarantineMayRetainCopy: true,
        intakeDisposition: "moved to inaccessible quarantine",
        intakeFindings: ["malware_scan_incomplete"],
        message: expect.stringMatching(
          /security-quarantine copy remains retained/i,
        ),
      }),
    );
    await expect(result).rejects.not.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/was purged/i),
      }),
    );
  });

  it("does not let absent staging override unconfirmed promoted-copy cleanup", async () => {
    const stableCleanupFailure = Object.assign(
      new Error("stable cleanup unconfirmed"),
      {
        data: {
          error: "cleanup could not be confirmed",
          storedObjectDisposition:
            "promoted copy cleanup could not be confirmed",
          cleanupConfirmed: false,
        },
      },
    );

    const result = completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget: vi.fn().mockResolvedValue({
        uploadURL: "https://objects.example.test/signed-upload",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
      }),
      createDocumentRecord: vi.fn().mockRejectedValue(stableCleanupFailure),
      discardUploadedObject: vi.fn().mockResolvedValue({
        disposition: "already_absent",
        quarantineMayRetainCopy: false,
      }),
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        cleanupConfirmed: false,
        retrySafe: false,
        cleanupDisposition: "already_absent",
        intakeDisposition: "promoted copy cleanup could not be confirmed",
        message: expect.stringMatching(/contact an administrator/i),
      }),
    );
    await expect(result).rejects.not.toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/you can retry/i),
      }),
    );
  });

  it("does not let absent staging override an ACK-ambiguous quarantine copy", async () => {
    const quarantineAmbiguity = Object.assign(
      new Error("quarantine copy acknowledgement lost"),
      {
        data: {
          error: "quarantine disposition unknown",
          storedObjectDisposition:
            "original staging object already absent; security-quarantine copy disposition remains unconfirmed",
          quarantineRetained: null,
          cleanupConfirmed: false,
        },
      },
    );

    const result = completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget: vi.fn().mockResolvedValue({
        uploadURL: "https://objects.example.test/signed-upload",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
      }),
      createDocumentRecord: vi.fn().mockRejectedValue(quarantineAmbiguity),
      discardUploadedObject: vi.fn().mockResolvedValue({
        disposition: "already_absent",
        quarantineMayRetainCopy: true,
      }),
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        cleanupConfirmed: false,
        retrySafe: false,
        cleanupDisposition: "already_absent",
        message: expect.stringMatching(/disposition remains unconfirmed/i),
      }),
    );
  });

  it("keeps a lost create response unconfirmed even after staging cleanup", async () => {
    const result = completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget: vi.fn().mockResolvedValue({
        uploadURL: "https://objects.example.test/signed-upload",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
      }),
      createDocumentRecord: vi
        .fn()
        .mockRejectedValue(new TypeError("response connection closed")),
      discardUploadedObject: vi.fn().mockResolvedValue({
        disposition: "already_absent",
        quarantineMayRetainCopy: false,
      }),
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        cleanupConfirmed: false,
        retrySafe: false,
        message: expect.stringMatching(
          /registration result.*could not be confirmed/i,
        ),
      }),
    );
  });

  it("fails closed when neither registration nor staged-object cleanup can be confirmed", async () => {
    const cleanupFailure = new Error("cleanup unavailable");

    const result = completeDocumentUpload({
      projectId,
      file,
      requestUploadTarget: vi.fn().mockResolvedValue({
        uploadURL: "https://objects.example.test/signed-upload",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
      }),
      createDocumentRecord: vi
        .fn()
        .mockRejectedValue(new Error("record failed")),
      discardUploadedObject: vi.fn().mockRejectedValue(cleanupFailure),
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    });

    await expect(result).rejects.toBeInstanceOf(DocumentRegistrationError);
    await expect(result).rejects.toEqual(
      expect.objectContaining({
        cleanupConfirmed: false,
        cleanupCause: cleanupFailure,
        message: expect.stringMatching(/contact an administrator/i),
      }),
    );
  });
});
