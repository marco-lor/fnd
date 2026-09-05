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
  isExpectedTask08CleanupImageCancellation,
  isKnownDemoFirestoreStartupWarning,
  navigateToCleanup,
  storageStateForRole,
  warmBrowserAssetDelivery,
  waitForReadiness,
} = require('./helpers');

const BASELINE_RESULT_PATH = require('path').join(resultsDir, 'task08-baseline.json');
const CREATE_ACCOUNT_EMAIL = 'task08-created@example.test';
const CREATE_ACCOUNT_PASSWORD = 'PerfTest!123';
const ACCOUNT_CREATED_SUCCESS_MESSAGE = 'Account created successfully! Redirecting to character setup...';
const PERF_BRIDGE = '__FND_PERF_TASK08__';
const HOME_ROUTE = '/home';
const CHARACTER_CREATION_ROUTE = '/character-creation';
const CLEANUP_ROUTE = '/__fnd_perf_cleanup__';
const HOME_INVENTORY_INITIAL_WINDOW = 60;
const HOME_RENDER_COMPONENTS = Object.freeze([
  'Navbar',
  'StatsBars',
  'Inventory',
  'EquippedInventory',
  'Extra',
  'ParamTables',
]);

const fixtureDocuments = buildDocuments();
const fixtureDocument = (documentPath) => {
  const document = fixtureDocuments.find(({ path: candidate }) => candidate === documentPath);
  if (!document) throw new Error(`Task 08 fixture document is missing: ${documentPath}`);
  return document;
};
const playerResourceFixture = fixtureDocument('users/perf-player/state/resources');
const playerEquipmentFixture = fixtureDocument('users/perf-player/state/equipment');
const consumableFixture = fixtureDocument(
  `users/perf-player/inventory/${TASK08_CONSUMABLE_INVENTORY_ID}`
);
const consumableFixtureName = consumableFixture.data.currentSnapshot.General.Nome;

const useFixtureConsumable = async (page) => {
  const fixtureCard = page.locator('div.group').filter({
    has: page.getByText(consumableFixtureName, { exact: true }),
  });
  await fixtureCard.getByTitle('Usa consumabile').click();
};

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
  await Promise.all([
    db.doc(consumableFixture.path).set(consumableFixture.data),
    db.doc(playerEquipmentFixture.path).set(playerEquipmentFixture.data),
  ]);
};

