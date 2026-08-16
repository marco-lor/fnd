const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../../../scripts/performance/common');
const {
  GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY,
  MAX_RETAINED_IMAGE_RESOURCE_TIMINGS,
  RESOURCE_TIMING_BUFFER_SIZE,
  aggregateMetrics,
  assertStaticAssetWarmupInventory,
  countChangedDocumentsForTarget,
  createPageAssetTracker,
  createStaticAssetWarmupBatches,
  drainPageConnections,
  installDeterministicFontRoutes,
  installOwnedEmulatorFirestoreTransport,
  isExpectedFirestoreLifecycleCancellation,
  isExpectedFivePeerFirestoreWriteTurnover,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  isExpectedTask07MediaDetachmentCancellation,
  isKnownDemoFirestoreStartupWarning,
  isRouteReadyInPage,
  locateDmDashboardPlayerCard,
  navigateToCleanup,
  readChangedDocumentDeliveryTelemetry,
  readKonvaTokenPositions,
  readRouteCleanupSummary,
  retainImageResourceTimings,
  resolvePlaywrightResponseStatus,
  runBrowserStaticAssetWarmupPass,
  runStaticAssetWarmupPass,
  sanitizeFivePeerRequestFailure,
  scenarioRestorePatch,
  summarizeResourceEntries,
  warmBrowserAssetDelivery,
  waitForImageRegistrySettlement,
  waitForReadiness,
  waitForKonvaTokenMove,
} = require('./helpers');

const browserContextStub = (browserName, capture) => ({
  addInitScript: async (script, argument) => capture(script, argument),
  browser: () => ({
    browserType: () => ({ name: () => browserName }),
  }),
});

