const { performance } = require('node:perf_hooks');
const { test, expect } = require('./measured-test');
const {
  TASK07_SOAK_BACKGROUND_COUNT,
  TASK07_SOAK_TOKEN_COUNT,
  evaluateTask07RegistryPlateau,
  resolveTask07SoakRuntime,
} = require('../../../scripts/performance/task07-soak-contract');
const {
  assertPerformanceProject,
  projectId,
} = require('../../../scripts/performance/common');
const {
  countRouteResources,
  drainPageConnections,
  installBootstrap,
  installDeterministicFontRoutes,
  isExpectedDemoRecaptchaReportOnlyWarning,
  navigateToCleanup,
  storageStateForRole,
  waitForReadiness,
} = require('./helpers');

assertPerformanceProject(projectId);
const soakRuntime = resolveTask07SoakRuntime();
const playerRoutes = [
  { id: 'task07-soak-home', route: '/home' },
  { id: 'task07-soak-bazaar', route: '/bazaar' },
  { id: 'task07-soak-echoes', route: '/echi-di-viaggio' },
];
const galleryFolders = [
  { name: 'Fixture Atlas A' },
  { name: 'Fixture Atlas B' },
];
const backgroundCatalog = Array.from({ length: TASK07_SOAK_BACKGROUND_COUNT }, (_, index) => ({
  folderName: galleryFolders[index < TASK07_SOAK_BACKGROUND_COUNT / 2 ? 0 : 1].name,
  id: index === 0 ? 'perf-map' : `perf-map-${String(index).padStart(3, '0')}`,
  index,
  name: `Performance map ${index + 1}`,
}));
const ACTIVE_BOARD_PIN = 'grigliata-active-board';
const CROSSFADE_PIN = 'grigliata-crossfade';

