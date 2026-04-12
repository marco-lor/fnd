import {
  BOARD_FIT_PADDING,
  DEFAULT_BOARD_CELLS,
  DEFAULT_GRID,
  FEET_PER_GRID_SQUARE,
  MAX_GRID_CELL_SIZE,
  MIN_GRID_CELL_SIZE,
} from './constants';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const normalizeGridConfig = (grid) => ({
  cellSizePx: Math.round(
    clamp(asFiniteNumber(grid?.cellSizePx, DEFAULT_GRID.cellSizePx), MIN_GRID_CELL_SIZE, MAX_GRID_CELL_SIZE)
  ),
  offsetXPx: Math.round(clamp(asFiniteNumber(grid?.offsetXPx, DEFAULT_GRID.offsetXPx), -5000, 5000)),
  offsetYPx: Math.round(clamp(asFiniteNumber(grid?.offsetYPx, DEFAULT_GRID.offsetYPx), -5000, 5000)),
});

export const getTokenLabel = ({ user, userData }) => {
  const characterId = typeof userData?.characterId === 'string' ? userData.characterId.trim() : '';
  if (characterId) return characterId;

  const emailPrefix = typeof user?.email === 'string' ? user.email.split('@')[0]?.trim() : '';
  if (emailPrefix) return emailPrefix;

  return 'Player';
};

export const getInitials = (value) => {
  const safeValue = typeof value === 'string' ? value.trim() : '';
  if (!safeValue) return '?';

  const parts = safeValue.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
};

export const timestampToMillis = (value) => {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000;
  }
  return 0;
};

export const sortBackgrounds = (backgrounds) => (
  [...backgrounds].sort((left, right) => {
    const rightMillis = timestampToMillis(right.updatedAt || right.createdAt);
    const leftMillis = timestampToMillis(left.updatedAt || left.createdAt);
    if (rightMillis !== leftMillis) return rightMillis - leftMillis;
    return (left.name || '').localeCompare(right.name || '');
  })
);

export const getDisplayNameFromFileName = (fileName) => {
  const safeName = typeof fileName === 'string' ? fileName.trim() : '';
  if (!safeName) return 'Untitled Map';

  const noExtension = safeName.replace(/\.[^.]+$/, '');
  const normalized = noExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || 'Untitled Map';
};

export const getFileExtension = (fileName) => {
  const safeName = typeof fileName === 'string' ? fileName.trim() : '';
  const match = safeName.match(/(\.[^.]+)$/);
  return match ? match[1].replace(/[^.a-zA-Z0-9]/g, '') : '';
};

export const buildStorageSafeName = (value, fallback = 'asset') => {
  const safeValue = typeof value === 'string' ? value.trim() : '';
  const normalized = safeValue
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return normalized || fallback;
};

export const isManagerRole = (role) => {
  const safeRole = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return safeRole === 'dm';
};

export const isCurrentUserTokenHiddenForViewer = ({
  activeBackgroundId,
  currentUserHiddenBackgroundIds,
  currentUserPlacement,
  isManager,
}) => (
  !isManager
  && !currentUserPlacement
  && typeof activeBackgroundId === 'string'
  && !!activeBackgroundId
  && Array.isArray(currentUserHiddenBackgroundIds)
  && currentUserHiddenBackgroundIds.includes(activeBackgroundId)
);

export const getTokenPositionPx = (token, grid) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const col = asFiniteNumber(token?.col, 0);
  const row = asFiniteNumber(token?.row, 0);
  const size = normalizedGrid.cellSizePx;

  return {
    x: normalizedGrid.offsetXPx + (col * size),
    y: normalizedGrid.offsetYPx + (row * size),
    size,
  };
};

export const getGridCellPositionPx = (cell, grid, anchor = 'top-left') => {
  const position = getTokenPositionPx(cell, grid);
  if (anchor !== 'center') return position;

  return {
    ...position,
    x: position.x + (position.size / 2),
    y: position.y + (position.size / 2),
  };
};

