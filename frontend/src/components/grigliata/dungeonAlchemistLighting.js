export const GRIGLIATA_BACKGROUND_LIGHTING_COLLECTION = 'grigliata_background_lighting';
export const DUNGEON_ALCHEMIST_LIGHTING_SCHEMA_VERSION = 1;
export const DUNGEON_ALCHEMIST_SOURCE_TYPE = 'dungeon-alchemist-foundry';
export const LIGHTING_ALIGNMENT_TOLERANCE_PX = 1;

const DEFAULT_GRID_DISTANCE = 5;
const DEFAULT_GRID_UNITS = 'ft';
const DEFAULT_LIGHT_COLOR = '#ffffff';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const isPositiveFiniteNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

const normalizeHexColor = (value, fallback = DEFAULT_LIGHT_COLOR) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  const expandedValue = normalizedValue.length === 4 && normalizedValue.startsWith('#')
    ? `#${normalizedValue.slice(1).split('').map((character) => `${character}${character}`).join('')}`
    : normalizedValue;

  return /^#[\da-fA-F]{6}$/.test(expandedValue)
    ? expandedValue.toUpperCase()
    : fallback;
};

const normalizeBoolean = (value, fallback = false) => (
  typeof value === 'boolean' ? value : fallback
);

export const parseDungeonAlchemistLightingJson = (rawJson) => {
  if (typeof rawJson !== 'string') {
    throw new Error('Dungeon Alchemist lighting import must be a JSON string.');
  }

  try {
    return JSON.parse(rawJson);
  } catch (error) {
    throw new Error('Unable to parse Dungeon Alchemist JSON.');
  }
};

export const buildDungeonAlchemistLightingAlignment = ({
  background,
  jsonWidthPx,
  jsonHeightPx,
  tolerancePx = LIGHTING_ALIGNMENT_TOLERANCE_PX,
}) => {
  const backgroundWidthPx = Math.round(asFiniteNumber(background?.imageWidth, 0));
  const backgroundHeightPx = Math.round(asFiniteNumber(background?.imageHeight, 0));
  const normalizedJsonWidthPx = Math.round(asFiniteNumber(jsonWidthPx, 0));
  const normalizedJsonHeightPx = Math.round(asFiniteNumber(jsonHeightPx, 0));
  const widthDeltaPx = backgroundWidthPx - normalizedJsonWidthPx;
  const heightDeltaPx = backgroundHeightPx - normalizedJsonHeightPx;
  const hasBackgroundDimensions = backgroundWidthPx > 0 && backgroundHeightPx > 0;
  const hasJsonDimensions = normalizedJsonWidthPx > 0 && normalizedJsonHeightPx > 0;
  const status = !hasBackgroundDimensions || !hasJsonDimensions
    ? 'missing-dimensions'
    : (
      Math.abs(widthDeltaPx) <= tolerancePx && Math.abs(heightDeltaPx) <= tolerancePx
        ? 'match'
        : 'mismatch'
    );

  return {
    status,
    backgroundWidthPx,
    backgroundHeightPx,
    jsonWidthPx: normalizedJsonWidthPx,
    jsonHeightPx: normalizedJsonHeightPx,
    widthDeltaPx,
    heightDeltaPx,
  };
};

export const getLightingAlignmentErrorMessage = (alignment) => {
  if (!alignment || alignment.status === 'match') {
    return '';
  }

  if (alignment.status === 'missing-dimensions') {
    return 'Unable to verify lighting alignment because the map or JSON dimensions are missing.';
  }

  return `Lighting JSON dimensions (${alignment.jsonWidthPx} x ${alignment.jsonHeightPx}) do not match this background (${alignment.backgroundWidthPx} x ${alignment.backgroundHeightPx}).`;
};

export const assertDungeonAlchemistLightingAlignment = (alignment) => {
  const errorMessage = getLightingAlignmentErrorMessage(alignment);
  if (errorMessage) {
    throw new Error(errorMessage);
  }
};

const normalizeWall = (wall, index) => {
  const coordinates = Array.isArray(wall?.c) ? wall.c : [];
  if (coordinates.length !== 4 || coordinates.some((coordinate) => !Number.isFinite(Number(coordinate)))) {
    return null;
  }

  const move = asFiniteNumber(wall.move, 0);
  const sense = asFiniteNumber(wall.sense, 0);
  const sound = asFiniteNumber(wall.sound, 0);
  const door = asFiniteNumber(wall.door, 0);

  return {
    id: `wall-${index + 1}`,
    x1: asFiniteNumber(coordinates[0], 0),
    y1: asFiniteNumber(coordinates[1], 0),
    x2: asFiniteNumber(coordinates[2], 0),
    y2: asFiniteNumber(coordinates[3], 0),
    blocksMovement: move !== 0,
    blocksSight: sense !== 0,
    blocksSound: sound !== 0,
    doorType: door,
    source: {
      move,
      sense,
      sound,
      door,
    },
  };
};

