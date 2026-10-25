const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { test, expect } = require('./measured-test');
const { configureOwnedPerformanceEnvironment, projectId } = require('../../../scripts/performance/common');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fixtureManifest = require('../../fixture-manifest.json');
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
  const role = options.role || 'player';
  const context = await browser.newContext({
    baseURL,
    storageState: storageStateForRole(role),
    viewport: options.viewport || { width: 1440, height: 360 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await installDeterministicFontRoutes(context);
  if (options.nativeMediaExclusions) {
    await context.addInitScript((excludedTypes) => {
      const setAttribute = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function assignSourceMedia(name, value) {
        if (this instanceof HTMLSourceElement && name === 'type' && excludedTypes.includes(value)) {
          setAttribute.call(this, 'media', 'not all');
        }
        return setAttribute.call(this, name, value);
      };
    }, options.nativeMediaExclusions);
  }
  await installBootstrap(context, { id: 'echi-di-viaggio', role, route: ECHI_ROUTE }, 1);
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
    for (let y = Math.max(0, rect.top) + 8; y < Math.min(window.innerHeight, rect.bottom) - 8; y += 24) {
      for (let x = Math.max(0, rect.left) + 8; x < Math.min(window.innerWidth, rect.right) - 8; x += 24) {
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
    await marker.press('ArrowDown');
    await expect(markerPopup).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(markerPopup).toHaveCount(0);
    await expect(marker).toBeFocused();
  });
});

test('Task 15A a bare NPC marker button supports native drag and cancelled movement', async ({ browser, baseURL }, testInfo) => {
  await withEchi({ browser, baseURL }, testInfo, { viewport: { width: 1440, height: 900 } }, async ({ page, art }) => {
    const temporaryName = `Task15A native drag ${testInfo.project.name} ${randomUUID()}`;
    const marker = art.getByRole('button', { name: temporaryName, exact: true });
    const markerOwner = marker.locator('..');
    const allMarkers = page.locator('[data-echi-map] button[aria-haspopup="dialog"]');
    const removeNativeDragObserver = async () => {
      if (await marker.count()) await marker.evaluate((element) => {
        if (element.__task15aNativeDragObserver) {
          document.removeEventListener('dragstart', element.__task15aNativeDragObserver);
          delete element.__task15aNativeDragObserver;
        }
      });
    };
    const noteHeading = page.getByRole('heading', { name: 'Aggiungi Nota Pubblica', exact: true });
    const moveHeading = page.getByRole('heading', { name: 'Conferma Spostamento NPC', exact: true });
    const initialCount = fixtureManifest.counts.map_markers;
    await expect(allMarkers).toHaveCount(initialCount);
    configureOwnedPerformanceEnvironment();
    if (projectId !== 'demo-fnd-perf' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
      throw new Error('Native marker verification requires the owned demo Firestore emulator.');
    }
    const adminApp = initializeApp({ projectId }, `task15a-marker-drag-${randomUUID()}`);
    const serverMarkers = getFirestore(adminApp).collection('map_markers');
    const ownedMarkerQuery = serverMarkers.where('text', '==', temporaryName).where('createdBy', '==', 'perf-player');
    let ownedMarkerId;
    try {
      await expect.poll(async () => (await serverMarkers.count().get()).data().count).toBe(initialCount);
      await art.scrollIntoViewIfNeeded();
      // Leave room for the entire new pin, including its hover scale. A
      // transparent marker wrapper can intercept even when no button is hit.
      const findClearMapPoint = (awayFrom = null) => art.evaluate((element, avoid) => {
        const rect = element.getBoundingClientRect();
        const markers = [...element.querySelectorAll('button[aria-haspopup="dialog"]')]
          .map((button) => button.parentElement.getBoundingClientRect());
        const points = [];
        for (let y = Math.max(64, rect.top + 64); y < Math.min(window.innerHeight - 64, rect.bottom - 64); y += 32) {
          for (let x = Math.max(64, rect.left + 64); x < Math.min(window.innerWidth - 64, rect.right - 64); x += 32) {
            if (avoid && Math.hypot(x - rect.left - avoid.x, y - rect.top - avoid.y) < 120) continue;
            if (markers.some((markerRect) => markerRect.left < x + 24 && markerRect.right > x - 24
              && markerRect.top < y + 24 && markerRect.bottom > y - 24)) continue;
            const exposed = [-24, 0, 24].every((dx) => [-24, 0, 24].every((dy) => {
              const hit = document.elementFromPoint(x + dx, y + dy);
              return hit?.closest('[data-echi-map]') === element && !hit.closest('[data-echi-map] > div[draggable]');
            }));
            if (exposed) points.push({ x: x - rect.left, y: y - rect.top });
          }
        }
        points.sort((a, b) => Math.hypot(a.x - rect.width / 2, a.y - rect.height / 2)
          - Math.hypot(b.x - rect.width / 2, b.y - rect.height / 2));
        return points[0] || null;
      }, awayFrom);
      const creationPosition = await findClearMapPoint();
      expect(creationPosition).not.toBeNull();
      const publicPalette = page.getByText('Public Pin', { exact: true }).locator('../..');
      await publicPalette.getByRole('button', { name: 'Trascina: NPC', exact: true }).dragTo(art, { targetPosition: creationPosition });
      await expect(noteHeading).toBeVisible();
      await noteHeading.locator('..').getByRole('textbox').fill(temporaryName);
      await noteHeading.locator('..').getByRole('button', { name: 'Salva', exact: true }).click();
      await expect(marker).toHaveCount(1);
      await expect(allMarkers).toHaveCount(initialCount + 1);
      await expect.poll(async () => {
        const owned = await ownedMarkerQuery.get();
        ownedMarkerId = owned.docs[0]?.id;
        return owned.size;
      }).toBe(1);
      // A linked portrait's image drag must not mask button drag behavior.
      await expect(marker.locator('img')).toHaveCount(0);
      const originalPosition = await markerOwner.evaluate((element) => ({ x: element.style.left, y: element.style.top }));
      await page.keyboard.press('Escape');
      await marker.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      const sourcePosition = await marker.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        for (const y of [0.5, 0.25, 0.75]) {
          for (const x of [0.5, 0.25, 0.75]) {
            const point = { x: rect.width * x, y: rect.height * y };
            if (document.elementFromPoint(rect.left + point.x, rect.top + point.y)?.closest('button') === element) return point;
          }
        }
        return null;
      });
      expect(sourcePosition).not.toBeNull();
      const currentMarkerPosition = await markerOwner.evaluate((element) => {
        const mapRect = element.closest('[data-echi-map]').getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 - mapRect.left, y: rect.top + rect.height / 2 - mapRect.top };
      });
      const targetPosition = await findClearMapPoint(currentMarkerPosition);
      expect(targetPosition).not.toBeNull();
      const sourceHit = await marker.evaluate((element, point) => {
        const rect = element.getBoundingClientRect();
        return document.elementFromPoint(rect.left + point.x, rect.top + point.y)?.closest('button') === element;
      }, sourcePosition);
      const targetHit = await art.evaluate((element, point) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + point.x, rect.top + point.y);
        return hit?.closest('[data-echi-map]') === element && !hit.closest('[data-echi-map] > div[draggable]');
      }, targetPosition);
      await attachJson(testInfo, 'task15a-native-marker-drag-hit-points', { creationPosition, sourcePosition, targetPosition, sourceHit, targetHit });
      expect(sourceHit).toBe(true);
      expect(targetHit).toBe(true);
      await marker.evaluate((element) => {
        element.__task15aNativeDragPayloads = [];
        // Observe after React's root listener has populated the native payload.
        element.__task15aNativeDragObserver = (event) => {
          if (event.target === element) element.__task15aNativeDragPayloads.push(event.dataTransfer.getData('text/plain'));
        };
        document.addEventListener('dragstart', element.__task15aNativeDragObserver);
      });
      await marker.dragTo(art, { sourcePosition, targetPosition });
      const nativeDragPayloads = await marker.evaluate((element) => element.__task15aNativeDragPayloads);
      await removeNativeDragObserver();
      expect(nativeDragPayloads).toHaveLength(1);
      expect(JSON.parse(nativeDragPayloads[0])).toEqual(expect.objectContaining({
        dragType: 'npc-marker-move', markerId: ownedMarkerId, scope: 'public', originMapId: 'art',
      }));
      await expect(moveHeading).toBeVisible();
      await expect(moveHeading.locator('..')).toContainText(temporaryName);
      await moveHeading.locator('..').getByRole('button', { name: 'Annulla', exact: true }).click();
      await expect(moveHeading).toHaveCount(0);
      expect(await markerOwner.evaluate((element) => ({ x: element.style.left, y: element.style.top }))).toEqual(originalPosition);
    } finally {
      try {
        await removeNativeDragObserver();
        // Cancel unfinished forms, then delete only this UUID-named pin through
        // its own UI. Admin reads prove ownership and server acknowledgement.
        for (const heading of [noteHeading, moveHeading]) {
          if (await heading.count()) await heading.locator('..').getByRole('button', { name: 'Annulla', exact: true }).click();
        }
        if (await marker.count()) {
          await expect.poll(async () => {
            const owned = await ownedMarkerQuery.get();
            ownedMarkerId = owned.docs[0]?.id;
            return owned.size;
          }).toBe(1);
          await marker.focus();
          await page.keyboard.press('Escape');
          await expect(marker).toBeFocused();
          // The controls extend beyond the pin's clear drag footprint. Use
          // their native tab order so nearby pins cannot intercept cleanup.
          for (const title of ['Elimina', 'Conferma']) {
            const control = markerOwner.getByTitle(title, { exact: true });
            await page.keyboard.press('Tab');
            await expect(control).toBeFocused();
            await expect(control).toBeVisible();
            await expect(control).toHaveCSS('opacity', '1');
            await expect(control).toBeInViewport();
            await page.keyboard.press('Enter');
          }
        }
        await expect(marker).toHaveCount(0);
        await expect.poll(async () => (await ownedMarkerQuery.get()).size).toBe(0);
        if (ownedMarkerId) await expect.poll(async () => (await serverMarkers.doc(ownedMarkerId).get()).exists).toBe(false);
        // The browser configuration runs one worker; wait for the emulator's
        // restored count, rather than accepting an optimistic local deletion.
        await expect.poll(async () => (await serverMarkers.count().get()).data().count).toBe(initialCount);
        await expect(allMarkers).toHaveCount(initialCount);
      } finally {
        await deleteApp(adminApp);
      }
    }
  });
});

