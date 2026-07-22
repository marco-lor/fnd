const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');
const {
  PERFORMANCE_PROJECT_ID,
  resultsDir,
  writeJson,
} = require('../../../scripts/performance/common');

const MARKER = '__FND_FIRESTORE_PERSISTENCE_EXPERIMENT__';
const ROUTE = '/__fnd_perf_firestore_persistence__';
const REPORT_PATH = path.join(resultsDir, 'firestore-persistence-experiment.json');

test.setTimeout(300_000);

const callBridge = (page, method, argument) => page.evaluate(async ({ marker, methodName, value }) => {
  const bridge = window[marker];
  if (!bridge) throw new Error('Persistence experiment bridge is unavailable.');
  return bridge[methodName](value);
}, { marker: MARKER, methodName: method, value: argument });

const openExperiment = async (page) => {
  await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('firestore-persistence-status')).toHaveText('ready');
  return page.evaluate((marker) => {
    const bridge = window[marker];
    return {
      marker: bridge?.marker,
      projectId: bridge?.projectId,
      cacheSizeBytes: bridge?.cacheSizeBytes,
      normalApplicationPersistence: bridge?.persistenceEnabledForNormalApplication,
    };
  }, MARKER);
};

const waitForListener = async (page, listenerId, predicate) => {
  await expect.poll(async () => predicate(
    await callBridge(page, 'getListenerState', listenerId)
  ), {
    timeout: 15_000,
  }).toBe(true);
  return callBridge(page, 'getListenerState', listenerId);
};

