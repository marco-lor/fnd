import { normalizeGridConfig } from './boardUtils';

export const GRIGLIATA_FOG_MEMORY_TILES_COLLECTION = 'grigliata_fog_memory_tiles';
export const GRIGLIATA_FOG_MEMORY_TILE_SCHEMA_VERSION = 1;
export const FOG_RASTER_TILE_SIZE_CELLS = 8;
export const FOG_RASTER_SAMPLES_PER_CELL = 16;
export const FOG_RASTER_TILE_SAMPLE_SIZE = FOG_RASTER_TILE_SIZE_CELLS * FOG_RASTER_SAMPLES_PER_CELL;
export const FOG_RASTER_TILE_MASK_BITS = FOG_RASTER_TILE_SAMPLE_SIZE * FOG_RASTER_TILE_SAMPLE_SIZE;
export const FOG_RASTER_TILE_MASK_BYTES = FOG_RASTER_TILE_MASK_BITS / 8;
export const FOG_RASTER_MASK_ENCODING = 'base64-bitset-v1';
export const FOG_RASTER_PROFILE_ID = `fog-raster-c${FOG_RASTER_TILE_SIZE_CELLS}-s${FOG_RASTER_SAMPLES_PER_CELL}-v1`;
export const FOG_RASTER_ATLAS_TILE_SIDE = 4;

const CELL_KEY_PATTERN = /^-?\d+:-?\d+$/;
const GEOMETRY_EPSILON = 1e-6;
const BYTE_BIT_COUNTS = Array.from({ length: 256 }, (_, value) => {
  let count = 0;
  let cursor = value;
  while (cursor > 0) {
    count += cursor & 1;
    cursor >>= 1;
  }
  return count;
});

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeInteger = (value) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const getTileWorldSizePx = (grid) => (
  normalizeGridConfig(grid).cellSizePx * FOG_RASTER_TILE_SIZE_CELLS
);

const sortTiles = (left, right) => (
  left.tileRow - right.tileRow
  || left.tileCol - right.tileCol
  || left.id.localeCompare(right.id)
);

const cloneMaskBytes = (maskBytes) => (
  maskBytes instanceof Uint8Array && maskBytes.length === FOG_RASTER_TILE_MASK_BYTES
    ? new Uint8Array(maskBytes)
    : createEmptyFogRasterMaskBytes()
);

export const createEmptyFogRasterMaskBytes = () => new Uint8Array(FOG_RASTER_TILE_MASK_BYTES);

export const encodeFogRasterMaskBase64 = (maskBytes) => {
  const bytes = cloneMaskBytes(maskBytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  return Buffer.from(bytes).toString('base64');
};

export const decodeFogRasterMaskBase64 = (maskBase64) => {
  if (typeof maskBase64 !== 'string' || !maskBase64) {
    return null;
  }

  let binary = '';
  try {
    binary = typeof atob === 'function'
      ? atob(maskBase64)
      : Buffer.from(maskBase64, 'base64').toString('binary');
  } catch (error) {
    return null;
  }

  if (binary.length !== FOG_RASTER_TILE_MASK_BYTES) {
    return null;
  }

  const bytes = createEmptyFogRasterMaskBytes();
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
};

export const countFogRasterMaskBits = (maskBytes) => {
  const bytes = cloneMaskBytes(maskBytes);
  let count = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    count += BYTE_BIT_COUNTS[bytes[index]];
  }
  return count;
};

export const mergeFogRasterTileMasks = (leftMaskBytes, rightMaskBytes) => {
  const left = cloneMaskBytes(leftMaskBytes);
  const right = cloneMaskBytes(rightMaskBytes);
  const merged = createEmptyFogRasterMaskBytes();

  for (let index = 0; index < merged.length; index += 1) {
    merged[index] = left[index] | right[index];
  }
  return merged;
};

