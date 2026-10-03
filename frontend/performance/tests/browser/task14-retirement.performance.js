const { test, expect } = require('./measured-test');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { isDeepStrictEqual } = require('node:util');
const manifest = require('../../scenarios.json');
const { assertPerformanceProject, configureOwnedPerformanceEnvironment, projectId } = require('../../../scripts/performance/common');
const {
  drainPageConnections, installBootstrap, installDeterministicFontRoutes,
  isExpectedDemoRecaptchaReportOnlyWarning, navigateToCleanup,
  storageStateForRole, waitForReadiness, writeScenarioResult,
} = require('./helpers');
const { classifyRetirementRequest, summarizeEncounterHistory, summarizeRetirementActivity } = require('./task14-retirement');

const openOwnedDatabase = () => {
  configureOwnedPerformanceEnvironment();
  assertPerformanceProject(projectId);
  const app = initializeApp({ projectId }, `task14-${Date.now()}`);
  return { app, db: getFirestore(app) };
};

const readHistory = async db => {
  const snapshots = await Promise.all([
    db.collection('encounters').get(), db.collectionGroup('participants').get(), db.collectionGroup('logs').get(),
  ]);
  return summarizeEncounterHistory(snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ path: doc.ref.path, data: doc.data() }))));
};

const finishOwnedCleanup = async (actions, primaryError) => {
  const errors = [];
  for (const action of actions) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(
    [...(primaryError ? [primaryError] : []), ...errors], 'Task 14 owned cleanup or fixture restoration failed.'
  );
};

