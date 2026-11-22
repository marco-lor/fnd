import {
  FOG_RASTER_MASK_ENCODING,
  FOG_RASTER_PROFILE_ID,
  FOG_RASTER_SAMPLES_PER_CELL,
  FOG_RASTER_TILE_MASK_BYTES,
  FOG_RASTER_TILE_SAMPLE_SIZE,
  buildFogRasterMemoryAtlases,
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

test('atlas reuse skips unchanged snapshot masks and detects edits to caller-owned bytes', () => {
  const bytes = createEmptyFogRasterMaskBytes();
  bytes[bytes.length - 1] = 1;
  const payload = buildFogRasterTilePayload({
    backgroundId: 'map', ownerUid: 'player', tileKey: '0:0', grid, maskBytes: bytes,
  });
  const snapshot = normalizeFogRasterMemoryTileDoc(payload, { immutableSnapshot: true });
  const checkOccupancy = jest.spyOn(snapshot.maskBytes, 'some');
  const first = buildFogRasterMemoryAtlases({ grid, memoryTiles: [snapshot] });
  expect(buildFogRasterMemoryAtlases({ grid, memoryTiles: [snapshot], previousAtlases: first })[0]).toBe(first[0]);
  expect(checkOccupancy).not.toHaveBeenCalled();

  const local = normalizeFogRasterMemoryTileDoc(payload);
  const previous = buildFogRasterMemoryAtlases({ grid, memoryTiles: [local] });
  local.maskBytes[0] = 2;
  const next = buildFogRasterMemoryAtlases({ grid, memoryTiles: [local], previousAtlases: previous });
  expect(next[0].image).not.toBe(previous[0].image);
  expect(previous[0].bitCount).toBe(1);
  expect(next[0].bitCount).toBe(2);
});

const hasDirectNestedArray = (value) => {
  if (Array.isArray(value)) {
    return value.some((item) => Array.isArray(item) || hasDirectNestedArray(item));
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasDirectNestedArray);
  }
  return false;
};

const getSampleMask = (masks, col, row) => {
  const tileCol = Math.floor(col / FOG_RASTER_TILE_SAMPLE_SIZE);
  const tileRow = Math.floor(row / FOG_RASTER_TILE_SAMPLE_SIZE);
  const key = `${tileCol}:${tileRow}`;
  masks[key] ||= createEmptyFogRasterMaskBytes();
  const bitIndex = ((row - (tileRow * FOG_RASTER_TILE_SAMPLE_SIZE)) * FOG_RASTER_TILE_SAMPLE_SIZE)
    + (col - (tileCol * FOG_RASTER_TILE_SAMPLE_SIZE));
  return { bytes: masks[key], byte: bitIndex >> 3, bit: 1 << (bitIndex & 7) };
};

const encodeMasks = (masks) => Object.fromEntries(Object.entries(masks)
  .filter(([, bytes]) => bytes.some(Boolean))
  .map(([key, bytes]) => [key, encodeFogRasterMaskBase64(bytes)]));

const encodeTiles = (tiles) => Object.fromEntries(tiles.map((tile) => [
  tile.tileKey,
  encodeFogRasterMaskBase64(tile.maskBytes),
]));

// Per-sample oracle: every sample centre within the scene bounds is tested
// against every edge. Outer edges are inside, hole edges are outside, and an
// edge accepts points within its tolerance, in squared world units.
const pointIsOnEdge = (x, y, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = ((y - start.y) * dx) - ((x - start.x) * dy);
  const dot = ((x - start.x) * dx) + ((y - start.y) * dy);
  return Math.abs(cross) <= 1e-6 && dot >= -1e-6 && dot <= (dx * dx) + (dy * dy) + 1e-6;
};

const pointIsInRing = (x, y, ring) => {
  let isInside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[(index + ring.length - 1) % ring.length];
    const end = ring[index];
    if (start.x !== end.x || start.y !== end.y) {
      if (pointIsOnEdge(x, y, start, end)) {
        return true;
      }
      if ((start.y > y) !== (end.y > y)
        && x < (((end.x - start.x) * (y - start.y)) / (end.y - start.y)) + start.x) {
        isInside = !isInside;
      }
    }
  }
  return isInside;
};

