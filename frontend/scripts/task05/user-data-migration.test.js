const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildArchiveDocuments,
  buildUserV2Plan,
  canonicalHash,
  canonicalStringify,
  materializeLegacyUser,
  PERSONAL_CONTENT_ID_PATTERN,
} = require('./user-data-model');
const {
  assertApprovedReport,
  assertCheckpoint,
  assertDrainFenceMatches,
  assertPreDrainFenceMatches,
  assertSafeTarget,
  buildMigrationPlan,
  executeMigrationPlan,
  frozenLegacyProjectionHash,
  hashDocumentSet,
  inspectOwnedV2Projection,
  parseArguments,
} = require('./user-data-migration');

const legacyUser = (overrides = {}) => ({
  email: 'private@example.test',
  role: 'player',
  characterId: 'Aster',
  race: 'Human',
  flags: {characterCreationDone: true},
  stats: {
    level: 5,
    hpCurrent: 20,
    hpTotal: 30,
    manaCurrent: 4,
    manaTotal: 10,
    gold: 50,
    basePointsAvailable: 2,
  },
  Parametri: {Base: {Forza: {Base: 4, Equip: 1, Tot: 5}}},
  AltriParametri: {Anima_1: 'Spirito'},
  active_turn_effect: {barriera: {remainingTurns: 2}},
  settings: {theme: 'dark', lock_param_base: false},
  inventory: [
    {
      id: 'sword',
      item_type: 'weapon',
      qty: 2,
      General: {Nome: 'Sword'},
      _instance: {instanceId: 'original-instance', pricePaid: 10, source: 'bazaar'},
    },
    {id: 'rope', type: 'varie', name: 'Rope', qty: 3},
  ],
  equipped: {weaponMain: {id: 'sword', item_type: 'weapon', General: {Nome: 'Sword'}}},
  spells: {Flare: {id: 'flare', Costo: 2}},
  tecniche: [{id: 'dash', nome: 'Dash', Costo: 1}],
  lingue: {Comune: {livello: 1}},
  conoscenze: {},
  professioni: {},
  ...overrides,
});

const mapDocuments = (documents) => new Map(documents.map(({path, data}) => [path, data]));

test('canonical hashing is stable across key order and preserves special values', () => {
  assert.equal(canonicalHash({b: 2, a: 1}), canonicalHash({a: 1, b: 2}));
  assert.equal(canonicalStringify({value: Number.NaN}), '{"value":{"$type":"number","value":"NaN"}}');
  assert.notEqual(canonicalHash({value: -0}), canonicalHash({value: 0}));
});

test('V2 transformation is deterministic, bounded, and preserves inventory semantics', () => {
  const first = buildUserV2Plan('user-1', legacyUser());
  const second = buildUserV2Plan('user-1', legacyUser());
  assert.equal(first.targetHash, second.targetHash);
  assert.equal(first.counts.inventory, 3);
  assert.equal(first.issues.filter(({severity}) => severity === 'error').length, 0);

  const byPath = mapDocuments(first.documents);
  assert.deepEqual(byPath.get('users/user-1'), {
    modelVersion: 2,
    email: 'private@example.test',
    role: 'player',
    characterId: 'Aster',
    race: 'Human',
    flags: {characterCreationDone: true},
    summary: {level: 5},
  });
  assert.equal(byPath.get('users/user-1/state/resources').stats.gold, 50);
  assert.equal(byPath.get('users/user-1/state/progression').stats.basePointsAvailable, 2);
  assert.equal(byPath.get('users/user-1/state/equipment').slots.weaponMain, 'original-instance');

  const inventory = first.documents.filter(({path}) => path.includes('/inventory/'));
  assert.equal(inventory.filter(({data}) => data.catalogItemId === 'sword').length, 2);
  assert.equal(inventory.find(({data}) => data.catalogItemId === 'rope').data.quantity, 3);
  assert.equal(inventory[0].data.acquisitionHash, canonicalHash(inventory[0].data.acquisitionSnapshot));
});

test('legacy barriera is canonicalized into current and total resource fields', () => {
  const plan = buildUserV2Plan('user-1', legacyUser({
    stats: {level: 2, barriera: 9},
  }));
  const resources = plan.documents.find(({path}) => (
    path === 'users/user-1/state/resources'
  )).data;
  const progression = plan.documents.find(({path}) => (
    path === 'users/user-1/state/progression'
  )).data;

  assert.equal(resources.stats.barrieraCurrent, 9);
  assert.equal(resources.stats.barrieraTotal, 9);
  assert.equal(Object.hasOwn(resources.stats, 'barriera'), false);
  assert.equal(Object.hasOwn(progression.stats, 'barriera'), false);
});

test('an unmatched equipped item is preserved instead of discarded', () => {
  const plan = buildUserV2Plan('user-1', legacyUser({
    inventory: [],
    equipped: {weaponMain: {id: 'lost-sword', General: {Nome: 'Lost Sword'}}},
  }));
  const equipment = plan.documents.find(({path}) => path.endsWith('/state/equipment')).data;
  const preservation = plan.documents.find(({path}) => path.endsWith(`/inventory/${equipment.slots.weaponMain}`));
  assert.equal(preservation.data.source, 'legacy');
  assert.equal(preservation.data.migration.unmatchedEquipmentSlot, 'weaponMain');
});

test('archive partitions are hash-verifiable and reverse materialization reconstructs domains', () => {
  const source = legacyUser();
  const plan = buildUserV2Plan('user-1', source);
  const archive = buildArchiveDocuments('user-1', source);
  assert.equal(archive[0].data.sourceHash, canonicalHash(source));
  for (const document of archive.slice(1)) {
    assert.equal(document.data.payloadHash, canonicalHash(document.data.payload));
  }

  const reversed = materializeLegacyUser('user-1', plan.documents);
  assert.equal(reversed.stats.hpCurrent, source.stats.hpCurrent);
  assert.equal(reversed.stats.basePointsAvailable, source.stats.basePointsAvailable);
  assert.deepEqual(reversed.Parametri, source.Parametri);
  assert.equal(reversed.inventory.length, 3);
  assert.equal(reversed.inventory.find((item) => item.id === 'rope').qty, 3);
  assert.equal(reversed.spells.Flare.Costo, 2);
});

