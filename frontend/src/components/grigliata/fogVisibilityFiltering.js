import {
  getTokenPositionPx,
  normalizeGridConfig,
  normalizeTokenSizeSquares,
} from './boardUtils';
import {
  encodeFogCellKey,
  normalizeFogCellKeys,
} from './fogOfWar';
import { normalizeRenderableFogPolygons } from './fogPolygonGeometry';

const GEOMETRY_EPSILON = 1e-6;

const asArray = (value) => (Array.isArray(value) ? value : []);

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const getTokenId = (token = {}) => (
  typeof token?.tokenId === 'string' && token.tokenId
    ? token.tokenId
    : (typeof token?.id === 'string' && token.id ? token.id : '')
);

const isPlayerMainToken = ({ token, currentUserId = '' }) => (
  !!currentUserId
  && getTokenId(token) === currentUserId
);

const isPlayerOwnedToken = ({ token, currentUserId = '' }) => (
  !!currentUserId
  && (
    token?.ownerUid === currentUserId
    || isPlayerMainToken({ token, currentUserId })
  )
);

const isRetainedPlayerDragPreview = ({ token, currentUserId = '' }) => (
  token?.isDragPreview === true
  && isPlayerOwnedToken({ token, currentUserId })
  && token?.tokenType !== 'foe'
  && token?.isDead !== true
  && token?.isVisibleToPlayers !== false
  && token?.visionEnabled !== false
);

const isRetainedPlayerToken = ({ token, currentUserId = '' }) => (
  isPlayerMainToken({ token, currentUserId })
  || isRetainedPlayerDragPreview({ token, currentUserId })
);

const buildCurrentVisibleCellSet = (fogOfWar) => {
  const normalizedCells = normalizeFogCellKeys(fogOfWar?.currentVisibleCells);
  if (!normalizedCells?.length) {
    return null;
  }

  return new Set(normalizedCells);
};

const buildCurrentVisiblePolygons = (fogOfWar) => (
  normalizeRenderableFogPolygons(fogOfWar?.currentVisiblePolygons) || []
);

const normalizeBounds = (bounds) => {
  if (!bounds || typeof bounds !== 'object') {
    return null;
  }

  const minX = Number.isFinite(Number(bounds.minX))
    ? Number(bounds.minX)
    : Number(bounds.x);
  const minY = Number.isFinite(Number(bounds.minY))
    ? Number(bounds.minY)
    : Number(bounds.y);
  const maxX = Number.isFinite(Number(bounds.maxX))
    ? Number(bounds.maxX)
    : minX + Number(bounds.width);
  const maxY = Number.isFinite(Number(bounds.maxY))
    ? Number(bounds.maxY)
    : minY + Number(bounds.height);

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }

  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
};

const getBoundsOccupiedCellKeys = ({ bounds, grid }) => {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return [];
  }

  const minCol = Math.floor((normalizedBounds.minX - grid.offsetXPx) / grid.cellSizePx);
  const minRow = Math.floor((normalizedBounds.minY - grid.offsetYPx) / grid.cellSizePx);
  const maxCol = Math.floor(((normalizedBounds.maxX - GEOMETRY_EPSILON) - grid.offsetXPx) / grid.cellSizePx);
  const maxRow = Math.floor(((normalizedBounds.maxY - GEOMETRY_EPSILON) - grid.offsetYPx) / grid.cellSizePx);
  const cellKeys = [];

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const cellKey = encodeFogCellKey({ col, row });
      if (cellKey) {
        cellKeys.push(cellKey);
      }
    }
  }

  return cellKeys;
};

const boundsIntersectVisibleCells = ({ bounds, grid, currentCellSet }) => {
  if (!currentCellSet) {
    return false;
  }

  return getBoundsOccupiedCellKeys({ bounds, grid })
    .some((cellKey) => currentCellSet.has(cellKey));
};

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
  const outerRing = polygon?.[0];
  if (!Array.isArray(outerRing) || outerRing.length < 3 || !pointIsInRing(point, outerRing)) {
    return false;
  }

  return !polygon.slice(1).some((holeRing) => pointIsInRing(point, holeRing));
};

const pointIsInBounds = (point, bounds) => (
  point.x >= bounds.minX - GEOMETRY_EPSILON
  && point.x <= bounds.maxX + GEOMETRY_EPSILON
  && point.y >= bounds.minY - GEOMETRY_EPSILON
  && point.y <= bounds.maxY + GEOMETRY_EPSILON
);

const getBoundsCorners = (bounds) => ([
  { x: bounds.minX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY },
  { x: bounds.minX, y: bounds.maxY },
]);

const getBoundsEdges = (bounds) => {
  const corners = getBoundsCorners(bounds);
  return corners.map((corner, index) => ({
    start: corner,
    end: corners[(index + 1) % corners.length],
  }));
};

const orientation = (left, right, point) => {
  const value = (
    (right.y - left.y) * (point.x - right.x)
    - (right.x - left.x) * (point.y - right.y)
  );

  if (Math.abs(value) <= GEOMETRY_EPSILON) {
    return 0;
  }
  return value > 0 ? 1 : 2;
};

