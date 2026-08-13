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
  withBackgroundTriggersDisabled: withRawBackgroundTriggersDisabled,
} = require('../../scripts/performance/emulator-control');

const SCALE_USER_COUNT = 525;
const OPERATION_ID = 'task06-scale-bounded-0001';
const TOKEN_OPERATION_ID = 'task06-token-scale-0001';
const TOKEN_TEMPLATE_ID = 'task06-delete-template';
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
const WORKER_READINESS_TIMEOUT_MS = 30_000;
const CALLABLE_READINESS_TIMEOUT_MS = 180_000;
const BACKGROUND_RUNTIME_READINESS_ATTEMPTS = 3;
const CALLABLE_MANIFEST_PROBE_BATCH_SIZE = 10;
const CALLABLE_READINESS_PROBES = Object.freeze([
  {functionId: 'duplicateFoeWithAssets', region: 'europe-west1'},
  {functionId: 'deleteGrigliataCustomToken', region: 'europe-west1'},
  {functionId: 'getBackendOperationStatus', region: 'europe-west8'},
]);
const TERMINAL_STATUSES = new Set([
  'paused',
  'completed',
  'failed',
  'cleanup-pending',
]);
const functionRegion = (functionId) => {
  const region = callableManifest.callables[functionId]?.region;
  assert.ok(region, `Callable manifest is missing ${functionId}.`);
  return region;
};

let app;
let db;
let actor;

const delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

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
  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(
      `${functionId} returned non-callable HTTP ${response.status}: `
      + bodyText.slice(0, 300),
      {cause: error}
    );
  }
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

const waitForCallableReadiness = async (
  probes = CALLABLE_READINESS_PROBES,
  timeoutMs = CALLABLE_READINESS_TIMEOUT_MS
) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    let ready = true;
    for (const probe of probes) {
      try {
        await probeCallable(probe);
      } catch (error) {
        lastError = error;
        ready = false;
        break;
      }
    }
    if (ready) return;
    await delay(250);
  }
  throw new Error(
    `Task 06 callable endpoints did not register within ${timeoutMs} ms.`,
    {cause: lastError}
  );
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

const waitForBackendWorkerReadiness = async (
  timeoutMs = WORKER_READINESS_TIMEOUT_MS
) => {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const receiptId = [
      'task06-worker-readiness',
      process.pid,
      Date.now(),
      attempt,
    ].join('-');
    const operationRef = db.doc(`backend_operations/${receiptId}`);
    const workRef = db.doc(
      `backend_operation_work/${receiptId}-00000000`
    );
    const createdAt = Timestamp.now();
    const batch = db.batch();
    batch.create(operationRef, {
      schemaVersion: 1,
      operationId: receiptId,
      actorUid: 'task06-worker-readiness',
      kind: 'task06-worker-readiness',
      requestHash: receiptId,
      input: {},
      status: 'pending',
      phase: 'prepare',
      cursor: '',
      generation: 0,
      attempt: 0,
      retryable: false,
      progress: {
        planned: 0,
        processed: 0,
        succeeded: 0,
        skipped: 0,
        failed: 0,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    batch.create(workRef, {
      schemaVersion: 1,
      receiptId,
      generation: 0,
      status: 'pending',
      createdAt,
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    await batch.commit();

    let ready = false;
    const attemptDeadline = Math.min(deadline, Date.now() + 5_000);
    try {
      while (Date.now() < attemptDeadline) {
        const [operation, work] = await Promise.all([
          operationRef.get(),
          workRef.get(),
        ]);
        if (
          operation.get('status') === 'paused'
          && operation.get('errorClass') === 'dependency'
          && work.get('status') === 'completed'
        ) {
          ready = true;
          break;
        }
        await delay(100);
      }
    } finally {
      const cleanup = db.batch();
      cleanup.delete(operationRef);
      cleanup.delete(workRef);
      await cleanup.commit();
    }
    if (ready) return;
    await delay(200);
  }
  throw new Error(
    `Task 06 worker did not register within ${timeoutMs} ms after re-enable.`
  );
};

const waitForBackgroundRuntimeReadiness = async (
  options = {},
  attempts = BACKGROUND_RUNTIME_READINESS_ATTEMPTS
) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await waitForCallableReadiness();
      await waitForBackendWorkerReadiness();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await withRawBackgroundTriggersDisabled(async () => {}, {
        ...options,
        projectId: PERFORMANCE_PROJECT_ID,
      });
    }
  }
  throw new Error(
    `Task 06 background runtime did not recover after ${attempts} attempts.`,
    {cause: lastError}
  );
};

const withBackgroundTriggersDisabled = async (
  operation,
  options = {}
) => {
  const result = await withRawBackgroundTriggersDisabled(operation, {
    ...options,
    projectId: PERFORMANCE_PROJECT_ID,
  });
  await waitForBackgroundRuntimeReadiness(options);
  return result;
};

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
  await Promise.all([
    db.doc(`media_assets/${sourcePlan.assetId}`).set(manifest),
    db.doc(`foes/${sourceFoeId}`).set(foeData),
  ]);
  return {sourcePlan, manifest, objects};
};

