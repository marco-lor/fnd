import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  FOG_RASTER_TILE_MASK_BYTES,
  FOG_RASTER_TILE_SAMPLE_SIZE,
  buildFogRasterTileDocId,
  buildFogRasterTilePayload,
  countFogRasterMaskBits,
  createEmptyFogRasterMaskBytes,
  decodeFogRasterTileKey,
  decodeFogRasterMaskBase64,
  encodeFogRasterMaskBase64,
  maskContainsFogRasterBits,
  mergeFogRasterTileMasks,
  normalizeFogRasterMemoryTileDoc,
  rasterizeFogPolygonsToTiles,
  subtractFogRasterTileMasks,
} from './fogRasterMemory';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const hasDirectNestedArray = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => Array.isArray(item) || hasDirectNestedArray(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasDirectNestedArray);
  }
  return false;
};

describe('fogRasterMemory', () => {
  test('encodes fixed-size bitsets as Firestore-safe strings', () => {
    const maskBytes = createEmptyFogRasterMaskBytes();
    maskBytes[0] = 0b00000101;
    maskBytes[17] = 0b10000000;

    const encoded = encodeFogRasterMaskBase64(maskBytes);
    const decoded = decodeFogRasterMaskBase64(encoded);

    expect(decoded).toEqual(maskBytes);
    expect(decoded).toHaveLength(FOG_RASTER_TILE_MASK_BYTES);
    expect(countFogRasterMaskBits(decoded)).toBe(3);

    const payload = buildFogRasterTilePayload({
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      tileKey: '0:0',
      tileCol: 0,
      tileRow: 0,
      grid,
      maskBytes,
      updatedAt: { __type: 'serverTimestamp' },
      updatedBy: 'user-1',
    });

    expect(payload).toEqual(expect.objectContaining({
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      tileKey: '0:0',
      tileCol: 0,
      tileRow: 0,
      rasterProfileId: FOG_RASTER_PROFILE_ID,
      maskEncoding: FOG_RASTER_MASK_ENCODING,
      maskBase64: encoded,
    }));
    expect(hasDirectNestedArray(payload)).toBe(false);
  });

  test('merges and subtracts masks without losing unrelated memory', () => {
    const existingMask = createEmptyFogRasterMaskBytes();
    const revealMask = createEmptyFogRasterMaskBytes();
    const hideMask = createEmptyFogRasterMaskBytes();
    existingMask[0] = 0b00000011;
    revealMask[0] = 0b00001100;
    hideMask[0] = 0b00000110;

    const merged = mergeFogRasterTileMasks(existingMask, revealMask);
    const hidden = subtractFogRasterTileMasks(merged, hideMask);

    expect(merged[0]).toBe(0b00001111);
    expect(hidden[0]).toBe(0b00001001);
    expect(maskContainsFogRasterBits(merged, existingMask)).toBe(true);
    expect(maskContainsFogRasterBits(existingMask, revealMask)).toBe(false);
  });

  test('rasterizes smooth polygons into bounded tile docs', () => {
    const tiles = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      grid,
      polygons: [[[
        { x: 0, y: 0 },
        { x: 280, y: 0 },
        { x: 280, y: 280 },
        { x: 0, y: 280 },
      ]]],
    });

    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toEqual(expect.objectContaining({
      id: buildFogRasterTileDocId({
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        tileKey: '0:0',
      }),
      tileKey: '0:0',
      tileCol: 0,
      tileRow: 0,
    }));
    expect(tiles[0].maskBytes).toHaveLength(FOG_RASTER_TILE_MASK_BYTES);
    expect(countFogRasterMaskBits(tiles[0].maskBytes)).toBeGreaterThan(0);
  });

  test('builds and decodes tile ids with negative coordinates', () => {
    expect(decodeFogRasterTileKey('3:-1')).toEqual({
      tileCol: 3,
      tileRow: -1,
    });
    expect(decodeFogRasterTileKey('-2:-1')).toEqual({
      tileCol: -2,
      tileRow: -1,
    });
    expect(buildFogRasterTileDocId({
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      tileKey: '3:-1',
    })).toBe('map-1__user-1__fog-raster-c8-s16-v1__3:-1');
  });

  test('preserves exact tile bytes at sloped edges, hole boundaries and overlapping reveals', () => {
    const shiftedGrid = { cellSizePx: 32, offsetXPx: 5, offsetYPx: -7 };
    // Put each vertex exactly on a sample center, spanning the tile boundary at column zero.
    const ring = (coords) => coords.map(([col, row]) => ({
      x: shiftedGrid.offsetXPx + (col * 2) + 1,
      y: shiftedGrid.offsetYPx + (row * 2) + 1,
    }));
    const tiles = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'viewer',
      grid: shiftedGrid,
      polygons: [
        [
          ring([[-2, 0], [4, 0], [4, 5], [2, 5], [-2, 1]]),
          ring([[0, 1], [2, 1], [2, 3], [0, 3]]),
        ],
        [ring([[1, 2], [3, 2], [1, 4]])],
      ],
    });

    const bytesPerRow = FOG_RASTER_TILE_SAMPLE_SIZE / 8;
    const expectedLeft = createEmptyFogRasterMaskBytes();
    [0b11000000, 0b11000000, 0b10000000].forEach((byte, row) => {
      expectedLeft[(row + 1) * bytesPerRow - 1] = byte;
    });
    const expectedRight = createEmptyFogRasterMaskBytes();
    [0b11111, 0b11000, 0b11110, 0b11110, 0b11110, 0b11100].forEach((byte, row) => {
      expectedRight[row * bytesPerRow] = byte;
    });
    expect(tiles.map((tile) => tile.tileKey)).toEqual(['-1:0', '0:0']);
    expect(tiles.map((tile) => tile.maskBytes)).toEqual([expectedLeft, expectedRight]);
  });

  test.each([
    [0.00005, false],
    [0.0002, true],
  ])('preserves segment tolerance for a short hole edge %s px above the sample', (gap, visible) => {
    const [tile] = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'viewer',
      grid: { cellSizePx: 32, offsetXPx: 0, offsetYPx: 0 },
      polygons: [[
        [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 12 }, { x: 0, y: 12 }],
        [{ x: 4.995, y: 3 + gap }, { x: 5.005, y: 3 + gap }, { x: 5, y: 9 }],
      ]],
    });
    // With samples every 2 px, (5, 3) is bit 2 of the second row.
    expect(Boolean(tile.maskBytes[FOG_RASTER_TILE_SAMPLE_SIZE / 8] & (1 << 2))).toBe(visible);
  });

  test('normalizes Firestore tile docs with base64 masks', () => {
    const maskBytes = createEmptyFogRasterMaskBytes();
    maskBytes[0] = 1;
    const normalized = normalizeFogRasterMemoryTileDoc({
      id: 'map-1__user-1__fog-raster-c8-s16-v1__0:0',
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      tileKey: '0:0',
      tileCol: 0,
      tileRow: 0,
      rasterProfileId: FOG_RASTER_PROFILE_ID,
      tileSizeCells: 8,
      samplesPerCell: 16,
      cellSizePx: 70,
      offsetXPx: 0,
      offsetYPx: 0,
      maskEncoding: FOG_RASTER_MASK_ENCODING,
      maskBase64: encodeFogRasterMaskBase64(maskBytes),
      updatedBy: 'user-1',
    });

    expect(normalized).toEqual(expect.objectContaining({
      id: 'map-1__user-1__fog-raster-c8-s16-v1__0:0',
      maskBytes,
    }));
  });
});
