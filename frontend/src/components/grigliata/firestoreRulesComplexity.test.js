import fs from 'fs';
import path from 'path';

describe('Grigliata Firestore fog polygon rules', () => {
  const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.rules'), 'utf8');
  const polygonRulesStart = rules.indexOf('function hasValidGrigliataFogPolygons');
  const polygonRulesEnd = rules.indexOf('function isValidGrigliataFogOfWar');
  const polygonRules = rules.slice(polygonRulesStart, polygonRulesEnd);

  test('keeps polygon validation shallow enough for live Firestore rules', () => {
    expect(polygonRulesStart).toBeGreaterThanOrEqual(0);
    expect(polygonRulesEnd).toBeGreaterThan(polygonRulesStart);
    expect(polygonRules).not.toContain('isValidGrigliataFogPolygonPoint');
    expect(polygonRules).not.toContain('rings');
    expect(polygonRules).not.toContain('points');
    expect(polygonRules).not.toMatch(/polygons\[/);
    expect((polygonRules.match(/points\[/g) || []).length).toBe(0);
  });

  test('keeps explored polygon fog optional and bounded in the fog document contract', () => {
    const fogRuleStart = rules.indexOf('function isValidGrigliataFogOfWar');
    const fogRuleEnd = rules.indexOf('function isValidGrigliataWallRuntimeSegment');
    const fogRule = rules.slice(fogRuleStart, fogRuleEnd);

    expect(fogRule).toContain('"exploredCells"');
    expect(fogRule).toContain('"exploredPolygons"');
    expect(fogRule).toContain('!data.keys().hasAny(["exploredPolygons"]) || hasValidGrigliataFogPolygons(data.exploredPolygons)');
  });

  test('leaves polygon shape enforcement to client normalization', () => {
    expect(polygonRules).toContain('polygons is list');
    expect(polygonRules).toContain('polygons.size() <= 8');
    expect(polygonRules).not.toContain('polygon.keys()');
    expect(polygonRules).not.toContain('ring.keys()');
  });

  test('keeps raster tile fog validation shallow and bounded', () => {
    const tileRuleStart = rules.indexOf('function isValidGrigliataFogMemoryTile');
    const tileRuleEnd = rules.indexOf('function isValidGrigliataWallRuntimeSegment');
    const tileRule = rules.slice(tileRuleStart, tileRuleEnd);
    const tileMatch = rules.slice(
      rules.indexOf('match /grigliata_fog_memory_tiles/{tileId}'),
      rules.indexOf('match /grigliata_music_tracks/{trackId}')
    );

    expect(tileRuleStart).toBeGreaterThanOrEqual(0);
    expect(tileRule).toContain('"maskBase64"');
    expect(tileRule).toContain('data.maskBase64.size() <= 4096');
    expect(tileRule).toContain('data.maskEncoding == "base64-bitset-v1"');
    expect(tileRule).not.toContain('maskBase64[');
    expect(tileRule).not.toContain('rings');
    expect(tileRule).not.toContain('points');
    expect(tileMatch).toContain('match /grigliata_fog_memory_tiles/{tileId}');
    expect(tileMatch).toContain('isValidGrigliataFogMemoryTile(request.resource.data, tileId)');
  });

  test('allows own missing raster tile probes only through document gets', () => {
    const helperStart = rules.indexOf('function isOwnGrigliataFogMemoryTileProbeId');
    const helperEnd = rules.indexOf('function isValidGrigliataFogCellKey');
    const helperRule = rules.slice(helperStart, helperEnd);
    const tileMatch = rules.slice(
      rules.indexOf('match /grigliata_fog_memory_tiles/{tileId}'),
      rules.indexOf('match /grigliata_music_tracks/{trackId}')
    );
    const tileGetRule = tileMatch.slice(
      tileMatch.indexOf('allow get:'),
      tileMatch.indexOf('allow list:')
    );
    const tileListRule = tileMatch.slice(
      tileMatch.indexOf('allow list:'),
      tileMatch.indexOf('allow create:')
    );

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperRule).toContain("request.auth.uid + '__fog-raster-c8-s16-v1__-?[0-9]+:-?[0-9]+$'");
    expect(tileMatch).not.toContain('allow get, list');
    expect(tileGetRule).toContain('resource == null');
    expect(tileGetRule).toContain('isOwnGrigliataFogMemoryTileProbeId(tileId)');
    expect(tileGetRule).toContain('resource != null');
    expect(tileListRule).toContain('allow list:');
    expect(tileListRule).not.toContain('resource == null');
    expect(tileListRule).not.toContain('isOwnGrigliataFogMemoryTileProbeId(tileId)');
  });
});
