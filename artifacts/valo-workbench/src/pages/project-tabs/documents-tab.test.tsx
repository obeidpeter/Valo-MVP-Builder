import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsTab } from "./documents-tab";

const stagedObjectPath =
  "/objects/tenants/11111111-1111-4111-8111-111111111111/uploads/33333333-3333-4333-8333-333333333333";
const deletedCleanup = {
  disposition: "deleted" as const,
  quarantineMayRetainCopy: false as const,
};

const mocks = vi.hoisted(() => ({
  createDocument: vi.fn(),
  discardUpload: vi.fn(),
  extractDocument: vi.fn(),
  requestUploadUrl: vi.fn(),
  toast: vi.fn(),
  beginCriticalWorkflow: vi.fn(),
  releaseCriticalWorkflow: vi.fn(),
  documents: [] as Array<Record<string, unknown>>,
  permissions: new Set<string>(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    mocks.permissions.has(permission),
  useOrganisationAccess: () => ({
    beginCriticalWorkflow: mocks.beginCriticalWorkflow,
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListDocumentsQueryKey: (id: string) => ["documents", id],
  useListDocuments: () => ({ data: mocks.documents, isLoading: false }),
  useCreateDocument: () => ({ mutateAsync: mocks.createDocument }),
  useDiscardUpload: () => ({ mutateAsync: mocks.discardUpload }),
  useDeleteDocument: () => ({ mutate: vi.fn() }),
  useUpdateDocument: () => ({ mutate: vi.fn() }),
  useRequestUploadUrl: () => ({ mutateAsync: mocks.requestUploadUrl }),
  useVerifyDocument: () => ({ mutateAsync: vi.fn() }),
  useExtractDocument: () => ({
    mutate: mocks.extractDocument,
    isPending: false,
  }),
}));

function renderDocumentsTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentsTab projectId="project-1" ndaStatus="signed" />
    </QueryClientProvider>,
  );
}

describe("DocumentsTab signed upload", () => {
  beforeEach(() => {
    mocks.createDocument.mockReset().mockResolvedValue({ id: "document-1" });
    mocks.discardUpload.mockReset().mockResolvedValue({
      disposition: "deleted",
      quarantineMayRetainCopy: false,
    });
    mocks.extractDocument.mockReset();
    mocks.documents = [];
    mocks.permissions = new Set([
      "document:upload",
      "document:delete",
      "evidence:approve",
    ]);
    mocks.requestUploadUrl.mockReset().mockResolvedValue({
      uploadURL: "https://objects.example.test/signed-upload",
      objectPath: stagedObjectPath,
    });
    mocks.toast.mockReset();
    mocks.releaseCriticalWorkflow.mockReset();
    mocks.beginCriticalWorkflow
      .mockReset()
      .mockReturnValue(mocks.releaseCriticalWorkflow);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("announces a rejected transfer, preserves it for retry, and creates no orphan record", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
          statusText: "Service Unavailable",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderDocumentsTab();

    const file = new File(["tender"], "Tender.pdf", {
      type: "application/pdf",
    });
    await user.upload(
      screen.getByLabelText(/choose a document to upload/i),
      file,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/upload unsuccessful/i);
    expect(alert).toHaveTextContent(/no document record was created/i);
    expect(mocks.createDocument).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /retry upload/i }));

    await waitFor(() => expect(mocks.createDocument).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.requestUploadUrl).toHaveBeenCalledTimes(2);
    expect(mocks.discardUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pauses blind retry when the raw PUT response is lost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const user = userEvent.setup();

    renderDocumentsTab();
    await user.upload(
      screen.getByLabelText(/choose a document to upload/i),
      new File(["tender"], "Tender.pdf", { type: "application/pdf" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/late storage write may still arrive/i);
    expect(alert).toHaveTextContent(/retry is paused/i);
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /retry upload/i }),
    ).not.toBeInTheDocument();
  });

  it("holds the organisation workflow lock across raw PUT and cleanup", async () => {
    let finishPut: ((response: Response) => void) | undefined;
    let finishCleanup:
      | ((result: {
          disposition: "deleted";
          quarantineMayRetainCopy: false;
        }) => void)
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finishPut = resolve;
          }),
      ),
    );
    mocks.createDocument.mockRejectedValueOnce(
      Object.assign(new Error("record rejected"), {
        data: { error: "record rejected", cleanupConfirmed: true },
      }),
    );
    mocks.discardUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const user = userEvent.setup();

    renderDocumentsTab();
    await user.upload(
      screen.getByLabelText(/choose a document to upload/i),
      new File(["tender"], "Tender.pdf", { type: "application/pdf" }),
    );

    await waitFor(() => expect(mocks.beginCriticalWorkflow).toHaveBeenCalled());
    expect(mocks.releaseCriticalWorkflow).not.toHaveBeenCalled();

    finishPut?.(new Response(null, { status: 200 }));
    await waitFor(() => expect(mocks.discardUpload).toHaveBeenCalled());
    expect(mocks.releaseCriticalWorkflow).not.toHaveBeenCalled();

    finishCleanup?.(deletedCleanup);
    await waitFor(() =>
      expect(mocks.releaseCriticalWorkflow).toHaveBeenCalledTimes(1),
    );
  });

  it("reports record failure, discards the staged object, and never presents success", async () => {
    mocks.createDocument.mockRejectedValueOnce(
      Object.assign(new Error("record unavailable"), {
        data: {
          error: "record unavailable",
          cleanupConfirmed: true,
          storedObjectDisposition: "no promoted copy was retained",
        },
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    const user = userEvent.setup();

    renderDocumentsTab();
    await user.upload(
      screen.getByLabelText(/choose a document to upload/i),
      new File(["tender"], "Tender.pdf", { type: "application/pdf" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/server rejected document registration/i);
    expect(alert).toHaveTextContent(/staging object was purged/i);
    expect(mocks.discardUpload).toHaveBeenCalledWith({
      data: { objectPath: stagedObjectPath },
    });
    expect(screen.getByRole("button", { name: /retry upload/i })).toBeEnabled();
  });

  it("truthfully warns when the staging path is absent but quarantine may retain a copy", async () => {
    mocks.createDocument.mockRejectedValueOnce(
      Object.assign(new Error("secure intake quarantined the object"), {
        data: {
          storedObjectDisposition: "moved to inaccessible quarantine",
          quarantineRetained: true,
          cleanupConfirmed: true,
          findings: ["malware_scan_incomplete"],
        },
      }),
    );
    mocks.discardUpload.mockResolvedValueOnce({
      disposition: "already_absent",
      quarantineMayRetainCopy: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    const user = userEvent.setup();

    renderDocumentsTab();
    await user.upload(
      screen.getByLabelText(/choose a document to upload/i),
      new File(["tender"], "Tender.pdf", { type: "application/pdf" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /security-quarantine copy remains retained/i,
    );
    expect(alert).toHaveTextContent(/malware_scan_incomplete/i);
    expect(alert).not.toHaveTextContent(/staging object was purged/i);
  });

  it("pauses retry when stable cleanup is unconfirmed despite absent staging", async () => {
    mocks.createDocument.mockRejectedValueOnce(
      Object.assign(new Error("stable cleanup unconfirmed"), {
        data: {
          error: "cleanup could not be confirmed",
          storedObjectDisposition:
            "promoted copy cleanup could not be confirmed",
          cleanupConfirmed: false,
        },
      }),
    );
    mocks.discardUpload.mockResolvedValueOnce({
      disposition: "already_absent",
      quarantineMayRetainCopy: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
    const user = userEvent.setup();

    renderDocumentsTab();
    await user.upload(
      screen.getByLabelText(/choose a document to upload/i),
      new File(["tender"], "Tender.pdf", { type: "application/pdf" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      /promoted copy cleanup could not be confirmed/i,
    );
    expect(alert).toHaveTextContent(/retry is paused/i);
    expect(
      screen.queryByRole("button", { name: /retry upload/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a deliberate extraction action only after an excluded document is eligible", async () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Tender.pdf",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
        redactionStatus: "redacted",
        extractionStatus: "skipped",
        extractionMethod: "none",
        extractionNotes: "A reviewer made this document eligible.",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];
    const user = userEvent.setup();

    renderDocumentsTab();
    expect(screen.getByText(/ready to extract/i)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: /start extraction for tender\.pdf/i,
      }),
    );

    expect(mocks.extractDocument).toHaveBeenCalledWith(
      { id: "document-1" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("never offers extraction for an excluded document", () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Confidential.pdf",
        objectPath: "/objects/tenants/tenant-1/uploads/object-1",
        redactionStatus: "excluded",
        extractionStatus: "skipped",
        extractionMethod: "none",
        extractionNotes: "Skipped by confidentiality policy.",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];

    renderDocumentsTab();
    expect(screen.getByText(/excluded · no model/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /extraction for confidential/i }),
    ).not.toBeInTheDocument();
  });

  it("lets contributors edit metadata but not redaction or start model extraction", () => {
    mocks.permissions = new Set(["document:upload"]);
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Tender.pdf",
        objectPath: "/objects/tenants/tenant-1/documents/document-1",
        redactionStatus: "redacted",
        extractionStatus: "skipped",
        extractionMethod: "none",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];

    renderDocumentsTab();

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(
      screen.queryByRole("button", {
        name: /start extraction for tender\.pdf/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/documents are uploaded/i),
    ).not.toBeInTheDocument();
  });

  it("surfaces logical security quarantine and exposes no ordinary release control", () => {
    mocks.documents = [
      {
        id: "document-1",
        projectId: "project-1",
        type: "tender",
        filename: "Infected.pdf",
        objectPath: "/objects/tenants/tenant-1/documents/document-1",
        redactionStatus: "excluded",
        extractionStatus: "quarantined",
        extractionMethod: "none",
        extractionNotes: "Secure re-inspection security-blocked this source.",
        createdAt: "2026-08-09T12:00:00Z",
      },
    ];

    renderDocumentsTab();

    expect(screen.getByText(/security quarantined/i)).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /extraction for infected\.pdf/i }),
    ).not.toBeInTheDocument();
  });
});
