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
    expect(source).toContain("no data is deleted");
    expect(source).toMatch(/no\s+deletion certificate is issued/u);
    expect(source).toContain("two-phase detach, reconcile and certify");
    expect(source).toContain("upload sessions");
    expect(source).toContain("storage-lifecycle");
  });
});