test('isolated persistent-cache decision experiment', async ({ page, context }) => {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectId: PERFORMANCE_PROJECT_ID,
    route: ROUTE,
    marker: MARKER,
    cache: { minimumBytes: 1024 * 1024 },
    cases: [],
    decision: {
      persistentCacheEnabled: false,
      scope: 'Task 04 leaves normal application persistence disabled regardless of observations.',
    },
  };
  const addCase = (id, observations) => report.cases.push({ id, status: 'exercised', observations });
  let pageB;
  let cleanupPage;
  let adminApp;
  let probeReference;
  let originalProbe;

  try {
    const firstTab = await openExperiment(page);
    expect(firstTab).toEqual({
      marker: MARKER,
      projectId: PERFORMANCE_PROJECT_ID,
      cacheSizeBytes: 1024 * 1024,
      normalApplicationPersistence: false,
    });

    await callBridge(page, 'signIn', 'perf-dm');
    const privilegedUsers = await callBridge(page, 'readQuery', {
      collectionName: 'users', maxDocuments: 1000,
    });
    await callBridge(page, 'signIn', 'perf-player');
    await callBridge(page, 'setNetwork', false);
    let switchedAccountCacheRead;
    try {
      switchedAccountCacheRead = await callBridge(page, 'readQuery', {
        collectionName: 'users', maxDocuments: 1000, source: 'cache',
      });
    } catch (error) {
      switchedAccountCacheRead = { error: error.message };
    }
    addCase('account-switch-isolation', {
      privilegedDocumentCount: privilegedUsers.count,
      priorPrivilegedQueryReadableFromPlayerCache: Number.isInteger(switchedAccountCacheRead.count),
      cachedDocumentCountAfterSwitch: switchedAccountCacheRead.count || 0,
    });
    await callBridge(page, 'setNetwork', true);
    await callBridge(page, 'signIn', 'perf-dm');

    pageB = await context.newPage();
    const secondTab = await openExperiment(pageB);
    await callBridge(pageB, 'signIn', 'perf-dm');
    addCase('two-tab-ownership', {
      bothTabsInitialized: firstTab.projectId === secondTab.projectId,
      tabManager: 'persistentMultipleTabManager',
    });

    await callBridge(page, 'startDocumentListener', {
      listenerId: 'offline-tab', documentPath: 'users/perf-dm',
    });
    await callBridge(pageB, 'startDocumentListener', {
      listenerId: 'online-tab', documentPath: 'users/perf-dm',
    });
    await waitForListener(page, 'offline-tab', (state) => state?.revision >= 1);
    await waitForListener(pageB, 'online-tab', (state) => state?.revision >= 1);

    adminApp = initializeApp({ projectId: PERFORMANCE_PROJECT_ID }, `persistence-experiment-${Date.now()}`);
    const adminDb = getFirestore(adminApp);
    probeReference = adminDb.doc('users/perf-dm');
    const originalSnapshot = await probeReference.get();
    originalProbe = originalSnapshot.data()?.persistenceExperimentProbe;
    const convergenceToken = `probe-${Date.now()}`;

    await callBridge(page, 'setNetwork', false);
    await probeReference.set({ persistenceExperimentProbe: convergenceToken }, { merge: true });
    await waitForListener(
      pageB,
      'online-tab',
      (state) => state?.data?.persistenceExperimentProbe === convergenceToken
    );
    const staleState = await callBridge(page, 'getListenerState', 'offline-tab');
    addCase('offline-stale-read', {
      offlineSnapshotFromCache: staleState?.fromCache === true,
      offlineTabObservedNewValueBeforeReconnect:
        staleState?.data?.persistenceExperimentProbe === convergenceToken,
    });

    await callBridge(page, 'setNetwork', true);
    const converged = await waitForListener(
      page,
      'offline-tab',
      (state) => state?.data?.persistenceExperimentProbe === convergenceToken
    );
    addCase('reconnect-convergence', {
      converged: converged?.data?.persistenceExperimentProbe === convergenceToken,
      finalSnapshotFromCache: converged?.fromCache === true,
    });

    const cacheLoads = [];
    for (const request of [
      { collectionName: 'users', maxDocuments: 1000 },
      { collectionName: 'items', maxDocuments: 2000 },
      { collectionName: 'foes', maxDocuments: 1000 },
      { collectionName: 'echi_npcs', maxDocuments: 1000 },
      { collectionName: 'user_directory', role: 'player', maxDocuments: 200 },
    ]) {
      cacheLoads.push(await callBridge(page, 'readQuery', request));
    }
    const loadedEstimatedBytes = cacheLoads.reduce((sum, result) => sum + result.estimatedBytes, 0);
    await callBridge(page, 'setNetwork', false);
    let earliestQueryStillCached = false;
    try {
      const cacheReplay = await callBridge(page, 'readQuery', {
        collectionName: 'users', maxDocuments: 1000, source: 'cache',
      });
      earliestQueryStillCached = cacheReplay.count > 0;
    } catch (_error) {
      earliestQueryStillCached = false;
    }
    await callBridge(page, 'setNetwork', true);
    addCase('minimum-cache-eviction', {
      configuredCacheBytes: firstTab.cacheSizeBytes,
      loadedEstimatedBytes,
      exceededConfiguredMinimum: loadedEstimatedBytes > firstTab.cacheSizeBytes,
      earliestQueryStillCached,
    });

    const [firstCleanup, secondCleanup] = await Promise.all([
      callBridge(page, 'cleanup', { clearPersistence: true }),
      callBridge(pageB, 'cleanup', { clearPersistence: true }),
    ]);
    cleanupPage = await context.newPage();
    await openExperiment(cleanupPage);
    const finalCleanup = await callBridge(cleanupPage, 'cleanup', { clearPersistence: true });
    addCase('terminate-clear-cleanup', {
      firstTabTerminated: firstCleanup.terminated === true,
      clearWhileSecondTabOwnedSucceeded: firstCleanup.cleared === true,
      secondTabTerminated: secondCleanup.terminated === true,
      finalClearSucceeded: finalCleanup.cleared === true,
      finalClearErrorCode: finalCleanup.clearError?.code || null,
    });

    expect(report.cases.map(({ id }) => id)).toEqual([
      'account-switch-isolation',
      'two-tab-ownership',
      'offline-stale-read',
      'reconnect-convergence',
      'minimum-cache-eviction',
      'terminate-clear-cleanup',
    ]);
    expect(report.decision.persistentCacheEnabled).toBe(false);
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    if (probeReference) {
      await probeReference.set({
        persistenceExperimentProbe: originalProbe === undefined ? FieldValue.delete() : originalProbe,
      }, { merge: true }).catch(() => {});
    }
    if (adminApp) await deleteApp(adminApp).catch(() => {});
    for (const candidate of [page, pageB, cleanupPage]) {
      if (!candidate || candidate.isClosed()) continue;
      await callBridge(candidate, 'cleanup', { clearPersistence: true }).catch(() => {});
    }
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeJson(REPORT_PATH, report);
  }
});
