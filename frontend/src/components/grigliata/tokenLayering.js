import { normalizeTokenSizeSquares } from './boardUtils';

const getTokenId = (token) => {
  const tokenId = token?.tokenId || token?.id || token?.ownerUid || '';
  return typeof tokenId === 'string' ? tokenId.trim() : '';
};

export const normalizeTokenLayerOrder = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenTokenIds = new Set();
  return value.reduce((tokenIds, valueTokenId) => {
    const tokenId = typeof valueTokenId === 'string' ? valueTokenId.trim() : '';
    if (!tokenId || seenTokenIds.has(tokenId)) {
      return tokenIds;
    }

    seenTokenIds.add(tokenId);
    tokenIds.push(tokenId);
    return tokenIds;
  }, []);
};

export const resolveTokenLayerOrder = (tokens = [], storedOrder = []) => {
  const activeTokenIds = [...new Set(
    (Array.isArray(tokens) ? tokens : [])
      .map((token) => getTokenId(token))
      .filter(Boolean)
  )];
  const activeTokenIdSet = new Set(activeTokenIds);
  const savedActiveTokenIds = normalizeTokenLayerOrder(storedOrder)
    .filter((tokenId) => activeTokenIdSet.has(tokenId));
  const savedActiveTokenIdSet = new Set(savedActiveTokenIds);
  const newTokenIds = activeTokenIds
    .filter((tokenId) => !savedActiveTokenIdSet.has(tokenId))
    .sort((left, right) => (left < right ? -1 : (left > right ? 1 : 0)));

  return [...savedActiveTokenIds, ...newTokenIds];
};

export const sortTokensByLayerOrder = (tokens = [], storedOrder = []) => {
  const normalizedTokens = Array.isArray(tokens) ? tokens : [];
  const tokensById = new Map();
  const tokensWithoutIds = [];

  normalizedTokens.forEach((token) => {
    const tokenId = getTokenId(token);
    if (!tokenId) {
      tokensWithoutIds.push(token);
      return;
    }
    if (!tokensById.has(tokenId)) {
      tokensById.set(tokenId, token);
    }
  });

  return [
    ...resolveTokenLayerOrder(normalizedTokens, storedOrder)
      .map((tokenId) => tokensById.get(tokenId))
      .filter(Boolean),
    ...tokensWithoutIds,
  ];
};

const getTokenFootprint = (token) => {
  const col = Number(token?.col);
  const row = Number(token?.row);
  if (!Number.isFinite(col) || !Number.isFinite(row)) {
    return null;
  }

  const size = normalizeTokenSizeSquares(token?.sizeSquares);
  return {
    left: col,
    top: row,
    right: col + size,
    bottom: row + size,
  };
};

export const doTokenFootprintsOverlap = (leftToken, rightToken) => {
  const left = getTokenFootprint(leftToken);
  const right = getTokenFootprint(rightToken);
  if (!left || !right) {
    return false;
  }

  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
};

export const buildTokenLayerStepState = ({
  tokens = [],
  tokenLayerOrder = [],
  tokenId = '',
} = {}) => {
  const orderedTokens = sortTokensByLayerOrder(tokens, tokenLayerOrder);
  const orderedTokenIds = resolveTokenLayerOrder(orderedTokens, tokenLayerOrder);
  const selectedIndex = orderedTokenIds.indexOf(tokenId);
  const selectedToken = selectedIndex >= 0 ? orderedTokens[selectedIndex] : null;
  let backwardTargetTokenId = '';
  let forwardTargetTokenId = '';

  if (selectedToken) {
    for (let index = selectedIndex - 1; index >= 0; index -= 1) {
      if (doTokenFootprintsOverlap(selectedToken, orderedTokens[index])) {
        backwardTargetTokenId = orderedTokenIds[index];
        break;
      }
    }

    for (let index = selectedIndex + 1; index < orderedTokens.length; index += 1) {
      if (doTokenFootprintsOverlap(selectedToken, orderedTokens[index])) {
        forwardTargetTokenId = orderedTokenIds[index];
        break;
      }
    }
  }

  return {
    order: orderedTokenIds,
    backwardTargetTokenId,
    forwardTargetTokenId,
    canMoveBackward: !!backwardTargetTokenId,
    canMoveForward: !!forwardTargetTokenId,
  };
};

export const moveTokenOneOverlappingLayer = ({
  tokens = [],
  tokenLayerOrder = [],
  tokenId = '',
  direction = '',
} = {}) => {
  const layerState = buildTokenLayerStepState({ tokens, tokenLayerOrder, tokenId });
  const targetTokenId = direction === 'backward'
    ? layerState.backwardTargetTokenId
    : (direction === 'forward' ? layerState.forwardTargetTokenId : '');

  if (!targetTokenId) {
    return layerState.order;
  }

  const nextOrder = layerState.order.filter((orderedTokenId) => orderedTokenId !== tokenId);
  const targetIndex = nextOrder.indexOf(targetTokenId);
  const insertionIndex = direction === 'backward' ? targetIndex : targetIndex + 1;
  nextOrder.splice(insertionIndex, 0, tokenId);
  return nextOrder;
};
