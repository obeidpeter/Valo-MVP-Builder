import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import SignedOutRoutes from "./signed-out-routes";

function renderAt(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  return render(
    <Router hook={hook}>
      <SignedOutRoutes />
    </Router>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public routing", () => {
  it.each([
    ["/", /build a tender submission your team can defend/i],
    ["/product", /a controlled workspace for evidence-heavy pursuits/i],
    ["/solutions", /the same evidence record, shaped for each responsibility/i],
    ["/how-it-works", /a review process with explicit gates/i],
    ["/security", /controls that are visible when they matter/i],
    ["/about", /better tender operations begin with a better record/i],
    ["/contact", /start with the workflow, not the tender file/i],
    ["/privacy", /^privacy notice$/i],
    ["/terms", /service terms notice/i],
  ])("renders the canonical public page at %s", (path, heading) => {
    renderAt(path);
    expect(
      screen.getByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();
  });

  it("navigates from the landing page to the configured contact surface", async () => {
    const user = userEvent.setup();
    renderAt("/");

    await user.click(
      screen.getAllByRole("link", { name: /request a walkthrough/i })[0],
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /start with the workflow, not the tender file/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/public enquiry channel is not configured/i),
    ).toBeInTheDocument();
  });

  it("opens only a configured HTTPS walkthrough destination", () => {
    vi.stubEnv(
      "VITE_PUBLIC_WALKTHROUGH_URL",
      "https://appointments.example.test/valo",
    );
    vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", "fallback@example.test");
    renderAt("/contact");

    expect(
      screen.getByRole("link", {
        name: /open the configured contact channel/i,
      }),
    ).toHaveAttribute("href", "https://appointments.example.test/valo");
    expect(
      screen.queryByText(/channel is not configured/i),
    ).not.toBeInTheDocument();
  });

  it("rejects an unsafe booking URL and uses the configured email fallback", () => {
    vi.stubEnv("VITE_PUBLIC_WALKTHROUGH_URL", "http://insecure.example.test");
    vi.stubEnv("VITE_PUBLIC_CONTACT_EMAIL", "walkthrough@example.test");
    renderAt("/contact");

    expect(
      screen.getByRole("link", {
        name: /open the configured contact channel/i,
      }),
    ).toHaveAttribute(
      "href",
      "mailto:walkthrough@example.test?subject=Valo%20walkthrough%20request",
    );
  });

  it("returns a real public 404 for an unknown address", () => {
    renderAt("/no/such/route");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /this page is not available/i,
      }),
    ).toBeInTheDocument();
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  });
});
