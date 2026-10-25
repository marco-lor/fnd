const fs = require('node:fs/promises');
const { test, expect } = require('./measured-test');
const {
  drainPageConnections,
  installBootstrap,
  installDeterministicFontRoutes,
  storageStateForRole,
  waitForReadiness,
} = require('./helpers');

const ECHI_ROUTE = '/echi-di-viaggio';
const MODERN_BODY_BUDGET = 4_466_801;
const MAP_REQUEST = /\/static\/media\/(?:(?:art|precisa)-\d+\.[^/]+\.(?:avif|webp)|mappa_(?:art|precisa)\.[^/]+\.png)(?:\?|$)/;
const FORMAT_ORDER = ['avif', 'webp', 'png'];

async function attachJson(testInfo, name, value) {
  const outputPath = testInfo.outputPath(`${name}.json`);
  await fs.writeFile(outputPath, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path: outputPath, contentType: 'application/json' });
}

// Intercept only owned static maps. Every request fetches the real built asset;
// record the exact body supplied to the browser, including injected failures.
// A zero from Resource Timing is never used as a substitute for body bytes.
async function installMapTraffic(context, { failedFormats = [], fault = 'http', beforeFirstArt } = {}) {
  const entries = [];
  let firstArt = true;
  await context.route(MAP_REQUEST, async (route) => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe('http://127.0.0.1:5000');
    const format = url.pathname.split('.').pop();
    const mapId = /\/(?:mappa_)?art(?:-|\.)/.test(url.pathname) ? 'art' : 'precisa';
    const entry = { mapId, format, path: url.pathname, fault: failedFormats.includes(format), bodyBytes: null, status: null, complete: false };
    entries.push(entry);
    try {
      if (mapId === 'art' && firstArt) {
        firstArt = false;
        if (beforeFirstArt) await beforeFirstArt;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      let body = await response.body();
      let status = 200;
      if (entry.fault && fault === 'decode') body = Buffer.alloc(body.length);
      if (entry.fault && fault === 'http') {
        body = Buffer.from(`Task 15A injected ${format} failure\n`, 'utf8');
        status = 503;
      }
      entry.bodyBytes = body.length;
      entry.status = status;
      await route.fulfill({
        status,
        body,
        contentType: `image/${format}`,
        headers: { 'cache-control': 'no-store' },
      });
      await response.dispose();
      entry.complete = true;
    } catch (error) {
      entry.error = error.message;
      throw error;
    }
  });
  return entries;
}

function summarizeTraffic(entries) {
  expect(entries.length).toBeGreaterThan(0);
  entries.forEach((entry) => {
    expect(entry.error).toBeUndefined();
    expect(entry.complete).toBe(true);
    expect(Number.isSafeInteger(entry.bodyBytes)).toBe(true);
    expect(entry.bodyBytes).toBeGreaterThan(0);
  });
  const bytes = (predicate) => entries.filter(predicate).reduce((sum, entry) => sum + entry.bodyBytes, 0);
  return {
    totalBodyBytes: bytes(() => true),
    modernBodyBytes: bytes(({ format }) => format !== 'png'),
    pngBodyBytes: bytes(({ format }) => format === 'png'),
    injectedFailureBodyBytes: bytes(({ fault }) => fault),
    entries,
  };
}

function assertNoRetiredAttempts(entries) {
  for (const mapId of ['art', 'precisa']) {
    let highestFormat = -1;
    for (const entry of entries.filter((candidate) => candidate.mapId === mapId)) {
      const formatIndex = FORMAT_ORDER.indexOf(entry.format);
      expect(formatIndex, `Retired ${entry.format} requested after fallback: ${JSON.stringify(entries)}`).toBeGreaterThanOrEqual(highestFormat);
      highestFormat = formatIndex;
    }
  }
}

