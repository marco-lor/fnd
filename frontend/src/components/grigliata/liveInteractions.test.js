import {
  buildAoEFigureFromGrigliataLiveInteraction,
  buildGrigliataLiveInteractionDocId,
  buildMeasurementFromGrigliataLiveInteraction,
  filterActiveGrigliataLiveInteractions,
  GRIGLIATA_LIVE_INTERACTION_STALE_MS,
  normalizeGrigliataLiveInteractionDraft,
} from './liveInteractions';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('liveInteractions', () => {
  test('builds the shared interaction doc id from background and owner', () => {
    expect(buildGrigliataLiveInteractionDocId('map-7', 'user-2')).toBe('map-7__user-2');
  });

  test('filters out stale shared interactions', () => {
    const now = Date.UTC(2026, 3, 13, 12, 0, 0);
    const interactions = [
      {
        backgroundId: 'map-1',
        ownerUid: 'fresh-user',
        type: 'measure',
        source: 'free',
        colorKey: 'ion-cyan',
        anchorCells: [{ col: 1, row: 1 }],
        liveEndCell: { col: 3, row: 1 },
        updatedAt: { toMillis: () => now - 10_000 },
        updatedBy: 'fresh-user',
      },
      {
        backgroundId: 'map-1',
        ownerUid: 'stale-user',
        type: 'measure',
        source: 'free',
        colorKey: 'solar-amber',
        anchorCells: [{ col: 1, row: 1 }],
        liveEndCell: { col: 4, row: 1 },
        updatedAt: { toMillis: () => now - GRIGLIATA_LIVE_INTERACTION_STALE_MS - 1 },
        updatedBy: 'stale-user',
      },
    ];

    expect(filterActiveGrigliataLiveInteractions(interactions, now)).toEqual([
      expect.objectContaining({
        ownerUid: 'fresh-user',
      }),
    ]);
  });

  test('builds a renderable measurement from a shared measure interaction', () => {
    const measurement = buildMeasurementFromGrigliataLiveInteraction({
      interaction: {
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'measure',
        source: 'token-drag',
        colorKey: 'nova-teal',
        anchorCells: [{ col: 2, row: 3 }],
        liveEndCell: { col: 4, row: 3 },
        updatedAt: { toMillis: () => Date.now() },
        updatedBy: 'user-1',
      },
      grid,
    });

    expect(measurement).toEqual(expect.objectContaining({
      squares: 2,
      feet: 10,
      label: '10 ft (2 squares)',
    }));
  });

  test('builds a renderable AoE preview from a shared template interaction', () => {
    const figure = buildAoEFigureFromGrigliataLiveInteraction({
      interaction: {
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'aoe',
        source: 'aoe-create',
        colorKey: 'nova-teal',
        figureType: 'circle',
        originCell: { col: 2, row: 3 },
        targetCell: { col: 4, row: 3 },
        updatedAt: { toMillis: () => Date.now() },
        updatedBy: 'user-1',
      },
      grid,
    });

    expect(figure).toEqual(expect.objectContaining({
      figureType: 'circle',
      sizeSquares: 3,
      radius: 210,
    }));
  });

  test('returns null for invalid live interaction payloads', () => {
    expect(normalizeGrigliataLiveInteractionDraft({
      type: 'measure',
      source: 'free',
      anchorCells: [{ col: 1.2, row: 0 }],
      liveEndCell: { col: 4, row: 0 },
    })).toBeNull();

    expect(buildMeasurementFromGrigliataLiveInteraction({
      interaction: {
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'measure',
        source: 'free',
        colorKey: 'ion-cyan',
        anchorCells: [],
        liveEndCell: { col: 4, row: 0 },
        updatedAt: { toMillis: () => Date.now() },
        updatedBy: 'user-1',
      },
      grid,
    })).toBeNull();

    expect(buildAoEFigureFromGrigliataLiveInteraction({
      interaction: {
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'aoe',
        source: 'aoe-create',
        colorKey: 'ion-cyan',
        figureType: 'circle',
        originCell: { col: 2.5, row: 0 },
        targetCell: { col: 4, row: 0 },
        updatedAt: { toMillis: () => Date.now() },
        updatedBy: 'user-1',
      },
      grid,
    })).toBeNull();
  });
});
