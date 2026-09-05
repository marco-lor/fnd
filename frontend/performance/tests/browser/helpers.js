const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const {
  configureOwnedPerformanceEnvironment,
  PERFORMANCE_STORAGE_BUCKET,
  projectId,
  readJson,
  resultsDir,
  sha256,
  writeJson,
} = require('../../../scripts/performance/common');
const fixtureManifest = require('../../fixture-manifest.json');

const GOOGLE_FONT_URL = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//;
const FIRESTORE_EMULATOR_STARTUP_WARNING = /^(?:\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\]\s+)?@firebase\/firestore:\s+Firestore \(\d+\.\d+\.\d+\): Could not reach Cloud Firestore backend\. Backend didn't respond within 10 seconds\.\s+This typically indicates that your device does not have a healthy Internet connection at the moment\. The client will operate in offline mode until it is able to successfully connect to the backend\.$/;
const FIRESTORE_STREAM_PATH = /^\/google\.firestore\.v1\.Firestore\/(Listen|Write)\/channel$/;
const FIRESTORE_EMULATOR_ORIGIN = 'http://127.0.0.1:8080';
const FIRESTORE_EMULATOR_DATABASE = `projects/${projectId}/databases/(default)`;
const FIRESTORE_WEBCHANNEL_CONTINUATION_KEYS = [
  'AID',
  'CI',
  'RID',
  'SID',
  'TYPE',
  'VER',
  'database',
  't',
  'zx',
];
const FIVE_PEER_DIAGNOSTIC_ROLES = new Set(['player', 'peer-2', 'peer-3', 'peer-4', 'dm']);
const FIVE_PEER_DIAGNOSTIC_PHASES = new Set([
  'route-navigation',
  'route-active',
  'route-cleanup',
]);
const FIVE_PEER_DIAGNOSTIC_RESOURCE_TYPES = new Set([
  'document',
  'fetch',
  'image',
  'media',
  'script',
  'stylesheet',
  'xhr',
]);
const FIVE_PEER_DIAGNOSTIC_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);
const MAX_FIVE_PEER_DIAGNOSTIC_QUERY_KEYS = 16;
const RESOURCE_TIMING_BUFFER_SIZE = 5_000;
const MAX_RETAINED_IMAGE_RESOURCE_TIMINGS = 128;
const MAX_RETAINED_LONG_TASK_ENTRIES = 64;
const MAX_RETAINED_PAGE_ASSET_ENTRIES = 64;
const MAX_PAGE_ASSET_DIAGNOSTIC_AGE_MS = 600_000;
const LONG_TASK_SCENARIO_PHASES = new Set([
  'route-readiness',
  'route-active',
  'asset-settlement',
  'lcp-settlement',
  'interaction',
  'post-interaction-settlement',
  'capture',
]);
const LONG_TASK_ROUTE_PHASES = new Map([
  ['start', 'route-start'],
  ['shell-visible', 'shell-visible'],
  ['data-ready', 'data-ready'],
  ['interactive', 'interactive'],
]);

const demoFirestoreStreamOperation = (url) => {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return null;
  }
  if (
    parsed.origin !== FIRESTORE_EMULATOR_ORIGIN
    || parsed.searchParams.get('database') !== FIRESTORE_EMULATOR_DATABASE
  ) {
    return null;
  }
  return parsed.pathname.match(FIRESTORE_STREAM_PATH)?.[1] || null;
};

const STORAGE_EMULATOR_ORIGIN = 'http://127.0.0.1:9199';
const TASK07_FIXTURE_IMAGE_PATH = new RegExp(
  `^\\/v0\\/b\\/${PERFORMANCE_STORAGE_BUCKET.replace(/\./g, '\\.')}`
    + '\\/o\\/performance%2Fimage-\\d{3}\\.png$',
  'i'
);
const STATIC_ASSET_WARMUP_PATH = /^static\/(js|css)\/[^/]+\.(js|css)$/;
const BROWSER_ASSET_WARMUP_ORIGIN = 'http://127.0.0.1:5000';
const BROWSER_ASSET_WARMUP_BATCH_SIZE = 4;
const BROWSER_ASSET_WARM_PASS_TIMEOUT_MS = 30_000;
const BROWSER_ASSET_VALIDATION_PASS_TIMEOUT_MS = 5_000;
const BROWSER_ASSET_VALIDATION_TRANSIENT_RETRY_LIMIT = 1;
const BUILD_REPORT_PATH = path.join(resultsDir, 'build-report.json');
const LIFECYCLE_STREAM_OPERATIONS = {
  'auth-transition': new Set(['Listen']),
  'connection-drain': new Set(['Listen', 'Write']),
  'route-cleanup': new Set(['Listen', 'Write']),
};

