import {
  buildAoEFigureFromGrigliataLiveInteraction,
  buildGrigliataLiveInteractionDoc,
  buildGrigliataLiveInteractionDocId,
  buildMeasurementFromGrigliataLiveInteraction,
  buildPingFromGrigliataLiveInteraction,
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

  test('normalizes and builds a renderable ping interaction', () => {
    const draft = normalizeGrigliataLiveInteractionDraft({
      type: 'ping',
      source: 'free',
      point: { x: 412.5, y: 188.25 },
      startedAtMs: 1_713_100_000_250,
    });

    expect(draft).toEqual({
      type: 'ping',
      source: 'free',
      point: { x: 412.5, y: 188.25 },
      startedAtMs: 1_713_100_000_250,
    });

    expect(buildGrigliataLiveInteractionDoc({
      backgroundId: 'map-1',
      ownerUid: 'user-7',
      colorKey: 'ion-cyan',
      draft,
      updatedBy: 'user-7',
      updatedAt: { toMillis: () => 1_713_100_000_300 },
    })).toEqual(expect.objectContaining({
      backgroundId: 'map-1',
      ownerUid: 'user-7',
      type: 'ping',
      source: 'free',
      point: { x: 412.5, y: 188.25 },
      startedAtMs: 1_713_100_000_250,
      colorKey: 'ion-cyan',
      updatedBy: 'user-7',
    }));

    expect(buildPingFromGrigliataLiveInteraction({
      interaction: {
        backgroundId: 'map-1',
        ownerUid: 'user-7',
        type: 'ping',
        source: 'free',
        colorKey: 'ion-cyan',
        point: { x: 412.5, y: 188.25 },
        startedAtMs: 1_713_100_000_250,
        updatedAt: { toMillis: () => 1_713_100_000_300 },
        updatedBy: 'user-7',
      },
    })).toEqual({
      point: { x: 412.5, y: 188.25 },
      startedAtMs: 1_713_100_000_250,
    });
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

    expect(normalizeGrigliataLiveInteractionDraft({
      type: 'ping',
      source: 'free',
      point: { x: Number.NaN, y: 42 },
      startedAtMs: Date.now(),
    })).toBeNull();

    expect(buildPingFromGrigliataLiveInteraction({
      interaction: {
        backgroundId: 'map-1',
        ownerUid: 'user-1',
        type: 'ping',
        source: 'free',
        colorKey: 'ion-cyan',
        point: { x: 240, y: 180 },
        startedAtMs: 0,
        updatedAt: { toMillis: () => Date.now() },
        updatedBy: 'user-1',
      },
    })).toBeNull();
  });
});
