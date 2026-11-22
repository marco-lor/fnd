const {expect} = require('@playwright/test');
const {PNG} = require('playwright-core/lib/utilsBundle');
const {waitForImageRegistrySettlement, waitForReadiness} = require('./helpers');

const TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT = 200;
// The fixture places 20 tokens per row. The leftmost columns listed below
// intersect perf-player's starting vision in the seeded fog and lighting state.
const PLAYER_VISIBLE_ROW_LENGTHS = [13, 13, 13, 13, 12, 12, 12, 11, 10, 9];
const playerTokenIds = PLAYER_VISIBLE_ROW_LENGTHS.flatMap((length, row) => (
  Array.from({length}, (_, col) => `perf-token-${String(row * 20 + col).padStart(4, '0')}`)
));
const TASK07_GRIGLIATA_PLAYER_VISIBLE_COUNT = playerTokenIds.length;

// Fixture: 200 tokens, token N uses performance/image-(N % 128), so the board
// mixes distinct art (128 sources) with repeated art (72 tokens share a source).
const TASK07_GRIGLIATA_FIXTURE_DISTINCT_TOKEN_IMAGES = 128;
const TASK07_GRIGLIATA_LOW_ZOOM_MAX_PORTRAIT_PX = 16;

const expectedFixturePortraitPath = (tokenId) => {
  const match = /^perf-token-(\d+)$/.exec(tokenId);
  if (!match || Number(match[1]) >= TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT) {
    throw new Error(`Unexpected Grigliata fixture token: ${tokenId}`);
  }
  const imageIndex = Number(match[1]) % TASK07_GRIGLIATA_FIXTURE_DISTINCT_TOKEN_IMAGES;
  return encodeURIComponent(`performance/image-${String(imageIndex).padStart(3, '0')}.png`);
};

// Inspects only the named portrait node (never status-badge images) of every
// rendered token node, and whether that token intersects the visible stage.
const inspectBoardPortraits = () => {
  const stages = Array.isArray(window.Konva?.stages) ? window.Konva.stages : [];
  return stages.flatMap((stage) => Array.from(stage.find((node) => (
    String(node.getAttr?.('data-testid') || '').startsWith('token-node-')
  ))).map((token) => {
    const portraits = Array.from(token.find('.token-portrait'));
    const portrait = portraits[0] || null;
    const footprint = portrait || token.findOne('.token-portrait-placeholder') || token;
    const rect = footprint.getClientRect({skipStroke: true, skipShadow: true});
    const image = portrait?.image?.() || null;
    const isThumbnail = image instanceof HTMLCanvasElement && image.dataset.fndDrawable === 'bounded-canvas';
    const sourceLoaded = isThumbnail
      ? image.width > 0 && image.height > 0 && !!image.dataset.fndSourceSrc
      : image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    return {
      tokenId: String(token.getAttr('data-testid')).slice('token-node-'.length),
      onStage: token.isVisible()
        && rect.width > 0
        && rect.height > 0
        && rect.x + rect.width >= 0
        && rect.y + rect.height >= 0
        && rect.x <= stage.width()
        && rect.y <= stage.height(),
      portraitCount: portraits.length,
      placeholderCount: token.find('.token-portrait-placeholder').length,
      loaded: sourceLoaded
        && portrait.isVisible() && portrait.getAbsoluteOpacity() > 0
        && portrait.width() * portrait.getAbsoluteScale().x > 0
        && portrait.height() * portrait.getAbsoluteScale().y > 0,
      src: isThumbnail ? image.dataset.fndSourceSrc : String(image?.currentSrc || image?.src || ''),
      screenSizePx: portrait
        ? portrait.width() * portrait.getAbsoluteScale().x
        : rect.width,
    };
  }));
};

const summarizeBoardPortraits = (tokens) => {
  const onStage = tokens.filter((token) => token.onStage);
  const missing = onStage.filter((token) => (
    token.portraitCount !== 1 || token.placeholderCount !== 0 || !token.loaded
  ));
  return {
    rendered: tokens.length,
    onStage: onStage.length,
    missing: missing.length,
    missingSample: missing.slice(0, 5).map(({tokenId}) => tokenId),
    largestPortraitPx: Math.max(0, ...onStage.map(({screenSizePx}) => screenSizePx)),
  };
};

// Waits until every on-stage token shows its loaded portrait at the low-zoom
// fit. A partial initial load, an empty board, or a not-yet-fitted (large)
// viewport never satisfies this.
const waitForAllVisibleBoardPortraits = async (page, {
  expectedOnStage = null,
  timeoutMs = 30_000,
} = {}) => {
  const deadline = Date.now() + timeoutMs;
  let latest = [];
  while (Date.now() < deadline) {
    latest = await page.evaluate(inspectBoardPortraits);
    const summary = summarizeBoardPortraits(latest);
    if (
      summary.onStage > 0
      && (expectedOnStage === null || summary.onStage === expectedOnStage)
      && summary.missing === 0
      && summary.largestPortraitPx < TASK07_GRIGLIATA_LOW_ZOOM_MAX_PORTRAIT_PX
    ) {
      return latest;
    }
    await page.waitForTimeout(100);
  }
  const observed = summarizeBoardPortraits(latest);
  throw new Error(`Grigliata portraits did not settle at low zoom. ${JSON.stringify({expectedOnStage, ...observed})}`);
};