const createStaticAssetWarmupBatches = (buildReport, { batchSize = 6 } = {}) => {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 16) {
    throw new TypeError('Static asset warmup batchSize must be an integer from 1 through 16.');
  }
  if (
    buildReport?.schemaVersion !== 1
    || buildReport?.buildMode !== 'performance'
    || buildReport?.projectId !== projectId
  ) {
    throw new Error(`Static asset warmup requires the ${projectId} performance build report.`);
  }
  if (!Array.isArray(buildReport.assets)) {
    throw new Error('Static asset warmup requires a build-report asset inventory.');
  }

  const seenPaths = new Set();
  const assets = buildReport.assets
    .filter((asset) => asset?.category === 'javascript' || asset?.category === 'css')
    .map((asset) => {
      const assetPath = String(asset.path || '').replace(/\\/g, '/');
      const match = assetPath.match(STATIC_ASSET_WARMUP_PATH);
      const expectedCategory = match?.[2] === 'js' ? 'javascript' : match?.[2];
      if (!match || match[1] !== match[2] || expectedCategory !== asset.category) {
        throw new Error(`Static asset warmup rejected an invalid build path: ${assetPath || 'missing'}.`);
      }
      if (seenPaths.has(assetPath)) {
        throw new Error(`Static asset warmup rejected duplicate build path: ${assetPath}.`);
      }
      const rawBytes = Number(asset.rawBytes);
      if (!Number.isSafeInteger(rawBytes) || rawBytes <= 0) {
        throw new Error(`Static asset warmup requires positive rawBytes for ${assetPath}.`);
      }
      const sha256 = String(asset.sha256 || '').toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error(`Static asset warmup requires a SHA-256 digest for ${assetPath}.`);
      }
      seenPaths.add(assetPath);
      return {
        category: asset.category,
        path: `/${assetPath}`,
        rawBytes,
        sha256,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  if (!assets.length) {
    throw new Error('Static asset warmup found no JavaScript or CSS build assets.');
  }

  return Array.from(
    { length: Math.ceil(assets.length / batchSize) },
    (_unused, index) => assets.slice(index * batchSize, (index + 1) * batchSize)
  );
};

const assertStaticAssetWarmupInventory = (batches, actualPaths) => {
  if (!Array.isArray(batches) || !Array.isArray(actualPaths)) {
    throw new TypeError('Static asset warmup inventory comparison requires arrays.');
  }
  const plannedPaths = batches.flat().map(({ path: assetPath }) => (
    String(assetPath || '').replace(/^\/+/, '').replace(/\\/g, '/')
  )).sort();
  const normalizedActualPaths = actualPaths.map((assetPath) => (
    String(assetPath || '').replace(/^\/+/, '').replace(/\\/g, '/')
  )).sort();
  const planned = new Set(plannedPaths);
  const actual = new Set(normalizedActualPaths);
  const missing = plannedPaths.filter((assetPath) => !actual.has(assetPath));
  const unreported = normalizedActualPaths.filter((assetPath) => !planned.has(assetPath));
  if (missing.length || unreported.length) {
    throw new Error(
      'Static asset warmup build-report inventory is stale. '
      + `Missing: ${missing.join(', ') || 'none'}. `
      + `Unreported: ${unreported.join(', ') || 'none'}.`
    );
  }
  return { assetCount: plannedPaths.length };
};

const runStaticAssetWarmupPass = async ({
  batches,
  passName,
  requestAsset,
  timeoutMs,
  now = Date.now,
}) => {
  if (!Array.isArray(batches) || !batches.length || batches.some((batch) => !Array.isArray(batch))) {
    throw new TypeError('Static asset warmup requires non-empty request batches.');
  }
  if (typeof requestAsset !== 'function' || typeof now !== 'function') {
    throw new TypeError('Static asset warmup requires request and clock functions.');
  }
  if (!String(passName || '').trim()) {
    throw new TypeError('Static asset warmup requires a passName.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Static asset warmup timeoutMs must be positive.');
  }

  const results = [];
  for (const batch of batches) {
    const batchResults = await Promise.all(batch.map(async (asset) => {
      const startedAt = now();
      try {
        const response = await requestAsset(asset, { passName, timeoutMs });
        const status = typeof response?.status === 'function'
          ? Number(response.status())
          : Number(response?.status);
        const headers = typeof response?.headers === 'function'
          ? response.headers()
          : (response?.headers || {});
        const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
        const body = await response.body();
        const bytes = Number(body?.byteLength ?? body?.length ?? 0);
        const sha256 = bytes > 0
          ? crypto.createHash('sha256').update(body).digest('hex')
          : null;
        const expectedContentType = asset.category === 'javascript'
          ? /^(?:application|text)\/javascript\b/i
          : /^text\/css\b/i;
        const violations = [
          ...(status === 200 ? [] : [`HTTP ${Number.isFinite(status) ? status : 'unknown'}`]),
          ...(bytes > 0 ? [] : ['empty response body']),
          ...(expectedContentType.test(contentType)
            ? []
            : [`unexpected content type ${contentType || 'missing'}`]),
          ...(sha256 === asset.sha256 ? [] : ['SHA-256 mismatch']),
        ];
        return {
          bytes,
          contentType,
          durationMs: Math.max(0, now() - startedAt),
          error: violations.join('; ') || null,
          ok: violations.length === 0,
          pass: passName,
          path: asset.path,
          sha256,
          status: Number.isFinite(status) ? status : null,
        };
      } catch (error) {
        return {
          bytes: 0,
          contentType: '',
          durationMs: Math.max(0, now() - startedAt),
          error: error.message,
          ok: false,
          pass: passName,
          path: asset.path,
          sha256: null,
          status: null,
        };
      }
    }));
    results.push(...batchResults);
  }
  return results;
};

const runBrowserStaticAssetWarmupPass = async ({
  batches,
  page,
  passName,
  timeoutMs,
}) => {
  if (!Array.isArray(batches) || !batches.length || batches.some((batch) => !Array.isArray(batch))) {
    throw new TypeError('Browser static asset warmup requires non-empty request batches.');
  }
  if (typeof page?.evaluate !== 'function') {
    throw new TypeError('Browser static asset warmup requires a Playwright page.');
  }
  if (!String(passName || '').trim() || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('Browser static asset warmup requires a passName and positive timeoutMs.');
  }

  const isTransientValidationTimeoutAbort = (result) => (
    passName === 'validation'
    && result?.ok === false
    && result?.status === null
    && result?.timeoutTriggered === true
    && result?.error === 'signal is aborted without reason'
  );
  const results = [];
  for (const batch of batches) {
    const attemptsByPath = new Map(batch.map((asset) => [asset.path, []]));
    let pendingAssets = batch;
    for (let attempt = 1; pendingAssets.length; attempt += 1) {
      const batchResults = await page.evaluate(async ({ assets, requestPass, requestTimeoutMs }) => (
        Promise.all(assets.map(async (asset) => {
        const controller = new AbortController();
        const startedAt = performance.now();
        let timeoutTriggered = false;
        const timer = setTimeout(() => {
          timeoutTriggered = true;
          controller.abort();
        }, requestTimeoutMs);
        try {
          const response = await fetch(asset.path, {
            cache: 'no-store',
            signal: controller.signal,
          });
          const contentType = response.headers.get('content-type') || '';
          const body = await response.arrayBuffer();
          const digest = await crypto.subtle.digest('SHA-256', body);
          const sha256 = Array.from(new Uint8Array(digest), (byte) => (
            byte.toString(16).padStart(2, '0')
          )).join('');
          const expectedContentType = asset.category === 'javascript'
            ? /^(?:application|text)\/javascript\b/i
            : /^text\/css\b/i;
          const violations = [
            ...(response.status === 200 ? [] : [`HTTP ${response.status}`]),
            ...(body.byteLength > 0 ? [] : ['empty response body']),
            ...(expectedContentType.test(contentType)
              ? []
              : [`unexpected content type ${contentType || 'missing'}`]),
            ...(sha256 === asset.sha256 ? [] : ['SHA-256 mismatch']),
          ];
          return {
            bytes: body.byteLength,
            contentType,
            durationMs: Math.max(0, performance.now() - startedAt),
            error: violations.join('; ') || null,
            ok: violations.length === 0,
            pass: requestPass,
            path: asset.path,
            sha256,
            status: response.status,
            timeoutTriggered,
          };
        } catch (error) {
          return {
            bytes: 0,
            contentType: '',
            durationMs: Math.max(0, performance.now() - startedAt),
            error: error.message,
            ok: false,
            pass: requestPass,
            path: asset.path,
            sha256: null,
            status: null,
            timeoutTriggered,
          };
        } finally {
          clearTimeout(timer);
        }
        }))
      ), {
        assets: pendingAssets,
        requestPass: passName,
        requestTimeoutMs: timeoutMs,
      });
      const attemptByPath = new Map(batchResults.map((result) => [result?.path, result]));
      pendingAssets.forEach((asset) => {
        const result = attemptByPath.get(asset.path) || {
          bytes: 0,
          contentType: '',
          durationMs: 0,
          error: 'browser asset request produced no matching result',
          ok: false,
          pass: passName,
          path: asset.path,
          sha256: null,
          status: null,
          timeoutTriggered: false,
        };
        attemptsByPath.get(asset.path).push({ ...result, attempt });
      });
      const mayRetry = attempt <= BROWSER_ASSET_VALIDATION_TRANSIENT_RETRY_LIMIT;
      pendingAssets = mayRetry
        ? pendingAssets.filter((asset) => isTransientValidationTimeoutAbort(
          attemptsByPath.get(asset.path).at(-1)
        ))
        : [];
    }
    batch.forEach((asset) => {
      const attempts = attemptsByPath.get(asset.path);
      const finalResult = attempts.at(-1);
      results.push({
        ...finalResult,
        attemptCount: attempts.length,
        attempts,
      });
    });
  }
  return results;
};

const warmBrowserAssetDelivery = async ({
  baseURL,
  browser,
  context: providedContext,
  diagnosticsPath,
  owner,
  buildReport = null,
  writeDiagnostics = writeJson,
}) => {
  const ownerLabel = String(owner || 'unspecified');
  const derivedDiagnosticsPath = /^[a-z0-9-]+$/.test(ownerLabel)
    ? path.join(resultsDir, `browser-asset-warmup-${ownerLabel}.json`)
    : null;
  const resolvedDiagnosticsPath = path.resolve(String(
    diagnosticsPath || derivedDiagnosticsPath || ''
  ));
  if (
    path.dirname(resolvedDiagnosticsPath) !== path.resolve(resultsDir)
    || path.extname(resolvedDiagnosticsPath) !== '.json'
  ) {
    throw new Error('Browser asset warmup diagnostics must be a JSON file in performance-results.');
  }
  if (
    typeof writeDiagnostics !== 'function'
    || (
      typeof providedContext?.newPage !== 'function'
      && typeof browser?.newContext !== 'function'
    )
  ) {
    throw new TypeError(
      'Browser asset warmup requires a Playwright browser or context and diagnostics writer.'
    );
  }
  const diagnostics = {
    schemaVersion: 1,
    generatedAt: null,
    projectId,
    owner: ownerLabel,
    status: 'running',
    assetCount: 0,
    batchSize: BROWSER_ASSET_WARMUP_BATCH_SIZE,
    validationTransientRetryLimit: BROWSER_ASSET_VALIDATION_TRANSIENT_RETRY_LIMIT,
    passes: [],
    failure: null,
  };
  let context = providedContext;
  let ownsContext = false;
  let page;
  let warmupMatcher;
  let warmupHandler;
  let operationError = null;
  try {
    const origin = new URL(baseURL).origin;
    if (origin !== BROWSER_ASSET_WARMUP_ORIGIN) {
      throw new Error(`Browser asset warmup refuses non-owned origin: ${origin}.`);
    }
    const batches = createStaticAssetWarmupBatches(
      buildReport || readJson(BUILD_REPORT_PATH),
      { batchSize: BROWSER_ASSET_WARMUP_BATCH_SIZE }
    );
    diagnostics.assetCount = batches.flat().length;
    const warmupUrl = `${origin}/__fnd_perf_browser_asset_warmup__`;
    if (!context) {
      context = await browser.newContext({ baseURL: origin });
      ownsContext = true;
    }
    warmupMatcher = (url) => url.href === warmupUrl;
    warmupHandler = (route) => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>asset warmup</body></html>',
    });
    await context.route(warmupMatcher, warmupHandler);
    page = await context.newPage();
    await page.goto(warmupUrl, { waitUntil: 'load', timeout: 15_000 });

    for (const [passName, timeoutMs] of [
      ['warm', BROWSER_ASSET_WARM_PASS_TIMEOUT_MS],
      ['validation', BROWSER_ASSET_VALIDATION_PASS_TIMEOUT_MS],
    ]) {
      const results = await runBrowserStaticAssetWarmupPass({
        batches,
        page,
        passName,
        timeoutMs,
      });
      diagnostics.passes.push({
        name: passName,
        timeoutMs,
        transientRetryLimit: passName === 'validation'
          ? BROWSER_ASSET_VALIDATION_TRANSIENT_RETRY_LIMIT
          : 0,
        results,
      });
    }
    const failures = diagnostics.passes.flatMap((pass) => (
      pass.results.filter((result) => !result.ok)
    ));
    if (failures.length) {
      throw new Error(
        `Browser static asset warmup failed ${failures.length} requests: `
        + failures.slice(0, 10).map((failure) => (
          `${failure.pass} ${failure.path}: ${failure.error}`
        )).join('; ')
      );
    }
    diagnostics.status = 'passed';
  } catch (error) {
    operationError = error;
    diagnostics.status = 'failed';
    diagnostics.failure = { message: error.message, stack: error.stack };
  } finally {
    try {
      await page?.close?.();
    } catch (error) {
      operationError ||= error;
      diagnostics.status = 'failed';
      diagnostics.failure ||= { message: error.message, stack: error.stack };
    }
    if (!ownsContext && typeof context?.unroute === 'function' && warmupMatcher) {
      try {
        await context.unroute(warmupMatcher, warmupHandler);
      } catch (error) {
        operationError ||= error;
        diagnostics.status = 'failed';
        diagnostics.failure ||= { message: error.message, stack: error.stack };
      }
    }
    if (ownsContext) {
      try {
        await context?.close();
      } catch (error) {
        operationError ||= error;
        diagnostics.status = 'failed';
        diagnostics.failure ||= { message: error.message, stack: error.stack };
      }
    }
    diagnostics.generatedAt = new Date().toISOString();
    writeDiagnostics(resolvedDiagnosticsPath, diagnostics);
  }
  if (operationError) throw operationError;
  return diagnostics;
};

