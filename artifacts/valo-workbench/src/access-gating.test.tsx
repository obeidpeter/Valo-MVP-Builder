import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Layout from "./components/layout";
import RequireAdmin from "./components/require-admin";

type MeResult = {
  data?: unknown;
  isLoading: boolean;
  error?: unknown;
};

let meResult: MeResult = { data: undefined, isLoading: true };

const TEST_PERMISSIONS = [
  "analytics:read",
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
  "organisation:read",
];

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => <div data-testid="clerk-user-button" />,
  useAuth: () => ({ isSignedIn: true, getToken: async () => "test-token" }),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetMe: () => meResult,
    getGetMeQueryKey: () => ["/api/me"],
    useListProjects: () => ({
      data: [],
      isError: false,
      isLoading: false,
    }),
  };
});

vi.mock("./contexts/organisation-context", () => ({
  useOrganisationAccess: () => {
    const role = (meResult.data as { role?: string } | undefined)?.role;
    const activeOrganisation = role
      ? {
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
          roles: [role],
          permissions: TEST_PERMISSIONS,
          version: 1,
        }
      : null;
    return {
      organisations: activeOrganisation ? [activeOrganisation] : [],
      activeOrganisation,
      effectiveRoles: activeOrganisation?.roles ?? [],
      effectivePermissions: activeOrganisation?.permissions ?? [],
      isLoading: meResult.isLoading,
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

function renderLayout() {
  return render(
    <Layout>
      <div data-testid="protected-child">Protected Content</div>
    </Layout>,
  );
}

describe("access gating in Layout", () => {
  beforeEach(() => {
    meResult = { data: undefined, isLoading: true };
  });

  it("shows the Pending Access screen for a role 'none' account and hides the app", () => {
    meResult = {
      data: {
        id: "u1",
        email: "pending@example.com",
        name: "Pending User",
        role: "none",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/pending access/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/valo command centre/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the blocked Account Disabled screen for a disabled account and hides the app", () => {
    meResult = {
      data: {
        id: "u2",
        email: "disabled@example.com",
        name: "Disabled User",
        role: "reviewer",
        status: "disabled",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/account disabled/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/status: blocked/i)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/valo command centre/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the Authentication Failed screen when useGetMe errors", () => {
    meResult = { data: undefined, isLoading: false, error: new Error("boom") };
    renderLayout();
    expect(screen.getByText(/authentication failed/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the Authentication Failed screen when there is no user", () => {
    meResult = { data: undefined, isLoading: false };
    renderLayout();
    expect(screen.getByText(/authentication failed/i)).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("fails closed when the server returns an unknown role", () => {
    meResult = {
      data: {
        id: "ux",
        email: "unknown@example.com",
        name: "Unknown Role",
        role: "unexpected_role",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(
      screen.getByText(/role configuration unsupported/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("renders the nav and children for a valid approved user", () => {
    meResult = {
      data: {
        id: "u3",
        email: "approved@example.com",
        name: "Approved User",
        role: "reviewer",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByLabelText(/valo command centre/i)).toBeInTheDocument();
    expect(screen.getByText(/^command centre$/i)).toBeInTheDocument();
    expect(screen.getByText(/^pursuit operations$/i)).toBeInTheDocument();
    expect(screen.getByText(/^commercial & claims desk$/i)).toBeInTheDocument();
    expect(screen.getByText(/^getting started & offers$/i)).toBeInTheDocument();
    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    expect(screen.queryByText(/pending access/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/authentication failed/i),
    ).not.toBeInTheDocument();
  });

  it("shows the Settings nav item for an approved admin", () => {
    meResult = {
      data: {
        id: "u4",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/^platform operations$/i)).toBeInTheDocument();
    expect(screen.getByText(/^getting started & offers$/i)).toBeInTheDocument();
  });

  it("hides the Settings nav item from an approved reviewer", () => {
    meResult = {
      data: {
        id: "u5",
        email: "reviewer@example.com",
        name: "Reviewer User",
        role: "reviewer",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/^command centre$/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/^platform operations$/i),
    ).not.toBeInTheDocument();
  });

  it("shows pursuit and client-facing surfaces to a client owner", () => {
    meResult = {
      data: {
        id: "u8",
        email: "owner@example.com",
        name: "Client Owner",
        role: "client_organisation_owner",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/client workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/^pursuits$/i)).toBeInTheDocument();
    expect(screen.getByText(/^clients$/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence library/i)).toBeInTheDocument();
    expect(screen.getByText(/^pursuit operations$/i)).toBeInTheDocument();
    expect(screen.getByText(/^getting started & offers$/i)).toBeInTheDocument();
    expect(screen.getByText(/billing & entitlements/i)).toBeInTheDocument();
    expect(screen.queryByText(/^reviews$/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/^platform operations$/i),
    ).not.toBeInTheDocument();
  });

  it("shows the channel review surfaces to a partner reviewer", () => {
    meResult = {
      data: {
        id: "u9",
        email: "partner@example.com",
        name: "Partner Reviewer",
        role: "consultancy_partner_analyst_reviewer",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/partner workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/^consortium room$/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence library/i)).toBeInTheDocument();
    expect(screen.getByText(/notifications/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/billing & entitlements/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/security & audit/i)).not.toBeInTheDocument();
  });

  it("gives the canonical quality-adviser role review access without settings", () => {
    meResult = {
      data: {
        id: "u10",
        email: "qa@example.com",
        name: "Quality Adviser",
        role: "valo_quality_adviser",
        status: "active",
      },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/^reviews$/i)).toBeInTheDocument();
    expect(screen.getByText(/evidence library/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/^platform operations$/i),
    ).not.toBeInTheDocument();
  });
});

describe("RequireAdmin route guard for the settings page", () => {
  beforeEach(() => {
    meResult = { data: undefined, isLoading: true };
  });

  it("blocks an approved reviewer from the settings route with access denied", () => {
    meResult = {
      data: {
        id: "u6",
        email: "reviewer@example.com",
        name: "Reviewer User",
        role: "reviewer",
        status: "active",
      },
      isLoading: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-admin-controls"),
    ).not.toBeInTheDocument();
  });

  it("renders the settings admin controls for an approved admin", () => {
    meResult = {
      data: {
        id: "u7",
        email: "admin@example.com",
        name: "Admin User",
        role: "admin",
        status: "active",
      },
      isLoading: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByTestId("settings-admin-controls")).toBeInTheDocument();
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
  });

  it("renders supported settings controls for a canonical operations administrator", () => {
    meResult = {
      data: {
        id: "u11",
        email: "operations@example.com",
        name: "Operations Admin",
        role: "valo_operations_administrator",
        status: "active",
      },
      isLoading: false,
    };
    render(
      <RequireAdmin>
        <div data-testid="settings-admin-controls">Personnel Management</div>
      </RequireAdmin>,
    );
    expect(screen.getByTestId("settings-admin-controls")).toBeInTheDocument();
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
  });
});
