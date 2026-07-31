const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOURCE_FIELDS,
  USER_ITEM_MAX_BYTES,
  applyConsumableCap,
  applyResourceMutation,
  buildConsumableRollPlan,
  buildLegacyContentProjection,
  buildLegacyDomainProjection,
  buildLegacyEquippedSnapshot,
  buildLegacyInventoryProjection,
  buildAnimaModifierFieldUpdate,
  buildUserShellProjection,
  canAccessCatalogItem,
  deepMergeRecords,
  deriveAnimaParameters,
  deriveEquipmentTransition,
  deriveParameterTotals,
  deriveResourceTotals,
  evaluateDocumentBudget,
  hashValue,
  hasAnyOwnField,
  isValidFirestoreDocumentId,
  isOperationExpired,
  materializeLegacyContentIdentities,
  materializeLegacyInventoryIdentities,
  operationReceiptId,
  operationRequestHash,
  parseCatalogPrice,
  planLegacyContentIdentityPersistence,
  planLegacyManagedProjection,
  removeLegacyInventoryDocuments,
  resolveLegacyInventoryBinding,
  resolveUserDataCommandTargetUid,
  resolveUserDataRolloutStage,
  stabilizeLegacyInventoryProjection,
  stableJson,
  validateOperationId,
  writesLegacyUserProjection,
} = require('../lib/userDataV2');
const {
  canProcessLegacyUserBridgeEvent,
  isLegacyUserBridgeActive,
  isLegacyInventoryBridgeSizeSupported,
  isUserDataLegacyDrainFrozen,
  resolveUserDataLegacyDrain,
  shouldReconcileLegacyContent,
} = require('../lib/userDataBridge');
const {
  assertLegacyRootMutationAllowed,
  legacyRootMutationBlockReason,
} = require('../lib/legacyRootMutationGate');
const {buildUserV2Plan} = require('../../scripts/task05/user-data-model');

test('legacy bridge activity is fenced by the effective per-user rollout mode', () => {
  assert.equal(isLegacyUserBridgeActive({mode: 'dual-write'}, 'user-1'), true);
  assert.equal(isLegacyUserBridgeActive({mode: 'new-only'}, 'user-1'), false);
  assert.equal(isLegacyUserBridgeActive({
    mode: 'dual-write',
    userOverrides: {'user-1': 'new-only'},
  }, 'user-1'), false);
  assert.equal(isLegacyUserBridgeActive({
    mode: 'new-only',
    userOverrides: {'user-1': 'shadow-verify'},
  }, 'user-1'), true);
});

test('legacy drain allows only frozen pre-cutoff events and new-only never bridges', () => {
  const cutoff = {seconds: 100, nanoseconds: 500};
  const drain = {drainId: 'drain_global_001', closedAt: cutoff};
  const config = {mode: 'dual-write', legacyDrain: {global: drain}};
  assert.equal(isUserDataLegacyDrainFrozen(config, 'user-1'), true);
  assert.equal(canProcessLegacyUserBridgeEvent(
    config,
    'user-1',
    {seconds: 100, nanoseconds: 499}
  ), true);
  assert.equal(canProcessLegacyUserBridgeEvent(
    config,
    'user-1',
    {seconds: 100, nanoseconds: 500}
  ), true);
  assert.equal(canProcessLegacyUserBridgeEvent(
    config,
    'user-1',
    {seconds: 100, nanoseconds: 501}
  ), false);
  assert.equal(canProcessLegacyUserBridgeEvent(
    {mode: 'new-only', legacyDrain: {global: drain}},
    'user-1',
    {seconds: 99, nanoseconds: 0}
  ), false);
  assert.equal(canProcessLegacyUserBridgeEvent(
    {mode: 'dual-write'},
    'user-1',
    null
  ), true);
});

test('per-user drain cutoffs are isolated and immutable during successive cutovers', () => {
  const config = {
    mode: 'dual-write',
    userOverrides: {
      'user-1': 'dual-write',
      'user-2': 'dual-write',
    },
    legacyDrain: {
      global: {
        drainId: 'drain_global_001',
        closedAt: {seconds: 50, nanoseconds: 0},
      },
      users: {
        'user-1': {
          drainId: 'drain_user_001',
          closedAt: {seconds: 100, nanoseconds: 0},
        },
        'user-2': {
          drainId: 'drain_user_002',
          closedAt: {seconds: 200, nanoseconds: 0},
        },
      },
    },
  };
  const userOneDrain = resolveUserDataLegacyDrain(config, 'user-1');
  const userTwoDrain = resolveUserDataLegacyDrain(config, 'user-2');
  assert.equal(userOneDrain.scope, 'user');
  assert.equal(userTwoDrain.scope, 'user');
  assert.equal(canProcessLegacyUserBridgeEvent(
    config,
    'user-1',
    {seconds: 150, nanoseconds: 0},
    userOneDrain
  ), false);
  assert.equal(canProcessLegacyUserBridgeEvent(
    config,
    'user-2',
    {seconds: 150, nanoseconds: 0},
    userTwoDrain
  ), true);

  const changedCutoff = {
    ...config,
    legacyDrain: {
      ...config.legacyDrain,
      users: {
        ...config.legacyDrain.users,
        'user-1': {
          drainId: 'drain_user_001',
          closedAt: {seconds: 300, nanoseconds: 0},
        },
      },
    },
  };
  assert.equal(canProcessLegacyUserBridgeEvent(
    changedCutoff,
    'user-1',
    {seconds: 90, nanoseconds: 0},
    userOneDrain
  ), false);

  const userOneComplete = {
    ...config,
    userOverrides: {...config.userOverrides, 'user-1': 'new-only'},
    legacyDrain: {
      ...config.legacyDrain,
      users: {'user-2': config.legacyDrain.users['user-2']},
    },
  };
  assert.equal(canProcessLegacyUserBridgeEvent(
    userOneComplete,
    'user-1',
    {seconds: 90, nanoseconds: 0}
  ), false);
  assert.equal(isUserDataLegacyDrainFrozen(userOneComplete, 'user-2'), true);
});

