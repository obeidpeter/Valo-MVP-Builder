import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProtectedRoutes from "./protected-routes";

let currentRole = "reviewer";

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
    useListProjects: () => ({ data: [], isLoading: false }),
    useGetVaultExpiring: () => ({
      data: { items: [], buckets: {} },
      isLoading: false,
    }),
    useGetWorkflowAlerts: () => ({ data: undefined, isLoading: false }),
    useGetAccessReview: () => ({
      data: { month: "2026-08", rows: [] },
      isLoading: false,
    }),
  };
});

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
  });

  it("renders the Dashboard at the root path", () => {
    renderAt("/");
    expect(
      screen.getByRole("heading", { name: /portfolio overview/i }),
    ).toBeInTheDocument();
  });

  it("renders the NotFound page for an unknown protected path", () => {
    renderAt("/no/such/protected/route");
    expect(
      screen.getByRole("heading", { name: /404 page not found/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /portfolio overview/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the activation-gated client portal for a client owner", () => {
    currentRole = "client_organisation_owner";
    renderAt("/portal");
    expect(
      screen.getByRole("heading", { level: 1, name: /^client portal$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /activation unavailable/i }),
    ).toBeDisabled();
    expect(screen.getAllByLabelText(/status: pending/i).length).toBeGreaterThan(
      0,
    );
  });

  it("redirects a client owner away from the internal dashboard", () => {
    currentRole = "client_organisation_owner";
    renderAt("/");
    expect(
      screen.getByRole("heading", { level: 1, name: /^client portal$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /portfolio overview/i }),
    ).not.toBeInTheDocument();
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

  it("renders the gated partner workspace for a partner reviewer", () => {
    currentRole = "consultancy_partner_analyst_reviewer";
    renderAt("/partner");
    expect(
      screen.getByRole("heading", { level: 1, name: /^partner workspace$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no partner tenant/i)).toBeInTheDocument();
  });

  it("allows a read-only auditor to open the tenant-filtered security review", () => {
    currentRole = "read_only_auditor";
    renderAt("/security");
    expect(
      screen.getByRole("heading", { level: 1, name: /security & audit/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/no access rows returned/i)).toBeInTheDocument();
  });
});
