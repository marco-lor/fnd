const assert = require('node:assert/strict');
const {after, before, test} = require('node:test');
const {deleteApp, initializeApp} = require('firebase-admin/app');
const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require('firebase-admin/firestore');
const {getStorage} = require('firebase-admin/storage');
const callableManifest = require('../../src/data/functions/callableManifest.json');
const {
  PERFORMANCE_ENVIRONMENT_MODE,
  PERFORMANCE_PROJECT_ID,
  configureOwnedPerformanceEnvironment,
} = require('../../scripts/performance/common');
const {
  withBackgroundTriggersDisabled,
} = require('../../scripts/performance/emulator-control');

const SCALE_USER_COUNT = 525;
const OPERATION_ID = 'task06-scale-resume-0001';
const TOKEN_OPERATION_ID = 'task06-token-scale-0001';
const TOKEN_INSTANCE_COUNT = 520;
const PAGED_DELETE_COUNT = 101;
const LOCK_OPERATION_ID = 'task06-lock-scale-0001';
const NPC_OPERATION_ID = 'task06-delete-npc-0001';
const ENCOUNTER_OPERATION_ID = 'task06-delete-encounter-0001';
const FOE_OPERATION_ID = 'task06-duplicate-foe-0001';
const TERMINAL_STATUSES = new Set([
  'paused',
  'completed',
  'failed',
  'cleanup-pending',
]);
const functionRegion = (functionId) => (
  functionId === 'deleteGrigliataCustomToken'
    ? 'europe-west1'
    : 'europe-west8'
);

let app;
let db;
let actor;

const delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const flattenLeaves = (value, prefix = '', output = {}) => {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || value instanceof Timestamp
  ) {
    output[prefix] = value;
    return output;
  }
  const entries = Object.entries(value);
  if (!entries.length) {
    output[prefix] = value;
    return output;
  }
  entries.forEach(([key, nested]) => {
    flattenLeaves(nested, prefix ? `${prefix}.${key}` : key, output);
  });
  return output;
};

const changedLeafPaths = (beforeValue, afterValue) => {
  const before = flattenLeaves(beforeValue);
  const after = flattenLeaves(afterValue);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
};

const fetchWithDeadline = async (
  url,
  init,
  timeoutMs = 30_000
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    return await fetch(url, {...init, signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
};

const createDmActor = async () => {
  const response = await fetchWithDeadline(
    'http://127.0.0.1:9099/'
      + 'identitytoolkit.googleapis.com/v1/accounts:signUp'
      + '?key=demo-api-key',
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        email: 'task06-integration-dm@example.test',
        password: 'Task06Integration!123',
        returnSecureToken: true,
      }),
    }
  );
  const body = await response.json();
  assert.equal(
    response.ok,
    true,
    `Auth emulator sign-up failed: ${JSON.stringify(body)}`
  );
  assert.ok(body.localId);
  assert.ok(body.idToken);
  return {uid: body.localId, idToken: body.idToken};
};

