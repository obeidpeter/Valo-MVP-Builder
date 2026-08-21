import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./dashboard";

const mocks = vi.hoisted(() => ({
  permissions: ["analytics:read"] as string[],
  useListProjects: vi.fn(),
  useGetVaultExpiring: vi.fn(),
  useGetWorkflowAlerts: vi.fn(),
}));

const successfulQuery = <T,>(data: T) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: true,
  refetch: vi.fn(),
});

vi.mock("@workspace/api-client-react", () => ({
  getListProjectsQueryKey: () => ["/api/projects"],
  getGetVaultExpiringQueryKey: () => ["/api/vault/expiring"],
  getGetWorkflowAlertsQueryKey: () => ["/api/workflow/alerts"],
  useGetDashboardMetrics: () => ({
    data: {
      totalProjects: 0,
      openProjects: 0,
      paidMandates: 0,
      packagesShared: 0,
      materialDefectRate: 0,
      gate0: { metrics: [], metCount: 0, totalCount: 0 },
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
  useListProjects: mocks.useListProjects,
  useGetVaultExpiring: mocks.useGetVaultExpiring,
  useGetWorkflowAlerts: mocks.useGetWorkflowAlerts,
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    effectivePermissions: mocks.permissions,
  }),
}));

vi.mock("@/components/my-work-inbox", () => ({
  MyWorkInbox: () => <div data-testid="my-work-inbox" />,
}));

function renderDashboard() {
  const { hook } = memoryLocation({ path: "/app", record: true });
  return render(
    <Router hook={hook}>
      <Dashboard />
    </Router>,
  );
}

describe("Dashboard authority-aware sources", () => {
  beforeEach(() => {
    mocks.permissions = ["analytics:read"];
    mocks.useListProjects.mockReset();
    mocks.useGetVaultExpiring.mockReset();
    mocks.useGetWorkflowAlerts.mockReset();
    mocks.useListProjects.mockReturnValue(successfulQuery([]));
    mocks.useGetVaultExpiring.mockReturnValue(
      successfulQuery({
        items: [],
        buckets: { expired: 0, critical: 0, warning: 0, upcoming: 0 },
      }),
    );
    mocks.useGetWorkflowAlerts.mockReturnValue(
      successfulQuery({ slaBreaches: [], redTeamDue: [], vaultExpiring: [] }),
    );
  });

  it("does not query or link to project and evidence sources outside current authority", () => {
    renderDashboard();

    expect(mocks.useListProjects).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(mocks.useGetWorkflowAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(mocks.useGetVaultExpiring).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Some signals are outside your current authority",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open all pursuits" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /view pursuit register/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /open evidence readiness/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Some Command Centre signals are unavailable",
      }),
    ).not.toBeInTheDocument();
  });

  it("enables and exposes project and evidence surfaces with their exact read permissions", () => {
    mocks.permissions = ["analytics:read", "project:read", "evidence:read"];
    renderDashboard();

    expect(mocks.useListProjects).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(mocks.useGetWorkflowAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(mocks.useGetVaultExpiring).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(
      screen.getByRole("link", { name: "Open all pursuits" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view pursuit register/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open evidence readiness/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "Some signals are outside your current authority",
      }),
    ).not.toBeInTheDocument();
  });
});
