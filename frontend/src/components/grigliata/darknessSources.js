export const DEFAULT_MANUAL_DARKNESS_RADIUS_SQUARES = 4;

const DARKNESS_ID_NUMBER_PATTERN = /^(?:manual-)?darkness-(\d+)$/i;
const DARKNESS_LABEL_NUMBER_PATTERN = /^darkness\s+(\d+)$/i;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeRadiusPx = (value) => Math.max(0, asFiniteNumber(value, 0));

const normalizeIntensity = (value) => clamp(asFiniteNumber(value, 1), 0, 1);

const normalizeGridCellSizePx = (grid) => {
  const cellSizePx = Number(grid?.cellSizePx);
  return Number.isFinite(cellSizePx) && cellSizePx > 0 ? cellSizePx : 70;
};

const normalizeLabel = (value, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const getDarknessOrdinal = (darkness) => {
  const idMatch = typeof darkness?.id === 'string' ? darkness.id.match(DARKNESS_ID_NUMBER_PATTERN) : null;
  if (idMatch) {
    return Number.parseInt(idMatch[1], 10);
  }

  const labelMatch = typeof darkness?.label === 'string'
    ? darkness.label.trim().match(DARKNESS_LABEL_NUMBER_PATTERN)
    : null;
  return labelMatch ? Number.parseInt(labelMatch[1], 10) : 0;
};

const getNextDarknessOrdinal = (darknessSources = []) => (
  (Array.isArray(darknessSources) ? darknessSources : []).reduce(
    (maxOrdinal, darkness) => Math.max(maxOrdinal, getDarknessOrdinal(darkness)),
    0
  ) + 1
);

export const normalizeEditableDarknessSource = (darkness, index = 0) => {
  const x = Number(darkness?.x);
  const y = Number(darkness?.y);
  if (![x, y].every(Number.isFinite)) {
    return null;
  }

  const fallbackId = `manual-darkness-${index + 1}`;
  const id = typeof darkness?.id === 'string' && darkness.id.trim()
    ? darkness.id.trim()
    : fallbackId;
  const label = normalizeLabel(
    darkness?.label || darkness?.name,
    `Darkness ${index + 1}`
  );

  return {
    id,
    label,
    enabled: darkness?.enabled === false ? false : true,
    x,
    y,
    radiusPx: normalizeRadiusPx(darkness?.radiusPx),
    intensity: normalizeIntensity(darkness?.intensity),
  };
};

export const normalizeEditableDarknessSources = (darknessSources = []) => (
  (Array.isArray(darknessSources) ? darknessSources : [])
    .map(normalizeEditableDarknessSource)
    .filter(Boolean)
);

export const createManualDarknessSource = ({
  existingDarknessSources = [],
  point = {},
  grid = {},
} = {}) => {
  const ordinal = getNextDarknessOrdinal(existingDarknessSources);
  const cellSizePx = normalizeGridCellSizePx(grid);

  return normalizeEditableDarknessSource({
    id: `manual-darkness-${ordinal}`,
    label: `Darkness ${ordinal}`,
    enabled: true,
    x: asFiniteNumber(point?.x, 0),
    y: asFiniteNumber(point?.y, 0),
    radiusPx: cellSizePx * DEFAULT_MANUAL_DARKNESS_RADIUS_SQUARES,
    intensity: 1,
  }, ordinal - 1);
};

export const updateDarknessSource = (darknessSources = [], darknessId = '', patch = {}) => (
  normalizeEditableDarknessSources(darknessSources).map((darkness, index) => {
    if (darkness.id !== darknessId) {
      return darkness;
    }

    return normalizeEditableDarknessSource({
      ...darkness,
      ...patch,
    }, index) || darkness;
  })
);

export const moveDarknessSource = (darknessSources = [], darknessId = '', point = {}) => updateDarknessSource(
  darknessSources,
  darknessId,
  {
    x: asFiniteNumber(point?.x, 0),
    y: asFiniteNumber(point?.y, 0),
  }
);

export const toggleDarknessSourceEnabled = (darknessSources = [], darknessId = '') => (
  normalizeEditableDarknessSources(darknessSources).map((darkness) => (
    darkness.id === darknessId
      ? { ...darkness, enabled: !darkness.enabled }
      : darkness
  ))
);

export const duplicateDarknessSource = (darknessSources = [], darknessId = '', {
  grid = {},
} = {}) => {
  const normalizedDarknessSources = normalizeEditableDarknessSources(darknessSources);
  const sourceDarkness = normalizedDarknessSources.find((darkness) => darkness.id === darknessId);
  if (!sourceDarkness) {
    return normalizedDarknessSources;
  }

  const ordinal = getNextDarknessOrdinal(normalizedDarknessSources);
  const cellSizePx = normalizeGridCellSizePx(grid);
  const copy = normalizeEditableDarknessSource({
    ...sourceDarkness,
    id: `manual-darkness-${ordinal}`,
    label: `${sourceDarkness.label} Copy`,
    x: sourceDarkness.x + cellSizePx,
    y: sourceDarkness.y + cellSizePx,
  }, ordinal - 1);

  return copy ? [...normalizedDarknessSources, copy] : normalizedDarknessSources;
};

export const deleteDarknessSource = (darknessSources = [], darknessId = '') => (
  normalizeEditableDarknessSources(darknessSources).filter((darkness) => darkness.id !== darknessId)
);