test('owned emulator WebKit contexts force the SDK long-polling fallback', async () => {
  let initScript;
  let initArgument;
  await installOwnedEmulatorFirestoreTransport(browserContextStub(
    'webkit',
    (script, argument) => {
      initScript = script;
      initArgument = argument;
    }
  ));
  assert.equal(typeof initScript, 'function');

  const previousWindow = global.window;
  global.window = {};
  try {
    initScript(initArgument);
    assert.equal(global.window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__, true);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('owned emulator Chromium and Firefox contexts retain the SDK default transport', async () => {
  for (const browserName of ['chromium', 'firefox']) {
    let initScript;
    let initArgument;
    await installOwnedEmulatorFirestoreTransport(browserContextStub(
      browserName,
      (script, argument) => {
        initScript = script;
        initArgument = argument;
      }
    ));

    const previousWindow = global.window;
    global.window = { __FND_PERF_FORCE_FIRESTORE_LONG_POLLING__: true };
    try {
      initScript(initArgument);
      assert.equal(
        Object.prototype.hasOwnProperty.call(
          global.window,
          '__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__'
        ),
        false
      );
    } finally {
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
    }
  }
});

test('owned emulator transport fails closed when the browser engine is unknown', async () => {
  await assert.rejects(
    installOwnedEmulatorFirestoreTransport(browserContextStub('unknown', () => {})),
    /could not classify browser: unknown/
  );
});

test('every Firestore-backed browser probe installs and reports the owned transport', () => {
  const contextFiles = [
    'auth.setup.js',
    'grigliata-five-peer.performance.js',
    'routes.performance.js',
    'task07-media-cross-browser.smoke.js',
    'task07-media-routes.performance.js',
    'task07-media-shell.performance.js',
    'task07-media-soak.performance.js',
  ];
  for (const fileName of contextFiles) {
    const source = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
    assert.match(
      source,
      /install(?:Bootstrap|OwnedEmulatorFirestoreTransport)\(/
    );
  }
  const teardownSource = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'global-teardown.js'),
    'utf8'
  );
  assert.match(
    teardownSource,
    /webkit:\s*['"]forced-long-polling['"]/
  );
  assert.match(teardownSource, /chromium:\s*['"]sdk-default-auto-detect['"]/);
  assert.match(teardownSource, /firefox:\s*['"]sdk-default-auto-detect['"]/);
});

test('document accounting preserves totals and exposes route-scoped deliveries', () => {
  const capture = {
    snapshot: {
      routeState: { routeId: '/home' },
      events: [
        {
          category: 'firestore',
          metric: 'initial-documents-delivered',
          value: 5,
          tags: { target: 'home.items.subscribe.v1', ownership: 'route' },
        },
        {
          category: 'firestore',
          metric: 'initial-documents-delivered',
          value: 1,
          tags: { target: 'grigliata.music-playback.subscribe.v1', ownership: 'shell' },
        },
        {
          category: 'firestore',
          metric: 'one-shot-documents-delivered',
          value: 2,
          tags: { target: 'config.schema.get.v1' },
        },
      ],
    },
    diagnostics: { consoleErrors: [], unhandledErrors: [], failedRequests: [] },
    resources: {},
    cdp: null,
  };
  const cleanup = { activeListeners: {}, activeResources: {}, media: { activeSources: 0 } };

  const metrics = aggregateMetrics(capture, cleanup);
  assert.equal(metrics['firestore.documentsDelivered'], 8);
  assert.equal(metrics['firestore.routeDocumentsDelivered'], 7);
  assert.equal(metrics['runtime.resourceTimingBufferOverflows'], 0);
});

test('static asset warmup batches cover every demo performance JS and CSS asset exactly once', () => {
  const sha256 = 'a'.repeat(64);
  const batches = createStaticAssetWarmupBatches({
    schemaVersion: 1,
    buildMode: 'performance',
    projectId: 'demo-fnd-perf',
    assets: [
      { path: 'static/js/route-home.1234.chunk.js', category: 'javascript', rawBytes: 20, sha256 },
      { path: 'static/css/main.1234.css', category: 'css', rawBytes: 10, sha256 },
      { path: 'favicon.ico', category: 'image', rawBytes: 5, sha256 },
      { path: 'static/js/101.1234.chunk.js', category: 'javascript', rawBytes: 30, sha256 },
    ],
  }, { batchSize: 2 });

  assert.deepEqual(batches, [
    [
      { path: '/static/css/main.1234.css', category: 'css', rawBytes: 10, sha256 },
      { path: '/static/js/101.1234.chunk.js', category: 'javascript', rawBytes: 30, sha256 },
    ],
    [
      { path: '/static/js/route-home.1234.chunk.js', category: 'javascript', rawBytes: 20, sha256 },
    ],
  ]);
});

test('static asset warmup rejects non-demo reports, unsafe paths, duplicates, and invalid sizes', () => {
  const sha256 = 'a'.repeat(64);
  const report = {
    schemaVersion: 1,
    buildMode: 'performance',
    projectId: 'demo-fnd-perf',
    assets: [
      { path: 'static/js/main.1234.js', category: 'javascript', rawBytes: 10, sha256 },
    ],
  };
  assert.throws(
    () => createStaticAssetWarmupBatches({ ...report, projectId: 'live-fnd' }),
    /demo-fnd-perf/
  );
  assert.throws(
    () => createStaticAssetWarmupBatches({
      ...report,
      assets: [{ path: '../main.js', category: 'javascript', rawBytes: 10 }],
    }),
    /invalid build path/
  );
  assert.throws(
    () => createStaticAssetWarmupBatches({
      ...report,
      assets: [...report.assets, ...report.assets],
    }),
    /duplicate build path/
  );
  assert.throws(
    () => createStaticAssetWarmupBatches({
      ...report,
      assets: [{ ...report.assets[0], rawBytes: 0 }],
    }),
    /positive rawBytes/
  );
  assert.throws(
    () => createStaticAssetWarmupBatches({
      ...report,
      assets: [{ ...report.assets[0], sha256: 'invalid' }],
    }),
    /SHA-256/
  );
  assert.throws(() => createStaticAssetWarmupBatches(report, { batchSize: 0 }), /batchSize/);
});

test('static asset warmup compares report paths relative to the build root', () => {
  const batches = [[
    { path: '/static/css/main.css' },
    { path: '/static/js/main.js' },
  ]];
  assert.deepEqual(
    assertStaticAssetWarmupInventory(batches, [
      'static/js/main.js',
      'static/css/main.css',
    ]),
    { assetCount: 2 }
  );
  assert.throws(
    () => assertStaticAssetWarmupInventory(batches, [
      'build/static/js/main.js',
      'build/static/css/main.css',
    ]),
    /Missing: static\/css\/main\.css/
  );
});

test('static asset warmup consumes every response body within the configured batch concurrency', async () => {
  const body = Buffer.from('asset');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const batches = [
    [
      { path: '/static/js/a.js', category: 'javascript', sha256 },
      { path: '/static/css/a.css', category: 'css', sha256 },
    ],
    [
      { path: '/static/js/b.js', category: 'javascript', sha256 },
    ],
  ];
  let active = 0;
  let maxActive = 0;
  let bodyCalls = 0;
  const results = await runStaticAssetWarmupPass({
    batches,
    passName: 'warm',
    timeoutMs: 30_000,
    requestAsset: async (asset, options) => {
      assert.deepEqual(options, { passName: 'warm', timeoutMs: 30_000 });
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        status: () => 200,
        headers: () => ({
          'content-type': asset.category === 'javascript'
            ? 'application/javascript; charset=utf-8'
            : 'text/css; charset=utf-8',
        }),
        body: async () => {
          bodyCalls += 1;
          return body;
        },
      };
    },
  });

  assert.equal(maxActive, 2);
  assert.equal(bodyCalls, 3);
  assert.equal(results.length, 3);
  assert.equal(results.every((result) => result.ok), true);
});

test('static asset warmup reports transport, status, body, and MIME failures without hiding paths', async () => {
  const body = Buffer.from('asset');
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const assets = [
    { path: '/static/js/timeout.js', category: 'javascript', sha256 },
    { path: '/static/js/not-found.js', category: 'javascript', sha256 },
    { path: '/static/js/empty.js', category: 'javascript', sha256 },
    { path: '/static/css/wrong.css', category: 'css', sha256 },
  ];
  const results = await runStaticAssetWarmupPass({
    batches: [assets],
    passName: 'validation',
    timeoutMs: 5_000,
    requestAsset: async (asset) => {
      if (asset.path.includes('timeout')) throw new Error('request timed out');
      return {
        status: () => (asset.path.includes('not-found') ? 404 : 200),
        headers: () => ({
          'content-type': asset.path.includes('wrong')
            ? 'text/html'
            : 'application/javascript',
        }),
        body: async () => (
          asset.path.includes('empty') ? Buffer.alloc(0) : body
        ),
      };
    },
  });

  assert.deepEqual(results.map(({ path, ok }) => ({ path, ok })), assets.map(({ path }) => ({
    path,
    ok: false,
  })));
  assert.match(results[0].error, /timed out/);
  assert.match(results[1].error, /HTTP 404/);
  assert.match(results[2].error, /empty response body/);
  assert.match(results[3].error, /unexpected content type/);
});

test('browser static asset warmup keeps batch order and explicit pass deadlines', async () => {
  const calls = [];
  const batches = [
    [{ path: '/static/js/a.js', category: 'javascript', sha256: 'a'.repeat(64) }],
    [{ path: '/static/css/a.css', category: 'css', sha256: 'b'.repeat(64) }],
  ];
  const results = await runBrowserStaticAssetWarmupPass({
    batches,
    page: {
      evaluate: async (callback, payload) => {
        calls.push({ callback: typeof callback, payload });
        return payload.assets.map((asset) => ({
          ok: true,
          pass: payload.requestPass,
          path: asset.path,
        }));
      },
    },
    passName: 'validation',
    timeoutMs: 5_000,
  });

  assert.deepEqual(calls.map(({ callback, payload }) => ({
    callback,
    pass: payload.requestPass,
    paths: payload.assets.map(({ path: assetPath }) => assetPath),
    timeoutMs: payload.requestTimeoutMs,
  })), [
    {
      callback: 'function',
      pass: 'validation',
      paths: ['/static/js/a.js'],
      timeoutMs: 5_000,
    },
    {
      callback: 'function',
      pass: 'validation',
      paths: ['/static/css/a.css'],
      timeoutMs: 5_000,
    },
  ]);
  assert.deepEqual(results.map(({ path }) => path), [
    '/static/js/a.js',
    '/static/css/a.css',
  ]);
});

test('browser delivery warmup is disposable, exact-origin, and records both passes', async () => {
  const sha256 = 'a'.repeat(64);
  const writes = [];
  const calls = [];
  const page = {
    goto: async (...args) => calls.push(['goto', ...args]),
    evaluate: async (_callback, payload) => payload.assets.map((asset) => ({
      bytes: asset.rawBytes,
      contentType: asset.category === 'javascript'
        ? 'application/javascript; charset=utf-8'
        : 'text/css; charset=utf-8',
      durationMs: 1,
      error: null,
      ok: true,
      pass: payload.requestPass,
      path: asset.path,
      sha256: asset.sha256,
      status: 200,
    })),
  };
  const context = {
    route: async (matcher) => calls.push(['route', typeof matcher]),
    newPage: async () => page,
    close: async () => calls.push(['close']),
  };
  const { resultsDir } = require('../../../scripts/performance/common');
  const diagnosticsPath = path.join(
    resultsDir,
    'browser-worker-asset-warmup-unit.json'
  );
  const buildReport = {
    schemaVersion: 1,
    buildMode: 'performance',
    projectId: 'demo-fnd-perf',
    assets: [{
      path: 'static/js/main.js',
      category: 'javascript',
      rawBytes: 10,
      sha256,
    }],
  };
  const diagnostics = await warmBrowserAssetDelivery({
    baseURL: 'http://127.0.0.1:5000',
    browser: {
      newContext: async (options) => {
        calls.push(['newContext', options]);
        return context;
      },
    },
    diagnosticsPath,
    owner: 'unit',
    buildReport,
    writeDiagnostics: (nextPath, contents) => {
      writes.push({ diagnosticsPath: nextPath, contents });
    },
  });

  assert.equal(diagnostics.status, 'passed');
  assert.equal(diagnostics.owner, 'unit');
  assert.deepEqual(
    diagnostics.passes.map(({ name, results }) => [name, results.length]),
    [['warm', 1], ['validation', 1]]
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].diagnosticsPath, diagnosticsPath);
  assert.equal(writes[0].contents, diagnostics);
  assert.deepEqual(calls.filter(([name]) => name === 'newContext'), [
    ['newContext', { baseURL: 'http://127.0.0.1:5000' }],
  ]);
  assert.deepEqual(calls.filter(([name]) => name === 'goto'), [[
    'goto',
    'http://127.0.0.1:5000/__fnd_perf_browser_asset_warmup__',
    { waitUntil: 'load', timeout: 15_000 },
  ]]);
  assert.deepEqual(calls.filter(([name]) => name === 'close'), [['close']]);

  await assert.rejects(
    warmBrowserAssetDelivery({
      baseURL: 'https://live.example',
      browser: { newContext: async () => context },
      diagnosticsPath,
      owner: 'unit',
      buildReport,
      writeDiagnostics: () => {},
    }),
    /refuses non-owned origin/
  );
});

test('Playwright runs asset warmup before auth and keeps setup files out of measured Chromium', () => {
  const config = require('../../playwright.config');
  const projects = new Map(config.projects.map((project) => [project.name, project]));

  assert.deepEqual(projects.get('auth-setup').dependencies, ['asset-warmup']);
  assert.deepEqual(projects.get('chromium').dependencies, ['auth-setup']);
  assert.deepEqual(
    projects.get('firestore-persistence-experiment').dependencies,
    ['asset-warmup']
  );
  assert.equal(
    projects.get('chromium').testIgnore.test('asset-warmup.setup.js'),
    true
  );
  assert.equal(projects.get('chromium').testIgnore.test('auth.setup.js'), true);
  assert.equal(projects.get('chromium').testIgnore.test('routes.performance.js'), false);
  assert.equal(config.workers, 1);
  assert.equal(config.retries, 0);
});

test('every measured browser test uses the automatic worker-scoped warmup fixture', () => {
  const measuredFiles = [
    'bootstrap.performance.js',
    'chunk-recovery.performance.js',
    'cross-browser.smoke.js',
    'grigliata-five-peer.performance.js',
    'routes.performance.js',
  ];
  for (const fileName of measuredFiles) {
    const source = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
    assert.match(source, /require\(['"]\.\/measured-test['"]\)/);
    assert.doesNotMatch(source, /require\(['"]@playwright\/test['"]\)/);
  }
  const fixtureSource = fs.readFileSync(path.join(__dirname, 'measured-test.js'), 'utf8');
  assert.match(fixtureSource, /scope:\s*['"]worker['"]/);
  assert.match(fixtureSource, /auto:\s*true/);
  assert.match(fixtureSource, /timeout:\s*180_000/);
  assert.match(fixtureSource, /http:\/\/127\.0\.0\.1:5000/);
});

test('counts Grigliata placement deliveries under the deterministic legacy telemetry key', () => {
  const snapshot = {
    events: [
      {
        category: 'firestore',
        metric: 'changed-documents-delivered',
        value: 1,
        tags: { target: GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY },
      },
      {
        category: 'firestore',
        metric: 'changed-documents-delivered',
        value: 9,
        tags: { target: 'grigliata_token_placements' },
      },
    ],
  };

  assert.equal(
    countChangedDocumentsForTarget(snapshot, GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY),
    1
  );
});

const firestoreStartupWarning = [
  '@firebase/firestore: Firestore (12.12.1): Could not reach Cloud Firestore backend. Backend didn\'t respond within 10 seconds.',
  'This typically indicates that your device does not have a healthy Internet connection at the moment. The client will operate in offline mode until it is able to successfully connect to the backend.',
].join('\n');

test('only the exact loopback demo Firestore startup warning is classified as explained', () => {
  assert.equal(isKnownDemoFirestoreStartupWarning(firestoreStartupWarning, {
    baseURL: 'http://127.0.0.1:5000',
    beforeReadiness: true,
    firebaseProjectId: 'demo-fnd-perf',
  }), true);
  assert.equal(isKnownDemoFirestoreStartupWarning(
    `[2026-07-22T03:00:00.000Z] ${firestoreStartupWarning}`,
    { baseURL: 'http://localhost:5000', beforeReadiness: true, firebaseProjectId: 'demo-fnd-perf' }
  ), true);
  for (const options of [
    { baseURL: 'https://fnd.example', beforeReadiness: true, firebaseProjectId: 'demo-fnd-perf' },
    { baseURL: 'http://127.0.0.1:5000', beforeReadiness: true, firebaseProjectId: 'demo-other' },
    { baseURL: 'http://127.0.0.1:5000', beforeReadiness: false, firebaseProjectId: 'demo-fnd-perf' },
  ]) {
    assert.equal(isKnownDemoFirestoreStartupWarning(firestoreStartupWarning, options), false);
  }
  assert.equal(isKnownDemoFirestoreStartupWarning(
    firestoreStartupWarning.replace('10 seconds', '11 seconds'),
    { baseURL: 'http://127.0.0.1:5000', beforeReadiness: true, firebaseProjectId: 'demo-fnd-perf' }
  ), false);
  assert.equal(isKnownDemoFirestoreStartupWarning(
    `${firestoreStartupWarning} Unexpected suffix`,
    { baseURL: 'http://127.0.0.1:5000', beforeReadiness: true, firebaseProjectId: 'demo-fnd-perf' }
  ), false);
  assert.equal(isKnownDemoFirestoreStartupWarning(
    firestoreStartupWarning.replace("Backend didn't respond within 10 seconds.", 'Connection failed once.'),
    { baseURL: 'http://127.0.0.1:5000', beforeReadiness: true, firebaseProjectId: 'demo-fnd-perf' }
  ), false);
});

test('only intentional lifecycle aborts from the exact demo Firestore transport are explained', () => {
  const exact = {
    lifecyclePhase: 'route-cleanup',
    resourceType: 'fetch',
    failure: 'net::ERR_ABORTED',
    url: 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)&RID=rpc',
  };
  assert.equal(isExpectedFirestoreLifecycleCancellation(exact), true);
  assert.equal(isExpectedFirestoreLifecycleCancellation({
    ...exact,
    resourceType: 'xhr',
  }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({
    ...exact,
    url: exact.url.replace('/Listen/', '/Write/'),
  }), true);
  assert.equal(isExpectedFirestoreLifecycleCancellation({
    ...exact,
    lifecyclePhase: 'auth-transition',
    url: exact.url.replace('/Listen/', '/Write/'),
  }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, lifecyclePhase: null }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, resourceType: 'document' }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, failure: 'net::ERR_FAILED' }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, url: exact.url.replace('127.0.0.1:8080', 'firestore.googleapis.com') }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, url: exact.url.replace('demo-fnd-perf', 'demo-other') }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, url: exact.url.replace('/Listen/channel', '/Other/channel') }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, firebaseProjectId: 'live-fnd' }), false);
});

test('reads compact changed-document telemetry without returning the event history', async () => {
  const previousWindow = global.window;
  global.window = {
    __FND_PERF__: {
      snapshot: () => ({
        events: [
          {
            category: 'firestore',
            metric: 'changed-documents-delivered',
            value: 2,
            tags: { target: GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY },
          },
          {
            category: 'firestore',
            metric: 'changed-documents-delivered',
            value: 7,
            tags: { target: 'unrelated-target' },
          },
        ],
      }),
    },
  };
  try {
    const page = { evaluate: async (callback, argument) => callback(argument) };
    assert.deepEqual(
      await readChangedDocumentDeliveryTelemetry(
        page,
        GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY
      ),
      { changedDocumentsDelivered: 2, eventCount: 2 }
    );
  } finally {
    global.window = previousWindow;
  }
});

test('reads a compact route cleanup summary and omits unrelated route state', async () => {
  const previousWindow = global.window;
  global.window = {
    __FND_PERF__: {
      snapshot: () => ({
        events: Array.from({ length: 10_000 }, (_, index) => ({ index })),
        activeListeners: {
          '/grigliata::placements': 0,
          '/home::profile': 1,
        },
        activeResources: {
          '/grigliata::timeout:probe': 0,
          '/home::timeout:probe': 1,
        },
        media: { activeSources: 0, sources: Array.from({ length: 1_000 }) },
      }),
    },
  };
  try {
    const page = { evaluate: async (callback, argument) => callback(argument) };
    assert.deepEqual(await readRouteCleanupSummary(page, '/grigliata'), {
      activeListeners: { '/grigliata::placements': 0 },
      activeResources: { '/grigliata::timeout:probe': 0 },
      media: { activeSources: 0 },
    });
  } finally {
    global.window = previousWindow;
  }
});

test('only successful demo Write-channel turnover is explained during the five-peer probe', () => {
  const exact = {
    lifecyclePhase: 'route-active',
    resourceType: 'fetch',
    failure: 'net::ERR_ABORTED',
    method: 'GET',
    responseStatus: 200,
    url: 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Write/channel?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)&RID=rpc',
  };
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover(exact), true);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
    ...exact,
    url: exact.url.replace('/Write/', '/Listen/'),
  }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
    ...exact,
    lifecyclePhase: 'route-cleanup',
  }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({ ...exact, responseStatus: 0 }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({ ...exact, responseStatus: 500 }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({ ...exact, method: 'POST' }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({ ...exact, resourceType: 'xhr' }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({ ...exact, failure: 'net::ERR_FAILED' }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
    ...exact,
    url: exact.url.replace('127.0.0.1:8080', 'firestore.googleapis.com'),
  }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
    ...exact,
    url: exact.url.replace('demo-fnd-perf', 'demo-other'),
  }), false);
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
    ...exact,
    firebaseProjectId: 'fatin-test',
  }), false);

  const continuation = {
    ...exact,
    responseStatus: undefined,
    url: `${exact.url}&VER=8&SID=I4sZ0bMAEY4XeEvOj7Ks4Q%3D%3D&AID=5&CI=0&TYPE=xmlhttp&zx=9afmshv1j87t&t=1`,
  };
  assert.equal(isExpectedFivePeerFirestoreWriteTurnover(continuation), true);
  for (const parameter of ['VER', 'RID', 'SID', 'AID', 'CI', 'TYPE', 'zx', 't']) {
    const candidate = new URL(continuation.url);
    candidate.searchParams.delete(parameter);
    assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
      ...continuation,
      url: candidate.href,
    }), false, `missing ${parameter}`);
  }
  for (const [parameter, value] of [['foo', 'bar'], ['RID', 'other']]) {
    const candidate = new URL(continuation.url);
    candidate.searchParams.append(parameter, value);
    assert.equal(isExpectedFivePeerFirestoreWriteTurnover({
      ...continuation,
      url: candidate.href,
    }), false, `unexpected ${parameter}`);
  }
});