export const subtractFogRasterTileMasks = (leftMaskBytes, rightMaskBytes) => {
  const left = cloneMaskBytes(leftMaskBytes);
  const right = cloneMaskBytes(rightMaskBytes);
  const nextMask = createEmptyFogRasterMaskBytes();

  for (let index = 0; index < nextMask.length; index += 1) {
    nextMask[index] = left[index] & (~right[index] & 0xff);
  }
  return nextMask;
};

export const maskContainsFogRasterBits = (containerMaskBytes, containedMaskBytes) => {
  const container = cloneMaskBytes(containerMaskBytes);
  const contained = cloneMaskBytes(containedMaskBytes);

  for (let index = 0; index < contained.length; index += 1) {
    if ((container[index] & contained[index]) !== contained[index]) {
      return false;
    }
  }
  return true;
};

export const buildFogRasterTileKey = ({ tileCol, tileRow } = {}) => {
  const normalizedCol = normalizeInteger(tileCol);
  const normalizedRow = normalizeInteger(tileRow);
  return normalizedCol === null || normalizedRow === null ? '' : `${normalizedCol}:${normalizedRow}`;
};

export const decodeFogRasterTileKey = (tileKey) => {
  if (typeof tileKey !== 'string' || !CELL_KEY_PATTERN.test(tileKey)) {
    return null;
  }
  const [colValue, rowValue] = tileKey.split(':');
  const tileCol = Number(colValue);
  const tileRow = Number(rowValue);
  return Number.isInteger(tileCol) && Number.isInteger(tileRow)
    ? { tileCol, tileRow }
    : null;
};

export const buildFogRasterTileDocId = ({
  backgroundId = '',
  ownerUid = '',
  rasterProfileId = FOG_RASTER_PROFILE_ID,
  tileKey = '',
} = {}) => (
  isNonEmptyString(backgroundId)
  && isNonEmptyString(ownerUid)
  && isNonEmptyString(rasterProfileId)
  && decodeFogRasterTileKey(tileKey)
    ? `${backgroundId.trim()}__${ownerUid.trim()}__${rasterProfileId.trim()}__${tileKey}`
    : ''
);

const pointIsOnSegment = (point, start, end) => {
  const cross = (
    (point.y - start.y) * (end.x - start.x)
    - (point.x - start.x) * (end.y - start.y)
  );
  if (Math.abs(cross) > GEOMETRY_EPSILON) {
    return false;
  }

  const dot = (
    (point.x - start.x) * (end.x - start.x)
    + (point.y - start.y) * (end.y - start.y)
  );
  if (dot < -GEOMETRY_EPSILON) {
    return false;
  }

  const squaredLength = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
  return dot <= squaredLength + GEOMETRY_EPSILON;
};

const pointIsInRing = (point, ring = []) => {
  let isInside = false;

  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index, index += 1) {
    const start = ring[previousIndex];
    const end = ring[index];

    if (pointIsOnSegment(point, start, end)) {
      return true;
    }

    const intersects = (
      (start.y > point.y) !== (end.y > point.y)
      && point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    );
    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
};

const pointIsInFogPolygon = (point, polygon = []) => {
  if (!Array.isArray(polygon?.[0]) || polygon[0].length < 3) {
    return false;
  }
  if (!pointIsInRing(point, polygon[0])) {
    return false;
  }
  return !polygon.slice(1).some((holeRing) => pointIsInRing(point, holeRing));
};

const pointIsInFogPolygons = (point, polygons = []) => (
  polygons.some((polygon) => pointIsInFogPolygon(point, polygon))
);

const getPolygonsBounds = (polygons = []) => {
  const points = polygons.flatMap((polygon) => (
    (Array.isArray(polygon) ? polygon : []).flatMap((ring) => (
      (Array.isArray(ring) ? ring : []).filter((point) => (
        Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
      ))
    ))
  ));

  if (!points.length) {
    return null;
  }

  return {
    minX: Math.min(...points.map((point) => Number(point.x))),
    minY: Math.min(...points.map((point) => Number(point.y))),
    maxX: Math.max(...points.map((point) => Number(point.x))),
    maxY: Math.max(...points.map((point) => Number(point.y))),
  };
};

