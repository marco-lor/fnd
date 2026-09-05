const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const {
  Timestamp,
  getFirestore,
} = require('firebase-admin/firestore');
const {
  configureOwnedPerformanceEnvironment,
  OWNED_PERFORMANCE_ENVIRONMENT,
  projectId,
} = require('../../scripts/performance/common');
const { withBackgroundTriggersDisabled } = require('../../scripts/performance/emulator-control');

configureOwnedPerformanceEnvironment();

const FUNCTIONS_REGION = 'europe-west8';
const FUNCTIONS_BASE_URL = 'http://127.0.0.1:5001';
const PASSWORD = 'PerfTest!123';
const CALL_TIMEOUT_MS = 120_000;
const FIXED_TIME = Timestamp.fromDate(new Date('2026-01-02T00:00:00.000Z'));

let app;
let db;
const authTokens = new Map();

class CallableInvocationError extends Error {
  constructor(name, response, payload) {
    const status = payload?.error?.status || `HTTP_${response.status}`;
    super(payload?.error?.message || `${name} failed with ${status}.`);
    this.name = 'CallableInvocationError';
    this.code = String(status).toLowerCase().replaceAll('_', '-');
    this.details = payload?.error?.details;
    this.httpStatus = response.status;
  }
}

const operationId = (label) => `task05-${label}`;

const expectCallableError = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
};

const readJsonResponse = async (response, label) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${text.slice(0, 300)}`, { cause: error });
  }
};

const fetchWithDeadline = async (url, init, label) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  timeout.unref?.();
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    throw new Error(`${label} did not complete within ${CALL_TIMEOUT_MS} ms.`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
};

const signIn = async (uid) => {
  if (authTokens.has(uid)) return authTokens.get(uid);
  const response = await fetchWithDeadline(
    `http://${OWNED_PERFORMANCE_ENVIRONMENT.FIREBASE_AUTH_EMULATOR_HOST}`
      + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=task05-emulator',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `${uid}@example.test`,
        password: PASSWORD,
        returnSecureToken: true,
      }),
    },
    `Auth emulator sign-in for ${uid}`
  );
  const body = await readJsonResponse(response, 'Auth emulator');
  if (!response.ok || !body.idToken) {
    throw new Error(`Auth emulator sign-in failed for ${uid}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  authTokens.set(uid, body.idToken);
  return body.idToken;
};

const callFunction = async (name, data, { token = null } = {}) => {
  const response = await fetchWithDeadline(
    `${FUNCTIONS_BASE_URL}/${projectId}/${FUNCTIONS_REGION}/${name}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ data }),
    },
    `${name} callable`
  );
  const body = await readJsonResponse(response, name);
  if (!response.ok || body.error) throw new CallableInvocationError(name, response, body);
  if (!Object.hasOwn(body, 'data') && !Object.hasOwn(body, 'result')) {
    throw new Error(`${name} returned neither callable data nor a result.`);
  }
  return body.data ?? body.result;
};

const chunk = (values, size = 400) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size)
);