const AUTH_DIRECTORY = path.resolve(__dirname, '..', '..', '..', 'playwright', '.auth');
const ACCOUNT = {
  'new-player': { uid: 'perf-new-player', state: 'new-player.json' },
  player: { uid: 'perf-player', state: 'player.json' },
  dm: { uid: 'perf-dm', state: 'dm.json' },
  webmaster: { uid: 'perf-webmaster', state: 'webmaster.json' },
  'peer-2': { uid: 'perf-peer-2', state: 'peer-2.json' },
  'peer-3': { uid: 'perf-peer-3', state: 'peer-3.json' },
  'peer-4': { uid: 'perf-peer-4', state: 'peer-4.json' },
  'peer-5': { uid: 'perf-peer-5', state: 'peer-5.json' },
};

const storageStateForRole = (role) => {
  if (role === 'anonymous') return undefined;
  const account = ACCOUNT[role];
  if (!account) throw new Error(`No performance account configured for role ${role}`);
  return path.join(AUTH_DIRECTORY, account.state);
};

const isKnownDemoFirestoreStartupWarning = (text, {
  baseURL,
  beforeReadiness,
  firebaseProjectId = projectId,
} = {}) => {
  if (firebaseProjectId !== projectId || beforeReadiness !== true) return false;
  let hostname;
  try {
    hostname = new URL(baseURL).hostname;
  } catch (_error) {
    return false;
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return false;
  return FIRESTORE_EMULATOR_STARTUP_WARNING.test(String(text || '').trim());
};

const isExpectedFirestoreLifecycleCancellation = ({
  lifecyclePhase,
  resourceType,
  failure,
  url,
  firebaseProjectId = projectId,
} = {}) => {
  const allowedOperations = LIFECYCLE_STREAM_OPERATIONS[lifecyclePhase];
  if (
    firebaseProjectId !== projectId
    || !allowedOperations
    || resourceType !== 'fetch'
    || failure !== 'net::ERR_ABORTED'
  ) {
    return false;
  }

  const operation = demoFirestoreStreamOperation(url);
  return Boolean(operation && allowedOperations.has(operation));
};

const isHttpResponseStatus = (value) => (
  Number.isInteger(value) && value >= 0 && value <= 999
);

const resolvePlaywrightResponseStatus = async (request, observedStatuses) => {
  const observed = observedStatuses?.get?.(request);
  if (isHttpResponseStatus(observed)) return observed;
  try {
    const response = await request?.response?.();
    const status = response?.status?.();
    return isHttpResponseStatus(status) ? status : undefined;
  } catch (_error) {
    return undefined;
  }
};

const classifyProtocolLiteral = (value, expected) => {
  if (value === null) return 'missing';
  return expected.includes(value) ? value : 'other';
};

const classifyRequestId = (value) => {
  if (value === null) return 'missing';
  if (value === 'rpc') return 'rpc';
  if (/^\d+$/.test(value)) return 'numeric';
  return 'other';
};

const describeOpaqueQueryValue = (value, pattern, matchedFormat = 'token') => ({
  present: value !== null,
  length: value === null ? 0 : Math.min(value.length, 4096),
  format: value === null ? 'missing' : pattern.test(value) ? matchedFormat : 'other',
});

const sanitizeFivePeerRequestFailure = ({
  role,
  lifecyclePhase,
  sequence,
  elapsedMs,
  resourceType,
  failure,
  method,
  responseStatus,
  url,
} = {}) => {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (_error) {
    // Invalid URLs stay fail-closed while retaining only categorical evidence.
  }
  const rawKeys = parsed ? [...parsed.searchParams.keys()] : [];
  const sanitizedKeys = rawKeys
    .map((key) => (/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(key) ? key : '[redacted]'))
    .sort();
  const retainedKeys = sanitizedKeys.slice(0, MAX_FIVE_PEER_DIAGNOSTIC_QUERY_KEYS);
  const pathname = parsed?.pathname || '';
  const operation = pathname.match(FIRESTORE_STREAM_PATH)?.[1] || null;
  const safePath = operation && pathname.length <= 160 ? pathname : '[redacted]';
  const status = isHttpResponseStatus(responseStatus) ? responseStatus : null;
  const safeElapsedMs = Number.isFinite(elapsedMs)
    ? Math.min(600_000, Math.max(0, Math.round(elapsedMs)))
    : 0;
  const failureText = String(failure || '');
  const safeFailure = failureText.length <= 64 && /^net::ERR_[A-Z0-9_]+$/.test(failureText)
    ? failureText
    : failure === 'unknown' ? 'unknown' : 'other';

  return {
    schemaVersion: 1,
    role: FIVE_PEER_DIAGNOSTIC_ROLES.has(role) ? role : 'unknown',
    lifecyclePhase: FIVE_PEER_DIAGNOSTIC_PHASES.has(lifecyclePhase)
      ? lifecyclePhase
      : 'unknown',
    sequence: Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0,
    elapsedMs: safeElapsedMs,
    resourceType: FIVE_PEER_DIAGNOSTIC_RESOURCE_TYPES.has(resourceType)
      ? resourceType
      : 'other',
    failure: safeFailure,
    method: FIVE_PEER_DIAGNOSTIC_METHODS.has(method) ? method : 'other',
    path: safePath,
    responseObserved: status !== null,
    responseStatus: status,
    ownedEmulatorOrigin: parsed?.origin === FIRESTORE_EMULATOR_ORIGIN,
    expectedDatabase: parsed?.searchParams.get('database') === FIRESTORE_EMULATOR_DATABASE,
    operation,
    query: {
      keys: retainedKeys,
      omittedKeyCount: Math.max(0, sanitizedKeys.length - retainedKeys.length),
      protocol: {
        ver: classifyProtocolLiteral(parsed?.searchParams.get('VER') ?? null, ['8']),
        rid: classifyRequestId(parsed?.searchParams.get('RID') ?? null),
        ci: classifyProtocolLiteral(parsed?.searchParams.get('CI') ?? null, ['0', '1']),
        type: classifyProtocolLiteral(parsed?.searchParams.get('TYPE') ?? null, ['xmlhttp']),
        t: classifyProtocolLiteral(parsed?.searchParams.get('t') ?? null, ['1']),
      },
      opaque: {
        sid: describeOpaqueQueryValue(
          parsed?.searchParams.get('SID') ?? null,
          /^[A-Za-z0-9+/=_-]{8,}$/
        ),
        aid: describeOpaqueQueryValue(
          parsed?.searchParams.get('AID') ?? null,
          /^\d+$/,
          'digits'
        ),
        zx: describeOpaqueQueryValue(
          parsed?.searchParams.get('zx') ?? null,
          /^[A-Za-z0-9_-]{6,}$/
        ),
      },
    },
  };
};

const isExpectedFivePeerFirestoreWriteTurnover = ({
  lifecyclePhase,
  resourceType,
  failure,
  method,
  responseStatus,
  url,
  firebaseProjectId = projectId,
} = {}) => {
  if (
    firebaseProjectId !== projectId
    || lifecyclePhase !== 'route-active'
    || resourceType !== 'fetch'
    || failure !== 'net::ERR_ABORTED'
    || method !== 'GET'
  ) {
    return false;
  }

  if (demoFirestoreStreamOperation(url) !== 'Write') return false;
  if (responseStatus === 200) return true;
  if (responseStatus !== undefined && responseStatus !== null) return false;

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return false;
  }
  const parameterKeys = [...parsed.searchParams.keys()].sort();
  if (
    parameterKeys.length !== FIRESTORE_WEBCHANNEL_CONTINUATION_KEYS.length
    || parameterKeys.some((key, index) => (
      key !== FIRESTORE_WEBCHANNEL_CONTINUATION_KEYS[index]
    ))
  ) {
    return false;
  }
  return parsed.searchParams.get('VER') === '8'
    && parsed.searchParams.get('RID') === 'rpc'
    && /^[A-Za-z0-9+/=_-]{8,}$/.test(parsed.searchParams.get('SID') || '')
    && /^\d+$/.test(parsed.searchParams.get('AID') || '')
    && parsed.searchParams.get('CI') === '0'
    && parsed.searchParams.get('TYPE') === 'xmlhttp'
    && parsed.searchParams.get('t') === '1'
    && /^[A-Za-z0-9_-]{6,}$/.test(parsed.searchParams.get('zx') || '');
};