export const snapBoardPointToGrid = (point, grid, anchor = 'top-left') => {
  const normalizedGrid = normalizeGridConfig(grid);
  const shift = anchor === 'center' ? normalizedGrid.cellSizePx / 2 : 0;
  const rawX = asFiniteNumber(point?.x, normalizedGrid.offsetXPx) - normalizedGrid.offsetXPx - shift;
  const rawY = asFiniteNumber(point?.y, normalizedGrid.offsetYPx) - normalizedGrid.offsetYPx - shift;
  const col = Math.round(rawX / normalizedGrid.cellSizePx);
  const row = Math.round(rawY / normalizedGrid.cellSizePx);

  return {
    col,
    row,
    x: normalizedGrid.offsetXPx + (col * normalizedGrid.cellSizePx),
    y: normalizedGrid.offsetYPx + (row * normalizedGrid.cellSizePx),
  };
};

export const getGridDistanceMeasurement = (
  startCell,
  endCell,
  feetPerSquare = FEET_PER_GRID_SQUARE
) => {
  const normalizedStartCell = {
    col: asFiniteNumber(startCell?.col, 0),
    row: asFiniteNumber(startCell?.row, 0),
  };
  const normalizedEndCell = {
    col: asFiniteNumber(endCell?.col, 0),
    row: asFiniteNumber(endCell?.row, 0),
  };
  const deltaCols = Math.abs(normalizedEndCell.col - normalizedStartCell.col);
  const deltaRows = Math.abs(normalizedEndCell.row - normalizedStartCell.row);
  const squares = Math.max(deltaCols, deltaRows);

  return {
    startCell: normalizedStartCell,
    endCell: normalizedEndCell,
    deltaCols,
    deltaRows,
    squares,
    feet: squares * feetPerSquare,
  };
};

export const formatGridDistanceMeasurement = (measurement) => {
  const squares = asFiniteNumber(measurement?.squares, 0);
  const feet = asFiniteNumber(measurement?.feet, 0);
  return `${feet} ft (${squares} ${squares === 1 ? 'square' : 'squares'})`;
};

const normalizeGridCell = (cell) => ({
  col: asFiniteNumber(cell?.col, 0),
  row: asFiniteNumber(cell?.row, 0),
});

export const buildGridMeasurementPath = ({
  anchorCells,
  liveEndCell,
  grid,
  feetPerSquare = FEET_PER_GRID_SQUARE,
}) => {
  const normalizedAnchorCells = (anchorCells || [])
    .filter(Boolean)
    .map((cell) => normalizeGridCell(cell));
  if (!normalizedAnchorCells.length || !liveEndCell) return null;

  const normalizedLiveEndCell = normalizeGridCell(liveEndCell);
  const pathCells = [...normalizedAnchorCells, normalizedLiveEndCell];
  const pathPoints = pathCells.map((cell, index) => ({
    ...getGridCellPositionPx(cell, grid, 'center'),
    key: `${cell.col}:${cell.row}:${index}`,
  }));

  const segments = [];
  let totalSquares = 0;
  let totalFeet = 0;

  for (let index = 0; index < pathCells.length - 1; index += 1) {
    const segment = getGridDistanceMeasurement(pathCells[index], pathCells[index + 1], feetPerSquare);
    segments.push({
      ...segment,
      startPoint: pathPoints[index],
      endPoint: pathPoints[index + 1],
    });
    totalSquares += segment.squares;
    totalFeet += segment.feet;
  }

  return {
    anchorCells: normalizedAnchorCells,
    liveEndCell: normalizedLiveEndCell,
    pathCells,
    pathPoints,
    markerPoints: pathPoints,
    segments,
    squares: totalSquares,
    feet: totalFeet,
    startPoint: pathPoints[0],
    endPoint: pathPoints[pathPoints.length - 1],
    label: formatGridDistanceMeasurement({
      squares: totalSquares,
      feet: totalFeet,
    }),
  };
};

export const buildGridMeasurementPathFromPoints = ({
  anchorPoints,
  liveEndPoint,
  grid,
  feetPerSquare = FEET_PER_GRID_SQUARE,
}) => {
  const normalizedAnchorPoints = (anchorPoints || []).filter(Boolean);
  if (!normalizedAnchorPoints.length || !liveEndPoint) return null;

  return buildGridMeasurementPath({
    anchorCells: normalizedAnchorPoints.map((point) => snapBoardPointToGrid(point, grid, 'center')),
    liveEndCell: snapBoardPointToGrid(liveEndPoint, grid, 'center'),
    grid,
    feetPerSquare,
  });
};