const deleteCollection = async (collectionPath) => {
  const reference = db.collection(collectionPath);
  while (true) {
    const snapshot = await reference.limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
};

const writeDocuments = async (documents) => {
  for (const entries of chunk(documents)) {
    const batch = db.batch();
    entries.forEach(({ path, data }) => batch.set(db.doc(path), data));
    await batch.commit();
  }
};

const stateDocument = (uid, data) => ({
  schemaVersion: 2,
  revision: 1,
  updatedAt: FIXED_TIME,
  updatedBy: uid,
  ...data,
});

const captureDocuments = async (paths) => new Map(
  await Promise.all(paths.map(async (documentPath) => {
    const snapshot = await db.doc(documentPath).get();
    return [documentPath, {
      exists: snapshot.exists,
      data: snapshot.data(),
    }];
  }))
);

const restoreDocuments = async (documents) => {
  await withBackgroundTriggersDisabled(async () => {
    for (const [documentPath, snapshot] of documents) {
      const reference = db.doc(documentPath);
      if (snapshot.exists) {
        await reference.set(snapshot.data);
      } else {
        await reference.delete();
      }
    }
  });
};

const inventoryFingerprint = (snapshot) => snapshot.docs
  .map((document) => ({
    id: document.id,
    marker: document.get('testMarker'),
    updateTime: `${document.updateTime.seconds}:${document.updateTime.nanoseconds}`,
  }))
  .sort((left, right) => left.id.localeCompare(right.id));

const seedTask05State = async () => {
  await withBackgroundTriggersDisabled(async () => {
    await Promise.all([
      deleteCollection('users/perf-player/inventory'),
      deleteCollection('users/perf-peer-3/inventory'),
      deleteCollection('users/perf-peer-4/spells'),
      deleteCollection('users/perf-peer-4/content_names'),
      deleteCollection('users/perf-peer-5/inventory'),
    ]);

    const documents = [
      {
        path: 'users/perf-new-player/state/resources',
        data: stateDocument('perf-new-player', {
          stats: {
            hpCurrent: 10,
            hpTotal: 20,
            manaCurrent: 5,
            manaTotal: 10,
            barrieraCurrent: 0,
          },
        }),
      },
      {
        path: 'users/perf-player/state/resources',
        data: stateDocument('perf-player', { stats: { hpCurrent: 20, hpTotal: 50 } }),
      },
      {
        path: 'users/perf-peer-2/state/resources',
        data: stateDocument('perf-peer-2', { stats: { hpCurrent: 30, hpTotal: 50 } }),
      },
      {
        path: 'users/perf-peer-3/state/resources',
        data: stateDocument('perf-peer-3', { stats: { gold: 5 } }),
      },
      {
        path: 'users/perf-peer-5/state/resources',
        data: stateDocument('perf-peer-5', { stats: { hpCurrent: 5, hpTotal: 20 } }),
      },
      {
        path: 'users/perf-peer-5/state/progression',
        data: stateDocument('perf-peer-5', { stats: { level: 5 } }),
      },
      {
        path: 'users/perf-peer-5/state/equipment',
        data: stateDocument('perf-peer-5', { slots: {} }),
      },
      {
        path: 'items/task05-purchase-a',
        data: {
          item_type: 'accessorio',
          visibility: 'all',
          General: { Nome: 'Task 05 purchase A', prezzo: 4 },
          Specific: {},
          Parametri: {},
        },
      },
      {
        path: 'items/task05-purchase-b',
        data: {
          item_type: 'accessorio',
          visibility: 'all',
          General: { Nome: 'Task 05 purchase B', prezzo: 4 },
          Specific: {},
          Parametri: {},
        },
      },
      {
        path: 'users/perf-peer-5/inventory/task05-consumable',
        data: {
          schemaVersion: 2,
          revision: 1,
          kind: 'consumabile',
          quantity: 2,
          currentRevision: 1,
          currentSnapshot: {
            id: 'task05-consumable',
            item_type: 'consumabile',
            General: { Nome: 'Task 05 healing draught' },
            Specific: { 'Bonus Creazione': 0 },
            Parametri: {
              Special: {
                'Rigenera Dado Anima HP': { 1: 1, 4: 1, 7: 1, 10: 1 },
              },
            },
          },
          testMarker: 'consumable',
          updatedAt: FIXED_TIME,
        },
      },
      {
        path: 'grigliata_backgrounds/task05-emulator-map',
        data: { name: 'Task 05 emulator map', createdAt: FIXED_TIME, updatedAt: FIXED_TIME },
      },
      {
        path: 'grigliata_tokens/task05-emulator-token',
        data: {
          ownerUid: 'perf-new-player',
          tokenType: 'character',
          imageSource: 'profile',
          label: 'Before callable',
          updatedAt: FIXED_TIME,
        },
      },
      {
        path: 'grigliata_token_placements/task05-emulator-map__task05-emulator-token',
        data: {
          backgroundId: 'task05-emulator-map',
          tokenId: 'task05-emulator-token',
          ownerUid: 'perf-new-player',
          updatedAt: FIXED_TIME,
        },
      },
      ...Array.from({ length: 500 }, (_, index) => ({
        path: `users/perf-player/inventory/task05-isolation-${String(index).padStart(3, '0')}`,
        data: {
          schemaVersion: 2,
          revision: 1,
          quantity: 1,
          testMarker: `inventory-${String(index).padStart(3, '0')}`,
          updatedAt: FIXED_TIME,
        },
      })),
    ];

    await writeDocuments(documents);
  });
};

before(async () => {
  app = initializeApp({ projectId }, 'task05-callable-emulator-tests');
  db = getFirestore(app);
  await seedTask05State();
});

after(async () => {
  authTokens.clear();
  if (app) await deleteApp(app);
});

test('Task 05 callables enforce authentication, owner access, and peer denial', async () => {
  const payload = {
    operationId: operationId('anonymous-resource'),
    resource: 'hp',
    mode: 'set',
    value: 11,
  };
  await expectCallableError(
    callFunction('task05UpdateResource', payload),
    'unauthenticated'
  );

  const playerToken = await signIn('perf-new-player');
  const result = await callFunction('task05UpdateResource', {
    ...payload,
    operationId: operationId('owner-resource'),
    value: 12,
  }, { token: playerToken });
  assert.equal(result.success, true);
  assert.equal(result.newValue, 12);
  assert.equal(result.previousValue, 10);
  assert.equal(result.appliedDelta, 2);
  assert.equal(result.newRevision, 2);

  await expectCallableError(
    callFunction('task05UpdateResource', {
      operationId: operationId('peer-denial'),
      userId: 'perf-peer-2',
      resource: 'hp',
      mode: 'set',
      value: 99,
    }, { token: playerToken }),
    'permission-denied'
  );
  assert.equal((await db.doc('users/perf-peer-2/state/resources').get()).get('stats.hpCurrent'), 30);
});

test('barrier deltas clamp legacy state, serialize concurrently, and leave other resources untouched', async () => {
  const token = await signIn('perf-new-player');
  const path = 'users/perf-new-player/state/resources';
  const original = await captureDocuments([path]);
  try {
    await withBackgroundTriggersDisabled(async () => {
      await db.doc(path).set(stateDocument('perf-new-player', {
        revision: 11,
        stats: {
          hpCurrent: 10,
          hpTotal: 20,
          manaCurrent: 5,
          manaTotal: 10,
          essenzaCurrent: 3,
          essenzaTotal: 4,
          barriera: '4',
        },
        active_turn_effect: {barriera: {remainingTurns: 2, totalTurns: 3}},
      }));
    });

    const overflow = await callFunction('task05UpdateResource', {
      operationId: operationId('barrier-legacy-overflow'), resource: 'barriera', mode: 'delta', value: 10,
    }, {token});
    assert.deepEqual(
      {previousValue: overflow.previousValue, newValue: overflow.newValue, appliedDelta: overflow.appliedDelta, newRevision: overflow.newRevision},
      {previousValue: 4, newValue: 4, appliedDelta: 0, newRevision: 12}
    );
    const underflow = await callFunction('task05UpdateResource', {
      operationId: operationId('barrier-legacy-underflow'), resource: 'barriera', mode: 'delta', value: -10,
    }, {token});
    assert.deepEqual(
      {previousValue: underflow.previousValue, newValue: underflow.newValue, appliedDelta: underflow.appliedDelta, newRevision: underflow.newRevision},
      {previousValue: 4, newValue: 0, appliedDelta: -4, newRevision: 13}
    );

    const barrierSet = await callFunction('task05UpdateResource', {
      operationId: operationId('barrier-set-total-and-turns'),
      resource: 'barriera',
      mode: 'set',
      value: 6,
      totalValue: 9,
      remainingTurns: 3,
      totalTurns: 4,
    }, {token});
    assert.deepEqual(
      {
        previousValue: barrierSet.previousValue,
        newValue: barrierSet.newValue,
        appliedDelta: barrierSet.appliedDelta,
        newRevision: barrierSet.newRevision,
        newTotalValue: barrierSet.newTotalValue,
      },
      {previousValue: 0, newValue: 6, appliedDelta: 6, newRevision: 14, newTotalValue: 9}
    );
    const storedSet = await db.doc(path).get();
    assert.equal(storedSet.get('stats.barrieraCurrent'), 6);
    assert.equal(storedSet.get('stats.barrieraTotal'), 9);
    assert.deepEqual(storedSet.get('active_turn_effect.barriera'), {remainingTurns: 3, totalTurns: 4});

    await withBackgroundTriggersDisabled(async () => {
      await db.doc(path).update({stats: {...(await db.doc(path).get()).get('stats'), barrieraCurrent: 5, barrieraTotal: 0}});
    });
    const zeroTotal = await callFunction('task05UpdateResource', {
      operationId: operationId('barrier-zero-total'), resource: 'barriera', mode: 'delta', value: 1,
    }, {token});
    assert.deepEqual(
      {previousValue: zeroTotal.previousValue, newValue: zeroTotal.newValue, appliedDelta: zeroTotal.appliedDelta},
      {previousValue: 5, newValue: 0, appliedDelta: -5}
    );

    await withBackgroundTriggersDisabled(async () => {
      await db.doc(path).update({stats: {...(await db.doc(path).get()).get('stats'), barrieraCurrent: 1, barrieraTotal: 5}});
    });
    const revisionBeforeConcurrent = (await db.doc(path).get()).get('revision');
    const concurrent = await Promise.all([
      callFunction('task05UpdateResource', {operationId: operationId('barrier-concurrent-a'), resource: 'barriera', mode: 'delta', value: 1}, {token}),
      callFunction('task05UpdateResource', {operationId: operationId('barrier-concurrent-b'), resource: 'barriera', mode: 'delta', value: 1}, {token}),
    ]);
    assert.deepEqual(
      concurrent
        .map(({previousValue, newValue, appliedDelta, newRevision}) => ({previousValue, newValue, appliedDelta, newRevision}))
        .sort((first, second) => first.previousValue - second.previousValue),
      [
        {previousValue: 1, newValue: 2, appliedDelta: 1, newRevision: revisionBeforeConcurrent + 1},
        {previousValue: 2, newValue: 3, appliedDelta: 1, newRevision: revisionBeforeConcurrent + 2},
      ]
    );
    const stored = await db.doc(path).get();
    assert.equal(stored.get('stats.barrieraCurrent'), 3);
    assert.equal(stored.get('revision'), revisionBeforeConcurrent + 2);
    assert.equal(stored.get('stats.hpCurrent'), 10);
    assert.equal(stored.get('stats.manaCurrent'), 5);
    assert.equal(stored.get('stats.essenzaCurrent'), 3);
    assert.deepEqual(stored.get('active_turn_effect.barriera'), {remainingTurns: 3, totalTurns: 4});
    assert.equal(stored.get('lastResourceOperationId'), undefined);
  } finally {
    await restoreDocuments(original);
  }
});

test('character creation race selection resets authoritative parameters and creation budgets', async () => {
  const token = await signIn('perf-new-player');
  const paths = [
    'users/perf-new-player',
    'users/perf-new-player/state/progression',
    'utils/varie',
  ];
  const original = await captureDocuments(paths);
  const operation = operationId('task08-race-reset');

  try {
    const schema = await db.doc('utils/schema_pg').get();
    const originalVarie = original.get('utils/varie').data;
    await withBackgroundTriggersDisabled(async () => {
      await db.doc('utils/varie').set({
        ...originalVarie,
        starting_values: {
          ...originalVarie.starting_values,
          abilityPoints: 6,
          tokenPoints: 3,
        },
        races_extra: {
          ...originalVarie.races_extra,
          human: {extraAbilityCreation: 2, extraTokenCreation: 1},
        },
      });
      await db.doc('users/perf-new-player').set({
        ...original.get('users/perf-new-player').data,
        race: 'stale-race',
        flags: {characterCreationDone: false},
      });
      await db.doc('users/perf-new-player/state/progression').set({
        ...original.get('users/perf-new-player/state/progression').data,
        stats: {
          ...original.get('users/perf-new-player/state/progression').data.stats,
          basePointsAvailable: 99,
          basePointsSpent: 17,
          combatTokensAvailable: 88,
          combatTokensSpent: 16,
          negativeBaseStatCount: 4,
        },
        Parametri: {
          Base: {Forza: {Base: 99}},
          Combattimento: {Salute: {Base: 99}},
        },
        AltriParametri: {Anima_1: 'stale-anima'},
        flags: {characterCreationDone: false},
      });
    });

    const result = await callFunction('task05CharacterCreation', {
      operationId: operation,
      action: 'selectRace',
      race: 'human',
    }, {token});
    assert.deepEqual(result, {success: true, race: 'human', replayed: false});

    const [root, progression] = await Promise.all([
      db.doc('users/perf-new-player').get(),
      db.doc('users/perf-new-player/state/progression').get(),
    ]);
    assert.equal(root.get('race'), 'human');
    assert.equal(root.get('flags.characterCreationDone'), false);
    assert.deepEqual(progression.get('Parametri.Base'), schema.get('Parametri.Base'));
    assert.deepEqual(
      progression.get('Parametri.Combattimento'),
      schema.get('Parametri.Combattimento')
    );
    assert.equal(progression.get('stats.basePointsAvailable'), 8);
    assert.equal(progression.get('stats.combatTokensAvailable'), 4);
    assert.equal(progression.get('stats.basePointsSpent'), 0);
    assert.equal(progression.get('stats.combatTokensSpent'), 0);
    assert.equal(progression.get('stats.negativeBaseStatCount'), 0);
    assert.equal(progression.get('AltriParametri.Anima_1'), '---');
  } finally {
    await restoreDocuments(original);
  }
});

test('character creation initialization returns a replay envelope for duplicate retries', async () => {
  const token = await signIn('perf-new-player');
  const operation = operationId(`task08-init-envelope-${Date.now().toString(36)}`);

  const first = await callFunction('task05CharacterCreation', {
    operationId: operation,
    action: 'initialize',
  }, {token});
  const replay = await callFunction('task05CharacterCreation', {
    operationId: operation,
    action: 'initialize',
  }, {token});

  assert.equal(first.success, true);
  assert.equal(first.replayed, false);
  assert.equal(replay.success, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.created, first.created);
  assert.equal(replay.initializedDomains, first.initializedDomains);
});

test('all valid Character Creation actions return truthful replay envelopes', async () => {
  const token = await signIn('perf-new-player');
  const paths = [
    'users/perf-new-player',
    'users/perf-new-player/state/progression',
    'users/perf-new-player/state/settings',
  ];
  const original = await captureDocuments(paths);
  const actions = [
    {action: 'initialize'},
    {action: 'selectRace', race: 'human'},
    {action: 'selectAnima', anima: 'fire'},
    {action: 'complete', characterId: 'Envelope Character', profile: {}},
  ];

  try {
    await withBackgroundTriggersDisabled(async () => {
      await db.doc(paths[0]).set({
        ...original.get(paths[0]).data,
        flags: {
          ...original.get(paths[0]).data.flags,
          characterCreationDone: false,
        },
      });
      await db.doc(paths[1]).set({
        ...original.get(paths[1]).data,
        flags: {
          ...original.get(paths[1]).data.flags,
          characterCreationDone: false,
        },
      });
    });

    const firstResults = [];
    for (const [index, action] of actions.entries()) {
      firstResults.push(await callFunction('task05CharacterCreation', {
        ...action,
        operationId: operationId(`task08-envelope-first-${index}`),
      }, {token}));
    }
    assert.deepEqual(firstResults.map((result) => ({
      success: result.success,
      replayed: result.replayed,
    })), actions.map(() => ({success: true, replayed: false})));

    const replayResults = [];
    for (const [index, action] of actions.entries()) {
      replayResults.push(await callFunction('task05CharacterCreation', {
        ...action,
        operationId: operationId(`task08-envelope-first-${index}`),
      }, {token}));
    }
    assert.deepEqual(replayResults.map((result) => ({
      success: result.success,
      replayed: result.replayed,
    })), actions.map(() => ({success: true, replayed: true})));
  } finally {
    await restoreDocuments(original);
  }
});

test('character point callable preserves the negative-stat and combat floor policies', async () => {
  const token = await signIn('perf-new-player');
  const path = 'users/perf-new-player/state/progression';
  const original = await captureDocuments([path]);
  const baseParameters = original.get(path).data.Parametri;

  const writeProgression = async (stats, parametri = baseParameters) => {
    await withBackgroundTriggersDisabled(async () => {
      await db.doc(path).set({
        ...original.get(path).data,
        stats,
        Parametri: parametri,
        flags: {characterCreationDone: false},
      });
    });
  };

  try {
    await writeProgression({
      ...original.get(path).data.stats,
      basePointsAvailable: 4,
      basePointsSpent: 0,
      negativeBaseStatCount: 4,
    }, {
      ...baseParameters,
      Base: {
        ...baseParameters.Base,
        Forza: {...baseParameters.Base.Forza, Base: 0},
      },
    });
    await expectCallableError(
      callFunction('spendCharacterPointV2', {
        operationId: operationId('task08-negative-cap'),
        statName: 'Forza',
        statType: 'Base',
        change: -1,
      }, {token}),
      'failed-precondition'
    );

    await writeProgression({
      ...original.get(path).data.stats,
      basePointsAvailable: 4,
      basePointsSpent: 0,
      negativeBaseStatCount: 1,
    }, {
      ...baseParameters,
      Base: {
        ...baseParameters.Base,
        Forza: {...baseParameters.Base.Forza, Base: -1},
      },
    });
    await expectCallableError(
      callFunction('spendCharacterPointV2', {
        operationId: operationId('task08-negative-floor'),
        statName: 'Forza',
        statType: 'Base',
        change: -1,
      }, {token}),
      'failed-precondition'
    );

    await writeProgression({
      ...original.get(path).data.stats,
      combatTokensAvailable: 4,
      combatTokensSpent: 0,
    }, {
      ...baseParameters,
      Combattimento: {
        ...baseParameters.Combattimento,
        Salute: {...baseParameters.Combattimento.Salute, Base: 0},
      },
    });
    await expectCallableError(
      callFunction('spendCharacterPointV2', {
        operationId: operationId('task08-combat-floor'),
        statName: 'Salute',
        statType: 'Combat',
        change: -1,
      }, {token}),
      'failed-precondition'
    );
  } finally {
    await restoreDocuments(original);
  }
});

test('the admin user list paginates safe private fields without reading root aggregates', async () => {
  const extraUid = 'task05-admin-list-extra';
  await withBackgroundTriggersDisabled(async () => {
    await Promise.all([
      db.doc(`users/${extraUid}`).set({
        modelVersion: 2,
        summary: {level: 1},
        characterId: 'Task 05 Admin Extra',
        username: 'task05-admin-extra',
        email: 'task05-admin-extra@example.test',
        role: 'player',
        privateAggregate: 'never-return-this-field'.repeat(10_000),
      }),
      db.doc(`user_directory/${extraUid}`).set({
        schemaVersion: 1,
        characterId: 'Task 05 Admin Extra',
        label: 'Task 05 Admin Extra',
        normalizedLabel: 'task 05 admin extra',
        role: 'player',
      }),
    ]);
  });

  const webmasterToken = await signIn('perf-webmaster');
  const pageLengths = [];
  const ids = [];
  let cursor = null;
  let hasMore = true;
  while (hasMore) {
    const page = await callFunction('task05ListAdminUsers', {
      limit: 100,
      ...(cursor ? {cursor} : {}),
    }, {token: webmasterToken});
    pageLengths.push(page.items.length);
    page.items.forEach((item) => {
      assert.deepEqual(
        Object.keys(item).sort(),
        ['characterId', 'email', 'id', 'role', 'username']
      );
      ids.push(item.id);
    });
    hasMore = page.hasMore;
    cursor = page.cursor;
  }

  assert.deepEqual(pageLengths, [100, 100, 1]);
  assert.equal(ids.length, 201);
  assert.equal(new Set(ids).size, 201);
  assert.ok(ids.includes(extraUid));
  assert.equal(cursor, null);

  const dmToken = await signIn('perf-dm');
  await expectCallableError(
    callFunction('task05ListAdminUsers', {limit: 100}, {token: dmToken}),
    'permission-denied'
  );
});

test('Task 05 operation receipts replay exact requests and reject operationId tampering', async () => {
  const token = await signIn('perf-new-player');
  const payload = {
    operationId: operationId('idempotent-resource'),
    resource: 'hp',
    mode: 'set',
    value: 14,
  };
  const first = await callFunction('task05UpdateResource', payload, { token });
  const replay = await callFunction('task05UpdateResource', payload, { token });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.newValue, 14);

  await expectCallableError(
    callFunction('task05UpdateResource', { ...payload, value: 15 }, { token }),
    'already-exists'
  );
  assert.equal((await db.doc('users/perf-new-player/state/resources').get()).get('stats.hpCurrent'), 14);
});