const navigateWithinApp = async (page, route, firstNavigation) => {
  if (firstNavigation) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    return;
  }
  await page.evaluate((nextRoute) => {
    window.history.pushState({}, '', nextRoute);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
};

const waitForRouteCleanup = async (page, route) => {
  await navigateToCleanup(page);
  const renderScheduler = await page.evaluate(() => new Promise((resolve) => {
    let finished = false;
    let frameCount = 0;
    let frameHandle = null;
    let timeoutId = null;
    const snapshot = (state) => ({
      containerCount: document.querySelectorAll('.konvajs-content').length,
      stageCount: Array.isArray(window.Konva?.stages) ? window.Konva.stages.length : 0,
      state,
    });
    const finish = (state) => {
      if (finished) return;
      finished = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      resolve(snapshot(state));
    };
    const onFrame = () => {
      if (finished) return;
      frameHandle = null;
      frameCount += 1;
      if (frameCount < 2) {
        frameHandle = window.requestAnimationFrame(onFrame);
        return;
      }
      finish('settled');
    };
    timeoutId = window.setTimeout(() => finish('timeout'), 2_000);
    frameHandle = window.requestAnimationFrame(onFrame);
  }));
  if (renderScheduler.state !== 'settled') {
    throw new Error(`Task 07 render scheduler did not settle after leaving ${route}.`);
  }
  expect(renderScheduler).toMatchObject({
    containerCount: 0,
    stageCount: 0,
  });
  let lastCleanup = null;
  try {
    await expect.poll(async () => {
      const cleanup = await page.evaluate(() => window.__FND_PERF__.snapshot());
      const count = countRouteResources(cleanup.activeResources, route, {
        includeTimeouts: true,
      });
      if (count > 0) {
        lastCleanup = cleanup;
      }
      return count;
    }, {
      intervals: [100],
      timeout: 10_000,
    }).toBe(0);
  } catch (error) {
    const cleanup = lastCleanup
      || await page.evaluate(() => window.__FND_PERF__.snapshot());
    const diagnostics = (cleanup.activeResourceDiagnostics || [])
      .filter((resource) => resource.ownerRoute === route)
      .slice(0, 10)
      .map((resource) => ({
        attribution: resource.attribution,
        callback: typeof resource.callback === 'string'
          ? resource.callback.slice(0, 160)
          : undefined,
        delayMs: resource.delayMs,
        ownerRoute: resource.ownerRoute,
        type: resource.type,
      }));
    const activeResources = Object.fromEntries(
      Object.entries(cleanup.activeResources || {})
        .filter(([key]) => key.startsWith(`${route}::`))
    );
    throw new Error(
      `Task 07 route cleanup did not settle for ${route}: ${JSON.stringify({
        activeResources,
        diagnostics,
      })}`,
      { cause: error }
    );
  }
};

const countKonvaTokenNodes = () => {
  const stages = Array.isArray(window.Konva?.stages) ? window.Konva.stages : [];
  return stages.reduce((count, stage) => (
    count + Array.from(stage.find((node) => (
      String(node.getAttr?.('data-testid') || '').startsWith('token-node-')
    ))).length
  ), 0);
};

const readImageRegistry = (page) => page.evaluate(() => (
  window.__FND_PERF_BENCHMARKS__.getImageRegistryStats()
));

const readBattlemapLayerState = (page) => page.evaluate(() => {
  const stages = Array.isArray(window.Konva?.stages) ? window.Konva.stages : [];
  const layers = stages.flatMap((stage) => Array.from(stage.find((node) => (
    ['battlemap-image-active', 'battlemap-image-outgoing'].includes(
      String(node.getAttr?.('data-testid') || '')
    )
  )))).map((node) => ({
    height: Number(node.height?.()),
    opacity: Number(node.opacity?.()),
    role: String(node.getAttr?.('data-testid') || ''),
    width: Number(node.width?.()),
  }));
  return {
    active: layers.filter((layer) => layer.role === 'battlemap-image-active'),
    outgoing: layers.filter((layer) => layer.role === 'battlemap-image-outgoing'),
  };
});

const waitForStableBattlemapLayer = async (page, { backgroundId, stage }) => {
  let lastObservation = null;
  try {
    await expect.poll(async () => {
      lastObservation = await readBattlemapLayerState(page);
      return lastObservation.active.length === 1
        && lastObservation.outgoing.length === 0
        && lastObservation.active[0].height > 0
        && lastObservation.active[0].opacity >= 0.999
        && lastObservation.active[0].width > 0;
    }, {
      intervals: [50, 100],
      timeout: 10_000,
    }).toBe(true);
  } catch (error) {
    throw new Error(
      `Task 07 battlemap layer did not settle for ${backgroundId || 'unknown background'}`
      + ` during ${stage || 'unknown stage'}: ${JSON.stringify(lastObservation)}`,
      { cause: error }
    );
  }
  return lastObservation;
};

const summarizeRegistryLeaseState = (registry) => ({
  activeRequestCount: Number(registry?.activeRequestCount),
  namedPins: Array.isArray(registry?.namedPins) ? registry.namedPins : [],
  pinnedRecordCount: Number(registry?.pinnedRecordCount),
  queuedRequestCount: Number(registry?.queuedRequestCount),
  recordCount: Number(registry?.recordCount),
  referencedRecordCount: Number(registry?.referencedRecordCount),
});

const waitForRegistryLeaseState = async (page, {
  backgroundId,
  crossfade,
  stage,
}) => {
  let observation = null;
  let lastObservation = null;
  try {
    await expect.poll(async () => {
      const registry = await readImageRegistry(page);
      lastObservation = registry;
      const namedPins = Array.isArray(registry.namedPins) ? registry.namedPins : [];
      const matches = namedPins.includes(ACTIVE_BOARD_PIN)
        && (crossfade ? namedPins.includes(CROSSFADE_PIN) : !namedPins.includes(CROSSFADE_PIN))
        && (!crossfade || Number(registry.pinnedRecordCount) >= 2);
      if (matches) observation = registry;
      return matches;
    }, {
      intervals: [50, 100],
      timeout: 10_000,
    }).toBe(true);
  } catch (error) {
    throw new Error(
      `Task 07 registry lease did not settle for ${backgroundId || 'unknown background'}`
      + ` during ${stage || 'unknown stage'}: `
      + JSON.stringify(summarizeRegistryLeaseState(lastObservation)),
      { cause: error }
    );
  }
  return observation;
};

const selectGalleryFolder = async (page, folderName) => {
  const expectedRowIds = backgroundCatalog
    .filter((background) => background.folderName === folderName)
    .map((background) => `background-gallery-row-${background.id}`)
    .sort();
  await page.getByRole('button', { name: 'Filter DM Gallery by folder' }).click();
  await page.getByRole('option', { name: folderName, exact: true }).click();
  const rows = page.locator('[data-testid^="background-gallery-row-"]');
  await expect(rows).toHaveCount(TASK07_SOAK_BACKGROUND_COUNT / galleryFolders.length);
  await expect.poll(async () => rows.evaluateAll((elements) => (
    elements.map((element) => element.getAttribute('data-testid')).sort()
  )), {
    intervals: [50, 100],
    timeout: 10_000,
  }).toEqual(expectedRowIds);
};

const activateGalleryBackground = async (page, background) => {
  const row = page.getByTestId(`background-gallery-row-${background.id}`);
  const activeBadge = row.getByText('Active', { exact: true });
  const useButton = row.getByRole('button', {
    name: `Use ${background.name}`,
    exact: true,
  });
  await expect(row).toHaveCount(1);

  if (await activeBadge.count()) {
    await waitForStableBattlemapLayer(page, {
      backgroundId: background.id,
      stage: 'already-active',
    });
    await waitForRegistryLeaseState(page, {
      backgroundId: background.id,
      crossfade: false,
      stage: 'already-active',
    });
    return { changed: false, transitionRegistry: null };
  }

  await waitForStableBattlemapLayer(page, {
    backgroundId: background.id,
    stage: 'before-activation',
  });
  await waitForRegistryLeaseState(page, {
    backgroundId: background.id,
    crossfade: false,
    stage: 'before-activation',
  });
  await expect(useButton).toBeEnabled();
  await useButton.click();
  const [transitionRegistry] = await Promise.all([
    waitForRegistryLeaseState(page, {
      backgroundId: background.id,
      crossfade: true,
      stage: 'crossfade',
    }),
    expect(activeBadge).toHaveCount(1),
  ]);
  await waitForRegistryLeaseState(page, {
    backgroundId: background.id,
    crossfade: false,
    stage: 'after-crossfade',
  });
  await waitForStableBattlemapLayer(page, {
    backgroundId: background.id,
    stage: 'after-crossfade',
  });
  return { changed: true, transitionRegistry };
};

const traverseVisibleGallery = async (page) => {
  return page.evaluate(async () => {
    const list = document.querySelector('[data-testid="background-gallery-scroll-list"]');
    if (!(list instanceof HTMLElement) || list.clientHeight <= 0) {
      throw new Error('Task 07 gallery scroll list is not visible.');
    }
    const rows = Array.from(list.querySelectorAll('[data-testid^="background-gallery-row-"]'));
    const visitedRows = new Set();
    const attachedImageUrls = new Set();
    const captureVisibleRows = () => {
      const listRect = list.getBoundingClientRect();
      for (const row of rows) {
        const rowRect = row.getBoundingClientRect();
        if (rowRect.bottom < listRect.top || rowRect.top > listRect.bottom) continue;
        visitedRows.add(row.getAttribute('data-testid'));
        const image = row.querySelector('img[data-media-state]');
        const source = image?.currentSrc || image?.getAttribute('src') || '';
        if (source) attachedImageUrls.add(source);
      }
    };
    const settle = () => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
    const maximumScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    const step = Math.max(1, Math.floor(list.clientHeight * 0.6));
    for (let scrollTop = 0; scrollTop < maximumScrollTop; scrollTop += step) {
      list.scrollTop = scrollTop;
      await settle();
      captureVisibleRows();
    }
    list.scrollTop = maximumScrollTop;
    await settle();
    captureVisibleRows();
    list.scrollTop = 0;
    await settle();
    captureVisibleRows();
    return {
      rowCount: rows.length,
      visitedRowIds: [...visitedRows],
      attachedImageUrls: [...attachedImageUrls],
    };
  });
};

const runPlayerRouteSoak = async ({ browser, baseURL, errors }) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('player'),
  });
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, {
    id: 'task07-bounded-route-soak',
    role: 'player',
  }, 1);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));

  try {
    let firstNavigation = true;
    for (let cycle = 0; cycle < soakRuntime.minimumCycles; cycle += 1) {
      for (const scenario of playerRoutes) {
        await navigateWithinApp(page, scenario.route, firstNavigation);
        firstNavigation = false;
        await waitForReadiness(page, {
          expectedPathname: scenario.route,
          timeoutMs: 30_000,
        });
        await page.waitForTimeout(200);
        const snapshot = await page.evaluate(() => ({
          audioNodes: document.querySelectorAll('audio').length,
          managedImages: document.querySelectorAll('img[data-media-state]').length,
        }));
        expect(snapshot.audioNodes).toBeLessThanOrEqual(4);
        expect(snapshot.managedImages).toBeGreaterThan(0);
        await waitForRouteCleanup(page, scenario.route);
      }
    }
  } finally {
    await drainPageConnections(page).catch(() => {});
    await context.close().catch(() => {});
  }
};

