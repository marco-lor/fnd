import { getImageAssetRegistryRuntimeLimits } from '../common/imageAssets/imageAssetRegistry';
import {
  countDistinctTokenPortraitSources,
  getDecodedImageBytes,
  getTokenPortraitDecodedBytes,
  resolveTokenPortraitMaxEdge,
  TOKEN_PORTRAIT_EDGE_TIERS,
  TOKEN_PORTRAIT_OVER_BUDGET_EDGE,
} from './grigliataTokenPortraitBudget';

const MIB = 1024 * 1024;
const DESKTOP = getImageAssetRegistryRuntimeLimits({ compact: false });
const COMPACT = getImageAssetRegistryRuntimeLimits({ compact: true });
const MAP_9000_BYTES = getDecodedImageBytes(9000, 9000);

const totalWith = (mapBytes, sourceCount, edge) => (
  mapBytes + (sourceCount * getTokenPortraitDecodedBytes(edge))
);

describe('grigliataTokenPortraitBudget', () => {
  test('runs against the real runtime profiles', () => {
    expect(DESKTOP.maxTotalDecodedBytes).toBe(384 * MIB);
    expect(COMPACT.maxTotalDecodedBytes).toBe(320 * MIB);
    expect(MAP_9000_BYTES).toBe(324_000_000);
    expect(MAP_9000_BYTES / MIB).toBeCloseTo(308.99, 2);
  });

  test('the fixed 512px edge used to overbook a 9000px map with 100 portraits', () => {
    const fixedTotal = totalWith(MAP_9000_BYTES, 100, 512);
    expect(fixedTotal / MIB).toBeCloseTo(408.99, 2);
    expect(fixedTotal).toBeGreaterThan(DESKTOP.maxTotalDecodedBytes);
    expect(fixedTotal).toBeGreaterThan(COMPACT.maxTotalDecodedBytes);
  });

  test.each([
    { profile: 'desktop', limits: DESKTOP, expectedEdge: 384, expectedMiB: 365.24 },
    { profile: 'compact', limits: COMPACT, expectedEdge: 128, expectedMiB: 315.24 },
  ])('fits a 9000px map and 100 distinct portraits on $profile at $expectedEdge px', ({
    limits,
    expectedEdge,
    expectedMiB,
  }) => {
    const edge = resolveTokenPortraitMaxEdge({
      maxTotalDecodedBytes: limits.maxTotalDecodedBytes,
      requiredMapDecodedBytes: MAP_9000_BYTES,
      portraitSourceCount: 100,
    });

    expect(edge).toBe(expectedEdge);
    const total = totalWith(MAP_9000_BYTES, 100, edge);
    expect(total).toBeLessThanOrEqual(limits.maxTotalDecodedBytes);
    expect(total / MIB).toBeCloseTo(expectedMiB, 2);
    // Highest tier that fits: the next tier up would overbook.
    const higherTier = TOKEN_PORTRAIT_EDGE_TIERS[TOKEN_PORTRAIT_EDGE_TIERS.indexOf(edge) - 1];
    expect(totalWith(MAP_9000_BYTES, 100, higherTier)).toBeGreaterThan(limits.maxTotalDecodedBytes);
  });

  test.each([
    { label: 'no map', mapBytes: 0 },
    { label: 'a 2048px map', mapBytes: getDecodedImageBytes(2048, 2048) },
    { label: 'a 5000px map', mapBytes: getDecodedImageBytes(5000, 5000) },
  ])('keeps full 512px portraits beside $label when the budget permits', ({ mapBytes }) => {
    [DESKTOP, COMPACT].forEach((limits) => {
      expect(resolveTokenPortraitMaxEdge({
        maxTotalDecodedBytes: limits.maxTotalDecodedBytes,
        requiredMapDecodedBytes: mapBytes,
        portraitSourceCount: 100,
      })).toBe(TOKEN_PORTRAIT_EDGE_TIERS[0]);
    });
  });

  test('degrades to the floor, never to zero, when the map alone exceeds the budget', () => {
    [
      getDecodedImageBytes(9600, 9600),
      getDecodedImageBytes(12000, 12000),
      COMPACT.maxTotalDecodedBytes,
    ].forEach((mapBytes) => {
      expect(resolveTokenPortraitMaxEdge({
        maxTotalDecodedBytes: COMPACT.maxTotalDecodedBytes,
        requiredMapDecodedBytes: mapBytes,
        portraitSourceCount: 100,
      })).toBe(TOKEN_PORTRAIT_OVER_BUDGET_EDGE);
    });
    expect(TOKEN_PORTRAIT_OVER_BUDGET_EDGE).toBe(64);
  });

  test('uses the top tier when no portrait needs budget', () => {
    expect(resolveTokenPortraitMaxEdge({
      maxTotalDecodedBytes: COMPACT.maxTotalDecodedBytes,
      requiredMapDecodedBytes: MAP_9000_BYTES,
      portraitSourceCount: 0,
    })).toBe(512);
    expect(resolveTokenPortraitMaxEdge()).toBe(512);
  });

  test('downgrades immediately but upgrades only with slack (hysteresis)', () => {
    const base = {
      maxTotalDecodedBytes: DESKTOP.maxTotalDecodedBytes,
      requiredMapDecodedBytes: MAP_9000_BYTES,
    };
    // 75 MiB headroom: 512px fits up to 75 sources, with 10% slack up to 67.
    expect(resolveTokenPortraitMaxEdge({ ...base, portraitSourceCount: 75 })).toBe(512);
    expect(resolveTokenPortraitMaxEdge({ ...base, portraitSourceCount: 76 })).toBe(384);
    expect(resolveTokenPortraitMaxEdge({
      ...base, portraitSourceCount: 76, previousEdge: 512,
    })).toBe(384);
    // Back to 75 sources: 512 would fit, but not with slack, so 384 holds.
    expect(resolveTokenPortraitMaxEdge({
      ...base, portraitSourceCount: 75, previousEdge: 384,
    })).toBe(384);
    expect(resolveTokenPortraitMaxEdge({
      ...base, portraitSourceCount: 68, previousEdge: 384,
    })).toBe(384);
    expect(resolveTokenPortraitMaxEdge({
      ...base, portraitSourceCount: 67, previousEdge: 384,
    })).toBe(512);
    // A previous edge that no longer fits is never kept.
    expect(resolveTokenPortraitMaxEdge({
      ...base, portraitSourceCount: 140, previousEdge: 384,
    })).toBe(256);
  });

  test('counts each shared portrait source once and ignores tokens without media', () => {
    const tokens = [
      { tokenId: 'a', imageUrl: 'https://example.com/goblin.png' },
      { tokenId: 'b', imageUrl: 'https://example.com/goblin.png' },
      { tokenId: 'c', imageUrl: 'https://example.com/goblin.png' },
      { tokenId: 'd', imageUrl: 'https://example.com/orc.png' },
      { tokenId: 'e', imageUrl: '' },
      { tokenId: '', imageUrl: 'https://example.com/ghost.png' },
      null,
    ];
    expect(countDistinctTokenPortraitSources(tokens)).toBe(2);
    expect(countDistinctTokenPortraitSources(null)).toBe(0);

    // 100 goblins sharing art cost one portrait, so 512px still fits.
    const goblins = Array.from({ length: 100 }, (_, index) => ({
      tokenId: `goblin-${index}`,
      imageUrl: 'https://example.com/goblin.png',
    }));
    expect(resolveTokenPortraitMaxEdge({
      maxTotalDecodedBytes: COMPACT.maxTotalDecodedBytes,
      requiredMapDecodedBytes: MAP_9000_BYTES,
      portraitSourceCount: countDistinctTokenPortraitSources(goblins),
    })).toBe(512);
  });

  test('every tier choice stays within budget across counts and profiles', () => {
    [DESKTOP, COMPACT].forEach((limits) => {
      [0, getDecodedImageBytes(4096, 4096), MAP_9000_BYTES, getDecodedImageBytes(9150, 9150)].forEach((mapBytes) => {
        for (let count = 1; count <= 400; count += 1) {
          const edge = resolveTokenPortraitMaxEdge({
            maxTotalDecodedBytes: limits.maxTotalDecodedBytes,
            requiredMapDecodedBytes: mapBytes,
            portraitSourceCount: count,
          });
          expect(TOKEN_PORTRAIT_EDGE_TIERS).toContain(edge);
          expect(totalWith(mapBytes, count, edge)).toBeLessThanOrEqual(limits.maxTotalDecodedBytes);
        }
      });
    });
  });
});
