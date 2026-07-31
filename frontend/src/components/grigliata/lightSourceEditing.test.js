import {
  createManualLightSource,
  deleteLightSource,
  duplicateLightSource,
  moveLightSource,
  normalizeEditableLightSources,
  toggleLightSourceEnabled,
  updateLightSource,
} from './lightSources';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('light source editing helpers', () => {
  test('normalizes editable light source fields for DM authoring', () => {
    expect(normalizeEditableLightSources([{
      id: 'torch-1',
      label: 'Torch',
      x: '140',
      y: 210,
      brightRadiusPx: '280',
      dimRadiusPx: 560,
      color: '#fa0',
      enabled: false,
      source: { raw: true },
    }, {
      id: '',
      x: Number.NaN,
      y: 0,
      brightRadiusPx: 70,
      dimRadiusPx: 140,
    }])).toEqual([{
      id: 'torch-1',
      label: 'Torch',
      enabled: false,
      x: 140,
      y: 210,
      brightRadiusPx: 280,
      dimRadiusPx: 560,
      color: '#FFAA00',
    }]);
  });

  test('creates a manual light at the clicked point with default radii', () => {
    const light = createManualLightSource({
      existingLights: [{ id: 'light-1', label: 'Light 1' }],
      point: { x: 105, y: 175 },
      grid,
    });

    expect(light).toEqual({
      id: 'manual-light-2',
      label: 'Light 2',
      enabled: true,
      x: 105,
      y: 175,
      brightRadiusPx: 280,
      dimRadiusPx: 560,
      color: '#FFFFFF',
    });
  });

  test('moves, updates, duplicates, toggles, and deletes a light source immutably', () => {
    const lights = normalizeEditableLightSources([{
      id: 'light-1',
      label: 'Torch',
      enabled: true,
      x: 70,
      y: 70,
      brightRadiusPx: 140,
      dimRadiusPx: 280,
      color: '#FFFFFF',
    }]);

    expect(moveLightSource(lights, 'light-1', { x: 210, y: 280 })[0]).toEqual(expect.objectContaining({
      x: 210,
      y: 280,
    }));

    expect(updateLightSource(lights, 'light-1', {
      label: 'Lantern',
      color: '#ffad00',
      brightRadiusPx: 70,
    })[0]).toEqual(expect.objectContaining({
      label: 'Lantern',
      color: '#FFAD00',
      brightRadiusPx: 70,
      dimRadiusPx: 280,
    }));

    expect(toggleLightSourceEnabled(lights, 'light-1')[0]).toEqual(expect.objectContaining({
      enabled: false,
    }));

    const duplicatedLights = duplicateLightSource(lights, 'light-1', { grid });
    expect(duplicatedLights).toHaveLength(2);
    expect(duplicatedLights[1]).toEqual(expect.objectContaining({
      id: 'manual-light-2',
      label: 'Torch Copy',
      x: 140,
      y: 140,
    }));

    expect(deleteLightSource(duplicatedLights, 'light-1').map((light) => light.id)).toEqual(['manual-light-2']);
    expect(lights).toHaveLength(1);
  });
});
