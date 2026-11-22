import { buildTokenStackCells, isTokenStackPointVisible } from './tokenStacks';
import { filterFogVisibleTokens, splitFogVisibleTokenRenderLayers } from './fogVisibilityFiltering';

const grid = { cellSizePx: 40, offsetXPx: 0, offsetYPx: 0 };
const token = (tokenId, col, row, overrides = {}) => ({
  tokenId,
  col,
  row,
  sizeSquares: 1,
  canMove: true,
  ...overrides,
});

const rectangle = (left, top, right, bottom) => [
  { x: left, y: top }, { x: right, y: top },
  { x: right, y: bottom }, { x: left, y: bottom },
];

const build = (belowFogTokens, options = {}) => buildTokenStackCells({
  belowFogTokens,
  grid,
  ...options,
});

test('orders each layer top to bottom and puts above-fog tokens first', () => {
  const stacks = build([
    token('bottom', 0, 0),
    token('middle', 0, 0, { canMove: false }),
    token('preview', 0, 0, { isDragPreview: true }),
  ], {
    aboveFogTokens: [token('above-back', 0, 0), token('above-front', 0, 0)],
  });

  expect(stacks.get('0:0')).toEqual({
    col: 0,
    row: 0,
    tokenIds: ['above-front', 'above-back', 'middle', 'bottom'],
    anchor: { x: 20, y: 20 },
    badgeCellKey: '0:0',
  });
});

test('requires a movable token below the top and ignores edge-only contact', () => {
  const stacks = build([
    token('locked-bottom', 0, 0, { sizeSquares: 2, canMove: false }),
    token('movable-top', 1, 1),
    token('touching', 2, 1),
  ]);

  expect(stacks.size).toBe(0);
});

test('gives coincident large tokens one badge and retains each cell for hit lookup', () => {
  const stacks = build([
    token('bottom', -2, 1, { sizeSquares: 2 }),
    token('top', -2, 1, { sizeSquares: 2 }),
  ], { grid: { cellSizePx: 40, offsetXPx: 13, offsetYPx: -7 } });

  expect([...stacks.keys()].sort()).toEqual(['-1:1', '-1:2', '-2:1', '-2:2']);
  expect(new Set([...stacks.values()].map((cell) => cell.badgeCellKey))).toEqual(new Set(['-2:1']));
  expect([...stacks.values()].map((cell) => cell.anchor).filter(Boolean)).toEqual([{ x: -47, y: 53 }]);
});

test('groups the cells where large token disks actually overlap', () => {
  const stacks = build([
    token('bottom', 0, 0, { sizeSquares: 9 }),
    token('top', 0, 0, { sizeSquares: 9 }),
  ], { grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 } });

  expect(stacks.has('0:0')).toBe(false);
  expect(stacks.get('1:0')).toMatchObject({ badgeCellKey: '1:0', tokenIds: ['top', 'bottom'] });
  expect(stacks.get('4:4')).toMatchObject({ badgeCellKey: '1:0', anchor: null });
  const { x, y } = stacks.get('1:0').anchor;
  expect(x).toBeGreaterThan(70);
  expect(x).toBeLessThan(140);
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThan(70);
  expect(Math.hypot(x - 315, y - 315)).toBeLessThan(314);
});

test('keeps separate badges when matching stacks touch only diagonally', () => {
  const stacks = build([
    token('bottom', 0, 0, { sizeSquares: 2 }),
    token('top', 0, 0, { sizeSquares: 2 }),
    token('extra-right', 1, 0),
    token('extra-left', 0, 1),
  ]);

  expect(stacks.get('0:0')).toMatchObject({ tokenIds: ['top', 'bottom'], badgeCellKey: '0:0' });
  expect(stacks.get('1:1')).toMatchObject({ tokenIds: ['top', 'bottom'], badgeCellKey: '1:1' });
  expect(stacks.get('1:0')).toMatchObject({ tokenIds: ['extra-right', 'top', 'bottom'], badgeCellKey: '1:0' });
  expect(stacks.get('0:1')).toMatchObject({ tokenIds: ['extra-left', 'top', 'bottom'], badgeCellKey: '0:1' });
});

test('keeps separate badges on either side of a fully fogged shared cell', () => {
  const stacks = build([
    token('bottom', 0, 0, { sizeSquares: 3 }),
    token('top', 0, 0, { sizeSquares: 3 }),
  ], {
    fogOfWar: { currentVisiblePolygons: [[rectangle(10, 50, 15, 55)], [rectangle(105, 50, 110, 55)]] },
  });

  expect([...stacks.values()].map(({ badgeCellKey }) => badgeCellKey)).toEqual(['0:1', '2:1']);
});