test('five-peer request diagnostics retain protocol evidence without session values', () => {
  const rawSid = 'I4sZ0bMAEY4XeEvOj7Ks4Q==';
  const rawAid = '1452';
  const rawZx = '9afmshv1j87t';
  const rawDatabase = 'projects/demo-fnd-perf/databases/(default)';
  const evidence = sanitizeFivePeerRequestFailure({
    role: 'dm',
    lifecyclePhase: 'route-active',
    sequence: 3,
    elapsedMs: 125.6,
    resourceType: 'fetch',
    failure: 'net::ERR_ABORTED',
    method: 'GET',
    responseStatus: undefined,
    url: 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Write/channel'
      + `?VER=8&database=${encodeURIComponent(rawDatabase)}`
      + `&SID=${encodeURIComponent(rawSid)}&RID=92943&AID=${rawAid}`
      + `&TYPE=xmlhttp&zx=${rawZx}&t=1&${encodeURIComponent('unsafe=key')}=discarded`,
  });

  assert.deepEqual(evidence, {
    schemaVersion: 1,
    role: 'dm',
    lifecyclePhase: 'route-active',
    sequence: 3,
    elapsedMs: 126,
    resourceType: 'fetch',
    failure: 'net::ERR_ABORTED',
    method: 'GET',
    path: '/google.firestore.v1.Firestore/Write/channel',
    responseObserved: false,
    responseStatus: null,
    ownedEmulatorOrigin: true,
    expectedDatabase: true,
    operation: 'Write',
    query: {
      keys: ['AID', 'RID', 'SID', 'TYPE', 'VER', '[redacted]', 'database', 't', 'zx'],
      omittedKeyCount: 0,
      protocol: {
        ver: '8',
        rid: 'numeric',
        ci: 'missing',
        type: 'xmlhttp',
        t: '1',
      },
      opaque: {
        sid: { present: true, length: rawSid.length, format: 'token' },
        aid: { present: true, length: rawAid.length, format: 'digits' },
        zx: { present: true, length: rawZx.length, format: 'token' },
      },
    },
  });
  const serialized = JSON.stringify(evidence);
  for (const secret of [rawSid, rawAid, rawZx, rawDatabase, 'unsafe=key']) {
    assert.equal(serialized.includes(secret), false, `redacts ${secret}`);
  }
  assert.equal(sanitizeFivePeerRequestFailure({
    failure: `net::ERR_${'A'.repeat(100)}`,
  }).failure, 'other');
});