const invokeCallable = async (functionId, data) => {
  const response = await fetchWithDeadline(
    `http://127.0.0.1:5001/${PERFORMANCE_PROJECT_ID}/`
      + `${functionRegion(functionId)}/${functionId}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${actor.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({data}),
    },
    60_000
  );
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(
      `${functionId} failed with HTTP ${response.status}: `
      + JSON.stringify(body.error || body)
    );
  }
  return body.data ?? body.result;
};

const waitForOperation = async (
  operationId,
  expectedStatuses,
  timeoutMs = 240_000
) => {
  const expected = new Set(expectedStatuses);
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await invokeCallable('getBackendOperationStatus', {
      operationId,
    });
    if (expected.has(latest.status)) return latest;
    if (TERMINAL_STATUSES.has(latest.status)) {
      throw new Error(
        `Operation reached unexpected terminal status: ${JSON.stringify(latest)}`
      );
    }
    await delay(250);
  }
  throw new Error(
    `Operation did not reach ${[...expected].join('/')} within `
    + `${timeoutMs} ms. Latest: ${JSON.stringify(latest)}`
  );
};

const waitForDocument = async (
  documentRef,
  predicate,
  timeoutMs = 60_000
) => {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await documentRef.get();
    if (predicate(latest)) return latest;
    await delay(100);
  }
  throw new Error(
    `Document ${documentRef.path} did not reach the expected state.`
  );
};

const probeCallable = async ({functionId, region}) => {
  const response = await fetchWithDeadline(
    `http://127.0.0.1:5001/${PERFORMANCE_PROJECT_ID}/`
      + `${region}/${functionId}`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({data: {}}),
    },
    15_000
  );
  const bodyText = await response.text();
  assert.notEqual(
    response.status,
    404,
    `${region}/${functionId} is not registered: ${bodyText}`
  );
  assert.ok(
    response.status < 500,
    `${region}/${functionId} failed its handler probe: ${bodyText}`
  );
  let body;
  assert.doesNotThrow(() => {
    body = JSON.parse(bodyText);
  }, `${region}/${functionId} did not return callable JSON.`);
  assert.equal(
    Boolean(body?.error || Object.hasOwn(body || {}, 'result')
      || Object.hasOwn(body || {}, 'data')),
    true,
    `${region}/${functionId} did not return a callable envelope.`
  );
  return {body, status: response.status};
};

const writeBatches = async (entries) => {
  for (let offset = 0; offset < entries.length; offset += 350) {
    const batch = db.batch();
    for (const [documentPath, data] of entries.slice(offset, offset + 350)) {
      batch.set(db.doc(documentPath), data);
    }
    await batch.commit();
  }
};

const task05Config = (withDrain) => ({
  schemaVersion: 2,
  mode: 'new-only',
  stage: 'new-only',
  userOverrides: {
    'task06-scale-0000': 'new-only',
  },
  ...(withDrain ? {
    legacyDrain: {
      users: {
        'task06-scale-0000': {
          drainId: 'task06_scale_drain_0001',
          closedAt: Timestamp.fromMillis(1_750_000_000_000),
        },
      },
    },
  } : {}),
});

const task06BackendConfig = () => ({
  schemaVersion: 1,
  derivedOwnerMode: 'authoritative',
  enabledOperationKinds: [
    'level-up-all',
    'set-parameter-locks',
    'delete-npc',
    'delete-encounter',
    'delete-grigliata-custom-token',
    'duplicate-foe',
  ],
});

const actorDocument = () => ({
  role: 'dm',
  email: 'task06-integration-dm@example.test',
  stats: {level: 1},
});

const scaleUserEntries = () => Array.from(
  {length: SCALE_USER_COUNT},
  (_, index) => [
    `users/task06-scale-${String(index).padStart(4, '0')}`,
    {
      role: 'player',
      stats: {
        level: 1,
        combatTokensAvailable: 0,
      },
      summary: {level: 1},
      ...(index === SCALE_USER_COUNT - 1
        ? {deletionState: 'pending'}
        : {}),
    },
  ]
);

const resetTask06ControlPlane = async () => {
  await withBackgroundTriggersDisabled(async () => {
    await writeBatches([
      [`users/${actor.uid}`, actorDocument()],
      ['app_config/task06_backend', task06BackendConfig()],
      ['app_config/user_data_v2', task05Config(false)],
      ['utils/varie', {}],
    ]);
  }, {projectId: PERFORMANCE_PROJECT_ID});
};

