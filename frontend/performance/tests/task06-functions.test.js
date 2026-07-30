const assert = require('node:assert/strict');
const {after, before, test} = require('node:test');
const {deleteApp, initializeApp} = require('firebase-admin/app');
const {
  FieldValue,
  Timestamp,
  getFirestore,
} = require('firebase-admin/firestore');
const {getStorage} = require('firebase-admin/storage');
const {
  buildTask07MediaUploadPlan,
} = require('../../functions/lib/mediaAssetLifecycleCore');
const {
  buildGeneratedMediaStoragePlan,
  buildTask07PrivateStorageMetadata,
  MEDIA_CONTRACT_VERSION,
  MEDIA_PRIVATE_CACHE_CONTROL,
  MEDIA_SCHEMA_VERSION,
} = require('../../functions/lib/mediaContracts');
const {
  task07MediaValueFromReadyManifest,
} = require('../../functions/lib/mediaTargetAdapters');
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
const FOE_CANONICAL_OPERATION_ID = 'task06-duplicate-foe-canonical-0001';
const FOE_CANONICAL_GENERAL_OPERATION_ID =
  'task06-duplicate-foe-canonical-general-0001';
const FOE_CANONICAL_GENERAL_ROUNDTRIP_ID =
  'task06-duplicate-foe-canonical-general-0002';
const FOE_CANONICAL_GENERAL_FALLBACK_ID =
  'task06-duplicate-foe-canonical-general-fallback-0001';
const FOE_CANONICAL_TERMINAL_ID = 'task06-foe-canonical-terminal-0001';
const FOE_CANONICAL_REPAIRED_ID = 'task06-foe-canonical-repaired-0001';
const FOE_ACTIVE_LEASE_ID = 'task06-foe-active-lease-0001';
const FOE_CLEANUP_OWNER_ID = 'task06-foe-cleanup-owner-0001';
const FOE_GATE_CLEANUP_ID = 'task06-foe-gate-cleanup-0001';
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
    const error = new Error(
      `${functionId} failed with HTTP ${response.status}: `
      + JSON.stringify(body.error || body)
    );
    error.code = String(body?.error?.status || body?.error?.code || '');
    error.httpStatus = response.status;
    error.callableError = body.error || body;
    throw error;
  }
  return body.data ?? body.result;
};