const isExpectedTask07MediaDetachmentCancellation = ({
  lifecyclePhase,
  resourceType,
  failure,
  url,
  firebaseProjectId = projectId,
} = {}) => {
  if (
    firebaseProjectId !== projectId
    || lifecyclePhase !== 'auth-transition'
    || resourceType !== 'image'
    || failure !== 'net::ERR_ABORTED'
  ) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return false;
  }
  return (
    parsed.origin === STORAGE_EMULATOR_ORIGIN
    && TASK07_FIXTURE_IMAGE_PATH.test(parsed.pathname)
  );
};

const isExpectedTask08CleanupImageCancellation = ({
  lifecyclePhase,
  resourceType,
  failure,
  method,
  url,
  priorNetworkRecords,
  firebaseProjectId = projectId,
} = {}) => {
  if (
    firebaseProjectId !== projectId
    || lifecyclePhase !== 'route-cleanup'
    || resourceType !== 'image'
    || failure !== 'net::ERR_ABORTED'
    || method !== 'GET'
    || !Array.isArray(priorNetworkRecords)
  ) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return false;
  }
  if (
    parsed.origin !== STORAGE_EMULATOR_ORIGIN
    || !TASK07_FIXTURE_IMAGE_PATH.test(parsed.pathname)
  ) {
    return false;
  }
  return priorNetworkRecords.some((record) => (
    record?.path === parsed.pathname
    && record?.resourceType === 'image'
    && record?.method === 'GET'
    && record?.status === 200
  ));
};

const isExpectedDemoRecaptchaCancellation = ({
  lifecyclePhase,
  resourceType,
  failure,
  url,
  firebaseProjectId = projectId,
} = {}) => {
  if (
    firebaseProjectId !== projectId
    || failure !== 'net::ERR_ABORTED'
  ) {
    return false;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return false;
  }
  if (
    resourceType === 'fetch'
    && [
      'auth-bootstrap',
      'auth-transition',
      'connection-drain',
      'route-navigation',
      'route-active',
      'route-cleanup',
    ].includes(lifecyclePhase)
  ) {
    return parsed.origin === 'https://www.google.com'
      && parsed.pathname === '/recaptcha/enterprise/clr';
  }

  return resourceType === 'script'
    && lifecyclePhase === 'route-navigation'
    && parsed.origin === 'https://www.gstatic.com'
    && /^\/recaptcha\/releases\/[A-Za-z0-9_-]+\/recaptcha__en\.js$/.test(parsed.pathname);
};

const isExpectedDemoRecaptchaReportOnlyWarning = (text, {
  baseURL,
  firebaseProjectId = projectId,
} = {}) => {
  if (firebaseProjectId !== projectId) return false;
  let hostname;
  try {
    hostname = new URL(baseURL).hostname;
  } catch (_error) {
    return false;
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) return false;
  const message = String(text || '').trim();
  return message.startsWith(
    "Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive:"
  )
    && message.includes('The violation has been logged, but no further action has been taken.')
    && message.includes("'frame-src' was not explicitly set, so 'default-src' is used as a fallback.");
};

const installDeterministicFontRoutes = async (context) => {
  await context.route(GOOGLE_FONT_URL, (route) => route.fulfill({
    status: 204,
    body: '',
    contentType: 'text/css; charset=utf-8',
  }));
};

const drainPageConnections = async (page) => {
  if (!page || page.isClosed()) return;
  await page.goto('about:blank', { waitUntil: 'load', timeout: 5_000 });
};

const createPageAssetTracker = ({
  now = Date.now,
  quietWindowMs = 500,
} = {}) => {
  const trackedResourceTypes = new Set(['document', 'script', 'stylesheet', 'image', 'font']);
  const shouldTrack = (request) => {
    const resourceType = request.resourceType();
    if (trackedResourceTypes.has(resourceType)) return true;
    if (!['fetch', 'xhr'].includes(resourceType)) return false;
    const requestUrl = typeof request.url === 'function' ? request.url() : '';
    return !demoFirestoreStreamOperation(requestUrl);
  };
  const pending = new Map();
  const diagnosticResourceTypes = new Set([
    ...trackedResourceTypes,
    'fetch',
    'xhr',
  ]);
  const boundedAgeMs = (value) => (
    Number.isFinite(value)
      ? Math.min(MAX_PAGE_ASSET_DIAGNOSTIC_AGE_MS, Math.max(0, Math.round(value)))
      : 0
  );
  const pathnameCategory = (request) => {
    let pathname;
    try {
      const rawUrl = typeof request?.url === 'function' ? request.url() : '';
      pathname = new URL(rawUrl).pathname;
    } catch (_error) {
      return 'unknown';
    }
    if (pathname === '/') return 'root';
    if (/^\/api(?:\/|$)/.test(pathname)) return 'api';
    if (/^\/static(?:\/|$)/.test(pathname)) return 'static';
    return 'other';
  };
  let lastActivityAt = now();
  const touch = () => {
    lastActivityAt = now();
  };
  return {
    begin(request) {
      if (!shouldTrack(request)) return;
      pending.set(request, { startedAt: now() });
      touch();
    },
    complete(request) {
      if (!pending.delete(request)) return;
      touch();
    },
    beginQuietWindow() {
      touch();
    },
    isQuiet() {
      return pending.size === 0 && now() - lastActivityAt >= quietWindowMs;
    },
    pendingCount() {
      return pending.size;
    },
    snapshot() {
      const capturedAt = now();
      const allPending = [...pending.entries()];
      const retainedHeadCount = 16;
      const retainedPending = allPending.length <= MAX_RETAINED_PAGE_ASSET_ENTRIES
        ? allPending
        : [
          ...allPending.slice(0, retainedHeadCount),
          ...allPending.slice(-(
            MAX_RETAINED_PAGE_ASSET_ENTRIES - retainedHeadCount
          )),
        ];
      return {
        pendingCount: pending.size,
        quietForMs: boundedAgeMs(capturedAt - lastActivityAt),
        pending: retainedPending.map(([request, metadata]) => {
          let resourceType = 'other';
          try {
            const candidate = request?.resourceType?.();
            if (diagnosticResourceTypes.has(candidate)) resourceType = candidate;
          } catch (_error) {
            // Diagnostics intentionally collapse unstable request metadata.
          }
          return {
            ageMs: boundedAgeMs(capturedAt - metadata.startedAt),
            pathnameCategory: pathnameCategory(request),
            resourceType,
          };
        }),
      };
    },
  };
};