test('a resource mutation does not scan or rewrite a 500-document inventory', async () => {
  const inventory = db.collection('users/perf-player/inventory');
  const before = await inventory.get();
  assert.equal(before.size, 500);
  const beforeFingerprint = inventoryFingerprint(before);

  const token = await signIn('perf-player');
  const result = await callFunction('task05UpdateResource', {
    operationId: operationId('inventory-isolation'),
    resource: 'hp',
    mode: 'set',
    value: 23,
  }, { token });
  assert.equal(result.newValue, 23);

  const afterSnapshot = await inventory.get();
  assert.equal(afterSnapshot.size, 500);
  assert.deepEqual(inventoryFingerprint(afterSnapshot), beforeFingerprint);
});

test('actor-only consumable commands ignore a spoofed userId', async () => {
  const token = await signIn('perf-peer-5');
  const preparation = await callFunction('task05PrepareConsumable', {
    operationId: operationId('actor-only-spoof'),
    userId: 'perf-peer-2',
    inventoryId: 'task05-consumable',
    resource: 'hp',
  }, {token});

  assert.equal(preparation.inventoryId, 'task05-consumable');
  assert.equal(preparation.resource, 'hp');
  assert.equal(
    (await db.doc(`user_operations/${preparation.preparationId}`).get())
      .get('actorUid'),
    'perf-peer-5'
  );
  assert.equal(
    (await db.doc('users/perf-peer-2/inventory/task05-consumable').get()).exists,
    false
  );
});

