import {
  buildTokenLayerStepState,
  doTokenFootprintsOverlap,
  moveTokenOneOverlappingLayer,
  normalizeTokenLayerOrder,
  resolveTokenLayerOrder,
  sortTokensByLayerOrder,
} from './tokenLayering';

const token = (tokenId, col, row, sizeSquares = 1) => ({
  tokenId,
  col,
  row,
  sizeSquares,
});

describe('tokenLayering', () => {
  test('normalizes malformed orders and removes duplicate token ids', () => {
    expect(normalizeTokenLayerOrder(null)).toEqual([]);
    expect(normalizeTokenLayerOrder([' token-b ', '', null, 'token-a', 'token-b'])).toEqual([
      'token-b',
      'token-a',
    ]);
  });

  test('removes stale ids and appends unlisted active tokens at the top deterministically', () => {
    const tokens = [token('token-c', 0, 0), token('token-a', 1, 0), token('token-b', 2, 0)];

    expect(resolveTokenLayerOrder(tokens, ['stale-token', 'token-b'])).toEqual([
      'token-b',
      'token-a',
      'token-c',
    ]);
    expect(sortTokensByLayerOrder(tokens, ['token-b']).map((entry) => entry.tokenId)).toEqual([
      'token-b',
      'token-a',
      'token-c',
    ]);
  });

  test('does not treat edge-touching token footprints as overlapping', () => {
    expect(doTokenFootprintsOverlap(token('large', 0, 0, 2), token('edge', 2, 0))).toBe(false);
    expect(doTokenFootprintsOverlap(token('large', 0, 0, 2), token('inside', 1, 1))).toBe(true);
  });

  test('moves across the nearest overlapping token while skipping unrelated map tokens', () => {
    const tokens = [
      token('selected', 0, 0, 2),
      token('elsewhere', 8, 8),
      token('overlap', 1, 1),
      token('top-overlap', 0, 0),
    ];

    expect(moveTokenOneOverlappingLayer({
      tokens,
      tokenLayerOrder: ['selected', 'elsewhere', 'overlap', 'top-overlap'],
      tokenId: 'selected',
      direction: 'forward',
    })).toEqual(['elsewhere', 'overlap', 'selected', 'top-overlap']);
  });

  test('steps through stacks of more than two overlapping tokens in either direction', () => {
    const tokens = [token('bottom', 0, 0), token('middle', 0, 0), token('top', 0, 0)];
    const order = ['bottom', 'middle', 'top'];

    expect(buildTokenLayerStepState({ tokens, tokenLayerOrder: order, tokenId: 'middle' })).toMatchObject({
      canMoveBackward: true,
      canMoveForward: true,
      backwardTargetTokenId: 'bottom',
      forwardTargetTokenId: 'top',
    });
    expect(moveTokenOneOverlappingLayer({
      tokens,
      tokenLayerOrder: order,
      tokenId: 'middle',
      direction: 'backward',
    })).toEqual(['middle', 'bottom', 'top']);
    expect(moveTokenOneOverlappingLayer({
      tokens,
      tokenLayerOrder: order,
      tokenId: 'middle',
      direction: 'forward',
    })).toEqual(['bottom', 'top', 'middle']);
  });

  test('returns the canonical order unchanged when no overlapping step exists', () => {
    const tokens = [token('left', 0, 0), token('right', 4, 0)];

    expect(moveTokenOneOverlappingLayer({
      tokens,
      tokenLayerOrder: ['left', 'right'],
      tokenId: 'left',
      direction: 'forward',
    })).toEqual(['left', 'right']);
  });
});