export const buildGridMeasurement = ({
  startCell,
  endCell,
  grid,
  feetPerSquare = FEET_PER_GRID_SQUARE,
}) => {
  const measurementPath = buildGridMeasurementPath({
    anchorCells: [startCell],
    liveEndCell: endCell,
    grid,
    feetPerSquare,
  });
  if (!measurementPath) return null;

  return {
    ...getGridDistanceMeasurement(startCell, endCell, feetPerSquare),
    startPoint: measurementPath.startPoint,
    endPoint: measurementPath.endPoint,
    label: measurementPath.label,
  };
};

export const buildGridMeasurementFromPoints = ({
  startPoint,
  endPoint,
  grid,
  feetPerSquare = FEET_PER_GRID_SQUARE,
}) => {
  const measurementPath = buildGridMeasurementPathFromPoints({
    anchorPoints: [startPoint],
    liveEndPoint: endPoint,
    grid,
    feetPerSquare,
  });
  if (!measurementPath) return null;

  return {
    ...getGridDistanceMeasurement(
      measurementPath.pathCells[0],
      measurementPath.pathCells[measurementPath.pathCells.length - 1],
      feetPerSquare
    ),
    startPoint: measurementPath.startPoint,
    endPoint: measurementPath.endPoint,
    label: measurementPath.label,
  };
};

export const getBoardBounds = ({ background, grid, tokens }) => {
  const normalizedGrid = normalizeGridConfig(grid);
  const cellSize = normalizedGrid.cellSizePx;
  const defaultWidth = DEFAULT_BOARD_CELLS * cellSize;
  const defaultHeight = DEFAULT_BOARD_CELLS * cellSize;

  let minX = Math.min(0, normalizedGrid.offsetXPx);
  let minY = Math.min(0, normalizedGrid.offsetYPx);
  let maxX = Math.max(defaultWidth, normalizedGrid.offsetXPx + defaultWidth);
  let maxY = Math.max(defaultHeight, normalizedGrid.offsetYPx + defaultHeight);

  const backgroundWidth = asFiniteNumber(background?.imageWidth, 0);
  const backgroundHeight = asFiniteNumber(background?.imageHeight, 0);

  if (backgroundWidth > 0 && backgroundHeight > 0) {
    minX = Math.min(minX, 0);
    minY = Math.min(minY, 0);
    maxX = Math.max(maxX, backgroundWidth);
    maxY = Math.max(maxY, backgroundHeight);
  }

  (tokens || []).forEach((token) => {
    if (!token?.placed) return;
    const { x, y, size } = getTokenPositionPx(token, normalizedGrid);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size);
    maxY = Math.max(maxY, y + size);
  });

  const width = Math.max(cellSize * 6, maxX - minX);
  const height = Math.max(cellSize * 6, maxY - minY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
  };
};

export const fitViewportToBounds = (
  bounds,
  viewportWidth,
  viewportHeight,
  padding = BOARD_FIT_PADDING
) => {
  const safeWidth = Math.max(1, asFiniteNumber(viewportWidth, 1));
  const safeHeight = Math.max(1, asFiniteNumber(viewportHeight, 1));
  const availableWidth = Math.max(1, safeWidth - (padding * 2));
  const availableHeight = Math.max(1, safeHeight - (padding * 2));
  const scale = clamp(
    Math.min(availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)),
    0.18,
    2.5
  );

  return {
    scale,
    x: padding + ((availableWidth - (bounds.width * scale)) / 2) - (bounds.minX * scale),
    y: padding + ((availableHeight - (bounds.height * scale)) / 2) - (bounds.minY * scale),
  };
};

export const readFileImageDimensions = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new window.Image();

  image.onload = () => {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    URL.revokeObjectURL(objectUrl);
    resolve({ width, height });
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('Unable to read image dimensions.'));
  };

  image.src = objectUrl;
});
