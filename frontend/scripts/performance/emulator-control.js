const fs = require('fs');
const { assertDemoProject, projectId: defaultProjectId } = require('./common');

const DEFAULT_HUB_BASE_URL = 'http://127.0.0.1:4400';
const DEFAULT_HOSTING_BASE_URL = 'http://127.0.0.1:5000';
const DEFAULT_FUNCTIONS_BASE_URL = 'http://127.0.0.1:5001';
const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TRIGGER_CONTROL_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_INTERVAL_MS = 500;
const DEFAULT_CONSECUTIVE_HEALTH_SAMPLES = 3;
const DEFAULT_LOG_BUDGET_BYTES = 25 * 1024 * 1024;
const REQUIRED_EMULATORS = Object.freeze([
  'auth',
  'firestore',
  'functions',
  'hosting',
  'storage',
]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalizeError = (error) => (
  error instanceof Error ? error : new Error(String(error))
);

const assertPositiveNumber = (value, label, { allowZero = false } = {}) => {
  const valid = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (!valid) {
    throw new TypeError(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} number.`);
  }
  return value;
};

const normalizeLoopbackBaseUrl = (candidate, label) => {
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    throw new Error(`${label} must be a valid loopback HTTP URL.`);
  }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`${label} must use HTTP on a loopback host.`);
  }
  if (parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error(`${label} must not include credentials or a path.`);
  }
  parsed.pathname = '/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

const readResponseDetail = async (response) => {
  if (typeof response?.text !== 'function') return '';
  try {
    return String(await response.text()).slice(0, 500).trim();
  } catch (_error) {
    return '';
  }
};

const fetchWithTimeout = async (fetchImpl, url, init, timeoutMs, label) => {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  assertPositiveNumber(timeoutMs, 'request timeout');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = controller.signal.aborted
      ? `timed out after ${timeoutMs} ms`
      : normalizeError(error).message;
    throw new Error(`${label} failed: ${reason}.`, { cause: normalizeError(error) });
  } finally {
    clearTimeout(timer);
  }
};

const requireOkResponse = async (response, label) => {
  if (response?.ok) return response;
  const status = Number.isFinite(response?.status) ? response.status : 'unknown';
  const detail = await readResponseDetail(response);
  throw new Error(`${label} returned HTTP ${status}${detail ? ` (${detail})` : ''}.`);
};

const setBackgroundTriggersEnabled = async (enabled, {
  fetchImpl = global.fetch,
  hubBaseUrl = DEFAULT_HUB_BASE_URL,
  timeoutMs = DEFAULT_TRIGGER_CONTROL_TIMEOUT_MS,
  projectId = defaultProjectId,
} = {}) => {
  assertDemoProject(projectId);
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
  const baseUrl = normalizeLoopbackBaseUrl(hubBaseUrl, 'Firebase Emulator Hub URL');
  const action = enabled ? 'enableBackgroundTriggers' : 'disableBackgroundTriggers';
  const response = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/functions/${action}`,
    { method: 'PUT' },
    timeoutMs,
    `Firebase background-trigger ${enabled ? 'enable' : 'disable'} request`
  );
  await requireOkResponse(response, `Firebase background-trigger ${enabled ? 'enable' : 'disable'} request`);
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('Firebase Emulator Hub returned an invalid background-trigger response.', {
      cause: normalizeError(error),
    });
  }
  if (payload?.enabled !== enabled) {
    throw new Error(
      `Firebase Emulator Hub did not confirm background triggers were ${enabled ? 'enabled' : 'disabled'}.`
    );
  }
};

const withBackgroundTriggersDisabled = async (operation, options = {}) => {
  assertDemoProject(options.projectId ?? defaultProjectId);
  if (typeof operation !== 'function') throw new TypeError('operation must be a function.');

  await setBackgroundTriggersEnabled(false, options);
  let result;
  let operationError;
  try {
    result = await operation();
  } catch (error) {
    operationError = normalizeError(error);
  }

  let cleanupError;
  try {
    await setBackgroundTriggersEnabled(true, options);
  } catch (error) {
    cleanupError = normalizeError(error);
  }

  if (operationError && cleanupError) {
    throw new global.AggregateError(
      [operationError, cleanupError],
      'The emulator operation failed and background triggers could not be re-enabled.'
    );
  }
  if (operationError) throw operationError;
  if (cleanupError) throw cleanupError;
  return result;
};

