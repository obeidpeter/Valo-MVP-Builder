import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import * as prettier from "prettier";

const ZERO_SHA = /^0{40}$/;
const supportedExtension = /\.(?:css|json|md|mjs|ts|tsx|ya?ml)$/i;

function gitLines(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasStagedChanges() {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    stdio: "ignore",
  });
  return result.status === 1;
}

function changedFiles() {
  if (hasStagedChanges()) {
    return gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  }

  const base = process.env.FORMAT_BASE_SHA?.trim();
  if (base && !ZERO_SHA.test(base)) {
    return gitLines([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      `${base}...HEAD`,
    ]);
  }

  return gitLines([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "--diff-filter=ACMR",
    "-r",
    "HEAD",
  ]);
}

const files = [...new Set(changedFiles())]
  .filter((file) => supportedExtension.test(file))
  .sort();
const failures = [];
const write = process.argv.includes("--write");

for (const file of files) {
  const info = await prettier.getFileInfo(file, {
    ignorePath: ".prettierignore",
  });
  if (info.ignored || info.inferredParser === null) continue;

  const source = await readFile(file, "utf8");
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(source, {
    ...config,
    filepath: file,
  });
  if (source !== formatted) {
    if (write) await writeFile(file, formatted, "utf8");
    else failures.push(file);
  }
}

if (failures.length > 0) {
  console.error("Formatting differs in changed files:");
  for (const file of failures) console.error(`- ${file}`);
  process.exit(1);
}

console.log(
  write
    ? `Formatted ${files.length} changed source files.`
    : `Formatting valid for ${files.length} changed source files.`,
);
