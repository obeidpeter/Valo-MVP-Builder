import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  // drizzle-kit resolves these paths from this package's working directory.
  // Keep them POSIX-style so Windows glob resolution does not treat an
  // absolute backslash path as a pattern with escape characters.
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  strict: true,
  verbose: true,
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
