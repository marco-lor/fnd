const test = require('node:test');
const assert = require('node:assert/strict');
const {
  drainPageConnections,
  installDeterministicFontRoutes,
  locateDmDashboardPlayerCard,
  navigateToCleanup,
  scenarioRestorePatch,
} = require('./helpers');

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
    { waitUntil: 'commit', timeout: 5_000 },
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
