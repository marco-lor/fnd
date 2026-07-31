export const NARRATION_PLACEMENT_MODE_FREE = 'free';
export const NARRATION_PLACEMENT_MODE_MAGNETIC = 'magnetic';
export const NARRATION_PLACEMENT_SIDE_TOP = 'top';
export const NARRATION_PLACEMENT_SIDE_RIGHT = 'right';
export const NARRATION_PLACEMENT_SIDE_BOTTOM = 'bottom';
export const NARRATION_PLACEMENT_SIDE_LEFT = 'left';

export const NARRATION_PLACEMENT_SIDES = [
  NARRATION_PLACEMENT_SIDE_TOP,
  NARRATION_PLACEMENT_SIDE_RIGHT,
  NARRATION_PLACEMENT_SIDE_BOTTOM,
  NARRATION_PLACEMENT_SIDE_LEFT,
];

const DEFAULT_NARRATION_PLACEMENT_WIDTH = 1280;
const DEFAULT_NARRATION_PLACEMENT_HEIGHT = 720;
const FREE_PLACEMENT_OFFSET_RATIO = 0.12;

const toFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizePositiveNumber = (value, fallback) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
};

export const getNarrationPlacementDimensions = (background = {}) => ({
  width: normalizePositiveNumber(background.imageWidth, DEFAULT_NARRATION_PLACEMENT_WIDTH),
  height: normalizePositiveNumber(background.imageHeight, DEFAULT_NARRATION_PLACEMENT_HEIGHT),
});

export const buildNarrationPlacementId = (backgroundId = '') => {
  const normalizedBackgroundId = typeof backgroundId === 'string' ? backgroundId.trim() : '';
  return normalizedBackgroundId ? `background:${normalizedBackgroundId}` : '';
};

const getBackgroundIdFromPlacement = (placement = {}) => {
  const backgroundId = typeof placement.backgroundId === 'string' ? placement.backgroundId.trim() : '';
  return backgroundId;
};

const getBackgroundById = (backgroundsById, backgroundId) => {
  if (!backgroundId) return null;
  if (backgroundsById instanceof Map) {
    return backgroundsById.get(backgroundId) || null;
  }
  if (backgroundsById && typeof backgroundsById === 'object') {
    return backgroundsById[backgroundId] || null;
  }
  return null;
};

export const buildBackgroundMap = (backgrounds = []) => (
  new Map(
    (Array.isArray(backgrounds) ? backgrounds : [])
      .filter((background) => typeof background?.id === 'string' && background.id)
      .map((background) => [background.id, background])
  )
);

export const normalizeNarrationPlacement = (placement = {}, { backgroundsById = null, order = 0 } = {}) => {
  const backgroundId = getBackgroundIdFromPlacement(placement);
  if (!backgroundId) return null;

  const background = getBackgroundById(backgroundsById, backgroundId);
  if (backgroundsById && !background) return null;

  const dimensions = getNarrationPlacementDimensions(background || placement);
  const width = normalizePositiveNumber(placement.width, dimensions.width);
  const height = normalizePositiveNumber(placement.height, dimensions.height);
  const rawMode = typeof placement.mode === 'string' ? placement.mode : '';
  const mode = rawMode === NARRATION_PLACEMENT_MODE_MAGNETIC
    ? NARRATION_PLACEMENT_MODE_MAGNETIC
    : NARRATION_PLACEMENT_MODE_FREE;
  const rawSide = typeof placement.attachedSide === 'string' ? placement.attachedSide : '';
  const attachedSide = mode === NARRATION_PLACEMENT_MODE_MAGNETIC && NARRATION_PLACEMENT_SIDES.includes(rawSide)
    ? rawSide
    : '';
  const id = typeof placement.id === 'string' && placement.id.trim()
    ? placement.id.trim()
    : buildNarrationPlacementId(backgroundId);

  return {
    id,
    backgroundId,
    x: toFiniteNumber(placement.x, 0),
    y: toFiniteNumber(placement.y, 0),
    width,
    height,
    order: Number.isFinite(Number(placement.order)) ? Number(placement.order) : order,
    mode,
    attachedSide,
  };
};

