import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildDungeonAlchemistLightingAlignment,
  buildGrigliataLightingSummary,
  DUNGEON_ALCHEMIST_LIGHTING_SCHEMA_VERSION,
  DUNGEON_ALCHEMIST_SOURCE_TYPE,
  getLightingAlignmentErrorMessage,
  normalizeDungeonAlchemistLightingMetadata,
  parseDungeonAlchemistLightingJson,
} from './dungeonAlchemistLighting';

const readSampleJson = () => readFileSync(
  join(process.cwd(), 'map_test', 'map_test_dynamic_lighting.json'),
  'utf8'
);

const background = {
  id: 'map-1',
  imageWidth: 2040,
  imageHeight: 1620,
  grid: { cellSizePx: 70, offsetXPx: 0, offsetYPx: 0 },
};

describe('Dungeon Alchemist lighting normalization', () => {
  test('normalizes the provided Dungeon Alchemist Foundry JSON fixture', () => {
    const parsed = parseDungeonAlchemistLightingJson(readSampleJson());
    const metadata = normalizeDungeonAlchemistLightingMetadata(parsed, {
      background,
      fileName: 'map_test_dynamic_lighting.json',
      importedAt: 'now',
      importedBy: 'dm-1',
      updatedAt: 'now',
      updatedBy: 'dm-1',
    });

    expect(metadata).toEqual(expect.objectContaining({
      schemaVersion: DUNGEON_ALCHEMIST_LIGHTING_SCHEMA_VERSION,
      backgroundId: 'map-1',
      source: expect.objectContaining({
        type: DUNGEON_ALCHEMIST_SOURCE_TYPE,
        fileName: 'map_test_dynamic_lighting.json',
        widthPx: 2040,
        heightPx: 1620,
      }),
      grid: {
        cellSizePx: 60,
        offsetXPx: 0,
        offsetYPx: 0,
        distance: 5,
        units: 'ft',
      },
      scene: {
        darkness: 0.6,
        globalLight: true,
      },
      alignment: expect.objectContaining({
        status: 'match',
        widthDeltaPx: 0,
        heightDeltaPx: 0,
      }),
    }));
    expect(metadata.lights).toHaveLength(7);
    expect(metadata.walls).toHaveLength(20);
    expect(metadata.importWarnings).toEqual({
      skippedWalls: 0,
      skippedLights: 0,
    });

    expect(metadata.lights[0]).toEqual(expect.objectContaining({
      x: 1231,
      y: 913,
      dimRadiusUnits: 20,
      brightRadiusUnits: 10,
      dimRadiusPx: 240,
      brightRadiusPx: 120,
      color: '#FFAD00',
    }));
    expect(metadata.walls[0]).toEqual(expect.objectContaining({
      id: 'wall-1',
      x1: 1201,
      y1: 1080,
      x2: 1261,
      y2: 1080,
      wallType: 'wall',
      blocksMovement: true,
      blocksSight: true,
      blocksVision: true,
      blocksLight: true,
      blocksSound: true,
      doorType: 0,
    }));
    expect(metadata.walls.find((wall) => wall.doorType === 1)).toEqual(expect.objectContaining({
      wallType: 'door',
      blocksSight: true,
      blocksVision: true,
      blocksLight: true,
    }));
    expect(metadata.walls.find((wall) => wall.blocksSight === false)).toEqual(expect.objectContaining({
      blocksMovement: true,
      blocksSound: true,
    }));
  });

  test('reports matching and mismatched media dimensions', () => {
    expect(buildDungeonAlchemistLightingAlignment({
      background,
      jsonWidthPx: 2040,
      jsonHeightPx: 1620,
    })).toEqual(expect.objectContaining({
      status: 'match',
      widthDeltaPx: 0,
      heightDeltaPx: 0,
    }));

    const mismatch = buildDungeonAlchemistLightingAlignment({
      background,
      jsonWidthPx: 1920,
      jsonHeightPx: 1080,
    });

    expect(mismatch).toEqual(expect.objectContaining({
      status: 'mismatch',
      widthDeltaPx: 120,
      heightDeltaPx: 540,
    }));
    expect(getLightingAlignmentErrorMessage(mismatch)).toContain('do not match');
    expect(() => normalizeDungeonAlchemistLightingMetadata(
      parseDungeonAlchemistLightingJson(readSampleJson()),
      {
        background: { ...background, imageWidth: 1920, imageHeight: 1080 },
      }
    )).toThrow(/do not match/);
  });

  test('builds the lightweight background summary', () => {
    const metadata = normalizeDungeonAlchemistLightingMetadata(
      parseDungeonAlchemistLightingJson(readSampleJson()),
      { background }
    );

    expect(buildGrigliataLightingSummary(metadata, 'now')).toEqual({
      sourceType: DUNGEON_ALCHEMIST_SOURCE_TYPE,
      schemaVersion: DUNGEON_ALCHEMIST_LIGHTING_SCHEMA_VERSION,
      wallCount: 20,
      lightCount: 7,
      alignmentStatus: 'match',
      importedAt: 'now',
    });
  });
});