test('five-peer response diagnostics prefer observed status and safely query the request fallback', async () => {
  const observedRequest = {
    response: async () => {
      throw new Error('the response fallback must not run when an event status exists');
    },
  };
  const observedStatuses = new WeakMap([[observedRequest, 200]]);
  assert.equal(
    await resolvePlaywrightResponseStatus(observedRequest, observedStatuses),
    200
  );

  const fallbackRequest = {
    response: async () => ({ status: () => 204 }),
  };
  assert.equal(
    await resolvePlaywrightResponseStatus(fallbackRequest, new WeakMap()),
    204
  );
  assert.equal(await resolvePlaywrightResponseStatus({
    response: async () => null,
  }, new WeakMap()), undefined);
  assert.equal(await resolvePlaywrightResponseStatus({
    response: async () => {
      throw new Error('request was already disposed');
    },
  }, new WeakMap()), undefined);
});

test('only intentional Task 07 fixture-image detach aborts are explained', () => {
  const exact = {
    lifecyclePhase: 'auth-transition',
    resourceType: 'image',
    failure: 'net::ERR_ABORTED',
    url: 'http://127.0.0.1:9199/v0/b/demo-fnd-perf.appspot.com/o/performance%2Fimage-013.png?alt=media&token=performance-token',
  };
  assert.equal(isExpectedTask07MediaDetachmentCancellation(exact), true);
  assert.equal(isExpectedTask07MediaDetachmentCancellation({ ...exact, lifecyclePhase: 'connection-drain' }), false);
  assert.equal(isExpectedTask07MediaDetachmentCancellation({ ...exact, resourceType: 'fetch' }), false);
  assert.equal(isExpectedTask07MediaDetachmentCancellation({ ...exact, failure: 'net::ERR_FAILED' }), false);
  assert.equal(isExpectedTask07MediaDetachmentCancellation({ ...exact, url: exact.url.replace('127.0.0.1:9199', 'storage.googleapis.com') }), false);
  assert.equal(isExpectedTask07MediaDetachmentCancellation({ ...exact, url: exact.url.replace('image-013.png', 'other.png') }), false);
  assert.equal(isExpectedTask07MediaDetachmentCancellation({ ...exact, firebaseProjectId: 'live-fnd' }), false);
});