async function settleTraffic(page, entries) {
  let previousCount = -1;
  let quietSince = Date.now();
  await expect.poll(async () => {
    if (entries.length !== previousCount || entries.some(({ complete }) => !complete)) {
      previousCount = entries.length;
      quietSince = Date.now();
    }
    return Date.now() - quietSince;
  }, { intervals: [100], timeout: 15_000 }).toBeGreaterThanOrEqual(750);
  // Flush rendering after load/decode before measuring geometry or a retry loop.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function withEchi({ browser, baseURL }, testInfo, options, run) {
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole('player'),
    viewport: options.viewport || { width: 1440, height: 360 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await installDeterministicFontRoutes(context);
  await installBootstrap(context, { id: 'echi-di-viaggio', role: 'player', route: ECHI_ROUTE }, 1);
  const entries = await installMapTraffic(context, options);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(ECHI_ROUTE, { waitUntil: 'domcontentloaded' });
    await waitForReadiness(page, { expectedPathname: ECHI_ROUTE, timeoutMs: 30_000 });
    const art = page.locator('[data-echi-map="art"]');
    const precise = page.locator('[data-echi-map="precisa"]');
    await expect(art).toBeVisible();
    await expect(art.getByRole('button', { name: 'Marker 0', exact: true })).toHaveCount(1);
    await run({ page, art, precise, entries });
    expect(pageErrors).toEqual([]);
  } catch (error) {
    const screenshot = await page.screenshot().catch(() => null);
    if (screenshot) await testInfo.attach('task15a-page-before-cleanup', { body: screenshot, contentType: 'image/png' });
    throw error;
  } finally {
    options.releaseFirstArt?.();
    await attachJson(testInfo, 'task15a-map-http-bodies', { viewport: page.viewportSize(), entries, pageErrors });
    await drainPageConnections(page).catch(() => {});
    await context.close();
  }
}

async function geometry(surface) {
  return surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const image = element.querySelector('picture img');
    const imageRect = image?.getBoundingClientRect();
    const marker = element.querySelector('button[aria-label="Marker 0"]')?.parentElement;
    const markerRect = marker?.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      image: imageRect ? {
        x: imageRect.left - rect.left, y: imageRect.top - rect.top,
        width: imageRect.width, height: imageRect.height,
        transform: getComputedStyle(image).transform,
        objectFit: getComputedStyle(image).objectFit,
        currentSrc: image.currentSrc,
        complete: image.complete && image.naturalWidth > 0,
      } : null,
      marker: markerRect ? {
        x: markerRect.left + markerRect.width / 2 - rect.left,
        y: markerRect.top + markerRect.height / 2 - rect.top,
      } : null,
    };
  });
}

function assertArtGeometry(actual) {
  expect(Math.abs(actual.height - actual.width * 1536 / 2816)).toBeLessThanOrEqual(1);
  expect(actual.image.complete).toBe(true);
  expect(actual.image.transform).toBe('none');
  expect(actual.image.objectFit).toBe('contain');
  expect(Math.abs(actual.image.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.image.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.image.width - actual.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.image.height - actual.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.marker.x - actual.width * 0.01)).toBeLessThanOrEqual(1);
  expect(Math.abs(actual.marker.y - actual.height * 0.01)).toBeLessThanOrEqual(1);
}

async function moveLowerMapTop(page, precise, top) {
  await precise.evaluate((element, targetTop) => {
    // The actual route uses document scrolling; locate a scroll owner so the
    // probe also remains valid if its shell gains a bounded scroll container.
    let owner = element.parentElement;
    while (owner && !(owner.scrollHeight > owner.clientHeight && /auto|scroll/.test(getComputedStyle(owner).overflowY))) owner = owner.parentElement;
    const delta = element.getBoundingClientRect().top - targetTop;
    if (owner) owner.scrollBy(0, delta);
    else window.scrollBy(0, delta);
  }, top);
  await expect.poll(async () => (await precise.boundingBox()).y).toBeLessThanOrEqual(top + 1);
  await page.waitForTimeout(150);
}

async function hoverVisibleMap(page, surface) {
  const point = await surface.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let y = Math.max(0, rect.top) + 8; y < Math.min(innerHeight, rect.bottom) - 8; y += 24) {
      for (let x = Math.max(0, rect.left) + 8; x < Math.min(innerWidth, rect.right) - 8; x += 24) {
        if (document.elementFromPoint(x, y)?.closest('[data-echi-map]') === element) return { x, y };
      }
    }
    return null;
  });
  expect(point, 'The map must expose a pointer-accessible coordinate surface').not.toBeNull();
  await page.mouse.move(point.x, point.y);
  await expect.poll(() => surface.evaluate((element) => element.matches(':hover'))).toBe(true);
}