test('omits the shared fogged cells of two tokens rendered from separate visible areas', () => {
  const fogOfWar = {
    currentVisiblePolygons: [[rectangle(0, 0, 40, 80)], [rectangle(80, 0, 120, 80)]],
    currentVisibleCells: ['1:0'],
    exploredCells: ['1:1'],
  };
  const rendered = filterFogVisibleTokens({
    tokens: [token('left', 0, 0, { sizeSquares: 2 }), token('right', 1, 0, { sizeSquares: 2 })],
    grid,
    fogOfWar,
  });

  expect(rendered.map(({ tokenId }) => tokenId)).toEqual(['left', 'right']);
  expect(build(rendered, { fogOfWar }).size).toBe(0);
  expect([...build(rendered, { fogOfWar, isFogViewerManager: true }).keys()]).toEqual(['1:0', '1:1']);
});

test('omits the stack when a 3 px corner opening misses both 70 px token bodies', () => {
  const grid = { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 };
  const fogOfWar = { currentVisiblePolygons: [[rectangle(0, 0, 3, 3)]] };
  const rendered = filterFogVisibleTokens({
    tokens: [token('bottom', 0, 0), token('top', 0, 0)],
    grid,
    fogOfWar,
  });

  expect(rendered.map(({ tokenId }) => tokenId)).toEqual(['bottom', 'top']);
  expect(build(rendered, { grid, fogOfWar }).size).toBe(0);
});

test('anchors the stack in a 3 px interior opening away from the center', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(17, 26, 20, 29)]] };
  const stacks = build([token('bottom', 0, 0), token('top', 0, 0)], {
    grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
    fogOfWar,
  });

  expect(stacks.get('0:0')).toMatchObject({ tokenIds: ['top', 'bottom'] });
  const { x, y } = stacks.get('0:0').anchor;
  expect(x).toBeGreaterThan(17);
  expect(x).toBeLessThan(20);
  expect(y).toBeGreaterThan(26);
  expect(y).toBeLessThan(29);
});

test('finds the exposed part of the bodies when the opening straddles their circular edge', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(0, 15, 3, 35)]] };
  const stacks = build([token('bottom', 0, 0), token('top', 0, 0)], {
    grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
    fogOfWar,
  });

  const { x, y } = stacks.get('0:0').anchor;
  expect(x).toBeGreaterThan(0);
  expect(x).toBeLessThan(3);
  expect(y).toBeGreaterThan(15);
  expect(y).toBeLessThan(35);
  expect(Math.hypot(x - 35, y - 35)).toBeLessThan(34);
});

test('keeps the exposed pair when the opening in the shared cell misses a third large token', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(22, 10, 25, 13)]] };
  const stacks = build([
    token('bottom', 0, 0),
    token('top', 0, 0),
    token('large', 0, 0, { sizeSquares: 2 }),
  ], {
    grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
    fogOfWar,
  });

  expect(stacks.get('0:0')).toMatchObject({ tokenIds: ['top', 'bottom'] });
});

test('includes both covered tokens exposed at different points of the same cell', () => {
  const grid = { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 };
  const fogOfWar = { currentVisiblePolygons: [[rectangle(90, 131, 120, 134)]] };
  const left = token('left', 0, 0, { sizeSquares: 2 });
  const right = token('right', 1, 0, { sizeSquares: 2 });
  const guard = token('guard', 1, 1, { canMove: false });
  const stack = build([left, right, guard], { grid, fogOfWar }).get('1:1');

  expect(stack.tokenIds).toEqual(['guard', 'right', 'left']);
  const hits = (token, x) => isTokenStackPointVisible({ token, grid, fogOfWar, point: { x, y: 132 } });
  expect([hits(left, 94), hits(right, 94)]).toEqual([true, false]);
  expect([hits(left, 116), hits(right, 116)]).toEqual([false, true]);
});

test('uses a world point strictly inside a narrow fog opening on an offset grid', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(125, -27, 126, -23)]] };
  const stacks = build([token('bottom', 2, -1), token('top', 2, -1)], {
    grid: { cellSizePx: 40, offsetXPx: 10, offsetYPx: 4 },
    fogOfWar,
  });

  const { anchor } = stacks.get('2:-1');
  expect(anchor.x).toBeGreaterThan(125);
  expect(anchor.x).toBeLessThan(126);
  expect(anchor.y).toBeGreaterThan(-27);
  expect(anchor.y).toBeLessThan(-23);
});

