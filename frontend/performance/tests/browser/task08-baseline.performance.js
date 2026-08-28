const { test, expect } = require('./measured-test');
const {
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  projectId,
  resultsDir,
} = require('../../../scripts/performance/common');
const fixtureManifest = require('../../fixture-manifest.json');
const {
  buildDeterministicPng,
  buildDocuments,
  TASK08_CONSUMABLE_INVENTORY_ID,
  TASK08_TWO_CLIENT_SESSION,
} = require('../../../scripts/performance/fixtures');
const {
  deriveTask08Metrics,
  settleTask08ResourceHold,
} = require('../../../scripts/performance/task08-contract');
const {
  readTask08Report,
  recordTask08Scenario,
} = require('../../../scripts/performance/task08-report');
const {
  createTask08AccountCleanup,
} = require('./task08-cleanup');
const {
  captureBrowserMetrics,
  countRouteResources,
  createPageAssetTracker,
  drainPageConnections,
  flushBrowserObservers,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  isKnownDemoFirestoreStartupWarning,
  navigateToCleanup,
  storageStateForRole,
  warmBrowserAssetDelivery,
  waitForReadiness,
} = require('./helpers');

const BASELINE_RESULT_PATH = require('path').join(resultsDir, 'task08-baseline.json');
const CREATE_ACCOUNT_EMAIL = 'task08-created@example.test';
const CREATE_ACCOUNT_PASSWORD = 'PerfTest!123';
const PERF_BRIDGE = '__FND_PERF_TASK08__';
const HOME_ROUTE = '/home';
const CHARACTER_CREATION_ROUTE = '/character-creation';
const CLEANUP_ROUTE = '/__fnd_perf_cleanup__';

const fixtureDocuments = buildDocuments();
const fixtureDocument = (documentPath) => {
  const document = fixtureDocuments.find(({ path: candidate }) => candidate === documentPath);
  if (!document) throw new Error(`Task 08 fixture document is missing: ${documentPath}`);
  return document;
};
const playerResourceFixture = fixtureDocument('users/perf-player/state/resources');
const consumableFixture = fixtureDocument(
  `users/perf-player/inventory/${TASK08_CONSUMABLE_INVENTORY_ID}`
);

let adminApp = null;
let createdAccountCleanup = null;

const getAdminClients = () => {
  assertPerformanceProject(projectId);
  configureOwnedPerformanceEnvironment();
  if (!adminApp) {
    const { initializeApp } = require('firebase-admin/app');
    adminApp = initializeApp({ projectId }, 'task08-browser-baseline');
  }
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  return { auth: getAuth(adminApp), db: getFirestore(adminApp) };
};

const restorePlayerResource = async () => {
  const { db } = getAdminClients();
  await db.doc(playerResourceFixture.path).set(playerResourceFixture.data);
};

const restoreConsumable = async () => {
  const { db } = getAdminClients();
  await db.doc(consumableFixture.path).set(consumableFixture.data);
};

const removeCreatedAccount = async () => {
  const { auth, db } = getAdminClients();
  if (!createdAccountCleanup) {
    createdAccountCleanup = createTask08AccountCleanup({
      email: CREATE_ACCOUNT_EMAIL,
      auth,
      db,
    });
  }
  try {
    return await createdAccountCleanup.removeCreatedAccount();
  } catch (firstError) {
    // A local emulator write can transiently fail while the account-initialize
    // transaction is settling. The helper retains the UID, so this retry is
    // safe and cannot fall back to an email lookup after Auth deletion.
    try {
      return await createdAccountCleanup.removeCreatedAccount();
    } catch (secondError) {
      throw new AggregateError([firstError, secondError], 'Task 08 created-account cleanup failed after retry.');
    }
  }
};

const createDiagnostics = () => ({
  consoleErrors: [],
  explainedStartupWarnings: [],
  explainedRecaptchaCancellations: [],
  explainedRecaptchaReportOnlyWarnings: [],
  unhandledErrors: [],
  failedRequests: [],
  networkRecords: [],
});