test('a malformed scoped drain fails closed for commands and bridge work', () => {
  const config = {
    mode: 'dual-write',
    legacyDrain: {global: {drainId: 'short'}},
  };
  assert.equal(isUserDataLegacyDrainFrozen(config, 'user-1'), true);
  assert.equal(resolveUserDataLegacyDrain(config, 'user-1').valid, false);
  assert.equal(canProcessLegacyUserBridgeEvent(
    config,
    'user-1',
    {seconds: 1, nanoseconds: 0}
  ), false);
});

test('legacy Admin root writers fail closed across drain and new-only scopes', () => {
  assert.equal(legacyRootMutationBlockReason(
    {mode: 'dual-write'},
    'user-1'
  ), null);
  assert.equal(legacyRootMutationBlockReason({
    mode: 'new-only',
    userOverrides: {'user-1': 'dual-write'},
  }, 'user-1'), null);
  assert.equal(legacyRootMutationBlockReason({
    mode: 'dual-write',
    userOverrides: {'user-1': 'new-only'},
  }, 'user-1'), 'new-only');
  assert.equal(legacyRootMutationBlockReason({
    mode: 'new-only',
    legacyDrain: {
      global: {
        drainId: 'sealed_drain_001',
        closedAt: {seconds: 100, nanoseconds: 0},
      },
    },
  }, 'user-1'), 'legacy-drain');
  assert.equal(legacyRootMutationBlockReason({
    mode: 'dual-write',
    userOverrides: {'user-1': 'dual-write'},
    legacyDrain: {
      users: {
        'user-1': {
          drainId: 'user_drain_001',
          closedAt: {seconds: 100, nanoseconds: 0},
        },
      },
    },
  }, 'user-1'), 'legacy-drain');

  assert.throws(
    () => assertLegacyRootMutationAllowed({mode: 'new-only'}, 'user-1'),
    (error) => error?.code === 'failed-precondition'
  );
  assert.throws(
    () => assertLegacyRootMutationAllowed({
      mode: 'dual-write',
      legacyDrain: {global: {drainId: 'malformed'}},
    }, 'user-1'),
    (error) => error?.code === 'unavailable'
  );
});
const {
  collectOwnedMediaPaths,
  parseOwnedMediaPath,
  planOwnedMediaCleanup,
} = require('../lib/userOwnedMediaCleanup');

test('canonical hashes and operation IDs are stable and tamper-sensitive', () => {
  assert.equal(stableJson({b: 2, a: 1}), stableJson({a: 1, b: 2}));
  assert.equal(hashValue({b: 2, a: 1}), hashValue({a: 1, b: 2}));
  assert.notEqual(hashValue({itemId: 'a'}), hashValue({itemId: 'b'}));
  assert.equal(validateOperationId('purchase_123456'), 'purchase_123456');
  assert.equal(validateOperationId('short'), '');
  assert.equal(validateOperationId('invalid/slash'), '');
});

test('idempotency identities are stable and reject request tampering', () => {
  assert.equal(
    operationReceiptId('user-1', 'purchase_123456'),
    operationReceiptId('user-1', 'purchase_123456')
  );
  assert.notEqual(
    operationRequestHash('purchase', {itemId: 'item-a'}),
    operationRequestHash('purchase', {itemId: 'item-b'})
  );
});

test('rollout stage prefers mode, supports stage fallback, and disables legacy in new-only', () => {
  assert.equal(resolveUserDataRolloutStage({stage: 'new-only', mode: 'dual-write'}), 'dual-write');
  assert.equal(resolveUserDataRolloutStage({stage: 'new-only'}), 'new-only');
  assert.equal(resolveUserDataRolloutStage({mode: 'shadow-verify'}), 'shadow-verify');
  assert.equal(resolveUserDataRolloutStage({stage: 'invalid'}), 'legacy-read');
  assert.equal(resolveUserDataRolloutStage({
    mode: 'new-only',
    userOverrides: {'canary-user': 'invalid'},
  }, 'canary-user'), 'new-only');
  assert.equal(resolveUserDataRolloutStage({
    stage: 'dual-write',
    userOverrides: {'canary-user': 'new-only'},
  }, 'canary-user'), 'new-only');
  assert.equal(resolveUserDataRolloutStage({
    stage: 'dual-write',
    userOverrides: {'other-user': 'new-only'},
  }, 'canary-user'), 'dual-write');
  assert.equal(writesLegacyUserProjection('dual-write'), true);
  assert.equal(writesLegacyUserProjection('new-read-dual-write'), true);
  assert.equal(writesLegacyUserProjection('new-only'), false);
});

