const { test, expect } = require('./measured-test');
const {
  drainPageConnections,
  installDeterministicFontRoutes,
  installOwnedEmulatorFirestoreTransport,
  isExpectedDemoRecaptchaCancellation,
  isExpectedDemoRecaptchaReportOnlyWarning,
  storageStateForRole,
  waitForReadiness,
  writeScenarioResult,
} = require('./helpers');

const TASK07_MEDIA_SHELL_SCENARIO = Object.freeze({
  id: 'task07-media-shell',
  route: '/home',
  role: 'player',
});

const isFixtureImageRequest = (request) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url()).pathname);
    return request.resourceType() === 'image'
      && pathname.includes('/o/performance/image-');
  } catch {
    return false;
  }
};

test('Task 07 media and shell budgets hold on read-only home', async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('player'),
    reducedMotion: 'reduce',
  });
  await installOwnedEmulatorFirestoreTransport(context);
  await installDeterministicFontRoutes(context);
  const fixtureImageRequests = [];
  const mediaRequests = [];
  const consoleErrors = [];
  const explainedRecaptchaCancellations = [];
  const explainedRecaptchaReportOnlyWarnings = [];
  const failedRequests = [];
  const unhandledErrors = [];
  let lifecyclePhase = 'route-navigation';
  const page = await context.newPage();

  page.on('request', (request) => {
    if (isFixtureImageRequest(request)) {
      fixtureImageRequests.push(request.url());
    }
    if (request.resourceType() === 'media') {
      mediaRequests.push(request.url());
    }
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (isExpectedDemoRecaptchaReportOnlyWarning(text, {baseURL})) {
      explainedRecaptchaReportOnlyWarnings.push(text.slice(0, 500));
      return;
    }
    consoleErrors.push(text);
  });
  page.on('pageerror', (error) => unhandledErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const failure = {
      failure: request.failure()?.errorText || 'unknown',
      path: (() => {
        try { return new URL(request.url()).pathname; } catch { return '[invalid-url]'; }
      })(),
      resourceType: request.resourceType(),
    };
    if (isExpectedDemoRecaptchaCancellation({
      ...failure,
      lifecyclePhase,
      url: request.url(),
    })) {
      explainedRecaptchaCancellations.push(failure);
      return;
    }
    failedRequests.push(failure);
  });

  try {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await waitForReadiness(page, {
      expectedPathname: '/home',
      timeoutMs: 30_000,
    });
    lifecyclePhase = 'route-active';
    await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
    await page.waitForTimeout(750);

    await require('./home-inventory-window').assertInitialHomeInventoryWindow(page);
    const inventoryMedia = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h2'))
        .find((node) => node.textContent?.trim() === 'Inventario');
      if (!heading) throw new Error('Inventory heading is missing.');

      let container = heading.parentElement;
      while (
        container
        && container !== document.body
        && container.querySelectorAll('[data-home-inventory-row]').length === 0
      ) {
        container = container.parentElement;
      }
      const images = Array.from(
        container?.querySelectorAll('img[data-media-state]') || []
      );
      const farViewportBottom = window.innerHeight + 300;
      const farViewportTop = -300;
      const attached = images.filter((image) => image.hasAttribute('src'));
      const farOffscreen = images.filter((image) => {
        const rect = image.getBoundingClientRect();
        return rect.top > farViewportBottom || rect.bottom < farViewportTop;
      });

      return {
        total: images.length,
        attached: attached.length,
        farOffscreen: farOffscreen.length,
        farOffscreenAttached: farOffscreen.filter(
          (image) => image.hasAttribute('src')
        ).length,
        dimensionsMissing: images.filter((image) => (
          !(Number(image.getAttribute('width')) > 0)
          || !(Number(image.getAttribute('height')) > 0)
          || !image.style.aspectRatio
        )).length,
        nonLazy: images.filter(
          (image) => image.getAttribute('loading') !== 'lazy'
        ).length,
        nonAsync: images.filter(
          (image) => image.getAttribute('decoding') !== 'async'
        ).length,
      };
    });

    expect(inventoryMedia.total).toBe(60);
    expect(inventoryMedia.farOffscreen).toBeGreaterThan(0);
    expect(inventoryMedia.farOffscreenAttached).toBe(0);
    expect(inventoryMedia.attached).toBeLessThan(80);
    expect(inventoryMedia.dimensionsMissing).toBe(0);
    expect(inventoryMedia.nonLazy).toBe(0);
    expect(inventoryMedia.nonAsync).toBe(0);
    expect(new Set(fixtureImageRequests).size).toBeLessThan(64);

    const shell = await page.evaluate(() => {
      const activeListeners = window.__FND_PERF__?.snapshot?.().activeListeners || {};
      return {
        auroraPaused: Boolean(
          document.querySelector('.global-aurora.global-aurora--paused')
        ),
        starFields: document.querySelectorAll('.global-aurora__star-field').length,
        activeMeteors: document.querySelectorAll(
          '.shooting-star[data-active="true"]'
        ).length,
        meteorSlots: document.querySelectorAll('.shooting-star').length,
        musicStreamListeners: Number(
          activeListeners['shell::grigliata.music-stream.subscribe.v1'] || 0
        ),
        legacyMusicPlaybackListeners: Number(
          activeListeners['shell::grigliata.music-playback.subscribe.v1'] || 0
        ),
        legacyMusicSessionListeners: Number(
          activeListeners['shell::grigliata.music-sessions.subscribe.v1'] || 0
        ),
        audioNodes: Array.from(document.querySelectorAll('audio')).map((audio) => ({
          preload: audio.getAttribute('preload'),
          hasSource: audio.hasAttribute('src') || Boolean(audio.currentSrc),
        })),
      };
    });
    expect(shell.auroraPaused).toBe(true);
    expect(shell.starFields).toBe(2);
    expect(shell.meteorSlots).toBe(2);
    expect(shell.activeMeteors).toBe(0);
    expect(shell.audioNodes.length).toBe(0);
    expect(shell.audioNodes.every(({ preload }) => preload === 'none')).toBe(true);
    expect(shell.audioNodes.some(({ hasSource }) => hasSource)).toBe(false);
    expect(shell.musicStreamListeners).toBe(1);
    expect(shell.legacyMusicPlaybackListeners).toBe(0);
    expect(shell.legacyMusicSessionListeners).toBe(0);
    expect(mediaRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(unhandledErrors).toEqual([]);

    await require('./home-inventory-window').assertRemainingHomeInventoryAccessible(page);
    writeScenarioResult(TASK07_MEDIA_SHELL_SCENARIO, 1, {
      environment: {
        projectName: testInfo.project.name,
        browserName: testInfo.project.use.browserName || testInfo.project.name,
        browserVersion: browser.version(),
      },
      metrics: {
        'task07.attachedImages': inventoryMedia.attached,
        'task07.audioNodes': shell.audioNodes.length,
        'task07.farOffscreenAttachedImages': inventoryMedia.farOffscreenAttached,
        'task07.managedImages': inventoryMedia.total,
        'task07.musicStreamListeners': shell.musicStreamListeners,
        'task07.reducedMotionMeteors': shell.activeMeteors,
        'task07.uniqueFixtureImageRequests': new Set(fixtureImageRequests).size,
      },
      diagnostics: {
        consoleErrors,
        explainedRecaptchaCancellations,
        explainedRecaptchaReportOnlyWarnings,
        failedRequests,
        unhandledErrors,
      },
    });
  } finally {
    lifecyclePhase = 'route-cleanup';
    await drainPageConnections(page).catch(() => {});
    await context.close();
  }
});