const flushBrowserObservers = async (page) => {
  await page.evaluate(() => new Promise((resolve) => {
    const afterIdle = () => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(afterIdle, { timeout: 250 });
      return;
    }
    window.setTimeout(afterIdle, 0);
  }));
};

const waitForImageRegistrySettlement = async (page, {
  minimumLoadedRecords = 0,
  quietMs = 250,
  timeoutMs = 15_000,
} = {}) => {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = '';
  let unchangedSince = Date.now();
  let latest = null;
  const readRegistry = () => page.evaluate(() => {
    const getStats = window.__FND_PERF_BENCHMARKS__?.getImageRegistryStats;
    return typeof getStats === 'function' ? getStats() : null;
  });
  const settledSignature = (snapshot) => {
    const settled = snapshot
      && Number(snapshot.loadedRecordCount) >= minimumLoadedRecords
      && Number(snapshot.activeRequestCount) === 0
      && Number(snapshot.queuedRequestCount) === 0;
    return settled ? JSON.stringify([
      Number(snapshot.recordCount),
      Number(snapshot.loadedRecordCount),
      Number(snapshot.decodedBytes),
      Number(snapshot.unpinnedDecodedBytes),
      Number(snapshot.unpinnedRecordCount),
    ]) : '';
  };

  while (Date.now() < deadline) {
    latest = await readRegistry();
    const signature = settledSignature(latest);
    const observedAt = Date.now();
    if (signature !== lastSignature) {
      lastSignature = signature;
      unchangedSince = observedAt;
    }
    if (signature && observedAt - unchangedSince >= quietMs) {
      await flushBrowserObservers(page);
      const afterFrames = await readRegistry();
      const afterFramesSignature = settledSignature(afterFrames);
      if (afterFramesSignature === signature) return afterFrames;
      latest = afterFrames;
      lastSignature = afterFramesSignature;
      unchangedSince = Date.now();
    }
    await page.waitForTimeout(50);
  }

  throw new Error(
    `Image registry did not settle: ${JSON.stringify({ minimumLoadedRecords, latest })}`
  );
};

const installOwnedEmulatorFirestoreTransport = async (context) => {
  if (!context || typeof context.addInitScript !== 'function') {
    throw new TypeError('Owned emulator Firestore transport requires a browser context.');
  }
  const browserName = context.browser?.()?.browserType?.()?.name?.();
  if (!['chromium', 'firefox', 'webkit'].includes(browserName)) {
    throw new TypeError(`Owned emulator Firestore transport could not classify browser: ${browserName || 'unknown'}.`);
  }
  await context.addInitScript(({ forceLongPolling }) => {
    // WebKit can buffer the emulator's WebChannel response indefinitely. Use
    // the SDK-supported fallback only for that affected engine. Chromium and
    // Firefox retain the SDK default because forced long polling can strand a
    // later target on their shared channel under multi-context load.
    if (forceLongPolling) {
      window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__ = true;
    } else {
      delete window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__;
    }
  }, { forceLongPolling: browserName === 'webkit' });
};

const installBootstrap = async (context, scenario, iteration) => {
  await installOwnedEmulatorFirestoreTransport(context);
  await context.addInitScript(({
    scenarioId,
    role,
    runIteration,
    benchmarkRunId,
    fixtureVersion,
    resourceTimingBufferSize,
  }) => {
    window.__FND_PERF_RESOURCE_TIMING_BUFFER_OVERFLOW__ = false;
    window.__FND_PERF_LCP_CANDIDATES__ = [];
    if (
      typeof PerformanceObserver !== 'undefined'
      && PerformanceObserver.supportedEntryTypes?.includes('largest-contentful-paint')
    ) {
      const lcpObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          const element = entry.element;
          const rect = element?.getBoundingClientRect?.();
          window.__FND_PERF_LCP_CANDIDATES__.push({
            startTime: Number(entry.startTime) || 0,
            renderTime: Number(entry.renderTime) || 0,
            loadTime: Number(entry.loadTime) || 0,
            size: Number(entry.size) || 0,
            tagName: String(element?.tagName || '').toLowerCase().slice(0, 32),
            className: typeof element?.className === 'string'
              ? element.className.slice(0, 240)
              : '',
            testId: String(element?.getAttribute?.('data-testid') || '').slice(0, 120),
            textLength: String(element?.textContent || '').length,
            childElementCount: Number(element?.childElementCount) || 0,
            width: Number(rect?.width) || 0,
            height: Number(rect?.height) || 0,
          });
          if (window.__FND_PERF_LCP_CANDIDATES__.length > 24) {
            window.__FND_PERF_LCP_CANDIDATES__.shift();
          }
        });
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    }
    if (typeof performance.setResourceTimingBufferSize === 'function') {
      performance.setResourceTimingBufferSize(resourceTimingBufferSize);
    }
    if (typeof performance.addEventListener === 'function') {
      performance.addEventListener('resourcetimingbufferfull', () => {
        window.__FND_PERF_RESOURCE_TIMING_BUFFER_OVERFLOW__ = true;
      });
    }
    window.__FND_PERF_BOOTSTRAP__ = {
      runId: `${benchmarkRunId}:${scenarioId}-${runIteration}`,
      scenarioId,
      routeId: scenarioId,
      actorRole: role,
      release: 'task-01',
      browserProfile: 'desktop-1440x900-dpr1',
      connectionProfile: 'local-emulator',
      fixtureVersion,
    };
  }, {
    scenarioId: scenario.id,
    role: scenario.role,
    runIteration: iteration,
    benchmarkRunId: process.env.FND_PERF_RUN_ID || 'local',
    fixtureVersion: fixtureManifest.version,
    resourceTimingBufferSize: RESOURCE_TIMING_BUFFER_SIZE,
  });
};

const waitForBridge = async (page) => {
  await page.waitForFunction(
    () => Boolean(window.__FND_PERF__?.snapshot),
    null,
    { polling: 100 }
  );
};

const isRouteReadyInPage = (expectedPathname = null) => {
  const state = window.__FND_PERF__.snapshot().routeState;
  return Boolean(
    state?.shellVisible
    && state?.dataReady
    && state?.interactive
    && (!expectedPathname || (
      window.location.pathname === expectedPathname
      && state.routeId === expectedPathname
    ))
    && !document.querySelector('[data-testid="lazy-route-fallback"]')
  );
};

const waitForReadiness = async (page, { timeoutMs, expectedPathname } = {}) => {
  await page.bringToFront();
  await waitForBridge(page);
  const destinationPathname = expectedPathname || new URL(page.url()).pathname;
  try {
    await page.waitForFunction(isRouteReadyInPage, destinationPathname, {
      polling: 100,
      ...(timeoutMs == null ? {} : { timeout: timeoutMs }),
    });
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const snapshot = window.__FND_PERF__?.snapshot?.();
      return {
        pathname: window.location.pathname,
        routeState: snapshot?.routeState || null,
        activeListeners: snapshot?.activeListeners || {},
        activeResources: snapshot?.activeResources || {},
        lazyFallbackVisible: Boolean(document.querySelector('[data-testid="lazy-route-fallback"]')),
      };
    }).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
    throw new Error(
      `Route readiness did not settle: ${JSON.stringify(diagnostics)}`,
      { cause: error }
    );
  }
};

const collectKonvaTokenPositionsInPage = (tokenId) => {
  const stages = Array.isArray(window.Konva?.stages) ? window.Konva.stages : [];
  return stages.flatMap((stage) => (
    Array.from(stage.find((node) => node.getAttr?.('data-testid') === `token-node-${tokenId}`))
      .map((node) => ({ x: node.x(), y: node.y() }))
  ));
};

const readKonvaTokenPositions = async (page, tokenId) => (
  page.evaluate(collectKonvaTokenPositionsInPage, tokenId)
);

const waitForKonvaTokenMove = async (page, {
  tokenId,
  from,
  deltaX,
  deltaY,
}) => {
  const expectedX = from.x + deltaX;
  const expectedY = from.y + deltaY;
  await expect.poll(async () => {
    const positions = await readKonvaTokenPositions(page, tokenId);
    return positions.length === 1
      && Math.abs(positions[0].x - expectedX) < 0.001
      && Math.abs(positions[0].y - expectedY) < 0.001;
  }, {
    intervals: [25],
    message: `Expected one rendered ${tokenId} node at ${expectedX},${expectedY}.`,
  }).toBe(true);
};