const getTileSampleRangeForBounds = ({
  bounds,
  tileMinX,
  tileMinY,
  sampleSizePx,
} = {}) => {
  const minSampleX = Math.max(
    0,
    Math.ceil(((bounds.minX - tileMinX) / sampleSizePx) - 0.5)
  );
  const maxSampleX = Math.min(
    FOG_RASTER_TILE_SAMPLE_SIZE - 1,
    Math.floor(((bounds.maxX - tileMinX) / sampleSizePx) - 0.5)
  );
  const minSampleY = Math.max(
    0,
    Math.ceil(((bounds.minY - tileMinY) / sampleSizePx) - 0.5)
  );
  const maxSampleY = Math.min(
    FOG_RASTER_TILE_SAMPLE_SIZE - 1,
    Math.floor(((bounds.maxY - tileMinY) / sampleSizePx) - 0.5)
  );

  return minSampleX <= maxSampleX && minSampleY <= maxSampleY
    ? { minSampleX, maxSampleX, minSampleY, maxSampleY }
    : null;
};

const setRasterBit = (maskBytes, sampleX, sampleY) => {
  const bitIndex = (sampleY * FOG_RASTER_TILE_SAMPLE_SIZE) + sampleX;
  const byteIndex = Math.floor(bitIndex / 8);
  const bitOffset = bitIndex % 8;
  maskBytes[byteIndex] |= 1 << bitOffset;
};

const getRasterBit = (maskBytes, sampleX, sampleY) => {
  const bitIndex = (sampleY * FOG_RASTER_TILE_SAMPLE_SIZE) + sampleX;
  const byteIndex = Math.floor(bitIndex / 8);
  const bitOffset = bitIndex % 8;
  return ((maskBytes[byteIndex] || 0) & (1 << bitOffset)) !== 0;
};

export const rasterizeFogPolygonsToTiles = ({
  backgroundId = '',
  ownerUid = '',
  grid,
  polygons = [],
} = {}) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const bounds = getPolygonsBounds(polygons);
  if (!bounds || !backgroundId || !ownerUid) {
    return [];
  }

  const tileWorldSizePx = getTileWorldSizePx(normalizedGrid);
  const sampleSizePx = normalizedGrid.cellSizePx / FOG_RASTER_SAMPLES_PER_CELL;
  const minTileCol = Math.floor((bounds.minX - normalizedGrid.offsetXPx) / tileWorldSizePx);
  const maxTileCol = Math.floor(((bounds.maxX - GEOMETRY_EPSILON) - normalizedGrid.offsetXPx) / tileWorldSizePx);
  const minTileRow = Math.floor((bounds.minY - normalizedGrid.offsetYPx) / tileWorldSizePx);
  const maxTileRow = Math.floor(((bounds.maxY - GEOMETRY_EPSILON) - normalizedGrid.offsetYPx) / tileWorldSizePx);
  const tiles = [];

  for (let tileRow = minTileRow; tileRow <= maxTileRow; tileRow += 1) {
    for (let tileCol = minTileCol; tileCol <= maxTileCol; tileCol += 1) {
      const maskBytes = createEmptyFogRasterMaskBytes();
      const tileMinX = normalizedGrid.offsetXPx + (tileCol * tileWorldSizePx);
      const tileMinY = normalizedGrid.offsetYPx + (tileRow * tileWorldSizePx);
      const sampleRange = getTileSampleRangeForBounds({
        bounds,
        tileMinX,
        tileMinY,
        sampleSizePx,
      });
      if (!sampleRange) {
        continue;
      }

      let bitCount = 0;
      for (let sampleY = sampleRange.minSampleY; sampleY <= sampleRange.maxSampleY; sampleY += 1) {
        const y = tileMinY + ((sampleY + 0.5) * sampleSizePx);
        for (let sampleX = sampleRange.minSampleX; sampleX <= sampleRange.maxSampleX; sampleX += 1) {
          const x = tileMinX + ((sampleX + 0.5) * sampleSizePx);
          if (pointIsInFogPolygons({ x, y }, polygons)) {
            setRasterBit(maskBytes, sampleX, sampleY);
            bitCount += 1;
          }
        }
      }

      if (bitCount > 0) {
        const tileKey = buildFogRasterTileKey({ tileCol, tileRow });
        tiles.push({
          id: buildFogRasterTileDocId({ backgroundId, ownerUid, tileKey }),
          backgroundId,
          ownerUid,
          rasterProfileId: FOG_RASTER_PROFILE_ID,
          tileKey,
          tileCol,
          tileRow,
          tileSizeCells: FOG_RASTER_TILE_SIZE_CELLS,
          samplesPerCell: FOG_RASTER_SAMPLES_PER_CELL,
          cellSizePx: normalizedGrid.cellSizePx,
          offsetXPx: normalizedGrid.offsetXPx,
          offsetYPx: normalizedGrid.offsetYPx,
          maskEncoding: FOG_RASTER_MASK_ENCODING,
          maskBytes,
        });
      }
    }
  }

  return tiles.sort(sortTiles);
};

