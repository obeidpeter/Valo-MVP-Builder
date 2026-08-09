import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RequireArea from "./require-area";

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({
    data: {
      id: "user-1",
      role: "global_admin",
      status: "active",
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/contexts/organisation-context", () => ({
  useOrganisationAccess: () => ({
    organisations: [],
    activeOrganisation: null,
    effectiveRoles: [],
    effectivePermissions: [],
    isLoading: false,
    isError: false,
    needsSelection: false,
  }),
}));

describe("RequireArea tenant boundary", () => {
  it("does not fall back to the legacy user role when no organisation is active", () => {
    render(
      <RequireArea area="pursuit_workbench">
        <p>Tenant secret</p>
      </RequireArea>,
    );

    expect(screen.queryByText("Tenant secret")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /organisation access required/i }),
    ).toBeInTheDocument();
  });
});