before(async () => {
  if (process.env.FND_TASK06_INTEGRATION !== '1') {
    throw new Error(
      'Task 06 Functions integration must run through '
      + 'npm run perf:functions-integration.'
    );
  }
  configureOwnedPerformanceEnvironment({
    mode: PERFORMANCE_ENVIRONMENT_MODE.STRICT,
  });
  assert.equal(process.env.FND_TASK06_CONSOLIDATED_OWNER, '1');
  app = initializeApp({
    projectId: PERFORMANCE_PROJECT_ID,
    storageBucket: `${PERFORMANCE_PROJECT_ID}.appspot.com`,
  }, `task06-functions-${Date.now()}`);
  db = getFirestore(app);
  actor = await createDmActor();
  await withBackgroundTriggersDisabled(async () => {
    await writeBatches([
      [`users/${actor.uid}`, actorDocument()],
      ['app_config/task06_backend', task06BackendConfig()],
      ['app_config/user_data_v2', task05Config(false)],
      ['utils/varie', {}],
      ...scaleUserEntries(),
    ]);
  }, {projectId: PERFORMANCE_PROJECT_ID});
});

after(async () => {
  if (app) await deleteApp(app);
});

test(
  'authoritative derived state performs one root write and does not loop',
  verifyAuthoritativeDerivedState
);