test('Task 15A Echi popup focus survives competing hover and closes after Escape and outside focus', async ({ browser, baseURL }, testInfo) => {
  await withEchi({ browser, baseURL }, testInfo, { viewport: { width: 1440, height: 900 } }, async ({ page, art }) => {
    const sidebar = page.locator('aside');
    const tileA = sidebar.getByRole('button', { name: /Fixture NPC 0\b/ });
    const tileB = sidebar.getByRole('button', { name: /Fixture NPC 1\b/ });
    const popupA = page.getByRole('dialog', { name: 'NPC: Fixture NPC 0', exact: true });
    const outside = page.getByRole('link', { name: 'Home', exact: true }).first();
    await tileA.focus();
    await expect(popupA).toBeVisible();
    await tileA.press('ArrowDown');
    await expect(popupA).toBeFocused();
    await tileB.hover();
    await page.waitForTimeout(300);
    await expect(popupA).toBeFocused();
    await expect(page.getByRole('dialog', { name: 'NPC: Fixture NPC 1', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(popupA).toHaveCount(0);
    await expect(tileA).toBeFocused();
    await tileA.press('ArrowDown');
    await expect(popupA).toBeFocused();
    await popupA.hover();
    await page.keyboard.press('Escape');
    await expect(popupA).toHaveCount(0);
    // Move the real pointer only while the portal is absent. Its removed DOM
    // node receives no synthetic mouseleave to repair stale pointer state.
    await page.mouse.move(1430, 890);
    await tileA.press('ArrowDown');
    await expect(popupA).toBeFocused();
    await outside.focus();
    await expect(popupA).toHaveCount(0);

    // The immutable fixture has ordinary public markers, including this edge
    // marker. Check keyboard access and clipping without editing fixture data.
    await art.scrollIntoViewIfNeeded();
    const marker = art.getByRole('button', { name: 'Marker 0', exact: true });
    const markerPopup = page.getByRole('dialog', { name: 'Marker 0', exact: true });
    await marker.focus();
    await expect(markerPopup).toBeVisible();
    await marker.press('ArrowDown');
    await expect(markerPopup).toBeFocused();
    const bounds = await markerPopup.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1441);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(901);
    await page.keyboard.press('Escape');
    await expect(markerPopup).toHaveCount(0);
    await expect(marker).toBeFocused();
  });
});

for (const profile of [
  { name: 'desktop', viewport: { width: 1440, height: 360 } },
  { name: 'mobile', viewport: { width: 390, height: 844 } },
]) {
  test(`Task 15A ${profile.name} Echi maps use native modern sources within the cold body budget`, async ({ browser, baseURL }, testInfo) => {
    await withEchi({ browser, baseURL }, testInfo, profile, async ({ page, art, precise, entries }) => {
      await expect(art).toHaveAttribute('data-map-state', 'loaded');
      await expect(art.locator('picture source[type="image/avif"]')).toHaveCount(1);
      await expect(art.locator('picture source[type="image/webp"]')).toHaveCount(1);
      await expect(art.locator('img')).toHaveAttribute('fetchpriority', 'high');
      if (profile.name === 'desktop') {
        const viewportHeight = page.viewportSize().height;
        expect((await precise.boundingBox()).y).toBeGreaterThan(viewportHeight + 320);
        await expect(precise).toHaveAttribute('data-map-activation', 'waiting');
        expect(entries.filter(({ mapId }) => mapId === 'precisa')).toEqual([]);
        await expect(precise.locator('img, source[srcset]')).toHaveCount(0);
        await moveLowerMapTop(page, precise, viewportHeight + 340);
        await expect(precise).toHaveAttribute('data-map-activation', 'waiting');
        expect(entries.filter(({ mapId }) => mapId === 'precisa')).toEqual([]);
        await moveLowerMapTop(page, precise, viewportHeight + 300);
      } else {
        await precise.scrollIntoViewIfNeeded();
      }
      await expect(precise).toHaveAttribute('data-map-state', 'loaded');
      await settleTraffic(page, entries);
      const cold = summarizeTraffic(entries);
      expect(cold.pngBodyBytes).toBe(0);
      expect(cold.injectedFailureBodyBytes).toBe(0);
      expect(cold.modernBodyBytes).toBeLessThanOrEqual(MODERN_BODY_BUDGET);
      expect(new Set(entries.map(({ mapId }) => mapId))).toEqual(new Set(['art', 'precisa']));
      for (const surface of [art, precise]) {
        expect(await surface.locator('img').evaluate((image) => image.currentSrc)).toMatch(/\.(avif|webp)(?:[?#]|$)/);
        const details = await geometry(surface);
        const masterWidth = await surface.getAttribute('data-echi-map') === 'art' ? 2816 : 2752;
        expect(Math.abs(details.height - details.width * 1536 / masterWidth)).toBeLessThanOrEqual(1);
        expect(details.image.complete).toBe(true);
        expect(details.image.objectFit).toBe('contain');
        expect(Math.abs(details.image.width - details.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(details.image.height - details.height)).toBeLessThanOrEqual(1);
      }
      await attachJson(testInfo, 'task15a-cold-map-budget', cold);
      await art.scrollIntoViewIfNeeded();
      assertArtGeometry(await geometry(art));
      await hoverVisibleMap(page, art);
      assertArtGeometry(await geometry(art));
      await page.setViewportSize(profile.name === 'desktop' ? { width: 1180, height: 720 } : { width: 430, height: 844 });
      await expect.poll(async () => (await geometry(art)).image.complete).toBe(true);
      await settleTraffic(page, entries);
      assertArtGeometry(await geometry(art));
      await expect(precise).toHaveAttribute('data-map-activation', 'active');
      expect(entries.filter(({ format }) => format === 'png')).toEqual([]);
      assertNoRetiredAttempts(entries);
    });
  });
}

for (const failure of [
  { name: 'AVIF decode advances to WebP', failedFormats: ['avif'], fault: 'decode', finalFormat: 'webp' },
  { name: 'modern HTTP failures advance to PNG', failedFormats: ['avif', 'webp'], fault: 'http', finalFormat: 'png' },
  { name: 'all HTTP failures reach a stable accessible error', failedFormats: ['avif', 'webp', 'png'], fault: 'http', finalFormat: 'error' },
]) {
  test(`Task 15A Echi ${failure.name}`, async ({ browser, baseURL }, testInfo) => {
    let releaseArt;
    const beforeFirstArt = new Promise((resolve) => { releaseArt = resolve; });
    try {
      await withEchi({ browser, baseURL }, testInfo, { ...failure, beforeFirstArt, releaseFirstArt: () => releaseArt() }, async ({ page, art, entries }) => {
        const reserved = await geometry(art);
        expect(reserved.width).toBeGreaterThan(0);
        expect(reserved.height).toBeGreaterThan(0);
        releaseArt();
        await expect(art).toHaveAttribute('data-map-format', failure.finalFormat);
        await expect(art).toHaveAttribute('data-map-state', failure.finalFormat === 'error' ? 'error' : 'loaded');
        await settleTraffic(page, entries);
        const final = await geometry(art);
        expect(Math.abs(final.width - reserved.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(final.height - reserved.height)).toBeLessThanOrEqual(1);
        if (failure.finalFormat === 'error') {
          await expect(art.getByRole('alert')).toContainText('Impossibile caricare Mappa Artistica');
          await expect(art.locator('img[src], img[srcset], source[srcset]')).toHaveCount(0);
          await expect(art.locator('picture')).toBeHidden();
          await expect(art.locator('img')).toHaveAttribute('aria-hidden', 'true');
        } else {
          assertArtGeometry(final);
          expect(final.image.currentSrc).toMatch(new RegExp(`\\.${failure.finalFormat}(?:[?#]|$)`));
        }
        // A responsive change may reselect within the surviving format. It
        // must never resurrect an AVIF/WebP attempt that already failed.
        const beforeResize = entries.filter(({ mapId }) => mapId === 'art');
        expect(beforeResize.length).toBeLessThanOrEqual(3);
        expect(new Set(beforeResize.map(({ format }) => format)).size).toBe(beforeResize.length);
        await page.setViewportSize({ width: 1180, height: 720 });
        await settleTraffic(page, entries);
        assertNoRetiredAttempts(entries);
        const artEntries = entries.filter(({ mapId }) => mapId === 'art');
        const selectedFormats = [...new Set(artEntries.map(({ format }) => format))];
        expect(selectedFormats).toContain('webp');
        if (failure.finalFormat !== 'webp') expect(selectedFormats).toContain('png');
        expect(selectedFormats.length).toBeLessThanOrEqual(3);
        if (failure.finalFormat === 'error') expect(artEntries.length).toBe(beforeResize.length);
        const traffic = summarizeTraffic(entries);
        expect(traffic.injectedFailureBodyBytes).toBeGreaterThan(0);
        if (failure.finalFormat !== 'webp') expect(traffic.pngBodyBytes).toBeGreaterThan(0);
        await attachJson(testInfo, 'task15a-fallback-map-traffic', traffic);
      });
    } finally {
      releaseArt();
    }
  });
}
