const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { expect } = require('@playwright/test');
const { createPageAssetTracker } = require('./helpers');

// Execute the scenario itself, controlling request delivery at its browser boundary.
const runShellScenario = async ({ interactionRequests = 0, deferredInitialRequests = 0 }) => {
  const handlers = {};
  let scenario;
  let result;
  let evaluation = 0;
  let initialRequests = 13 - deferredInitialRequests;
  const heading = {};
  const scenarioExpect = Object.assign((actual, ...options) => (
    actual === heading ? { toBeVisible: async () => {} } : expect(actual, ...options)
  ), { poll: expect.poll });
  const request = (index) => {
    const entry = {
      resourceType: () => 'image',
      url: () => `http://127.0.0.1:9199/v0/b/demo-fnd-perf.appspot.com/o/performance/image-${index}.png`,
    };
    for (const handler of handlers.request || []) handler(entry);
    for (const handler of handlers.requestfinished || []) handler(entry);
  };
  const page = {
    on: (event, handler) => { (handlers[event] ||= []).push(handler); },
    goto: async () => {
      for (let index = 0; index < initialRequests; index += 1) request(index);
    },
    getByRole: () => heading,
    waitForTimeout: async () => {},
    evaluate: async () => (++evaluation === 1 ? {
      total: 60,
      attached: 12,
      farOffscreen: 48,
      farOffscreenAttached: 0,
      dimensionsMissing: 0,
      nonLazy: 0,
      nonAsync: 0,
    } : {
      auroraPaused: true,
      starFields: 2,
      activeMeteors: 0,
      meteorSlots: 2,
      musicStreamListeners: 1,
      legacyMusicPlaybackListeners: 0,
      legacyMusicSessionListeners: 0,
      audioNodes: [],
    }),
  };
  const context = { newPage: async () => page, close: async () => {} };
  const helpers = {
    createPageAssetTracker: () => createPageAssetTracker({ quietWindowMs: 0 }),
    flushBrowserObservers: async () => {
      while (initialRequests < 13) request(initialRequests++);
    },
    drainPageConnections: async () => {},
    installDeterministicFontRoutes: async () => {},
    installOwnedEmulatorFirestoreTransport: async () => {},
    isExpectedDemoRecaptchaCancellation: () => false,
    isExpectedDemoRecaptchaReportOnlyWarning: () => false,
    storageStateForRole: () => ({}),
    waitForReadiness: async () => {},
    writeScenarioResult: (_scenario, _iteration, report) => { result = report; },
  };
  const inventory = {
    assertInitialHomeInventoryWindow: async () => {},
    assertRemainingHomeInventoryAccessible: async () => {
      for (let index = 0; index < interactionRequests; index += 1) request(100 + index);
    },
  };
  const filename = path.join(__dirname, 'task07-media-shell.performance.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    URL,
    require: (name) => {
      if (name === './measured-test') return {
        test: (_name, callback) => { scenario = callback; },
        expect: scenarioExpect,
      };
      if (name === './helpers') return helpers;
      if (name === './home-inventory-window') return inventory;
      throw new Error(`Unexpected scenario dependency: ${name}`);
    },
  }, { filename });
  await scenario({
    browser: { newContext: async () => context, version: () => 'test-browser' },
    baseURL: 'http://127.0.0.1:5000',
  }, { project: { name: 'chromium', use: { browserName: 'chromium' } } });
  return result;
};

test('Home reports initial image requests independently of later inventory loading', async () => {
  for (const [interactionRequests, expectedTotal] of [[0, 13], [14, 27]]) {
    const report = await runShellScenario({ interactionRequests });
    assert.equal(report.metrics['task07.uniqueFixtureImageRequests'], 13);
    assert.equal(report.metrics['task07.attachedImages'], 12);
    assert.equal(report.metrics['task07.managedImages'], 60);
    assert.equal(report.diagnostics.fixtureImageRequests.initial.length, 13);
    assert.equal(report.diagnostics.fixtureImageRequests.afterInventoryInteraction.length, expectedTotal);
  }
});

test('Home includes initial image requests dispatched by browser observers before capture', async () => {
  const report = await runShellScenario({ deferredInitialRequests: 1 });
  assert.equal(report.metrics['task07.uniqueFixtureImageRequests'], 13);
});