test('bounded operation pauses, resumes above 500 subjects, and replays idempotently', async () => {
  await withBackgroundTriggersDisabled(async () => {
    await db.doc('app_config/user_data_v2').set(task05Config(true));
  }, {projectId: PERFORMANCE_PROJECT_ID});

  const started = await invokeCallable('levelUpAll', {
    operationId: OPERATION_ID,
  });
  assert.equal(started.ok, true);
  assert.equal(started.operation.operationId, OPERATION_ID);
  assert.equal(started.operation.kind, 'level-up-all');

  const paused = await waitForOperation(OPERATION_ID, ['paused']);
  assert.equal(paused.retryable, true);
  assert.equal(paused.errorClass, 'dependency');
  assert.ok(paused.progress.processed < SCALE_USER_COUNT + 1);

  await db.doc('app_config/user_data_v2').set(task05Config(false));
  const resumed = await invokeCallable('resumeBackendOperation', {
    operationId: OPERATION_ID,
  });
  assert.equal(resumed.operationId, OPERATION_ID);
  assert.equal(resumed.status, 'pending');

  const completed = await waitForOperation(OPERATION_ID, ['completed']);
  assert.equal(completed.retryable, false);
  assert.equal(completed.progress.succeeded, SCALE_USER_COUNT - 1);
  assert.equal(completed.progress.skipped, 2);
  assert.equal(
    completed.progress.processed,
    SCALE_USER_COUNT + 1
  );

  const [
    firstProgression,
    lastProgression,
    pendingProgression,
  ] = await Promise.all([
    db.doc('users/task06-scale-0000/state/progression').get(),
    db.doc('users/task06-scale-0523/state/progression').get(),
    db.doc('users/task06-scale-0524/state/progression').get(),
  ]);
  assert.equal(firstProgression.get('stats.level'), 2);
  assert.equal(lastProgression.get('stats.level'), 2);
  assert.equal(pendingProgression.exists, false);

  const replay = await invokeCallable('levelUpAll', {
    operationId: OPERATION_ID,
  });
  assert.equal(replay.operation.replayed, true);
  assert.equal(replay.operation.status, 'completed');
  assert.equal(
    replay.operation.progress.succeeded,
    SCALE_USER_COUNT - 1
  );
  assert.equal(
    (await db.doc(
      'users/task06-scale-0000/state/progression'
    ).get()).get('stats.level'),
    2
  );

  await db.doc(`users/${actor.uid}`).update({
    deletionState: 'pending',
  });
  await assert.rejects(
    invokeCallable('levelUpAll', {
      operationId: 'task06-pending-actor-0001',
    }),
    /PERMISSION_DENIED|pending deletion/
  );

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    projectId: PERFORMANCE_PROJECT_ID,
    consolidatedDerivedOwner: true,
    operationId: OPERATION_ID,
    status: completed.status,
    progress: completed.progress,
    pendingActorRejected: true,
    pendingSubjectSkipped: true,
    pauseResumeVerified: true,
    idempotentReplayVerified: true,
  })}\n`);
});

test('custom-token deletion pages beyond 500 instances and replays safely', async () => {
  await resetTask06ControlPlane();
  const templateId = 'task06-delete-template';
  const instances = Array.from(
    {length: TOKEN_INSTANCE_COUNT},
    (_, index) => {
      const instanceId =
        `task06-delete-instance-${String(index).padStart(4, '0')}`;
      return [
        [
          `grigliata_tokens/${instanceId}`,
          {
            ownerUid: actor.uid,
            tokenType: 'custom',
            customTokenRole: 'instance',
            customTemplateId: templateId,
            label: instanceId,
          },
        ],
        [
          `grigliata_token_placements/task06-bg__${instanceId}`,
          {
            backgroundId: 'task06-bg',
            tokenId: instanceId,
            ownerUid: actor.uid,
          },
        ],
      ];
    }
  ).flat();

  await withBackgroundTriggersDisabled(async () => {
    await db.doc(`users/${actor.uid}`).update({
      deletionState: FieldValue.delete(),
    });
    await writeBatches([
      [
        `grigliata_tokens/${templateId}`,
        {
          ownerUid: actor.uid,
          tokenType: 'custom',
          customTokenRole: 'template',
          customTemplateId: templateId,
          label: 'Task 06 scale template',
        },
      ],
      [
        `grigliata_token_placements/task06-bg__${templateId}`,
        {
          backgroundId: 'task06-bg',
          tokenId: templateId,
          ownerUid: actor.uid,
        },
      ],
      ...instances,
    ]);
  }, {projectId: PERFORMANCE_PROJECT_ID});

  let completed = null;
  for (let attempt = 0; attempt < 4 && !completed; attempt += 1) {
    try {
      completed = await invokeCallable('deleteGrigliataCustomToken', {
        tokenId: templateId,
        operationId: TOKEN_OPERATION_ID,
      });
    } catch (error) {
      if (!/deadline|paused safely/i.test(String(error?.message))) {
        throw error;
      }
      await delay(250);
    }
  }
  assert.ok(completed, 'custom-token deletion did not complete');
  assert.equal(completed.success, true);
  assert.equal(completed.deletedInstanceCount, TOKEN_INSTANCE_COUNT);
  assert.equal(
    completed.deletedPlacementCount,
    TOKEN_INSTANCE_COUNT + 1
  );

  const [root, remainingInstances, remainingPlacements] =
    await Promise.all([
      db.doc(`grigliata_tokens/${templateId}`).get(),
      db.collection('grigliata_tokens')
        .where('customTemplateId', '==', templateId)
        .limit(1)
        .get(),
      db.collection('grigliata_token_placements')
        .where('ownerUid', '==', actor.uid)
        .limit(1)
        .get(),
    ]);
  assert.equal(root.exists, false);
  assert.equal(remainingInstances.empty, true);
  assert.equal(remainingPlacements.empty, true);

  const replay = await invokeCallable('deleteGrigliataCustomToken', {
    tokenId: templateId,
    operationId: TOKEN_OPERATION_ID,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.deletedInstanceCount, TOKEN_INSTANCE_COUNT);

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    projectId: PERFORMANCE_PROJECT_ID,
    operationId: TOKEN_OPERATION_ID,
    deletedInstanceCount: completed.deletedInstanceCount,
    deletedPlacementCount: completed.deletedPlacementCount,
    boundedPagingVerified: true,
    idempotentReplayVerified: true,
  })}\n`);
});

