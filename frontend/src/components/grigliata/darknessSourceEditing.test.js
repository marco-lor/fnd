import {
  createManualDarknessSource,
  deleteDarknessSource,
  duplicateDarknessSource,
  moveDarknessSource,
  normalizeEditableDarknessSources,
  toggleDarknessSourceEnabled,
  updateDarknessSource,
} from './darknessSources';

const grid = {
  cellSizePx: 70,
  offsetXPx: 0,
  offsetYPx: 0,
};

describe('darkness source editing helpers', () => {
  test('normalizes editable darkness source fields for DM authoring', () => {
    expect(normalizeEditableDarknessSources([{
      id: 'darkness-1',
      name: 'Void',
      x: '140',
      y: 210,
      radiusPx: '280',
      intensity: 2,
      enabled: false,
      source: { raw: true },
    }, {
      id: '',
      x: Number.NaN,
      y: 0,
      radiusPx: 70,
      intensity: 0.5,
    }])).toEqual([{
      id: 'darkness-1',
      label: 'Void',
      enabled: false,
      x: 140,
      y: 210,
      radiusPx: 280,
      intensity: 1,
    }]);
  });

  test('creates a manual darkness source at the clicked point with default radius and intensity', () => {
    const darkness = createManualDarknessSource({
      existingDarknessSources: [{ id: 'darkness-1', label: 'Darkness 1' }],
      point: { x: 105, y: 175 },
      grid,
    });

    expect(darkness).toEqual({
      id: 'manual-darkness-2',
      label: 'Darkness 2',
      enabled: true,
      x: 105,
      y: 175,
      radiusPx: 280,
      intensity: 1,
    });
  });

  test('moves, updates, duplicates, toggles, and deletes a darkness source immutably', () => {
    const darknessSources = normalizeEditableDarknessSources([{
      id: 'darkness-1',
      label: 'Void',
      enabled: true,
      x: 70,
      y: 70,
      radiusPx: 140,
      intensity: 0.6,
    }]);

    expect(moveDarknessSource(darknessSources, 'darkness-1', { x: 210, y: 280 })[0]).toEqual(expect.objectContaining({
      x: 210,
      y: 280,
    }));

    expect(updateDarknessSource(darknessSources, 'darkness-1', {
      label: 'Blackout',
      radiusPx: -10,
      intensity: -1,
    })[0]).toEqual(expect.objectContaining({
      label: 'Blackout',
      radiusPx: 0,
      intensity: 0,
    }));

    expect(toggleDarknessSourceEnabled(darknessSources, 'darkness-1')[0]).toEqual(expect.objectContaining({
      enabled: false,
    }));

    const duplicatedDarknessSources = duplicateDarknessSource(darknessSources, 'darkness-1', { grid });
    expect(duplicatedDarknessSources).toHaveLength(2);
    expect(duplicatedDarknessSources[1]).toEqual(expect.objectContaining({
      id: 'manual-darkness-2',
      label: 'Void Copy',
      x: 140,
      y: 140,
    }));

    expect(deleteDarknessSource(duplicatedDarknessSources, 'darkness-1').map((darkness) => darkness.id)).toEqual(['manual-darkness-2']);
    expect(darknessSources).toHaveLength(1);
  });
});
