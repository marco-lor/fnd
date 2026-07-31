#!/usr/bin/env node

const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const START_HOST = "127.0.0.1";
const START_PORT = 3001;
const START_PATH = "/home";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_CLEANUP_TIMEOUT_MS = 15_000;

class BoundedOutput {
  constructor(limit = DEFAULT_OUTPUT_LIMIT) {
    this.limit = limit;
    this.value = "";
  }

  append(chunk) {
    this.value += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (this.value.length > this.limit) {
      this.value = this.value.slice(-this.limit);
    }
  }

  toString() {
    return this.value;
  }
}

function normalizePathValue(values) {
  const seen = new Set();
  const entries = [];

  for (const value of values) {
    for (const entry of String(value || "").split(path.win32.delimiter)) {
      if (!entry) {
        continue;
      }
      const identity = entry.toLowerCase();
      if (!seen.has(identity)) {
        seen.add(identity);
        entries.push(entry);
      }
    }
  }

  return entries.join(path.win32.delimiter);
}

function normalizeEnvironment(environment, platform = process.platform) {
  const entries = Object.entries(environment || {}).filter(([, value]) => value != null);
  if (platform !== "win32") {
    return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
  }

  const groups = new Map();
  for (const [key, value] of entries) {
    const identity = key.toLowerCase();
    const group = groups.get(identity) || { key, values: [] };
    group.values.push(String(value));
    groups.set(identity, group);
  }

  const normalized = {};
  for (const [identity, group] of groups) {
    const key = identity === "path" ? "Path" : group.key;
    normalized[key] = identity === "path"
      ? normalizePathValue(group.values)
      : group.values[group.values.length - 1];
  }
  return normalized;
}

function setEnvironmentValue(environment, key, value) {
  for (const existingKey of Object.keys(environment)) {
    if (existingKey.toLowerCase() === key.toLowerCase()) {
      delete environment[existingKey];
    }
  }
  environment[key] = String(value);
}

function buildStartEnvironment(environment, platform = process.platform) {
  const normalized = normalizeEnvironment(environment, platform);
  setEnvironmentValue(normalized, "CI", "true");
  setEnvironmentValue(normalized, "BROWSER", "none");
  setEnvironmentValue(normalized, "PORT", String(START_PORT));
  return normalized;
}

function getEnvironmentValue(environment, key) {
  const matchingKey = Object.keys(environment).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchingKey ? environment[matchingKey] : undefined;
}

function getConfiguredTimeoutMs(environment = process.env) {
  const rawValue = environment.VERIFY_START_TIMEOUT_MS;
  if (rawValue == null || rawValue === "") {
    return DEFAULT_TIMEOUT_MS;
  }

  const timeoutMs = Number(rawValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("VERIFY_START_TIMEOUT_MS must be a positive integer.");
  }
  return timeoutMs;
}

function checkPortAvailable({
  host = START_HOST,
  port = START_PORT,
  createServer = () => net.createServer(),
} = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };

    server.unref?.();
    server.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        finish(resolve, false);
      } else {
        finish(reject, error);
      }
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) {
          finish(reject, error);
        } else {
          finish(resolve, true);
        }
      });
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withDeadline(promise, deadline, message, now = Date.now) {
  const remainingMs = deadline - now();
  if (remainingMs <= 0) {
    return Promise.reject(new Error(message));
  }

  let timer;
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), remainingMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createOutputMonitor(child, output) {
  let compilationSettled = false;
  let exited = false;
  let exitDescription = null;
  let resolveCompilation;
  let rejectCompilation;

  const compilation = new Promise((resolve, reject) => {
    resolveCompilation = resolve;
    rejectCompilation = reject;
  });

  const onData = (chunk) => {
    output.append(chunk);
    if (!compilationSettled && output.toString().includes("Compiled successfully!")) {
      compilationSettled = true;
      resolveCompilation();
    }
  };

  const onError = (error) => {
    if (!compilationSettled) {
      compilationSettled = true;
      rejectCompilation(new Error(`npm start could not be spawned: ${error.message}`));
    }
  };

  const onExit = (code, signal) => {
    if (exited) {
      return;
    }
    exited = true;
    exitDescription = signal ? `signal ${signal}` : `code ${code}`;
    if (!compilationSettled) {
      compilationSettled = true;
      rejectCompilation(new Error(`npm start exited before compilation (${exitDescription}).`));
    }
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("error", onError);
  child.once("exit", onExit);

  return {
    compilation,
    hasExited: () => exited,
    getExitDescription: () => exitDescription,
    dispose: () => {
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    },
  };
}

function requestHome({
  url,
  timeoutMs = 5_000,
  get = http.get,
  maximumBodyBytes = 1024 * 1024,
}) {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { Accept: "text/html" } }, (response) => {
      const chunks = [];
      let receivedBytes = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maximumBodyBytes) {
          request.destroy(new Error("Development server response exceeded 1 MiB."));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        resolve({
          statusCode: response.statusCode,
          contentType: String(response.headers["content-type"] || ""),
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.once("error", reject);
    });

    request.once("error", reject);
    request.setTimeout?.(timeoutMs, () => {
      request.destroy(new Error(`Development server request timed out after ${timeoutMs} ms.`));
    });
  });
}