export const buildFogRasterTilePayload = ({
  backgroundId = '',
  ownerUid = '',
  tileKey = '',
  tileCol,
  tileRow,
  grid,
  maskBytes,
  updatedAt = null,
  updatedBy = '',
} = {}) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const decodedTile = decodeFogRasterTileKey(tileKey);
  const normalizedTileCol = normalizeInteger(tileCol) ?? decodedTile?.tileCol ?? 0;
  const normalizedTileRow = normalizeInteger(tileRow) ?? decodedTile?.tileRow ?? 0;
  const normalizedTileKey = buildFogRasterTileKey({
    tileCol: normalizedTileCol,
    tileRow: normalizedTileRow,
  });

  return {
    schemaVersion: GRIGLIATA_FOG_MEMORY_TILE_SCHEMA_VERSION,
    backgroundId,
    ownerUid,
    tileKey: normalizedTileKey,
    tileCol: normalizedTileCol,
    tileRow: normalizedTileRow,
    rasterProfileId: FOG_RASTER_PROFILE_ID,
    tileSizeCells: FOG_RASTER_TILE_SIZE_CELLS,
    samplesPerCell: FOG_RASTER_SAMPLES_PER_CELL,
    cellSizePx: normalizedGrid.cellSizePx,
    offsetXPx: normalizedGrid.offsetXPx,
    offsetYPx: normalizedGrid.offsetYPx,
    maskEncoding: FOG_RASTER_MASK_ENCODING,
    maskBase64: encodeFogRasterMaskBase64(maskBytes),
    updatedAt,
    updatedBy,
  };
};