const actorDocument = () => ({
  modelVersion: 2,
  role: 'dm',
  email: 'task06-integration-dm@example.test',
  characterId: 'Task 06 Integration DM',
  flags: {characterCreationDone: true},
  summary: {level: 1},
});

const scaleUserEntries = () => Array.from(
  {length: SCALE_USER_COUNT},
  (_, index) => [
    `users/task06-scale-${String(index).padStart(4, '0')}`,
    {
      modelVersion: 2,
      role: 'player',
      characterId: `Task 06 Scale ${String(index).padStart(4, '0')}`,
      flags: {characterCreationDone: true},
      summary: {level: 1},
      ...(index === SCALE_USER_COUNT - 1
        ? {deletionState: 'pending'}
        : {}),
    },
  ]
);

const customTokenFixtureEntries = (ownerUid) => [
  [
    `grigliata_tokens/${TOKEN_TEMPLATE_ID}`,
    {
      ownerUid,
      tokenType: 'custom',
      customTokenRole: 'template',
      customTemplateId: TOKEN_TEMPLATE_ID,
      label: 'Task 06 scale template',
    },
  ],
  [
    `grigliata_token_placements/task06-bg__${TOKEN_TEMPLATE_ID}`,
    {
      backgroundId: 'task06-bg',
      tokenId: TOKEN_TEMPLATE_ID,
      ownerUid,
    },
  ],
  ...Array.from(
    {length: TOKEN_INSTANCE_COUNT},
    (_, index) => {
      const instanceId =
        `task06-delete-instance-${String(index).padStart(4, '0')}`;
      return [
        [
          `grigliata_tokens/${instanceId}`,
          {
            ownerUid,
            tokenType: 'custom',
            customTokenRole: 'instance',
            customTemplateId: TOKEN_TEMPLATE_ID,
            label: instanceId,
          },
        ],
        [
          `grigliata_token_placements/task06-bg__${instanceId}`,
          {
            backgroundId: 'task06-bg',
            tokenId: instanceId,
            ownerUid,
          },
        ],
      ];
    }
  ).flat(),
];

