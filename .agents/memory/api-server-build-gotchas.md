---
name: api-server build gotchas
description: Non-obvious typecheck/build issues in artifacts/api-server (esbuild bundle + specific @types versions).
---

The api-server bundles with esbuild (`build.mjs`) and typechecks with strict tsc. A few dependencies do not have straightforward type shapes:

- **archiver**: `@types/archiver@8` exposes no callable/default/`create` export. Import the runtime value via `createRequire(import.meta.url)("archiver")` and import the shapes separately with `import type { Archiver, ArchiverError, ArchiverOptions } from "archiver"`. A plain `import archiver from "archiver"` will not typecheck.
- **Express 5**: `req.params.<name>` is typed as `string | string[]`, not `string`. Wrap every param use in `String(req.params.id)` before passing to drizzle `eq(...)` or zod.
- **pdf-parse**: import the implementation from its subpath and silence the missing-types with `@ts-expect-error` on the import line.

**Why:** these cost multiple iterations to resolve; they are version-specific to the installed @types and not discoverable without hitting the compiler error.
**How to apply:** when a new route touches archiver/pdf, or handles route params, reuse these patterns instead of the "obvious" import/usage.