test('only loopback demo reCAPTCHA cleanup noise is explained', () => {
  const cancellation = {
    lifecyclePhase: 'auth-transition',
    resourceType: 'fetch',
    failure: 'net::ERR_ABORTED',
    url: 'https://www.google.com/recaptcha/enterprise/clr?token=discarded',
  };
  assert.equal(isExpectedDemoRecaptchaCancellation(cancellation), true);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    lifecyclePhase: 'auth-bootstrap',
  }), true);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    lifecyclePhase: 'connection-drain',
  }), true);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    lifecyclePhase: 'route-cleanup',
  }), true);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    lifecyclePhase: 'route-active',
  }), true);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    failure: 'net::ERR_FAILED',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    url: 'https://www.google.com/recaptcha/enterprise/reload',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    firebaseProjectId: 'fatin-test',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    resourceType: 'xhr',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    url: 'https://example.test/recaptcha/enterprise/clr',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...cancellation,
    url: 'not a URL',
  }), false);
  const navigationScript = {
    lifecyclePhase: 'route-navigation',
    resourceType: 'script',
    failure: 'net::ERR_ABORTED',
    url: 'https://www.gstatic.com/recaptcha/releases/release_123/recaptcha__en.js',
  };
  assert.equal(isExpectedDemoRecaptchaCancellation(navigationScript), true);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...navigationScript,
    lifecyclePhase: 'route-active',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...navigationScript,
    url: 'https://www.gstatic.com/recaptcha/releases/release_123/other.js',
  }), false);
  assert.equal(isExpectedDemoRecaptchaCancellation({
    ...navigationScript,
    url: 'https://www.google.com/recaptcha/releases/release_123/recaptcha__en.js',
  }), false);

  const warning = [
    "Framing 'https://www.google.com/' violates the following report-only Content Security Policy directive: \"default-src 'self'\".",
    "The violation has been logged, but no further action has been taken. Note that 'frame-src' was not explicitly set, so 'default-src' is used as a fallback.",
  ].join(' ');
  const warningOptions = {baseURL: 'http://127.0.0.1:5000'};
  assert.equal(isExpectedDemoRecaptchaReportOnlyWarning(warning, warningOptions), true);
  assert.equal(isExpectedDemoRecaptchaReportOnlyWarning(
    warning,
    {baseURL: 'https://fatin-test.web.app'}
  ), false);
  assert.equal(isExpectedDemoRecaptchaReportOnlyWarning(
    warning.replace('report-only', 'enforced'),
    warningOptions
  ), false);
  assert.equal(isExpectedDemoRecaptchaReportOnlyWarning(
    warning,
    {...warningOptions, firebaseProjectId: 'fatin-test'}
  ), false);
  assert.equal(isExpectedDemoRecaptchaReportOnlyWarning(
    warning.replace('The violation has been logged, but no further action has been taken.', ''),
    warningOptions
  ), false);
  assert.equal(isExpectedDemoRecaptchaReportOnlyWarning(
    warning,
    {baseURL: 'not a URL'}
  ), false);
});