test('CLI defaults to dry-run and requires explicit project and approvals', () => {
  assert.throws(() => parseArguments([]), /Explicit --project/);
  const parsed = parseArguments(['--project', 'demo-fnd-perf']);
  assert.equal(parsed.execute, false);
  assert.equal(parsed.operation, 'backfill');
  assert.throws(
    () => parseArguments(['--project', 'demo-fnd-perf', '--operation', 'verify', '--execute']),
    /always read-only/
  );
  assert.deepEqual(parseArguments([
    '--project', 'demo-fnd-perf',
    '--drain-scope', 'global',
    '--drain-id', 'global-drain-01',
  ]).drain, {scope: 'global', drainId: 'global-drain-01'});
  assert.deepEqual(parseArguments([
    '--project', 'demo-fnd-perf',
    '--operation', 'verify',
    '--drain-scope', 'user',
    '--drain-user', 'private-user-id',
    '--drain-id', 'user-drain-01',
  ]).drain, {scope: 'user', drainId: 'user-drain-01', userId: 'private-user-id'});
  assert.deepEqual(parseArguments([
    '--project', 'demo-fnd-perf',
    '--operation', 'stabilize',
    '--pre-drain-scope', 'global',
  ]).preDrain, {scope: 'global'});
  assert.deepEqual(parseArguments([
    '--project', 'demo-fnd-perf',
    '--operation', 'backfill',
    '--pre-drain-scope', 'user',
    '--pre-drain-user', 'private-user-id',
  ]).preDrain, {scope: 'user', userId: 'private-user-id'});
  assert.throws(
    () => parseArguments(['--project', 'demo-fnd-perf', '--drain-scope', 'global']),
    /--drain-id/
  );
  assert.throws(
    () => parseArguments([
      '--project', 'demo-fnd-perf', '--drain-scope', 'user', '--drain-id', 'user-drain-01',
    ]),
    /--drain-user/
  );
  assert.throws(
    () => parseArguments([
      '--project', 'demo-fnd-perf', '--operation', 'archive',
      '--drain-scope', 'global', '--drain-id', 'global-drain-01',
    ]),
    /only valid for backfill sweeps and verification/
  );
  assert.throws(
    () => parseArguments([
      '--project', 'demo-fnd-perf', '--operation', 'verify',
      '--pre-drain-scope', 'global',
    ]),
    /only valid for stabilization and backfill/
  );
  assert.throws(
    () => parseArguments([
      '--project', 'demo-fnd-perf', '--operation', 'backfill',
      '--drain-scope', 'global', '--drain-id', 'global-drain-01',
      '--pre-drain-scope', 'global',
    ]),
    /mutually exclusive/
  );
});

test('target safety fails closed for live and mismatched project state', () => {
  const demo = {projectId: 'demo-fnd-perf', allowLiveProject: false, confirmProject: ''};
  assert.deepEqual(
    assertSafeTarget(demo, {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}),
    {live: false, emulatorHost: '127.0.0.1:8080', projectId: 'demo-fnd-perf'}
  );
  assert.throws(() => assertSafeTarget(demo, {}), /Live Firestore access is refused/);
  assert.throws(
    () => assertSafeTarget(demo, {
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      GCLOUD_PROJECT: 'another-project',
    }),
    /does not match/
  );
  assert.deepEqual(
    assertSafeTarget({projectId: 'fatins', allowLiveProject: true, confirmProject: 'fatins'}, {}),
    {live: true, emulatorHost: null, projectId: 'fatins'}
  );
  assert.throws(() => assertSafeTarget({
    projectId: 'fatins',
    allowLiveProject: true,
    confirmProject: 'fatins',
    operation: 'backfill',
    execute: true,
    drain: null,
  }, {}), /Live backfill execution requires an exact matching/);
  assert.deepEqual(assertSafeTarget({
    projectId: 'fatins',
    allowLiveProject: true,
    confirmProject: 'fatins',
    operation: 'backfill',
    execute: true,
    drain: {scope: 'global', drainId: 'global-drain-01'},
  }, {}), {live: true, emulatorHost: null, projectId: 'fatins'});
  assert.throws(() => assertSafeTarget({
    projectId: 'fatins',
    allowLiveProject: true,
    confirmProject: 'fatins',
    operation: 'stabilize',
    execute: true,
    preDrain: null,
  }, {}), /Live stabilization requires/);
  assert.deepEqual(assertSafeTarget({
    projectId: 'fatins',
    allowLiveProject: true,
    confirmProject: 'fatins',
    operation: 'stabilize',
    execute: true,
    preDrain: {scope: 'global'},
  }, {}), {live: true, emulatorHost: null, projectId: 'fatins'});
  assert.deepEqual(assertSafeTarget({
    projectId: 'demo-fnd-perf',
    allowLiveProject: false,
    confirmProject: '',
    operation: 'backfill',
    execute: true,
    drain: null,
  }, {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}), {
    live: false,
    emulatorHost: '127.0.0.1:8080',
    projectId: 'demo-fnd-perf',
  });
});

