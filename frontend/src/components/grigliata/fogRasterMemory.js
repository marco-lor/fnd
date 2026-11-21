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

const isFogMask = (bytes) => bytes instanceof Uint8Array && bytes.length === FOG_RASTER_TILE_MASK_BYTES;

const cloneMaskBytes = (maskBytes) => (
  isFogMask(maskBytes)
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
  if (!isFogMask(maskBytes)) return 0;
  let count = 0;
  for (let index = 0; index < maskBytes.length; index += 1) {
    count += BYTE_BIT_COUNTS[maskBytes[index]];
  }
  return count;
};

export const mergeFogRasterTileMasks = (leftMaskBytes, rightMaskBytes) => {
  const merged = cloneMaskBytes(leftMaskBytes);
  if (!isFogMask(rightMaskBytes)) return merged;
  for (let index = 0; index < merged.length; index += 1) {
    merged[index] |= rightMaskBytes[index];
  }
  return merged;
};

export const subtractFogRasterTileMasks = (leftMaskBytes, rightMaskBytes) => {
  const nextMask = cloneMaskBytes(leftMaskBytes);
  if (!isFogMask(rightMaskBytes)) return nextMask;
  for (let index = 0; index < nextMask.length; index += 1) {
    nextMask[index] &= ~rightMaskBytes[index];
  }
  return nextMask;
};

