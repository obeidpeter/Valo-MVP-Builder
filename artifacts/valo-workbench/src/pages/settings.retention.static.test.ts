import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/pages/settings.tsx"),
  "utf8",
);

describe("retention completion activation gate", () => {
  it("keeps the queue visible without exposing a completion mutation", () => {
    expect(source).toContain("useListRetentionRequests");
    expect(source).toContain("Retention completion is unavailable");
    expect(source).toContain("Activation required");
    expect(source).not.toContain("useCompleteRetentionRequest");
    expect(source).not.toContain("handleCompleteRetention");
  });

  it("states the durable lifecycle coverage required before reactivation", () => {
    expect(source).toMatch(/cannot delete\s+data/u);
    expect(source).toMatch(
      /cannot delete\s+data or issue a deletion certificate/u,
    );
    expect(source).toContain("approved two-step process");
    expect(source).toContain("uploads");
    expect(source).toMatch(/storage\s+lifecycle records/u);
  });
});
