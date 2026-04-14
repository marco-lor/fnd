import { getGridCellPositionPx, normalizeGridConfig } from './boardUtils';
import { FEET_PER_GRID_SQUARE, resolveGrigliataDrawColorKey } from './constants';

export const GRIGLIATA_AOE_FIGURE_COLLECTION = 'grigliata_aoe_figures';
export const GRIGLIATA_AOE_FIGURE_TYPES = ['circle', 'square', 'cone'];
export const MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE = 5;
export const GRIGLIATA_AOE_FIGURE_CONE_ANGLE_DEGREES = 53.13;

const CONE_HALF_ANGLE_RADIANS = (GRIGLIATA_AOE_FIGURE_CONE_ANGLE_DEGREES * Math.PI) / 360;
const EIGHT_WAY_DIRECTION_RADIANS = [
  -Math.PI,
  (-3 * Math.PI) / 4,
  -Math.PI / 2,
  -Math.PI / 4,
  0,
  Math.PI / 4,
  Math.PI / 2,
  (3 * Math.PI) / 4,
];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

const normalizeGridCell = (cell) => {
  if (!Number.isInteger(cell?.col) || !Number.isInteger(cell?.row)) {
    return null;
  }

  return {
    col: cell.col,
    row: cell.row,
  };
};

const normalizeSlot = (slot) => {
  const numericSlot = Number(slot);
  if (!Number.isInteger(numericSlot)) {
    return 0;
  }

  return numericSlot;
};

const getFigureSizeSquares = ({ originCell, targetCell }) => (
  Math.max(
    Math.abs(targetCell.col - originCell.col),
    Math.abs(targetCell.row - originCell.row),
  ) + 1
);

const getNearestDirectionAngle = (deltaX, deltaY) => {
  if (deltaX === 0 && deltaY === 0) {
    return 0;
  }

  const rawAngle = Math.atan2(deltaY, deltaX);

  return EIGHT_WAY_DIRECTION_RADIANS.reduce((closestAngle, candidateAngle) => (
    Math.abs(candidateAngle - rawAngle) < Math.abs(closestAngle - rawAngle)
      ? candidateAngle
      : closestAngle
  ), EIGHT_WAY_DIRECTION_RADIANS[0]);
};

