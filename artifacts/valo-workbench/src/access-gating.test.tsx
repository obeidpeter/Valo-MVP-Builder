import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Layout from "./components/layout";

type MeResult = {
  data?: unknown;
  isLoading: boolean;
  error?: unknown;
};

let meResult: MeResult = { data: undefined, isLoading: true };

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => <div data-testid="clerk-user-button" />,
  useAuth: () => ({ isSignedIn: true, getToken: async () => "test-token" }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => meResult,
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
      data: { id: "u1", email: "pending@example.com", name: "Pending User", role: "none", status: "active" },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/pending access/i)).toBeInTheDocument();
    expect(screen.queryByText(/valo workbench/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("protected-child")).not.toBeInTheDocument();
  });

  it("shows the Pending Access screen for a disabled account and hides the app", () => {
    meResult = {
      data: { id: "u2", email: "disabled@example.com", name: "Disabled User", role: "reviewer", status: "disabled" },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/pending access/i)).toBeInTheDocument();
    expect(screen.queryByText(/valo workbench/i)).not.toBeInTheDocument();
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

  it("renders the nav and children for a valid approved user", () => {
    meResult = {
      data: { id: "u3", email: "approved@example.com", name: "Approved User", role: "reviewer", status: "active" },
      isLoading: false,
    };
    renderLayout();
    expect(screen.getByText(/valo workbench/i)).toBeInTheDocument();
    expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
    expect(screen.getByTestId("protected-child")).toBeInTheDocument();
    expect(screen.queryByText(/pending access/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/authentication failed/i)).not.toBeInTheDocument();
  });
});