const RETIRED_ROOT_USER_ID = 'task06-v2-inert-root-user';
const retiredRootDomainFixtureEntries = () => {
  const shell = {
    modelVersion: 2,
    role: 'player',
    characterId: 'Task 06 V2 Canonical',
    email: 'task06-v2-canonical@example.test',
    flags: {characterCreationDone: true},
    summary: {level: 2},
    sentinel: {preserve: true},
  };
  return [
    [`users/${RETIRED_ROOT_USER_ID}`, shell],
    [`users/${RETIRED_ROOT_USER_ID}/state/progression`, {
      schemaVersion: 2,
      revision: 7,
      stats: {
        level: 2,
        basePointsAvailable: 4,
        basePointsSpent: 0,
        combatTokensAvailable: 3,
        combatTokensSpent: 0,
      },
      AltriParametri: {},
      Parametri: {
        Combattimento: {
          Salute: {Base: 2, Anima: 0, Tot: 2},
          Disciplina: {Base: 1, Anima: 0, Tot: 1},
        },
      },
    }],
    [`users/${RETIRED_ROOT_USER_ID}/state/resources`, {
      schemaVersion: 2,
      revision: 5,
      stats: {
        hpTotal: 18,
        hpCurrent: 18,
        manaTotal: 12,
        manaCurrent: 12,
      },
    }],
    [`user_directory/${RETIRED_ROOT_USER_ID}`, {
      schemaVersion: 1,
      characterId: shell.characterId,
      label: shell.characterId,
      normalizedLabel: 'task 06 v2 canonical',
      role: 'player',
    }],
  ];
};

const resetTask06ControlPlane = async () => {
  await writeBatches([
    [`users/${actor.uid}`, actorDocument()],
    ['app_config/task06_backend', task06BackendConfig()],
    ['utils/varie', {}],
  ]);
};

const seedLegacyFoeRecoveryReceipt = async ({
  operationId,
  sourceFoeId,
  newFoeName,
}) => {
  const result = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId,
    sourceFoeId,
    newFoeName,
  });
  assert.equal(result.replayed, false);
  assert.equal(result.assets.main.path, '');
  const operation = await operationDocument(operationId);
  assert.equal(operation.get('status'), 'completed');
  const [entry] = operation.get('assetManifest');
  assert.ok(entry);
  assert.equal(entry.sourceKnownPresent, false);
  await db.doc(`foes/${result.newFoeId}`).delete();
  return {operation, result};
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
      ['utils/varie', {}],
      ...scaleUserEntries(),
      ...retiredRootDomainFixtureEntries(),
      ...customTokenFixtureEntries(actor.uid),
    ]);
  }, {projectId: PERFORMANCE_PROJECT_ID});
});

after(async () => {
  if (app) await deleteApp(app);
});

test(
  'retired legacy root domains stay inert while V2 state remains canonical',
  verifyRetiredRootDomainsStayInert
);