const buildBoundsFromPoints = (points) => {
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const minX = Math.min(...xValues);
  const minY = Math.min(...yValues);
  const maxX = Math.max(...xValues);
  const maxY = Math.max(...yValues);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const buildCircleMeasurement = (sizeSquares) => {
  const radiusFeet = sizeSquares * FEET_PER_GRID_SQUARE;
  const diameterFeet = radiusFeet * 2;

  return {
    radiusFeet,
    diameterFeet,
    label: `R ${radiusFeet} ft • D ${diameterFeet} ft`,
  };
};

const buildSquareMeasurement = (sizeSquares) => {
  const sideFeet = sizeSquares * FEET_PER_GRID_SQUARE;

  return {
    sideFeet,
    label: `${sideFeet} ft side`,
  };
};

const buildConeMeasurement = (sizeSquares) => {
  const lengthFeet = sizeSquares * FEET_PER_GRID_SQUARE;
  const widthFeet = lengthFeet;
  const angleDegrees = Math.round(GRIGLIATA_AOE_FIGURE_CONE_ANGLE_DEGREES);

  return {
    lengthFeet,
    widthFeet,
    angleDegrees,
    label: `L ${lengthFeet} ft • W ${widthFeet} ft • ${angleDegrees}°`,
  };
};

export const buildGrigliataAoEFigureDocId = (backgroundId, ownerUid, figureType, slot) => (
  isNonEmptyString(backgroundId)
  && isNonEmptyString(ownerUid)
  && GRIGLIATA_AOE_FIGURE_TYPES.includes(figureType)
  && normalizeSlot(slot) >= 1
  && normalizeSlot(slot) <= MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE
    ? `${backgroundId.trim()}__${ownerUid.trim()}__${figureType}__${normalizeSlot(slot)}`
    : ''
);

export const normalizeGrigliataAoEFigureDraft = (draft) => {
  if (!draft || !GRIGLIATA_AOE_FIGURE_TYPES.includes(draft.figureType)) {
    return null;
  }

  const originCell = normalizeGridCell(draft.originCell);
  const targetCell = normalizeGridCell(draft.targetCell);
  if (!originCell || !targetCell) {
    return null;
  }

  return {
    figureType: draft.figureType,
    originCell,
    targetCell,
  };
};

export const normalizeGrigliataAoEFigure = (figure) => {
  const draft = normalizeGrigliataAoEFigureDraft(figure);
  const slot = normalizeSlot(figure?.slot);

  if (
    !draft
    || !isNonEmptyString(figure?.backgroundId)
    || !isNonEmptyString(figure?.ownerUid)
    || slot < 1
    || slot > MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE
  ) {
    return null;
  }

  return {
    id: isNonEmptyString(figure?.id)
      ? figure.id.trim()
      : buildGrigliataAoEFigureDocId(figure.backgroundId, figure.ownerUid, draft.figureType, slot),
    backgroundId: figure.backgroundId.trim(),
    ownerUid: figure.ownerUid.trim(),
    figureType: draft.figureType,
    slot,
    originCell: draft.originCell,
    targetCell: draft.targetCell,
    colorKey: resolveGrigliataDrawColorKey(figure?.colorKey),
    isVisibleToPlayers: figure?.isVisibleToPlayers !== false,
    createdAt: figure?.createdAt || null,
    createdBy: isNonEmptyString(figure?.createdBy) ? figure.createdBy.trim() : '',
    updatedAt: figure?.updatedAt || null,
    updatedBy: isNonEmptyString(figure?.updatedBy) ? figure.updatedBy.trim() : '',
  };
};

export const buildGrigliataAoEFigureDoc = ({
  backgroundId,
  ownerUid,
  slot,
  colorKey,
  isVisibleToPlayers = true,
  draft,
  createdAt,
  createdBy,
  updatedAt,
  updatedBy,
}) => {
  const normalizedDraft = normalizeGrigliataAoEFigureDraft(draft);
  const normalizedSlot = normalizeSlot(slot);

  if (
    !normalizedDraft
    || !isNonEmptyString(backgroundId)
    || !isNonEmptyString(ownerUid)
    || normalizedSlot < 1
    || normalizedSlot > MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE
  ) {
    return null;
  }

  return {
    backgroundId: backgroundId.trim(),
    ownerUid: ownerUid.trim(),
    figureType: normalizedDraft.figureType,
    slot: normalizedSlot,
    originCell: normalizedDraft.originCell,
    targetCell: normalizedDraft.targetCell,
    colorKey: resolveGrigliataDrawColorKey(colorKey),
    isVisibleToPlayers: isVisibleToPlayers !== false,
    createdAt: createdAt || null,
    createdBy: isNonEmptyString(createdBy) ? createdBy.trim() : '',
    updatedAt: updatedAt || null,
    updatedBy: isNonEmptyString(updatedBy) ? updatedBy.trim() : '',
  };
};

export const shiftGrigliataAoEFigureCells = (figureLike, colDelta, rowDelta) => {
  const normalizedDraft = normalizeGrigliataAoEFigureDraft(figureLike);
  if (!normalizedDraft || !Number.isInteger(colDelta) || !Number.isInteger(rowDelta)) {
    return null;
  }

  return {
    ...normalizedDraft,
    originCell: {
      col: normalizedDraft.originCell.col + colDelta,
      row: normalizedDraft.originCell.row + rowDelta,
    },
    targetCell: {
      col: normalizedDraft.targetCell.col + colDelta,
      row: normalizedDraft.targetCell.row + rowDelta,
    },
  };
};

export const findNextGrigliataAoEFigureSlot = (figures, { backgroundId, ownerUid, figureType }) => {
  if (
    !isNonEmptyString(backgroundId)
    || !isNonEmptyString(ownerUid)
    || !GRIGLIATA_AOE_FIGURE_TYPES.includes(figureType)
  ) {
    return 0;
  }

  const occupiedSlots = new Set(
    (figures || [])
      .map((figure) => normalizeGrigliataAoEFigure(figure))
      .filter(Boolean)
      .filter((figure) => (
        figure.backgroundId === backgroundId
        && figure.ownerUid === ownerUid
        && figure.figureType === figureType
      ))
      .map((figure) => figure.slot)
  );

  for (let slot = 1; slot <= MAX_GRIGLIATA_AOE_FIGURES_PER_TYPE; slot += 1) {
    if (!occupiedSlots.has(slot)) {
      return slot;
    }
  }

  return 0;
};

export const buildRenderableGrigliataAoEFigure = ({ figure, grid }) => {
  const normalizedFigure = normalizeGrigliataAoEFigure(figure) || normalizeGrigliataAoEFigureDraft(figure);
  if (!normalizedFigure) {
    return null;
  }

  const normalizedGrid = normalizeGridConfig(grid);
  const cellSize = normalizedGrid.cellSizePx;
  const sizeSquares = getFigureSizeSquares(normalizedFigure);
  const originCenter = getGridCellPositionPx(normalizedFigure.originCell, normalizedGrid, 'center');
  const originTopLeft = getGridCellPositionPx(normalizedFigure.originCell, normalizedGrid, 'top-left');

  if (normalizedFigure.figureType === 'circle') {
    const radius = sizeSquares * cellSize;

    return {
      ...normalizedFigure,
      sizeSquares,
      measurement: buildCircleMeasurement(sizeSquares),
      centerPoint: { x: originCenter.x, y: originCenter.y },
      radius,
      bounds: {
        minX: originCenter.x - radius,
        minY: originCenter.y - radius,
        maxX: originCenter.x + radius,
        maxY: originCenter.y + radius,
        width: radius * 2,
        height: radius * 2,
      },
    };
  }

  if (normalizedFigure.figureType === 'square') {
    const side = sizeSquares * cellSize;
    const xDirection = normalizedFigure.targetCell.col < normalizedFigure.originCell.col ? -1 : 1;
    const yDirection = normalizedFigure.targetCell.row < normalizedFigure.originCell.row ? -1 : 1;
    const x = xDirection > 0 ? originTopLeft.x : originTopLeft.x - side + cellSize;
    const y = yDirection > 0 ? originTopLeft.y : originTopLeft.y - side + cellSize;

    return {
      ...normalizedFigure,
      sizeSquares,
      measurement: buildSquareMeasurement(sizeSquares),
      x,
      y,
      width: side,
      height: side,
      bounds: {
        minX: x,
        minY: y,
        maxX: x + side,
        maxY: y + side,
        width: side,
        height: side,
      },
    };
  }

  if (normalizedFigure.figureType === 'cone') {
    const length = sizeSquares * cellSize;
    const deltaX = normalizedFigure.targetCell.col - normalizedFigure.originCell.col;
    const deltaY = normalizedFigure.targetCell.row - normalizedFigure.originCell.row;
    const directionAngle = getNearestDirectionAngle(deltaX, deltaY);
    const leftPoint = {
      x: originCenter.x + (Math.cos(directionAngle - CONE_HALF_ANGLE_RADIANS) * length),
      y: originCenter.y + (Math.sin(directionAngle - CONE_HALF_ANGLE_RADIANS) * length),
    };
    const rightPoint = {
      x: originCenter.x + (Math.cos(directionAngle + CONE_HALF_ANGLE_RADIANS) * length),
      y: originCenter.y + (Math.sin(directionAngle + CONE_HALF_ANGLE_RADIANS) * length),
    };
    const polygonPoints = [
      { x: originCenter.x, y: originCenter.y },
      leftPoint,
      rightPoint,
    ];

    return {
      ...normalizedFigure,
      sizeSquares,
      measurement: buildConeMeasurement(sizeSquares),
      centerPoint: { x: originCenter.x, y: originCenter.y },
      length,
      directionAngle,
      points: polygonPoints,
      flatPoints: polygonPoints.flatMap((point) => [point.x, point.y]),
      bounds: buildBoundsFromPoints(polygonPoints),
    };
  }

  return null;
};
