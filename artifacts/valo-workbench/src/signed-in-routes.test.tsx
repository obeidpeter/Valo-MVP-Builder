import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProtectedRoutes from "./protected-routes";

let currentRole = "reviewer";

const TEST_PERMISSIONS = [
  "analytics:read",
  "document:read",
  "defect:read",
  "draft:read",
  "package:read",
  "project:read",
  "client:read",
  "requirement:read",
  "evidence:read",
  "report:read",
  "partner_relationship:read",
  "entitlement:read",
  "audit:read",
  "membership:manage",
  "configuration:manage",
];

const ROUTE_LOAD_WAIT = { timeout: 5_000 };

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  UserButton: () => <div data-testid="clerk-user-button" />,
  useAuth: () => ({ isSignedIn: true, getToken: async () => "test-token" }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetMe: () => ({
      data: {
        id: "u1",
        email: "user@example.com",
        role: currentRole,
        status: "active",
      },
      isLoading: false,
    }),
    useGetDashboardMetrics: () => ({ data: undefined, isLoading: false }),
    useListProjects: () => ({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useGetProjectIntelligence: () => ({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useGetVaultExpiring: () => ({
      data: {
        items: [],
        buckets: { expired: 0, critical: 0, warning: 0, upcoming: 0 },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useGetWorkflowAlerts: () => ({
      data: { slaBreaches: [], redTeamDue: [], vaultExpiring: [] },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useListPartnerRelationships: () => ({
      data: [],
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    }),
    useGetAccessReview: () => ({
      data: { month: "2026-08", rows: [] },
      isLoading: false,
    }),
    useGetLegacyIntegrityAssessment: () => ({
      data: [],
      isLoading: false,
      isError: false,
    }),
  };
});

vi.mock("./contexts/organisation-context", () => ({
  useOrganisationPermission: (permission: string) =>
    TEST_PERMISSIONS.includes(permission),
  useOrganisationAccess: () => {
    const activeOrganisation = {
      id: "org-test",
      name: "Test organisation",
      slug: "test-organisation",
      type: "client" as const,
      status: "active",
      countryCode: "NG",
      membershipId: "membership-test",
      membershipOrganisationId: "org-test",
      accessSource: "membership" as const,
      partnerRelationshipId: null,
      accessExpiresAt: null,
      roles: [currentRole],
      permissions: TEST_PERMISSIONS,
      version: 1,
    };
    return {
      organisations: [activeOrganisation],
      activeOrganisation,
      effectiveRoles: [currentRole],
      effectivePermissions: TEST_PERMISSIONS,
      isLoading: false,
      isError: false,
      error: null,
      needsSelection: false,
      isSwitching: false,
      hasPendingMutation: false,
      hasCriticalWorkflow: false,
      beginCriticalWorkflow: () => () => undefined,
      selectOrganisation: async () => true,
      refetch: vi.fn(),
    };
  },
}));

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  // Pages use react-query hooks directly (e.g. useWorkflowAlerts), so the
  // route tree needs a QueryClient just like App provides in production.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Router hook={hook}>
        <ProtectedRoutes />
      </Router>
    </QueryClientProvider>,
  );
}

describe("signed-in routing", () => {
  beforeEach(() => {
    currentRole = "reviewer";
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "false");
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the Command Centre at the protected app path", async () => {
    renderAt("/app");
    expect(
      await screen.findByRole(
        "heading",
        { name: /^command centre$/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("renders the NotFound page for an unknown protected path", async () => {
    renderAt("/no/such/protected/route");
    expect(
      await screen.findByRole(
        "heading",
        { name: /404 page not found/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^command centre$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the activation-gated client portal for a client owner", async () => {
    currentRole = "client_organisation_owner";
    renderAt("/portal");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^client portal$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /client portal requires activation/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /activation unavailable/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/status: pending/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/start secure intake/i)).not.toBeInTheDocument();
  });

  it("renders connected client summaries when the portal is activated", async () => {
    currentRole = "client_organisation_owner";
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "true");
    renderAt("/portal");
    expect(
      await screen.findByRole(
        "heading",
        { name: /connected tenant signals/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no pursuit records returned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no workflow alerts returned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no evidence in the expiry window/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/start secure intake/i)).not.toBeInTheDocument();
  });

  it("redirects a client owner to pursuits when the portal is inactive", async () => {
    currentRole = "client_organisation_owner";
    renderAt("/app");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /tender projects/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^command centre$/i }),
    ).not.toBeInTheDocument();
  });

  it("redirects a client owner to the client portal when it is active", async () => {
    currentRole = "client_organisation_owner";
    vi.stubEnv("VITE_FEATURE_CLIENT_PORTAL", "true");
    renderAt("/app");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^client portal$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
  });

  it("blocks an internal reviewer from opening the client portal directly", () => {
    currentRole = "reviewer";
    renderAt("/portal");
    expect(
      screen.getByRole("heading", { name: /access denied/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /^client portal$/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the gated partner workspace for a partner reviewer", async () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    renderAt("/partner");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /^partner workspace$/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /partner workspace requires activation/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/add managed client/i)).not.toBeInTheDocument();
  });

  it("renders connected partner summaries without inferring client data", async () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");
    renderAt("/partner");
    expect(
      await screen.findByRole(
        "heading",
        {
          name: /connected partner signals/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no partner relationships returned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no partner-tenant pursuits returned/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no partner-tenant evidence in the expiry window/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/add managed client/i)).not.toBeInTheDocument();
  });

  it("opens pursuit workbench in the selected authorised partner context", async () => {
    currentRole = "consultancy_partner_administrator";
    vi.stubEnv("VITE_FEATURE_PARTNER_WORKSPACE", "true");
    renderAt("/projects");
    expect(
      await screen.findByRole(
        "heading",
        { name: /tender projects/i },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /access denied/i }),
    ).not.toBeInTheDocument();
  });

  it("opens the Intelligence Centre without implying model execution", async () => {
    currentRole = "client_reviewer_approver";
    renderAt("/intelligence");

    expect(
      await screen.findByRole(
        "heading",
        { name: "Intelligence Centre" },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No intelligence evidence is available",
      }),
    ).toBeInTheDocument();
  });

  it("allows a read-only auditor to open the tenant-filtered security review", async () => {
    currentRole = "read_only_auditor";
    renderAt("/app/security");
    expect(
      await screen.findByRole(
        "heading",
        {
          level: 1,
          name: /security & audit/i,
        },
        ROUTE_LOAD_WAIT,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/no access rows returned/i)).toBeInTheDocument();
  });
});
