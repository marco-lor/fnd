export const DEFAULT_TOKEN_VISION_RADIUS_SQUARES = 12;
export const MIN_TOKEN_VISION_RADIUS_SQUARES = 1;
export const MAX_TOKEN_VISION_RADIUS_SQUARES = 60;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const asFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

export const normalizeTokenVisionRadiusSquares = (
  visionRadiusSquares,
  fallback = DEFAULT_TOKEN_VISION_RADIUS_SQUARES
) => {
  const normalizedFallback = clamp(
    Math.round(asFiniteNumber(fallback, DEFAULT_TOKEN_VISION_RADIUS_SQUARES)),
    MIN_TOKEN_VISION_RADIUS_SQUARES,
    MAX_TOKEN_VISION_RADIUS_SQUARES
  );
  const numericValue = Number(visionRadiusSquares);

  if (!Number.isFinite(numericValue)) {
    return normalizedFallback;
  }

  return clamp(
    Math.round(numericValue),
    MIN_TOKEN_VISION_RADIUS_SQUARES,
    MAX_TOKEN_VISION_RADIUS_SQUARES
  );
};

export const normalizeTokenVisionSettings = (token = {}) => ({
  visionEnabled: token?.visionEnabled === false ? false : true,
  visionRadiusSquares: normalizeTokenVisionRadiusSquares(token?.visionRadiusSquares),
});

const getTokenId = (token = {}) => (
  typeof token?.tokenId === 'string' && token.tokenId
    ? token.tokenId
    : (typeof token?.id === 'string' ? token.id : '')
);

const normalizeCellSizePx = (cellSizePx) => {
  const numericCellSize = Number(cellSizePx);
  return Number.isFinite(numericCellSize) && numericCellSize > 0
    ? numericCellSize
    : 0;
};

const isPlayerMainToken = ({ tokenId, currentUserId }) => (
  !!currentUserId
  && !!tokenId
  && tokenId === currentUserId
);

const canTokenProvideVisionForViewer = ({
  token,
  tokenId,
  currentUserId = '',
  isManager = false,
}) => {
  if (!tokenId || token?.placed === false || token?.isDead === true) {
    return false;
  }

  const visionSettings = normalizeTokenVisionSettings(token);
  if (!visionSettings.visionEnabled) {
    return false;
  }

  if (isManager) {
    return true;
  }

  // Conservative milestone policy: custom/shared/foe ownership can be ambiguous,
  // so players only emit vision from their main character token id.
  return token?.isVisibleToPlayers !== false
    && isPlayerMainToken({ tokenId, currentUserId });
};

export const resolveViewerTokenVisionSources = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  cellSizePx = 0,
} = {}) => {
  const normalizedCellSizePx = normalizeCellSizePx(cellSizePx);

  return (Array.isArray(tokens) ? tokens : [])
    .map((token) => {
      const tokenId = getTokenId(token);
      if (!canTokenProvideVisionForViewer({
        token,
        tokenId,
        currentUserId,
        isManager,
      })) {
        return null;
      }

      const visionSettings = normalizeTokenVisionSettings(token);
      return {
        ...token,
        tokenId,
        visionEnabled: visionSettings.visionEnabled,
        visionRadiusSquares: visionSettings.visionRadiusSquares,
        ...(normalizedCellSizePx > 0
          ? { visionRadiusPx: normalizedCellSizePx * visionSettings.visionRadiusSquares }
          : {}),
      };
    })
    .filter(Boolean);
};
