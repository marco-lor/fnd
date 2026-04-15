export const DEFAULT_GRID = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

const hexToRgb = (hexColor) => {
  const normalizedColor = typeof hexColor === 'string'
    ? hexColor.trim().replace('#', '')
    : '';
  const expandedColor = normalizedColor.length === 3
    ? normalizedColor.split('').map((character) => `${character}${character}`).join('')
    : normalizedColor;

  if (!/^[\da-fA-F]{6}$/.test(expandedColor)) {
    return [255, 255, 255];
  }

  return [0, 2, 4].map((startIndex) => Number.parseInt(expandedColor.slice(startIndex, startIndex + 2), 16));
};

const withAlpha = (hexColor, alpha) => {
  const [red, green, blue] = hexToRgb(hexColor);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const createGrigliataDrawTheme = ({ key, label, hex }) => ({
  key,
  label,
  hex,
  stroke: hex,
  glow: hex,
  outlineStroke: 'rgba(0, 0, 0, 0.92)',
  fill: withAlpha(hex, 0.18),
  labelBorder: withAlpha(hex, 0.82),
  labelText: withAlpha(hex, 0.94),
  tokenLabelText: withAlpha(hex, 0.9),
  swatchBorder: withAlpha(hex, 0.62),
  swatchBackground: `linear-gradient(135deg, ${withAlpha(hex, 0.3)} 0%, ${withAlpha(hex, 0.92)} 100%)`,
  swatchGlow: `0 0 18px ${withAlpha(hex, 0.42)}`,
});

export const GRIGLIATA_DRAW_THEMES = [
  createGrigliataDrawTheme({
    key: 'aurora-fuchsia',
    label: 'Aurora Fuchsia',
    hex: '#f472b6',
  }),
  createGrigliataDrawTheme({
    key: 'ion-cyan',
    label: 'Ion Cyan',
    hex: '#38bdf8',
  }),
  createGrigliataDrawTheme({
    key: 'nova-teal',
    label: 'Nova Teal',
    hex: '#2dd4bf',
  }),
  createGrigliataDrawTheme({
    key: 'volt-lime',
    label: 'Volt Lime',
    hex: '#a3e635',
  }),
  createGrigliataDrawTheme({
    key: 'solar-amber',
    label: 'Solar Amber',
    hex: '#fbbf24',
  }),
  createGrigliataDrawTheme({
    key: 'warp-violet',
    label: 'Warp Violet',
    hex: '#a855f7',
  }),
];

export const DEFAULT_GRIGLIATA_DRAW_COLOR_KEY = 'aurora-fuchsia';

const grigliataDrawThemeByKey = new Map(
  GRIGLIATA_DRAW_THEMES.map((theme) => [theme.key, theme])
);

export const resolveGrigliataDrawColorKey = (colorKey) => (
  grigliataDrawThemeByKey.has(colorKey)
    ? colorKey
    : DEFAULT_GRIGLIATA_DRAW_COLOR_KEY
);

export const getGrigliataDrawTheme = (colorKey = DEFAULT_GRIGLIATA_DRAW_COLOR_KEY) => (
  grigliataDrawThemeByKey.get(resolveGrigliataDrawColorKey(colorKey))
  || GRIGLIATA_DRAW_THEMES[0]
);

export const FEET_PER_GRID_SQUARE = 5;
export const DEFAULT_BOARD_CELLS = 20;
export const MIN_GRID_CELL_SIZE = 24;
export const MAX_GRID_CELL_SIZE = 240;
export const BOARD_FIT_PADDING = 48;
export const MAP_PING_HOLD_DELAY_MS = 500;
export const MAP_PING_VISIBLE_MS = 1100;
export const MAP_PING_BROADCAST_CLEAR_MS = 1500;
export const MAP_PING_ANIMATION_INTERVAL_MS = 32;
export const TRAY_DRAG_MIME = 'application/x-grigliata-token';
