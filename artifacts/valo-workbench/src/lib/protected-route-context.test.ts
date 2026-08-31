import { describe, expect, it } from "vitest";

import { getProtectedRouteContext } from "@/lib/protected-route-context";

describe("getProtectedRouteContext", () => {
  it("maps project deep links to register-specific help and titles", () => {
    const context = getProtectedRouteContext(
      "/projects/11111111-1111-4111-8111-111111111111",
      new URLSearchParams("tab=delivery"),
    );

    expect(context.title).toBe("Delivery studio · Pursuit");
    expect(context.requiredPermissions).toEqual([
      "project:read",
      "draft:read",
      "defect:read",
      "package:read",
    ]);
    expect(context.requiredPermissions).not.toContain("evaluation:read");
    expect(context.example).toMatch(/receipt/i);
  });

  it("uses Overview for an invalid project tab", () => {
    expect(
      getProtectedRouteContext(
        "/projects/11111111-1111-4111-8111-111111111111",
        new URLSearchParams("tab=not-a-register"),
      ).title,
    ).toBe("Overview · Pursuit");
  });
});