for (const viewport of [{ width: 720, height: 500 }, { width: 320, height: 450 }]) {
  test(`Task 15A NPC create and edit cards stay reachable at ${viewport.width}x${viewport.height}`, async ({ browser, baseURL }, testInfo) => {
    await withEchi({ browser, baseURL }, testInfo, { viewport, role: 'dm' }, async ({ page }) => {
      const assertWithinViewport = async (locator) => {
        const bounds = await locator.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
      };
      const cancelCardWithKeyboard = async (title) => {
        const heading = page.getByRole('heading', { name: title, exact: true });
        const card = heading.locator('..');
        await expect(heading).toBeVisible();
        await assertWithinViewport(card);
        await assertWithinViewport(heading);
        expect(await card.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
        await card.getByPlaceholder('NPC notes...').focus();
        await page.keyboard.press('Tab');
        const cancel = card.getByRole('button', { name: 'Cancel', exact: true });
        await expect(cancel).toBeFocused();
        await expect.poll(() => card.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
        await assertWithinViewport(cancel);
        await page.keyboard.press('Enter');
        await expect(heading).toHaveCount(0);
      };

      await page.getByRole('button', { name: '+ Add NPC', exact: true }).click();
      await cancelCardWithKeyboard('Add NPC');
      const tile = page.locator('aside').getByRole('button', { name: /Fixture NPC 0\b/ });
      await tile.focus();
      await tile.press('ArrowDown');
      await page.getByRole('dialog', { name: 'NPC: Fixture NPC 0', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click();
      await cancelCardWithKeyboard('Edit NPC');
    });
  });
}

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

for (const selectedFormat of ['webp', 'png']) {
  test(`Task 15A native media selection reports ${selectedFormat} without replacing picture sources`, async ({ browser, baseURL }, testInfo) => {
    let releaseArt;
    const beforeFirstArt = new Promise((resolve) => { releaseArt = resolve; });
    const nativeMediaExclusions = selectedFormat === 'png' ? ['image/avif', 'image/webp'] : ['image/avif'];
    try {
      await withEchi({ browser, baseURL }, testInfo, { beforeFirstArt, releaseFirstArt: releaseArt, nativeMediaExclusions }, async ({ page, art, entries }) => {
        // Nonmatching media queries exercise the browser's own source skipping;
        // this does not claim that the engine lacks support for either MIME.
        const picture = await art.locator('picture').elementHandle();
        const image = await art.locator('picture img').elementHandle();
        const sources = await art.locator('picture source').elementHandles();
        const sourceUrls = await art.locator('picture source').evaluateAll((elements) => elements.map((source) => source.getAttribute('srcset')));
        await expect(art).toHaveAttribute('data-map-format', 'avif');
        releaseArt();
        await expect(art).toHaveAttribute('data-map-state', 'loaded');
        await expect(art).toHaveAttribute('data-map-format', selectedFormat);
        expect(await image.evaluate((element) => element.currentSrc)).toMatch(new RegExp(`\\.${selectedFormat}(?:[?#]|$)`));
        await page.setViewportSize({ width: 1180, height: 720 });
        await settleTraffic(page, entries);
        await expect(art).toHaveAttribute('data-map-state', 'loaded');
        await expect(art).toHaveAttribute('data-map-format', selectedFormat);
        expect(await art.locator('picture').evaluate((element, original) => element === original, picture)).toBe(true);
        expect(await art.locator('picture img').evaluate((element, original) => element === original, image)).toBe(true);
        expect(await art.locator('picture source').evaluateAll((elements, originals) => elements.length === originals.length && elements.every((element, index) => element === originals[index]), sources)).toBe(true);
        expect(await art.locator('picture source').evaluateAll((elements) => elements.map((source) => source.getAttribute('srcset')))).toEqual(sourceUrls);
        const artEntries = entries.filter(({ mapId }) => mapId === 'art');
        expect(artEntries.every(({ format }) => format === selectedFormat)).toBe(true);
        if (selectedFormat === 'png') expect(artEntries).toHaveLength(1);
      });
    } finally {
      releaseArt();
    }
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