const segmentsIntersect = (leftStart, leftEnd, rightStart, rightEnd) => {
  const leftOrientationStart = orientation(leftStart, leftEnd, rightStart);
  const leftOrientationEnd = orientation(leftStart, leftEnd, rightEnd);
  const rightOrientationStart = orientation(rightStart, rightEnd, leftStart);
  const rightOrientationEnd = orientation(rightStart, rightEnd, leftEnd);

  if (leftOrientationStart !== leftOrientationEnd && rightOrientationStart !== rightOrientationEnd) {
    return true;
  }

  return (
    (leftOrientationStart === 0 && pointIsOnSegment(rightStart, leftStart, leftEnd))
    || (leftOrientationEnd === 0 && pointIsOnSegment(rightEnd, leftStart, leftEnd))
    || (rightOrientationStart === 0 && pointIsOnSegment(leftStart, rightStart, rightEnd))
    || (rightOrientationEnd === 0 && pointIsOnSegment(leftEnd, rightStart, rightEnd))
  );
};

const ringIntersectsBounds = ({ ring = [], bounds }) => {
  if (!Array.isArray(ring) || ring.length < 3) {
    return false;
  }

  if (ring.some((point) => pointIsInBounds(point, bounds))) {
    return true;
  }

  const boundsEdges = getBoundsEdges(bounds);
  return ring.some((point, index) => {
    const nextPoint = ring[(index + 1) % ring.length];
    return boundsEdges.some((edge) => segmentsIntersect(point, nextPoint, edge.start, edge.end));
  });
};

const boundsIntersectFogPolygon = ({ bounds, polygon }) => {
  const normalizedBounds = normalizeBounds(bounds);
  const outerRing = polygon?.[0];
  if (!normalizedBounds || !Array.isArray(outerRing) || outerRing.length < 3) {
    return false;
  }

  if (getBoundsCorners(normalizedBounds).some((corner) => pointIsInFogPolygon(corner, polygon))) {
    return true;
  }

  return ringIntersectsBounds({ ring: outerRing, bounds: normalizedBounds });
};

const boundsIntersectVisiblePolygons = ({ bounds, currentPolygons }) => (
  Array.isArray(currentPolygons)
  && currentPolygons.some((polygon) => boundsIntersectFogPolygon({ bounds, polygon }))
);

const boundsIntersectCurrentVisibility = ({ bounds, grid, currentPolygons, currentCellSet }) => (
  Array.isArray(currentPolygons) && currentPolygons.length > 0
    ? boundsIntersectVisiblePolygons({ bounds, currentPolygons })
    : boundsIntersectVisibleCells({ bounds, grid, currentCellSet })
);

const getTokenBounds = ({ token, grid }) => {
  const position = token?.renderPosition
    || token?.position
    || getTokenPositionPx(token, grid);
  const x = asFiniteNumber(position?.x, 0);
  const y = asFiniteNumber(position?.y, 0);
  const size = Number.isFinite(Number(position?.size))
    ? Number(position.size)
    : grid.cellSizePx * normalizeTokenSizeSquares(token?.sizeSquares);

  return {
    minX: x,
    minY: y,
    maxX: x + size,
    maxY: y + size,
  };
};

export const isFogVisibleToken = ({
  token,
  currentUserId = '',
  currentPolygons = [],
  currentCellSet = null,
  grid,
} = {}) => {
  if (isRetainedPlayerToken({ token, currentUserId })) {
    return true;
  }

  return boundsIntersectCurrentVisibility({
    bounds: getTokenBounds({ token, grid }),
    grid,
    currentPolygons,
    currentCellSet,
  });
};

export const filterFogVisibleTokens = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  grid,
  fogOfWar = null,
} = {}) => {
  if (isManager || !fogOfWar) {
    return tokens;
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const currentPolygons = buildCurrentVisiblePolygons(fogOfWar);
  const currentCellSet = buildCurrentVisibleCellSet(fogOfWar);

  return asArray(tokens).filter((token) => isFogVisibleToken({
    token,
    currentUserId,
    currentPolygons,
    currentCellSet,
    grid: normalizedGrid,
  }));
};

export const splitFogVisibleTokenRenderLayers = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  grid,
  fogOfWar = null,
} = {}) => {
  if (isManager || !fogOfWar || !currentUserId) {
    return {
      belowFogTokens: asArray(tokens),
      aboveFogTokens: [],
    };
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const currentPolygons = buildCurrentVisiblePolygons(fogOfWar);
  const currentCellSet = buildCurrentVisibleCellSet(fogOfWar);
  const belowFogTokens = [];
  const aboveFogTokens = [];

  asArray(tokens).forEach((token) => {
    if (
      isRetainedPlayerToken({ token, currentUserId })
      && !boundsIntersectCurrentVisibility({
        bounds: getTokenBounds({ token, grid: normalizedGrid }),
        grid: normalizedGrid,
        currentPolygons,
        currentCellSet,
      })
    ) {
      aboveFogTokens.push(token);
      return;
    }

    belowFogTokens.push(token);
  });

  return {
    belowFogTokens,
    aboveFogTokens,
  };
};

export const filterFogVisibleTurnOrderEntries = ({
  entries = [],
  tokens = [],
  isManager = false,
  fogOfWar = null,
} = {}) => {
  if (isManager || !fogOfWar) {
    return entries;
  }

  const visibleTokenIds = new Set(
    asArray(tokens)
      .map((token) => getTokenId(token))
      .filter(Boolean)
  );

  return asArray(entries).filter((entry) => visibleTokenIds.has(entry?.tokenId));
};