async function verifyAuthoritativeDerivedState() {
  const userId = 'task06-derived-user';
  const userRef = db.doc(`users/${userId}`);
  const directoryRef = db.doc(`user_directory/${userId}`);
  const baseline = {
    role: 'player',
    characterId: 'Task 06 Derived',
    email: 'task06-derived@example.test',
    sentinel: {preserve: true},
    stats: {
      level: 2,
      hpTotal: 18,
      manaTotal: 12,
    },
    AltriParametri: {},
    Parametri: {
      Combattimento: {
        Salute: {Base: 2, Anima: 0, Tot: 2},
        Disciplina: {Base: 1, Anima: 0, Tot: 1},
      },
    },
  };
  await writeBatches([
    ['app_config/task06_backend', {
      ...task06BackendConfig(),
      derivedOwnerMode: 'legacy',
    }],
    ['app_config/user_data_v2', {
      schemaVersion: 2,
      mode: 'legacy-read',
      stage: 'legacy-read',
    }],
    ['utils/varie', {}],
    [`users/${userId}`, baseline],
    [`user_directory/${userId}`, {
      schemaVersion: 1,
      characterId: baseline.characterId,
      label: baseline.characterId,
      normalizedLabel: 'task 06 derived',
      role: 'player',
    }],
  ]);
  await db.doc('app_config/task06_backend').set(task06BackendConfig());

  const directoryBefore = await directoryRef.get();
  const observedSnapshots = [];
  let listenerError = null;
  let resolveInitial;
  let rejectInitial;
  const initialSnapshot = new Promise((resolve, reject) => {
    resolveInitial = resolve;
    rejectInitial = reject;
  });
  let initialObserved = false;
  const unsubscribe = userRef.onSnapshot(
    (snapshot) => {
      if (!initialObserved) {
        initialObserved = true;
        resolveInitial();
      }
      if (snapshot.exists && snapshot.updateTime) {
        observedSnapshots.push({
          data: snapshot.data(),
          updateTime: snapshot.updateTime.toMillis(),
        });
      }
    },
    (error) => {
      listenerError = error;
      rejectInitial(error);
    }
  );

  try {
    await initialSnapshot;
    const sourceWrite = await userRef.update({
      'Parametri.Combattimento.Salute.Base': 3,
    });

    const derived = await waitForDocument(
      userRef,
      (snapshot) => snapshot.get('stats.hpTotal') === 23
        && snapshot.get('stats.manaTotal') === 12
        && snapshot.get('Parametri.Combattimento.Salute.Tot') === 3
        && snapshot.get('Parametri.Combattimento.Disciplina.Tot') === 1
    );
    const settledUpdateTime = derived.updateTime.toMillis();
    await delay(2_000);
    const afterQuietWindow = await userRef.get();
    assert.equal(afterQuietWindow.updateTime.toMillis(), settledUpdateTime);
    assert.ifError(listenerError);
    const uniqueSnapshots = [...new Map(
      observedSnapshots.map((snapshot) => [
        snapshot.updateTime,
        snapshot,
      ])
    ).values()];
    assert.equal(
      uniqueSnapshots.length,
      3,
      'expected baseline, one source write, and exactly one derived root write'
    );
    const sourceSnapshot = uniqueSnapshots.find(({updateTime}) => (
      updateTime === sourceWrite.writeTime.toMillis()
    ));
    const derivedSnapshot = uniqueSnapshots.find(({updateTime}) => (
      updateTime === settledUpdateTime
    ));
    assert.ok(sourceSnapshot, 'source update snapshot was not observed');
    assert.ok(derivedSnapshot, 'derived update snapshot was not observed');
    assert.deepEqual(
      changedLeafPaths(sourceSnapshot.data, derivedSnapshot.data),
      [
        'Parametri.Combattimento.Salute.Tot',
        'stats.hpTotal',
      ]
    );
    assert.equal(derivedSnapshot.data.sentinel.preserve, true);
    const directoryAfter = await directoryRef.get();
    assert.equal(
      directoryAfter.updateTime.toMillis(),
      directoryBefore.updateTime.toMillis()
    );
  } finally {
    unsubscribe();
    await db.doc('app_config/user_data_v2').set(task05Config(false));
    const cleanup = db.batch();
    cleanup.delete(userRef);
    cleanup.delete(directoryRef);
    await cleanup.commit();
  }
}

