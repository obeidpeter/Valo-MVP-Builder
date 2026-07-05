---
name: api-server build gotchas
description: Non-obvious typecheck/build issues in artifacts/api-server (esbuild bundle + specific @types versions).
---

The api-server bundles with esbuild (`build.mjs`) and typechecks with strict tsc. A few dependencies do not have straightforward type shapes:

- **archiver**: `archiver@8` is ESM-only (`type: module`, no `exports` map) and **removed the classic default `archiver("zip", opts)` factory** — it now only exports named classes (`ZipArchive`, `TarArchive`, `JsonArchive`, `Archiver`). Construct via `const { ZipArchive } = createRequire(import.meta.url)("archiver"); new ZipArchive(opts)`. `@types/archiver@8` likewise exposes no callable/default export. Import the shapes separately with `import type { Archiver, ArchiverError, ArchiverOptions } from "archiver"`. A plain `import archiver from "archiver"` will not typecheck, and calling the required module as a function throws `archiver is not a function` at runtime.
- **Express 5**: `req.params.<name>` is typed as `string | string[]`, not `string`. Wrap every param use in `String(req.params.id)` before passing to drizzle `eq(...)` or zod.
- **pdf-parse**: import the implementation from its subpath and silence the missing-types with `@ts-expect-error` on the import line.

**Why:** these cost multiple iterations to resolve; they are version-specific to the installed @types and not discoverable without hitting the compiler error.
**How to apply:** when a new route touches archiver/pdf, or handles route params, reuse these patterns instead of the "obvious" import/usage.