test('command target policy binds rollout, drain, access, and writes to one uid', () => {
  const actorUid = 'actor-user';
  const spoofedUid = 'other-user';
  const actorTarget = resolveUserDataCommandTargetUid(
    actorUid,
    spoofedUid,
    'actor-only'
  );
  assert.equal(actorTarget, actorUid);

  const config = {
    mode: 'dual-write',
    userOverrides: {
      [actorUid]: 'dual-write',
      [spoofedUid]: 'dual-write',
    },
    legacyDrain: {
      users: {
        [actorUid]: {
          drainId: 'drain_actor_001',
          closedAt: {seconds: 100, nanoseconds: 0},
        },
      },
    },
  };
  assert.equal(isUserDataLegacyDrainFrozen(config, actorTarget), true);
  assert.equal(isUserDataLegacyDrainFrozen(config, spoofedUid), false);

  assert.equal(resolveUserDataCommandTargetUid(
    actorUid,
    '  peer-user  ',
    'request-user-or-actor'
  ), 'peer-user');
  assert.equal(resolveUserDataCommandTargetUid(
    actorUid,
    '',
    'request-user-or-actor'
  ), actorUid);
});

test('command targets must be one bounded Firestore document ID', () => {
  assert.equal(isValidFirestoreDocumentId('player-1'), true);
  assert.equal(isValidFirestoreDocumentId('x'.repeat(1500)), true);
  assert.equal(isValidFirestoreDocumentId(''), false);
  assert.equal(isValidFirestoreDocumentId('.'), false);
  assert.equal(isValidFirestoreDocumentId('..'), false);
  assert.equal(isValidFirestoreDocumentId('users/player-1'), false);
  assert.equal(isValidFirestoreDocumentId('\u00e9'.repeat(751)), false);
  assert.equal(resolveUserDataCommandTargetUid(
    'actor-user',
    'users/peer-user',
    'request-user-or-actor'
  ), '');
  assert.equal(resolveUserDataCommandTargetUid(
    'users/actor-user',
    '',
    'actor-only'
  ), '');
});

test('progression resource-field detection rejects resource-domain bypasses', () => {
  assert.equal(hasAnyOwnField({level: 6}, RESOURCE_FIELDS), false);
  assert.equal(hasAnyOwnField({hpCurrent: 1}, RESOURCE_FIELDS), true);
  assert.equal(hasAnyOwnField({gold: 999}, RESOURCE_FIELDS), true);
});

test('catalog price and visibility are derived from authoritative data', () => {
  assert.equal(parseCatalogPrice(12), 12);
  assert.equal(parseCatalogPrice('12 gold'), 12);
  assert.equal(parseCatalogPrice(-1), null);
  assert.equal(parseCatalogPrice('not-a-price'), null);

  const privateItem = {visibility: 'custom', allowed_users: ['allowed-user']};
  assert.equal(canAccessCatalogItem(privateItem, 'allowed-user', 'player'), true);
  assert.equal(canAccessCatalogItem(privateItem, 'other-user', 'player'), false);
  assert.equal(canAccessCatalogItem(privateItem, 'other-user', 'dm'), true);
  assert.equal(canAccessCatalogItem(privateItem, 'other-user', 'webmaster'), false);
  assert.equal(canAccessCatalogItem({visibility: 'hidden'}, 'user', 'player'), false);
});

test('resource derivations retain direct-control semantics and consumable caps', () => {
  assert.equal(applyResourceMutation(5, 'delta', -9), -4);
  assert.equal(applyResourceMutation(5, 'set', 100), 100);
  assert.equal(applyResourceMutation(5, 'set', 'bad'), null);
  assert.equal(applyConsumableCap(8, 7, 10), 10);
  assert.equal(applyConsumableCap(8, 7, 0), 15);
});

test('consumable rolls preserve thresholds, die source, and creation bonus', () => {
  const plan = buildConsumableRollPlan({
    type: 'consumabile',
    Parametri: {
      Special: {
        'Rigenera Dado Anima HP': {'1': 1, '4': 2, '7': 3, '10': 4},
      },
    },
    Specific: {'Bonus Creazione': '+2'},
  }, 'hp', 8, [null, 'd4', 'd4', 'd4', 'd6', 'd6', 'd6', 'd8']);

  assert.deepEqual(plan, {resource: 'hp', count: 3, faces: 8, modifier: 6});
});

test('legacy domains remain root-shaped for compatibility adapters', () => {
  const projection = buildLegacyDomainProjection({
    stats: {
      level: 4,
      gold: 10,
      hpCurrent: 5,
      shieldCurrent: 2,
      barriera: 7,
      customCounter: 9,
    },
    Parametri: {Base: {Forza: {Base: 1}}},
    settings: {theme: 'dark'},
    parameterLocks: {Forza: true},
    paramLocks: {Mente: true},
    equipped: {main: {_instance: {instanceId: 'weapon-1'}}},
    lingue: {Comune: true},
  });

  assert.equal(projection.progression.stats.level, 4);
  assert.equal(projection.resources.stats.gold, 10);
  assert.equal(projection.resources.stats.hpCurrent, 5);
  assert.equal(projection.resources.stats.shieldCurrent, 2);
  assert.equal(projection.resources.stats.barrieraCurrent, 7);
  assert.equal(projection.resources.stats.barrieraTotal, 7);
  assert.equal(projection.progression.stats.barriera, undefined);
  assert.equal(projection.progression.stats.customCounter, 9);
  assert.equal(projection.settings.settings.theme, 'dark');
  assert.equal(projection.settings.parameterLocks.Forza, true);
  assert.equal(projection.settings.paramLocks.Mente, true);
  assert.equal(projection.equipment.slots.main, 'weapon-1');
  assert.equal(projection.profileContent.lingue.Comune, true);
});