test('lock-all uses bounded subjects and completes beyond the former batch ceiling', async () => {
  await resetTask06ControlPlane();
  const started = await invokeCallable('setAllParameterLocks', {
    operationId: LOCK_OPERATION_ID,
    field: 'lock_param_base',
    value: true,
  });
  assert.equal(started.operationId, LOCK_OPERATION_ID);

  const completed = await waitForOperation(
    LOCK_OPERATION_ID,
    ['completed']
  );
  assert.ok(completed.progress.processed > 500);
  assert.equal(completed.progress.failed, 0);
  assert.equal(completed.progress.skipped, 1);
  assert.equal(
    (await db.doc(
      'users/task06-scale-0000/state/settings'
    ).get()).get('settings.lock_param_base'),
    true
  );

  const replay = await invokeCallable('setAllParameterLocks', {
    operationId: LOCK_OPERATION_ID,
    field: 'lock_param_base',
    value: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'completed');
});

test('NPC and encounter cleanup remove indexed and nested descendants', async () => {
  await resetTask06ControlPlane();
  const npcId = 'task06-delete-npc';
  const encounterId = 'task06-delete-encounter';
  const bucket = getStorage(app).bucket();
  const npcMediaPath = `echi_npcs/${actor.uid}/task06-cleanup.png`;
  await bucket.file(npcMediaPath).save(Buffer.from('task06-npc'), {
    metadata: {contentType: 'image/png'},
  });
  const publicMarkers = Array.from(
    {length: PAGED_DELETE_COUNT},
    (_, index) => [
      `map_markers/task06-public-${String(index).padStart(3, '0')}`,
      {npcId, label: `public ${index}`},
    ]
  );
  const privateMarkers = Array.from(
    {length: PAGED_DELETE_COUNT},
    (_, index) => [
      `users/task06-scale-0000/map_markers_private/`
        + `task06-private-${String(index).padStart(3, '0')}`,
      {npcId, label: `private ${index}`},
    ]
  );
  const participants = Array.from(
    {length: PAGED_DELETE_COUNT},
    (_, index) => [
      `encounters/${encounterId}/participants/`
        + `player-${String(index).padStart(3, '0')}`,
      {uid: `player-${index}`},
    ]
  );
  const logs = Array.from(
    {length: PAGED_DELETE_COUNT},
    (_, index) => [
      `encounters/${encounterId}/logs/`
        + `log-${String(index).padStart(3, '0')}`,
      {message: `bounded cleanup ${index}`},
    ]
  );
  const nestedEffects = [
    [
      `encounters/${encounterId}/participants/player-000/effects/effect-a`,
      {kind: 'shield'},
    ],
    [
      `encounters/${encounterId}/participants/player-100/effects/effect-b`,
      {kind: 'barrier'},
    ],
  ];
  await withBackgroundTriggersDisabled(async () => {
    await writeBatches([
      [`echi_npcs/${npcId}`, {
        nome: 'Task 06 cleanup NPC',
        imagePath: npcMediaPath,
        imageUrl: 'https://example.invalid/task06-cleanup.png',
      }],
      [`encounters/${encounterId}`, {status: 'active'}],
      ...publicMarkers,
      ...privateMarkers,
      ...participants,
      ...logs,
      ...nestedEffects,
    ]);
  }, {projectId: PERFORMANCE_PROJECT_ID});

  const npcStarted = await invokeCallable('deleteNpcV2', {
    operationId: NPC_OPERATION_ID,
    npcId,
  });
  assert.equal(npcStarted.operationId, NPC_OPERATION_ID);
  const npcCompleted = await waitForOperation(
    NPC_OPERATION_ID,
    ['completed']
  );
  assert.equal(npcCompleted.result.npcDeleted, true);
  assert.equal(npcCompleted.result.mediaCleanup, 'deleted');
  assert.equal(
    npcCompleted.progress.succeeded,
    PAGED_DELETE_COUNT * 2
  );
  const [npcMediaExists] = await bucket.file(npcMediaPath).exists();
  assert.equal(npcMediaExists, false);

  const encounterStarted = await invokeCallable('deleteEncounterV2', {
    operationId: ENCOUNTER_OPERATION_ID,
    encounterId,
  });
  assert.equal(
    encounterStarted.operationId,
    ENCOUNTER_OPERATION_ID
  );
  const encounterCompleted = await waitForOperation(
    ENCOUNTER_OPERATION_ID,
    ['completed']
  );
  assert.equal(encounterCompleted.result.encounterDeleted, true);
  assert.equal(
    encounterCompleted.progress.succeeded,
    PAGED_DELETE_COUNT * 2 + nestedEffects.length
  );

  const [
    npc,
    publicRemaining,
    privateRemaining,
    encounter,
    participantsRemaining,
    logsRemaining,
    ...effects
  ] = await Promise.all([
    db.doc(`echi_npcs/${npcId}`).get(),
    db.collection('map_markers').where('npcId', '==', npcId).limit(1).get(),
    db.collectionGroup('map_markers_private')
      .where('npcId', '==', npcId).limit(1).get(),
    db.doc(`encounters/${encounterId}`).get(),
    db.collection(`encounters/${encounterId}/participants`).limit(1).get(),
    db.collection(`encounters/${encounterId}/logs`).limit(1).get(),
    ...nestedEffects.map(([documentPath]) => db.doc(documentPath).get()),
  ]);
  assert.equal(npc.exists, false);
  assert.equal(publicRemaining.empty, true);
  assert.equal(privateRemaining.empty, true);
  assert.equal(encounter.exists, false);
  assert.equal(participantsRemaining.empty, true);
  assert.equal(logsRemaining.empty, true);
  assert.equal(effects.every((snapshot) => !snapshot.exists), true);

  const npcReplay = await invokeCallable('deleteNpcV2', {
    operationId: NPC_OPERATION_ID,
    npcId,
  });
  const encounterReplay = await invokeCallable('deleteEncounterV2', {
    operationId: ENCOUNTER_OPERATION_ID,
    encounterId,
  });
  assert.equal(npcReplay.replayed, true);
  assert.equal(encounterReplay.replayed, true);
});

test('foe duplication cleans partial Storage copies and resumes with one receipt', async () => {
  await resetTask06ControlPlane();
  const sourceFoeId = 'task06-storage-source';
  const bucket = getStorage(app).bucket();
  const sourcePaths = {
    main: 'foes/task06/source-main.png',
    technique: 'foes/task06/source-technique.png',
    spell: 'foes/task06/source-missing-spell.png',
  };
  await Promise.all([
    bucket.file(sourcePaths.main).save(Buffer.from('task06-main'), {
      metadata: {contentType: 'image/png'},
    }),
    bucket.file(sourcePaths.technique).save(
      Buffer.from('task06-technique'),
      {metadata: {contentType: 'image/png'}}
    ),
  ]);
  await db.doc(`foes/${sourceFoeId}`).set({
    name: 'Task 06 source',
    imagePath: sourcePaths.main,
    imageUrl: 'https://example.invalid/source-main.png',
    tecniche: [{
      name: 'Technique',
      imagePath: sourcePaths.technique,
      imageUrl: 'https://example.invalid/source-technique.png',
    }],
    spells: [{
      name: 'Spell',
      imagePath: sourcePaths.spell,
      imageUrl: 'https://example.invalid/source-spell.png',
    }],
    stats: {hpTotal: 20, manaTotal: 10},
  });

  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', {
      operationId: FOE_OPERATION_ID,
      sourceFoeId,
      newFoeName: 'Task 06 duplicate',
    }),
    /UNAVAILABLE|could not be copied safely/i
  );
  const failed = await invokeCallable('getBackendOperationStatus', {
    operationId: FOE_OPERATION_ID,
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.retryable, true);
  assert.equal(failed.errorClass, 'storage');

  const operationQuery = await db.collection('backend_operations')
    .where('operationId', '==', FOE_OPERATION_ID)
    .limit(1)
    .get();
  assert.equal(operationQuery.size, 1);
  const manifest = operationQuery.docs[0].get('assetManifest');
  assert.equal(manifest.length, 3);
  const destinationState = await Promise.all(
    manifest.map(({destinationPath}) => (
      bucket.file(destinationPath).exists().then(([exists]) => exists)
    ))
  );
  assert.deepEqual(destinationState, [false, false, false]);

  await bucket.file(sourcePaths.spell).save(Buffer.from('task06-spell'), {
    metadata: {contentType: 'image/png'},
  });
  const completed = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_OPERATION_ID,
    sourceFoeId,
    newFoeName: 'Task 06 duplicate',
  });
  assert.equal(completed.replayed, false);
  assert.ok(completed.newFoeId);
  const duplicate = await db.doc(`foes/${completed.newFoeId}`).get();
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.get('name'), 'Task 06 duplicate');
  assert.equal(
    manifest.every(({destinationPath}) => (
      destinationPath.startsWith('foes/operations/')
    )),
    true
  );
  const destinationMetadata = await Promise.all(
    manifest.map(async (entry) => {
      const [exists] = await bucket.file(entry.destinationPath).exists();
      const [metadata] = await bucket.file(entry.destinationPath).getMetadata();
      return {entry, exists, metadata};
    })
  );
  destinationMetadata.forEach(({entry, exists, metadata}) => {
    assert.equal(exists, true);
    assert.equal(metadata.contentType, 'image/png');
    assert.equal(
      metadata.metadata.task06OperationOwned,
      'true'
    );
    assert.equal(
      metadata.metadata.firebaseStorageDownloadTokens,
      entry.downloadToken
    );
    assert.match(metadata.cacheControl, /private/);
    assert.match(metadata.cacheControl, /immutable/);
  });
  const manifestByKey = new Map(
    manifest.map((entry) => [entry.key, entry])
  );
  assert.equal(
    duplicate.get('imagePath'),
    manifestByKey.get('main').destinationPath
  );
  assert.equal(
    duplicate.get('tecniche')[0].imagePath,
    manifestByKey.get('tecnica:0').destinationPath
  );
  assert.equal(
    duplicate.get('spells')[0].imagePath,
    manifestByKey.get('spell:0').destinationPath
  );

  const replay = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_OPERATION_ID,
    sourceFoeId,
    newFoeName: 'Task 06 duplicate',
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.newFoeId, completed.newFoeId);
  assert.deepEqual(replay.assets, completed.assets);
});