const fakeBackend = (
  users,
  {rolloutConfig = null, activeDeletionJobs = []} = {}
) => {
  const stored = new Map();
  const writes = [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  let currentRolloutConfig = rolloutConfig ? structuredClone(rolloutConfig) : null;
  let currentActiveDeletionJobs = structuredClone(activeDeletionJobs);
  const backend = {
    stored,
    writes,
    fetchUserPage: async ({afterDocumentId, limit}) => users
      .filter(({id}) => id > afterDocumentId)
      .slice(0, limit),
    fetchUserById: async (uid) => usersById.get(uid) || null,
    readUserDataRolloutConfig: async () => structuredClone(currentRolloutConfig),
    readActiveUserDeletionJobs: async () => structuredClone(
      currentActiveDeletionJobs.filter(({stage}) => stage !== 'completed')
    ),
    setActiveDeletionJobs: (value) => {
      currentActiveDeletionJobs = structuredClone(value);
    },
    setRolloutConfig: (value) => {
      currentRolloutConfig = structuredClone(value);
    },
    updateSource: (uid, patch) => {
      const user = usersById.get(uid);
      if (!user) throw new Error('missing fake source');
      Object.assign(user, patch);
    },
    assertDrainFence: async ({
      uid,
      drainFence,
      expectedSourceVersion,
      expectedLegacyProjectionHash,
      allowDeletionConflict = false,
    }) => {
      assertDrainFenceMatches(currentRolloutConfig, uid, drainFence);
      const user = usersById.get(uid);
      if (!user) throw new Error('drain-scoped source missing');
      if (expectedSourceVersion && String(user.updateTime || user.readTime || 'unknown') !== expectedSourceVersion) {
        throw new Error('Legacy source changed after the approved dry run.');
      }
      if (
        expectedLegacyProjectionHash
        && frozenLegacyProjectionHash(user.data || {}) !== expectedLegacyProjectionHash
      ) {
        throw new Error('Frozen legacy projection inputs changed after drain planning.');
      }
      const status = {
        deletionStatePending: user.data?.deletionState === 'pending',
        activeDeletionJob: currentActiveDeletionJobs.some(({targetUid, stage}) => (
          targetUid === uid && stage !== 'completed'
        )),
      };
      if (!allowDeletionConflict && (status.deletionStatePending || status.activeDeletionJob)) {
        throw new Error('active user deletion state or job');
      }
      return status;
    },
    assertPreDrainFence: async ({
      uid,
      preDrainFence,
      expectedSourceVersion,
      expectedLegacyProjectionHash,
      expectedSourceHash,
      allowDeletionConflict = false,
    }) => {
      assertPreDrainFenceMatches(currentRolloutConfig, uid, preDrainFence);
      const user = usersById.get(uid);
      if (!user) throw new Error('pre-drain-scoped source missing');
      if (expectedSourceVersion && String(user.updateTime || user.readTime || 'unknown') !== expectedSourceVersion) {
        throw new Error('Legacy source changed after the approved dry run.');
      }
      if (
        expectedLegacyProjectionHash
        && frozenLegacyProjectionHash(user.data || {}) !== expectedLegacyProjectionHash
      ) throw new Error('Frozen legacy projection inputs changed after pre-drain planning.');
      if (expectedSourceHash && canonicalHash(user.data || {}) !== expectedSourceHash) {
        throw new Error('Legacy source changed after the approved dry run.');
      }
      const status = {
        deletionStatePending: user.data?.deletionState === 'pending',
        activeDeletionJob: currentActiveDeletionJobs.some(({targetUid, stage}) => (
          targetUid === uid && stage !== 'completed'
        )),
      };
      if (!allowDeletionConflict && (status.deletionStatePending || status.activeDeletionJob)) {
        throw new Error('active user deletion state or job');
      }
      return status;
    },
    readDocuments: async (paths) => paths.map((path) => ({path, data: stored.get(path)})),
    readUserV2Documents: async (uid) => [...stored.entries()]
      .filter(([path]) => path === `users/${uid}` || path.startsWith(`users/${uid}/`))
      .map(([path, data]) => ({path, data})),
    writeUserV2Documents: async ({
      uid,
      documents,
      cleanupPaths = [],
      expectedSourceVersion,
      expectedLegacyProjectionHash,
      drainFence,
      preDrainFence,
    }) => {
      if (drainFence || preDrainFence) {
        const assertFence = drainFence ? backend.assertDrainFence : backend.assertPreDrainFence;
        await assertFence({
          uid,
          ...(drainFence ? {drainFence} : {preDrainFence}),
          expectedSourceVersion,
          expectedLegacyProjectionHash,
        });
      }
      writes.push({operation: 'backfill', uid, expectedSourceVersion, cleanupPaths, drainFence, preDrainFence});
      documents.forEach(({path, data}) => stored.set(path, data));
      cleanupPaths.forEach((documentPath) => {
        if (stored.get(documentPath)?.legacyManaged === true) stored.delete(documentPath);
      });
    },
    writeLegacyContentIdentities: async ({
      uid,
      identities,
      expectedSourceVersion,
      expectedSourceHash,
      expectedLegacyProjectionHash,
      preDrainFence,
    }) => {
      if (preDrainFence) {
        await backend.assertPreDrainFence({
          uid,
          preDrainFence,
          expectedSourceVersion,
          expectedSourceHash,
          expectedLegacyProjectionHash,
        });
      }
      const user = usersById.get(uid);
      if (!user || canonicalHash(user.data || {}) !== expectedSourceHash) {
        throw new Error('Legacy source changed after the approved dry run.');
      }
      user.data = {
        ...user.data,
        ...(identities.spells !== undefined ? {spells: structuredClone(identities.spells)} : {}),
        ...(identities.tecniche !== undefined ? {tecniche: structuredClone(identities.tecniche)} : {}),
      };
      user.updateTime = `${expectedSourceVersion}:stabilized`;
      writes.push({operation: 'stabilize', uid, preDrainFence});
    },
    writeArchiveDocuments: async ({uid, documents}) => {
      writes.push({operation: 'archive', uid});
      documents.forEach(({path, data}) => stored.set(path, data));
    },
    mergeLegacyUser: async ({uid, legacyData, expectedV2Hash}) => {
      const currentV2 = [...stored.entries()]
        .filter(([path]) => path === `users/${uid}` || path.startsWith(`users/${uid}/`))
        .map(([path, data]) => ({path, data}));
      if (hashDocumentSet(currentV2) !== expectedV2Hash) throw new Error('reverse precondition changed');
      writes.push({operation: 'reverse', uid});
      stored.set(`legacy/${uid}`, legacyData);
    },
    readLegacyUser: async (uid) => stored.get(`legacy/${uid}`) ?? usersById.get(uid)?.data ?? null,
  };
  return backend;
};

const DRAIN_CLOSED_AT = {seconds: 1_800_000_000, nanoseconds: 123456789};
const drainConfig = ({
  stage = 'dual-write',
  overrides = {},
  globalDrainId = 'global-drain-01',
  userDrains = {},
  closedAt = DRAIN_CLOSED_AT,
} = {}) => ({
  stage,
  userOverrides: overrides,
  legacyDrain: {
    global: {drainId: globalDrainId, closedAt},
    users: Object.fromEntries(Object.entries(userDrains).map(([uid, drainId]) => [
      uid,
      {drainId, closedAt},
    ])),
  },
});

test('pre-drain stage matrix permits only exact shadow-verify rollout scopes', async () => {
  const users = [{id: 'a', data: legacyUser(), updateTime: 'v1'}];
  for (const stage of [
    'legacy-read',
    'dual-write',
    'new-read-dual-write',
    'new-only',
  ]) {
    await assert.rejects(buildMigrationPlan({
      backend: fakeBackend(users, {rolloutConfig: drainConfig({stage})}),
      operation: 'backfill',
      projectId: 'demo-fnd-perf',
      preDrain: {scope: 'global'},
    }), /exact shadow-verify/);
  }

  const allowed = await buildMigrationPlan({
    backend: fakeBackend(users, {
      rolloutConfig: drainConfig({stage: 'shadow-verify'}),
    }),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'global'},
  });
  assert.equal(allowed.report.preDrain.rolloutStage, 'shadow-verify');
  assert.equal(allowed.report.counts.errors, 0);

  await assert.rejects(buildMigrationPlan({
    backend: fakeBackend(users, {
      rolloutConfig: drainConfig({
        stage: 'shadow-verify',
        overrides: {a: 'dual-write'},
      }),
    }),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'user', userId: 'a'},
  }), /exact shadow-verify/);
  const userAllowed = await buildMigrationPlan({
    backend: fakeBackend(users, {
      rolloutConfig: drainConfig({
        stage: 'legacy-read',
        overrides: {a: 'shadow-verify'},
      }),
    }),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'user', userId: 'a'},
  });
  assert.deepEqual(userAllowed.entries.map(({id}) => id), ['a']);
  assert.match(userAllowed.report.preDrain.subjectHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(userAllowed.report), /"a"/);
});

