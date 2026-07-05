import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SignedOutRoutes from "./signed-out-routes";

vi.mock("@clerk/clerk-react", () => ({
  SignIn: () => <div data-testid="clerk-signin-widget">Clerk Sign In</div>,
}));

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <SignedOutRoutes />
    </Router>,
  );
}

describe("signed-out routing", () => {
  it("shows the landing page at the root path", () => {
    renderAt("/");
    expect(
      screen.getByRole("heading", {
        name: /dissected before it costs you the contract/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("button-signin-hero")).toBeInTheDocument();
  });

  it("renders the sign-in widget at /sign-in", () => {
    renderAt("/sign-in");
    expect(screen.getByTestId("clerk-signin-widget")).toBeInTheDocument();
    expect(screen.getByTestId("link-back-home")).toBeInTheDocument();
  });

  it("navigates from a landing sign-in CTA to /sign-in and back home", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(screen.getByTestId("button-signin-hero"));
    expect(screen.getByTestId("clerk-signin-widget")).toBeInTheDocument();
    expect(screen.getByTestId("link-back-home")).toBeInTheDocument();

    await user.click(screen.getByTestId("link-back-home"));
    expect(screen.getByTestId("button-signin-hero")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-signin-widget")).not.toBeInTheDocument();
  });

  it("falls back to the landing page for an unknown path", () => {
    renderAt("/no/such/route");
    expect(screen.getByTestId("button-signin-hero")).toBeInTheDocument();
  });
});