export const normalizeFogRasterMemoryTileDoc = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const backgroundId = typeof data.backgroundId === 'string' ? data.backgroundId.trim() : '';
  const ownerUid = typeof data.ownerUid === 'string' ? data.ownerUid.trim() : '';
  const rasterProfileId = typeof data.rasterProfileId === 'string' ? data.rasterProfileId.trim() : '';
  const tileKey = typeof data.tileKey === 'string' ? data.tileKey.trim() : '';
  const decodedTile = decodeFogRasterTileKey(tileKey);
  const tileCol = normalizeInteger(data.tileCol);
  const tileRow = normalizeInteger(data.tileRow);
  const cellSizePx = normalizeInteger(data.cellSizePx);
  const offsetXPx = normalizeInteger(data.offsetXPx);
  const offsetYPx = normalizeInteger(data.offsetYPx);

  if (
    !backgroundId
    || !ownerUid
    || rasterProfileId !== FOG_RASTER_PROFILE_ID
    || !decodedTile
    || tileCol !== decodedTile.tileCol
    || tileRow !== decodedTile.tileRow
    || cellSizePx === null
    || cellSizePx <= 0
    || offsetXPx === null
    || offsetYPx === null
    || data.tileSizeCells !== FOG_RASTER_TILE_SIZE_CELLS
    || data.samplesPerCell !== FOG_RASTER_SAMPLES_PER_CELL
    || data.maskEncoding !== FOG_RASTER_MASK_ENCODING
  ) {
    return null;
  }

  const id = typeof data.id === 'string' && data.id
    ? data.id
    : buildFogRasterTileDocId({ backgroundId, ownerUid, tileKey });
  if (id !== buildFogRasterTileDocId({ backgroundId, ownerUid, tileKey })) {
    return null;
  }

  const maskBytes = decodeFogRasterMaskBase64(data.maskBase64);
  if (!maskBytes) {
    return null;
  }

  return {
    schemaVersion: GRIGLIATA_FOG_MEMORY_TILE_SCHEMA_VERSION,
    id,
    backgroundId,
    ownerUid,
    tileKey,
    tileCol,
    tileRow,
    rasterProfileId,
    tileSizeCells: FOG_RASTER_TILE_SIZE_CELLS,
    samplesPerCell: FOG_RASTER_SAMPLES_PER_CELL,
    cellSizePx,
    offsetXPx,
    offsetYPx,
    maskEncoding: FOG_RASTER_MASK_ENCODING,
    maskBase64: data.maskBase64,
    maskBytes,
    updatedAt: data.updatedAt || null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
};

export const mergeFogRasterMemoryTiles = (tiles = []) => {
  const tileMap = new Map();

  (Array.isArray(tiles) ? tiles : []).forEach((tile) => {
    const normalizedTile = tile?.maskBytes instanceof Uint8Array
      ? tile
      : normalizeFogRasterMemoryTileDoc(tile);
    if (!normalizedTile?.id) {
      return;
    }

    const existingTile = tileMap.get(normalizedTile.id);
    tileMap.set(normalizedTile.id, existingTile
      ? {
        ...normalizedTile,
        maskBytes: mergeFogRasterTileMasks(existingTile.maskBytes, normalizedTile.maskBytes),
      }
      : {
        ...normalizedTile,
        maskBytes: cloneMaskBytes(normalizedTile.maskBytes),
      });
  });

  return [...tileMap.values()].sort(sortTiles);
};

const createFallbackAtlasImage = ({ width, height, id }) => ({
  width,
  height,
  id,
  fogRasterAtlas: true,
});

const createFogRasterAtlasImage = ({ id, width, height, tiles, minTileCol, minTileRow }) => {
  const canvas = typeof document !== 'undefined' && typeof document.createElement === 'function'
    ? document.createElement('canvas')
    : null;
  if (!canvas) {
    return createFallbackAtlasImage({ width, height, id });
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
    return createFallbackAtlasImage({ width, height, id });
  }

  canvas.width = width;
  canvas.height = height;
  let context = null;
  try {
    context = typeof canvas.getContext === 'function'
      ? canvas.getContext('2d')
      : null;
  } catch (error) {
    return createFallbackAtlasImage({ width, height, id });
  }
  if (!context || typeof context.createImageData !== 'function') {
    return createFallbackAtlasImage({ width, height, id });
  }

  const imageData = context.createImageData(width, height);
  tiles.forEach((tile) => {
    const offsetX = (tile.tileCol - minTileCol) * FOG_RASTER_TILE_SAMPLE_SIZE;
    const offsetY = (tile.tileRow - minTileRow) * FOG_RASTER_TILE_SAMPLE_SIZE;

    for (let sampleY = 0; sampleY < FOG_RASTER_TILE_SAMPLE_SIZE; sampleY += 1) {
      for (let sampleX = 0; sampleX < FOG_RASTER_TILE_SAMPLE_SIZE; sampleX += 1) {
        if (!getRasterBit(tile.maskBytes, sampleX, sampleY)) {
          continue;
        }

        const pixelIndex = (((offsetY + sampleY) * width) + offsetX + sampleX) * 4;
        imageData.data[pixelIndex] = 2;
        imageData.data[pixelIndex + 1] = 6;
        imageData.data[pixelIndex + 2] = 23;
        imageData.data[pixelIndex + 3] = 255;
      }
    }
  });
  context.putImageData(imageData, 0, 0);
  return canvas;
};