const operationDocument = async (operationId) => {
  const snapshot = await db.collection('backend_operations')
    .where('operationId', '==', operationId)
    .limit(1)
    .get();
  assert.equal(snapshot.size, 1, `Missing operation ${operationId}.`);
  return snapshot.docs[0];
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

const task07FoeWriteConfig = (uid) => ({
  schemaVersion: 1,
  policyVersion: MEDIA_CONTRACT_VERSION,
  mode: 'v1-write',
  enabledPurposes: ['foe'],
  enabledRoles: ['dm'],
  enabledUids: [uid],
});

const seedCanonicalFoe = async ({
  bucket,
  generalLegacyFallbackPath = '',
  sourceFoeId,
  mediaLocation = 'root',
}) => {
  const originalBuffer = Buffer.from('task07-canonical-foe-original');
  const sourcePlan = buildTask07MediaUploadPlan({
    actorUid: actor.uid,
    ownerUid: actor.uid,
    entityId: sourceFoeId,
    operationId: 'task07_foe_clone_source_0001',
    kind: 'foe',
    sourceContentType: 'image/png',
    sourceBytes: originalBuffer.byteLength,
  });
  const storagePlan = buildGeneratedMediaStoragePlan({
    kind: 'foe',
    audienceScope: sourcePlan.audienceScope,
    ownerKey: sourcePlan.ownerKey,
    assetId: sourcePlan.assetId,
    sourceGeneration: '7',
  });
  const objects = [
    {role: 'original', path: storagePlan.originalPath, buffer: originalBuffer},
    ...Object.entries(storagePlan.variants).map(([role, path], index) => ({
      role,
      path,
      buffer: Buffer.from(`task07-${role}-${index}`),
    })),
  ];
  const descriptors = new Map();
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    const checksum = String(index + 1).repeat(64).slice(0, 64);
    const contentType = object.role === 'original'
      ? 'image/png'
      : 'image/webp';
    await bucket.file(object.path).save(object.buffer, {
      resumable: false,
      metadata: {
        contentType,
        cacheControl: MEDIA_PRIVATE_CACHE_CONTROL,
        contentDisposition: 'inline',
        metadata: {
          ...buildTask07PrivateStorageMetadata({
            assetId: sourcePlan.assetId,
            entityId: sourceFoeId,
            kind: 'foe',
            ownerUid: actor.uid,
            role: object.role,
          }),
          task07Checksum: checksum,
        },
      },
    });
    const [metadata] = await bucket.file(object.path).getMetadata();
    descriptors.set(object.role, {
      path: object.path,
      contentType,
      bytes: object.buffer.byteLength,
      width: object.role === 'original' ? 640 : 96,
      height: object.role === 'original' ? 480 : 96,
      durationMs: null,
      orientationDegrees: 0,
      checksum,
      role: object.role,
      generation: String(metadata.generation),
      cacheControl: String(metadata.cacheControl || ''),
    });
  }
  if (generalLegacyFallbackPath) {
    await bucket.file(generalLegacyFallbackPath).save(
      Buffer.from('task07-general-legacy-fallback'),
      {
        resumable: false,
        metadata: {contentType: 'image/png'},
      }
    );
  }
  const manifest = {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    policyVersion: MEDIA_CONTRACT_VERSION,
    assetId: sourcePlan.assetId,
    generation: '7',
    state: 'attached',
    purpose: 'foe',
    audience: sourcePlan.audienceScope,
    ownerUid: actor.uid,
    actorUid: actor.uid,
    targetKind: 'foe',
    targetId: sourceFoeId,
    previousAssetId: null,
    requestHash: sourcePlan.requestHash,
    plan: sourcePlan,
    generated: {
      generation: '7',
      original: descriptors.get('original'),
      variants: Object.fromEntries(
        [...descriptors.entries()].filter(([role]) => role !== 'original')
      ),
    },
    attachment: {
      referencePath: `foes/${sourceFoeId}`,
      targetSlot: 'media',
      revision: 1,
      attachedAt: Timestamp.now(),
    },
    retention: {},
    error: {code: null, retryable: false, attempts: 1},
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
  const media = task07MediaValueFromReadyManifest(manifest, sourcePlan);
  const mediaUpdatedAt = Timestamp.now();
  const foeData = {
    name: 'Task 07 canonical source',
    tecniche: [],
    spells: [],
    stats: {hpTotal: 30, manaTotal: 12},
  };
  if (mediaLocation === 'general') {
    foeData.General = {
      label: 'Preserved General metadata',
      media,
      task07MediaRevision: 1,
      mediaUpdatedAt,
      imagePath: generalLegacyFallbackPath || storagePlan.originalPath,
      imageUrl: `https://legacy.invalid/${sourcePlan.assetId}/image.png`,
      image_url: `https://legacy.invalid/${sourcePlan.assetId}/image-alt.png`,
      url: `https://legacy.invalid/${sourcePlan.assetId}/url.png`,
      downloadUrl: `https://legacy.invalid/${sourcePlan.assetId}/download.png`,
    };
  } else {
    Object.assign(foeData, {
      imagePath: storagePlan.originalPath,
      imageUrl: '',
      media,
      task07MediaRevision: 1,
      mediaUpdatedAt,
    });
  }
  await withBackgroundTriggersDisabled(async () => {
    await Promise.all([
      db.doc(`media_assets/${sourcePlan.assetId}`).set(manifest),
      db.doc(`foes/${sourceFoeId}`).set(foeData),
    ]);
  }, {projectId: PERFORMANCE_PROJECT_ID});
  return {sourcePlan, manifest, objects};
};

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

test('foe duplication owns and atomically attaches a canonical media family', async () => {
  await resetTask06ControlPlane();
  await withBackgroundTriggersDisabled(async () => {
    await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  }, {projectId: PERFORMANCE_PROJECT_ID});
  const sourceFoeId = 'task07-canonical-clone-source';
  const bucket = getStorage(app).bucket();
  const seeded = await seedCanonicalFoe({bucket, sourceFoeId});

  await assert.rejects(
    invokeCallable('duplicateFoeWithAssets', {
      sourceFoeId,
      newFoeName: 'Unsafe compatibility duplicate',
    }),
    /Canonical foe media requires the resumable duplication callable/
  );

  const completed = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_CANONICAL_OPERATION_ID,
    sourceFoeId,
    newFoeName: 'Task 07 canonical duplicate',
  });
  assert.equal(completed.replayed, false);
  assert.ok(completed.assets.canonicalMain);
  assert.equal(
    completed.assets.canonicalMain.sourceAssetId,
    seeded.sourcePlan.assetId
  );
  assert.notEqual(
    completed.assets.canonicalMain.assetId,
    seeded.sourcePlan.assetId
  );

  const [source, duplicate, destinationManifest, sourceManifest] =
    await Promise.all([
      db.doc(`foes/${sourceFoeId}`).get(),
      db.doc(`foes/${completed.newFoeId}`).get(),
      db.doc(
        `media_assets/${completed.assets.canonicalMain.assetId}`
      ).get(),
      db.doc(`media_assets/${seeded.sourcePlan.assetId}`).get(),
    ]);
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.get('name'), 'Task 07 canonical duplicate');
  assert.equal(
    duplicate.get('media.assetId'),
    completed.assets.canonicalMain.assetId
  );
  assert.equal(duplicate.get('task07MediaRevision'), 1);
  assert.equal(
    duplicate.get('imagePath'),
    completed.assets.canonicalMain.originalPath
  );
  assert.equal(duplicate.get('imageUrl'), '');
  assert.equal(destinationManifest.get('state'), 'attached');
  assert.equal(
    destinationManifest.get('attachment.referencePath'),
    `foes/${completed.newFoeId}`
  );
  assert.equal(destinationManifest.get('attachment.targetSlot'), 'media');
  assert.equal(
    destinationManifest.get('clone.sourceAssetId'),
    seeded.sourcePlan.assetId
  );
  assert.equal(source.get('media.assetId'), seeded.sourcePlan.assetId);
  assert.equal(sourceManifest.get('state'), 'attached');

  const generated = destinationManifest.get('generated');
  const destinationObjects = [
    generated.original,
    ...Object.values(generated.variants),
  ];
  assert.equal(destinationObjects.length, 5);
  for (const object of destinationObjects) {
    const [metadata] = await bucket.file(object.path).getMetadata();
    assert.equal(
      metadata.metadata.task07AssetId,
      completed.assets.canonicalMain.assetId
    );
    assert.equal(metadata.metadata.task07EntityId, completed.newFoeId);
    assert.equal(metadata.metadata.task07OwnerUid, actor.uid);
    assert.equal(
      metadata.metadata.firebaseStorageDownloadTokens,
      undefined
    );
    assert.equal(metadata.cacheControl, MEDIA_PRIVATE_CACHE_CONTROL);
    assert.equal(metadata.contentDisposition, 'inline');
  }

  const replay = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_CANONICAL_OPERATION_ID,
    sourceFoeId,
    newFoeName: 'Task 07 canonical duplicate',
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.newFoeId, completed.newFoeId);
  assert.deepEqual(replay.assets, completed.assets);
});