export const maskContainsFogRasterBits = (containerMaskBytes, containedMaskBytes) => {
  if (!isFogMask(containedMaskBytes)) return true;
  if (!isFogMask(containerMaskBytes)) return !containedMaskBytes.some(Boolean);
  for (let index = 0; index < containedMaskBytes.length; index += 1) {
    if ((containerMaskBytes[index] & containedMaskBytes[index]) !== containedMaskBytes[index]) {
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

const pointIsOnSegment = (x, y, start, end) => {
  const cross = (
    (y - start.y) * (end.x - start.x)
    - (x - start.x) * (end.y - start.y)
  );
  if (Math.abs(cross) > GEOMETRY_EPSILON) {
    return false;
  }

  const dot = (
    (x - start.x) * (end.x - start.x)
    + (y - start.y) * (end.y - start.y)
  );
  if (dot < -GEOMETRY_EPSILON) {
    return false;
  }

  const squaredLength = ((end.x - start.x) ** 2) + ((end.y - start.y) ** 2);
  return dot <= squaredLength + GEOMETRY_EPSILON;
};

const buildRingEdges = (ring) => {
  const edges = [];
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[(index + ring.length - 1) % ring.length];
    const end = ring[index];
    const longestAxis = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    if (longestAxis > 0) {
      // The cross and dot tests allow epsilon in squared world units.
      const padding = (2 * GEOMETRY_EPSILON) / longestAxis;
      edges.push({
        start,
        end,
        padding,
        minY: Math.min(start.y, end.y) - padding,
        maxY: Math.max(start.y, end.y) + padding,
      });
    }
  }
  return edges;
};

// Raster samples sit at sub-cell centres. Span code uses global sample indexes:
// index FOG_RASTER_TILE_SAMPLE_SIZE is the first sample of tile 1.
const getSampleCenterPx = ({ originPx, tileWorldSizePx, sampleSizePx }, index) => {
  const tile = Math.floor(index / FOG_RASTER_TILE_SAMPLE_SIZE);
  const sample = index - (tile * FOG_RASTER_TILE_SAMPLE_SIZE);
  // Tile origin plus local offset, the same arithmetic as the stored tile layout.
  return originPx + (tile * tileWorldSizePx) + ((sample + 0.5) * sampleSizePx);
};

// The sample indexes whose centres lie in [minPx, maxPx]. Each end is clamped
// with its own tile's local arithmetic, keeping clips identical to stored tiles.
const createSampleAxis = ({ originPx, tileWorldSizePx, sampleSizePx }, minPx, maxPx) => {
  const firstTile = Math.floor((minPx - originPx) / tileWorldSizePx);
  const lastTile = Math.floor((maxPx - originPx) / tileWorldSizePx);
  const firstTileMinPx = originPx + (firstTile * tileWorldSizePx);
  const lastTileMinPx = originPx + (lastTile * tileWorldSizePx);
  return {
    originPx,
    tileWorldSizePx,
    sampleSizePx,
    first: (firstTile * FOG_RASTER_TILE_SAMPLE_SIZE)
      + Math.max(0, Math.ceil(((minPx - firstTileMinPx) / sampleSizePx) - 0.5)),
    last: (lastTile * FOG_RASTER_TILE_SAMPLE_SIZE)
      + Math.min(FOG_RASTER_TILE_SAMPLE_SIZE - 1, Math.floor(((maxPx - lastTileMinPx) / sampleSizePx) - 0.5)),
  };
};

// The first index in [axis.first, axis.last + 1] whose sample centre is at or
// past px (strictly past when `strict`). axis.last + 1 means no sample is.
const findFirstSampleAtOrPast = (axis, px, strict = false) => {
  const isAtOrPast = (index) => {
    const centerPx = getSampleCenterPx(axis, index);
    return strict ? centerPx > px : centerPx >= px;
  };
  const end = axis.last + 1;
  const estimate = Math.ceil(((px - axis.originPx) / axis.sampleSizePx) - 0.5);
  let index = Number.isNaN(estimate) ? end : Math.min(end, Math.max(axis.first, estimate));
  while (index > axis.first && isAtOrPast(index - 1)) index -= 1;
  while (index < end && !isAtOrPast(index)) index += 1;
  return index;
};

// Offsets o with low <= intercept + (slope * o) <= high.
const solveOffsetRange = (slope, intercept, low, high) => {
  if (slope === 0) {
    return intercept >= low && intercept <= high ? { min: -Infinity, max: Infinity } : null;
  }
  const fromLow = (low - intercept) / slope;
  const fromHigh = (high - intercept) / slope;
  return { min: Math.min(fromLow, fromHigh), max: Math.max(fromLow, fromHigh) };
};

// Approximate x-range on row y where pointIsOnSegment holds, or null if none.
// With offset = x - start.x, its cross and dot products are linear in offset.
const getOnSegmentWindowPx = (y, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const across = solveOffsetRange(-dy, (y - start.y) * dx, -GEOMETRY_EPSILON, GEOMETRY_EPSILON);
  const along = solveOffsetRange(
    dx,
    (y - start.y) * dy,
    -GEOMETRY_EPSILON,
    (dx ** 2) + (dy ** 2) + GEOMETRY_EPSILON
  );
  return across && along
    ? { minPx: start.x + Math.max(across.min, along.min), maxPx: start.x + Math.min(across.max, along.max) }
    : null;
};

// The span of samples on row y that pointIsOnSegment accepts. Along a row the
// rounded cross and dot products are still monotone in x, so accepted samples
// are contiguous. Solve for the run, then settle both ends with the exact test.
const findOnSegmentSpan = (xAxis, y, start, end) => {
  const windowPx = getOnSegmentWindowPx(y, start, end);
  if (!windowPx) {
    return null;
  }

  const isOnSegment = (index) => pointIsOnSegment(getSampleCenterPx(xAxis, index), y, start, end);
  const lastCandidate = Math.min(xAxis.last, findFirstSampleAtOrPast(xAxis, windowPx.maxPx, true));
  let spanStart = Math.max(xAxis.first, findFirstSampleAtOrPast(xAxis, windowPx.minPx) - 1);
  while (spanStart <= lastCandidate && !isOnSegment(spanStart)) spanStart += 1;
  if (spanStart > lastCandidate) {
    return null;
  }

  while (spanStart > xAxis.first && isOnSegment(spanStart - 1)) spanStart -= 1;
  let spanEnd = spanStart + 1;
  while (spanEnd <= xAxis.last && isOnSegment(spanEnd)) spanEnd += 1;
  return [spanStart, spanEnd];
};

// Buckets a ring's edges by the sample rows whose centre passes each edge's
// padded Y range. Rows outside every bucket cannot touch the ring.
const indexRingEdgesByRow = (edges, yAxis) => {
  const ranges = [];
  let firstRow = Infinity;
  let endRow = -Infinity;
  for (const edge of edges) {
    const edgeFirstRow = findFirstSampleAtOrPast(yAxis, edge.minY);
    const edgeEndRow = findFirstSampleAtOrPast(yAxis, edge.maxY, true);
    if (edgeFirstRow < edgeEndRow) {
      ranges.push({ edge, edgeFirstRow, edgeEndRow });
      firstRow = Math.min(firstRow, edgeFirstRow);
      endRow = Math.max(endRow, edgeEndRow);
    }
  }
  if (!ranges.length) {
    return null;
  }

  const rows = Array.from({ length: endRow - firstRow }, () => []);
  for (const { edge, edgeFirstRow, edgeEndRow } of ranges) {
    for (let row = edgeFirstRow; row < edgeEndRow; row += 1) {
      rows[row - firstRow].push(edge);
    }
  }
  return { firstRow, rows };
};

// Sorts [start, end) spans and merges those that overlap or touch.
const mergeSpans = (spans) => {
  if (spans.length < 2) {
    return spans;
  }

  spans.sort((left, right) => left[0] - right[0]);
  const merged = [spans[0]];
  for (let index = 1; index < spans.length; index += 1) {
    const last = merged[merged.length - 1];
    if (spans[index][0] <= last[1]) {
      last[1] = Math.max(last[1], spans[index][1]);
    } else {
      merged.push(spans[index]);
    }
  }
  return merged;
};

// Removes sorted, disjoint `removed` spans from sorted, disjoint `spans`.
const subtractSpans = (spans, removed) => {
  if (!removed.length) {
    return spans;
  }

  const remaining = [];
  let firstRemoved = 0;
  for (const [start, end] of spans) {
    let cursor = start;
    while (firstRemoved < removed.length && removed[firstRemoved][1] <= cursor) firstRemoved += 1;
    for (let index = firstRemoved; index < removed.length && removed[index][0] < end; index += 1) {
      if (removed[index][0] > cursor) {
        remaining.push([cursor, removed[index][0]]);
      }
      cursor = Math.max(cursor, removed[index][1]);
    }
    if (cursor < end) {
      remaining.push([cursor, end]);
    }
  }
  return remaining;
};

// Samples of one row inside a ring: edge-tolerance spans plus the even-odd
// interior. A sample is inside when an odd number of crossings lie at or left
// of it, i.e. in [crossings[2k], crossings[2k + 1]). Closed rings cross evenly.
const getRingRowSpans = (ringRows, row, y, xAxis) => {
  const edges = ringRows?.rows[row - ringRows.firstRow];
  if (!edges) {
    return [];
  }

  const crossings = [];
  const spans = [];
  for (const { start, end } of edges) {
    if ((start.y > y) !== (end.y > y)) {
      crossings.push(((end.x - start.x) * (y - start.y)) / (end.y - start.y) + start.x);
    }
    const onSegmentSpan = findOnSegmentSpan(xAxis, y, start, end);
    if (onSegmentSpan) {
      spans.push(onSegmentSpan);
    }
  }

  crossings.sort((left, right) => left - right);
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    const spanStart = findFirstSampleAtOrPast(xAxis, crossings[index]);
    const spanEnd = findFirstSampleAtOrPast(xAxis, crossings[index + 1]);
    if (spanStart < spanEnd) {
      spans.push([spanStart, spanEnd]);
    }
  }
  return mergeSpans(spans);
};

const getRasterPolygonBounds = (polygon) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of polygon) {
    for (const point of ring) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
};

