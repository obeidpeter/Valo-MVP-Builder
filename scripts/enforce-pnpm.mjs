import { existsSync } from "node:fs";

const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("This workspace is managed by pnpm; run pnpm install.");
  process.exit(1);
}

const conflictingLocks = ["package-lock.json", "yarn.lock"].filter(existsSync);
if (conflictingLocks.length > 0) {
  console.error(
    `Remove conflicting lockfiles before install: ${conflictingLocks.join(", ")}`,
  );
  process.exit(1);
}
