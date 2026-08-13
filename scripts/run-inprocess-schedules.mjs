import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..");
const MANIFEST_PATH = resolve(
  repositoryRoot,
  "config/operations/schedules.v1.json",
);

/**
 * Explicit operator opt-in: a comma-separated list of exact schedule ids from
 * config/operations/schedules.v1.json. Absent or empty means no in-process
 * scheduling at all. Selecting a job whose activation is not
 * `ready_for_platform_install` refuses startup fail-closed — a blocked job's
 * prerequisites cannot be waived from an environment variable.
 */
export const IN_PROCESS_SCHEDULES_ENVIRONMENT_KEY = "VALO_INPROCESS_SCHEDULES";

const TICK_MILLISECONDS = 30_000;
const READY_ACTIVATION = "ready_for_platform_install";

/**
 * The runner deliberately supports only the two shapes the ready jobs use:
 * daily at an exact UTC minute ("m h * * *") and hourly at an exact minute
 * ("m * * * *"). Anything else must go through a real platform scheduler.
 */
export function parseSupportedCron(expression) {
  const match = /^(\d{1,2}) (\d{1,2}|\*) \* \* \*$/u.exec(expression ?? "");
  if (!match) return null;
  const minute = Number(match[1]);
  const hour = match[2] === "*" ? null : Number(match[2]);
  if (minute > 59 || (hour != null && hour > 23)) return null;
  return { minute, hour };
}

export async function readScheduleManifest(path = MANIFEST_PATH) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function selectInProcessJobs(manifest, environment) {
  const raw = environment[IN_PROCESS_SCHEDULES_ENVIRONMENT_KEY]?.trim();
  if (!raw) return [];
  if (manifest.timezone !== "UTC") {
    throw new Error("in-process schedules require the UTC manifest timezone");
  }
  const requested = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (new Set(requested).size !== requested.length) {
    throw new Error("duplicate in-process schedule id requested");
  }
  return requested.map((id) => {
    const job = (manifest.jobs ?? []).find((candidate) => candidate.id === id);
    if (!job) {
      throw new Error(`unknown in-process schedule id: ${id}`);
    }
    if (job.activation !== READY_ACTIVATION) {
      throw new Error(
        `schedule ${id} is not ready_for_platform_install; its prerequisites cannot be waived in-process`,
      );
    }
    const cron = parseSupportedCron(job.schedule);
    if (!cron) {
      throw new Error(
        `schedule ${id} uses a cron shape the bounded in-process runner refuses`,
      );
    }
    return { ...job, cron };
  });
}

function defaultRunCommand(job) {
  return new Promise((resolveRun) => {
    const [command, ...commandArguments] = job.command.split(" ");
    const child = spawn(command, commandArguments, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, job.timeoutSeconds * 1000);
    timeout.unref?.();
    child.on("error", () => {
      clearTimeout(timeout);
      resolveRun({ exitCode: null, failedToSpawn: true });
    });
    child.on("exit", (exitCode, signal) => {
      clearTimeout(timeout);
      resolveRun({ exitCode, signal, failedToSpawn: false });
    });
  });
}

function minuteKey(date) {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}T${date.getUTCHours()}:${date.getUTCMinutes()}`;
}

/**
 * A minimal concurrency-forbid interval scheduler over the selected jobs.
 * Receipts are structured JSON log lines so the platform's retained logs
 * carry a machine-readable record of every firing and outcome.
 */
export function createInProcessScheduleRunner({
  manifest,
  environment = process.env,
  runCommand = defaultRunCommand,
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const jobs = selectInProcessJobs(manifest, environment);
  const state = new Map(
    jobs.map((job) => [job.id, { running: false, lastFiredMinute: null }]),
  );
  let interval = null;

  async function fire(job, dueAt) {
    const jobState = state.get(job.id);
    jobState.running = true;
    log(
      JSON.stringify({
        schema: "valo.inprocess-schedule-receipt/v1",
        event: "started",
        jobId: job.id,
        dueAt,
      }),
    );
    try {
      const outcome = await runCommand(job);
      log(
        JSON.stringify({
          schema: "valo.inprocess-schedule-receipt/v1",
          event: "completed",
          jobId: job.id,
          dueAt,
          exitCode: outcome.exitCode,
          signal: outcome.signal ?? null,
          failedToSpawn: outcome.failedToSpawn === true,
          succeeded: outcome.exitCode === 0,
        }),
      );
    } finally {
      jobState.running = false;
    }
  }

  async function tick(date) {
    const firings = [];
    for (const job of jobs) {
      const jobState = state.get(job.id);
      const key = minuteKey(date);
      const due =
        date.getUTCMinutes() === job.cron.minute &&
        (job.cron.hour == null || date.getUTCHours() === job.cron.hour);
      if (!due || jobState.lastFiredMinute === key) continue;
      jobState.lastFiredMinute = key;
      if (jobState.running) {
        // concurrencyPolicy is `forbid` for every manifest job: a still-
        // running occurrence swallows this firing rather than overlapping.
        log(
          JSON.stringify({
            schema: "valo.inprocess-schedule-receipt/v1",
            event: "skipped_still_running",
            jobId: job.id,
            dueAt: date.toISOString(),
          }),
        );
        continue;
      }
      firings.push(fire(job, date.toISOString()));
    }
    await Promise.all(firings);
  }

  return {
    jobs,
    tick,
    start() {
      if (interval || jobs.length === 0) return;
      interval = setInterval(() => {
        void tick(new Date());
      }, TICK_MILLISECONDS);
      interval.unref?.();
      log(
        JSON.stringify({
          schema: "valo.inprocess-schedule-receipt/v1",
          event: "runner_started",
          jobIds: jobs.map((job) => job.id),
        }),
      );
    },
    stop() {
      if (interval) clearInterval(interval);
      interval = null;
    },
  };
}

export async function maybeStartInProcessSchedules({
  environment = process.env,
  manifestPath = MANIFEST_PATH,
  runCommand,
  log,
} = {}) {
  if (!environment[IN_PROCESS_SCHEDULES_ENVIRONMENT_KEY]?.trim()) return null;
  const manifest = await readScheduleManifest(manifestPath);
  const runner = createInProcessScheduleRunner({
    manifest,
    environment,
    ...(runCommand ? { runCommand } : {}),
    ...(log ? { log } : {}),
  });
  runner.start();
  return runner;
}