const assertAllVisibleBoardPortraits = (tokens, {role, limits}) => {
  const onStage = tokens.filter((token) => token.onStage);
  expect(new Set(onStage.map(({tokenId}) => tokenId)).size).toBe(onStage.length);
  if (role === 'dm') {
    expect(onStage).toHaveLength(TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT);
  } else {
    expect(sortedTokenIds(onStage)).toEqual(playerTokenIds);
    // Fog keeps part of the fixture off the player's board, while the visible
    // set still exceeds the old token-ID media budget (maxRecords - 24).
    expect(tokens.length).toBeLessThan(TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT);
    expect(onStage.length).toBeGreaterThan(limits.maxRecords - 24);
  }
  onStage.forEach((token) => {
    expect(token, token.tokenId).toMatchObject({
      portraitCount: 1,
      placeholderCount: 0,
      loaded: true,
    });
    expect(token.screenSizePx, token.tokenId)
      .toBeLessThan(TASK07_GRIGLIATA_LOW_ZOOM_MAX_PORTRAIT_PX);
    expect(token.src, token.tokenId).toContain(expectedFixturePortraitPath(token.tokenId));
  });
  const distinctSources = new Set(onStage.map(({src}) => src));
  if (role === 'dm') {
    // Both repeated and distinct art, each beyond the old token-ID budget.
    expect(distinctSources.size).toBe(TASK07_GRIGLIATA_FIXTURE_DISTINCT_TOKEN_IMAGES);
    expect(distinctSources.size).toBeGreaterThan(limits.maxRecords);
    expect(onStage.length).toBeGreaterThan(distinctSources.size);
  }
  return distinctSources;
};

const sortedTokenIds = (tokens) => tokens.map(({tokenId}) => tokenId).sort();

// A screenshot can sample a Storage image composited by the browser even
// when the cross-origin canvas itself does not permit getImageData().
const assertBoundedPortraitPixels = async (page, portraits) => {
  const expectedSources = new Set(portraits.filter(({onStage, tokenId}) => (
    onStage && Number(tokenId.slice('perf-token-'.length)) % 128 >= 120
  )).map(({src}) => src));
  const samples = await page.evaluate(() => {
    const drawables = new Set(window.Konva.stages.flatMap((stage) => (
      Array.from(stage.find('.token-portrait')).map((node) => node.image())
        .filter((image) => image instanceof HTMLCanvasElement)
    )));
    if (!drawables.size) return [];
    const strip = document.createElement('canvas');
    strip.id = 'grigliata-fixture-pixels';
    strip.width = 4 * drawables.size;
    strip.height = 4;
    strip.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;background:magenta;pointer-events:none';
    const context = strip.getContext('2d');
    context.imageSmoothingEnabled = false;
    const result = Array.from(drawables, (image, index) => {
      const src = image.dataset.fndSourceSrc;
      const seed = Number(src.match(/image-(\d+)\.png/)[1]);
      const ratioX = Number(image.dataset.fndSourceWidth) / image.width;
      const ratioY = Number(image.dataset.fndSourceHeight) / image.height;
      const y = 7;
      const sy = (y + 0.5) * ratioY - 0.5;
      for (let x = 1; x < image.width; x += 1) {
        const sx = (x + 0.5) * ratioX - 0.5;
        // RGB from fixtures.js buildDeterministicPng. Stay clear of wraparound
        // so differences in downsampling kernels have only a small effect.
        const rgb = [seed * 29 + sx * 3 + sy, seed * 47 + sx + sy * 2, seed * 71 + sx * 2 + sy * 3]
          .map((value) => Math.round(value) % 256);
        if (!rgb.every((channel) => channel >= 24 && channel <= 231)) continue;
        context.drawImage(image, x, y, 1, 1, index * 4, 0, 4, 4);
        return {src, rgb};
      }
      throw new Error(`No fixture pixel available for ${src}`);
    });
    document.body.appendChild(strip);
    return result;
  });
  try {
    expect(new Set(samples.map(({src}) => src))).toEqual(expectedSources);
    if (!samples.length) return;
    const screenshot = await page.locator('#grigliata-fixture-pixels').screenshot({scale: 'css'});
    const {data, width} = PNG.sync.read(screenshot);
    samples.forEach(({rgb, src}, i) => {
      const offset = 4 * (2 * width + i * 4 + 2);
      rgb.forEach((value, channel) => {
        expect(Math.abs(data[offset + channel] - value), src).toBeLessThanOrEqual(12);
      });
    });
  } finally {
    await page.evaluate(() => document.getElementById('grigliata-fixture-pixels')?.remove());
  }
};

const readBoardView = () => {
  const stage = window.Konva.stages.find((item) => item.findOne('.token-portrait'));
  const bounds = stage.container().getBoundingClientRect();
  return {
    x: stage.x(), y: stage.y(), scale: stage.scaleX(),
    width: stage.width(), height: stage.height(),
    centerX: bounds.left + bounds.width / 2, centerY: bounds.top + bounds.height / 2,
  };
};