test('a privileged target-scoped command updates only the requested V2 domain', async () => {
  const dmToken = await signIn('perf-dm');
  const result = await callFunction('task05UpdateResource', {
    operationId: operationId('target-v2-update'),
    userId: 'perf-peer-2',
    resource: 'hp',
    mode: 'set',
    value: 32,
  }, {token: dmToken});

  const [root, resources] = await Promise.all([
    db.doc('users/perf-peer-2').get(),
    db.doc('users/perf-peer-2/state/resources').get(),
  ]);
  assert.equal(result.newValue, 32);
  assert.equal(resources.get('stats.hpCurrent'), 32);
  assert.equal(root.get('stats'), undefined);
});

test('progression rejects resource, unknown, and owner-protected stats', async () => {
  const token = await signIn('perf-player');

  await expectCallableError(
    callFunction('task05UpdateProgression', {
      operationId: operationId('progression-resource'),
      patch: {stats: {hpCurrent: 999}},
    }, {token}),
    'invalid-argument'
  );
  await expectCallableError(
    callFunction('task05UpdateProgression', {
      operationId: operationId('progression-unknown'),
      patch: {stats: {unrecognizedCounter: 1}},
    }, {token}),
    'invalid-argument'
  );
  await expectCallableError(
    callFunction('task05UpdateProgression', {
      operationId: operationId('progression-protected'),
      patch: {stats: {level: 99}},
    }, {token}),
    'permission-denied'
  );
});

