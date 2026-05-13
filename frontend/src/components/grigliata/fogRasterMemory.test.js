import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  FOG_RASTER_TILE_MASK_BYTES,
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
