import { normalizeGridConfig } from './boardUtils';
import {
  buildFogPolygonsFromLiveCasts,
  FOG_POLYGON_MAX_RING_POINTS,
  normalizeFogMemoryPolygons,
  normalizeFogPolygons,
  simplifyFogRingToPointLimit,
} from './fogPolygonGeometry';

export const GRIGLIATA_FOG_OF_WAR_COLLECTION = 'grigliata_fog_of_war';
export const GRIGLIATA_FOG_OF_WAR_SCHEMA_VERSION = 1;

const CELL_KEY_PATTERN = /^-?\d+:-?\d+$/;
const GEOMETRY_EPSILON = 1e-6;

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeInteger = (value) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) ? numericValue : null;
};

const compareFogCells = (leftKey, rightKey) => {
  const left = decodeFogCellKey(leftKey);
  const right = decodeFogCellKey(rightKey);

  if (!left || !right) {
    return String(leftKey).localeCompare(String(rightKey));
  }

  if (left.row !== right.row) {
    return left.row - right.row;
  }

  return left.col - right.col;
};

export const buildGrigliataFogOfWarDocId = (backgroundId = '', ownerUid = '') => (
  isNonEmptyString(backgroundId) && isNonEmptyString(ownerUid)
    ? `${backgroundId.trim()}__${ownerUid.trim()}`
    : ''
);

export const encodeFogCellKey = (cell = {}) => {
  const col = normalizeInteger(cell.col);
  const row = normalizeInteger(cell.row);

  return col === null || row === null ? '' : `${col}:${row}`;
};

export const decodeFogCellKey = (cellKey) => {
  if (typeof cellKey !== 'string' || !CELL_KEY_PATTERN.test(cellKey)) {
    return null;
  }

  const [colValue, rowValue] = cellKey.split(':');
  const col = Number(colValue);
  const row = Number(rowValue);

  return Number.isInteger(col) && Number.isInteger(row)
    ? { col, row }
    : null;
};

export const normalizeFogCellKeys = (cellKeys) => {
  if (!Array.isArray(cellKeys)) {
    return null;
  }

  const normalizedKeys = new Set();

  for (const cellKey of cellKeys) {
    if (!decodeFogCellKey(cellKey)) {
      return null;
    }
    normalizedKeys.add(cellKey);
  }

  return [...normalizedKeys].sort(compareFogCells);
};

const mergeFogCellKeyLists = (cellKeySets) => {
  const mergedKeys = new Set();

  cellKeySets.forEach((cellKeys) => {
    const normalizedKeys = normalizeFogCellKeys(cellKeys);
    if (!normalizedKeys) {
      return;
    }

    normalizedKeys.forEach((cellKey) => mergedKeys.add(cellKey));
  });

  return [...mergedKeys].sort(compareFogCells);
};

export const mergeFogCellKeys = (...cellKeySets) => mergeFogCellKeyLists(cellKeySets);

const isFinitePoint = (point) => (
  Number.isFinite(Number(point?.x))
  && Number.isFinite(Number(point?.y))
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

  const squaredLength = (
    ((end.x - start.x) ** 2)
    + ((end.y - start.y) ** 2)
  );

  return dot <= squaredLength + GEOMETRY_EPSILON;
};

const pointIsInPolygon = (point, polygon) => {
  let isInside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const start = polygon[previousIndex];
    const end = polygon[index];

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

export const polygonToFogCellKeys = ({
  polygon = [],
  grid,
} = {}) => {
  const normalizedPolygon = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of Array.isArray(polygon) ? polygon : []) {
    if (isFinitePoint(point)) {
      const x = Number(point.x);
      const y = Number(point.y);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      normalizedPolygon.push({ x, y });
    }
  }

  if (normalizedPolygon.length < 3) {
    return [];
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const cellSizePx = normalizedGrid.cellSizePx;
  const minCol = Math.floor((minX - normalizedGrid.offsetXPx) / cellSizePx);
  const maxCol = Math.floor((maxX - normalizedGrid.offsetXPx) / cellSizePx);
  const minRow = Math.floor((minY - normalizedGrid.offsetYPx) / cellSizePx);
  const maxRow = Math.floor((maxY - normalizedGrid.offsetYPx) / cellSizePx);
  const cellKeys = [];

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const center = {
        x: normalizedGrid.offsetXPx + (col * cellSizePx) + (cellSizePx / 2),
        y: normalizedGrid.offsetYPx + (row * cellSizePx) + (cellSizePx / 2),
      };

      if (pointIsInPolygon(center, normalizedPolygon)) {
        cellKeys.push(encodeFogCellKey({ col, row }));
      }
    }
  }

  return normalizeFogCellKeys(cellKeys) || [];
};

export const buildCurrentFogCellKeys = ({
  tokenVisionPolygons = [],
  grid,
} = {}) => mergeFogCellKeyLists(
  (Array.isArray(tokenVisionPolygons) ? tokenVisionPolygons : [])
    .map((vision) => polygonToFogCellKeys({
      polygon: vision?.polygon,
      grid,
    }))
);

export const buildCurrentFogPolygons = ({
  tokenVisionPolygons = [],
} = {}) => {
  const fogPolygons = (Array.isArray(tokenVisionPolygons) ? tokenVisionPolygons : [])
    .map((vision) => {
      if (!Array.isArray(vision?.polygon)) {
        return null;
      }

      const ring = simplifyFogRingToPointLimit(vision.polygon, FOG_POLYGON_MAX_RING_POINTS);
      return ring.length >= 3 ? [ring] : null;
    })
    .filter(Boolean);

  return normalizeFogPolygons(fogPolygons) || [];
};

export const buildCurrentFogRenderPolygons = ({
  tokenVisionPolygons = [],
} = {}) => buildFogPolygonsFromLiveCasts(Array.isArray(tokenVisionPolygons) ? tokenVisionPolygons : []);

export const buildCurrentFogMemoryPolygons = buildCurrentFogRenderPolygons;

export const normalizeGrigliataFogOfWarDoc = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const backgroundId = typeof data.backgroundId === 'string' ? data.backgroundId.trim() : '';
  const ownerUid = typeof data.ownerUid === 'string' ? data.ownerUid.trim() : '';
  if (!backgroundId || !ownerUid) {
    return null;
  }

  const id = typeof data.id === 'string' && data.id
    ? data.id
    : buildGrigliataFogOfWarDocId(backgroundId, ownerUid);
  if (id !== buildGrigliataFogOfWarDocId(backgroundId, ownerUid)) {
    return null;
  }

  const cellSizePx = Math.round(asFiniteNumber(data.cellSizePx, 0));
  if (cellSizePx <= 0) {
    return null;
  }

  const exploredCells = normalizeFogCellKeys(data.exploredCells);
  if (!exploredCells) {
    return null;
  }
  const exploredPolygons = data.exploredPolygons === undefined
    ? []
    : normalizeFogMemoryPolygons(data.exploredPolygons, { rejectInvalid: true });
  if (!exploredPolygons) {
    return null;
  }

  return {
    schemaVersion: GRIGLIATA_FOG_OF_WAR_SCHEMA_VERSION,
    id,
    backgroundId,
    ownerUid,
    cellSizePx,
    exploredCells,
    exploredPolygons,
    updatedAt: data.updatedAt || null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
};