const attachDiagnostics = (page, pageAssets, diagnostics, baseURL) => {
  let lifecyclePhase = 'route-navigation';
  page.on('request', (request) => pageAssets.begin(request));
  page.on('requestfinished', (request) => pageAssets.complete(request));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isKnownDemoFirestoreStartupWarning(text, {
      baseURL,
      beforeReadiness: lifecyclePhase === 'route-navigation',
    })) {
      diagnostics.explainedStartupWarnings.push(text.slice(0, 500));
      return;
    }
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, { baseURL })) {
      diagnostics.explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
      return;
    }
    diagnostics.consoleErrors.push(text.slice(0, 300));
  });
  page.on('pageerror', (error) => {
    diagnostics.unhandledErrors.push(error.message.slice(0, 300));
  });
  page.on('requestfailed', (request) => {
    pageAssets.complete(request);
    const failure = {
      resourceType: request.resourceType(),
      failure: request.failure()?.errorText || 'unknown',
      path: (() => {
        try { return new URL(request.url()).pathname; } catch { return '[invalid-url]'; }
      })(),
    };
    if (isExpectedDemoRecaptchaCancellation({
      ...failure,
      baseURL,
      lifecyclePhase,
      url: request.url(),
    })) {
      diagnostics.explainedRecaptchaCancellations.push({
        ...failure,
        phase: lifecyclePhase,
      });
      return;
    }
    diagnostics.failedRequests.push(failure);
  });
  page.on('response', async (response) => {
    const request = response.request();
    const headers = await response.allHeaders().catch(() => ({}));
    diagnostics.networkRecords.push({
      path: new URL(response.url()).pathname,
      resourceType: request.resourceType(),
      method: request.method(),
      status: response.status(),
      contentLength: Number(headers['content-length']) || 0,
    });
  });
  return {
    setLifecyclePhase: (phase) => { lifecyclePhase = phase; },
  };
};

const waitForFiniteAssets = async (pageAssets, label) => {
  await expect.poll(
    () => pageAssets.isQuiet(),
    { timeout: 15_000, message: `Finite assets did not settle for ${label}.` }
  ).toBe(true);
};

const waitForTask08Bridge = async (page) => {
  await page.waitForFunction(
    (bridgeName) => window[bridgeName]?.contractVersion === 1,
    PERF_BRIDGE,
    { polling: 100, timeout: 15_000 }
  );
};

const openSession = async ({ browser, baseURL, scenario, storageState }) => {
  const context = await browser.newContext({ baseURL, storageState });
  await warmBrowserAssetDelivery({
    baseURL,
    context,
    owner: `context-task08-${scenario.id}`,
  });
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, scenario, 1);
  const page = await context.newPage();
  const pageAssets = createPageAssetTracker();
  const diagnostics = createDiagnostics();
  const diagnosticControl = attachDiagnostics(page, pageAssets, diagnostics, baseURL);
  return { context, page, pageAssets, diagnostics, diagnosticControl };
};

const openRoute = async (session, route) => {
  const { page, pageAssets, diagnosticControl } = session;
  diagnosticControl.setLifecyclePhase('route-navigation');
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await waitForReadiness(page, { expectedPathname: route, timeoutMs: 45_000 });
  diagnosticControl.setLifecyclePhase('route-active');
  await waitForFiniteAssets(pageAssets, route);
};

const assertCleanSession = async (session, measuredRoute) => {
  const { page, context, diagnostics } = session;
  await page.waitForFunction(({ route }) => (
    Object.entries(window.__FND_PERF__.snapshot().activeResources || {})
      .filter(([key]) => key.startsWith(`${route}::`))
      .filter(([key]) => !key.startsWith(`${route}::timeout`))
      .reduce((total, [, value]) => total + Number(value || 0), 0) === 0
  ), { route: measuredRoute }, { polling: 100, timeout: 15_000 });
  const cleanup = await page.evaluate(() => window.__FND_PERF__.snapshot());
  expect(countRouteResources(cleanup.activeResources, measuredRoute)).toBe(0);
  expect(Number(cleanup.media?.activeSources || 0)).toBe(0);
  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toHaveLength(0);
  expect(diagnostics.unhandledErrors, diagnostics.unhandledErrors.join('\n')).toHaveLength(0);
  expect(diagnostics.failedRequests, JSON.stringify(diagnostics.failedRequests)).toHaveLength(0);
  await drainPageConnections(page).catch(() => {});
  await context.close();
  return cleanup;
};