test('General-only canonical foe duplication normalizes and round-trips', async () => {
  await resetTask06ControlPlane();
  await withBackgroundTriggersDisabled(async () => {
    await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  }, {projectId: PERFORMANCE_PROJECT_ID});
  const sourceFoeId = 'task07-general-canonical-clone-source';
  const bucket = getStorage(app).bucket();
  const seeded = await seedCanonicalFoe({
    bucket,
    sourceFoeId,
    mediaLocation: 'general',
  });

  const first = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_CANONICAL_GENERAL_OPERATION_ID,
    sourceFoeId,
    newFoeName: 'Task 07 normalized duplicate',
  });
  const firstTarget = await db.doc(`foes/${first.newFoeId}`).get();
  const firstData = firstTarget.data();
  assert.equal(firstTarget.exists, true);
  assert.equal(firstData.media.assetId, first.assets.canonicalMain.assetId);
  assert.equal(firstData.imagePath, first.assets.canonicalMain.originalPath);
  assert.equal(firstData.imageUrl, '');
  assert.equal(firstData.General.label, 'Preserved General metadata');
  for (const field of [
    'media',
    'task07MediaRevision',
    'mediaUpdatedAt',
    'imagePath',
    'imageUrl',
    'image_url',
    'url',
    'downloadUrl',
  ]) {
    assert.equal(firstData.General[field], undefined);
  }
  assert.equal(
    JSON.stringify(firstData).includes(seeded.sourcePlan.assetId),
    false
  );

  const second = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_CANONICAL_GENERAL_ROUNDTRIP_ID,
    sourceFoeId: first.newFoeId,
    newFoeName: 'Task 07 round-trip duplicate',
  });
  const secondTarget = await db.doc(`foes/${second.newFoeId}`).get();
  assert.equal(secondTarget.exists, true);
  assert.equal(
    secondTarget.get('media.assetId'),
    second.assets.canonicalMain.assetId
  );
  assert.notEqual(
    second.assets.canonicalMain.assetId,
    first.assets.canonicalMain.assetId
  );
  assert.equal(secondTarget.get('General.media'), undefined);
  assert.equal(
    secondTarget.get('General.label'),
    'Preserved General metadata'
  );
});