const readFixtureManifest = async (db, requestTimeoutMs) => {
  if (!db || typeof db.doc !== 'function') {
    throw new TypeError('db must be an initialized Firestore Admin SDK instance.');
  }
  const readPromise = Promise.resolve().then(() => db.doc('perf_meta/fixture').get());
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Firestore fixture probe timed out after ${requestTimeoutMs} ms.`)),
      requestTimeoutMs
    );
    timer.unref?.();
  });
  try {
    const snapshot = await Promise.race([readPromise, timeoutPromise]);
    if (!snapshot?.exists) throw new Error('Firestore fixture manifest is missing.');
    return snapshot.data();
  } finally {
    clearTimeout(timer);
  }
};

const probeHttpEndpoint = async ({ fetchImpl, url, requestTimeoutMs, label }) => {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    { method: 'GET' },
    requestTimeoutMs,
    label
  );
  await requireOkResponse(response, label);
  return { status: response.status };
};

const collectHealthSample = async ({
  fetchImpl,
  db,
  expectedManifest,
  projectId,
  hubBaseUrl,
  hostingBaseUrl,
  functionsBaseUrl,
  functionsRegion,
  requiredEmulators,
  requestTimeoutMs,
}) => {
  const hubResponse = await fetchWithTimeout(
    fetchImpl,
    `${hubBaseUrl}/emulators`,
    { method: 'GET' },
    requestTimeoutMs,
    'Firebase Emulator Hub probe'
  );
  await requireOkResponse(hubResponse, 'Firebase Emulator Hub probe');
  let registrations;
  try {
    registrations = await hubResponse.json();
  } catch (error) {
    throw new Error('Firebase Emulator Hub returned invalid JSON.', { cause: normalizeError(error) });
  }
  const missing = requiredEmulators.filter((name) => !registrations?.[name]);
  if (missing.length) {
    throw new Error(`Firebase Emulator Hub is missing registrations: ${missing.join(', ')}.`);
  }

  const hosting = await probeHttpEndpoint({
    fetchImpl,
    url: `${hostingBaseUrl}/`,
    requestTimeoutMs,
    label: 'Firebase Hosting emulator probe',
  });
  const functions = await probeHttpEndpoint({
    fetchImpl,
    url: `${functionsBaseUrl}/${encodeURIComponent(projectId)}/${encodeURIComponent(functionsRegion)}/clientFirebaseConfig`,
    requestTimeoutMs,
    label: 'clientFirebaseConfig function probe',
  });
  const manifest = await readFixtureManifest(db, requestTimeoutMs);
  if (manifest?.version !== expectedManifest.version || manifest?.hash !== expectedManifest.hash) {
    throw new Error(
      `Firestore fixture manifest mismatch: expected ${expectedManifest.version}/${expectedManifest.hash}, `
      + `found ${manifest?.version ?? 'missing'}/${manifest?.hash ?? 'missing'}.`
    );
  }

  return {
    hub: { registered: [...requiredEmulators] },
    hosting,
    functions,
    fixture: { version: manifest.version, hash: manifest.hash },
  };
};

const waitForEmulatorHealth = async ({
  fetchImpl = global.fetch,
  db,
  expectedManifest,
  projectId = defaultProjectId,
  hubBaseUrl = DEFAULT_HUB_BASE_URL,
  hostingBaseUrl = DEFAULT_HOSTING_BASE_URL,
  functionsBaseUrl = DEFAULT_FUNCTIONS_BASE_URL,
  functionsRegion = 'europe-west1',
  requiredEmulators = REQUIRED_EMULATORS,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  intervalMs = DEFAULT_HEALTH_INTERVAL_MS,
  consecutiveSamples = DEFAULT_CONSECUTIVE_HEALTH_SAMPLES,
  sleepImpl = delay,
  nowImpl = Date.now,
} = {}) => {
  assertDemoProject(projectId);
  if (!expectedManifest?.version || !expectedManifest?.hash) {
    throw new TypeError('expectedManifest must contain non-empty version and hash fields.');
  }
  if (!Array.isArray(requiredEmulators) || !requiredEmulators.length) {
    throw new TypeError('requiredEmulators must be a non-empty array.');
  }
  if (typeof sleepImpl !== 'function' || typeof nowImpl !== 'function') {
    throw new TypeError('sleepImpl and nowImpl must be functions.');
  }
  assertPositiveNumber(timeoutMs, 'health timeout');
  assertPositiveNumber(requestTimeoutMs, 'request timeout');
  assertPositiveNumber(intervalMs, 'health interval', { allowZero: true });
  assertPositiveNumber(consecutiveSamples, 'consecutiveSamples');

  const normalizedHubBaseUrl = normalizeLoopbackBaseUrl(hubBaseUrl, 'Firebase Emulator Hub URL');
  const normalizedHostingBaseUrl = normalizeLoopbackBaseUrl(hostingBaseUrl, 'Firebase Hosting emulator URL');
  const normalizedFunctionsBaseUrl = normalizeLoopbackBaseUrl(functionsBaseUrl, 'Firebase Functions emulator URL');
  const startedAtMs = nowImpl();
  const deadlineMs = startedAtMs + timeoutMs;
  const samples = [];
  let consecutiveHealthy = 0;

  while (nowImpl() <= deadlineMs) {
    const sampledAtMs = nowImpl();
    try {
      const checks = await collectHealthSample({
        fetchImpl,
        db,
        expectedManifest,
        projectId,
        hubBaseUrl: normalizedHubBaseUrl,
        hostingBaseUrl: normalizedHostingBaseUrl,
        functionsBaseUrl: normalizedFunctionsBaseUrl,
        functionsRegion,
        requiredEmulators,
        requestTimeoutMs,
      });
      consecutiveHealthy += 1;
      samples.push({ sampledAtMs, healthy: true, checks });
      if (consecutiveHealthy >= consecutiveSamples) {
        return {
          healthy: true,
          projectId,
          consecutiveSamples,
          elapsedMs: Math.max(0, nowImpl() - startedAtMs),
          samples,
        };
      }
    } catch (error) {
      consecutiveHealthy = 0;
      samples.push({
        sampledAtMs,
        healthy: false,
        error: normalizeError(error).message,
      });
    }

    const remainingMs = deadlineMs - nowImpl();
    if (remainingMs <= 0) break;
    await sleepImpl(Math.min(intervalMs, remainingMs));
  }

  const lastFailure = [...samples].reverse().find((sample) => !sample.healthy)?.error
    || 'the required consecutive healthy samples were not observed';
  const error = new Error(
    `Firebase emulators were not healthy within ${timeoutMs} ms (${lastFailure}).`
  );
  error.samples = samples;
  throw error;
};

const assertLogWithinBudget = ({
  logPath,
  maxBytes = DEFAULT_LOG_BUDGET_BYTES,
  fsImpl = fs,
  projectId = defaultProjectId,
} = {}) => {
  assertDemoProject(projectId);
  if (!logPath) throw new TypeError('logPath is required.');
  assertPositiveNumber(maxBytes, 'log budget');
  const sizeBytes = fsImpl.existsSync(logPath) ? fsImpl.statSync(logPath).size : 0;
  if (sizeBytes > maxBytes) {
    throw new Error(
      `Emulator log exceeded its ${maxBytes}-byte budget (${sizeBytes} bytes); `
      + 'this indicates a possible background-trigger storm.'
    );
  }
  return { logPath, sizeBytes, maxBytes };
};

module.exports = {
  DEFAULT_CONSECUTIVE_HEALTH_SAMPLES,
  DEFAULT_HEALTH_INTERVAL_MS,
  DEFAULT_HEALTH_TIMEOUT_MS,
  DEFAULT_LOG_BUDGET_BYTES,
  DEFAULT_TRIGGER_CONTROL_TIMEOUT_MS,
  REQUIRED_EMULATORS,
  assertLogWithinBudget,
  setBackgroundTriggersEnabled,
  waitForEmulatorHealth,
  withBackgroundTriggersDisabled,
};
