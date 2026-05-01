import {
  buildGrigliataLightingRenderInput,
  GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION,
  normalizeGrigliataLightingRenderInput,
} from './lightingRenderInput';

describe('lighting render input sanitization', () => {
  test('builds the player-readable collection name and preserves scene lighting values', () => {
    const renderInput = buildGrigliataLightingRenderInput({
      schemaVersion: 1,
      backgroundId: 'map-1',
      scene: {
        darkness: 0.65,
        globalLight: true,
      },
      walls: [],
      lights: [],
      source: {
        fileName: 'dungeon-alchemist.json',
      },
      alignment: {
        status: 'match',
      },
      importWarnings: {
        skippedWalls: 0,
      },
    }, {
      updatedAt: 'now',
      updatedBy: 'dm-1',
    });

    expect(GRIGLIATA_LIGHTING_RENDER_INPUT_COLLECTION).toBe('grigliata_lighting_render_inputs');
    expect(renderInput).toEqual({
      schemaVersion: 1,
      backgroundId: 'map-1',
      scene: {
        darkness: 0.65,
        globalLight: true,
      },
      walls: [],
      lights: [],
      updatedAt: 'now',
      updatedBy: 'dm-1',
    });
    expect(renderInput).not.toHaveProperty('source');
    expect(renderInput).not.toHaveProperty('alignment');
    expect(renderInput).not.toHaveProperty('importWarnings');
  });

  test('keeps only finite sight-blocking wall segments and strips wall diagnostics', () => {
    const renderInput = buildGrigliataLightingRenderInput({
      schemaVersion: 1,
      backgroundId: 'map-1',
      scene: { darkness: 0.5, globalLight: false },
      walls: [{
        id: 'wall-source-id',
        x1: 10,
        y1: 20,
        x2: 90,
        y2: 20,
        blocksSight: true,
        blocksMovement: true,
        blocksSound: true,
        doorType: 1,
        source: { move: 1, sense: 1, sound: 1, door: 1 },
      }, {
        x1: 5,
        y1: 5,
        x2: 80,
        y2: 5,
        blocksSight: false,
      }, {
        x1: 10,
        y1: 10,
        x2: 10,
        y2: 10,
        blocksSight: true,
      }, {
        x1: Number.NaN,
        y1: 0,
        x2: 5,
        y2: 5,
        blocksSight: true,
      }],
      lights: [],
    });

    expect(renderInput.walls).toEqual([{
      x1: 10,
      y1: 20,
      x2: 90,
      y2: 20,
      blocksSight: true,
    }]);
  });

  test('keeps renderable finite scene lights and strips source-only light fields', () => {
    const renderInput = buildGrigliataLightingRenderInput({
      schemaVersion: 1,
      backgroundId: 'map-1',
      scene: { darkness: 0.5, globalLight: false },
      walls: [],
      lights: [{
        id: 'light-source-id',
        x: 100,
        y: 120,
        brightRadiusPx: 60,
        dimRadiusPx: 140,
        color: '#ffad00',
        tintAlpha: 0.25,
        brightRadiusUnits: 5,
        dimRadiusUnits: 10,
        source: {
          tintColor: '#ffad00',
          tintAlpha: 0.25,
        },
      }, {
        x: 200,
        y: 120,
        brightRadiusPx: 0,
        dimRadiusPx: 0,
        color: '#ffffff',
      }, {
        x: Number.POSITIVE_INFINITY,
        y: 10,
        brightRadiusPx: 30,
        dimRadiusPx: 0,
      }, {
        x: 220,
        y: 140,
        brightRadiusPx: 0,
        dimRadiusPx: 30,
        color: 'not-a-color',
      }],
    });

    expect(renderInput.lights).toEqual([{
      x: 100,
      y: 120,
      brightRadiusPx: 60,
      dimRadiusPx: 140,
      color: '#FFAD00',
    }, {
      x: 220,
      y: 140,
      brightRadiusPx: 0,
      dimRadiusPx: 30,
      color: '#FFFFFF',
    }]);
  });

  test('normalizes snapshot render input defensively before rendering', () => {
    const renderInput = normalizeGrigliataLightingRenderInput({
      schemaVersion: '2',
      backgroundId: 'map-1',
      scene: {
        darkness: 7,
        globalLight: 'yes',
      },
      walls: [{
        x1: '0',
        y1: 0,
        x2: 70,
        y2: 0,
        blocksSight: true,
        doorType: 1,
      }],
      lights: [{
        x: '35',
        y: 35,
        brightRadiusPx: '140',
        dimRadiusPx: 0,
        color: '#abc',
        id: 'raw-light-id',
      }],
      source: {
        fileName: 'source.json',
      },
      updatedAt: 'then',
      updatedBy: 123,
    });

    expect(renderInput).toEqual({
      schemaVersion: 2,
      backgroundId: 'map-1',
      scene: {
        darkness: 1,
        globalLight: false,
      },
      walls: [{
        x1: 0,
        y1: 0,
        x2: 70,
        y2: 0,
        blocksSight: true,
      }],
      lights: [{
        x: 35,
        y: 35,
        brightRadiusPx: 140,
        dimRadiusPx: 0,
        color: '#AABBCC',
      }],
      updatedAt: 'then',
      updatedBy: '',
    });
  });
});