test('nested progression merges preserve unrelated stats and parameter branches', () => {
  const merged = deepMergeRecords({
    stats: {level: 3, basePointsAvailable: 2, customCounter: 9},
    Parametri: {Base: {Forza: {Base: 1, Equip: 2}, Mente: {Base: 4}}},
  }, {
    stats: {customCounter: 10},
    Parametri: {Base: {Forza: {Base: 3}}},
  });
  assert.deepEqual(merged.stats, {
    level: 3,
    basePointsAvailable: 2,
    customCounter: 10,
  });
  assert.deepEqual(merged.Parametri.Base.Forza, {Base: 3, Equip: 2});
  assert.deepEqual(merged.Parametri.Base.Mente, {Base: 4});
});

test('equipment derivation enforces hands and belt while recomputing stable Equip formulas', () => {
  const baseParams = {
    Base: {Forza: {Tot: 10, Equip: 4}},
    Combattimento: {},
    Special: {},
  };
  const inventory = {
    ring: {
      type: 'accessorio',
      General: {Slot: 'Accessorio'},
      Parametri: {Base: {Forza: {'1': 'Forza'}}},
    },
    belt: {
      General: {Slot: 'Cintura'},
      Specific: {slotCintura: 1},
    },
    greatsword: {
      General: {Slot: 'Doppia Mano'},
      Specific: {Hands: 2},
    },
    shield: {General: {Slot: 'Mano Secondaria'}, Specific: {Hands: 1}},
  };
  const equipped = deriveEquipmentTransition({
    slots: {cintura: 'belt', beltC1: 'potion', beltC2: 'potion-2'},
    inventoryById: {...inventory, potion: {}, 'potion-2': {}},
    slot: 'accessorio',
    inventoryId: 'ring',
    parametri: baseParams,
    level: 1,
  });
  assert.equal(equipped.ok, true);
  assert.equal(equipped.beltCapacity, 1);
  assert.equal(equipped.slots.beltC2, null);
  assert.equal(equipped.parametri.Base.Forza.Equip, 6);

  const conflict = deriveEquipmentTransition({
    slots: {weaponOff: 'shield'},
    inventoryById: inventory,
    slot: 'weaponMain',
    inventoryId: 'greatsword',
    parametri: baseParams,
    level: 1,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'two-handed-conflict');

  const duplicate = deriveEquipmentTransition({
    slots: {weaponMain: 'shield'},
    inventoryById: inventory,
    slot: 'weaponOff',
    inventoryId: 'shield',
    parametri: baseParams,
    level: 1,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, 'duplicate-inventory-reference');
});

test('document budgets warn at 80 percent and reject above the hard limit', () => {
  const under = evaluateDocumentBudget({value: 'a'.repeat(75)}, 100);
  const warning = evaluateDocumentBudget({value: 'a'.repeat(90)}, 100);
  const rejected = evaluateDocumentBudget({value: 'a'.repeat(110)}, 100);
  assert.equal(under.warning, true); // JSON field overhead crosses 80 bytes.
  assert.equal(under.accepted, true);
  assert.equal(warning.warning, true);
  assert.equal(warning.accepted, false); // JSON overhead crosses 100 bytes.
  assert.equal(rejected.accepted, false);
});

test('inventory budgets cover the complete document with duplicated snapshots', () => {
  const nearLimitSnapshot = {payload: 'x'.repeat(140 * 1024)};
  assert.equal(
    evaluateDocumentBudget(nearLimitSnapshot, USER_ITEM_MAX_BYTES).accepted,
    true
  );
  assert.equal(evaluateDocumentBudget({
    acquisitionSnapshot: nearLimitSnapshot,
    currentSnapshot: nearLimitSnapshot,
  }, USER_ITEM_MAX_BYTES).accepted, false);
});

test('canonical hashes match migration timestamp and special-number tags', () => {
  const timestamp = {seconds: 12, nanoseconds: 34, toDate() { return new Date(0); }};
  assert.equal(stableJson({timestamp}), '{"timestamp":{"$type":"timestamp","seconds":"12","nanoseconds":34}}');
  assert.equal(stableJson({value: Number.NaN}), '{"value":{"$type":"number","value":"NaN"}}');
  assert.equal(stableJson([-0, undefined]), '[{"$type":"number","value":"-0"},{"$type":"undefined"}]');
});

test('inventory projection is deterministic, preserves Varie stacks, and expands units', () => {
  const legacy = [
    {
      id: 'potion',
      type: 'varie',
      qty: 3,
      General: {Nome: 'Potion'},
      _instance: {instanceId: 'stack_1', source: 'custom'},
    },
    {
      id: 'sword',
      item_type: 'weapon',
      qty: 2,
      General: {Nome: 'Sword'},
      _instance: {instanceId: 'sword_1'},
    },
    {id: 'ring', item_type: 'accessorio', General: {Nome: 'Ring'}},
    {id: 'ring', item_type: 'accessorio', General: {Nome: 'Ring'}},
  ];

  const first = buildLegacyInventoryProjection(legacy);
  const second = buildLegacyInventoryProjection(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(first[0].id, 'stack_1');
  assert.equal(first[0].data.kind, 'varie');
  assert.equal(first[0].data.quantity, 3);
  assert.equal(first[1].id, 'sword_1');
  assert.equal(first[2].id, 'sword_1_2');
  assert.equal(first[1].data.quantity, 1);
  assert.notEqual(first[3].id, first[4].id);
  assert.equal(first[0].data.acquisitionSnapshot.qty, undefined);
  assert.equal(first[0].data.acquisitionSnapshot._instance, undefined);
});

test('unmatched legacy equipment uses the canonical legacy source', () => {
  const projection = buildLegacyInventoryProjection([], {
    weaponMain: {id: 'lost-sword', General: {Nome: 'Lost Sword'}},
  });
  assert.equal(projection.length, 1);
  assert.equal(projection[0].data.source, 'legacy');
  assert.equal(projection[0].data.migration.unmatchedEquipmentSlot, 'weaponMain');
});

test('bridge accepts the 500-item fixture without a batch ceiling', () => {
  assert.equal(isLegacyInventoryBridgeSizeSupported(500), true);
  const fixture = Array.from({length: 500}, (_, index) => ({
    id: `item-${index}`,
    item_type: 'weapon',
    General: {Nome: `Item ${index}`},
  }));
  assert.equal(buildLegacyInventoryProjection(fixture).length, 500);
  assert.equal(isLegacyInventoryBridgeSizeSupported(2000), true);
  assert.equal(isLegacyInventoryBridgeSizeSupported(2001), false);
});

test('fallback inventory binding removes the intended duplicate without shifting the survivor', () => {
  const duplicate = {id: 'ring', item_type: 'accessorio', General: {Nome: 'Ring'}};
  const legacy = [duplicate, JSON.parse(JSON.stringify(duplicate))];
  const projected = buildLegacyInventoryProjection(legacy);
  assert.notEqual(projected[0].id, projected[1].id);
  const removed = removeLegacyInventoryDocuments(legacy, {
    [projected[0].id]: projected[0].data,
  });
  assert.equal(removed.ok, true);
  assert.equal(removed.inventory.length, 1);
  assert.equal(removed.inventory[0]._instance.instanceId, projected[1].id);
  assert.equal(buildLegacyInventoryProjection(removed.inventory)[0].id, projected[1].id);

  const rebound = resolveLegacyInventoryBinding(
    [duplicate],
    projected[1].id,
    {...projected[1].data, migration: {index: 0, unit: 0}}
  );
  assert.equal(rebound.ok, true);
  assert.equal(rebound.binding.index, 0);
});

test('qty rows materialize stable unit IDs and string inventory keeps identity', () => {
  const qtyRow = [{id: 'blade', item_type: 'weapon', qty: 3, General: {Nome: 'Blade'}}];
  const projected = buildLegacyInventoryProjection(qtyRow);
  const removed = removeLegacyInventoryDocuments(qtyRow, {
    [projected[1].id]: projected[1].data,
  });
  assert.equal(removed.ok, true);
  assert.deepEqual(
    removed.inventory.map((entry) => entry._instance.instanceId),
    [projected[0].id, projected[2].id]
  );
  const stringRows = materializeLegacyInventoryIdentities(['rope']);
  assert.equal(stringRows[0].id, 'rope');
  assert.equal(stringRows[0].name, 'rope');
  assert.ok(stringRows[0]._instance.instanceId.startsWith('legacy_'));
});

test('multiset stabilization preserves an equipped duplicate and one changed item plans O(1) writes', () => {
  const duplicate = {id: 'ring', item_type: 'accessorio', General: {Nome: 'Ring'}};
  const priorProjection = buildLegacyInventoryProjection([duplicate, duplicate]);
  const remainingProjection = buildLegacyInventoryProjection([duplicate]);
  const stabilized = stabilizeLegacyInventoryProjection(
    remainingProjection,
    priorProjection,
    [priorProjection[1].id]
  );
  assert.equal(stabilized[0].id, priorProjection[1].id);

  const fixture = Array.from({length: 500}, (_, index) => ({
    id: `item-${index}`,
    item_type: 'weapon',
    General: {Nome: `Item ${index}`},
  }));
  const desired = buildLegacyInventoryProjection(fixture);
  const existing = desired.map(({id, data}) => ({id, data: {...data}}));
  const changed = desired.map((entry, index) => index === 321 ? {
    id: entry.id,
    data: {
      ...entry.data,
      currentSnapshot: {...entry.data.currentSnapshot, note: 'changed'},
      currentHash: hashValue({...entry.data.currentSnapshot, note: 'changed'}),
    },
  } : entry);
  const plan = planLegacyManagedProjection(existing, changed);
  assert.equal(plan.sets.length, 1);
  assert.equal(plan.sets[0].id, desired[321].id);
  assert.equal(plan.deletes.length, 0);
});

test('command-managed inventory echoes are skipped but genuine legacy edits preserve acquisition history', () => {
  const acquisition = {id: 'owned', General: {Nome: 'Owned'}};
  const existing = [{
    id: 'owned-1',
    data: {
      legacyManaged: false,
      kind: 'varie',
      quantity: 1,
      catalogItemId: null,
      acquisitionSnapshot: acquisition,
      acquisitionHash: hashValue(acquisition),
      currentSnapshot: acquisition,
      currentHash: hashValue(acquisition),
      displayName: 'Owned',
      normalizedName: 'owned',
      revision: 3,
      currentRevision: 2,
    },
  }];
  const echo = [{id: 'owned-1', data: {
    ...existing[0].data,
    migration: {index: 0, unit: 0},
    legacyManaged: true,
  }}];
  assert.equal(planLegacyManagedProjection(existing, echo).sets.length, 0);
  const editedSnapshot = {...acquisition, note: 'legacy edit'};
  const edited = [{id: 'owned-1', data: {
    ...echo[0].data,
    currentSnapshot: editedSnapshot,
    currentHash: hashValue(editedSnapshot),
  }}];
  const plan = planLegacyManagedProjection(existing, edited);
  assert.equal(plan.sets.length, 1);
  assert.equal(plan.sets[0].data.legacyManaged, false);
  assert.equal(plan.sets[0].data.acquisitionSnapshot, undefined);
  assert.equal(plan.sets[0].data.currentSnapshot.note, 'legacy edit');
});

test('legacy content projection is deterministic, bounded to callable IDs, and detects invalid names', () => {
  const projection = buildLegacyContentProjection('spell', {
    Flare: {id: 'spell_1', Costo: 2},
  });
  assert.equal(projection.ok, true);
  assert.equal(projection.documents[0].id, 'spell_1');
  assert.equal(projection.reservations.length, 1);
  assert.equal(buildLegacyContentProjection('spell', [{Costo: 2}]).ok, false);
  const invalidId = buildLegacyContentProjection('spell', {
    Flare: {id: 'invalid/id', Costo: 2},
  });
  assert.equal(invalidId.ok, true);
  assert.match(invalidId.documents[0].id, /^spell_[a-f0-9]{32}$/);
  assert.equal(shouldReconcileLegacyContent({spells: {}}, {spells: {Flare: {}}}, 'spells'), true);
});

test('id-less content uses the offline migration ID once and keeps it through field, media, and name edits', () => {
  const legacy = {
    Flare: {Costo: 2, imagePath: 'users/u1/spells/flare.png'},
  };
  const initial = buildLegacyContentProjection('spell', legacy);
  const offline = buildUserV2Plan('u1', {spells: legacy}).documents
    .filter(({path}) => path.startsWith('users/u1/spells/'));
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.documents.map(({id}) => id), offline.map(({path}) => path.split('/').at(-1)));

  const stabilized = materializeLegacyContentIdentities(legacy, initial);
  const persistedId = stabilized.Flare.id;
  assert.equal(persistedId, initial.documents[0].id);
  const edited = {
    Flare: {
      ...stabilized.Flare,
      Costo: 3,
      imagePath: 'users/u1/spells/flare-v2.png',
    },
  };
  assert.equal(buildLegacyContentProjection('spell', edited).documents[0].id, persistedId);

  const renamed = {
    Nova: {...edited.Flare, nome: 'Nova'},
  };
  const renamedProjection = buildLegacyContentProjection('spell', renamed);
  assert.equal(renamedProjection.documents[0].id, persistedId);
  assert.equal(renamedProjection.reservations[0].data.contentId, persistedId);
});

test('first id-less edit after offline backfill reuses the migrated content ID', () => {
  const original = {
    Flare: {Costo: 2, imagePath: 'users/u1/spells/flare.png'},
  };
  const migrated = buildUserV2Plan('u1', {spells: original}).documents
    .filter(({path}) => path.startsWith('users/u1/spells/'))
    .map(({path, data}) => ({id: path.split('/').at(-1), data}));
  const migratedId = migrated[0].id;

  // This is the real bridge lifecycle: the migration produced descendants,
  // the root is still id-less, and the first observed event already contains
  // the edited value.
  const edited = {
    Flare: {Costo: 3, imagePath: 'users/u1/spells/flare-v2.png'},
  };
  const plan = planLegacyContentIdentityPersistence(
    'spell',
    edited,
    edited,
    migrated
  );
  assert.equal(plan.ok, true);
  assert.equal(plan.changed, true);
  assert.equal(plan.content.Flare.id, migratedId);
  assert.equal(plan.projection.documents[0].id, migratedId);

  const renamed = {Nova: {Costo: 3, nome: 'Nova'}};
  const renamePlan = planLegacyContentIdentityPersistence(
    'spell',
    renamed,
    renamed,
    migrated
  );
  assert.equal(renamePlan.ok, true);
  assert.equal(renamePlan.content.Nova.id, migratedId);
  assert.equal(renamePlan.projection.reservations[0].data.contentId, migratedId);
});

test('content identity follows exact object keys across insertions and deletions', () => {
  const original = {
    Alpha: {Costo: 1},
    Beta: {Costo: 2},
  };
  const existing = buildLegacyContentProjection('spell', original).documents;
  const originalIds = Object.fromEntries(existing.map(({id, data}) => [
    data.migration.legacyKey,
    id,
  ]));

  const inserted = {
    Before: {Costo: 0},
    Alpha: {Costo: 3},
    Beta: {Costo: 4},
  };
  const insertPlan = planLegacyContentIdentityPersistence(
    'spell',
    inserted,
    inserted,
    existing
  );
  assert.equal(insertPlan.ok, true);
  assert.equal(insertPlan.content.Alpha.id, originalIds.Alpha);
  assert.equal(insertPlan.content.Beta.id, originalIds.Beta);
  assert.notEqual(insertPlan.content.Before.id, originalIds.Alpha);
  assert.notEqual(insertPlan.content.Before.id, originalIds.Beta);

  const deleted = {Beta: {Costo: 5}};
  const deletePlan = planLegacyContentIdentityPersistence(
    'spell',
    deleted,
    deleted,
    existing
  );
  assert.equal(deletePlan.ok, true);
  assert.equal(deletePlan.content.Beta.id, originalIds.Beta);
});

test('content identity permits one structural rename and refuses ambiguous shifts', () => {
  const original = {
    Alpha: {Costo: 1},
    Beta: {Costo: 2},
  };
  const existing = buildLegacyContentProjection('spell', original).documents;
  const betaId = existing.find(({data}) => (
    data.migration.legacyKey === 'Beta'
  )).id;
  const renamed = {
    Alpha: {Costo: 3},
    Gamma: {Costo: 4},
  };
  const renamePlan = planLegacyContentIdentityPersistence(
    'spell',
    renamed,
    renamed,
    existing
  );
  assert.equal(renamePlan.ok, true);
  assert.equal(renamePlan.content.Gamma.id, betaId);

  const arraySource = [{nome: 'Alpha'}, {nome: 'Beta'}];
  const arrayExisting = buildLegacyContentProjection(
    'spell',
    arraySource
  ).documents;
  const insertedArray = [
    {nome: 'Before'},
    {nome: 'Alpha'},
    {nome: 'Beta'},
  ];
  const arrayInsertPlan = planLegacyContentIdentityPersistence(
    'spell',
    insertedArray,
    insertedArray,
    arrayExisting
  );
  assert.equal(arrayInsertPlan.ok, false);
  assert.equal(arrayInsertPlan.reason, 'ambiguous-content-identity-shift');

  const reorderedArray = [{nome: 'Beta'}, {nome: 'Alpha'}];
  const arrayReorderPlan = planLegacyContentIdentityPersistence(
    'spell',
    reorderedArray,
    reorderedArray,
    arrayExisting
  );
  assert.equal(arrayReorderPlan.ok, false);
  assert.equal(arrayReorderPlan.reason, 'ambiguous-content-identity-shift');

  const deletedArray = [{nome: 'Beta'}];
  const arrayDeletePlan = planLegacyContentIdentityPersistence(
    'spell',
    deletedArray,
    deletedArray,
    arrayExisting
  );
  assert.equal(arrayDeletePlan.ok, false);
  assert.equal(arrayDeletePlan.reason, 'ambiguous-content-identity-shift');
});

test('content identity persistence rejects stale roots and rename reservations converge without deleting content', () => {
  const original = {Flare: {Costo: 2}};
  const firstPlan = planLegacyContentIdentityPersistence('spell', original, original);
  assert.equal(firstPlan.ok, true);
  assert.equal(firstPlan.changed, true);
  const stale = planLegacyContentIdentityPersistence(
    'spell',
    original,
    {Nova: {Costo: 2}}
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale-source');

  const oldProjection = buildLegacyContentProjection('spell', firstPlan.content);
  const persisted = firstPlan.content.Flare;
  const renamedProjection = buildLegacyContentProjection('spell', {
    Nova: {...persisted, nome: 'Nova'},
  });
  const contentPlan = planLegacyManagedProjection(
    oldProjection.documents,
    renamedProjection.documents
  );
  const reservationPlan = planLegacyManagedProjection(
    oldProjection.reservations,
    renamedProjection.reservations
  );
  assert.deepEqual(contentPlan.deletes, []);
  assert.equal(contentPlan.sets[0].id, persisted.id);
  assert.equal(reservationPlan.sets[0].data.contentId, persisted.id);
  assert.deepEqual(reservationPlan.deletes, [oldProjection.reservations[0].id]);
});

test('content bridge comparator ignores legacyManaged transport metadata', () => {
  const desired = buildLegacyContentProjection('spell', {
    Flare: {id: 'spell_1', Costo: 2, legacyManaged: false},
  });
  assert.equal(desired.ok, true);
  const existing = desired.documents.map(({id, data}) => ({
    id,
    data: {
      ...data,
      legacyManaged: false,
      revision: 4,
      updatedBy: 'task05-command',
    },
  }));
  assert.equal(
    planLegacyManagedProjection(existing, desired.documents).sets.length,
    0
  );
});

test('derived state preserves Anima, Tot, HP, and mana formulas in V2 commands', () => {
  const parametri = deriveAnimaParameters({
    parametri: {
      Base: {Forza: {Base: 2, Equip: 1, Mod: 0}},
      Combattimento: {
        Salute: {Base: 3, Equip: 1},
        Disciplina: {Base: 2},
      },
    },
    altriParametri: {Anima_1: 'Lupo'},
    level: 4,
    utils: {
      modAnima: {Lupo: {Forza: 2}},
      levelUpAnimaBonus: {Lupo: {Salute: 1, Disciplina: 2}},
    },
  });
  assert.equal(parametri.Base.Forza.Tot, 5);
  assert.equal(parametri.Combattimento.Salute.Tot, 7);
  assert.equal(parametri.Combattimento.Disciplina.Tot, 8);
  assert.deepEqual(deriveResourceTotals({
    parametri,
    level: 4,
    utils: {hpMultByLevel: {'4': 6}, manaMultByLevel: {'4': 8}},
  }), {hpTotal: 50, manaTotal: 69});
  assert.equal(deriveParameterTotals({Base: {Forza: {Base: 1, Mod: 2}}}).Base.Forza.Tot, 3);
});

test('Anima recomputes from current source when the Tot trigger wins first', () => {
  const utils = {
    modAnima: {Spirito: {Forza: 2}},
    levelUpAnimaBonus: {Spirito: {Forza: 1, Salute: 3}},
  };
  const source = {
    AltriParametri: {Anima_1: 'Spirito'},
    stats: {level: 2},
    Parametri: {
      Base: {
        Forza: {Base: 2, Anima: 0, Equip: 1, Mod: 0, Tot: 3},
      },
      Combattimento: {
        Salute: {Base: 4, Anima: 0, Equip: 0, Mod: 0, Tot: 4},
      },
    },
  };
  const afterTotWon = structuredClone(source);
  afterTotWon.Parametri.Base.Forza.Tot = 103;
  afterTotWon.Parametri.Combattimento.Salute.Tot = 204;

  const beforeTotUpdate = buildAnimaModifierFieldUpdate(source, utils);
  const afterTotUpdate = buildAnimaModifierFieldUpdate(afterTotWon, utils);
  assert.deepEqual(afterTotUpdate, beforeTotUpdate);
  assert.deepEqual(afterTotUpdate, {
    'Parametri.Base.Forza.Anima': 3,
    'Parametri.Combattimento.Salute.Anima': 3,
  });
  assert.equal(
    Object.keys(afterTotUpdate).some((field) => field.endsWith('.Tot')),
    false
  );
  assert.equal(afterTotWon.Parametri.Base.Forza.Tot, 103);
  assert.equal(afterTotWon.Parametri.Combattimento.Salute.Tot, 204);
});

test('legacy equipped snapshots clear depleted slots and preserve surviving IDs', () => {
  assert.deepEqual(buildLegacyEquippedSnapshot(
    {beltC1: null, weaponMain: 'sword-2'},
    {'sword-2': {id: 'sword', General: {Nome: 'Sword'}}}
  ), {
    beltC1: null,
    weaponMain: {
      id: 'sword',
      General: {Nome: 'Sword'},
      _instance: {instanceId: 'sword-2'},
    },
  });
});

test('logical receipt expiry treats the exact boundary as expired and TTL is configured', () => {
  assert.equal(isOperationExpired({seconds: 10, nanoseconds: 0}, 9999), false);
  assert.equal(isOperationExpired({seconds: 10, nanoseconds: 0}, 10000), true);
  assert.equal(isOperationExpired({toMillis: () => 10001}, 10000), false);
  const indexes = require('../../firestore.indexes.json');
  assert.equal(indexes.fieldOverrides.some((entry) => (
    entry.collectionGroup === 'user_operations' &&
    entry.fieldPath === 'expiresAt' && entry.ttl === true
  )), true);
});

test('owned-media parser accepts only canonical or unambiguous legacy owner paths', () => {
  assert.equal(parseOwnedMediaPath('users/u1/inventory/i1/image.png').entityId, 'i1');
  assert.equal(parseOwnedMediaPath(
    'spells/videos/spell_u1_Flare_1_video', 'u1', 'spells', 'spell-1'
  ).uid, 'u1');
  assert.equal(parseOwnedMediaPath(
    'tecnicas/tecnica_u1_Dash_1_image', 'u1', 'tecniche', 'tech-1'
  ).scope, 'tecniche');
  assert.equal(parseOwnedMediaPath(
    'items/varie_u1_Rope_1', 'u1', 'inventory', 'item-1'
  ).scope, 'inventory');
  assert.equal(parseOwnedMediaPath(
    'characters/Hero_u1_123', 'u1', 'profile', 'profile'
  ).scope, 'profile');
  assert.equal(parseOwnedMediaPath(
    'spells/shared_catalog_image', 'u1', 'spells', 'spell-1'
  ), null);
  assert.equal(parseOwnedMediaPath(
    'characters/Hero_u12_123', 'u1', 'profile', 'profile'
  ), null);

  const oldPath = 'users/u1/spells/spell-1/old.png';
  const keepPath = 'users/u1/spells/spell-1/keep.png';
  assert.deepEqual(planOwnedMediaCleanup({
    before: {imagePath: oldPath, nested: {videoPath: keepPath}},
    after: {nested: {videoPath: keepPath}},
    uid: 'u1',
    scope: 'spells',
    entityId: 'spell-1',
  }), [oldPath]);
  assert.deepEqual(collectOwnedMediaPaths(
    {imagePath: 'spells/spell_u1_Flare_image'},
    'u1',
    'spells',
    'spell-1'
  ), ['spells/spell_u1_Flare_image']);
});

test('profile shell budget projection excludes large compatibility aggregates', () => {
  const shell = buildUserShellProjection({
    email: 'u@example.test',
    role: 'player',
    characterId: 'Hero',
    inventory: [{blob: 'x'.repeat(100000)}],
    spells: {Huge: {blob: 'y'.repeat(100000)}},
  });
  assert.equal(shell.email, 'u@example.test');
  assert.equal(shell.inventory, undefined);
  assert.equal(shell.spells, undefined);
  assert.equal(evaluateDocumentBudget(shell, 16 * 1024).accepted, true);
});