test('stabilization stamps offline-compatible content IDs before fenced backfill', async () => {
  const uid = 'private-stabilize-user';
  const source = legacyUser({
    spells: {Flare: {Costo: 2, imagePath: 'users/private/spell.png'}},
    tecniche: [{nome: 'Dash', Costo: 1}],
  });
  const originalPlan = buildUserV2Plan(uid, source);
  const originalSpellId = originalPlan.documents
    .find(({path}) => path.startsWith(`users/${uid}/spells/`))
    .path.split('/').at(-1);
  const backend = fakeBackend([
    {id: uid, data: source, updateTime: 'v1'},
  ], {rolloutConfig: drainConfig({stage: 'shadow-verify'})});

  const blockedBackfill = await buildMigrationPlan({
    backend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'global'},
  });
  assert.equal(
    blockedBackfill.report.subjects[0].issues.codes.includes(
      'personal-content-identity-not-stabilized'
    ),
    true
  );

  const stabilize = await buildMigrationPlan({
    backend,
    operation: 'stabilize',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'global'},
  });
  assert.equal(stabilize.report.counts.errors, 0);
  assert.equal(stabilize.report.counts.writesRequired, 1);
  assert.equal(stabilize.entries[0].legacyContentIdentities.spells.Flare.id, originalSpellId);
  assert.doesNotMatch(JSON.stringify(stabilize.report), new RegExp(uid));
  await executeMigrationPlan({
    backend,
    options: {operation: 'stabilize', projectId: 'demo-fnd-perf'},
    plan: stabilize,
  });
  const stamped = await backend.readLegacyUser(uid);
  assert.equal(stamped.spells.Flare.id, originalSpellId);
  assert.match(stamped.tecniche[0].id, /^tecnica_[a-f0-9]{32}$/);

  const backfill = await buildMigrationPlan({
    backend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'global'},
  });
  assert.equal(backfill.report.counts.errors, 0);
  assert.equal(
    backfill.entries[0].expectedDocuments.some(({path}) => (
      path === `users/${uid}/spells/${originalSpellId}`
    )),
    true
  );
});

test('pre-drain execution and checkpoints stay bound to stage, scope, and source', async () => {
  const user = {id: 'a', data: legacyUser(), updateTime: 'v1'};
  const shadowConfig = drainConfig({stage: 'shadow-verify'});
  const backend = fakeBackend([user], {rolloutConfig: shadowConfig});
  const plan = await buildMigrationPlan({
    backend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    preDrain: {scope: 'global'},
  });
  const options = {operation: 'backfill', projectId: 'demo-fnd-perf'};

  backend.setRolloutConfig(drainConfig({stage: 'dual-write'}));
  await assert.rejects(
    executeMigrationPlan({backend, options, plan}),
    /exact shadow-verify/
  );
  assert.equal(backend.writes.length, 0);

  backend.setRolloutConfig(shadowConfig);
  backend.updateSource('a', {updateTime: 'v2'});
  await assert.rejects(
    executeMigrationPlan({backend, options, plan}),
    /Legacy source changed/
  );
  assert.equal(backend.writes.length, 0);

  backend.updateSource('a', {updateTime: 'v1'});
  backend.setRolloutConfig(drainConfig({
    stage: 'shadow-verify',
    overrides: {a: 'shadow-verify'},
  }));
  await assert.rejects(
    executeMigrationPlan({backend, options, plan}),
    /pre-drain rollout scope|inherits/
  );
  assert.equal(backend.writes.length, 0);

  backend.setRolloutConfig(shadowConfig);
  const checkpoints = [];
  await executeMigrationPlan({
    backend,
    options,
    plan,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });
  assert.deepEqual(checkpoints[0].preDrain, plan.report.preDrain);
  assert.equal(assertCheckpoint(checkpoints[0], plan, options), checkpoints[0]);
  assert.throws(
    () => assertCheckpoint({
      ...checkpoints[0],
      preDrain: {...checkpoints[0].preDrain, rolloutStage: 'dual-write'},
    }, plan, options),
    /does not match/
  );
});