test('honors polygon holes and ignores cell and memory fallback in the mask', () => {
  const tokens = [token('bottom', 0, 0), token('top', 0, 0)];
  const fogOfWar = { currentVisibleCells: ['0:0'], exploredCells: ['0:0'] };

  expect(build(tokens, { fogOfWar }).size).toBe(0);
  expect(build(tokens, {
    fogOfWar: { ...fogOfWar, currentVisiblePolygons: [[rectangle(-100, -100, 100, 100), rectangle(0, 0, 40, 40)]] },
  }).size).toBe(0);
});

test('finds a visible anchor when a hole covers the cell center', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(0, 0, 40, 40), rectangle(5, 5, 35, 35)]] };
  const stacks = build([token('bottom', 0, 0), token('top', 0, 0)], { fogOfWar });

  const { x, y } = stacks.get('0:0').anchor;
  expect(x).toBeGreaterThan(0);
  expect(x).toBeLessThan(40);
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThan(40);
  expect(x < 5 || x > 35 || y < 5 || y > 35).toBe(true);
});

test('uses the render-layer exception for the retained player token', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(51, 20, 56, 29)]] };
  const tokens = [token('player', 0, 0), token('visible-elsewhere', 0, 0, { sizeSquares: 2 })];
  const { aboveFogTokens, belowFogTokens } = splitFogVisibleTokenRenderLayers({
    tokens,
    currentUserId: 'player',
    grid,
    fogOfWar,
  });

  expect(aboveFogTokens.map(({ tokenId }) => tokenId)).toEqual(['player']);
  expect(buildTokenStackCells({ aboveFogTokens, belowFogTokens, fogOfWar, grid }).size).toBe(0);
});

test('keeps both layers where the below-fog footprint is visible', () => {
  const fogOfWar = { currentVisiblePolygons: [[rectangle(5, 5, 9, 9)]] };
  const stacks = build([token('below', 0, 0)], { fogOfWar, aboveFogTokens: [token('above', 0, 0)] });

  expect(stacks.get('0:0')).toMatchObject({
    tokenIds: ['above', 'below'],
  });
});

test('keeps stacks above fog in hidden cells and leaves hidden below-fog tokens out', () => {
  const stacks = build([token('hidden', 0, 0)], {
    aboveFogTokens: [token('above-back', 0, 0), token('above-front', 0, 0)],
    fogOfWar: {},
  });

  expect(stacks.get('0:0')).toEqual({
    col: 0,
    row: 0,
    tokenIds: ['above-front', 'above-back'],
    anchor: { x: 20, y: 20 },
    badgeCellKey: '0:0',
  });
});

test('checks the exact drag point against the current opening and the above-fog exception', () => {
  const isVisible = (point, options = {}) => isTokenStackPointVisible({
    point,
    token: token('bottom', 0, 0),
    grid,
    fogOfWar: { currentVisiblePolygons: [[rectangle(0, 0, 40, 40), rectangle(10, 10, 30, 30)]] },
    ...options,
  });

  expect(isVisible({ x: 5, y: 5 })).toBe(false);
  expect(isVisible({ x: 5, y: 20 })).toBe(true);
  expect(isVisible({ x: 0, y: 5 })).toBe(false);
  expect(isVisible({ x: 10, y: 20 })).toBe(false);
  expect(isVisible({ x: 20, y: 20 })).toBe(false);
  expect(isVisible({ x: 50, y: 20 }, { fogOfWar: { currentVisibleCells: ['1:0'] } })).toBe(false);
  expect(isVisible({ x: 20, y: 20 }, { aboveFogTokens: [token('bottom', 0, 0)] })).toBe(true);
  expect(isVisible({ x: 20, y: 20 }, { isFogViewerManager: true })).toBe(true);
});

test('allows a drag hit on the exposed rim of the rendered token body', () => {
  const movedToken = token('bottom', 0, 0, {
    position: { x: 0, y: 0, size: 70 },
    renderPosition: { x: 70, y: 0, size: 70 },
  });
  const fogOfWar = { currentVisiblePolygons: [[rectangle(70, 34, 73, 36)]] };

  expect(isTokenStackPointVisible({ point: { x: 71.5, y: 35 }, token: movedToken, grid, fogOfWar })).toBe(true);
  expect(isTokenStackPointVisible({ point: { x: 70.5, y: 35 }, token: movedToken, grid, fogOfWar })).toBe(false);
});