test('General-only canonical duplication preserves a safe legacy rollback object', async () => {
  await resetTask06ControlPlane();
  await withBackgroundTriggersDisabled(async () => {
    await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  }, {projectId: PERFORMANCE_PROJECT_ID});
  const sourceFoeId = 'task07-general-canonical-fallback-source';
  const legacyFallbackPath = `foes/${sourceFoeId}/legacy.png`;
  const bucket = getStorage(app).bucket();
  await seedCanonicalFoe({
    bucket,
    generalLegacyFallbackPath: legacyFallbackPath,
    sourceFoeId,
    mediaLocation: 'general',
  });

  const completed = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_CANONICAL_GENERAL_FALLBACK_ID,
    sourceFoeId,
    newFoeName: 'Task 07 fallback duplicate',
  });
  const target = await db.doc(`foes/${completed.newFoeId}`).get();
  assert.equal(target.exists, true);
  assert.equal(
    target.get('media.assetId'),
    completed.assets.canonicalMain.assetId
  );
  assert.equal(target.get('imagePath'), completed.assets.main.path);
  assert.match(target.get('imagePath'), /^foes\/operations\//);
  assert.notEqual(
    target.get('imagePath'),
    completed.assets.canonicalMain.originalPath
  );
  assert.equal(target.get('General.imagePath'), undefined);
  const [copiedFallbackExists] = await bucket
    .file(completed.assets.main.path)
    .exists();
  assert.equal(copiedFallbackExists, true);
});