// Sets bits [startBit, endBit) of one tile row. Bit n of a row is sample n,
// least significant bit first within each byte.
const setMaskRowBits = (maskBytes, rowByteOffset, startBit, endBit) => {
  const firstByte = rowByteOffset + (startBit >> 3);
  const lastByte = rowByteOffset + ((endBit - 1) >> 3);
  const firstByteBits = (0xff << (startBit & 7)) & 0xff;
  const lastByteBits = 0xff >> (7 - ((endBit - 1) & 7));
  if (firstByte === lastByte) {
    maskBytes[firstByte] |= firstByteBits & lastByteBits;
    return;
  }

  maskBytes[firstByte] |= firstByteBits;
  maskBytes.fill(0xff, firstByte + 1, lastByte);
  maskBytes[lastByte] |= lastByteBits;
};

// ORs global samples [start, end) of one row into tile masks, keyed by tile
// row then tile column. Masks are created on first write, so every one is lit.
const writeSampleSpan = (tileMasks, row, start, end) => {
  const tileRow = Math.floor(row / FOG_RASTER_TILE_SAMPLE_SIZE);
  const rowByteOffset = (row - (tileRow * FOG_RASTER_TILE_SAMPLE_SIZE)) * (FOG_RASTER_TILE_SAMPLE_SIZE / 8);
  let masksByCol = tileMasks.get(tileRow);
  if (!masksByCol) {
    masksByCol = new Map();
    tileMasks.set(tileRow, masksByCol);
  }

  for (let cursor = start; cursor < end;) {
    const tileCol = Math.floor(cursor / FOG_RASTER_TILE_SAMPLE_SIZE);
    const tileStart = tileCol * FOG_RASTER_TILE_SAMPLE_SIZE;
    const tileEnd = Math.min(end, tileStart + FOG_RASTER_TILE_SAMPLE_SIZE);
    let maskBytes = masksByCol.get(tileCol);
    if (!maskBytes) {
      maskBytes = createEmptyFogRasterMaskBytes();
      masksByCol.set(tileCol, maskBytes);
    }
    setMaskRowBits(maskBytes, rowByteOffset, cursor - tileStart, tileEnd - tileStart);
    cursor = tileEnd;
  }
};