const assertPortraitsAfterNavigation = async (page, initialPortraits) => {
  const expectedIds = sortedTokenIds(initialPortraits);
  const initial = await page.evaluate(readBoardView);
  await page.mouse.move(initial.centerX, initial.centerY);
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await page.evaluate(readBoardView)).scale).toBeGreaterThan(initial.scale);
  const zoomed = await page.evaluate(readBoardView);
  await page.mouse.down({button: 'right'});
  await page.mouse.move(initial.centerX + 20, initial.centerY + 15, {steps: 3});
  await page.mouse.up({button: 'right'});
  await expect.poll(async () => (await page.evaluate(readBoardView)).x).toBeGreaterThan(zoomed.x);
  const view = await page.evaluate(readBoardView);
  const cell = 50 * view.scale;
  const expectedOnStage = expectedIds.filter((id) => {
    const index = Number(id.slice('perf-token-'.length));
    const left = view.x + (index % 20) * cell;
    const top = view.y + Math.floor(index / 20) * cell;
    return left + cell >= 0 && left <= view.width && top + cell >= 0 && top <= view.height;
  });
  const moved = await waitForAllVisibleBoardPortraits(page, {expectedOnStage: expectedOnStage.length});
  expect(sortedTokenIds(moved)).toEqual(expectedIds);
  expect(sortedTokenIds(moved.filter(({onStage}) => onStage))).toEqual(expectedOnStage);
  for (const token of moved.filter(({onStage}) => onStage)) {
    expect(token.src, token.tokenId).toContain(expectedFixturePortraitPath(token.tokenId));
  }

  await page.reload({waitUntil: 'domcontentloaded'});
  await waitForReadiness(page, {expectedPathname: '/grigliata', timeoutMs: 30_000});
};

const isRegistryWithinCacheBudget = (registry) => {
  if (!registry?.limits) return false;
  const referencedUnpinnedRecords = registry.unpinnedRecordCount - registry.idleRecordCount;
  const referencedUnpinnedBytes = registry.unpinnedDecodedBytes - registry.idleDecodedBytes;
  return Number.isInteger(registry.idleRecordCount)
    && Number.isFinite(registry.idleDecodedBytes)
    && registry.idleRecordCount <= Math.max(0, registry.limits.maxRecords - referencedUnpinnedRecords)
    && registry.idleDecodedBytes <= Math.max(0, registry.limits.maxDecodedBytes - referencedUnpinnedBytes)
    && registry.decodedBytes <= registry.limits.maxTotalDecodedBytes;
};

// Leased (on-screen) records are never evicted; the unpinned record/byte caps
// bound what stays cached while idle. Released records keep a short protection
// window, so wait for the trim to apply before asserting the budget.
const waitForRegistryCacheBudget = async (page, {timeoutMs = 15_000} = {}) => {
  const deadline = Date.now() + timeoutMs;
  let registry = null;
  while (Date.now() < deadline) {
    registry = await page.evaluate(() => (
      window.__FND_PERF_BENCHMARKS__?.getImageRegistryStats?.() || null
    ));
    if (
      isRegistryWithinCacheBudget(registry)
      && registry.activeRequestCount === 0
      && registry.queuedRequestCount === 0
    ) {
      return registry;
    }
    await page.waitForTimeout(100);
  }
  return registry;
};

const assertSettledBoardPortraits = async (page, {role, expectedOnStage}) => {
  const initialPortraits = await waitForAllVisibleBoardPortraits(page, {expectedOnStage});
  await waitForImageRegistrySettlement(page, {minimumLoadedRecords: 1});
  const registry = await waitForRegistryCacheBudget(page);
  // Portraits must survive registry settlement, not just appear transiently.
  const portraits = await page.evaluate(inspectBoardPortraits);
  expect(summarizeBoardPortraits(portraits)).toEqual(summarizeBoardPortraits(initialPortraits));
  const distinctSources = assertAllVisibleBoardPortraits(portraits, {
    role,
    limits: registry.limits,
  });
  await assertBoundedPortraitPixels(page, portraits);
  // Every distinct visible portrait holds a live lease; only idle records are
  // subject to (and within) the unpinned cache caps.
  expect(registry.referencedRecordCount).toBeGreaterThanOrEqual(distinctSources.size);
  expect(isRegistryWithinCacheBudget(registry)).toBe(true);
  expect(registry.activeRequestCount).toBe(0);
  expect(registry.queuedRequestCount).toBe(0);
  return {registry, portraits};
};

const assertBoardPortraitsAndCacheBudget = async (page, options) => {
  const initial = await assertSettledBoardPortraits(page, options);
  await assertPortraitsAfterNavigation(page, initial.portraits);
  return assertSettledBoardPortraits(page, options);
};

module.exports = {
  assertBoardPortraitsAndCacheBudget, assertSettledBoardPortraits,
  TASK07_GRIGLIATA_FIXTURE_TOKEN_COUNT, TASK07_GRIGLIATA_PLAYER_VISIBLE_COUNT,
};