test('bounded operation completes above 500 subjects and replays idempotently', async () => {
  await resetTask06ControlPlane();

  const started = await invokeCallable('levelUpAll', {
    operationId: OPERATION_ID,
  });
  assert.equal(started.ok, true);
  assert.equal(started.operation.operationId, OPERATION_ID);
  assert.equal(started.operation.kind, 'level-up-all');

  const completed = await waitForOperation(OPERATION_ID, ['completed']);
  assert.equal(completed.retryable, false);
  assert.equal(completed.progress.succeeded, SCALE_USER_COUNT);
  assert.equal(completed.progress.skipped, 2);
  assert.equal(
    completed.progress.processed,
    SCALE_USER_COUNT + 2
  );

  const [
    firstProgression,
    lastProgression,
    pendingProgression,
    retiredRootProgression,
  ] = await Promise.all([
    db.doc('users/task06-scale-0000/state/progression').get(),
    db.doc('users/task06-scale-0523/state/progression').get(),
    db.doc('users/task06-scale-0524/state/progression').get(),
    db.doc(`users/${RETIRED_ROOT_USER_ID}/state/progression`).get(),
  ]);
  assert.equal(firstProgression.get('stats.level'), 2);
  assert.equal(lastProgression.get('stats.level'), 2);
  assert.equal(pendingProgression.exists, false);
  assert.equal(retiredRootProgression.get('stats.level'), 3);

  const replay = await invokeCallable('levelUpAll', {
    operationId: OPERATION_ID,
  });
  assert.equal(replay.operation.replayed, true);
  assert.equal(replay.operation.status, 'completed');
  assert.equal(
    replay.operation.progress.succeeded,
    SCALE_USER_COUNT
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
    v2CommandOwnership: true,
    operationId: OPERATION_ID,
    status: completed.status,
    progress: completed.progress,
    pendingActorRejected: true,
    pendingSubjectSkipped: true,
    boundedPagingVerified: true,
    idempotentReplayVerified: true,
  })}\n`);
});

test('custom-token deletion pages beyond 500 instances and replays safely', async () => {
  await resetTask06ControlPlane();
  const templateId = TOKEN_TEMPLATE_ID;

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

async function verifyRetiredRootDomainsStayInert() {
  const userId = RETIRED_ROOT_USER_ID;
  const userRef = db.doc(`users/${userId}`);
  const progressionRef = db.doc(`users/${userId}/state/progression`);
  const resourcesRef = db.doc(`users/${userId}/state/resources`);
  const directoryRef = db.doc(`user_directory/${userId}`);

  const [progressionBefore, resourcesBefore, directoryBefore] =
    await Promise.all([
      progressionRef.get(),
      resourcesRef.get(),
      directoryRef.get(),
    ]);

  const sourceWrite = await userRef.update({
    Parametri: {
      Combattimento: {
        Salute: {Base: 99, Anima: 0, Tot: 99},
      },
    },
    stats: {hpTotal: 999, manaTotal: 999},
  });
  await delay(2_000);
  const [rootAfter, progressionAfter, resourcesAfter, directoryAfter] =
    await Promise.all([
      userRef.get(),
      progressionRef.get(),
      resourcesRef.get(),
      directoryRef.get(),
    ]);
  assert.equal(
    rootAfter.updateTime.toMillis(),
    sourceWrite.writeTime.toMillis(),
    'a retired user-root trigger rewrote the source document'
  );
  assert.equal(rootAfter.get('stats.hpTotal'), 999);
  assert.equal(rootAfter.get('Parametri.Combattimento.Salute.Tot'), 99);
  assert.equal(rootAfter.get('sentinel.preserve'), true);
  assert.deepEqual(progressionAfter.data(), progressionBefore.data());
  assert.deepEqual(resourcesAfter.data(), resourcesBefore.data());
  assert.equal(
    progressionAfter.updateTime.toMillis(),
    progressionBefore.updateTime.toMillis()
  );
  assert.equal(
    resourcesAfter.updateTime.toMillis(),
    resourcesBefore.updateTime.toMillis()
  );
  assert.equal(
    directoryAfter.updateTime.toMillis(),
    directoryBefore.updateTime.toMillis()
  );
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 2,
    projectId: PERFORMANCE_PROJECT_ID,
    legacyRootTriggerWrites: 0,
    v2ProgressionUnchanged: true,
    v2ResourcesUnchanged: true,
    directoryUnchanged: true,
  })}\n`);
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

