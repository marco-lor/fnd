const { spawn, spawnSync } = require('node:child_process');

const DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_TERMINATION_TIMEOUT_MS = 15_000;

const normalizeError = (error) => (
  error instanceof Error ? error : new Error(String(error))
);

const assertPositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
};

const appendBounded = (current, chunk, limit) => {
  const next = current + (Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  return next.length > limit ? next.slice(-limit) : next;
};

const childHasExited = (child) => (
  child?.exitCode != null || child?.signalCode != null
);

const waitForChildExit = (child, timeoutMs = DEFAULT_TERMINATION_TIMEOUT_MS) => {
  if (childHasExited(child)) return Promise.resolve();
  assertPositiveInteger(timeoutMs, 'Owned child exit timeout');
  return new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(
        `Owned child process ${child.pid ?? 'unknown'} did not exit within ${timeoutMs} ms.`
      ));
    }, timeoutMs);
    child.once('exit', onExit);
  });
};

const terminateOwnedProcessTree = async (child, {
  platform = process.platform,
  spawnSyncImpl = spawnSync,
  killImpl = process.kill,
  timeoutMs = DEFAULT_TERMINATION_TIMEOUT_MS,
} = {}) => {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0 || childHasExited(child)) {
    return;
  }
  assertPositiveInteger(timeoutMs, 'Owned process-tree termination timeout');

  if (platform === 'win32') {
    const result = spawnSyncImpl(
      'taskkill.exe',
      ['/PID', String(child.pid), '/T', '/F'],
      { encoding: 'utf8', windowsHide: true }
    );
    if (result.error) throw normalizeError(result.error);
    if (result.status !== 0 && !childHasExited(child)) {
      try {
        await waitForChildExit(child, Math.min(1_000, timeoutMs));
      } catch (_exitError) {
        throw new Error(
          `taskkill failed for owned process tree ${child.pid}: `
          + `${String(result.stderr || result.stdout || 'unknown error').trim()}`
        );
      }
      return;
    }
    await waitForChildExit(child, timeoutMs);
    return;
  }

  try {
    killImpl(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw normalizeError(error);
  }
  try {
    await waitForChildExit(child, Math.min(5_000, timeoutMs));
  } catch (gracefulError) {
    try {
      killImpl(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        throw new global.AggregateError(
          [gracefulError, normalizeError(error)],
          'Owned process group ignored graceful termination and could not be killed.'
        );
      }
    }
    await waitForChildExit(child, timeoutMs);
  }
};

const runBoundedChildProcess = async ({
  command,
  args = [],
  cwd = process.cwd(),
  environment = process.env,
  timeoutMs,
  label = 'Child process',
  captureOutput = true,
  outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
  platform = process.platform,
  spawnImpl = spawn,
  terminateProcessTreeImpl = terminateOwnedProcessTree,
} = {}) => {
  if (typeof command !== 'string' || !command) {
    throw new TypeError('Bounded child command must be a non-empty string.');
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('Bounded child arguments must be strings.');
  }
  assertPositiveInteger(timeoutMs, `${label} timeout`);
  assertPositiveInteger(outputLimitBytes, `${label} output limit`);

  const child = spawnImpl(command, args, {
    cwd,
    env: environment,
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
    shell: false,
    detached: platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout = appendBounded(stdout, chunk, outputLimitBytes);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = appendBounded(stderr, chunk, outputLimitBytes);
  });

  let timer;
  const completion = new Promise((resolve) => {
    child.once('error', (error) => resolve({ kind: 'error', error }));
    child.once('exit', (status, signal) => resolve({ kind: 'exit', status, signal }));
  });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const outcome = await Promise.race([completion, timeout]);
  clearTimeout(timer);

  if (outcome.kind === 'timeout') {
    const timeoutError = new Error(`${label} timed out after ${timeoutMs} ms.`);
    timeoutError.code = 'ETIMEDOUT';
    try {
      await terminateProcessTreeImpl(child, { platform });
    } catch (cleanupError) {
      throw new global.AggregateError(
        [timeoutError, normalizeError(cleanupError)],
        `${label} timed out and its owned process tree could not be stopped.`
      );
    }
    throw timeoutError;
  }
  if (outcome.kind === 'error') throw normalizeError(outcome.error);

  return {
    status: Number.isInteger(outcome.status) ? outcome.status : null,
    signal: outcome.signal || null,
    stdout,
    stderr,
  };
};

module.exports = {
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_TERMINATION_TIMEOUT_MS,
  runBoundedChildProcess,
  terminateOwnedProcessTree,
  waitForChildExit,
};
