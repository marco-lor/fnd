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
});
