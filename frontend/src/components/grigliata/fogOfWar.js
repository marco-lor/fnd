import { normalizeGridConfig } from './boardUtils';

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

export const mergeFogCellKeys = (...cellKeySets) => {
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
  const normalizedPolygon = (Array.isArray(polygon) ? polygon : [])
    .filter(isFinitePoint)
    .map((point) => ({
      x: Number(point.x),
      y: Number(point.y),
    }));

  if (normalizedPolygon.length < 3) {
    return [];
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const cellSizePx = normalizedGrid.cellSizePx;
  const minX = Math.min(...normalizedPolygon.map((point) => point.x));
  const maxX = Math.max(...normalizedPolygon.map((point) => point.x));
  const minY = Math.min(...normalizedPolygon.map((point) => point.y));
  const maxY = Math.max(...normalizedPolygon.map((point) => point.y));
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
} = {}) => mergeFogCellKeys(
  ...(Array.isArray(tokenVisionPolygons) ? tokenVisionPolygons : [])
    .map((vision) => polygonToFogCellKeys({
      polygon: vision?.polygon,
      grid,
    }))
);

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

  return {
    schemaVersion: GRIGLIATA_FOG_OF_WAR_SCHEMA_VERSION,
    id,
    backgroundId,
    ownerUid,
    cellSizePx,
    exploredCells,
    updatedAt: data.updatedAt || null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
};
