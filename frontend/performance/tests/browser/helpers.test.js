const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GRIGLIATA_PLACEMENT_SUBSCRIBE_METRIC_KEY,
  countChangedDocumentsForTarget,
  createPageAssetTracker,
  drainPageConnections,
  installDeterministicFontRoutes,
  isExpectedFirestoreLifecycleCancellation,
  isKnownDemoFirestoreStartupWarning,
  isRouteReadyInPage,
  locateDmDashboardPlayerCard,
  navigateToCleanup,
  readKonvaTokenPositions,
  scenarioRestorePatch,
  waitForReadiness,
  waitForKonvaTokenMove,
} = require('./helpers');

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
    url: exact.url.replace('/Listen/', '/Write/'),
  }), true);
  assert.equal(isExpectedFirestoreLifecycleCancellation({
    ...exact,
    lifecyclePhase: 'auth-transition',
    url: exact.url.replace('/Listen/', '/Write/'),
  }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, lifecyclePhase: null }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, failure: 'net::ERR_FAILED' }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, url: exact.url.replace('127.0.0.1:8080', 'firestore.googleapis.com') }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, url: exact.url.replace('demo-fnd-perf', 'demo-other') }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, url: exact.url.replace('/Listen/channel', '/Other/channel') }), false);
  assert.equal(isExpectedFirestoreLifecycleCancellation({ ...exact, firebaseProjectId: 'live-fnd' }), false);
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
  assert.deepEqual(fulfilled, { status: 204, body: '' });
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

test('page asset tracking requires a stable quiet window and ignores streaming media', () => {
  let now = 0;
  const tracker = createPageAssetTracker({ now: () => now, quietWindowMs: 500 });
  const script = { resourceType: () => 'script' };
  const media = { resourceType: () => 'media' };

  assert.equal(tracker.isQuiet(), false);
  now = 450;
  tracker.begin(script);
  tracker.begin(media);
  assert.equal(tracker.pendingCount(), 1);
  now = 460;
  tracker.complete(script);
  assert.equal(tracker.isQuiet(), false);
  now = 959;
  assert.equal(tracker.isQuiet(), false);
  now = 960;
  assert.equal(tracker.isQuiet(), true);
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