test('route measurements wire the strict demo reCAPTCHA report-only classifier', () => {
  const routeSource = fs.readFileSync(
    path.resolve(__dirname, 'routes.performance.js'),
    'utf8'
  );
  assert.match(routeSource, /isExpectedDemoRecaptchaReportOnlyWarning\(text, \{baseURL\}\)/);
  assert.match(routeSource, /explainedRecaptchaReportOnlyWarnings\.push\(text\.slice\(0, 500\)\)/);
});

test('authoritative image diagnostics retain a bounded head and tail', () => {
  const timings = Array.from({ length: 200 }, (_, index) => ({ startTime: index }));
  const retained = retainImageResourceTimings(timings);
  assert.equal(retained.length, MAX_RETAINED_IMAGE_RESOURCE_TIMINGS);
  assert.deepEqual(
    retained.slice(0, 32).map(({ startTime }) => startTime),
    Array.from({ length: 32 }, (_, index) => index)
  );
  assert.deepEqual(
    retained.slice(32).map(({ startTime }) => startTime),
    Array.from({ length: 96 }, (_, index) => index + 104)
  );
  const alreadyBounded = timings.slice(0, 4);
  assert.equal(retainImageResourceTimings(alreadyBounded), alreadyBounded);
  assert.deepEqual(retainImageResourceTimings(null), []);
});

