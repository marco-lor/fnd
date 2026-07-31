const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const test = require("node:test");

const {
  BoundedOutput,
  buildStartEnvironment,
  normalizeEnvironment,
  runStartVerification,
  terminateProcessTree,
} = require("./verify-start");

function createFakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function silentLogger() {
  return { log() {}, error() {} };
}

test("normalizes case-insensitive Windows environment duplicates and preserves PATH entries", () => {
  const normalized = normalizeEnvironment({
    Path: "C:\\Windows;C:\\Tools",
    PATH: "c:\\tools;C:\\Node",
    Example: "first",
    EXAMPLE: "second",
  }, "win32");

  assert.equal(normalized.Path, "C:\\Windows;C:\\Tools;C:\\Node");
  assert.equal(normalized.Example, "second");
  assert.equal(Object.keys(normalized).filter((key) => key.toLowerCase() === "path").length, 1);
  assert.equal(Object.keys(normalized).filter((key) => key.toLowerCase() === "example").length, 1);

  const startEnvironment = buildStartEnvironment({
    Path: "C:\\Windows",
    PATH: "C:\\Node",
    ci: "false",
    browser: "chrome",
    port: "3000",
  }, "win32");
  assert.equal(startEnvironment.CI, "true");
  assert.equal(startEnvironment.BROWSER, "none");
  assert.equal(startEnvironment.PORT, "3001");
  for (const name of ["path", "ci", "browser", "port"]) {
    assert.equal(Object.keys(startEnvironment).filter((key) => key.toLowerCase() === name).length, 1);
  }
});

test("refuses an occupied port 3001 without spawning or cleaning up a process", async () => {
  let spawned = false;
  let cleanedUp = false;
  const checkedPorts = [];

  await assert.rejects(
    runStartVerification({
      timeoutMs: 50,
      checkPortAvailableImpl: async ({ port }) => {
        checkedPorts.push(port);
        return false;
      },
      spawnImpl: () => {
        spawned = true;
      },
      terminateProcessTreeImpl: async () => {
        cleanedUp = true;
      },
      logger: silentLogger(),
    }),
    /Port 3001 is already occupied/
  );

  assert.deepEqual(checkedPorts, [3001]);
  assert.equal(spawned, false);
  assert.equal(cleanedUp, false);
});

test("spawns exact npm start settings, accepts a valid /home response, and cleans up", async () => {
  const child = createFakeChild();
  const checks = [true, true];
  let capturedSpawn = null;
  let requestCount = 0;
  let cleanedChild = null;

  const resultPromise = runStartVerification({
    platform: "win32",
    environment: { Path: "C:\\Windows", PATH: "C:\\Node", port: "3000" },
    timeoutMs: 250,
    pollIntervalMs: 1,
    checkPortAvailableImpl: async ({ port }) => {
      assert.equal(port, 3001);
      return checks.shift();
    },
    spawnImpl: (command, args, options) => {
      capturedSpawn = { command, args, options };
      setImmediate(() => {
        child.stdout.write("Compiled suc");
        child.stdout.write("cessfully!\n");
      });
      return child;
    },
    requestHomeImpl: async ({ url }) => {
      assert.equal(url, "http://127.0.0.1:3001/home");
      requestCount += 1;
      if (requestCount === 1) {
        return { statusCode: 503, contentType: "text/html", body: "warming" };
      }
      return {
        statusCode: 200,
        contentType: "text/html; charset=utf-8",
        body: '<!doctype html><div id="root"></div>',
      };
    },
    terminateProcessTreeImpl: async (ownedChild) => {
      cleanedChild = ownedChild;
    },
    waitForPortReleaseImpl: async ({ checkPortAvailableImpl }) => {
      assert.equal(await checkPortAvailableImpl({ host: "127.0.0.1", port: 3001 }), true);
    },
    logger: silentLogger(),
  });

  const result = await resultPromise;
  assert.deepEqual(result, { statusCode: 200, port: 3001, path: "/home" });
  assert.equal(capturedSpawn.command, "cmd.exe");
  assert.deepEqual(capturedSpawn.args, ["/d", "/s", "/c", "npm.cmd start"]);
  assert.deepEqual(capturedSpawn.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(capturedSpawn.options.env.CI, "true");
  assert.equal(capturedSpawn.options.env.BROWSER, "none");
  assert.equal(capturedSpawn.options.env.PORT, "3001");
  assert.equal(cleanedChild, child);
  assert.equal(requestCount, 2);
  assert.equal(checks.length, 0);
});

test("times out on an invalid /home response and still cleans up its child", async () => {
  const child = createFakeChild();
  let cleanedUp = 0;

  const verification = runStartVerification({
    timeoutMs: 20,
    pollIntervalMs: 1,
    checkPortAvailableImpl: async () => true,
    spawnImpl: () => {
      setImmediate(() => child.stdout.write("Compiled successfully!\n"));
      return child;
    },
    requestHomeImpl: async () => ({
      statusCode: 200,
      contentType: "text/html",
      body: "<html><body>missing root</body></html>",
    }),
    terminateProcessTreeImpl: async () => {
      cleanedUp += 1;
    },
    waitForPortReleaseImpl: async () => {},
    logger: silentLogger(),
  });

  await assert.rejects(verification, (error) => {
    assert.match(error.message, /Timed out waiting for http:\/\/127\.0\.0\.1:3001\/home/);
    assert.match(error.message, /HTML did not contain the React root element/);
    assert.match(error.message, /Bounded npm start output tail/);
    return true;
  });
  assert.equal(cleanedUp, 1);
});

test("reports an early npm exit and still verifies cleanup", async () => {
  const child = createFakeChild();
  let cleanedUp = false;
  let releaseChecked = false;

  const verification = runStartVerification({
    timeoutMs: 100,
    checkPortAvailableImpl: async () => true,
    spawnImpl: () => {
      setImmediate(() => {
        child.exitCode = 1;
        child.emit("exit", 1, null);
      });
      return child;
    },
    terminateProcessTreeImpl: async (ownedChild) => {
      assert.equal(ownedChild, child);
      cleanedUp = true;
    },
    waitForPortReleaseImpl: async () => {
      releaseChecked = true;
    },
    logger: silentLogger(),
  });

  await assert.rejects(verification, /npm start exited before compilation \(code 1\)/);
  assert.equal(cleanedUp, true);
  assert.equal(releaseChecked, true);
});

test("cleanup-only failures include the bounded npm start output tail", async () => {
  const child = createFakeChild();
  let releaseChecked = false;
  const verification = runStartVerification({
    timeoutMs: 100,
    checkPortAvailableImpl: async () => true,
    spawnImpl: () => {
      setImmediate(() => child.stdout.write("diagnostic-tail\nCompiled successfully!\n"));
      return child;
    },
    requestHomeImpl: async () => ({
      statusCode: 200,
      contentType: "text/html",
      body: '<div id="root"></div>',
    }),
    terminateProcessTreeImpl: async () => {
      throw new Error("owned cleanup failed");
    },
    waitForPortReleaseImpl: async () => {
      releaseChecked = true;
    },
    logger: silentLogger(),
  });

  await assert.rejects(verification, (error) => {
    assert.match(error.message, /owned cleanup failed/);
    assert.match(error.message, /Bounded npm start output tail/);
    assert.match(error.message, /diagnostic-tail/);
    return true;
  });
  assert.equal(releaseChecked, true);
});

test("aggregates termination and port-release failures with bounded output tails", async () => {
  const child = createFakeChild();
  let releaseChecked = false;
  const verification = runStartVerification({
    timeoutMs: 100,
    checkPortAvailableImpl: async () => true,
    spawnImpl: () => {
      setImmediate(() => child.stdout.write("dual-cleanup-tail\nCompiled successfully!\n"));
      return child;
    },
    requestHomeImpl: async () => ({
      statusCode: 200,
      contentType: "text/html",
      body: '<div id="root"></div>',
    }),
    terminateProcessTreeImpl: async () => {
      throw new Error("termination failed");
    },
    waitForPortReleaseImpl: async () => {
      releaseChecked = true;
      throw new Error("release verification failed");
    },
    logger: silentLogger(),
  });

  await assert.rejects(verification, (error) => {
    assert.equal(error instanceof global.AggregateError, true);
    assert.match(error.message, /termination and port-release verification both failed/);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /termination failed/);
    assert.match(error.errors[1].message, /release verification failed/);
    for (const cleanupError of error.errors) {
      assert.match(cleanupError.message, /Bounded npm start output tail/);
      assert.match(cleanupError.message, /dual-cleanup-tail/);
    }
    return true;
  });
  assert.equal(releaseChecked, true);
});

