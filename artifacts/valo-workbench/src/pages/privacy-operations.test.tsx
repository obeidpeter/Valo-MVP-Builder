import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrivacyOperationsPage from "./privacy-operations";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000001";
const mocks = vi.hoisted(() => ({
  customFetch: vi.fn(),
  accessSource: "membership" as "membership" | "partner",
  permissions: ["privacy:read", "privacy:manage"],
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    activeOrganisation: {
      id: ORGANISATION_ID,
      accessSource: mocks.accessSource,
    },
    effectivePermissions: mocks.permissions,
    beginCriticalWorkflow: () => () => {},
  }),
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

function dashboardResponse() {
  return {
    generatedAt: "2026-08-11T12:00:00.000Z",
    organisationId: ORGANISATION_ID,
    boundedTo: 25,
    legalDecisionAutomated: false,
    rawSubjectPiiIncluded: false,
    authorityNote:
      "Named humans decide; this centre cannot release holds or delete data.",
    totals: {
      dataSubjectRequests: 0,
      consentRecords: 0,
      legalHolds: 0,
      subprocessors: 0,
      crossBorderTransfers: 0,
      deletionActions: 0,
    },
    truncated: {
      dataSubjectRequests: false,
      consentRecords: false,
      legalHolds: false,
      subprocessors: false,
      crossBorderTransfers: false,
      deletionActions: false,
    },
    dataSubjectRequests: [],
    consentRecords: [],
    legalHolds: [],
    subprocessors: [],
    crossBorderTransfers: [],
    deletionActions: [],
    blockers: [],
  };
}

function assigneesResponse() {
  return {
    organisationId: ORGANISATION_ID,
    items: [
      {
        userId: "30000000-0000-4000-8000-000000000003",
        name: "Privacy Assignee",
      },
    ],
    limit: 100,
    truncated: false,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PrivacyOperationsPage />
    </QueryClientProvider>,
  );
}

describe("PrivacyOperationsPage", () => {
  beforeEach(() => {
    mocks.customFetch.mockReset();
    mocks.toast.mockReset();
    mocks.accessSource = "membership";
    mocks.permissions = ["privacy:read", "privacy:manage"];
  });

  it("denies partner-derived access without calling the API", () => {
    mocks.accessSource = "partner";
    renderPage();
    expect(
      screen.getByText("Direct privacy-read membership required"),
    ).toBeInTheDocument();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("loads a tenant-bound bounded dashboard and exposes human workflows", async () => {
    mocks.customFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/assignees") ? assigneesResponse() : dashboardResponse(),
      ),
    );
    renderPage();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Privacy Operations Centre" }),
      ).toBeInTheDocument(),
    );
    expect(mocks.customFetch).toHaveBeenCalledWith(
      "/api/privacy-operations?limit=25",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(
      screen.getByRole("heading", { name: "Record a named-human workflow" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("option", { name: "Privacy Assignee" }),
    ).toBeInTheDocument();
  });

  it("keeps the dashboard read-only without privacy:manage", async () => {
    mocks.permissions = ["privacy:read"];
    mocks.customFetch.mockResolvedValue(dashboardResponse());
    renderPage();
    await screen.findByRole("heading", { name: "Privacy Operations Centre" });
    expect(
      screen.queryByRole("heading", { name: "Record a named-human workflow" }),
    ).not.toBeInTheDocument();
  });
});