test('global and user drain plans select only their exact rollout scopes and stay redacted', async () => {
  const users = [
    {id: 'a-private-uid', data: legacyUser({characterId: 'Alpha'}), updateTime: 'v1'},
    {id: 'b-private-uid', data: legacyUser({characterId: 'Bravo'}), updateTime: 'v2'},
    {id: 'c-private-uid', data: legacyUser({characterId: 'Charlie'}), updateTime: 'v3'},
  ];
  const config = drainConfig({
    overrides: {'b-private-uid': 'new-read-dual-write'},
    userDrains: {'b-private-uid': 'user-drain-01'},
  });
  const globalBackend = fakeBackend(users, {rolloutConfig: config});
  const globalPlan = await buildMigrationPlan({
    backend: globalBackend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.deepEqual(globalPlan.entries.map(({id}) => id), ['a-private-uid', 'c-private-uid']);
  assert.equal(globalPlan.report.complete, true);
  assert.equal(globalPlan.report.drain.scope, 'global');
  assert.deepEqual(globalPlan.report.drain.closedAt, DRAIN_CLOSED_AT);
  assert.match(globalPlan.report.drain.scopeFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(globalPlan.report.subjects.every(({legacyProjectionHash}) => (
    /^[a-f0-9]{64}$/.test(legacyProjectionHash)
  )), true);
  assert.doesNotMatch(JSON.stringify(globalPlan.report), /a-private-uid|b-private-uid|c-private-uid/);

  const userBackend = fakeBackend(users, {rolloutConfig: config});
  const userPlan = await buildMigrationPlan({
    backend: userBackend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'user', userId: 'b-private-uid', drainId: 'user-drain-01'},
  });
  assert.deepEqual(userPlan.entries.map(({id}) => id), ['b-private-uid']);
  assert.equal(userPlan.report.drain.scope, 'user');
  assert.match(userPlan.report.drain.subjectHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(userPlan.report), /b-private-uid/);
});

test('drain planning rejects malformed, mismatched, inactive, and unscoped fences', async () => {
  const users = [{id: 'a', data: legacyUser(), updateTime: 'v1'}];
  await assert.rejects(buildMigrationPlan({
    backend: fakeBackend(users, {rolloutConfig: drainConfig()}),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'another-drain'},
  }), /does not match/);
  await assert.rejects(buildMigrationPlan({
    backend: fakeBackend(users, {rolloutConfig: drainConfig({stage: 'legacy-read'})}),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  }), /bridge-active stage or the sealed new-only/);
  const malformed = drainConfig();
  malformed.legacyDrain.global.closedAt = '2026-01-01T00:00:00Z';
  await assert.rejects(buildMigrationPlan({
    backend: fakeBackend(users, {rolloutConfig: malformed}),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  }), /Firestore closedAt timestamp/);
  await assert.rejects(buildMigrationPlan({
    backend: fakeBackend(users, {rolloutConfig: drainConfig({
      userDrains: {a: 'user-drain-01'},
    })}),
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'user', userId: 'a', drainId: 'user-drain-01'},
  }), /explicit valid rollout override/);
});