function describeHomeResponse(response) {
  if (!response || response.statusCode !== 200) {
    return `HTTP ${response?.statusCode ?? "unavailable"}`;
  }
  if (!/^text\/html\b/i.test(response.contentType)) {
    return `content-type ${response.contentType || "missing"}`;
  }
  if (!/<(?:div|main)\b[^>]*\bid\s*=\s*["']root["'][^>]*>/i.test(response.body || "")) {
    return "HTML did not contain the React root element";
  }
  return null;
}

async function pollHome({
  deadline,
  monitor,
  now = Date.now,
  sleep = delay,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  requestHomeImpl = requestHome,
}) {
  const url = `http://${START_HOST}:${START_PORT}${START_PATH}`;
  let lastFailure = "no response received";

  while (now() < deadline) {
    if (monitor.hasExited()) {
      throw new Error(`npm start exited before /home became ready (${monitor.getExitDescription()}).`);
    }

    try {
      const remainingMs = Math.max(1, deadline - now());
      const response = await requestHomeImpl({
        url,
        timeoutMs: Math.min(5_000, remainingMs),
      });
      const responseFailure = describeHomeResponse(response);
      if (!responseFailure) {
        return response;
      }
      lastFailure = responseFailure;
    } catch (error) {
      lastFailure = error.message;
    }

    const remainingMs = deadline - now();
    if (remainingMs > 0) {
      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
  }

  throw new Error(`Timed out waiting for ${url}: ${lastFailure}.`);
}

function childHasExited(child) {
  return child.exitCode != null || child.signalCode != null;
}

function waitForChildExit(child, timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS) {
  if (childHasExited(child)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error(`Owned npm start process ${child.pid} did not exit within ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function terminateProcessTree(child, {
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  processKill = process.kill,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
} = {}) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0 || childHasExited(child)) {
    return;
  }

  if (platform === "win32") {
    const result = spawnSyncImpl(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, encoding: "utf8" }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0 && !childHasExited(child)) {
      // The cmd.exe wrapper can finish naturally after taskkill has resolved
      // the PID but before Node delivers the ChildProcess exit event. Give
      // that event a short bounded chance to arrive before treating taskkill's
      // "no running instance" result as a cleanup failure. The independent
      // port-release check below still proves that the dev server is gone.
      try {
        await waitForChildExit(child, Math.min(1_000, cleanupTimeoutMs));
      } catch (_exitError) {
        throw new Error(
          `taskkill failed for owned npm start process ${child.pid}: ${String(result.stderr || "unknown error").trim()}`
        );
      }
      return;
    }
    await waitForChildExit(child, cleanupTimeoutMs);
    return;
  }

  try {
    processKill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") {
      throw error;
    }
  }

  try {
    await waitForChildExit(child, Math.min(5_000, cleanupTimeoutMs));
  } catch (error) {
    try {
      processKill(-child.pid, "SIGKILL");
    } catch (killError) {
      if (killError.code !== "ESRCH") {
        throw new global.AggregateError(
          [error, killError],
          "Failed to terminate the owned npm start process tree."
        );
      }
    }
    await waitForChildExit(child, cleanupTimeoutMs);
  }
}

async function waitForPortRelease({
  checkPortAvailableImpl = checkPortAvailable,
  timeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  pollIntervalMs = 100,
  now = Date.now,
  sleep = delay,
} = {}) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (await checkPortAvailableImpl({ host: START_HOST, port: START_PORT })) {
      return;
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
  }
  throw new Error(`Port ${START_PORT} remained occupied after the owned npm start process was stopped.`);
}

function appendOutputTail(error, output) {
  const tail = output.toString().trim();
  if (!tail) {
    return error;
  }
  const wrapped = new Error(`${error.message}\n\nBounded npm start output tail:\n${tail}`, { cause: error });
  wrapped.name = error.name;
  return wrapped;
}

function combineCleanupErrors(errors, output) {
  if (errors.length === 0) {
    return null;
  }

  const errorsWithOutput = errors.map((error) => appendOutputTail(error, output));
  if (errorsWithOutput.length === 1) {
    return errorsWithOutput[0];
  }

  return new global.AggregateError(
    errorsWithOutput,
    "Owned npm start process termination and port-release verification both failed."
  );
}

async function runStartVerification({
  cwd = path.resolve(__dirname, ".."),
  environment = process.env,
  platform = process.platform,
  timeoutMs = getConfiguredTimeoutMs(environment),
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  outputLimit = DEFAULT_OUTPUT_LIMIT,
  spawnImpl = spawn,
  checkPortAvailableImpl = checkPortAvailable,
  requestHomeImpl = requestHome,
  terminateProcessTreeImpl = terminateProcessTree,
  waitForPortReleaseImpl = waitForPortRelease,
  now = Date.now,
  sleep = delay,
  logger = console,
} = {}) {
  const available = await checkPortAvailableImpl({ host: START_HOST, port: START_PORT });
  if (!available) {
    throw new Error(`Port ${START_PORT} is already occupied; refusing to inspect or terminate that process.`);
  }

  const startEnvironment = buildStartEnvironment(environment, platform);
  const command = platform === "win32"
    ? getEnvironmentValue(startEnvironment, "ComSpec") || "cmd.exe"
    : "npm";
  const args = platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd start"]
    : ["start"];
  const child = spawnImpl(command, args, {
    cwd,
    env: startEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: platform !== "win32",
  });
  const output = new BoundedOutput(outputLimit);
  const monitor = createOutputMonitor(child, output);
  const deadline = now() + timeoutMs;
  let primaryError = null;
  let response = null;

  try {
    await withDeadline(
      monitor.compilation,
      deadline,
      `Timed out after ${timeoutMs} ms waiting for npm start to compile.`,
      now
    );
    response = await pollHome({
      deadline,
      monitor,
      now,
      sleep,
      pollIntervalMs,
      requestHomeImpl,
    });
    logger.log(`npm start compiled and ${START_PATH} returned HTTP ${response.statusCode} on port ${START_PORT}.`);
  } catch (error) {
    primaryError = appendOutputTail(error, output);
  }

  monitor.dispose();
  const cleanupErrors = [];
  try {
    await terminateProcessTreeImpl(child, { platform });
  } catch (error) {
    cleanupErrors.push(error);
  }

  try {
    await waitForPortReleaseImpl({
      checkPortAvailableImpl,
      now,
      sleep,
    });
  } catch (error) {
    cleanupErrors.push(error);
  }
  const cleanupError = combineCleanupErrors(cleanupErrors, output);

  if (primaryError && cleanupError) {
    throw new global.AggregateError(
      [primaryError, cleanupError],
      "npm start verification failed and its owned-process cleanup also failed."
    );
  }
  if (primaryError) {
    throw primaryError;
  }
  if (cleanupError) {
    throw cleanupError;
  }

  return { statusCode: response.statusCode, port: START_PORT, path: START_PATH };
}

async function main() {
  await runStartVerification();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof global.AggregateError
      ? `${error.message}\n${error.errors.map((entry) => ` - ${entry.message}`).join("\n")}`
      : error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  BoundedOutput,
  START_HOST,
  START_PATH,
  START_PORT,
  buildStartEnvironment,
  checkPortAvailable,
  describeHomeResponse,
  getConfiguredTimeoutMs,
  getEnvironmentValue,
  normalizeEnvironment,
  requestHome,
  runStartVerification,
  terminateProcessTree,
  waitForPortRelease,
};
