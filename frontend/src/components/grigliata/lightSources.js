export const DEFAULT_MANUAL_LIGHT_BRIGHT_RADIUS_SQUARES = 4;
export const DEFAULT_MANUAL_LIGHT_DIM_RADIUS_SQUARES = 8;
export const DEFAULT_LIGHT_SOURCE_COLOR = '#FFFFFF';
export const LIGHT_SOURCE_COLOR_SWATCHES = ['#FFFFFF', '#FFAD00'];

const LIGHT_ID_NUMBER_PATTERN = /^(?:manual-)?light-(\d+)$/i;
const LIGHT_LABEL_NUMBER_PATTERN = /^light\s+(\d+)$/i;

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeHexColor = (value, fallback = DEFAULT_LIGHT_SOURCE_COLOR) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  const expandedValue = normalizedValue.length === 4 && normalizedValue.startsWith('#')
    ? `#${normalizedValue.slice(1).split('').map((character) => `${character}${character}`).join('')}`
    : normalizedValue;

  return /^#[\da-fA-F]{6}$/.test(expandedValue)
    ? expandedValue.toUpperCase()
    : fallback;
};

const normalizeRadiusPx = (value) => Math.max(0, asFiniteNumber(value, 0));

const normalizeGridCellSizePx = (grid) => {
  const cellSizePx = Number(grid?.cellSizePx);
  return Number.isFinite(cellSizePx) && cellSizePx > 0 ? cellSizePx : 70;
};

const getLightOrdinal = (light) => {
  const idMatch = typeof light?.id === 'string' ? light.id.match(LIGHT_ID_NUMBER_PATTERN) : null;
  if (idMatch) {
    return Number.parseInt(idMatch[1], 10);
  }

  const labelMatch = typeof light?.label === 'string' ? light.label.trim().match(LIGHT_LABEL_NUMBER_PATTERN) : null;
  return labelMatch ? Number.parseInt(labelMatch[1], 10) : 0;
};

const getNextLightOrdinal = (lights = []) => (
  (Array.isArray(lights) ? lights : []).reduce(
    (maxOrdinal, light) => Math.max(maxOrdinal, getLightOrdinal(light)),
    0
  ) + 1
);

export const normalizeEditableLightSource = (light, index = 0) => {
  const x = Number(light?.x);
  const y = Number(light?.y);
  if (![x, y].every(Number.isFinite)) {
    return null;
  }

  const brightRadiusPx = normalizeRadiusPx(light?.brightRadiusPx);
  const dimRadiusPx = normalizeRadiusPx(light?.dimRadiusPx);
  const fallbackId = `manual-light-${index + 1}`;
  const id = typeof light?.id === 'string' && light.id.trim()
    ? light.id.trim()
    : fallbackId;
  const label = typeof light?.label === 'string' && light.label.trim()
    ? light.label.trim()
    : `Light ${index + 1}`;

  return {
    id,
    label,
    enabled: light?.enabled === false ? false : true,
    x,
    y,
    brightRadiusPx,
    dimRadiusPx,
    color: normalizeHexColor(light?.color),
  };
};

export const normalizeEditableLightSources = (lights = []) => (
  (Array.isArray(lights) ? lights : [])
    .map(normalizeEditableLightSource)
    .filter(Boolean)
);

export const createManualLightSource = ({
  existingLights = [],
  point = {},
  grid = {},
} = {}) => {
  const ordinal = getNextLightOrdinal(existingLights);
  const cellSizePx = normalizeGridCellSizePx(grid);

  return normalizeEditableLightSource({
    id: `manual-light-${ordinal}`,
    label: `Light ${ordinal}`,
    enabled: true,
    x: asFiniteNumber(point?.x, 0),
    y: asFiniteNumber(point?.y, 0),
    brightRadiusPx: cellSizePx * DEFAULT_MANUAL_LIGHT_BRIGHT_RADIUS_SQUARES,
    dimRadiusPx: cellSizePx * DEFAULT_MANUAL_LIGHT_DIM_RADIUS_SQUARES,
    color: DEFAULT_LIGHT_SOURCE_COLOR,
  }, ordinal - 1);
};

export const updateLightSource = (lights = [], lightId = '', patch = {}) => (
  normalizeEditableLightSources(lights).map((light, index) => {
    if (light.id !== lightId) {
      return light;
    }

    return normalizeEditableLightSource({
      ...light,
      ...patch,
    }, index) || light;
  })
);

export const moveLightSource = (lights = [], lightId = '', point = {}) => updateLightSource(
  lights,
  lightId,
  {
    x: asFiniteNumber(point?.x, 0),
    y: asFiniteNumber(point?.y, 0),
  }
);

export const toggleLightSourceEnabled = (lights = [], lightId = '') => (
  normalizeEditableLightSources(lights).map((light) => (
    light.id === lightId
      ? { ...light, enabled: !light.enabled }
      : light
  ))
);

export const duplicateLightSource = (lights = [], lightId = '', {
  grid = {},
} = {}) => {
  const normalizedLights = normalizeEditableLightSources(lights);
  const sourceLight = normalizedLights.find((light) => light.id === lightId);
  if (!sourceLight) {
    return normalizedLights;
  }

  const ordinal = getNextLightOrdinal(normalizedLights);
  const cellSizePx = normalizeGridCellSizePx(grid);
  const copy = normalizeEditableLightSource({
    ...sourceLight,
    id: `manual-light-${ordinal}`,
    label: `${sourceLight.label} Copy`,
    x: sourceLight.x + cellSizePx,
    y: sourceLight.y + cellSizePx,
  }, ordinal - 1);

  return copy ? [...normalizedLights, copy] : normalizedLights;
};

export const deleteLightSource = (lights = [], lightId = '') => (
  normalizeEditableLightSources(lights).filter((light) => light.id !== lightId)
);