const navigateToCleanup = async (page) => {
  await page.bringToFront();
  await page.evaluate(() => {
    window.history.pushState({}, '', '/__fnd_perf_cleanup__');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForFunction(() => (
    window.location.pathname === '/__fnd_perf_cleanup__'
    && window.__FND_PERF__?.snapshot().routeState?.routeId === '/__fnd_perf_cleanup__'
  ), null, { polling: 100 });
};

const countRouteResources = (resources, route, { includeTimeouts = false } = {}) => (
  Object.entries(resources || {})
    .filter(([key]) => key.startsWith(`${route}::`))
    .filter(([key]) => includeTimeouts || !key.startsWith(`${route}::timeout`))
    .reduce((total, [, value]) => total + Number(value || 0), 0)
);

const summarizeResourceEntries = (entries = []) => {
  const byClass = entries.reduce((totals, entry) => {
    let parsedUrl = null;
    try { parsedUrl = new URL(entry.name); } catch (_error) { /* Keep malformed entries observable. */ }
    const pathname = parsedUrl?.pathname || '';
    const normalizedPathname = pathname.toLowerCase();
    const category = demoFirestoreStreamOperation(entry.name)
      ? 'stream'
      : normalizedPathname.endsWith('.js') ? 'javascript'
        : normalizedPathname.endsWith('.css') ? 'css'
          : /\.(png|jpe?g|gif|svg|webp|avif)$/.test(normalizedPathname) ? 'image'
            : /\.(woff2?|ttf|otf)$/.test(normalizedPathname) ? 'font'
              : /\.(mp3|wav|ogg|mp4|webm)$/.test(normalizedPathname) ? 'media'
                : 'other';
    totals[category] ||= {
      canonicalNames: new Set(),
      encodedBytesByCanonicalName: new Map(),
      count: 0,
      transferBytes: 0,
      encodedBytes: 0,
    };
    const canonicalName = parsedUrl ? `${parsedUrl.origin}${parsedUrl.pathname}` : String(entry.name || '');
    if (canonicalName) {
      totals[category].canonicalNames.add(canonicalName);
      totals[category].encodedBytesByCanonicalName.set(
        canonicalName,
        Math.max(
          totals[category].encodedBytesByCanonicalName.get(canonicalName) || 0,
          Number(entry.encodedBodySize) || 0
        )
      );
    }
    totals[category].count += 1;
    totals[category].transferBytes += Number(entry.transferSize) || 0;
    totals[category].encodedBytes += Number(entry.encodedBodySize) || 0;
    return totals;
  }, {});

  return Object.fromEntries(Object.entries(byClass).map(([category, values]) => [
    category,
    {
      count: values.count,
      uniqueCount: values.canonicalNames.size,
      uniqueFingerprint: sha256([...values.canonicalNames].sort().join('\n')),
      transferBytes: values.transferBytes,
      encodedBytes: values.encodedBytes,
      uniqueEncodedBytes: [...values.encodedBytesByCanonicalName.values()]
        .reduce((total, value) => total + value, 0),
    },
  ]));
};

const visibleFirst = async (locators) => {
  for (const locator of locators) {
    const candidate = locator.first();
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  throw new Error('None of the deterministic interaction targets was visible.');
};

const locateDmDashboardPlayerCard = (page, playerName) => {
  const escapedName = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const playerHeading = page.locator('div.text-lg.font-bold').filter({
    hasText: new RegExp(`^\\s*${escapedName}\\s*$`),
  });
  return playerHeading.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-lg ")][1]'
  );
};

const runFoesHubRowInteraction = async (row, {
  settleFiniteAssets,
  assertExpanded = async () => expect(row).toHaveAttribute('aria-expanded', 'true'),
} = {}) => {
  await row.evaluate((node) => node.scrollIntoView({
    behavior: 'auto',
    block: 'center',
    inline: 'nearest',
  }));
  if (typeof settleFiniteAssets !== 'function') {
    throw new TypeError('Foes Hub measurement requires finite-asset settlement.');
  }
  await settleFiniteAssets('after deterministic Foes Hub scroll');
  await row.getByLabel('expand').click();
  await assertExpanded(row);
};

const runInteraction = async (page, scenario, { settleFiniteAssets } = {}) => {
  switch (scenario.id) {
    case 'login-cold':
    case 'login-warm': {
      const password = page.getByPlaceholder('Password');
      const toggle = page.getByLabel('Show password');
      await expect(password).toBeVisible();
      await toggle.click();
      break;
    }
    case 'character-creation': {
      await page.getByRole('heading', { name: 'Evocazione Permanente' }).click();
      await expect(page.getByRole('button', { name: 'Next' })).toBeEnabled();
      break;
    }
    case 'home': {
      await page.getByRole('button', { name: 'Expand Parametri Speciali' }).click();
      const currentHp = page.getByText('45/50', { exact: true });
      await expect(currentHp).toBeVisible();
      await page.getByTitle('-1 HP').click();
      await expect(page.getByText('44/50', { exact: true })).toBeVisible();
      await page.getByTitle('+1 HP').click();
      await expect(currentHp).toBeVisible();
      const search = page.getByPlaceholder(/Cerca nome o tipo/);
      await search.fill('Fixture item 42');
      await expect(page.getByText('Fixture item 42', { exact: false }).first()).toBeVisible();
      break;
    }
    case 'bazaar': {
      await page.getByPlaceholder('Cerca per Nome...').fill('Bazaar item 42');
      await page.locator('[data-testid^="bazaar-item-card-"]').first().click();
      await expect(page.getByTestId('bazaar-comparison-panel')).toBeVisible();
      break;
    }
    case 'tecniche-spell': {
      await page.getByPlaceholder('Cerca per nome o effetto...').first().fill('Technique 42');
      const card = await visibleFirst([
        page.getByText('Technique 42', { exact: false }),
        page.locator('main button'),
      ]);
      await card.click();
      break;
    }
    case 'codex': {
      const category = page.getByRole('button', { name: 'Categoria 00', exact: true });
      await expect(category).toBeVisible();
      await category.click();
      await expect(page.getByText('Codex 0-42', { exact: false }).first()).toBeVisible();
      break;
    }
    case 'combat': {
      await page.getByText('Encounter 0', { exact: true }).first().click();
      await expect(page.getByText('Encounter Log', { exact: false }).first()).toBeVisible();
      break;
    }
    case 'echi-di-viaggio': {
      const marker = page.getByRole('button', { name: /Fixture NPC 0/i });
      await expect(marker).toBeVisible();
      await marker.hover();
      break;
    }
    case 'dm-dashboard': {
      const playerCard = locateDmDashboardPlayerCard(page, 'Performance Hero 10');
      await expect(playerCard).toHaveCount(1);
      await expect(playerCard).toBeVisible();
      const expandButton = playerCard.getByRole('button', { name: 'Espandi', exact: true });
      await expect(expandButton).toBeVisible();
      await expandButton.click();
      await expect(playerCard.getByRole('button', { name: 'Comprimi', exact: true })).toBeVisible();
      break;
    }
    case 'foes-hub': {
      const row = page.locator('[role="button"]').filter({ hasText: 'Fixture foe 42' }).first();
      await expect(row).toBeVisible();
      await runFoesHubRowInteraction(row, { settleFiniteAssets });
      break;
    }
    case 'admin': {
      const grouping = page.locator('main select').first();
      await expect(grouping).toBeVisible();
      await grouping.focus();
      break;
    }
    case 'grigliata-player':
    case 'grigliata-manager': {
      const canvas = page.locator('canvas').first();
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Grigliata canvas has no layout box.');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -240);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 25, { steps: 4 });
      await page.mouse.up();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      if (scenario.id === 'grigliata-manager') {
        const library = await visibleFirst([
          page.getByRole('tab', { name: /DM Gallery/i }),
          page.getByText(/Gallery|Library/i),
        ]);
        await library.click();
        await page.waitForFunction(() => Boolean(window.__FND_PERF_BENCHMARKS__?.runAll));
        await page.evaluate(() => window.__FND_PERF_BENCHMARKS__.runAll());
      }
      break;
    }
    default:
      throw new Error(`Interaction not implemented for ${scenario.id}`);
  }
};

const captureBrowserMetrics = async (page, diagnostics) => {
  const browserCapture = await page.evaluate((capturedDiagnostics) => {
    const snapshot = window.__FND_PERF__.snapshot();
    const resourceEntries = performance.getEntriesByType('resource').map((entry) => ({
      name: entry.name,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
    }));
    const imageResourceTimings = performance.getEntriesByType('resource')
      .filter((entry) => entry.initiatorType === 'img')
      .map((entry) => ({
        startTime: Number(entry.startTime) || 0,
        fetchStart: Number(entry.fetchStart) || 0,
        requestStart: Number(entry.requestStart) || 0,
        responseStart: Number(entry.responseStart) || 0,
        responseEnd: Number(entry.responseEnd) || 0,
        duration: Number(entry.duration) || 0,
        transferSize: Number(entry.transferSize) || 0,
        encodedBodySize: Number(entry.encodedBodySize) || 0,
      }));
    return {
      snapshot,
      resourceEntries,
      resourceTimingBufferOverflow: Boolean(window.__FND_PERF_RESOURCE_TIMING_BUFFER_OVERFLOW__),
      diagnostics: {
        ...capturedDiagnostics,
        lcpCandidates: Array.isArray(window.__FND_PERF_LCP_CANDIDATES__)
          ? window.__FND_PERF_LCP_CANDIDATES__
          : [],
        imageResourceTimings,
      },
    };
  }, diagnostics);
  let cdp = null;
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    const result = await session.send('Performance.getMetrics');
    cdp = Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
    await session.detach();
  } catch (_error) {
    // Firefox/WebKit smoke coverage does not expose CDP and does not use timing budgets.
  }
  const { resourceEntries, ...captureWithoutResourceEntries } = browserCapture;
  return {
    ...captureWithoutResourceEntries,
    resources: summarizeResourceEntries(resourceEntries),
    cdp,
  };
};

const retainImageResourceTimings = (timings) => {
  if (!Array.isArray(timings)) return [];
  if (timings.length <= MAX_RETAINED_IMAGE_RESOURCE_TIMINGS) return timings;
  const retainedHeadCount = 32;
  return [
    ...timings.slice(0, retainedHeadCount),
    ...timings.slice(-(MAX_RETAINED_IMAGE_RESOURCE_TIMINGS - retainedHeadCount)),
  ];
};

const retainLongTaskEntries = (events, {
  maximumEntries = MAX_RETAINED_LONG_TASK_ENTRIES,
} = {}) => {
  if (!Array.isArray(events)) return { totalCount: 0, entries: [] };
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1) {
    throw new TypeError('Long-task diagnostics require a positive integer bound.');
  }
  const routePhaseMarkers = events.flatMap((event) => {
    const timestamp = Number(event?.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < 0) return [];
    if (event.category === 'route' && LONG_TASK_ROUTE_PHASES.has(event.metric)) {
      return [{ timestamp, phase: LONG_TASK_ROUTE_PHASES.get(event.metric) }];
    }
    return [];
  }).sort((left, right) => left.timestamp - right.timestamp);
  const scenarioPhaseMarkers = events.flatMap((event) => {
    const timestamp = Number(event?.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < 0) return [];
    const phase = event?.tags?.phase;
    if (
      event.category === 'custom'
      && event.metric === 'scenario-phase'
      && LONG_TASK_SCENARIO_PHASES.has(phase)
    ) {
      return [{ timestamp, phase }];
    }
    return [];
  }).sort((left, right) => left.timestamp - right.timestamp);
  const phaseAt = (markers, startTime) => markers.reduce((latest, marker) => (
    marker.timestamp <= startTime ? marker.phase : latest
  ), 'unattributed');
  const longTasks = events.flatMap((event) => {
    if (event?.category !== 'runtime' || event?.metric !== 'long-task') return [];
    const startTime = Number(event?.tags?.startTime);
    const duration = Number(event?.value);
    if (!Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(duration) || duration < 0) {
      return [];
    }
    return [{
      startTime,
      duration,
      scenarioPhase: phaseAt(scenarioPhaseMarkers, startTime),
      routePhase: phaseAt(routePhaseMarkers, startTime),
    }];
  });
  const entries = [...longTasks]
    .sort((left, right) => right.duration - left.duration || left.startTime - right.startTime)
    .slice(0, Math.min(maximumEntries, MAX_RETAINED_LONG_TASK_ENTRIES))
    .sort((left, right) => left.startTime - right.startTime);
  return { totalCount: longTasks.length, entries };
};