test('concurrent Bazaar purchases cannot overspend one resource balance', async () => {
  const token = await signIn('perf-peer-3');
  const results = await Promise.allSettled([
    callFunction('task05PurchaseItem', {
      operationId: operationId('purchase-concurrent-a'),
      itemId: 'task05-purchase-a',
    }, { token }),
    callFunction('task05PurchaseItem', {
      operationId: operationId('purchase-concurrent-b'),
      itemId: 'task05-purchase-b',
    }, { token }),
  ]);
  const fulfilled = results.filter(({ status }) => status === 'fulfilled');
  const rejected = results.filter(({ status }) => status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'resource-exhausted');
  assert.equal(fulfilled[0].value.newGold, 1);

  const [resources, inventory] = await Promise.all([
    db.doc('users/perf-peer-3/state/resources').get(),
    db.collection('users/perf-peer-3/inventory').get(),
  ]);
  assert.equal(resources.get('stats.gold'), 1);
  assert.equal(inventory.size, 1);
});

test('historical rollout records cannot reactivate root dual writes', async () => {
  await db.doc('app_config/user_data_v2').set({
    schemaVersion: 2,
    stage: 'new-only',
    userOverrides: {'perf-player': 'dual-write'},
    updatedAt: FIXED_TIME,
  });
  const [overriddenToken, globalToken] = await Promise.all([
    signIn('perf-player'),
    signIn('perf-peer-2'),
  ]);

  try {
    await callFunction('task05UpdateResource', {
      operationId: operationId('rollout-override-inert'),
      resource: 'hp',
      mode: 'set',
      value: 21,
    }, {token: overriddenToken});
    await callFunction('task05UpdateResource', {
      operationId: operationId('rollout-global-inert'),
      resource: 'hp',
      mode: 'set',
      value: 31,
    }, {token: globalToken});

    const [overriddenRoot, overriddenV2, globalRoot, globalV2] = await Promise.all([
      db.doc('users/perf-player').get(),
      db.doc('users/perf-player/state/resources').get(),
      db.doc('users/perf-peer-2').get(),
      db.doc('users/perf-peer-2/state/resources').get(),
    ]);
    assert.equal(overriddenRoot.get('stats'), undefined);
    assert.equal(overriddenV2.get('stats.hpCurrent'), 21);
    assert.equal(globalRoot.get('stats'), undefined);
    assert.equal(globalV2.get('stats.hpCurrent'), 31);
  } finally {
    await db.doc('app_config/user_data_v2').delete();
  }
});

