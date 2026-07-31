import {
  buildLegacyInventoryBindings,
  normalizeLegacyInventoryWithStableIds,
  sha256Hex,
  stableUserDataJson,
} from './legacyInventoryProjection';

describe('legacy inventory stable projection', () => {
  test('matches the migration SHA-256 contract and expands duplicate quantity units deterministically', () => {
    const snapshot = { id: 'sword', item_type: 'weapon', General: { Nome: 'Spada' } };
    expect(stableUserDataJson(snapshot)).toBe(
      '{"General":{"Nome":"Spada"},"id":"sword","item_type":"weapon"}'
    );
    expect(sha256Hex(stableUserDataJson(snapshot))).toBe(
      '1302d4d8a79267c6099a6e1e70455352dd8ea918e656e9b97214f0fa92d5de35'
    );

    const bindings = buildLegacyInventoryBindings([
      { ...snapshot, qty: 2 },
      { ...snapshot },
    ]);
    expect(bindings.map(({ inventoryId }) => inventoryId)).toEqual([
      'legacy_1302d4d8a79267c6099a6e1e_1_1',
      'legacy_1302d4d8a79267c6099a6e1e_1_2',
      'legacy_1302d4d8a79267c6099a6e1e_2_1',
    ]);
  });

  test('keeps valid instance IDs and exposes legacy row/unit metadata to compatibility commands', () => {
    const normalized = normalizeLegacyInventoryWithStableIds([{
      id: 'potion',
      type: 'varie',
      qty: 3,
      _instance: { instanceId: 'existing-instance', source: 'bazaar' },
    }]);

    expect(normalized).toEqual([expect.objectContaining({
      qty: 3,
      _instance: expect.objectContaining({ instanceId: 'existing-instance', source: 'bazaar' }),
      _task05: {
        inventoryId: 'existing-instance',
        legacyIndex: 0,
        legacyUnit: 0,
      },
    })]);
  });
});
