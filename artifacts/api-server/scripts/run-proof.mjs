import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";

globalThis.require = createRequire(import.meta.url);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const artifactDir = path.resolve(scriptDir, "..");
const outfile = path.resolve(artifactDir, "dist", "prove-ai-doctrine.mjs");

await esbuild({
  entryPoints: [path.resolve(scriptDir, "prove-ai-doctrine.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile,
  logLevel: "warning",
  external: ["*.node", "pg-native", "cpu-features"],
  banner: {
    js: `import { createRequire as __cr } from 'node:module';
globalThis.require = __cr(import.meta.url);`,
  },
});

const mod = await import(pathToFileURL(outfile).href);
void mod;