test('personal-content reservations reject duplicate exact names', async () => {
  const token = await signIn('perf-peer-4');
  const first = await callFunction('task05MutatePersonalContent', {
    operationId: operationId('content-first'),
    kind: 'spell',
    action: 'upsert',
    contentId: 'task05-content-a',
    name: 'Task 05 Exact Name',
    data: { Nome: 'Task 05 Exact Name', effetto: 'first' },
  }, { token });
  assert.equal(first.contentId, 'task05-content-a');

  await expectCallableError(
    callFunction('task05MutatePersonalContent', {
      operationId: operationId('content-duplicate'),
      kind: 'spell',
      action: 'upsert',
      contentId: 'task05-content-b',
      name: 'Task 05 Exact Name',
      data: { Nome: 'Task 05 Exact Name', effetto: 'second' },
    }, { token }),
    'already-exists'
  );

  const [content, reservations] = await Promise.all([
    db.collection('users/perf-peer-4/spells').get(),
    db.collection('users/perf-peer-4/content_names').get(),
  ]);
  assert.equal(content.size, 1);
  assert.equal(reservations.size, 1);
  assert.equal(content.docs[0].id, 'task05-content-a');
});

test('consumable prepare/commit is replay-safe, single-use, and expiry-aware', async () => {
  const token = await signIn('perf-peer-5');
  const preparation = await callFunction('task05PrepareConsumable', {
    operationId: operationId('consume-prepare'),
    inventoryId: 'task05-consumable',
    resource: 'hp',
  }, { token });
  assert.match(preparation.preparationId, /^[a-f0-9]{48}$/);
  assert.equal(preparation.inventoryId, 'task05-consumable');
  assert.equal(preparation.resource, 'hp');
  assert.equal(preparation.rolls.length, 1);

  const commitPayload = {
    operationId: operationId('consume-commit'),
    preparationId: preparation.preparationId,
  };
  const commit = await callFunction('task05CommitConsumable', commitPayload, { token });
  const replay = await callFunction('task05CommitConsumable', commitPayload, { token });
  assert.equal(commit.quantity, 1);
  assert.equal(commit.replayed, false);
  assert.equal(replay.quantity, 1);
  assert.equal(replay.replayed, true);

  await expectCallableError(
    callFunction('task05CommitConsumable', {
      operationId: operationId('consume-double'),
      preparationId: preparation.preparationId,
    }, { token }),
    'already-exists'
  );

  const expiringPreparation = await callFunction('task05PrepareConsumable', {
    operationId: operationId('consume-expiring'),
    inventoryId: 'task05-consumable',
    resource: 'hp',
  }, { token });
  await db.doc(`user_operations/${expiringPreparation.preparationId}`).update({
    expiresAt: Timestamp.fromMillis(Date.now() - 1_000),
  });
  await expectCallableError(
    callFunction('task05CommitConsumable', {
      operationId: operationId('consume-expired'),
      preparationId: expiringPreparation.preparationId,
    }, { token }),
    'failed-precondition'
  );
  assert.equal(
    (await db.doc('users/perf-peer-5/inventory/task05-consumable').get()).get('quantity'),
    1
  );
});