test('authoritative scenario results retain sanitized LCP and image timing diagnostics', () => {
  const routeSource = fs.readFileSync(
    path.resolve(__dirname, 'routes.performance.js'),
    'utf8'
  );
  assert.match(
    routeSource,
    /lcpCandidates:\s*capture\.diagnostics\.lcpCandidates/
  );
  assert.match(
    routeSource,
    /imageResourceTimings:\s*retainImageResourceTimings\(/
  );
});

test('font routing keeps optional Google font requests deterministic and local', async () => {
  let matcher;
  let handler;
  await installDeterministicFontRoutes({
    async route(nextMatcher, nextHandler) {
      matcher = nextMatcher;
      handler = nextHandler;
    },
  });

  assert.equal(matcher.test('https://fonts.googleapis.com/css2?family=Cinzel'), true);
  assert.equal(matcher.test('https://fonts.gstatic.com/font.woff2'), true);
  assert.equal(matcher.test('http://127.0.0.1:8080/firestore'), false);

  let fulfilled;
  await handler({ fulfill: async (options) => { fulfilled = options; } });
  assert.deepEqual(fulfilled, {
    status: 204,
    body: '',
    contentType: 'text/css; charset=utf-8',
  });
});

test('page draining navigates only an owned open page to about:blank', async () => {
  const calls = [];
  await drainPageConnections({
    isClosed: () => false,
    goto: async (...args) => calls.push(args),
  });
  await drainPageConnections({
    isClosed: () => true,
    goto: async () => assert.fail('closed pages must not be navigated'),
  });

  assert.deepEqual(calls, [[
    'about:blank',
    { waitUntil: 'load', timeout: 5_000 },
  ]]);
});

test('cleanup navigation foregrounds a peer and does not depend on animation-frame polling', async () => {
  const calls = [];
  await navigateToCleanup({
    bringToFront: async () => calls.push(['bringToFront']),
    evaluate: async (callback) => {
      calls.push(['evaluate', typeof callback]);
    },
    waitForFunction: async (callback, argument, options) => {
      calls.push(['waitForFunction', typeof callback, argument, options]);
    },
  });

  assert.deepEqual(calls, [
    ['bringToFront'],
    ['evaluate', 'function'],
    ['waitForFunction', 'function', null, { polling: 100 }],
  ]);
});

test('readiness foregrounds a peer and does not depend on animation-frame polling', async () => {
  const calls = [];
  await waitForReadiness({
    bringToFront: async () => calls.push(['bringToFront']),
    url: () => 'http://127.0.0.1:5000/',
    waitForFunction: async (callback, argument, options) => {
      calls.push(['waitForFunction', typeof callback, argument, options]);
    },
  });

  assert.deepEqual(calls, [
    ['bringToFront'],
    ['waitForFunction', 'function', null, { polling: 100 }],
    ['waitForFunction', 'function', '/', { polling: 100 }],
  ]);
});

test('readiness supports an explicit harness deadline without changing the default', async () => {
  const calls = [];
  await waitForReadiness({
    bringToFront: async () => calls.push(['bringToFront']),
    url: () => 'http://127.0.0.1:5000/',
    waitForFunction: async (callback, argument, options) => {
      calls.push(['waitForFunction', typeof callback, argument, options]);
    },
  }, { timeoutMs: 30_000 });

  assert.deepEqual(calls, [
    ['bringToFront'],
    ['waitForFunction', 'function', null, { polling: 100 }],
    ['waitForFunction', 'function', '/', { polling: 100, timeout: 30_000 }],
  ]);
});

test('route readiness rejects transient nested lazy-route fallbacks', () => {
  const previousWindow = global.window;
  const previousDocument = global.document;
  global.window = {
    __FND_PERF__: {
      snapshot: () => ({
        routeState: {
          routeId: '/home',
          shellVisible: true,
          dataReady: true,
          interactive: true,
        },
      }),
    },
  };
  try {
    global.window.location = { pathname: '/home' };
    global.document = { querySelector: () => ({ role: 'status' }) };
    assert.equal(isRouteReadyInPage('/home'), false);
    global.document = { querySelector: () => null };
    assert.equal(isRouteReadyInPage('/home'), true);
    global.window.__FND_PERF__.snapshot = () => ({
      routeState: {
        routeId: '/',
        shellVisible: true,
        dataReady: true,
        interactive: true,
      },
    });
    assert.equal(isRouteReadyInPage('/home'), false);
    global.window.location.pathname = '/later';
    assert.equal(isRouteReadyInPage('/home'), false);
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
  }
});

test('page asset tracking waits for finite fetches and ignores known streams and media', () => {
  let now = 0;
  const tracker = createPageAssetTracker({ now: () => now, quietWindowMs: 500 });
  const script = { resourceType: () => 'script' };
  const media = { resourceType: () => 'media' };
  const finiteFetch = {
    resourceType: () => 'fetch',
    url: () => 'http://127.0.0.1:5000/api/config',
  };
  const firestoreStream = {
    resourceType: () => 'fetch',
    url: () => 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)&RID=rpc',
  };

  assert.equal(tracker.isQuiet(), false);
  now = 450;
  tracker.begin(script);
  tracker.begin(media);
  tracker.begin(finiteFetch);
  tracker.begin(firestoreStream);
  assert.equal(tracker.pendingCount(), 2);
  assert.deepEqual(tracker.snapshot(), {
    pendingCount: 2,
    quietForMs: 0,
    pending: [
      { ageMs: 0, path: 'unknown', resourceType: 'script' },
      { ageMs: 0, path: '/api/config', resourceType: 'fetch' },
    ],
  });
  now = 460;
  tracker.complete(script);
  assert.equal(tracker.pendingCount(), 1);
  tracker.complete(finiteFetch);
  assert.equal(tracker.isQuiet(), false);
  now = 959;
  assert.equal(tracker.isQuiet(), false);
  assert.deepEqual(tracker.snapshot(), {
    pendingCount: 0,
    quietForMs: 499,
    pending: [],
  });
  now = 960;
  assert.equal(tracker.isQuiet(), true);
  tracker.beginQuietWindow();
  assert.equal(tracker.isQuiet(), false);
  now = 1460;
  assert.equal(tracker.isQuiet(), true);
});