const runGrigliataRegistrySoak = async ({ browser, baseURL, errors, testInfo }) => {
  if (new URL(baseURL).origin !== 'http://127.0.0.1:5000') {
    throw new Error(`Task 07 map activation refuses non-owned origin: ${baseURL}.`);
  }
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('dm'),
  });
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, {
    id: 'task07-grigliata-registry-soak',
    role: 'dm',
  }, 1);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const samples = [];
  const lifecycleStartedAtMs = performance.now();

  try {
    let firstNavigation = true;
    let cycle = 0;
    do {
      cycle += 1;
      await navigateWithinApp(page, '/grigliata', firstNavigation);
      firstNavigation = false;
      await waitForReadiness(page, {
        expectedPathname: '/grigliata',
        timeoutMs: 30_000,
      });
      await expect(page.locator('canvas').first()).toBeVisible();

      await page.getByRole('tab', { name: 'DM Gallery', exact: true }).click();
      await page.waitForFunction(() => (
        typeof window.__FND_PERF_BENCHMARKS__?.getImageRegistryStats === 'function'
      ));
      const visitedBackgrounds = new Set();
      const activatedBackgrounds = new Set();
      const attachedGalleryImages = new Set();
      let crossfadeLeaseObservations = 0;
      let tokenNodeCount = 0;
      for (const folder of galleryFolders) {
        await selectGalleryFolder(page, folder.name);
        const traversal = await traverseVisibleGallery(page);
        expect(traversal.rowCount).toBe(TASK07_SOAK_BACKGROUND_COUNT / galleryFolders.length);
        traversal.visitedRowIds.forEach((rowId) => visitedBackgrounds.add(rowId));
        traversal.attachedImageUrls.forEach((url) => attachedGalleryImages.add(url));

        const folderBackgrounds = backgroundCatalog.filter((background) => (
          background.folderName === folder.name
        ));
        for (const background of folderBackgrounds) {
          const activation = await activateGalleryBackground(page, background);
          activatedBackgrounds.add(background.id);
          if (activation.changed) {
            crossfadeLeaseObservations += 1;
            expect(activation.transitionRegistry.namedPins).toEqual(expect.arrayContaining([
              ACTIVE_BOARD_PIN,
              CROSSFADE_PIN,
            ]));
            expect(activation.transitionRegistry.pinnedRecordCount).toBeGreaterThanOrEqual(2);
          }

          if (background.id === 'perf-map') {
            await page.waitForFunction(
              (minimum) => {
                const stages = Array.isArray(window.Konva?.stages) ? window.Konva.stages : [];
                const count = stages.reduce((total, stage) => (
                  total + Array.from(stage.find((node) => (
                    String(node.getAttr?.('data-testid') || '').startsWith('token-node-')
                  ))).length
                ), 0);
                return count >= minimum;
              },
              TASK07_SOAK_TOKEN_COUNT,
              { polling: 100, timeout: 20_000 }
            );
            tokenNodeCount = await page.evaluate(countKonvaTokenNodes);
          }
        }
      }
      expect(visitedBackgrounds.size).toBe(TASK07_SOAK_BACKGROUND_COUNT);
      expect(activatedBackgrounds.size).toBe(TASK07_SOAK_BACKGROUND_COUNT);
      expect(crossfadeLeaseObservations).toBeGreaterThanOrEqual(
        TASK07_SOAK_BACKGROUND_COUNT - 1
      );
      expect(attachedGalleryImages.size).toBeGreaterThan(0);
      expect(tokenNodeCount).toBeGreaterThanOrEqual(TASK07_SOAK_TOKEN_COUNT);

      await page.evaluate(() => {
        window.__FND_TASK07_SOAK_REGISTRY_PROBE__ = (
          window.__FND_PERF_BENCHMARKS__.getImageRegistryStats
        );
      });
      await waitForRouteCleanup(page, '/grigliata');
      await page.waitForTimeout(2_200);
      const registry = await page.evaluate(async () => {
        window.gc?.();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const probe = window.__FND_TASK07_SOAK_REGISTRY_PROBE__;
        if (typeof probe !== 'function') {
          throw new Error('Task 07 registry probe was not retained for settled sampling.');
        }
        return probe();
      });
      samples.push({
        cycle,
        backgroundsVisited: activatedBackgrounds.size,
        galleryBackgroundsVisited: visitedBackgrounds.size,
        tokenNodeCount,
        attachedGalleryImageCount: attachedGalleryImages.size,
        crossfadeLeaseObservations,
        registry,
      });
    } while (
      samples.length < soakRuntime.minimumCycles
      || performance.now() - lifecycleStartedAtMs < soakRuntime.durationMs
    );

    const lifecycleElapsedMs = Math.floor(performance.now() - lifecycleStartedAtMs);
    const plateau = evaluateTask07RegistryPlateau(samples);
    await testInfo.attach('task07-registry-plateau.json', {
      body: Buffer.from(`${JSON.stringify({
        lifecycleElapsedMs,
        plateau,
        runtime: soakRuntime,
        samples,
      }, null, 2)}\n`, 'utf8'),
      contentType: 'application/json',
    });
    expect(samples.length).toBeGreaterThanOrEqual(soakRuntime.minimumCycles);
    expect(lifecycleElapsedMs).toBeGreaterThanOrEqual(soakRuntime.durationMs);
    expect(plateau.failures).toEqual([]);
    expect(plateau.status).toBe('pass');
    expect(errors).toEqual([]);
    return { lifecycleElapsedMs, plateau, samples };
  } finally {
    await page.evaluate(() => {
      delete window.__FND_TASK07_SOAK_REGISTRY_PROBE__;
    }).catch(() => {});
    await drainPageConnections(page).catch(() => {});
    await context.close().catch(() => {});
  }
};

test(`Task 07 50-map/token lifecycle soak (${soakRuntime.durationMs} ms minimum)`, async ({
  browser,
  baseURL,
}, testInfo) => {
  const errors = [];
  await runPlayerRouteSoak({ browser, baseURL, errors });
  const result = await runGrigliataRegistrySoak({ browser, baseURL, errors, testInfo });
  expect(result.samples.length).toBeGreaterThanOrEqual(soakRuntime.minimumCycles);
  expect(result.lifecycleElapsedMs).toBeGreaterThanOrEqual(soakRuntime.durationMs);
});
