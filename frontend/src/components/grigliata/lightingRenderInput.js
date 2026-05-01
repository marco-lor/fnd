export const GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION = 'grigliata_lighting_render_inputs';
export const GRIGLIATA_LIGHTING_RENDER_INPUT_SCHEMA_VERSION = 1;

const DEFAULT_LIGHT_COLOR = '#FFFFFF';
const GEOMETRY_EPSILON = 1e-6;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeSchemaVersion = (schemaVersion) => {
  const numericVersion = Number(schemaVersion);
  return Number.isFinite(numericVersion) && numericVersion > 0
    ? Math.round(numericVersion)
    : GRIGLIATA_LIGHTING_RENDER_INPUT_SCHEMA_VERSION;
};

const normalizeHexColor = (value, fallback = DEFAULT_LIGHT_COLOR) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  const expandedValue = normalizedValue.length === 4 && normalizedValue.startsWith('#')
    ? `#${normalizedValue.slice(1).split('').map((character) => `${character}${character}`).join('')}`
    : normalizedValue;

  return /^#[\da-fA-F]{6}$/.test(expandedValue)
    ? expandedValue.toUpperCase()
    : fallback;
};

const normalizeWallSegment = (wall) => {
  if (wall?.blocksSight !== true) {
    return null;
  }

  const x1 = Number(wall.x1);
  const y1 = Number(wall.y1);
  const x2 = Number(wall.x2);
  const y2 = Number(wall.y2);

  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }

  if (Math.hypot(x2 - x1, y2 - y1) <= GEOMETRY_EPSILON) {
    return null;
  }

  return {
    x1,
    y1,
    x2,
    y2,
    blocksSight: true,
  };
};

const normalizeLight = (light) => {
  const x = Number(light?.x);
  const y = Number(light?.y);
  const brightRadiusPx = Math.max(0, asFiniteNumber(light?.brightRadiusPx, 0));
  const dimRadiusPx = Math.max(0, asFiniteNumber(light?.dimRadiusPx, 0));

  if (![x, y, brightRadiusPx, dimRadiusPx].every(Number.isFinite)) {
    return null;
  }

  if (brightRadiusPx <= 0 && dimRadiusPx <= 0) {
    return null;
  }

  return {
    x,
    y,
    brightRadiusPx,
    dimRadiusPx,
    color: normalizeHexColor(light?.color),
  };
};

export const normalizeGrigliataLightingRenderInput = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const backgroundId = typeof data.backgroundId === 'string' ? data.backgroundId : '';
  if (!backgroundId) {
    return null;
  }

  return {
    schemaVersion: normalizeSchemaVersion(data.schemaVersion),
    backgroundId,
    scene: {
      darkness: clamp(asFiniteNumber(data.scene?.darkness, 0), 0, 1),
      globalLight: data.scene?.globalLight === true,
    },
    walls: (Array.isArray(data.walls) ? data.walls : [])
      .map(normalizeWallSegment)
      .filter(Boolean),
    lights: (Array.isArray(data.lights) ? data.lights : [])
      .map(normalizeLight)
      .filter(Boolean),
    updatedAt: data.updatedAt || null,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
  };
};

export const buildGrigliataLightingRenderInput = (metadata, {
  updatedAt = null,
  updatedBy = '',
} = {}) => {
  const renderInput = normalizeGrigliataLightingRenderInput({
    schemaVersion: metadata?.schemaVersion,
    backgroundId: metadata?.backgroundId,
    scene: metadata?.scene,
    walls: metadata?.walls,
    lights: metadata?.lights,
    updatedAt,
    updatedBy,
  });

  if (!renderInput) {
    throw new Error('Lighting render input requires a background id.');
  }

  return renderInput;
};