export const buildInitialNarrationPlacement = (background = {}) => {
  const backgroundId = typeof background?.id === 'string' ? background.id : '';
  if (!backgroundId) return null;

  const dimensions = getNarrationPlacementDimensions(background);
  return {
    id: buildNarrationPlacementId(backgroundId),
    backgroundId,
    x: 0,
    y: 0,
    width: dimensions.width,
    height: dimensions.height,
    order: 0,
    mode: NARRATION_PLACEMENT_MODE_FREE,
    attachedSide: '',
  };
};

export const normalizeNarrationPlacements = ({ rawPlacements = [], legacyBackgroundId = '', backgrounds = [] } = {}) => {
  const backgroundsById = buildBackgroundMap(backgrounds);
  const sourcePlacements = Array.isArray(rawPlacements) && rawPlacements.length
    ? rawPlacements
    : [];
  const seenBackgroundIds = new Set();
  const normalizedPlacements = [];

  sourcePlacements.forEach((placement, index) => {
    const normalizedPlacement = normalizeNarrationPlacement(placement, { backgroundsById, order: index });
    if (!normalizedPlacement || seenBackgroundIds.has(normalizedPlacement.backgroundId)) {
      return;
    }

    seenBackgroundIds.add(normalizedPlacement.backgroundId);
    normalizedPlacements.push(normalizedPlacement);
  });

  if (!normalizedPlacements.length && legacyBackgroundId) {
    const legacyBackground = backgroundsById.get(legacyBackgroundId) || null;
    const legacyPlacement = legacyBackground ? buildInitialNarrationPlacement(legacyBackground) : null;
    if (legacyPlacement) {
      normalizedPlacements.push(legacyPlacement);
    }
  }

  return normalizedPlacements.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    return left.backgroundId.localeCompare(right.backgroundId);
  }).map((placement, index) => ({
    ...placement,
    order: index,
  }));
};

export const serializeNarrationPlacement = (placement = {}, order = 0) => ({
  id: placement.id || buildNarrationPlacementId(placement.backgroundId),
  backgroundId: placement.backgroundId || '',
  x: toFiniteNumber(placement.x, 0),
  y: toFiniteNumber(placement.y, 0),
  width: normalizePositiveNumber(placement.width, DEFAULT_NARRATION_PLACEMENT_WIDTH),
  height: normalizePositiveNumber(placement.height, DEFAULT_NARRATION_PLACEMENT_HEIGHT),
  order,
  mode: placement.mode === NARRATION_PLACEMENT_MODE_MAGNETIC
    ? NARRATION_PLACEMENT_MODE_MAGNETIC
    : NARRATION_PLACEMENT_MODE_FREE,
  attachedSide: NARRATION_PLACEMENT_SIDES.includes(placement.attachedSide) ? placement.attachedSide : '',
});

export const serializeNarrationPlacements = (placements = []) => (
  (Array.isArray(placements) ? placements : [])
    .filter((placement) => placement?.backgroundId)
    .map((placement, index) => serializeNarrationPlacement(placement, index))
);

export const buildNarrationStatePayload = (placements = []) => {
  const serializedPlacements = serializeNarrationPlacements(placements);
  return {
    presentationBackgroundId: serializedPlacements[0]?.backgroundId || '',
    presentationPlacements: serializedPlacements,
  };
};

export const getNarrationPlacementBounds = (placement = {}) => {
  const width = normalizePositiveNumber(placement.width, 0);
  const height = normalizePositiveNumber(placement.height, 0);
  if (width <= 0 || height <= 0) return null;

  const minX = toFiniteNumber(placement.x, 0);
  const minY = toFiniteNumber(placement.y, 0);
  const maxX = minX + width;
  const maxY = minY + height;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
  };
};