test('foe duplication skips a missing optional legacy image and replays', async () => {
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

  const completed = await invokeCallable('duplicateFoeWithAssetsV2', {
    operationId: FOE_OPERATION_ID,
    sourceFoeId,
    newFoeName: 'Task 06 duplicate',
  });
  assert.equal(completed.replayed, false);
  assert.ok(completed.newFoeId);

  const operationQuery = await db.collection('backend_operations')
    .where('operationId', '==', FOE_OPERATION_ID)
    .limit(1)
    .get();
  assert.equal(operationQuery.size, 1);
  const operation = operationQuery.docs[0];
  const manifest = operation.get('assetManifest');
  assert.equal(manifest.length, 3);
  const destinationState = await Promise.all(
    manifest.map(({destinationPath}) => (
      bucket.file(destinationPath).exists().then(([exists]) => exists)
    ))
  );
  assert.deepEqual(destinationState, [true, true, false]);
  assert.deepEqual(operation.get('progress'), {
    planned: 3,
    processed: 3,
    succeeded: 2,
    skipped: 1,
    failed: 0,
  });
  const duplicate = await db.doc(`foes/${completed.newFoeId}`).get();
  assert.equal(duplicate.exists, true);
  assert.equal(duplicate.get('name'), 'Task 06 duplicate');
  assert.equal(
    manifest.every(({destinationPath}) => (
      destinationPath.startsWith('foes/operations/')
    )),
    true
  );
  const copiedManifest = manifest.filter(({key}) => key !== 'spell:0');
  const destinationMetadata = await Promise.all(
    copiedManifest.map(async (entry) => {
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
  assert.equal(duplicate.get('spells')[0].imagePath, '');
  assert.equal(duplicate.get('spells')[0].imageUrl, '');
  assert.deepEqual(completed.assets.spells[0], {
    name: 'Spell',
    path: '',
    url: '',
  });

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
  await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  const sourceFoeId = 'task07-canonical-clone-source';
  const bucket = getStorage(app).bucket();
  const seeded = await seedCanonicalFoe({bucket, sourceFoeId});

  await assert.rejects(
    invokeCallable('duplicateFoeWithAssets', {
      sourceFoeId,
      newFoeName: 'Unsafe compatibility duplicate',
    }),
    /Media-bearing foes require canonical Task 07 duplication/
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
  await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
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
  await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
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
  await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
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
  await db.doc('utils/task07_media').set(task07FoeWriteConfig(actor.uid));
  const sourceFoeId = 'task07-canonical-terminal-source';
  const bucket = getStorage(app).bucket();
  const seeded = await seedCanonicalFoe({bucket, sourceFoeId});
  await bucket.file(seeded.objects[0].path).delete();
  const request = {
    sourceFoeId,
    newFoeName: 'Task 07 repaired duplicate',
  };

  await withRawBackgroundTriggersDisabled(async () => {
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
  await waitForCallableReadiness();

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
  let {operation} = await seedLegacyFoeRecoveryReceipt({
    ...request,
    operationId: FOE_ACTIVE_LEASE_ID,
  });
  const leaseOwner = 'another-invocation';
  await operation.ref.update({
    status: 'running',
    phase: 'copy-assets',
    retryable: false,
    leaseOwner,
    leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    result: FieldValue.delete(),
    completedAt: FieldValue.delete(),
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
  let {operation} = await seedLegacyFoeRecoveryReceipt({
    ...request,
    operationId: FOE_CLEANUP_OWNER_ID,
  });
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
      result: FieldValue.delete(),
      completedAt: FieldValue.delete(),
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
  let {operation} = await seedLegacyFoeRecoveryReceipt({
    ...request,
    operationId: FOE_GATE_CLEANUP_ID,
  });
  const [entry] = operation.get('assetManifest');
  const bucket = getStorage(app).bucket();
  await bucket.file(entry.destinationPath).save(Buffer.from('owned-copy'));
  await operation.ref.update({
    status: 'failed',
    phase: 'copy-assets',
    retryable: true,
    result: FieldValue.delete(),
    completedAt: FieldValue.delete(),
  });
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
  for (
    let offset = 0;
    offset < entries.length;
    offset += CALLABLE_MANIFEST_PROBE_BATCH_SIZE
  ) {
    const batch = entries.slice(
      offset,
      offset + CALLABLE_MANIFEST_PROBE_BATCH_SIZE
    );
    for (const entry of batch) {
      reached.push({
        functionId: entry.functionId,
        region: entry.region,
        probe: await probeCallable(entry),
      });
    }
    if (offset + batch.length < entries.length) {
      await withRawBackgroundTriggersDisabled(async () => {}, {
        projectId: PERFORMANCE_PROJECT_ID,
      });
      await waitForCallableReadiness();
    }
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
        functionId === 'spendCharacterPointV2'
      ))
      .map(({functionId, region}) => `${functionId}:${region}`)
      .sort(),
    [
      'spendCharacterPointV2:europe-west8',
    ]
  );
});