// Writes the samples inside one footprint, its outer ring minus its holes,
// walking only the rows its outer ring reaches.
const rasterizeFootprint = ({ outer, holes }, xAxis, yAxis, tileMasks) => {
  const outerRows = indexRingEdgesByRow(outer, yAxis);
  if (!outerRows) {
    return;
  }

  const holeRows = holes.map((hole) => indexRingEdgesByRow(hole, yAxis)).filter(Boolean);
  const endRow = outerRows.firstRow + outerRows.rows.length;
  for (let row = outerRows.firstRow; row < endRow; row += 1) {
    const y = getSampleCenterPx(yAxis, row);
    const outerSpans = getRingRowSpans(outerRows, row, y, xAxis);
    if (outerSpans.length) {
      const holeSpans = mergeSpans(holeRows.flatMap((hole) => getRingRowSpans(hole, row, y, xAxis)));
      subtractSpans(outerSpans, holeSpans)
        .forEach(([start, end]) => writeSampleSpan(tileMasks, row, start, end));
    }
  }
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
  if (!backgroundId || !ownerUid || !Array.isArray(polygons)) {
    return [];
  }

  const sceneBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const footprints = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon?.[0]) || polygon[0].length < 3) {
      continue;
    }

    const rings = polygon.filter(Array.isArray);
    const bounds = getRasterPolygonBounds(rings);
    if (!bounds) {
      continue;
    }

    sceneBounds.minX = Math.min(sceneBounds.minX, bounds.minX);
    sceneBounds.minY = Math.min(sceneBounds.minY, bounds.minY);
    sceneBounds.maxX = Math.max(sceneBounds.maxX, bounds.maxX);
    sceneBounds.maxY = Math.max(sceneBounds.maxY, bounds.maxY);
    const [outer, ...holes] = rings.map(buildRingEdges);
    footprints.push({ bounds, outer, holes });
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const tileWorldSizePx = getTileWorldSizePx(normalizedGrid);
  const sampleSizePx = normalizedGrid.cellSizePx / FOG_RASTER_SAMPLES_PER_CELL;
  const { offsetXPx, offsetYPx } = normalizedGrid;
  const xGrid = { originPx: offsetXPx, tileWorldSizePx, sampleSizePx };
  const yGrid = { originPx: offsetYPx, tileWorldSizePx, sampleSizePx };
  const tileMasks = new Map();

  // Rasterize each footprint locally as row spans and union them in shared
  // tiles. The rectangle enclosing all viewers can be vast and mostly empty.
  for (const footprint of footprints) {
    const { bounds, outer } = footprint;
    // Preserve the edge tolerance within the scene's original sampling bounds.
    const padding = outer.reduce((max, edge) => Math.max(max, edge.padding), 0);
    const xAxis = createSampleAxis(
      xGrid,
      Math.max(sceneBounds.minX, bounds.minX - padding),
      Math.min(sceneBounds.maxX, bounds.maxX + padding)
    );
    const yAxis = createSampleAxis(
      yGrid,
      Math.max(sceneBounds.minY, bounds.minY - padding),
      Math.min(sceneBounds.maxY, bounds.maxY + padding)
    );
    if (xAxis.first <= xAxis.last && yAxis.first <= yAxis.last) {
      rasterizeFootprint(footprint, xAxis, yAxis, tileMasks);
    }
  }

  const tiles = [];
  tileMasks.forEach((masksByCol, tileRow) => masksByCol.forEach((maskBytes, tileCol) => {
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
      offsetXPx,
      offsetYPx,
      maskEncoding: FOG_RASTER_MASK_ENCODING,
      maskBytes,
    });
  }));

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

// A listener replaces a decoded tile on each document change. Other callers
// can supply and later modify their own Uint8Arrays.
const nonemptySnapshotTiles = new WeakMap();

