import { classifyImportedWallSegment } from './wallRuntimeState';

const WALL_ID_NUMBER_PATTERN = /^(?:manual-)?wall-(\d+)$/i;
const WALL_LABEL_NUMBER_PATTERN = /^wall\s+(\d+)$/i;
const VALID_WALL_TYPES = new Set(['wall', 'door', 'window']);
const GEOMETRY_EPSILON = 1e-6;

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeGridCellSizePx = (grid) => {
  const cellSizePx = Number(grid?.cellSizePx);
  return Number.isFinite(cellSizePx) && cellSizePx > 0 ? cellSizePx : 70;
};

const normalizeWallType = (value) => (
  VALID_WALL_TYPES.has(value) ? value : 'wall'
);

const normalizeImportedWallType = (wall) => normalizeWallType(classifyImportedWallSegment(wall));

const normalizeLabel = (value) => (
  typeof value === 'string' && value.trim() ? value.trim() : ''
);

const getWallOrdinal = (wall) => {
  const idMatch = typeof wall?.id === 'string' ? wall.id.match(WALL_ID_NUMBER_PATTERN) : null;
  if (idMatch) {
    return Number.parseInt(idMatch[1], 10);
  }

  const labelMatch = typeof wall?.label === 'string'
    ? wall.label.trim().match(WALL_LABEL_NUMBER_PATTERN)
    : null;
  return labelMatch ? Number.parseInt(labelMatch[1], 10) : 0;
};

const getNextWallOrdinal = (walls = []) => (
  (Array.isArray(walls) ? walls : []).reduce(
    (maxOrdinal, wall) => Math.max(maxOrdinal, getWallOrdinal(wall)),
    0
  ) + 1
);

export const normalizeEditableWallSegment = (wall, index = 0) => {
  const x1 = Number(wall?.x1);
  const y1 = Number(wall?.y1);
  const x2 = Number(wall?.x2);
  const y2 = Number(wall?.y2);

  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }

  if (Math.hypot(x2 - x1, y2 - y1) <= GEOMETRY_EPSILON) {
    return null;
  }

  const fallbackId = `manual-wall-${index + 1}`;
  const id = typeof wall?.id === 'string' && wall.id.trim()
    ? wall.id.trim()
    : fallbackId;
  const label = normalizeLabel(wall?.label || wall?.name);
  const blocksVision = typeof wall?.blocksVision === 'boolean'
    ? wall.blocksVision
    : wall?.blocksSight === true;
  const blocksLight = typeof wall?.blocksLight === 'boolean'
    ? wall.blocksLight
    : wall?.blocksSight === true;

  return {
    id,
    ...(label ? { label } : {}),
    x1,
    y1,
    x2,
    y2,
    wallType: normalizeImportedWallType(wall),
    blocksSight: blocksVision || blocksLight,
    blocksVision,
    blocksLight,
  };
};

export const normalizeEditableWallSegments = (walls = []) => (
  (Array.isArray(walls) ? walls : [])
    .map(normalizeEditableWallSegment)
    .filter(Boolean)
);

export const createManualWallSegment = ({
  existingWalls = [],
  startPoint = {},
  endPoint = {},
} = {}) => {
  const ordinal = getNextWallOrdinal(existingWalls);
  return normalizeEditableWallSegment({
    id: `manual-wall-${ordinal}`,
    label: `Wall ${ordinal}`,
    x1: asFiniteNumber(startPoint?.x, 0),
    y1: asFiniteNumber(startPoint?.y, 0),
    x2: asFiniteNumber(endPoint?.x, 0),
    y2: asFiniteNumber(endPoint?.y, 0),
    wallType: 'wall',
    blocksSight: true,
    blocksVision: true,
    blocksLight: true,
  }, ordinal - 1);
};

export const updateWallSegment = (walls = [], wallId = '', patch = {}) => (
  normalizeEditableWallSegments(walls).map((wall, index) => {
    if (wall.id !== wallId) {
      return wall;
    }

    const nextWall = normalizeEditableWallSegment({
      ...wall,
      ...patch,
    }, index);

    return nextWall || wall;
  })
);

export const moveWallEndpoint = (walls = [], wallId = '', endpoint = 'end', point = {}) => {
  const patch = endpoint === 'start'
    ? {
      x1: asFiniteNumber(point?.x, 0),
      y1: asFiniteNumber(point?.y, 0),
    }
    : {
      x2: asFiniteNumber(point?.x, 0),
      y2: asFiniteNumber(point?.y, 0),
    };

  return updateWallSegment(walls, wallId, patch);
};

export const moveWallSegment = (walls = [], wallId = '', delta = {}) => (
  normalizeEditableWallSegments(walls).map((wall, index) => {
    if (wall.id !== wallId) {
      return wall;
    }

    const deltaX = asFiniteNumber(delta?.x, 0);
    const deltaY = asFiniteNumber(delta?.y, 0);
    return normalizeEditableWallSegment({
      ...wall,
      x1: wall.x1 + deltaX,
      y1: wall.y1 + deltaY,
      x2: wall.x2 + deltaX,
      y2: wall.y2 + deltaY,
    }, index) || wall;
  })
);

export const toggleWallSegmentBlocking = (walls = [], wallId = '') => (
  normalizeEditableWallSegments(walls).map((wall) => {
    if (wall.id !== wallId) {
      return wall;
    }

    const nextBlocks = !(wall.blocksVision || wall.blocksLight);
    return {
      ...wall,
      blocksSight: nextBlocks,
      blocksVision: nextBlocks,
      blocksLight: nextBlocks,
    };
  })
);

export const duplicateWallSegment = (walls = [], wallId = '', {
  grid = {},
} = {}) => {
  const normalizedWalls = normalizeEditableWallSegments(walls);
  const sourceWall = normalizedWalls.find((wall) => wall.id === wallId);
  if (!sourceWall) {
    return normalizedWalls;
  }

  const ordinal = getNextWallOrdinal(normalizedWalls);
  const cellSizePx = normalizeGridCellSizePx(grid);
  const label = normalizeLabel(sourceWall.label);
  const copy = normalizeEditableWallSegment({
    ...sourceWall,
    id: `manual-wall-${ordinal}`,
    label: `${label || `Wall ${ordinal}`} Copy`,
    x1: sourceWall.x1 + cellSizePx,
    y1: sourceWall.y1 + cellSizePx,
    x2: sourceWall.x2 + cellSizePx,
    y2: sourceWall.y2 + cellSizePx,
  }, ordinal - 1);

  return copy ? [...normalizedWalls, copy] : normalizedWalls;
};

export const deleteWallSegment = (walls = [], wallId = '') => (
  normalizeEditableWallSegments(walls).filter((wall) => wall.id !== wallId)
);