const prepareConsumableUiFixture = async () => {
  const { db } = getAdminClients();
  const inventoryData = { ...consumableFixture.data };
  delete inventoryData.currentHash;
  const currentSnapshot = {
    ...inventoryData.currentSnapshot,
    Specific: {
      ...inventoryData.currentSnapshot.Specific,
      'Bonus Creazione': 0,
      slotCintura: 99,
    },
    Parametri: {
      Special: {
        'Rigenera Dado Anima HP': { 1: 1, 4: 1, 7: 1, 10: 1 },
      },
    },
  };
  await Promise.all([
    db.doc(consumableFixture.path).set({ ...inventoryData, currentSnapshot }),
    db.doc(playerEquipmentFixture.path).set({
      ...playerEquipmentFixture.data,
      slots: { cintura: TASK08_CONSUMABLE_INVENTORY_ID },
      beltCapacity: 99,
    }),
  ]);
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
  explainedCleanupImageCancellations: [],
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
      method: request.method(),
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
    if (isExpectedTask08CleanupImageCancellation({
      ...failure,
      baseURL,
      lifecyclePhase,
      priorNetworkRecords: diagnostics.networkRecords,
      url: request.url(),
    })) {
      diagnostics.explainedCleanupImageCancellations.push({
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
  capture.diagnostics.explainedCleanupImageCancellations = [
    ...session.diagnostics.explainedCleanupImageCancellations,
  ];
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
    await expect(createSession.page.getByRole('status')).toContainText(ACCOUNT_CREATED_SUCCESS_MESSAGE);
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
    await expect(session.page.getByRole('heading', { name: 'Points Distribution', exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(session.page.getByText('Select Your Anima Shard', { exact: true })).toBeVisible();
    await session.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(session.page.getByRole('heading', { name: 'Points Distribution', exact: true })).toBeVisible();
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
  await prepareConsumableUiFixture();
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
    const inventoryRows = session.page.locator('[data-home-inventory-row="true"]');
    await expect.poll(() => inventoryRows.count(), { timeout: 30_000 })
      .toBe(HOME_INVENTORY_INITIAL_WINDOW);
    const inventoryInitialMountedItemCount = await inventoryRows.count();
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
    // One immediate tick plus ten 200ms intervals: retain a small scheduling
    // margin while remaining below the twelfth interval.
    await session.page.waitForTimeout(2_050);
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
    expect(settledResource.terminalCount).toBe(1);
    expect(settledResource.commandCount).toBe(1);
    expect(settledResource.appliedCount).toBe(1);
    expect(settledResource.failureSequences).toHaveLength(0);
    expect(settledResource.pendingSequences).toHaveLength(0);
    expect(settledResource.effectiveDelta).toBe(-11);
    expect(settledResource.requestedDelta).toBe(-11);
    expect(settledResource.appliedDelta).toBe(-11);
    expect(settledResource.authoritativeValueSamples).toEqual([34, 34]);
    expect(settledResource.authoritativeValue).toBe(34);
    const resourceResultingDelta = settledResource.authoritativeValue
      - Number(playerResourceFixture.data.stats.hpCurrent);
    await expect(session.page.getByText(
      `${settledResource.authoritativeValue}/${playerResourceFixture.data.stats.hpTotal}`,
      { exact: true }
    )).toBeVisible({ timeout: 30_000 });
    const resourceRenderCounts = await session.page.evaluate(
      ({ components, startEventIndex }) => {
        const events = window.__FND_PERF__.snapshot().events.slice(startEventIndex);
        return Object.fromEntries(components.map((component) => [
          component,
          events.filter((event) => (
            event.category === 'task08'
            && event.metric === 'render'
            && event.tags?.component === component
            && event.tags?.committed === true
            && event.tags?.authoritative === true
          )).length,
        ]));
      },
      { components: HOME_RENDER_COMPONENTS, startEventIndex: holdWindow.startEventIndex }
    );
    expect(resourceRenderCounts.StatsBars).toBeGreaterThan(0);
    ['Navbar', 'Inventory', 'EquippedInventory', 'Extra', 'ParamTables']
      .forEach((component) => expect(resourceRenderCounts[component]).toBe(0));
    await session.page.getByRole('button', { name: /^Load more inventory items/ }).click();
    await expect.poll(() => inventoryRows.count()).toBe(HOME_INVENTORY_INITIAL_WINDOW * 2);
    await waitForFiniteAssets(
      session.pageAssets,
      'home inventory expanded window before filter'
    );
    const search = session.page.getByPlaceholder(/Cerca nome o tipo/);
    await search.fill('Fixture item 315');
    await expect(session.page.getByText('Fixture item 315', { exact: false }).first()).toBeVisible();
    await expect.poll(() => inventoryRows.count()).toBe(1);
    await search.fill('');
    await expect.poll(() => inventoryRows.count()).toBe(HOME_INVENTORY_INITIAL_WINDOW);
    const inventoryResetMountedItemCount = await inventoryRows.count();
    await session.page.getByRole('button', { name: /^Load more inventory items/ }).click();
    await expect.poll(() => inventoryRows.count()).toBe(HOME_INVENTORY_INITIAL_WINDOW * 2);
    const inventoryExpandedMountedItemCount = await inventoryRows.count();
    await waitForFiniteAssets(
      session.pageAssets,
      'home restored inventory window before consumable'
    );
    await useFixtureConsumable(session.page);
    await session.page.getByRole('button', { name: /Conferma/ }).click();
    await expect(session.page.getByText('Dice:')).toBeVisible();
    const resultText = await session.page.getByText(/^Result = /).textContent({ timeout: 10_000 });
    const preparedGain = Number(String(resultText).replace(/^Result =\s*/, ''));
    expect(Number.isFinite(preparedGain)).toBe(true);
    await session.page.getByRole('button', { name: 'Close' }).click();
    await expect.poll(async () => !(await db.doc(consumableFixture.path).get()).exists, {
      timeout: 30_000,
    }).toBe(true);
    const consumed = !(await db.doc(consumableFixture.path).get()).exists;
    const equipmentAfterConsumption = await db.doc(playerEquipmentFixture.path).get();
    expect(equipmentAfterConsumption.get('slots.cintura')).toBeNull();
    const result = await captureAndCleanup(session, HOME_ROUTE);
    await restorePlayerResource();
    await restoreConsumable();
    const metrics = deriveTask08Metrics({
      scenarioId: 'task08-home',
      events: result.events,
      observations: {
        resourceResultingDelta,
        resourceRenderCounts,
        inventoryInitialMountedItemCount,
        inventoryResetMountedItemCount,
        inventoryExpandedMountedItemCount,
        inventoryInitialWindowLimit: HOME_INVENTORY_INITIAL_WINDOW,
        inventoryMediaRequestCount: null,
        consumableAtomicOutcome: consumed
          ? 'committed'
          : 'not-committed',
      },
    });
    expect(metrics['home.consumable.prepareCount']).toBe(1);
    expect(metrics['home.consumable.commitCount']).toBe(1);
    expect(metrics['home.consumable.actionStartCount']).toBe(1);
    expect(metrics['home.consumable.commitDispatchedCount']).toBe(1);
    expect(metrics['home.consumable.appliedCount']).toBe(1);
    expect(metrics['home.consumable.terminalCount']).toBe(1);
    expect(metrics['home.consumable.cancelledCount']).toBe(0);
    recordScenario('task08-home', {
      observed: metrics,
      inventory: {
        fixtureItemCount: 500,
        initialMountedItemCount: inventoryInitialMountedItemCount,
        resetMountedItemCount: inventoryResetMountedItemCount,
        expandedMountedItemCount: inventoryExpandedMountedItemCount,
        initialWindowLimit: HOME_INVENTORY_INITIAL_WINDOW,
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
  await prepareConsumableUiFixture();
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
    const hpButton = clientA.page.getByTitle('-1 HP');
    const holdWindow = await clientA.page.evaluate(({bridgeName}) => {
      const snapshot = window.__FND_PERF__.snapshot();
      return {
        holdId: window[bridgeName].beginResourceHold('two-client-ui-hold-1'),
        startEventIndex: snapshot.events.length,
      };
    }, {bridgeName: PERF_BRIDGE});
    const clientBResourceStartEventIndex = await clientB.page.evaluate(
      () => window.__FND_PERF__.snapshot().events.length
    );
    await hpButton.hover();
    await clientA.page.mouse.down();
    // Client A is a real pointer-owned UI hold; client B overlaps with one
    // independent, serialized delta mutation against the same resource doc.
    await clientB.page.evaluate(({ bridgeName }) => window[bridgeName].resourceMutation({
      resource: 'hp', mode: 'delta', value: -1, retryKey: 'task08-two-client-resource-b',
    }), { bridgeName: PERF_BRIDGE });
    await clientA.page.waitForTimeout(600);
    await clientA.page.mouse.up();
    const holdEndEventIndex = await clientA.page.evaluate(({bridgeName, holdId}) => {
      if (!window[bridgeName].endResourceHold(holdId)) throw new Error(`Unable to close ${holdId}.`);
      return window.__FND_PERF__.snapshot().events.length;
    }, {bridgeName: PERF_BRIDGE, holdId: holdWindow.holdId});
    const {db} = getAdminClients();
    const settledResource = await settleTask08ResourceHold({
      holdId: holdWindow.holdId,
      startEventIndex: holdWindow.startEventIndex,
      endEventIndex: holdEndEventIndex,
      // Client B's completed overlap contributes this known prior delta.
      expectedBaseValue: Number(playerResourceFixture.data.stats.hpCurrent) - 1,
      requireAppliedForEveryStart: true,
      maxPolls: 120,
      readSnapshot: () => clientA.page.evaluate(() => window.__FND_PERF__.snapshot()),
      readAuthoritativeValue: async () => (await db.doc(playerResourceFixture.path).get()).get('stats.hpCurrent'),
      waitForNextPoll: () => clientA.page.waitForTimeout(100),
    });
    expect(settledResource.terminalCount).toBe(1);
    expect(settledResource.commandCount).toBe(1);
    expect(settledResource.appliedCount).toBe(1);
    expect(settledResource.failureSequences).toHaveLength(0);
    expect(settledResource.pendingSequences).toHaveLength(0);
    const finalResourceValue = settledResource.authoritativeValue;
    await expect.poll(async () => (
      (await clientA.page.locator('body').innerText()).includes(`${finalResourceValue}/50`)
      && (await clientB.page.locator('body').innerText()).includes(`${finalResourceValue}/50`)
    ), { timeout: 30_000 }).toBe(true);
    // Capture the resource-only causal window before the independent
    // consumable command below can legitimately render inventory consumers.
    const resourceEndEventIndexes = await Promise.all([
      clientA.page.evaluate(() => window.__FND_PERF__.snapshot().events.length),
      clientB.page.evaluate(() => window.__FND_PERF__.snapshot().events.length),
    ]);
    await useFixtureConsumable(clientA.page);
    await clientA.page.getByRole('button', { name: /Conferma/ }).click();
    await expect(clientA.page.getByText('Dice:')).toBeVisible();
    const preparedResultText = await clientA.page.getByText(/^Result = /).textContent({
      timeout: 10_000,
    });
    const preparedGain = Number(String(preparedResultText).replace(/^Result =\s*/, ''));
    expect(Number.isFinite(preparedGain)).toBe(true);
    const overlappingResource = await clientB.page.evaluate(({ bridgeName }) => (
      window[bridgeName].resourceMutation({
        resource: 'hp',
        mode: 'delta',
        value: -1,
        retryKey: 'task08-two-client-during-consumable',
      })
    ), { bridgeName: PERF_BRIDGE });
    await clientA.page.getByRole('button', { name: 'Close' }).click();
    await expect.poll(async () => (
      !(await clientA.page.locator('body').innerText()).includes('Fixture item 315')
      && !(await clientB.page.locator('body').innerText()).includes('Fixture item 315')
    ), { timeout: 30_000 }).toBe(true);
    const committedResourceSnapshot = await db.doc(playerResourceFixture.path).get();
    const committedResourceTotal = committedResourceSnapshot.get('stats.hpTotal');
    const expectedConsumableResource = Math.min(
      committedResourceTotal,
      overlappingResource.newValue + preparedGain
    );
    expect(committedResourceSnapshot.get('stats.hpCurrent')).toBe(expectedConsumableResource);
    await expect.poll(async () => (
      (await clientA.page.locator('body').innerText()).includes(`${expectedConsumableResource}/${committedResourceTotal}`)
      && (await clientB.page.locator('body').innerText()).includes(`${expectedConsumableResource}/${committedResourceTotal}`)
    ), { timeout: 30_000 }).toBe(true);
    const resourceRenderCountsByClient = await Promise.all([
      clientA.page.evaluate(({components, startEventIndex, endEventIndex}) => {
        const events = window.__FND_PERF__.snapshot().events.slice(startEventIndex, endEventIndex);
        return Object.fromEntries(components.map((component) => [component, events.filter((event) => (
          event.category === 'task08' && event.metric === 'render'
          && event.tags?.component === component && event.tags?.committed === true
          && event.tags?.authoritative === true
        )).length]));
      }, {components: HOME_RENDER_COMPONENTS, startEventIndex: holdWindow.startEventIndex, endEventIndex: resourceEndEventIndexes[0]}),
      clientB.page.evaluate(({components, startEventIndex, endEventIndex}) => {
        const events = window.__FND_PERF__.snapshot().events.slice(startEventIndex, endEventIndex);
        return Object.fromEntries(components.map((component) => [component, events.filter((event) => (
          event.category === 'task08' && event.metric === 'render'
          && event.tags?.component === component && event.tags?.committed === true
          && event.tags?.authoritative === true
        )).length]));
      }, {components: HOME_RENDER_COMPONENTS, startEventIndex: clientBResourceStartEventIndex, endEventIndex: resourceEndEventIndexes[1]}),
    ]);
    expect(resourceRenderCountsByClient[0].StatsBars).toBeGreaterThan(0);
    expect(resourceRenderCountsByClient[1].StatsBars).toBeGreaterThan(0);
    ['Navbar', 'Inventory', 'EquippedInventory', 'Extra', 'ParamTables'].forEach((component) => {
      expect(resourceRenderCountsByClient[0][component]).toBe(0);
      expect(resourceRenderCountsByClient[1][component]).toBe(0);
    });
    const resourceRenderCounts = Object.fromEntries(HOME_RENDER_COMPONENTS.map((component) => [
      component,
      resourceRenderCountsByClient.reduce((total, counts) => total + Number(counts[component] || 0), 0),
    ]));
    const resourceSnapshot = await db.doc(playerResourceFixture.path).get();
    const itemSnapshot = await db.doc(consumableFixture.path).get();
    const equipmentSnapshot = await db.doc(playerEquipmentFixture.path).get();
    expect(resourceSnapshot.get('stats.hpCurrent')).toBe(expectedConsumableResource);
    expect(itemSnapshot.exists).toBe(false);
    expect(equipmentSnapshot.get('slots.cintura')).toBeNull();
    const [captureA, captureB] = await Promise.all([
      captureAndCleanup(clientA, HOME_ROUTE),
      captureAndCleanup(clientB, HOME_ROUTE),
    ]);
    const events = [...captureA.events, ...captureB.events];
    const resourceEventMatches = (event) => (
      event.category === 'task08'
      && event.tags?.command === 'task05UpdateResource'
    );
    const clientAResourceEvents = captureA.events
      .slice(holdWindow.startEventIndex, resourceEndEventIndexes[0])
      .filter(resourceEventMatches);
    const clientBResourceEvents = captureB.events
      .slice(clientBResourceStartEventIndex, resourceEndEventIndexes[1])
      .filter(resourceEventMatches);
    const countResourceMetric = (resourceEvents, metric) => resourceEvents
      .filter((event) => event.metric === metric).length;
    expect(countResourceMetric(clientAResourceEvents, 'command-start')).toBe(1);
    expect(countResourceMetric(clientAResourceEvents, 'command-success')).toBe(1);
    expect(countResourceMetric(clientAResourceEvents, 'command-applied')).toBe(1);
    expect(countResourceMetric(clientAResourceEvents, 'command-failure')).toBe(0);
    expect(countResourceMetric(clientBResourceEvents, 'command-start')).toBe(1);
    expect(countResourceMetric(clientBResourceEvents, 'command-success')).toBe(1);
    expect(countResourceMetric(clientBResourceEvents, 'command-applied')).toBe(1);
    expect(countResourceMetric(clientBResourceEvents, 'command-failure')).toBe(0);
    const resourceCommandCount = countResourceMetric(clientAResourceEvents, 'command-start')
      + countResourceMetric(clientBResourceEvents, 'command-start');
    const countCommand = (command) => events.filter((event) => (
      event.category === 'task08' && event.metric === 'command-start' && event.tags?.command === command
    )).length;
    const consumablePrepareCount = countCommand('task05PrepareConsumable');
    const consumableCommitCount = countCommand('task05CommitConsumable');
    expect(resourceCommandCount).toBe(2);
    expect(consumablePrepareCount).toBe(1);
    expect(consumableCommitCount).toBe(1);
    const metrics = deriveTask08Metrics({
      scenarioId: 'task08-two-client',
      events,
      observations: {
        resourceCommandCount,
        resourceRenderCounts,
        resourceFinalValue: resourceSnapshot.get('stats.hpCurrent'),
        resourceVisibleOnClientA: true,
        resourceVisibleOnClientB: true,
        consumablePrepareCount,
        consumableCommitCount,
        consumableVisibleOnClientA: false,
        consumableVisibleOnClientB: false,
        consumableAtomicOutcome: itemSnapshot.exists ? 'not-committed' : 'committed',
      },
    });
    expect(metrics['home.consumable.actionStartCount']).toBe(1);
    expect(metrics['home.consumable.commitDispatchedCount']).toBe(1);
    expect(metrics['home.consumable.appliedCount']).toBe(1);
    expect(metrics['home.consumable.terminalCount']).toBe(1);
    expect(metrics['home.consumable.cancelledCount']).toBe(0);
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
