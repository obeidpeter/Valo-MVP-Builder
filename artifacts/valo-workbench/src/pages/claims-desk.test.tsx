import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ClaimsDeskPage from "./claims-desk";

const ORG = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000002";
const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  accessSource: "membership" as "membership" | "partner",
  permissions: ["project:read", "project:update"],
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  getListProjectsQueryKey: () => ["/api/projects"],
  useListProjects: () => ({
    data: [
      {
        id: PROJECT,
        tenderTitle: "Claims test project",
        status: "review",
        createdAt: "2026-08-01T12:00:00.000Z",
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("wouter", () => ({
  useSearchParams: () => [new URLSearchParams(`project=${PROJECT}`), vi.fn()],
}));
vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: ORG,
      accessSource: mocks.accessSource,
      membershipOrganisationId:
        mocks.accessSource === "membership" ? ORG : null,
    },
    effectivePermissions: mocks.permissions,
    beginCriticalWorkflow: () => () => {},
  }),
}));
vi.mock("@/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function response() {
  return {
    organisationId: ORG,
    projectId: PROJECT,
    projectStatus: "review",
    records: [],
    posture: {
      total: 0,
      open: 0,
      overdue: 0,
      dueSoon: 0,
      awaitingChecker: 0,
      terminal: 0,
    },
    truncated: false,
    generatedAt: "2026-08-11T12:00:00.000Z",
    legalConclusionAutomated: false,
    noticeDispatched: false,
    paymentMutated: false,
    authorityNote: "Human workflow evidence only.",
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ClaimsDeskPage />
    </QueryClientProvider>,
  );
}

describe("ClaimsDeskPage", () => {
  beforeEach(() => {
    mocks.customFetch.mockReset();
    mocks.toast.mockReset();
    mocks.accessSource = "membership";
    mocks.permissions = ["project:read", "project:update"];
  });

  it("denies partner-derived access without requesting project data", () => {
    mocks.accessSource = "partner";
    renderPage();
    expect(
      screen.getByText("Direct project-read membership required"),
    ).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("loads an exact tenant/project query and exposes bounded workflows", async () => {
    mocks.customFetch.mockResolvedValue(response());
    renderPage();
    await screen.findByRole("heading", { name: "Commercial & Claims Desk" });
    expect(mocks.customFetch).toHaveBeenCalledWith(
      `/api/projects/${PROJECT}/claims-desk`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.getByRole("heading", { name: "Register human workflow evidence" }),
    ).toBeInTheDocument();
  });

  it("keeps the desk read-only without project:update", async () => {
    mocks.permissions = ["project:read"];
    mocks.customFetch.mockResolvedValue(response());
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Read-only Claims Desk")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", {
        name: "Register human workflow evidence",
      }),
    ).not.toBeInTheDocument();
  });
});