test('every callable manifest entry is reachable in its declared emulator region', async () => {
  const entries = Object.values(callableManifest.callables);
  const reached = [];
  for (const entry of entries) {
    reached.push({
      functionId: entry.functionId,
      region: entry.region,
      probe: await probeCallable(entry),
    });
  }
  assert.equal(reached.length, entries.length);
  assert.deepEqual(
    [...new Set(reached.map(({region}) => region))].sort(),
    [...callableManifest.supportedRegions].sort()
  );
  assert.equal(
    reached.every(({probe}) => (
      probe.status >= 200 && probe.status < 500
    )),
    true
  );
  assert.deepEqual(
    reached
      .filter(({functionId}) => (
        functionId === 'duplicateFoeWithAssets'
        || functionId === 'duplicateFoeWithAssetsV2'
      ))
      .map(({functionId, region}) => `${functionId}:${region}`)
      .sort(),
    [
      'duplicateFoeWithAssets:europe-west1',
      'duplicateFoeWithAssetsV2:europe-west8',
    ]
  );
  assert.deepEqual(
    reached
      .filter(({functionId}) => (
        functionId === 'spendCharacterPoint'
        || functionId === 'spendCharacterPointV2'
      ))
      .map(({functionId, region}) => `${functionId}:${region}`)
      .sort(),
    [
      'spendCharacterPoint:us-central1',
      'spendCharacterPointV2:europe-west8',
    ]
  );
});
