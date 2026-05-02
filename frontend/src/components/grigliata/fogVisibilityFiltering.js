import {
  getTokenPositionPx,
  normalizeGridConfig,
  normalizeTokenSizeSquares,
} from './boardUtils';
import {
  encodeFogCellKey,
  normalizeFogCellKeys,
} from './fogOfWar';

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

const buildCurrentVisibleCellSet = (fogOfWar) => {
  const normalizedCells = normalizeFogCellKeys(fogOfWar?.currentVisibleCells);
  if (!normalizedCells?.length) {
    return null;
  }

  return new Set(normalizedCells);
};

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
  currentCellSet = null,
  grid,
} = {}) => {
  if (isPlayerMainToken({ token, currentUserId })) {
    return true;
  }

  return boundsIntersectVisibleCells({
    bounds: getTokenBounds({ token, grid }),
    grid,
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
  const currentCellSet = buildCurrentVisibleCellSet(fogOfWar);

  return asArray(tokens).filter((token) => isFogVisibleToken({
    token,
    currentUserId,
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
  const currentCellSet = buildCurrentVisibleCellSet(fogOfWar);
  const belowFogTokens = [];
  const aboveFogTokens = [];

  asArray(tokens).forEach((token) => {
    if (
      isPlayerMainToken({ token, currentUserId })
      && !boundsIntersectVisibleCells({
        bounds: getTokenBounds({ token, grid: normalizedGrid }),
        grid: normalizedGrid,
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