const normalizeLight = (light, index, { gridCellSizePx, gridDistance }) => {
  if (!Number.isFinite(Number(light?.x)) || !Number.isFinite(Number(light?.y))) {
    return null;
  }

  const brightRadiusUnits = Math.max(0, asFiniteNumber(light.bright, 0));
  const dimRadiusUnits = Math.max(0, asFiniteNumber(light.dim, 0));
  const tintAlpha = clamp(asFiniteNumber(light.tintAlpha, 0), 0, 1);
  const color = normalizeHexColor(light.tintColor);
  const unitsToPixels = gridCellSizePx / gridDistance;

  return {
    id: `light-${index + 1}`,
    x: asFiniteNumber(light.x, 0),
    y: asFiniteNumber(light.y, 0),
    brightRadiusUnits,
    dimRadiusUnits,
    brightRadiusPx: Math.round(brightRadiusUnits * unitsToPixels * 100) / 100,
    dimRadiusPx: Math.round(dimRadiusUnits * unitsToPixels * 100) / 100,
    color,
    tintAlpha,
    source: {
      bright: brightRadiusUnits,
      dim: dimRadiusUnits,
      tintColor: color,
      tintAlpha,
    },
  };
};

export const normalizeDungeonAlchemistLightingMetadata = (rawData, {
  background = null,
  fileName = '',
  importedAt = null,
  importedBy = '',
  updatedAt = null,
  updatedBy = '',
  tolerancePx = LIGHTING_ALIGNMENT_TOLERANCE_PX,
} = {}) => {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new Error('Dungeon Alchemist lighting import must be a JSON object.');
  }

  if (!isPositiveFiniteNumber(rawData.width) || !isPositiveFiniteNumber(rawData.height)) {
    throw new Error('Dungeon Alchemist JSON must include positive width and height values.');
  }

  if (!isPositiveFiniteNumber(rawData.grid)) {
    throw new Error('Dungeon Alchemist JSON must include a positive grid value.');
  }

  const backgroundId = typeof background?.id === 'string' ? background.id : '';
  if (!backgroundId) {
    throw new Error('Select a background before importing lighting metadata.');
  }

  const jsonWidthPx = Math.round(asFiniteNumber(rawData.width, 0));
  const jsonHeightPx = Math.round(asFiniteNumber(rawData.height, 0));
  const gridCellSizePx = Math.round(asFiniteNumber(rawData.grid, 0));
  const gridDistance = isPositiveFiniteNumber(rawData.gridDistance)
    ? asFiniteNumber(rawData.gridDistance, DEFAULT_GRID_DISTANCE)
    : DEFAULT_GRID_DISTANCE;
  const gridUnits = typeof rawData.gridUnits === 'string' && rawData.gridUnits.trim()
    ? rawData.gridUnits.trim()
    : DEFAULT_GRID_UNITS;
  const alignment = buildDungeonAlchemistLightingAlignment({
    background,
    jsonWidthPx,
    jsonHeightPx,
    tolerancePx,
  });

  assertDungeonAlchemistLightingAlignment(alignment);

  const normalizedWalls = (Array.isArray(rawData.walls) ? rawData.walls : [])
    .map(normalizeWall)
    .filter(Boolean);
  const normalizedLights = (Array.isArray(rawData.lights) ? rawData.lights : [])
    .map((light, index) => normalizeLight(light, index, { gridCellSizePx, gridDistance }))
    .filter(Boolean);

  return {
    schemaVersion: DUNGEON_ALCHEMIST_LIGHTING_SCHEMA_VERSION,
    backgroundId,
    source: {
      type: DUNGEON_ALCHEMIST_SOURCE_TYPE,
      fileName: typeof fileName === 'string' ? fileName : '',
      importedAt,
      importedBy: typeof importedBy === 'string' ? importedBy : '',
      widthPx: jsonWidthPx,
      heightPx: jsonHeightPx,
    },
    grid: {
      cellSizePx: gridCellSizePx,
      offsetXPx: Math.round(asFiniteNumber(rawData.shiftX, 0)),
      offsetYPx: Math.round(asFiniteNumber(rawData.shiftY, 0)),
      distance: gridDistance,
      units: gridUnits,
    },
    scene: {
      darkness: clamp(asFiniteNumber(rawData.darkness, 0), 0, 1),
      globalLight: normalizeBoolean(rawData.globalLight, false),
    },
    alignment,
    walls: normalizedWalls,
    lights: normalizedLights,
    importWarnings: {
      skippedWalls: Math.max(0, (Array.isArray(rawData.walls) ? rawData.walls.length : 0) - normalizedWalls.length),
      skippedLights: Math.max(0, (Array.isArray(rawData.lights) ? rawData.lights.length : 0) - normalizedLights.length),
    },
    updatedAt,
    updatedBy: typeof updatedBy === 'string' ? updatedBy : '',
  };
};

export const buildGrigliataLightingSummary = (metadata, importedAt = null) => ({
  sourceType: metadata?.source?.type || DUNGEON_ALCHEMIST_SOURCE_TYPE,
  schemaVersion: metadata?.schemaVersion || DUNGEON_ALCHEMIST_LIGHTING_SCHEMA_VERSION,
  wallCount: Array.isArray(metadata?.walls) ? metadata.walls.length : 0,
  lightCount: Array.isArray(metadata?.lights) ? metadata.lights.length : 0,
  alignmentStatus: metadata?.alignment?.status || '',
  importedAt,
});