test("preserves primary plus aggregated cleanup failure reporting", async () => {
  const child = createFakeChild();
  const verification = runStartVerification({
    timeoutMs: 100,
    checkPortAvailableImpl: async () => true,
    spawnImpl: () => {
      setImmediate(() => {
        child.stderr.write("primary-cleanup-tail\n");
        child.exitCode = 1;
        child.emit("exit", 1, null);
      });
      return child;
    },
    terminateProcessTreeImpl: async () => {
      throw new Error("termination failed after primary failure");
    },
    waitForPortReleaseImpl: async () => {
      throw new Error("release failed after primary failure");
    },
    logger: silentLogger(),
  });

  await assert.rejects(verification, (error) => {
    assert.equal(error instanceof global.AggregateError, true);
    assert.match(error.message, /verification failed and its owned-process cleanup also failed/);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /exited before compilation/);
    assert.match(error.errors[0].message, /primary-cleanup-tail/);
    assert.equal(error.errors[1] instanceof global.AggregateError, true);
    assert.equal(error.errors[1].errors.length, 2);
    assert.match(error.errors[1].errors[0].message, /termination failed after primary failure/);
    assert.match(error.errors[1].errors[1].message, /release failed after primary failure/);
    return true;
  });
});

test("Windows cleanup invokes taskkill for only the captured PID tree", async () => {
  const child = createFakeChild(9876);
  let invocation = null;

  await terminateProcessTree(child, {
    platform: "win32",
    cleanupTimeoutMs: 100,
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      setImmediate(() => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      });
      return { status: 0, stdout: "SUCCESS", stderr: "" };
    },
  });

  assert.equal(invocation.command, "taskkill");
  assert.deepEqual(invocation.args, ["/PID", "9876", "/T", "/F"]);
  assert.equal(invocation.options.windowsHide, true);
});

test("Windows cleanup tolerates a wrapper that exits after taskkill reports a stale PID", async () => {
  const child = createFakeChild(9877);

  await terminateProcessTree(child, {
    platform: "win32",
    cleanupTimeoutMs: 100,
    spawnSyncImpl: () => {
      setImmediate(() => {
        child.exitCode = 0;
        child.emit("exit", 0, null);
      });
      return {
        status: 128,
        stdout: "",
        stderr: "ERROR: There is no running instance of the task.",
      };
    },
  });

  assert.equal(child.exitCode, 0);
});

test("bounded output retains only the configured tail", () => {
  const output = new BoundedOutput(8);
  output.append("12345");
  output.append("67890");
  assert.equal(output.toString(), "34567890");
});