test('consumable commit uses current resources and atomically handles depletion, no-regeneration, and stale inventory', async () => {
  const uid = 'perf-peer-5';
  const token = await signIn(uid);
  const resourcesPath = `users/${uid}/state/resources`;
  const progressionPath = `users/${uid}/state/progression`;
  const equipmentPath = `users/${uid}/state/equipment`;
  const beltPath = `users/${uid}/inventory/task08-step7-belt`;
  const healingPath = `users/${uid}/inventory/task08-step7-healing`;
  const neutralPath = `users/${uid}/inventory/task08-step7-neutral`;
  const stalePath = `users/${uid}/inventory/task08-step7-stale`;
  const originals = await captureDocuments([
    resourcesPath,
    progressionPath,
    equipmentPath,
    beltPath,
    healingPath,
    neutralPath,
    stalePath,
  ]);
  const inventoryDocument = (id, snapshot, quantity = 1) => ({
    schemaVersion: 2,
    revision: 1,
    kind: String(snapshot.item_type || ''),
    quantity,
    currentRevision: 1,
    currentSnapshot: { id, ...snapshot },
    testMarker: 'task08-step7-consumable',
    updatedAt: FIXED_TIME,
  });

  try {
    await withBackgroundTriggersDisabled(async () => {
      await writeDocuments([
        {
          path: resourcesPath,
          data: stateDocument(uid, {
            stats: { hpCurrent: 3, hpTotal: 20, manaCurrent: 4, manaTotal: 12 },
          }),
        },
        {
          path: progressionPath,
          data: stateDocument(uid, { stats: { level: 5 }, Parametri: {} }),
        },
        {
          path: beltPath,
          data: inventoryDocument('task08-step7-belt', {
            item_type: 'equipaggiamento',
            General: { Nome: 'Task 08 Step 7 belt', Slot: 'Cintura' },
            Specific: { slotCintura: 1 },
            Parametri: {},
          }),
        },
        {
          path: healingPath,
          data: inventoryDocument('task08-step7-healing', {
            item_type: 'consumabile',
            General: { Nome: 'Task 08 Step 7 healing draught' },
            Specific: { 'Bonus Creazione': 0 },
            Parametri: { Special: { 'Rigenera Dado Anima HP': { 1: 1, 4: 1, 7: 1, 10: 1 } } },
          }),
        },
        {
          path: neutralPath,
          data: inventoryDocument('task08-step7-neutral', {
            item_type: 'consumabile',
            General: { Nome: 'Task 08 Step 7 neutral draught' },
            Specific: {},
            Parametri: {},
          }),
        },
        {
          path: stalePath,
          data: inventoryDocument('task08-step7-stale', {
            item_type: 'consumabile',
            General: { Nome: 'Task 08 Step 7 stale draught' },
            Specific: { 'Bonus Creazione': 0 },
            Parametri: { Special: { 'Rigenera Dado Anima HP': { 1: 1, 4: 1, 7: 1, 10: 1 } } },
          }, 2),
        },
        {
          path: equipmentPath,
          data: stateDocument(uid, {
            slots: { cintura: 'task08-step7-belt', beltC1: 'task08-step7-healing' },
            beltCapacity: 1,
          }),
        },
      ]);
    });

    const healingPreparation = await callFunction('task05PrepareConsumable', {
      operationId: operationId('step7-healing-prepare'),
      inventoryId: 'task08-step7-healing',
      resource: 'hp',
    }, {token});
    assert.equal(healingPreparation.rolls.length, 1);

    const concurrentUpdate = await callFunction('task05UpdateResource', {
      operationId: operationId('step7-concurrent-resource'),
      resource: 'hp',
      mode: 'set',
      value: 11,
    }, {token});
    assert.equal(concurrentUpdate.newValue, 11);

    const healingCommit = await callFunction('task05CommitConsumable', {
      operationId: operationId('step7-healing-commit'),
      preparationId: healingPreparation.preparationId,
    }, {token});
    const expectedHp = Math.min(20, 11 + healingPreparation.gain);
    assert.equal(healingCommit.resourceValue, expectedHp);
    const [healingAfter, equipmentAfter, resourcesAfter] = await Promise.all([
      db.doc(healingPath).get(),
      db.doc(equipmentPath).get(),
      db.doc(resourcesPath).get(),
    ]);
    assert.equal(healingAfter.exists, false);
    assert.equal(equipmentAfter.get('slots.beltC1'), null);
    assert.equal(equipmentAfter.get('slots.cintura'), 'task08-step7-belt');
    assert.equal(resourcesAfter.get('stats.hpCurrent'), expectedHp);

    const beforeNeutral = resourcesAfter.get('stats');
    const neutralPreparation = await callFunction('task05PrepareConsumable', {
      operationId: operationId('step7-neutral-prepare'),
      inventoryId: 'task08-step7-neutral',
      resource: null,
    }, {token});
    assert.deepEqual(neutralPreparation.rolls, []);
    const neutralCommit = await callFunction('task05CommitConsumable', {
      operationId: operationId('step7-neutral-commit'),
      preparationId: neutralPreparation.preparationId,
    }, {token});
    assert.equal(neutralCommit.resource, null);
    assert.equal(neutralCommit.resourceValue, null);
    assert.equal((await db.doc(neutralPath).get()).exists, false);
    assert.deepEqual((await db.doc(resourcesPath).get()).get('stats'), beforeNeutral);

    const stalePreparation = await callFunction('task05PrepareConsumable', {
      operationId: operationId('step7-stale-prepare'),
      inventoryId: 'task08-step7-stale',
      resource: 'hp',
    }, {token});
    await withBackgroundTriggersDisabled(async () => {
      await db.doc(stalePath).update({
        currentHash: 'changed-after-prepare',
        revision: 2,
      });
    });
    const beforeRejectedCommit = await Promise.all([
      db.doc(stalePath).get(),
      db.doc(resourcesPath).get(),
    ]);
    await expectCallableError(callFunction('task05CommitConsumable', {
      operationId: operationId('step7-stale-commit'),
      preparationId: stalePreparation.preparationId,
    }, {token}), 'failed-precondition');
    const afterRejectedCommit = await Promise.all([
      db.doc(stalePath).get(),
      db.doc(resourcesPath).get(),
    ]);
    assert.equal(afterRejectedCommit[0].get('quantity'), beforeRejectedCommit[0].get('quantity'));
    assert.deepEqual(afterRejectedCommit[1].get('stats'), beforeRejectedCommit[1].get('stats'));
  } finally {
    await restoreDocuments(originals);
  }
});