export const normalizeFogRasterMemoryTileDoc = (data, { immutableSnapshot = false } = {}) => {
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

  const tile = {
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
  if (immutableSnapshot) {
    nonemptySnapshotTiles.set(tile, maskBytes.some((byte) => byte !== 0));
  }
  return tile;
};

export const mergeFogRasterMemoryTiles = (tiles = []) => {
  const tileMap = new Map();

  (Array.isArray(tiles) ? tiles : []).forEach((tile) => {
    const normalizedTile = isFogMask(tile?.maskBytes)
      ? tile
      : normalizeFogRasterMemoryTileDoc(tile);
    if (!normalizedTile?.id) {
      return;
    }

    const existingTile = tileMap.get(normalizedTile.id);
    if (existingTile) {
      tileMap.set(normalizedTile.id, {
        ...normalizedTile,
        maskBytes: mergeFogRasterTileMasks(existingTile.maskBytes, normalizedTile.maskBytes),
      });
    } else {
      const snapshot = nonemptySnapshotTiles.has(normalizedTile) || normalizedTile !== tile
        ? normalizedTile
        : { ...tile, maskBytes: cloneMaskBytes(tile.maskBytes) };
      tileMap.set(normalizedTile.id, snapshot);
    }
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

const sameAtlasTile = (tile, previous) => {
  if (tile === previous) return true;
  // Tile IDs include the map, viewer, raster profile and world tile coordinates.
  if (tile.id !== previous.id
    || tile.cellSizePx !== previous.cellSizePx
    || tile.offsetXPx !== previous.offsetXPx
    || tile.offsetYPx !== previous.offsetYPx) {
    return false;
  }
  for (let index = 0; index < tile.maskBytes.length; index += 1) {
    if (tile.maskBytes[index] !== previous.maskBytes[index]) return false;
  }
  return true;
};

export const buildFogRasterMemoryAtlases = ({
  memoryTiles = [],
  grid,
  maxTileSide = FOG_RASTER_ATLAS_TILE_SIDE,
  previousAtlases = [],
} = {}) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const tileWorldSizePx = getTileWorldSizePx(normalizedGrid);
  const groupedTiles = new Map();
  const matchingTiles = mergeFogRasterMemoryTiles(memoryTiles)
    .filter((tile) => (
      tile.cellSizePx === normalizedGrid.cellSizePx
      && tile.offsetXPx === normalizedGrid.offsetXPx
      && tile.offsetYPx === normalizedGrid.offsetYPx
      && (nonemptySnapshotTiles.get(tile) ?? tile.maskBytes.some((byte) => byte !== 0))
    ));

  const normalizedMaxTileSide = Math.max(1, Math.floor(asFiniteNumber(maxTileSide, FOG_RASTER_ATLAS_TILE_SIDE)));

  matchingTiles.forEach((tile) => {
    const groupCol = Math.floor(tile.tileCol / normalizedMaxTileSide);
    const groupRow = Math.floor(tile.tileRow / normalizedMaxTileSide);
    const groupKey = `${groupCol}:${groupRow}`;
    const tiles = groupedTiles.get(groupKey) || [];
    tiles.push(tile);
    groupedTiles.set(groupKey, tiles);
  });

  const previousById = new Map(previousAtlases.map((atlas) => [atlas.id, atlas]));
  return [...groupedTiles.entries()].map(([groupKey, tiles]) => {
    const id = `fog-raster-atlas-${groupKey}`;
    const previous = previousById.get(id);
    if (previous?.tiles.length === tiles.length
      && tiles.every((tile, index) => sameAtlasTile(tile, previous.tiles[index]))) {
      return previous;
    }
    const minTileCol = Math.min(...tiles.map((tile) => tile.tileCol));
    const maxTileCol = Math.max(...tiles.map((tile) => tile.tileCol));
    const minTileRow = Math.min(...tiles.map((tile) => tile.tileRow));
    const maxTileRow = Math.max(...tiles.map((tile) => tile.tileRow));
    const tileColSpan = maxTileCol - minTileCol + 1;
    const tileRowSpan = maxTileRow - minTileRow + 1;
    const width = tileColSpan * FOG_RASTER_TILE_SAMPLE_SIZE;
    const height = tileRowSpan * FOG_RASTER_TILE_SAMPLE_SIZE;

    return {
      id,
      tiles,
      x: normalizedGrid.offsetXPx + (minTileCol * tileWorldSizePx),
      y: normalizedGrid.offsetYPx + (minTileRow * tileWorldSizePx),
      width: tileColSpan * tileWorldSizePx,
      height: tileRowSpan * tileWorldSizePx,
      image: createFogRasterAtlasImage({
        id,
        width,
        height,
        tiles,
        minTileCol,
        minTileRow,
      }),
      tileCount: tiles.length,
      bitCount: tiles.reduce(
        (total, tile) => total + countFogRasterMaskBits(tile.maskBytes),
        0
      ),
    };
  }).sort((left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id));
};