const rasterizeBySampling = ({ grid: { cellSizePx, offsetXPx, offsetYPx }, polygons }) => {
  const sampleSizePx = cellSizePx / FOG_RASTER_SAMPLES_PER_CELL;
  const points = polygons.flat(2);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const masks = {};
  for (let row = Math.floor((minY - offsetYPx) / sampleSizePx); row * sampleSizePx <= maxY - offsetYPx; row += 1) {
    const y = offsetYPx + ((row + 0.5) * sampleSizePx);
    for (let col = Math.floor((minX - offsetXPx) / sampleSizePx); col * sampleSizePx <= maxX - offsetXPx; col += 1) {
      const x = offsetXPx + ((col + 0.5) * sampleSizePx);
      const isLit = x >= minX && x <= maxX && y >= minY && y <= maxY
        && polygons.some(([outer, ...holes]) => (
          pointIsInRing(x, y, outer) && !holes.some((hole) => pointIsInRing(x, y, hole))
        ));
      if (isLit) {
        const { bytes, byte, bit } = getSampleMask(masks, col, row);
        bytes[byte] |= bit;
      }
    }
  }
  return encodeMasks(masks);
};

const createSeededRandom = (initialSeed) => {
  let seed = initialSeed;
  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
};

// Vertices mix sample centres, sample boundaries, near misses and free floats,
// so edges run along sample rows, through centres and just past them.
const buildDifferentialCase = (random) => {
  const pick = (items) => items[Math.floor(random() * items.length)];
  const caseGrid = {
    cellSizePx: pick([12, 32, 50, 70]),
    offsetXPx: pick([0, 5, -37]),
    offsetYPx: pick([0, -7, 23]),
  };
  const sampleSizePx = caseGrid.cellSizePx / FOG_RASTER_SAMPLES_PER_CELL;
  const coordinate = (originPx, px) => {
    const center = (Math.round(px / sampleSizePx) + 0.5) * sampleSizePx;
    return originPx + pick([center, center - (sampleSizePx / 2), center + pick([-5e-5, 5e-5, 1e-9]), px]);
  };
  const ring = (cx, cy, radius) => {
    const count = 3 + Math.floor(random() * 7);
    const points = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      const distance = radius * (0.4 + random());
      return {
        x: coordinate(caseGrid.offsetXPx, cx + (Math.cos(angle) * distance)),
        y: coordinate(caseGrid.offsetYPx, cy + (Math.sin(angle) * distance)),
      };
    });
    if (random() < 0.3) {
      // A short edge's tolerance reaches well beyond its length.
      points.splice(1, 0, { x: points[0].x + pick([1e-3, 1e-5]), y: points[0].y });
    }
    return points;
  };
  // Footprints straddle the tile boundary at the grid origin.
  const polygons = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
    const cx = (random() - 0.5) * caseGrid.cellSizePx * 3;
    const cy = (random() - 0.5) * caseGrid.cellSizePx * 3;
    const radius = caseGrid.cellSizePx * (0.3 + random());
    return random() < 0.5
      ? [ring(cx, cy, radius), ring(cx, cy, radius * 0.4)]
      : [ring(cx, cy, radius)];
  });
  return { grid: caseGrid, polygons };
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

  test('visits local tiles for footprints separated by thousands of tiles in both axes', () => {
    const squareAt = (x, y) => [[
      { x, y },
      { x: x + 8, y },
      { x: x + 8, y: y + 8 },
      { x, y: y + 8 },
    ]];
    const tiles = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'viewer',
      grid: { cellSizePx: 32, offsetXPx: 0, offsetYPx: 0 },
      polygons: [squareAt(768000, 896000), squareAt(-512000, -256000)],
    });

    expect(tiles.map((tile) => tile.tileKey)).toEqual(['-2000:-1000', '3000:3500']);
    expect(tiles.map((tile) => countFogRasterMaskBits(tile.maskBytes))).toEqual([16, 16]);
  });

  test('preserves segment tolerance just outside a footprint within the scene bounds', () => {
    const [tile] = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'viewer',
      grid: { cellSizePx: 32, offsetXPx: 0, offsetYPx: 0 },
      polygons: [
        [[{ x: 0, y: 0 }, { x: 4.99995, y: 2.995 }, { x: 4.99995, y: 3.005 }, { x: 0, y: 6 }]],
        [[{ x: 16, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 6 }, { x: 16, y: 6 }]],
      ],
    });

    // (5, 3) is within the first ring's edge tolerance.
    expect(tile.maskBytes[FOG_RASTER_TILE_SAMPLE_SIZE / 8] & (1 << 2)).toBe(1 << 2);
  });

  test('writes outer edges and clears hole edges as byte runs across a negative tile corner', () => {
    // One-pixel samples: sample (col, row) is centred on (3 + col + 0.5, -5 + row + 0.5).
    const at = (col, row) => ({ x: 3 + col + 0.5, y: -5 + row + 0.5 });
    const rect = ([left, top], [right, bottom]) => [at(left, top), at(right, top), at(right, bottom), at(left, bottom)];
    const tiles = rasterizeFogPolygonsToTiles({
      backgroundId: 'map-1',
      ownerUid: 'viewer',
      grid: { cellSizePx: 16, offsetXPx: 3, offsetYPx: -5 },
      polygons: [[rect([-20, -3], [141, 5]), rect([-3, 0], [9, 2])]],
    });

    const expected = {};
    const fill = ([left, top], [right, bottom], isLit) => {
      for (let row = top; row <= bottom; row += 1) {
        for (let col = left; col <= right; col += 1) {
          const { bytes, byte, bit } = getSampleMask(expected, col, row);
          bytes[byte] = isLit ? bytes[byte] | bit : bytes[byte] & ~bit;
        }
      }
    };
    fill([-20, -3], [141, 5], true);
    fill([-3, 0], [9, 2], false);
    expect(tiles.map((tile) => tile.tileKey)).toEqual(['-1:-1', '0:-1', '1:-1', '-1:0', '0:0', '1:0']);
    expect(encodeTiles(tiles)).toEqual(encodeMasks(expected));
  });

  test('matches the per-sample oracle on a disc around a tile corner with a pillar and an overlapping reveal', () => {
    // Samples are 2 px apart and centred on even coordinates; tiles meet at (-251, -7).
    const shiftedGrid = { cellSizePx: 32, offsetXPx: 5, offsetYPx: -7 };
    const disc = Array.from({ length: 48 }, (_, index) => ({
      x: -248.3 + (Math.cos((index / 48) * Math.PI * 2) * 140),
      y: -3.7 + (Math.sin((index / 48) * Math.PI * 2) * 140),
    }));
    const pillar = [{ x: -260, y: -40 }, { x: -210, y: -40 }, { x: -210, y: 20 }, { x: -260, y: 20 }];
    const input = {
      grid: shiftedGrid,
      polygons: [
        [disc, pillar],
        [[{ x: -150, y: -100 }, { x: -60, y: -20 }, { x: -170, y: 60 }]],
      ],
    };

    const tiles = rasterizeFogPolygonsToTiles({ backgroundId: 'map-1', ownerUid: 'viewer', ...input });

    expect(tiles.map((tile) => tile.tileKey)).toEqual(['-2:-1', '-1:-1', '-2:0', '-1:0']);
    expect(encodeTiles(tiles)).toEqual(rasterizeBySampling(input));
  });

  test('matches the per-sample oracle on seeded edge-aligned and near-miss polygons', () => {
    const random = createSeededRandom(20261121);
    for (let index = 0; index < 40; index += 1) {
      const input = buildDifferentialCase(random);
      const tiles = rasterizeFogPolygonsToTiles({ backgroundId: 'map-1', ownerUid: 'viewer', ...input });
      expect({ index, tiles: encodeTiles(tiles) }).toEqual({ index, tiles: rasterizeBySampling(input) });
    }
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