const captureAndCleanup = async (session, measuredRoute) => {
  await flushBrowserObservers(session.page);
  await waitForFiniteAssets(session.pageAssets, `${measuredRoute} before capture`);
  const capture = await captureBrowserMetrics(session.page, session.diagnostics);
  session.diagnosticControl.setLifecyclePhase('route-cleanup');
  await navigateToCleanup(session.page);
  const cleanup = await assertCleanSession(session, measuredRoute);
  return {
    capture,
    cleanup,
    events: cleanup.events || capture.snapshot.events,
  };
};

const routeImageResponseCount = (capture) => capture.diagnostics.networkRecords
  .filter(({ resourceType }) => resourceType === 'image').length;

const recordScenario = (scenarioId, result) => {
  const report = readTask08Report(BASELINE_RESULT_PATH);
  if (process.env.FND_TASK08_RUN_ID !== report.runId) {
    throw new Error(
      'Task 08 browser scenarios must run through npm.cmd run perf:task08; '
      + 'the active run identity is missing or stale.'
    );
  }
  return recordTask08Scenario({
    reportPath: BASELINE_RESULT_PATH,
    runId: report.runId,
    identity: report.identity,
    scenarioId,
    result,
  });
};

const assertActiveBrowserIdentity = async (browser) => {
  const report = readTask08Report(BASELINE_RESULT_PATH);
  const expected = report.identity?.browser?.version;
  if (!expected || expected === 'unknown') return;
  expect(browser.version()).toBe(expected);
};

test('Task 08 Login baseline records sign-in and account-creation paths', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  await assertActiveBrowserIdentity(browser);
  await removeCreatedAccount();
  const captures = [];
  let signInSession;
  let createSession;
  try {
    signInSession = await openSession({
      browser,
      baseURL,
      scenario: { id: 'task08-login-sign-in', route: '/', role: 'anonymous' },
      storageState: undefined,
    });
    await openRoute(signInSession, '/');
    await waitForTask08Bridge(signInSession.page);
    await signInSession.page.getByPlaceholder('Email address').fill('perf-player@example.test');
    await signInSession.page.getByPlaceholder('Password').fill(CREATE_ACCOUNT_PASSWORD);
    await signInSession.page.locator('form button[type="submit"]').click();
    await expect(signInSession.page).toHaveURL(/\/home$/, { timeout: 45_000 });
    await waitForReadiness(signInSession.page, { expectedPathname: HOME_ROUTE, timeoutMs: 45_000 });
    captures.push({
      ...(await captureAndCleanup(signInSession, HOME_ROUTE)),
      page: signInSession,
    });
    signInSession = null;

    createSession = await openSession({
      browser,
      baseURL,
      scenario: { id: 'task08-login-create-account', route: '/', role: 'anonymous' },
      storageState: undefined,
    });
    await openRoute(createSession, '/');
    await waitForTask08Bridge(createSession.page);
    await createSession.page.getByPlaceholder('Email address').fill(CREATE_ACCOUNT_EMAIL);
    await createSession.page.getByPlaceholder('Password').fill(CREATE_ACCOUNT_PASSWORD);
    await createSession.page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(createSession.page).toHaveURL(/\/character-creation$/, { timeout: 45_000 });
    await waitForReadiness(createSession.page, {
      expectedPathname: CHARACTER_CREATION_ROUTE,
      timeoutMs: 45_000,
    });
    captures.push({
      ...(await captureAndCleanup(createSession, CHARACTER_CREATION_ROUTE)),
      page: createSession,
    });
    createSession = null;
  } finally {
    if (signInSession) {
      await drainPageConnections(signInSession.page).catch(() => {});
      await signInSession.context.close().catch(() => {});
    }
    if (createSession) {
      await drainPageConnections(createSession.page).catch(() => {});
      await createSession.context.close().catch(() => {});
    }
    await removeCreatedAccount();
  }

  const events = captures.flatMap(({ events: sessionEvents }) => sessionEvents);
  const metrics = deriveTask08Metrics({ scenarioId: 'task08-login', events });
  recordScenario('task08-login', {
    observed: metrics,
    sessions: captures.map(({ capture }) => ({
      eventCount: capture.snapshot.events.length,
      routeImageResponseCount: routeImageResponseCount(capture),
    })),
    task08EventCount: events.filter((event) => event.category === 'task08').length,
    manualObservation: 'No staging observation; local emulator only.',
  });
});