test('General-only canonical foe retirement clears image aliases atomically', async () => {
  await resetTask06ControlPlane();
  await withBackgroundTriggersDisabled(async () => {
    await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  }, {projectId: PERFORMANCE_PROJECT_ID});
  const sourceFoeId = 'task07-general-canonical-retire-source';
  const bucket = getStorage(app).bucket();
  const seeded = await seedCanonicalFoe({
    bucket,
    sourceFoeId,
    mediaLocation: 'general',
  });
  const videoAssetId = `m_${'f'.repeat(40)}`;
  await db.doc(`foes/${sourceFoeId}`).update({
    'General.videoMedia': {assetId: videoAssetId},
    'General.task07VideoMediaRevision': 4,
    'General.videoMediaUpdatedAt': Timestamp.now(),
  });

  const retired = await invokeCallable('task07RetireMediaAsset', {
    assetId: seeded.sourcePlan.assetId,
  });
  assert.equal(retired.ok, true);
  assert.equal(retired.state, 'superseded');

  const [target, manifest, cleanup] = await Promise.all([
    db.doc(`foes/${sourceFoeId}`).get(),
    db.doc(`media_assets/${seeded.sourcePlan.assetId}`).get(),
    db.doc(`media_asset_cleanup/${seeded.sourcePlan.assetId}`).get(),
  ]);
  assert.equal(target.get('media'), undefined);
  assert.equal(target.get('General.media'), undefined);
  assert.equal(target.get('General.task07MediaRevision'), undefined);
  assert.equal(target.get('General.mediaUpdatedAt'), undefined);
  assert.equal(target.get('General.imagePath'), undefined);
  assert.equal(target.get('General.imageUrl'), undefined);
  assert.equal(target.get('General.image_url'), undefined);
  assert.equal(target.get('General.url'), undefined);
  assert.equal(target.get('General.downloadUrl'), undefined);
  assert.equal(target.get('General.label'), 'Preserved General metadata');
  assert.equal(target.get('General.videoMedia.assetId'), videoAssetId);
  assert.equal(target.get('General.task07VideoMediaRevision'), 4);
  assert.equal(target.get('task07MediaRevision'), 1);
  assert.equal(manifest.get('state'), 'superseded');
  assert.equal(cleanup.get('state'), 'pending');
  assert.equal(cleanup.get('reason'), 'retired');

  const replay = await invokeCallable('task07RetireMediaAsset', {
    assetId: seeded.sourcePlan.assetId,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.state, 'superseded');
});

test('terminal canonical copy failure retires only after cleanup and a fresh ID succeeds', async () => {
  await resetTask06ControlPlane();
  await withBackgroundTriggersDisabled(async () => {
    await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  }, {projectId: PERFORMANCE_PROJECT_ID});
  const sourceFoeId = 'task07-canonical-terminal-source';
  const bucket = getStorage(app).bucket();
  const seeded = await seedCanonicalFoe({bucket, sourceFoeId});
  await bucket.file(seeded.objects[0].path).delete();
  const request = {
    sourceFoeId,
    newFoeName: 'Task 07 repaired duplicate',
  };

  await withBackgroundTriggersDisabled(async () => {
    await assert.rejects(
      invokeCallable('duplicateFoeWithAssetsV2', {
        ...request,
        operationId: FOE_CANONICAL_TERMINAL_ID,
      }),
      (error) => {
        assert.match(error.code, /FAILED_PRECONDITION/i);
        return true;
      }
    );
    const operation = await operationDocument(FOE_CANONICAL_TERMINAL_ID);
    assert.equal(operation.get('status'), 'failed');
    assert.equal(operation.get('retryable'), false);
    assert.equal(operation.get('retryOperationAfterCleanup'), undefined);
    assert.equal(operation.get('errorClass'), 'source-object-missing');
    const clone = operation.get('canonicalMediaClone');
    const manifestRef = db.doc(`media_assets/${clone.destinationAssetId}`);
    const cleanupRef = db.doc(`media_asset_cleanup/${clone.destinationAssetId}`);
    const [manifest, cleanup] = await Promise.all([
      manifestRef.get(),
      cleanupRef.get(),
    ]);
    assert.equal(manifest.get('state'), 'rejected');
    assert.equal(cleanup.get('state'), 'pending');

    await Promise.all([
      manifestRef.update({state: 'cleanup-pending'}),
      operation.ref.update({
        status: 'cleanup-pending',
        phase: 'cleanup',
        retryable: true,
        retryOperationAfterCleanup: false,
      }),
    ]);
    await assert.rejects(
      invokeCallable('duplicateFoeWithAssetsV2', {
        ...request,
        operationId: FOE_CANONICAL_TERMINAL_ID,
      }),
      (error) => {
        assert.match(error.code, /FAILED_PRECONDITION/i);
        return true;
      }
    );
    assert.equal((await manifestRef.get()).get('state'), 'cleanup-pending');
    assert.equal((await cleanupRef.get()).get('state'), 'pending');

    await Promise.all([
      manifestRef.update({state: 'deleted'}),
      cleanupRef.update({state: 'complete'}),
      operation.ref.update({
        status: 'cleanup-pending',
        phase: 'cleanup',
        retryable: true,
        retryOperationAfterCleanup: false,
      }),
    ]);
    await assert.rejects(
      invokeCallable('duplicateFoeWithAssetsV2', {
        ...request,
        operationId: FOE_CANONICAL_TERMINAL_ID,
      }),
      (error) => {
        assert.match(error.code, /FAILED_PRECONDITION/i);
        return true;
      }
    );
    assert.equal((await manifestRef.get()).get('state'), 'deleted');
    assert.equal((await cleanupRef.get()).get('state'), 'complete');
  }, {projectId: PERFORMANCE_PROJECT_ID});

  const repaired = await seedCanonicalFoe({bucket, sourceFoeId});
  const completed = await invokeCallable('duplicateFoeWithAssetsV2', {
    ...request,
    operationId: FOE_CANONICAL_REPAIRED_ID,
  });
  assert.equal(completed.replayed, false);
  assert.equal(
    completed.assets.canonicalMain.sourceAssetId,
    repaired.sourcePlan.assetId
  );
  const retired = await operationDocument(FOE_CANONICAL_TERMINAL_ID);
  assert.equal(retired.get('status'), 'failed');
  assert.equal(retired.get('retryable'), false);
});

test('active foe lease stays aborted while expired source drift cleans terminally', async () => {
  await resetTask06ControlPlane();
  const sourceFoeId = 'task06-foe-active-lease-source';
  const sourcePath = 'foes/task06/active-lease-missing.png';
  const request = {
    operationId: FOE_ACTIVE_LEASE_ID,
    sourceFoeId,
    newFoeName: 'Active lease duplicate',
  };
  await db.doc(`foes/${sourceFoeId}`).set({
    name: 'Active lease source',
    imagePath: sourcePath,
    imageUrl: 'https://example.invalid/active-lease.png',
    tecniche: [],
    spells: [],
    stats: {hpTotal: 10, manaTotal: 4},
  });
  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /UNAVAILABLE/i);
      return true;
    }
  );
  let operation = await operationDocument(FOE_ACTIVE_LEASE_ID);
  const leaseOwner = 'another-invocation';
  await operation.ref.update({
    status: 'running',
    phase: 'copy-assets',
    retryable: false,
    leaseOwner,
    leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  });

  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /ABORTED/i);
      return true;
    }
  );
  operation = await operation.ref.get();
  assert.equal(operation.get('leaseOwner'), leaseOwner);
  assert.equal(operation.get('phase'), 'copy-assets');

  await Promise.all([
    operation.ref.update({
      leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000),
    }),
    db.doc(`foes/${sourceFoeId}`).update({name: 'Drifted source'}),
  ]);
  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /FAILED_PRECONDITION/i);
      return true;
    }
  );
  operation = await operation.ref.get();
  assert.equal(operation.get('status'), 'failed');
  assert.equal(operation.get('retryable'), false);
  assert.equal(operation.get('errorClass'), 'source-drift');
  assert.equal(operation.get('retryOperationAfterCleanup'), undefined);
});