export const buildFogRasterMemoryAtlases = ({
  memoryTiles = [],
  grid,
  maxTileSide = FOG_RASTER_ATLAS_TILE_SIDE,
} = {}) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const tileWorldSizePx = getTileWorldSizePx(normalizedGrid);
  const groupedTiles = new Map();
  const matchingTiles = mergeFogRasterMemoryTiles(memoryTiles)
    .filter((tile) => (
      tile.cellSizePx === normalizedGrid.cellSizePx
      && tile.offsetXPx === normalizedGrid.offsetXPx
      && tile.offsetYPx === normalizedGrid.offsetYPx
      && countFogRasterMaskBits(tile.maskBytes) > 0
    ));

  if (matchingTiles.length < 1) {
    return [];
  }

  const minMemoryTileCol = Math.min(...matchingTiles.map((tile) => tile.tileCol));
  const minMemoryTileRow = Math.min(...matchingTiles.map((tile) => tile.tileRow));
  const normalizedMaxTileSide = Math.max(1, Math.floor(asFiniteNumber(maxTileSide, FOG_RASTER_ATLAS_TILE_SIDE)));

  matchingTiles.forEach((tile) => {
    const groupCol = Math.floor((tile.tileCol - minMemoryTileCol) / normalizedMaxTileSide);
    const groupRow = Math.floor((tile.tileRow - minMemoryTileRow) / normalizedMaxTileSide);
    const groupKey = `${groupCol}:${groupRow}`;
    const tiles = groupedTiles.get(groupKey) || [];
    tiles.push(tile);
    groupedTiles.set(groupKey, tiles);
  });

  return [...groupedTiles.entries()].map(([groupKey, tiles]) => {
    const sortedTiles = [...tiles].sort(sortTiles);
    const minTileCol = Math.min(...sortedTiles.map((tile) => tile.tileCol));
    const maxTileCol = Math.max(...sortedTiles.map((tile) => tile.tileCol));
    const minTileRow = Math.min(...sortedTiles.map((tile) => tile.tileRow));
    const maxTileRow = Math.max(...sortedTiles.map((tile) => tile.tileRow));
    const tileColSpan = maxTileCol - minTileCol + 1;
    const tileRowSpan = maxTileRow - minTileRow + 1;
    const width = tileColSpan * FOG_RASTER_TILE_SAMPLE_SIZE;
    const height = tileRowSpan * FOG_RASTER_TILE_SAMPLE_SIZE;
    const id = `fog-raster-atlas-${groupKey}`;

    return {
      id,
      x: normalizedGrid.offsetXPx + (minTileCol * tileWorldSizePx),
      y: normalizedGrid.offsetYPx + (minTileRow * tileWorldSizePx),
      width: tileColSpan * tileWorldSizePx,
      height: tileRowSpan * tileWorldSizePx,
      image: createFogRasterAtlasImage({
        id,
        width,
        height,
        tiles: sortedTiles,
        minTileCol,
        minTileRow,
      }),
      tileCount: sortedTiles.length,
      bitCount: sortedTiles.reduce(
        (total, tile) => total + countFogRasterMaskBits(tile.maskBytes),
        0
      ),
    };
  }).sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
};
