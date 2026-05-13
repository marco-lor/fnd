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

const getTokenBackgroundId = (token = {}) => (
  typeof token?.backgroundId === 'string' && token.backgroundId
    ? token.backgroundId
    : ''
);

const isPlayerOwnedToken = ({ token, tokenId, currentUserId }) => (
  !!currentUserId
  && (
    token?.ownerUid === currentUserId
    || isPlayerMainToken({ tokenId, currentUserId })
  )
);

const buildSkippedTokenDiagnostic = ({ token, tokenId, reason }) => ({
  tokenId: tokenId || token?.tokenId || token?.id || token?.ownerUid || '',
  ownerUid: typeof token?.ownerUid === 'string' ? token.ownerUid : '',
  reason,
});

const getTokenVisionSkipReason = ({
  token,
  tokenId,
  currentUserId = '',
  isManager = false,
  backgroundId = '',
}) => {
  if (!tokenId) {
    return 'missing-token-id';
  }

  const tokenBackgroundId = getTokenBackgroundId(token);
  if (backgroundId && tokenBackgroundId && tokenBackgroundId !== backgroundId) {
    return 'wrong-background';
  }

  if (token?.placed === false) {
    return 'unplaced';
  }

  if (token?.isDead === true) {
    return 'dead';
  }

  const visionSettings = normalizeTokenVisionSettings(token);
  if (!visionSettings.visionEnabled) {
    return 'vision-disabled';
  }

  if (isManager) {
    return '';
  }

  if (!isPlayerOwnedToken({ token, tokenId, currentUserId })) {
    return 'not-owned';
  }

  if (token?.tokenType === 'foe') {
    return 'foe';
  }

  if (token?.isVisibleToPlayers === false) {
    return 'hidden';
  }

  return '';
};

export const buildViewerTokenVisionEligibilityReport = ({
  tokens = [],
  currentUserId = '',
  isManager = false,
  cellSizePx = 0,
  backgroundId = '',
} = {}) => {
  const normalizedCellSizePx = normalizeCellSizePx(cellSizePx);
  const sources = [];
  const skippedTokens = [];

  (Array.isArray(tokens) ? tokens : []).forEach((token) => {
    const tokenId = getTokenId(token);
    const skipReason = getTokenVisionSkipReason({
      token,
      tokenId,
      currentUserId,
      isManager,
      backgroundId,
    });
    if (skipReason) {
      skippedTokens.push(buildSkippedTokenDiagnostic({
        token,
        tokenId,
        reason: skipReason,
      }));
      return;
    }

    const visionSettings = normalizeTokenVisionSettings(token);
    sources.push({
      ...token,
      tokenId,
      visionEnabled: visionSettings.visionEnabled,
      visionRadiusSquares: visionSettings.visionRadiusSquares,
      ...(normalizedCellSizePx > 0
        ? { visionRadiusPx: normalizedCellSizePx * visionSettings.visionRadiusSquares }
        : {}),
    });
  });

  return {
    sources,
    contributingTokenIds: sources.map((source) => source.tokenId).filter(Boolean),
    skippedTokens,
  };
};

export const resolveViewerTokenVisionSources = (args = {}) => (
  buildViewerTokenVisionEligibilityReport(args).sources
);