test('cleanup-pending foe receipts remain owner-resumable without DM role', async () => {
  await resetTask06ControlPlane();
  const sourceFoeId = 'task06-foe-cleanup-owner-source';
  const request = {
    operationId: FOE_CLEANUP_OWNER_ID,
    sourceFoeId,
    newFoeName: 'Cleanup owner duplicate',
  };
  await db.doc(`foes/${sourceFoeId}`).set({
    name: 'Cleanup owner source',
    imagePath: 'foes/task06/cleanup-owner-missing.png',
    imageUrl: 'https://example.invalid/cleanup-owner.png',
    tecniche: [],
    spells: [],
    stats: {hpTotal: 10, manaTotal: 4},
  });
  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /UNAVAILABLE/i);
      return true;
    }
  );
  let operation = await operationDocument(FOE_CLEANUP_OWNER_ID);
  const [entry] = operation.get('assetManifest');
  const bucket = getStorage(app).bucket();
  await bucket.file(entry.destinationPath).save(Buffer.from('owned-copy'));
  await Promise.all([
    operation.ref.update({
      status: 'cleanup-pending',
      phase: 'cleanup',
      retryable: false,
      retryOperationAfterCleanup: FieldValue.delete(),
      leaseOwner: FieldValue.delete(),
      leaseExpiresAt: FieldValue.delete(),
    }),
    db.doc(`users/${actor.uid}`).update({role: 'player'}),
  ]);

  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /UNAVAILABLE/i);
      return true;
    }
  );
  operation = await operation.ref.get();
  assert.equal(operation.get('status'), 'failed');
  assert.equal(operation.get('retryable'), true);
  assert.equal(operation.get('retryOperationAfterCleanup'), undefined);
  assert.deepEqual(await bucket.file(entry.destinationPath).exists(), [false]);

  await operation.ref.update({
    status: 'cleanup-pending',
    phase: 'cleanup',
    retryable: true,
    retryOperationAfterCleanup: true,
  });
  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /UNAVAILABLE/i);
      return true;
    }
  );
  operation = await operation.ref.get();
  assert.equal(operation.get('status'), 'failed');
  assert.equal(operation.get('retryable'), true);
  await db.doc(`users/${actor.uid}`).set(actorDocument());
});

