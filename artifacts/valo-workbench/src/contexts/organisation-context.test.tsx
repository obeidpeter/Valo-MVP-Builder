import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  OrganisationProvider,
  useOrganisationAccess,
} from "./organisation-context";
import { OrganisationSelectionGate } from "@/components/organisation-switcher";

const apiState = vi.hoisted(() => ({
  response: [] as unknown[],
  contextGetter: null as
    | null
    | (() => { organisationId?: string | null } | null),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: vi.fn(async () => apiState.response),
  setRequestContextGetter: vi.fn(
    (getter: () => { organisationId?: string | null } | null) => {
      apiState.contextGetter = getter;
    },
  ),
  getGetMeQueryKey: () => ["/api/me"],
  useGetMe: () => ({
    data: {
      id: "user-1",
      email: "member@example.com",
      role: "none",
      status: "active",
    },
    isLoading: false,
    isError: false,
  }),
}));

function renderProvider(child: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrganisationProvider>{child}</OrganisationProvider>
    </QueryClientProvider>,
  );
}

function AccessProbe() {
  const access = useOrganisationAccess();
  if (!access || access.isLoading) return <p>Loading access</p>;
  if (access.needsSelection) return <OrganisationSelectionGate />;
  return (
    <div>
      <p>Active: {access.activeOrganisation?.name ?? "none"}</p>
      <p>Roles: {access.effectiveRoles.join(",")}</p>
    </div>
  );
}

function organisation(id: string, name: string, roles: string[]) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    type: "client",
    status: "active",
    countryCode: "NG",
    membershipId: "membership-" + id,
    accessExpiresAt: null,
    roles,
    version: 1,
  };
}

describe("organisation access context", () => {
  beforeEach(() => {
    sessionStorage.clear();
    apiState.response = [];
  });

  it("auto-selects a single verified membership before exposing its roles", async () => {
    apiState.response = [
      organisation("org-1", "Northwind Nigeria", ["client_organisation_owner"]),
    ];
    renderProvider(<AccessProbe />);
    expect(
      await screen.findByText("Active: Northwind Nigeria"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Roles: client_organisation_owner"),
    ).toBeInTheDocument();
    expect(apiState.contextGetter?.()?.organisationId).toBe("org-1");
  });

  it("requires an explicit choice when more than one membership is active", async () => {
    apiState.response = [
      organisation("org-1", "Northwind Nigeria", ["client_administrator"]),
      organisation("org-2", "Contoso Nigeria", ["client_reviewer_approver"]),
    ];
    const user = userEvent.setup();
    renderProvider(<AccessProbe />);
    expect(
      await screen.findByRole("heading", { name: /select an organisation/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /contoso nigeria/i }));
    await waitFor(() =>
      expect(screen.getByText("Active: Contoso Nigeria")).toBeInTheDocument(),
    );
    expect(apiState.contextGetter?.()?.organisationId).toBe("org-2");
  });

  it("fails closed when the membership response is malformed", async () => {
    apiState.response = [{ id: "org-without-roles" }];

    function ErrorProbe() {
      const access = useOrganisationAccess();
      return <p>{access?.isError ? "Access error" : "No error"}</p>;
    }

    renderProvider(<ErrorProbe />);
    expect(await screen.findByText("Access error")).toBeInTheDocument();
    expect(apiState.contextGetter?.()?.organisationId ?? null).toBeNull();
  });
});
