import {
  buildGrigliataAoEFigureDocId,
  buildRenderableGrigliataAoEFigure,
  findNextGrigliataAoEFigureSlot,
  normalizeGrigliataAoEFigureDraft,
  shiftGrigliataAoEFigureCells,
} from './aoeFigures';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('aoeFigures', () => {
  test('builds the AoE figure doc id from background, owner, type, and slot', () => {
    expect(buildGrigliataAoEFigureDocId('map-7', 'user-2', 'circle', 3)).toBe('map-7__user-2__circle__3');
  });

  test('finds the first free slot for a figure type on the current map', () => {
    expect(findNextGrigliataAoEFigureSlot([
      { backgroundId: 'map-1', ownerUid: 'user-1', figureType: 'circle', slot: 1, originCell: { col: 1, row: 1 }, targetCell: { col: 2, row: 2 } },
      { backgroundId: 'map-1', ownerUid: 'user-1', figureType: 'circle', slot: 3, originCell: { col: 2, row: 2 }, targetCell: { col: 4, row: 4 } },
      { backgroundId: 'map-2', ownerUid: 'user-1', figureType: 'circle', slot: 2, originCell: { col: 0, row: 0 }, targetCell: { col: 1, row: 1 } },
    ], {
      backgroundId: 'map-1',
      ownerUid: 'user-1',
      figureType: 'circle',
    })).toBe(2);
  });

  test('normalizes and shifts a valid AoE figure draft', () => {
    const normalizedDraft = normalizeGrigliataAoEFigureDraft({
      figureType: 'square',
      originCell: { col: 2, row: 2 },
      targetCell: { col: 4, row: 5 },
    });

    expect(shiftGrigliataAoEFigureCells(normalizedDraft, -1, 2)).toEqual({
      figureType: 'square',
      originCell: { col: 1, row: 4 },
      targetCell: { col: 3, row: 7 },
    });
  });

  test('builds a renderable circle template with the expected radius and size', () => {
    const figure = buildRenderableGrigliataAoEFigure({
      figure: {
        figureType: 'circle',
        originCell: { col: 3, row: 4 },
        targetCell: { col: 5, row: 4 },
      },
      grid,
    });

    expect(figure).toEqual(expect.objectContaining({
      figureType: 'circle',
      sizeSquares: 3,
      radius: 210,
      centerPoint: { x: 245, y: 315 },
    }));
  });

  test('builds a renderable square template in the drag quadrant', () => {
    const figure = buildRenderableGrigliataAoEFigure({
      figure: {
        figureType: 'square',
        originCell: { col: 4, row: 4 },
        targetCell: { col: 2, row: 1 },
      },
      grid,
    });

    expect(figure).toEqual(expect.objectContaining({
      figureType: 'square',
      sizeSquares: 4,
      x: 70,
      y: 70,
      width: 280,
      height: 280,
    }));
  });

  test('builds a renderable cone template with a snapped direction and polygon points', () => {
    const figure = buildRenderableGrigliataAoEFigure({
      figure: {
        figureType: 'cone',
        originCell: { col: 2, row: 2 },
        targetCell: { col: 5, row: 4 },
      },
      grid,
    });

    expect(figure).toEqual(expect.objectContaining({
      figureType: 'cone',
      sizeSquares: 4,
      length: 280,
    }));
    expect(figure.points).toHaveLength(3);
    expect(figure.bounds.width).toBeGreaterThan(0);
    expect(figure.bounds.height).toBeGreaterThan(0);
  });
});
