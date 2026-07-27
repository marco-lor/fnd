const { test, expect } = require('./measured-test');
const {
  drainPageConnections,
  installDeterministicFontRoutes,
  storageStateForRole,
  waitForReadiness,
} = require('./helpers');

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
}) => {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('player'),
    reducedMotion: 'reduce',
  });
  await installDeterministicFontRoutes(context);
  const fixtureImageRequests = [];
  const mediaRequests = [];
  const browserErrors = [];
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
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  try {
    await page.goto('/home', { waitUntil: 'domcontentloaded' });
    await waitForReadiness(page, {
      expectedPathname: '/home',
      timeoutMs: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
    await page.waitForTimeout(750);

    const inventoryMedia = await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll('h2'))
        .find((node) => node.textContent?.trim() === 'Inventario');
      if (!heading) throw new Error('Inventory heading is missing.');

      let container = heading.parentElement;
      while (
        container
        && container !== document.body
        && container.querySelectorAll('img[data-media-state]').length < 200
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

    expect(inventoryMedia.total).toBeGreaterThanOrEqual(400);
    expect(inventoryMedia.farOffscreen).toBeGreaterThan(300);
    expect(inventoryMedia.farOffscreenAttached).toBe(0);
    expect(inventoryMedia.attached).toBeLessThan(80);
    expect(inventoryMedia.dimensionsMissing).toBe(0);
    expect(inventoryMedia.nonLazy).toBe(0);
    expect(inventoryMedia.nonAsync).toBe(0);
    expect(new Set(fixtureImageRequests).size).toBeLessThan(64);

    const shell = await page.evaluate(() => ({
      auroraPaused: Boolean(
        document.querySelector('.global-aurora.global-aurora--paused')
      ),
      starFields: document.querySelectorAll('.global-aurora__star-field').length,
      shootingStars: document.querySelectorAll('.shooting-star').length,
      audioNodes: Array.from(document.querySelectorAll('audio')).map((audio) => ({
        preload: audio.getAttribute('preload'),
        hasSource: audio.hasAttribute('src') || Boolean(audio.currentSrc),
      })),
    }));
    expect(shell.auroraPaused).toBe(true);
    expect(shell.starFields).toBe(2);
    expect(shell.shootingStars).toBe(0);
    expect(shell.audioNodes.length).toBeLessThanOrEqual(1);
    expect(shell.audioNodes.every(({ preload }) => preload === 'none')).toBe(true);
    expect(shell.audioNodes.some(({ hasSource }) => hasSource)).toBe(false);
    expect(mediaRequests).toEqual([]);
    expect(browserErrors).toEqual([]);
  } finally {
    await drainPageConnections(page).catch(() => {});
    await context.close();
  }
});