const instrumentPage = page => {
  const diagnostics = { requests: [], consoleErrors: [], unhandledErrors: [] };
  page.on('request', request => diagnostics.requests.push(classifyRetirementRequest(request)));
  page.on('console', message => {
    if (message.type() === 'error' && !isExpectedDemoRecaptchaReportOnlyWarning(message.text(), { baseURL: 'http://127.0.0.1:5000' })) diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => diagnostics.unhandledErrors.push(error.message));
  return diagnostics;
};

const assertActivity = async (page, diagnostics) => {
  const snapshot = await page.evaluate(() => window.__FND_PERF__.snapshot());
  const activity = summarizeRetirementActivity(snapshot, diagnostics.requests);
  Object.entries(activity).forEach(([key, count]) => expect(count, key).toBe(0));
  expect(diagnostics.consoleErrors, diagnostics.consoleErrors.join('\n')).toEqual([]);
  expect(diagnostics.unhandledErrors).toEqual([]);
  await expect(page.locator('a[href="/combat"]')).toHaveCount(0);
  await expect(page.getByTestId('lazy-route-fallback')).toHaveCount(0);
  return { snapshot, activity };
};

const writeResult = (scenario, testInfo, browser, capture, diagnostics, extra = {}) => writeScenarioResult(scenario, 1, {
  environment: { projectName: testInfo.project.name, browserName: 'chromium', browserVersion: browser.version() },
  readiness: { 'shell-visible': true, 'data-ready': true, interactive: true },
  eventCount: capture.snapshot.events.length,
  metrics: {
    'task14.encounterListenerOpens': capture.activity.encounterListenerOpens,
    'task14.encounterWriteAttempts': capture.activity.encounterWriteAttempts,
    'task14.encounterRequests': capture.activity.encounterRequests,
    'task14.combatChunkRequests': capture.activity.combatChunkRequests,
    'runtime.consoleErrors': diagnostics.consoleErrors.length,
    'runtime.unhandledErrors': diagnostics.unhandledErrors.length,
    ...extra.metrics,
  },
  diagnostics: { ...extra, activity: capture.activity },
});

for (const role of ['dm', 'anonymous']) {
  const scenario = manifest.scenarios.find(row => row.id === `task14-retired-${role}`);
  test(`${scenario.id}: direct, reload and warm return replace the retired route`, async ({ browser, baseURL }, testInfo) => {
    const { app, db } = openOwnedDatabase();
    const before = await readHistory(db);
    expect([before.encounters, before.participants, before.logs]).toEqual([100, 436, 1000]);
    const context = await browser.newContext({ baseURL, storageState: storageStateForRole(role) });
    await installDeterministicFontRoutes(context);
    await installBootstrap(context, scenario, 1);
    const page = await context.newPage();
    const diagnostics = instrumentPage(page);
    const destination = role === 'anonymous' ? '/' : '/home';
    let primaryError;
    try {
      await page.goto('/combat', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(`${baseURL}${destination}`);
      await waitForReadiness(page, { expectedPathname: destination, timeoutMs: 30000 });
      await assertActivity(page, diagnostics);
      await page.evaluate(() => window.history.replaceState({}, '', '/combat'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(`${baseURL}${destination}`);
      await waitForReadiness(page, { expectedPathname: destination, timeoutMs: 30000 });
      await assertActivity(page, diagnostics);
      await navigateToCleanup(page);
      await page.evaluate(() => {
        window.history.pushState({}, '', '/combat');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page).toHaveURL(`${baseURL}${destination}`);
      await waitForReadiness(page, { expectedPathname: destination, timeoutMs: 30000 });
      const capture = await assertActivity(page, diagnostics);
      if (role === 'dm') {
        await page.goBack();
        await expect(page).toHaveURL(`${baseURL}/__fnd_perf_cleanup__`);
      } else await navigateToCleanup(page);
      await assertActivity(page, diagnostics);
      const after = await readHistory(db);
      expect(after).toEqual(before);
      writeResult(scenario, testInfo, browser, capture, diagnostics, { history: after, journeys: ['direct', 'reload', 'warm-return', 'leave'] });
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      await finishOwnedCleanup([() => drainPageConnections(page), () => context.close(), () => deleteApp(app)], primaryError);
    }
  });
}

test('task14-grigliata-turns: next, wrap, join and leave preserve encounter history', async ({ browser, baseURL }, testInfo) => {
  const scenario = manifest.scenarios.find(row => row.id === 'task14-grigliata-turns');
  const { app, db } = openOwnedDatabase();
  const background = db.doc('grigliata_backgrounds/perf-map');
  const placements = [0, 1, 2].map(index => db.doc(`grigliata_token_placements/perf-map__perf-token-000${index}`));
  const owned = [background, ...placements];
  const original = await Promise.all(owned.map(async ref => ({ ref, data: (await ref.get()).data() })));
  const before = await readHistory(db);
  let context;
  let page;
  let primaryError;
  try {
    const batch = db.batch();
    batch.update(background, { turnOrderActive: FieldValue.delete() });
    placements.forEach((ref, index) => batch.update(ref, {
      // Keep the three interactive tokens clear of the floating board tools.
      col: 45 + index, row: 45,
      isInTurnOrder: index < 2, turnOrderInitiative: index === 0 ? 20 : 10,
      turnOrderJoinedAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')), turnCounter: 0, turnEffects: FieldValue.delete(),
    }));
    await batch.commit();
    context = await browser.newContext({ baseURL, storageState: storageStateForRole('dm') });
    await installDeterministicFontRoutes(context);
    await installBootstrap(context, scenario, 1);
    page = await context.newPage();
    const diagnostics = instrumentPage(page);
    await page.goto('/grigliata', { waitUntil: 'domcontentloaded' });
    await waitForReadiness(page, { timeoutMs: 30000 });
    const expectActive = async (index, counter) => {
      const tokenId = `perf-token-000${index}`;
      await expect(page.getByTestId(`turn-order-entry-${tokenId}`)).toHaveAttribute('data-active-turn', 'true');
      await expect.poll(async () => (await background.get()).data()?.turnOrderActive?.tokenId).toBe(tokenId);
      expect((await placements[index].get()).data().turnCounter).toBe(counter);
    };
    await page.getByRole('button', { name: 'Start turn order', exact: true }).click();
    await expectActive(0, 1);
    await page.getByRole('button', { name: 'Advance turn order', exact: true }).click();
    await expectActive(1, 1);
    await page.getByRole('button', { name: 'Advance turn order', exact: true }).click();
    await expectActive(0, 2);

    // Use the rendered Konva node to find its canvas position, then dispatch an
    // actual browser right click and complete the normal initiative dialog.
    const openTokenMenu = async () => {
      const point = await page.evaluate(() => {
        const node = window.Konva.stages.flatMap(stage => Array.from(stage.find(item => item.getAttr?.('data-testid') === 'token-node-perf-token-0002')))[0];
        if (!node) return null;
        const rect = node.getClientRect();
        const container = node.getStage().container().getBoundingClientRect();
        return { x: container.left + rect.x + rect.width / 2, y: container.top + rect.y + rect.height / 2 };
      });
      expect(point).not.toBeNull();
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByTestId('turn-order-context-action-perf-token-0002').click();
    };
    await openTokenMenu();
    await page.getByTestId('turn-order-join-initiative-input').fill('5');
    await page.getByTestId('turn-order-join-confirm').click();
    await expect(page.getByTestId('turn-order-entry-perf-token-0002')).toBeVisible();
    expect((await placements[2].get()).data()).toMatchObject({ isInTurnOrder: true, turnOrderInitiative: 5 });
    await openTokenMenu();
    await expect(page.getByTestId('turn-order-entry-perf-token-0002')).toHaveCount(0);
    await expect.poll(async () => (await placements[2].get()).data().isInTurnOrder).toBeUndefined();
    expect((await placements[2].get()).data().turnOrderInitiative).toBeUndefined();
    await expectActive(0, 2);
    const capture = await assertActivity(page, diagnostics);
    await navigateToCleanup(page);
    await page.waitForFunction(() => Object.entries(window.__FND_PERF__.snapshot().activeListeners || {}).filter(([key]) => key.startsWith('/grigliata::')).every(([, count]) => count === 0));
    await assertActivity(page, diagnostics);
    expect(await readHistory(db)).toEqual(before);
    writeResult(scenario, testInfo, browser, capture, diagnostics, {
      history: before, metrics: { 'task14.turnTransitions': 3, 'task14.joinedParticipants': 1, 'task14.removedParticipants': 1 },
      turns: ['perf-token-0000:1', 'perf-token-0001:1', 'perf-token-0000:2'],
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await finishOwnedCleanup([
      async () => { if (page) await drainPageConnections(page); },
      async () => { if (context) await context.close(); },
      async () => {
        const restoration = db.batch();
        original.forEach(({ ref, data }) => restoration.set(ref, data));
        await restoration.commit();
        for (const { ref, data } of original) expect(isDeepStrictEqual((await ref.get()).data(), data), `Restoration of ${ref.path}`).toBe(true);
        expect(await readHistory(db)).toEqual(before);
      },
      () => deleteApp(app),
    ], primaryError);
  }
});
