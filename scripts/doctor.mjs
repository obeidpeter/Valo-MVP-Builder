import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

function commandVersion(command, args = ["--version"]) {
  if (process.platform === "win32" && command === "pnpm") {
    const commandPath = execFileSync("where.exe", ["pnpm.cmd"], {
      encoding: "utf8",
    })
      .split(/\r?\n/u)
      .find(Boolean);
    return execFileSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `${commandPath} ${args.join(" ")}`],
      { encoding: "utf8" },
    ).trim();
  }
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

export function inspectWorkspace() {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const expectedPnpm = packageJson.packageManager?.match(/^pnpm@(.+)$/u)?.[1];
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  const pnpmVersion = commandVersion("pnpm");
  const gitVersion = commandVersion("git");
  const failures = [];

  if (nodeMajor < 22 || nodeMajor >= 25) {
    failures.push(
      `Node ${process.versions.node} is outside the supported >=22 <25 range.`,
    );
  }
  if (expectedPnpm && pnpmVersion !== expectedPnpm) {
    failures.push(
      `pnpm ${pnpmVersion} is active; activate the packageManager release ${expectedPnpm}.`,
    );
  }
  if (!existsSync("pnpm-lock.yaml"))
    failures.push("pnpm-lock.yaml is missing.");
  if (!existsSync("node_modules"))
    failures.push("node_modules is missing; run pnpm install.");
  for (const conflict of ["package-lock.json", "yarn.lock"]) {
    if (existsSync(conflict)) failures.push(`${conflict} conflicts with pnpm.`);
  }

  return {
    failures,
    versions: {
      node: process.versions.node,
      pnpm: pnpmVersion,
      git: gitVersion,
    },
  };
}

export function printDoctorResult(result) {
  console.log(`Node ${result.versions.node}`);
  console.log(`pnpm ${result.versions.pnpm}`);
  console.log(result.versions.git);
  if (result.failures.length > 0) {
    console.error("Workspace doctor found configuration problems:");
    result.failures.forEach((failure) => console.error(`- ${failure}`));
    return false;
  }
  console.log("Workspace toolchain and install state are ready.");
  return true;
}

if (!printDoctorResult(inspectWorkspace())) process.exit(1);