export const buildNarrationPlacementBounds = (placements = []) => {
  const bounds = (Array.isArray(placements) ? placements : [])
    .map(getNarrationPlacementBounds)
    .filter(Boolean);

  if (!bounds.length) return null;

  const minX = Math.min(...bounds.map((entry) => entry.minX));
  const minY = Math.min(...bounds.map((entry) => entry.minY));
  const maxX = Math.max(...bounds.map((entry) => entry.maxX));
  const maxY = Math.max(...bounds.map((entry) => entry.maxY));

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const buildMagneticPlacementPosition = ({ bounds, width, height, side }) => {
  if (side === NARRATION_PLACEMENT_SIDE_TOP) {
    return {
      x: bounds.minX + ((bounds.width - width) / 2),
      y: bounds.minY - height,
    };
  }
  if (side === NARRATION_PLACEMENT_SIDE_RIGHT) {
    return {
      x: bounds.maxX,
      y: bounds.minY + ((bounds.height - height) / 2),
    };
  }
  if (side === NARRATION_PLACEMENT_SIDE_BOTTOM) {
    return {
      x: bounds.minX + ((bounds.width - width) / 2),
      y: bounds.maxY,
    };
  }
  if (side === NARRATION_PLACEMENT_SIDE_LEFT) {
    return {
      x: bounds.minX - width,
      y: bounds.minY + ((bounds.height - height) / 2),
    };
  }

  return null;
};

const buildFreePlacementPosition = ({ bounds, width, height }) => {
  if (!bounds) return { x: 0, y: 0 };

  const offset = Math.min(bounds.width || width, bounds.height || height, width, height) * FREE_PLACEMENT_OFFSET_RATIO;
  return {
    x: bounds.minX + ((bounds.width - width) / 2) + offset,
    y: bounds.minY + ((bounds.height - height) / 2) + offset,
  };
};

export const buildNextNarrationPlacement = ({ background, existingPlacements = [], mode = NARRATION_PLACEMENT_MODE_FREE, side = '' } = {}) => {
  const backgroundId = typeof background?.id === 'string' ? background.id : '';
  if (!backgroundId) return null;
  if ((Array.isArray(existingPlacements) ? existingPlacements : []).some((placement) => placement?.backgroundId === backgroundId)) {
    return null;
  }

  const dimensions = getNarrationPlacementDimensions(background);
  const bounds = buildNarrationPlacementBounds(existingPlacements);
  const isMagnetic = mode === NARRATION_PLACEMENT_MODE_MAGNETIC && NARRATION_PLACEMENT_SIDES.includes(side) && bounds;
  const position = isMagnetic
    ? buildMagneticPlacementPosition({ bounds, width: dimensions.width, height: dimensions.height, side })
    : buildFreePlacementPosition({ bounds, width: dimensions.width, height: dimensions.height });

  return {
    id: buildNarrationPlacementId(backgroundId),
    backgroundId,
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.height,
    order: (Array.isArray(existingPlacements) ? existingPlacements : []).length,
    mode: isMagnetic ? NARRATION_PLACEMENT_MODE_MAGNETIC : NARRATION_PLACEMENT_MODE_FREE,
    attachedSide: isMagnetic ? side : '',
  };
};

export const removeNarrationPlacementByBackgroundId = (placements = [], backgroundId = '') => (
  (Array.isArray(placements) ? placements : [])
    .filter((placement) => placement?.backgroundId !== backgroundId)
    .map((placement, index) => ({
      ...placement,
      order: index,
    }))
);

export const moveNarrationPlacement = (placements = [], placementId = '', point = {}) => (
  (Array.isArray(placements) ? placements : []).map((placement) => (
    placement?.id === placementId
      ? {
          ...placement,
          x: toFiniteNumber(point.x, placement.x || 0),
          y: toFiniteNumber(point.y, placement.y || 0),
          mode: NARRATION_PLACEMENT_MODE_FREE,
          attachedSide: '',
        }
      : placement
  ))
);