test('disabling the duplication gate cleans an existing receipt before retirement', async () => {
  await resetTask06ControlPlane();
  const sourceFoeId = 'task06-foe-gate-cleanup-source';
  const request = {
    operationId: FOE_GATE_CLEANUP_ID,
    sourceFoeId,
    newFoeName: 'Gate cleanup duplicate',
  };
  await db.doc(`foes/${sourceFoeId}`).set({
    name: 'Gate cleanup source',
    imagePath: 'foes/task06/gate-cleanup-missing.png',
    imageUrl: 'https://example.invalid/gate-cleanup.png',
    tecniche: [],
    spells: [],
    stats: {hpTotal: 10, manaTotal: 4},
  });
  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /UNAVAILABLE/i);
      return true;
    }
  );
  let operation = await operationDocument(FOE_GATE_CLEANUP_ID);
  const [entry] = operation.get('assetManifest');
  const bucket = getStorage(app).bucket();
  await bucket.file(entry.destinationPath).save(Buffer.from('owned-copy'));
  const disabled = task06BackendConfig();
  disabled.enabledOperationKinds = disabled.enabledOperationKinds
    .filter((kind) => kind !== 'duplicate-foe');
  await db.doc('app_config/task06_backend').set(disabled);

  await assert.rejects(
    invokeCallable('duplicateFoeWithAssetsV2', request),
    (error) => {
      assert.match(error.code, /FAILED_PRECONDITION/i);
      return true;
    }
  );
  operation = await operation.ref.get();
  assert.equal(operation.get('status'), 'failed');
  assert.equal(operation.get('retryable'), false);
  assert.equal(operation.get('errorClass'), 'task06-disabled');
  assert.equal(operation.get('retryOperationAfterCleanup'), undefined);
  assert.deepEqual(await bucket.file(entry.destinationPath).exists(), [false]);
  await resetTask06ControlPlane();
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