test('sealed new-only verification remains bound to the installed drain', async () => {
  const source = legacyUser();
  const users = [{id: 'a', data: source, updateTime: 'v1'}];
  const backend = fakeBackend(users, {rolloutConfig: drainConfig({stage: 'new-only'})});
  buildUserV2Plan('a', source).documents.forEach(({path, data}) => backend.stored.set(path, data));
  const plan = await buildMigrationPlan({
    backend,
    operation: 'verify',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.equal(plan.report.complete, true);
  assert.equal(plan.report.counts.errors, 0);
  assert.equal(plan.report.drain.rolloutStage, 'new-only');
  assert.equal(plan.report.subjects[0].legacyProjectionHash, frozenLegacyProjectionHash(source));
});

test('drain reports refuse pending deletions and active deletion jobs without exposing UIDs', async () => {
  const pendingUid = 'pending-private-uid';
  const pendingSource = legacyUser({deletionState: 'pending'});
  const pendingBackend = fakeBackend([
    {id: pendingUid, data: pendingSource, updateTime: 'v1'},
  ], {rolloutConfig: drainConfig({stage: 'new-only'})});
  buildUserV2Plan(pendingUid, pendingSource).documents.forEach(({path, data}) => (
    pendingBackend.stored.set(path, data)
  ));
  const pendingPlan = await buildMigrationPlan({
    backend: pendingBackend,
    operation: 'verify',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.equal(pendingPlan.report.counts.errors > 0, true);
  assert.equal(pendingPlan.report.counts.deletionConflicts, 1);
  assert.deepEqual(pendingPlan.report.drainEvidence.codes, ['drain-deletion-state-pending']);
  assert.equal(
    pendingPlan.report.subjects[0].issues.codes.includes('drain-deletion-state-pending'),
    true
  );
  assert.doesNotMatch(JSON.stringify(pendingPlan.report), new RegExp(pendingUid));

  const activeUid = 'active-delete-private-uid';
  const activeBackend = fakeBackend([
    {id: activeUid, data: legacyUser(), updateTime: 'v1'},
  ], {
    rolloutConfig: drainConfig(),
    activeDeletionJobs: [{targetUid: activeUid, stage: 'media-verified'}],
  });
  const activePlan = await buildMigrationPlan({
    backend: activeBackend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.equal(activePlan.report.counts.errors > 0, true);
  assert.equal(activePlan.report.counts.deletionConflicts, 1);
  assert.deepEqual(activePlan.report.drainEvidence.codes, ['drain-deletion-job-active']);
  assert.match(activePlan.report.drainEvidence.deletionJobFingerprint, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(activePlan.report), new RegExp(activeUid));
  await assert.rejects(
    executeMigrationPlan({
      backend: activeBackend,
      options: {operation: 'backfill', projectId: 'demo-fnd-perf'},
      plan: activePlan,
    }),
    /blocked by unresolved plan errors/
  );

  const missingUid = 'already-removed-private-uid';
  const missingBackend = fakeBackend([
    {id: 'remaining-user', data: legacyUser(), updateTime: 'v1'},
  ], {
    rolloutConfig: drainConfig(),
    activeDeletionJobs: [{targetUid: missingUid, stage: 'firestore-verified'}],
  });
  const missingPlan = await buildMigrationPlan({
    backend: missingBackend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.equal(missingPlan.report.counts.deletionConflicts, 1);
  assert.equal(missingPlan.report.counts.errors > 0, true);
  assert.doesNotMatch(JSON.stringify(missingPlan.report), new RegExp(missingUid));

  const missingUserBackend = fakeBackend([], {
    rolloutConfig: drainConfig({
      overrides: {[missingUid]: 'new-only'},
      userDrains: {[missingUid]: 'user-drain-01'},
    }),
    activeDeletionJobs: [{targetUid: missingUid, stage: 'firestore-verified'}],
  });
  const missingUserPlan = await buildMigrationPlan({
    backend: missingUserBackend,
    operation: 'verify',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'user', userId: missingUid, drainId: 'user-drain-01'},
  });
  assert.equal(missingUserPlan.report.counts.users, 0);
  assert.equal(missingUserPlan.report.counts.deletionConflicts, 1);
  assert.equal(missingUserPlan.report.counts.errors, 1);
  assert.doesNotMatch(JSON.stringify(missingUserPlan.report), new RegExp(missingUid));
});

test('a deletion job starting after approval aborts drain execution before writes', async () => {
  const uid = 'race-private-uid';
  const backend = fakeBackend([
    {id: uid, data: legacyUser(), updateTime: 'v1'},
  ], {rolloutConfig: drainConfig()});
  const plan = await buildMigrationPlan({
    backend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.equal(plan.report.counts.errors, 0);
  backend.setActiveDeletionJobs([{targetUid: uid, stage: 'pending'}]);
  await assert.rejects(executeMigrationPlan({
    backend,
    options: {operation: 'backfill', projectId: 'demo-fnd-perf'},
    plan,
  }), /active or changed user deletion job/);
  assert.equal(backend.writes.length, 0);
});

test('drain execution and checkpoints fail closed when the fence, scope, or source changes', async () => {
  const user = {id: 'a', data: legacyUser(), updateTime: 'v1'};
  const originalConfig = drainConfig();
  const backend = fakeBackend([user], {rolloutConfig: originalConfig});
  const plan = await buildMigrationPlan({
    backend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  const options = {operation: 'backfill', projectId: 'demo-fnd-perf'};

  backend.setRolloutConfig(drainConfig({closedAt: {seconds: DRAIN_CLOSED_AT.seconds + 1, nanoseconds: 0}}));
  await assert.rejects(executeMigrationPlan({backend, options, plan}), /drain fence|does not match/);
  assert.equal(backend.writes.length, 0);

  backend.setRolloutConfig(originalConfig);
  backend.updateSource('a', {updateTime: 'v2'});
  await assert.rejects(executeMigrationPlan({backend, options, plan}), /Legacy source changed/);
  assert.equal(backend.writes.length, 0);

  backend.updateSource('a', {updateTime: 'v1'});
  backend.setRolloutConfig(drainConfig({overrides: {a: 'dual-write'}}));
  await assert.rejects(executeMigrationPlan({backend, options, plan}), /drain fence|scope changed|inherits/);
  assert.equal(backend.writes.length, 0);

  backend.setRolloutConfig(originalConfig);
  const checkpoints = [];
  await executeMigrationPlan({
    backend,
    options,
    plan,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });
  assert.equal(checkpoints.length, 1);
  assert.deepEqual(checkpoints[0].drain, plan.report.drain);
  assert.equal(assertCheckpoint(checkpoints[0], plan, options), checkpoints[0]);
  assert.throws(
    () => assertCheckpoint({
      ...checkpoints[0],
      drain: {...checkpoints[0].drain, drainId: 'tampered-drain'},
    }, plan, options),
    /does not match/
  );
});

test('drain attestations hash frozen legacy inputs without treating safe shell fields as legacy state', async () => {
  const source = legacyUser();
  assert.equal(
    frozenLegacyProjectionHash({...source, email: 'changed-shell@example.test', imageUrl: 'new-shell-image'}),
    frozenLegacyProjectionHash(source)
  );
  assert.notEqual(
    frozenLegacyProjectionHash({...source, stats: {...source.stats, hpCurrent: 999}}),
    frozenLegacyProjectionHash(source)
  );

  const users = [
    {id: 'a', data: source, updateTime: 'v1'},
    {id: 'b', data: legacyUser({characterId: 'Bravo'}), updateTime: 'v2'},
  ];
  const backend = fakeBackend(users, {rolloutConfig: drainConfig()});
  const limited = await buildMigrationPlan({
    backend,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    maxUsers: 1,
    drain: {scope: 'global', drainId: 'global-drain-01'},
  });
  assert.equal(limited.report.counts.users, 1);
  assert.equal(limited.report.complete, false);
});

test('dry-run plans are ordered, redacted, deterministic, and do not write', async () => {
  const backend = fakeBackend([
    {id: 'a-private-uid', data: legacyUser({characterId: 'Alpha'}), updateTime: 'v1'},
    {id: 'b-private-uid', data: legacyUser({characterId: 'Bravo'}), updateTime: 'v2'},
  ]);
  const first = await buildMigrationPlan({backend, operation: 'backfill', projectId: 'demo-fnd-perf'});
  const second = await buildMigrationPlan({backend, operation: 'backfill', projectId: 'demo-fnd-perf'});
  assert.equal(first.report.planFingerprint, second.report.planFingerprint);
  assert.equal(first.report.counts.users, 2);
  assert.equal(backend.writes.length, 0);
  const serialized = JSON.stringify(first.report);
  assert.doesNotMatch(serialized, /a-private-uid|b-private-uid|private@example/);
  assert.equal(first.report.subjects.every(({subjectHash}) => /^[a-f0-9]{64}$/.test(subjectHash)), true);
});

test('execution requires the exact error-free report and approved fingerprint', async () => {
  const backend = fakeBackend([{id: 'a', data: legacyUser(), updateTime: 'v1'}]);
  const plan = await buildMigrationPlan({backend, operation: 'backfill', projectId: 'demo-fnd-perf'});
  const options = {
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    approveFingerprint: plan.report.planFingerprint,
  };
  assert.equal(assertApprovedReport(plan.report, plan, options), plan.report);
  assert.throws(
    () => assertApprovedReport(plan.report, plan, {...options, approveFingerprint: '0'.repeat(64)}),
    /exactly match/
  );
  assert.throws(
    () => assertApprovedReport({...plan.report, complete: false}, plan, options),
    /exact completed/
  );
});

test('execution checkpoints only after verified writes and resumes after the exact cursor', async () => {
  const users = [
    {id: 'a', data: legacyUser({characterId: 'Alpha'}), updateTime: 'v1'},
    {id: 'b', data: legacyUser({characterId: 'Bravo'}), updateTime: 'v2'},
  ];
  const backend = fakeBackend(users);
  const plan = await buildMigrationPlan({backend, operation: 'backfill', projectId: 'demo-fnd-perf'});
  const checkpoints = [];
  const options = {operation: 'backfill', projectId: 'demo-fnd-perf'};
  const result = await executeMigrationPlan({
    backend,
    options,
    plan,
    onCheckpoint: async (checkpoint) => checkpoints.push(checkpoint),
  });
  assert.deepEqual(result, {processed: 2, complete: true});
  assert.deepEqual(backend.writes.map(({uid}) => uid), ['a', 'b']);
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[1].complete, true);

  const resumedBackend = fakeBackend(users);
  plan.entries[0].expectedDocuments.forEach(({path, data}) => resumedBackend.stored.set(path, data));
  const checkpoint = checkpoints[0];
  assert.equal(assertCheckpoint(checkpoint, plan, options), checkpoint);
  await executeMigrationPlan({
    backend: resumedBackend,
    options: {...options, resumeCheckpoint: checkpoint},
    plan,
  });
  assert.deepEqual(resumedBackend.writes.map(({uid}) => uid), ['b']);
});

test('archive planning blocks until V2 documents verify', async () => {
  const backend = fakeBackend([{id: 'a', data: legacyUser(), updateTime: 'v1'}]);
  const blocked = await buildMigrationPlan({backend, operation: 'archive', projectId: 'demo-fnd-perf'});
  assert.equal(blocked.report.counts.errors > 0, true);
  assert.equal(blocked.report.subjects[0].issues.codes.includes('v2-not-verified'), true);

  const v2 = buildUserV2Plan('a', legacyUser());
  v2.documents.forEach(({path, data}) => backend.stored.set(path, data));
  const allowed = await buildMigrationPlan({backend, operation: 'archive', projectId: 'demo-fnd-perf'});
  assert.equal(allowed.report.counts.errors, 0);
});

test('owned V2 verification is exact while legacy root and operational metadata remain allowed', async () => {
  const source = legacyUser({customLegacyField: {kept: true}});
  const expected = buildUserV2Plan('a', source);
  const actual = expected.documents.map(({path, data}) => ({path, data: structuredClone(data)}));
  const root = actual.find(({path}) => path === 'users/a');
  root.data = {...source, ...root.data, updatedAt: 'server-time', updatedBy: 'migration'};
  const progression = actual.find(({path}) => path.endsWith('/state/progression'));
  progression.data.updatedAt = 'server-time';
  progression.data.updatedBy = 'legacy-bridge';
  progression.data.revision = 9;
  actual.push({
    path: 'users/a/inventory/manual-command-item',
    data: {legacyManaged: false, displayName: 'Manual'},
  });

  const clean = inspectOwnedV2Projection({
    uid: 'a',
    actualDocuments: actual,
    expectedDocuments: expected.documents,
    legacyRootData: source,
  });
  assert.equal(clean.verified, true);
  assert.equal(clean.currentHash, expected.targetHash);

  progression.data.stats.unexpectedProgressionValue = 123;
  actual.push({
    path: 'users/a/inventory/stale-migration-item',
    data: {legacyManaged: true, displayName: 'Stale'},
  });
  const drifted = inspectOwnedV2Projection({
    uid: 'a',
    actualDocuments: actual,
    expectedDocuments: expected.documents,
    legacyRootData: source,
  });
  assert.equal(drifted.verified, false);
  assert.deepEqual(drifted.cleanupPaths, ['users/a/inventory/stale-migration-item']);
  assert.equal(drifted.issues.some(({code}) => code === 'v2-unexpected-field'), true);
  assert.equal(drifted.issues.some(({code}) => code === 'v2-stale-owned-document'), true);

  const backend = fakeBackend([{id: 'a', data: source, updateTime: 'v1'}]);
  actual.forEach(({path, data}) => backend.stored.set(path, data));
  const verification = await buildMigrationPlan({
    backend,
    operation: 'verify',
    projectId: 'demo-fnd-perf',
  });
  assert.equal(verification.report.counts.errors > 0, true);
  assert.equal(verification.report.subjects[0].issues.codes.includes('v2-unexpected-field'), true);
  assert.equal(verification.report.subjects[0].issues.codes.includes('v2-stale-owned-document'), true);
});

test('backfill cleanup converges stale migration-owned documents without deleting unowned documents', async () => {
  const source = legacyUser();
  const backend = fakeBackend([{id: 'a', data: source, updateTime: 'v1'}]);
  const expected = buildUserV2Plan('a', source);
  expected.documents.forEach(({path, data}) => backend.stored.set(path, structuredClone(data)));
  backend.stored.set('users/a/inventory/stale-owned', {legacyManaged: true, displayName: 'Old'});
  backend.stored.set('users/a/inventory/unowned', {legacyManaged: false, displayName: 'Keep'});

  const plan = await buildMigrationPlan({backend, operation: 'backfill', projectId: 'demo-fnd-perf'});
  assert.equal(plan.report.counts.errors, 0);
  assert.equal(plan.report.counts.cleanupDocuments, 1);
  assert.equal(plan.entries[0].cleanupPaths[0], 'users/a/inventory/stale-owned');
  await executeMigrationPlan({
    backend,
    options: {operation: 'backfill', projectId: 'demo-fnd-perf'},
    plan,
  });
  assert.equal(backend.stored.has('users/a/inventory/stale-owned'), false);
  assert.equal(backend.stored.has('users/a/inventory/unowned'), true);
});

test('personal-content migration emits callable-safe IDs and blocks missing or duplicate exact names', async () => {
  const source = legacyUser({
    spells: [
      {id: 'à-invalid-id', nome: 'Same Name', Costo: 1},
      {id: 'valid-id', nome: 'Same Name', Costo: 2},
      {id: 'also-valid'},
    ],
    tecniche: {},
  });
  const transformed = buildUserV2Plan('a', source);
  const spells = transformed.documents.filter(({path}) => path.startsWith('users/a/spells/'));
  assert.equal(spells.every(({path}) => PERSONAL_CONTENT_ID_PATTERN.test(path.split('/').pop())), true);
  assert.equal(new Set(spells.map(({path}) => path)).size, spells.length);
  assert.equal(transformed.issues.some(({code}) => code === 'personal-content-id-replaced'), true);
  assert.equal(transformed.issues.some(({code}) => code === 'personal-content-exact-name-duplicate'), true);
  assert.equal(transformed.issues.some(({code}) => code === 'personal-content-name-missing'), true);
  assert.equal(new Set(
    transformed.documents.filter(({path}) => path.includes('/content_names/')).map(({path}) => path)
  ).size, 1);

  const backend = fakeBackend([{id: 'a', data: source, updateTime: 'v1'}]);
  const plan = await buildMigrationPlan({backend, operation: 'backfill', projectId: 'demo-fnd-perf'});
  assert.equal(plan.report.counts.errors, 2);
  await assert.rejects(
    executeMigrationPlan({
      backend,
      options: {operation: 'backfill', projectId: 'demo-fnd-perf'},
      plan,
    }),
    /blocked by unresolved plan errors/
  );
});

test('source changes and interrupted execution checkpoint only verified subjects', async () => {
  const users = [
    {id: 'a', data: legacyUser({characterId: 'Alpha'}), updateTime: 'v1'},
    {id: 'b', data: legacyUser({characterId: 'Bravo'}), updateTime: 'v2'},
  ];
  const sourceChanged = fakeBackend(users.slice(0, 1));
  const changedPlan = await buildMigrationPlan({
    backend: sourceChanged,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
  });
  sourceChanged.writeUserV2Documents = async () => {
    throw new Error('Legacy source changed after the approved dry run.');
  };
  const changedCheckpoints = [];
  await assert.rejects(executeMigrationPlan({
    backend: sourceChanged,
    options: {operation: 'backfill', projectId: 'demo-fnd-perf'},
    plan: changedPlan,
    onCheckpoint: async (checkpoint) => changedCheckpoints.push(checkpoint),
  }), /source changed/);
  assert.equal(changedCheckpoints.length, 0);

  const interrupted = fakeBackend(users);
  const interruptedPlan = await buildMigrationPlan({
    backend: interrupted,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
  });
  let firstCheckpoint;
  await assert.rejects(executeMigrationPlan({
    backend: interrupted,
    options: {operation: 'backfill', projectId: 'demo-fnd-perf'},
    plan: interruptedPlan,
    onCheckpoint: async (checkpoint) => {
      firstCheckpoint = checkpoint;
      throw new Error('simulated interruption');
    },
  }), /simulated interruption/);
  assert.equal(firstCheckpoint.lastDocumentId, 'a');
  const resumedPlan = await buildMigrationPlan({
    backend: interrupted,
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
  });
  assert.notEqual(resumedPlan.report.planFingerprint, interruptedPlan.report.planFingerprint);
  const resumeOptions = {
    operation: 'backfill',
    projectId: 'demo-fnd-perf',
    approveFingerprint: interruptedPlan.report.planFingerprint,
    resumeCheckpoint: assertCheckpoint(firstCheckpoint, interruptedPlan.report, {
      operation: 'backfill',
      projectId: 'demo-fnd-perf',
    }),
    approvedPlanFingerprint: interruptedPlan.report.planFingerprint,
  };
  assert.equal(
    assertApprovedReport(interruptedPlan.report, resumedPlan, resumeOptions),
    interruptedPlan.report
  );
  await executeMigrationPlan({
    backend: interrupted,
    options: resumeOptions,
    plan: resumedPlan,
  });
  assert.deepEqual(interrupted.writes.map(({uid}) => uid), ['a', 'b']);
});

test('reverse materialization fences the complete V2 snapshot and rejects a race', async () => {
  const source = legacyUser();
  const backend = fakeBackend([{id: 'a', data: source, updateTime: 'v1'}]);
  const v2 = buildUserV2Plan('a', source);
  v2.documents.forEach(({path, data}) => backend.stored.set(path, structuredClone(data)));
  // Reverse reads the complete V2 view and validates content/name reservations.
  const plan = await buildMigrationPlan({backend, operation: 'reverse', projectId: 'demo-fnd-perf'});
  assert.equal(plan.report.counts.errors, 0);
  assert.equal(plan.entries[0].v2PreconditionHash, hashDocumentSet(await backend.readUserV2Documents('a')));

  const resourcesPath = 'users/a/state/resources';
  backend.stored.get(resourcesPath).stats.gold += 1;
  await assert.rejects(executeMigrationPlan({
    backend,
    options: {operation: 'reverse', projectId: 'demo-fnd-perf'},
    plan,
  }), /reverse precondition changed/);
  assert.equal(backend.stored.has('legacy/a'), false);
});

test('reverse planning reports duplicate names and missing reservations instead of materializing last-write-wins', async () => {
  const source = legacyUser();
  const backend = fakeBackend([{id: 'a', data: source, updateTime: 'v1'}]);
  const v2 = buildUserV2Plan('a', source);
  v2.documents.forEach(({path, data}) => backend.stored.set(path, structuredClone(data)));
  const firstSpell = [...backend.stored.entries()].find(([path]) => path.startsWith('users/a/spells/'));
  backend.stored.set('users/a/spells/second-safe-id', {
    ...structuredClone(firstSpell[1]),
    id: 'second-safe-id',
  });
  for (const path of [...backend.stored.keys()]) {
    if (path.startsWith('users/a/content_names/')) backend.stored.delete(path);
  }
  const plan = await buildMigrationPlan({backend, operation: 'reverse', projectId: 'demo-fnd-perf'});
  assert.equal(plan.report.counts.errors > 0, true);
  const codes = plan.report.subjects[0].issues.codes;
  assert.equal(codes.includes('reverse-content-exact-name-duplicate'), true);
  assert.equal(codes.includes('reverse-content-reservation-missing'), true);
});