const summarizePeerTransitionTimings = ({
  startedAt,
  writeAcknowledgedAt,
  peerSettledAt,
}) => {
  const start = Number(startedAt);
  const writeAck = Number(writeAcknowledgedAt);
  const peerSettlements = Array.isArray(peerSettledAt) ? peerSettledAt.map(Number) : [];
  if (
    !Number.isFinite(start)
    || !Number.isFinite(writeAck)
    || writeAck < start
    || !peerSettlements.length
    || peerSettlements.some((settledAt) => !Number.isFinite(settledAt) || settledAt < start)
  ) {
    throw new TypeError('Peer transition timing requires ordered finite timestamps.');
  }
  const writeAckMs = writeAck - start;
  const peerConvergenceMs = peerSettlements.map((settledAt) => settledAt - start);
  return {
    durationMs: Math.max(writeAckMs, ...peerConvergenceMs),
    writeAckMs,
    peerConvergenceMs,
    postWriteAckConvergenceMs: peerConvergenceMs.map((duration) => (
      Math.max(0, duration - writeAckMs)
    )),
  };
};

const assertVisiblePeerStates = (visibilityStates, roles) => {
  if (
    !Array.isArray(visibilityStates)
    || !Array.isArray(roles)
    || !visibilityStates.length
    || visibilityStates.length !== roles.length
  ) {
    throw new TypeError('Peer visibility requires one state for every role.');
  }
  visibilityStates.forEach((visibilityState, index) => {
    if (visibilityState !== 'visible') {
      throw new Error(
        `${String(roles[index] || `peer-${index + 1}`)} must be visible during convergence measurement; `
        + `received ${String(visibilityState || 'unknown')}.`
      );
    }
  });
  return visibilityStates;
};

const measurePeerTransitionTimings = async ({
  performWrite,
  waitForPeers,
  now = Date.now,
}) => {
  if (
    typeof performWrite !== 'function'
    || !Array.isArray(waitForPeers)
    || !waitForPeers.length
    || waitForPeers.some((waitForPeer) => typeof waitForPeer !== 'function')
    || typeof now !== 'function'
  ) {
    throw new TypeError('Peer transition measurement requires a write and peer waiters.');
  }
  const startedAt = now();
  const peerSettlementsPromise = Promise.allSettled(waitForPeers.map(async (waitForPeer) => {
    await waitForPeer();
    return now();
  }));
  let writeAcknowledgedAt = null;
  let writeError = null;
  try {
    await performWrite();
    writeAcknowledgedAt = now();
  } catch (error) {
    writeError = error;
  }
  const peerSettlements = await peerSettlementsPromise;
  if (writeError) throw writeError;
  const rejectedPeer = peerSettlements.find((settlement) => settlement.status === 'rejected');
  if (rejectedPeer) throw rejectedPeer.reason;
  return summarizePeerTransitionTimings({
    startedAt,
    writeAcknowledgedAt,
    peerSettledAt: peerSettlements.map((settlement) => settlement.value),
  });
};