test('image registry settlement rejects early idle and waits for a stable complete fixture', async () => {
  const registrySnapshots = [
    { loadedRecordCount: 14, activeRequestCount: 2, queuedRequestCount: 0 },
    { loadedRecordCount: 14, activeRequestCount: 0, queuedRequestCount: 0 },
    { loadedRecordCount: 14, activeRequestCount: 2, queuedRequestCount: 0 },
    {
      recordCount: 40,
      loadedRecordCount: 40,
      activeRequestCount: 0,
      queuedRequestCount: 0,
      decodedBytes: 40 * 36_864,
      unpinnedDecodedBytes: 39 * 36_864,
      unpinnedRecordCount: 39,
    },
    {
      recordCount: 40,
      loadedRecordCount: 40,
      activeRequestCount: 0,
      queuedRequestCount: 0,
      decodedBytes: 40 * 36_864,
      unpinnedDecodedBytes: 39 * 36_864,
      unpinnedRecordCount: 39,
    },
  ];
  let evaluateCalls = 0;
  const page = {
    evaluate: async () => {
      evaluateCalls += 1;
      if (evaluateCalls === 1) return undefined;
      return registrySnapshots.shift();
    },
    waitForTimeout: async () => new Promise((resolve) => setTimeout(resolve, 2)),
  };

  const settled = await waitForImageRegistrySettlement(page, {
    minimumLoadedRecords: 40,
    quietMs: 1,
  });

  assert.equal(settled.loadedRecordCount, 40);
  assert.equal(settled.activeRequestCount, 0);
  assert.equal(evaluateCalls, 6);
  assert.equal(registrySnapshots.length, 0);
});

test('resource summaries preserve requests and separate canonical inventory from streams', () => {
  const summary = summarizeResourceEntries([
    {
      name: 'http://127.0.0.1:5000/static/image.svg?token=one',
      transferSize: 10,
      encodedBodySize: 8,
    },
    {
      name: 'http://127.0.0.1:5000/static/image.svg?token=two',
      transferSize: 12,
      encodedBodySize: 9,
    },
    {
      name: 'http://127.0.0.1:5000/static/other.svg',
      transferSize: 14,
      encodedBodySize: 11,
    },
    {
      name: 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)&RID=one',
      transferSize: 3,
      encodedBodySize: 2,
    },
    {
      name: 'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo-fnd-perf%2Fdatabases%2F(default)&RID=two',
      transferSize: 4,
      encodedBodySize: 3,
    },
  ]);

  assert.equal(RESOURCE_TIMING_BUFFER_SIZE, 5_000);
  assert.deepEqual(summary.image, {
    count: 3,
    uniqueCount: 2,
    uniqueFingerprint: sha256([
      'http://127.0.0.1:5000/static/image.svg',
      'http://127.0.0.1:5000/static/other.svg',
    ].sort().join('\n')),
    transferBytes: 36,
    encodedBytes: 28,
    uniqueEncodedBytes: 20,
  });
  assert.deepEqual(summary.stream, {
    count: 2,
    uniqueCount: 1,
    uniqueFingerprint: sha256(
      'http://127.0.0.1:8080/google.firestore.v1.Firestore/Listen/channel'
    ),
    transferBytes: 7,
    encodedBytes: 5,
    uniqueEncodedBytes: 3,
  });
});

test('Konva placement probes identify one exact token and poll moves without animation frames', async () => {
  const previousWindow = global.window;
  const tokenNode = {
    getAttr: (name) => (name === 'data-testid' ? 'token-node-perf-token-0000' : undefined),
    x: () => 25,
    y: () => 75,
  };
  global.window = {
    Konva: {
      stages: [{ find: (predicate) => [tokenNode].filter(predicate) }],
    },
  };
  try {
    const page = {
      evaluate: async (callback, argument) => callback(argument),
    };
    assert.deepEqual(
      await readKonvaTokenPositions(page, 'perf-token-0000'),
      [{ x: 25, y: 75 }]
    );
  } finally {
    global.window = previousWindow;
  }

  const calls = [];
  await waitForKonvaTokenMove({
    evaluate: async (_callback, tokenId) => {
      calls.push(['evaluate', tokenId]);
      return [{ x: 75, y: 75 }];
    },
  }, {
    tokenId: 'perf-token-0000',
    from: { x: 25, y: 75 },
    deltaX: 50,
    deltaY: 0,
  });
  assert.deepEqual(calls, [
    ['evaluate', 'perf-token-0000'],
  ]);
});

test('DM dashboard player lookup scopes an exact name to its player card', () => {
  const playerHeading = {
    locator(selector) {
      calls.push(['heading.locator', selector]);
      return playerCard;
    },
  };
  const playerCard = { kind: 'player-card' };
  const calls = [];
  const page = {
    locator(selector) {
      calls.push(['locator', selector]);
      return {
        filter(options) {
          calls.push(['filter', options]);
          return playerHeading;
        },
      };
    },
  };

  assert.equal(locateDmDashboardPlayerCard(page, 'Performance Hero 2'), playerCard);
  const namePattern = calls[1][1].hasText;
  assert.equal(namePattern.test('Performance Hero 2'), true);
  assert.equal(namePattern.test('Performance Hero 20'), false);
  assert.deepEqual(calls, [
    ['locator', 'div.text-lg.font-bold'],
    ['filter', { hasText: namePattern }],
    [
      'heading.locator',
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-lg ")][1]',
    ],
  ]);
});

test('scenario restoration skips no-op writes and patches only drifted fixture state', () => {
  assert.equal(scenarioRestorePatch('home', { stats: { hpCurrent: 45 } }), null);
  assert.deepEqual(
    scenarioRestorePatch('home', { stats: { hpCurrent: 44 } }),
    { 'stats.hpCurrent': 45 }
  );

  const canonicalPlacement = {
    col: 0,
    row: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'perf-dm',
  };
  assert.equal(scenarioRestorePatch('grigliata-manager', canonicalPlacement), null);
  assert.deepEqual(
    scenarioRestorePatch('grigliata-five-peer', { ...canonicalPlacement, col: 1 }),
    canonicalPlacement
  );
  assert.equal(scenarioRestorePatch('codex', {}), null);
});
