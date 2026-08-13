const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOURCE_FIELDS,
  USER_ITEM_MAX_BYTES,
  applyConsumableCap,
  applyResourceMutation,
  buildAdminUserListItem,
  buildConsumableRollPlan,
  buildInitialUserDomainProjection,
  buildUserShellProjection,
  canAccessCatalogItem,
  canListPrivateUserLabels,
  consumeActiveTurnEffects,
  deepMergeRecords,
  deriveAnimaParameters,
  deriveEquipmentTransition,
  deriveParameterTotals,
  deriveResourceTotals,
  evaluateDocumentBudget,
  hashValue,
  hasAnyOwnField,
  isOperationExpired,
  isValidFirestoreDocumentId,
  normalizeAdminUserListPagination,
  normalizeResourceTotalValue,
  operationReceiptId,
  operationRequestHash,
  parseCatalogPrice,
  resolveUserDataCommandTargetUid,
  stableJson,
  validateOperationId,
} = require('../lib/userDataV2');

const {
  collectArchivedOwnedMediaPaths,
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
  assert.equal(normalizeResourceTotalValue(0), 0);
  assert.equal(normalizeResourceTotalValue('12'), 12);
  assert.equal(normalizeResourceTotalValue(-1), null);
  assert.equal(normalizeResourceTotalValue('bad'), null);
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

test('new user initialization projects schema data directly into V2 domains', () => {
  const domains = buildInitialUserDomainProjection({
    stats: {level: 1, hpCurrent: 8, gold: 12},
    Parametri: {Base: {Forza: {Base: 1}}},
    AltriParametri: {Anima_1: 'Fuoco'},
    settings: {theme: 'dark'},
    equipped: {},
    lingue: {Comune: {}},
  });
  assert.equal(domains.progression.stats.level, 1);
  assert.equal(domains.progression.stats.hpCurrent, undefined);
  assert.deepEqual(domains.resources.stats, {gold: 12, hpCurrent: 8});
  assert.deepEqual(domains.settings.settings, {theme: 'dark'});
  assert.deepEqual(domains.equipment.slots, {});
  assert.deepEqual(domains.profileContent.lingue, {Comune: {}});
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

test('account deletion discovers media retained only in both archive formats', () => {
  const paths = collectArchivedOwnedMediaPaths('u1', {
    rootFields: [
      {field: 'imagePath', value: 'characters/Hero_u1_123'},
      {field: 'inventory', value: {image: 'items/varie_u1_Rope_1'}},
      {field: 'equipped', value: {image: 'items/varie_u1_Sword_1'}},
      {field: 'spells', value: {image: 'spells/spell_u1_Flare_image'}},
      {field: 'tecniche', value: {video: 'tecnicas/videos/tecnica_u1_Dash_1'}},
      {field: 'imageUrl', value: 'characters/Other_u12_123'},
    ],
    migrationDomains: [
      {domain: 'shell', payload: {image: 'characters/Old_u1_999'}},
      {domain: 'inventory', payload: [{image: 'items/varie_u1_Old_2'}]},
      {domain: 'equipment', payload: {image: 'items/varie_u1_Shield_2'}},
      {
        domain: 'personalContent',
        payload: {
          spells: {Old: {video: 'spells/videos/spell_u1_Old_2'}},
          tecniche: {Old: {image: 'tecnicas/tecnica_u1_Old_2'}},
        },
      },
      {domain: 'shell', payload: {image: 'characters/shared_catalog'}},
    ],
  });
  assert.deepEqual(paths, [
    'characters/Hero_u1_123',
    'characters/Old_u1_999',
    'items/varie_u1_Old_2',
    'items/varie_u1_Rope_1',
    'items/varie_u1_Shield_2',
    'items/varie_u1_Sword_1',
    'spells/spell_u1_Flare_image',
    'spells/videos/spell_u1_Old_2',
    'tecnicas/tecnica_u1_Old_2',
    'tecnicas/videos/tecnica_u1_Dash_1',
  ]);
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

test('admin user-list pagination is bounded and cursor-safe', () => {
  assert.deepEqual(normalizeAdminUserListPagination(undefined), {
    cursor: null,
    limit: 100,
  });
  assert.deepEqual(normalizeAdminUserListPagination({
    cursor: 'user-1',
    limit: 50,
  }), {
    cursor: 'user-1',
    limit: 50,
  });
  assert.throws(() => normalizeAdminUserListPagination({limit: 101}), /limit/);
  assert.throws(() => normalizeAdminUserListPagination({cursor: 'users/a'}), /cursor/);
});

test('private admin labels require webmaster and expose only reviewed shell fields', () => {
  assert.equal(canListPrivateUserLabels('webmaster'), true);
  assert.equal(canListPrivateUserLabels('dm'), false);
  assert.equal(canListPrivateUserLabels('player'), false);
  const projected = buildAdminUserListItem('user-1', {
    characterId: 'Hero',
    username: 'hero',
    email: 'hero@example.com',
    role: 'PLAYER',
    inventory: ['secret aggregate'],
    passwordHash: 'never expose',
  });
  assert.deepEqual(projected, {
    id: 'user-1',
    characterId: 'Hero',
    username: 'hero',
    email: 'hero@example.com',
    role: 'player',
  });
});

test('turn-effect consumption decrements every timed effect and expires barrier state', () => {
  assert.deepEqual(consumeActiveTurnEffects({
    barriera: {remainingTurns: 1, totalTurns: 3, label: 'ward'},
    poison: {remainingTurns: 2, totalTurns: 4},
    passive: {label: 'always'},
  }), {
    changed: true,
    effects: {
      barriera: {remainingTurns: 0, totalTurns: 0, label: 'ward'},
      poison: {remainingTurns: 1, totalTurns: 4},
      passive: {label: 'always'},
    },
    barrierExpired: true,
  });
});

test('turn-effect consumption preserves untimed effects and reports a no-op', () => {
  assert.deepEqual(consumeActiveTurnEffects({passive: {label: 'always'}}), {
    changed: false,
    effects: {passive: {label: 'always'}},
    barrierExpired: false,
  });
});