test('the Grigliata character-resource callable is owner-scoped and server-authoritative', async () => {
  const token = await signIn('perf-new-player');
  const result = await callFunction('task05UpdateGrigliataCharacterResources', {
    operationId: operationId('grigliata-resource'),
    backgroundId: 'task05-emulator-map',
    tokenId: 'task05-emulator-token',
    resources: {
      hpCurrent: 17,
      manaCurrent: 8,
      barrieraCurrent: 2,
    },
    tokenPatch: { label: 'After callable', notes: 'emulator only' },
  }, { token });
  assert.equal(result.success, true);
  assert.deepEqual(result.resources, {
    hpCurrent: 17,
    manaCurrent: 8,
    barrieraCurrent: 2,
  });

  const [resources, tokenDocument, root] = await Promise.all([
    db.doc('users/perf-new-player/state/resources').get(),
    db.doc('grigliata_tokens/task05-emulator-token').get(),
    db.doc('users/perf-new-player').get(),
  ]);
  assert.deepEqual(resources.get('stats'), {
    hpCurrent: 17,
    hpTotal: 20,
    manaCurrent: 8,
    manaTotal: 10,
    barrieraCurrent: 2,
  });
  assert.equal(tokenDocument.get('label'), 'After callable');
  assert.equal(tokenDocument.get('ownerUid'), 'perf-new-player');
  assert.equal(tokenDocument.get('tokenType'), 'character');
  assert.equal(root.get('stats'), undefined);
});
