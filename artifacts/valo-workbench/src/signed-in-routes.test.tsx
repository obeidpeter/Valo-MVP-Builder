import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import ProtectedRoutes from "./protected-routes";

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
  UserButton: () => <div data-testid="clerk-user-button" />,
  useAuth: () => ({ isSignedIn: true, getToken: async () => "test-token" }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardMetrics: () => ({ data: undefined, isLoading: false }),
  useListProjects: () => ({ data: [], isLoading: false }),
  useGetVaultExpiring: () => ({ data: { items: [], buckets: {} }, isLoading: false }),
}));

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <ProtectedRoutes />
    </Router>,
  );
}

describe("signed-in routing", () => {
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
});