test('Task 08 Character Creation baseline records reads, revisits, writes, and avatar cleanup', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  await assertActiveBrowserIdentity(browser);
  const session = await openSession({
    browser,
    baseURL,
    scenario: { id: 'task08-character-creation', route: CHARACTER_CREATION_ROUTE, role: 'new-player' },
    storageState: storageStateForRole('new-player'),
  });
  try {
    await openRoute(session, CHARACTER_CREATION_ROUTE);
    await waitForTask08Bridge(session.page);
    await session.page.getByRole('heading', { name: 'Evocazione Permanente', exact: true }).click();
    await session.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(session.page.getByText('Select Your Anima Shard', { exact: true })).toBeVisible();
    await session.page.getByRole('heading', { name: 'Spirito', exact: true }).click();
    await session.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(session.page.getByText('Points Distribution', { exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(session.page.getByText('Select Your Anima Shard', { exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(session.page.getByText('Points Distribution', { exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(session.page.locator('#characterImage')).toBeVisible();
    await session.page.locator('#characterImage').setInputFiles({
      name: 'task08-avatar.png',
      mimeType: 'image/png',
      buffer: buildDeterministicPng({ width: 32, height: 32, seed: 808 }),
    });
    await expect(session.page.getByAltText('Preview')).toBeVisible();
    const result = await captureAndCleanup(session, CHARACTER_CREATION_ROUTE);
    const metrics = deriveTask08Metrics({
      scenarioId: 'task08-character-creation',
      events: result.events,
    });
    recordScenario('task08-character-creation', {
      observed: metrics,
      task08EventCount: result.events.filter((event) => event.category === 'task08').length,
      manualObservation: 'No staging observation; local emulator only.',
    });
  } finally {
    if (!session.page.isClosed()) {
      await drainPageConnections(session.page).catch(() => {});
      await session.context.close().catch(() => {});
    }
  }
});

test('Task 08 Home baseline records 500-item behavior and current resource/consumable cost', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  await assertActiveBrowserIdentity(browser);
  await restorePlayerResource();
  await restoreConsumable();
  const session = await openSession({
    browser,
    baseURL,
    scenario: { id: 'task08-home', route: HOME_ROUTE, role: 'player' },
    storageState: storageStateForRole('player'),
  });
  try {
    await openRoute(session, HOME_ROUTE);
    await waitForTask08Bridge(session.page);
    await session.page.getByRole('button', { name: 'Expand Parametri Speciali' }).click();
    await expect(session.page.getByText('45/50', { exact: true })).toBeVisible();
    const hpButton = session.page.getByTitle('-1 HP');
    const holdWindow = await session.page.evaluate(({ bridgeName }) => {
      const snapshot = window.__FND_PERF__.snapshot();
      const holdId = window[bridgeName].beginResourceHold('home-hp-hold-1');
      return {
        holdId,
        startEventIndex: snapshot.events.length,
      };
    }, { bridgeName: PERF_BRIDGE });
    await hpButton.hover();
    await session.page.mouse.down();
    await session.page.waitForTimeout(2_000);
    await session.page.mouse.up();
    const endEventIndex = await session.page.evaluate(({ bridgeName, holdId }) => {
      if (!window[bridgeName].endResourceHold(holdId)) {
        throw new Error(`Task 08 resource hold ${holdId} could not be closed.`);
      }
      return window.__FND_PERF__.snapshot().events.length;
    }, { bridgeName: PERF_BRIDGE, holdId: holdWindow.holdId });
    const { db } = getAdminClients();
    const settledResource = await settleTask08ResourceHold({
      holdId: holdWindow.holdId,
      startEventIndex: holdWindow.startEventIndex,
      endEventIndex,
      expectedBaseValue: Number(playerResourceFixture.data.stats.hpCurrent),
      requireAppliedForEveryStart: true,
      maxPolls: 120,
      readSnapshot: () => session.page.evaluate(() => window.__FND_PERF__.snapshot()),
      readAuthoritativeValue: async () => {
        const snapshot = await db.doc(playerResourceFixture.path).get();
        return snapshot.get('stats.hpCurrent');
      },
      waitForNextPoll: () => session.page.waitForTimeout(100),
    });
    expect(settledResource.failureSequences).toHaveLength(0);
    expect(settledResource.appliedDelta).toBeLessThan(0);
    expect(
      settledResource.authoritativeValue - Number(playerResourceFixture.data.stats.hpCurrent)
    ).toBe(settledResource.appliedDelta);
    const resourceResultingDelta = settledResource.authoritativeValue
      - Number(playerResourceFixture.data.stats.hpCurrent);
    const search = session.page.getByPlaceholder(/Cerca nome o tipo/);
    await search.fill('Fixture item 315');
    await expect(session.page.getByText('Fixture item 315', { exact: false }).first()).toBeVisible();
    const bridgeResult = await session.page.evaluate(async ({ bridgeName, inventoryId }) => {
      const bridge = window[bridgeName];
      const preparation = await bridge.prepareConsumable({
        inventoryId,
        resource: null,
        retryKey: 'task08-home-consumable-prepare',
      });
      const committed = await bridge.commitConsumable({
        preparationId: preparation.preparationId,
        retryKey: 'task08-home-consumable-commit',
      });
      return { preparation, committed };
    }, { bridgeName: PERF_BRIDGE, inventoryId: TASK08_CONSUMABLE_INVENTORY_ID });
    const consumed = !(await db.doc(consumableFixture.path).get()).exists;
    const result = await captureAndCleanup(session, HOME_ROUTE);
    await restorePlayerResource();
    await restoreConsumable();
    const metrics = deriveTask08Metrics({
      scenarioId: 'task08-home',
      events: result.events,
      observations: {
        resourceResultingDelta,
        inventoryMediaRequestCount: null,
        consumableAtomicOutcome: consumed && bridgeResult.committed?.success !== false
          ? 'committed'
          : 'not-committed',
      },
    });
    recordScenario('task08-home', {
      observed: metrics,
      inventory: {
        fixtureItemCount: 500,
        filter: 'Fixture item 315',
        mediaRequestCount: null,
        routeImageResponseCount: routeImageResponseCount(result.capture),
      },
      task08EventCount: result.events.filter((event) => event.category === 'task08').length,
      manualObservation: 'No staging observation; local emulator only.',
    });
  } finally {
    await restorePlayerResource();
    await restoreConsumable();
    if (!session.page.isClosed()) {
      await drainPageConnections(session.page).catch(() => {});
      await session.context.close().catch(() => {});
    }
  }
});

test('Task 08 two-client baseline records concurrent resource and consumable convergence', async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  await assertActiveBrowserIdentity(browser);
  await restorePlayerResource();
  await restoreConsumable();
  const scenario = { id: 'task08-two-client', route: HOME_ROUTE, role: 'player' };
  const clientA = await openSession({
    browser,
    baseURL,
    scenario: { ...scenario, id: 'task08-two-client-a' },
    storageState: storageStateForRole('player'),
  });
  const clientB = await openSession({
    browser,
    baseURL,
    scenario: { ...scenario, id: 'task08-two-client-b' },
    storageState: storageStateForRole('player'),
  });
  try {
    await Promise.all([
      openRoute(clientA, HOME_ROUTE),
      openRoute(clientB, HOME_ROUTE),
    ]);
    await Promise.all([
      waitForTask08Bridge(clientA.page),
      waitForTask08Bridge(clientB.page),
    ]);
    await expect(clientA.page.getByText('45/50', { exact: true })).toBeVisible();
    await expect(clientB.page.getByText('45/50', { exact: true })).toBeVisible();
    await expect(clientB.page.getByText('Fixture item 315', { exact: false }).first()).toBeVisible();
    await Promise.all([
      clientA.page.evaluate(({ bridgeName }) => window[bridgeName].resourceMutation({
        resource: 'hp', mode: 'delta', value: -1, retryKey: 'task08-two-client-resource-a',
      }), { bridgeName: PERF_BRIDGE }),
      clientB.page.evaluate(({ bridgeName }) => window[bridgeName].resourceMutation({
        resource: 'hp', mode: 'delta', value: -1, retryKey: 'task08-two-client-resource-b',
      }), { bridgeName: PERF_BRIDGE }),
    ]);
    await expect.poll(async () => (
      (await clientA.page.locator('body').innerText()).includes('43/50')
      && (await clientB.page.locator('body').innerText()).includes('43/50')
    ), { timeout: 30_000 }).toBe(true);
    const preparation = await clientA.page.evaluate(async ({ bridgeName, inventoryId }) => (
      window[bridgeName].prepareConsumable({
        inventoryId,
        resource: null,
        retryKey: 'task08-two-client-consumable-prepare',
      })
    ), { bridgeName: PERF_BRIDGE, inventoryId: TASK08_CONSUMABLE_INVENTORY_ID });
    await clientA.page.evaluate(async ({ bridgeName, preparationId }) => (
      window[bridgeName].commitConsumable({
        preparationId,
        retryKey: 'task08-two-client-consumable-commit',
      })
    ), { bridgeName: PERF_BRIDGE, preparationId: preparation.preparationId });
    await expect.poll(async () => (
      !(await clientA.page.locator('body').innerText()).includes('Fixture item 315')
      && !(await clientB.page.locator('body').innerText()).includes('Fixture item 315')
    ), { timeout: 30_000 }).toBe(true);
    const { db } = getAdminClients();
    const resourceSnapshot = await db.doc(playerResourceFixture.path).get();
    const itemSnapshot = await db.doc(consumableFixture.path).get();
    const [captureA, captureB] = await Promise.all([
      captureAndCleanup(clientA, HOME_ROUTE),
      captureAndCleanup(clientB, HOME_ROUTE),
    ]);
    const events = [...captureA.events, ...captureB.events];
    const metrics = deriveTask08Metrics({
      scenarioId: 'task08-two-client',
      events,
      observations: {
        resourceCommandCount: 2,
        resourceFinalValue: resourceSnapshot.get('stats.hpCurrent'),
        resourceVisibleOnClientA: true,
        resourceVisibleOnClientB: true,
        consumablePrepareCount: 1,
        consumableCommitCount: 1,
        consumableVisibleOnClientA: false,
        consumableVisibleOnClientB: false,
        consumableAtomicOutcome: itemSnapshot.exists ? 'not-committed' : 'committed',
      },
    });
    recordScenario('task08-two-client', {
      observed: metrics,
      clients: {
        labels: [TASK08_TWO_CLIENT_SESSION.clientA.label, TASK08_TWO_CLIENT_SESSION.clientB.label],
        sameFixtureSession: TASK08_TWO_CLIENT_SESSION.clientA.uid === TASK08_TWO_CLIENT_SESSION.clientB.uid,
        resourceFinalValue: resourceSnapshot.get('stats.hpCurrent'),
        consumableFinalState: itemSnapshot.exists ? 'present' : 'absent',
      },
      task08EventCount: events.filter((event) => event.category === 'task08').length,
      manualObservation: 'No staging observation; local emulator only.',
    });
  } finally {
    await restorePlayerResource();
    await restoreConsumable();
    for (const session of [clientA, clientB]) {
      if (!session.page.isClosed()) {
        await drainPageConnections(session.page).catch(() => {});
        await session.context.close().catch(() => {});
      }
    }
  }
});

test.afterAll(async () => {
  if (adminApp) {
    const { deleteApp } = require('firebase-admin/app');
    await deleteApp(adminApp);
    adminApp = null;
  }
});