const aggregateMetrics = (capture, cleanup) => {
  const metrics = {};
  const events = capture.snapshot.events;
  const latest = (category, metric) => [...events].reverse().find((event) => (
    event.category === category && event.metric === metric
  ))?.value;
  for (const name of ['CLS', 'INP', 'LCP', 'TTFB']) {
    const value = latest('web-vital', name);
    if (Number.isFinite(value)) metrics[`web-vital.${name}`] = value;
  }
  const longTasks = events.filter((event) => event.category === 'runtime' && event.metric === 'long-task');
  metrics['runtime.maxLongTaskMs'] = Math.max(0, ...longTasks.map((event) => Number(event.value) || 0));
  metrics['runtime.consoleErrors'] = capture.diagnostics.consoleErrors.length;
  metrics['runtime.unhandledErrors'] = capture.diagnostics.unhandledErrors.length;
  metrics['runtime.failedRequests'] = capture.diagnostics.failedRequests.length;
  metrics['runtime.synchronousNetworkCalls'] = events
    .filter((event) => event.category === 'runtime' && event.metric === 'synchronous-network-call').length;
  metrics['runtime.resourceTimingBufferOverflows'] = capture.resourceTimingBufferOverflow ? 1 : 0;
  const documentDeliveryEvents = events
    .filter((event) => event.category === 'firestore' && /documents-delivered$/.test(event.metric));
  metrics['firestore.documentsDelivered'] = documentDeliveryEvents
    .reduce((total, event) => total + (Number(event.value) || 0), 0);
  metrics['firestore.routeDocumentsDelivered'] = documentDeliveryEvents
    .filter((event) => event.tags?.ownership !== 'shell')
    .reduce((total, event) => total + (Number(event.value) || 0), 0);
  metrics['firestore.activeListenersAfterCleanup'] = Object.entries(cleanup.activeListeners || {})
    .filter(([key]) => key.startsWith(`${capture.snapshot.routeState?.routeId || 'unknown'}::`))
    .reduce((total, [, value]) => total + Number(value || 0), 0);
  const measuredRoute = capture.snapshot.routeState?.routeId || 'unknown';
  metrics['runtime.activeResourcesAfterCleanup'] = countRouteResources(
    cleanup.activeResources,
    measuredRoute,
  );
  metrics['runtime.activeTimeoutsAfterCleanup'] = Object.entries(cleanup.activeResources || {})
    .filter(([key]) => key.startsWith(`${measuredRoute}::timeout`))
    .reduce((total, [, value]) => total + Number(value || 0), 0);
  metrics['runtime.activeMediaAfterCleanup'] = Number(cleanup.media?.activeSources || 0);
  metrics['runtime.finalHeapBytes'] = capture.cdp?.JSHeapUsedSize || capture.snapshot.heap?.usedJSHeapSize || 0;
  if (Number.isFinite(capture.cdp?.Nodes)) metrics['runtime.finalDomNodes'] = capture.cdp.Nodes;
  events.filter((event) => event.category === 'microbenchmark').forEach((event) => {
    metrics[`microbenchmark.${event.metric}`] = Number(event.value) || 0;
  });
  for (const [category, values] of Object.entries(capture.resources)) {
    metrics[`resource.${category}.transferBytes`] = values.transferBytes;
    metrics[`resource.${category}.gzipBytes`] = values.encodedBytes;
    metrics[`resource.${category}.count`] = values.count;
    metrics[`resource.${category}.uniqueCount`] = values.uniqueCount;
    metrics[`resource.${category}.uniqueFingerprint`] = values.uniqueFingerprint;
    metrics[`resource.${category}.uniqueGzipBytes`] = values.uniqueEncodedBytes;
  }
  return metrics;
};

const writeScenarioResult = (scenario, iteration, result) => {
  const directory = path.join(resultsDir, 'scenarios');
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, `${scenario.id}-${iteration}.json`), {
    schemaVersion: 1,
    scenarioId: scenario.id,
    route: scenario.route,
    role: scenario.role,
    iteration,
    ...result,
  });
};

const writeScenarioRaw = (scenario, iteration, capture) => {
  writeJson(path.join(resultsDir, 'raw', `${scenario.id}-${iteration}.json`), {
    schemaVersion: 1,
    scenarioId: scenario.id,
    iteration,
    snapshot: capture.snapshot,
    resources: capture.resources,
    cdp: capture.cdp,
    diagnostics: capture.diagnostics,
  });
};

const scenarioRestorePatch = (scenarioId, currentData = {}) => {
  if (scenarioId === 'home') {
    return currentData?.stats?.hpCurrent === 45 ? null : { 'stats.hpCurrent': 45 };
  }
  if (['grigliata-manager', 'grigliata-five-peer'].includes(scenarioId)) {
    const expected = {
      col: 0,
      row: 0,
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedBy: 'perf-dm',
    };
    return Object.entries(expected).every(([key, value]) => currentData?.[key] === value)
      ? null
      : expected;
  }
  return null;
};

const GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY = 'legacy.grigliata-token-placements.subscribe.v1';

const countChangedDocumentsForTarget = (snapshot, targetMetricKey) => (
  (snapshot?.events || [])
    .filter((event) => (
      event.category === 'firestore'
      && event.metric === 'changed-documents-delivered'
      && event.tags?.target === targetMetricKey
    ))
    .reduce((sum, event) => sum + Number(event.value || 0), 0)
);

const collectChangedDocumentDeliveryTelemetryInPage = (targetMetricKey) => {
  const snapshot = window.__FND_PERF__.snapshot();
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  return {
    changedDocumentsDelivered: snapshot.changedDocumentDeliveries?.[targetMetricKey] ?? events
      .filter((event) => (
        event.category === 'firestore'
        && event.metric === 'changed-documents-delivered'
        && event.tags?.target === targetMetricKey
      ))
      .reduce((sum, event) => sum + Number(event.value || 0), 0),
    eventCount: events.length,
  };
};

const readChangedDocumentDeliveryTelemetry = async (page, targetMetricKey) => (
  page.evaluate(collectChangedDocumentDeliveryTelemetryInPage, targetMetricKey)
);

const collectRouteCleanupSummaryInPage = (route) => {
  const snapshot = window.__FND_PERF__.snapshot();
  const routePrefix = `${route}::`;
  const onlyRouteEntries = (entries) => Object.fromEntries(
    Object.entries(entries || {}).filter(([key]) => key.startsWith(routePrefix))
  );
  return {
    activeListeners: onlyRouteEntries(snapshot.activeListeners),
    activeResources: onlyRouteEntries(snapshot.activeResources),
    media: {
      activeSources: Number(snapshot.media?.activeSources || 0),
    },
  };
};

const readRouteCleanupSummary = async (page, route) => (
  page.evaluate(collectRouteCleanupSummaryInPage, route)
);

const restoreScenarioState = async (scenarioId) => {
  if (!['home', 'grigliata-manager', 'grigliata-five-peer'].includes(scenarioId)) return;
  configureOwnedPerformanceEnvironment();
  const { deleteApp, initializeApp, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ projectId: process.env.GCLOUD_PROJECT });
  const db = getFirestore(app);
  try {
    if (scenarioId === 'home') {
      const reference = db.doc('users/perf-player');
      const snapshot = await reference.get();
      const patch = scenarioRestorePatch(scenarioId, snapshot.data());
      if (patch) await reference.update(patch);
      return;
    }
    const reference = db.doc('grigliata_token_placements/perf-map__perf-token-0000');
    const snapshot = await reference.get();
    const patch = scenarioRestorePatch(scenarioId, snapshot.data());
    if (patch) await reference.update(patch);
  } finally {
    await deleteApp(app);
  }
};

module.exports = {
  ACCOUNT,
  GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY,
  MAX_RETAINED_IMAGE_RESOURCE_TIMINGS,
  MAX_RETAINED_LONG_TASK_ENTRIES,
  RESOURCE_TIMING_BUFFER_SIZE,
  aggregateMetrics,
  assertVisiblePeerStates,
  captureBrowserMetrics,
  countChangedDocumentsForTarget,
  countRouteResources,
  createPageAssetTracker,
  createStaticAssetWarmupBatches,
  assertStaticAssetWarmupInventory,
  drainPageConnections,
  flushBrowserObservers,
  installBootstrap,
  installDeterministicFontRoutes,
  installOwnedEmulatorFirestoreTransport,
  isExpectedFirestoreLifecycleCancellation,
  isExpectedFivePeerFirestoreWriteTurnover,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  isExpectedTask08CleanupImageCancellation,
  isExpectedTask07MediaDetachmentCancellation,
  isKnownDemoFirestoreStartupWarning,
  isRouteReadyInPage,
  locateDmDashboardPlayerCard,
  measurePeerTransitionTimings,
  navigateToCleanup,
  readChangedDocumentDeliveryTelemetry,
  readKonvaTokenPositions,
  readRouteCleanupSummary,
  retainImageResourceTimings,
  retainLongTaskEntries,
  resolvePlaywrightResponseStatus,
  restoreScenarioState,
  runBrowserStaticAssetWarmupPass,
  runFoesHubRowInteraction,
  runStaticAssetWarmupPass,
  sanitizeFivePeerRequestFailure,
  runInteraction,
  scenarioRestorePatch,
  summarizePeerTransitionTimings,
  summarizeResourceEntries,
  storageStateForRole,
  warmBrowserAssetDelivery,
  waitForBridge,
  waitForKonvaTokenMove,
  waitForImageRegistrySettlement,
  waitForReadiness,
  writeScenarioRaw,
  writeScenarioResult,
};
