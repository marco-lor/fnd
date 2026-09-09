const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} = require('firebase/firestore');
const {
  deleteObject,
  getMetadata,
  ref,
  uploadString,
} = require('firebase/storage');

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-fnd-perf',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.resolve(__dirname, '..', '..', 'firestore.rules'), 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: fs.readFileSync(path.resolve(__dirname, '..', '..', 'storage.rules'), 'utf8'),
    },
  });
});

after(async () => environment?.cleanup());

test('webmaster creation preflight reads missing IDs without exposing hidden items or permitting client writes', async () => {
  const userId = 'task09-preflight-webmaster';
  const hiddenId = 'task09-preflight-hidden';
  const missingId = 'task09-preflight-new';
  const webmaster = environment.authenticatedContext(userId).firestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', userId), {role: 'webmaster'});
    await setDoc(doc(context.firestore(), 'items', hiddenId), {visibility: 'none'});
  });
  try {
    const missing = await assertSucceeds(getDoc(doc(webmaster, 'items', missingId)));
    assert.equal(missing.exists(), false);
    await assertFails(getDoc(doc(webmaster, 'items', hiddenId)));
    await assertFails(getDocs(collection(webmaster, 'items')));
    await assertFails(setDoc(doc(webmaster, 'items', missingId), {visibility: 'all'}));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'items', missingId)));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', userId), {role: 'player'});
    });
    await assertFails(getDoc(doc(webmaster, 'items', missingId)));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', userId), {role: 'webmaster', deletionState: 'pending'});
    });
    await assertFails(getDoc(doc(webmaster, 'items', missingId)));
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'users', userId));
      await deleteDoc(doc(context.firestore(), 'items', hiddenId));
      await deleteDoc(doc(context.firestore(), 'items', missingId));
    });
  }
});

test('anonymous, player, DM, and webmaster rules match their intended boundaries', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();

  await assertFails(getDoc(doc(anonymous, 'users/perf-player')));
  await assertFails(getDoc(doc(anonymous, 'items/item-0000')));
  await assertSucceeds(getDoc(doc(player, 'users/perf-player')));
  await assertFails(getDoc(doc(player, 'users/perf-peer-2')));
  await assertFails(getDoc(doc(player, 'foes/foe-0000')));
  await assertSucceeds(getDoc(doc(dm, 'foes/foe-0000')));
  await assertSucceeds(getDoc(doc(webmaster, 'users/perf-player')));
});

test('DM wall runtime cleanup can replace segments with a rule-safe empty map', async () => {
  const backgroundId = 'rules-wall-runtime-cleanup';
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dmWallStateRef = doc(dm, 'grigliata_wall_state', backgroundId);
  const playerWallStateRef = doc(player, 'grigliata_wall_state', backgroundId);

  try {
    await assertSucceeds(setDoc(dmWallStateRef, {
      backgroundId,
      segments: {
        'wall-1': {
          isOpen: true,
          updatedAt: Timestamp.now(),
          updatedBy: 'perf-dm',
        },
      },
      updatedAt: Timestamp.now(),
      updatedBy: 'perf-dm',
    }));

    await assertFails(setDoc(playerWallStateRef, {
      backgroundId,
      segments: {},
      updatedAt: Timestamp.now(),
      updatedBy: 'perf-player',
    }, {merge: true}));

    await assertSucceeds(setDoc(dmWallStateRef, {
      backgroundId,
      segments: {},
      updatedAt: Timestamp.now(),
      updatedBy: 'perf-dm',
    }, {merge: true}));

    const wallState = await assertSucceeds(getDoc(dmWallStateRef));
    assert.deepEqual(wallState.data().segments, {});
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), 'grigliata_wall_state', backgroundId));
    });
  }
});

test('shared character profile queries stay authorized in six safe 10-id chunks', async () => {
  const characterIds = Array.from(
    {length: 60},
    (_, index) => `rules-shared-character-${String(index + 1).padStart(2, '0')}`
  );
  const ownedCustomId = 'rules-shared-owned-custom';
  const peerCustomId = 'rules-shared-peer-custom';
  const peerFoeId = 'rules-shared-peer-foe';
  const seededIds = [...characterIds, ownedCustomId, peerCustomId, peerFoeId];

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      ...characterIds.map((id) => setDoc(doc(firestore, 'grigliata_tokens', id), {
        ownerUid: id,
        characterId: id,
        label: id,
        tokenType: 'character',
        imageSource: 'profile',
      })),
      setDoc(doc(firestore, 'grigliata_tokens', ownedCustomId), {
        ownerUid: 'perf-player',
        label: ownedCustomId,
        tokenType: 'custom',
        customTokenRole: 'template',
        customTemplateId: ownedCustomId,
        imageSource: 'uploaded',
      }),
      setDoc(doc(firestore, 'grigliata_tokens', peerCustomId), {
        ownerUid: 'perf-peer-2',
        label: peerCustomId,
        tokenType: 'custom',
        customTokenRole: 'template',
        customTemplateId: peerCustomId,
        imageSource: 'uploaded',
      }),
      setDoc(doc(firestore, 'grigliata_tokens', peerFoeId), {
        ownerUid: 'perf-dm',
        label: peerFoeId,
        tokenType: 'foe',
        imageSource: 'foesHub',
      }),
    ]);
  });

  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const buildCharacterQuery = (firestore, ids) => query(
    collection(firestore, 'grigliata_tokens'),
    where(documentId(), 'in', ids),
    where('tokenType', '==', 'character')
  );

  try {
    await assertFails(getDocs(buildCharacterQuery(anonymous, characterIds.slice(0, 10))));
    await assertFails(getDocs(query(
      collection(player, 'grigliata_tokens'),
      where(documentId(), 'in', [
        ...characterIds.slice(0, 9),
        peerCustomId,
      ])
    )));

    for (let offset = 0; offset < characterIds.length; offset += 10) {
      const ids = characterIds.slice(offset, offset + 10);
      const playerPage = await assertSucceeds(getDocs(buildCharacterQuery(player, ids)));
      const dmPage = await assertSucceeds(getDocs(buildCharacterQuery(dm, ids)));
      assert.deepEqual(playerPage.docs.map(({id}) => id).sort(), ids);
      assert.deepEqual(dmPage.docs.map(({id}) => id).sort(), ids);
    }

    await assertSucceeds(getDoc(doc(player, 'grigliata_tokens', characterIds[0])));
    await assertFails(getDoc(doc(player, 'grigliata_tokens', peerCustomId)));
    await assertFails(getDoc(doc(player, 'grigliata_tokens', peerFoeId)));
    const ownedCustom = await assertSucceeds(getDocs(query(
      collection(player, 'grigliata_tokens'),
      where('ownerUid', '==', 'perf-player'),
      where('tokenType', '==', 'custom'),
      where(documentId(), 'in', [ownedCustomId])
    )));
    assert.deepEqual(ownedCustom.docs.map(({id}) => id), [ownedCustomId]);
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await Promise.all(seededIds.map((id) => (
        deleteDoc(doc(firestore, 'grigliata_tokens', id))
      )));
    });
  }
});

test('roles cannot be changed through a direct privileged client update', async () => {
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();
  await assertFails(updateDoc(doc(webmaster, 'users/perf-player'), { role: 'dm' }));
});

test('shared config and Codex repository documents keep the existing role matrix', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const signedIn = [
    environment.authenticatedContext('perf-player').firestore(),
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const documentIds = [
    'varie',
    'schema_pg',
    'schema_weapon',
    'schema_armatura',
    'schema_accessorio',
    'schema_consumabile',
    'schema_spell',
    'schema_tecnica',
    'possible_lists',
    'spells_common',
    'tecniche_common',
    'utils',
    'codex',
  ];

  for (const documentId of documentIds) {
    await assertFails(getDoc(doc(anonymous, 'utils', documentId)));
    for (const firestore of signedIn) {
      await assertSucceeds(getDoc(doc(firestore, 'utils', documentId)));
    }
  }
});

const userDirectoryFirstPageQuery = (firestore) => query(
  collection(firestore, 'user_directory'),
  where('role', '==', 'player'),
  orderBy('normalizedLabel', 'asc'),
  orderBy(documentId(), 'asc'),
  limit(50)
);

test('user directory get/list access is restricted to DM and webmaster roles', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();

  await assertFails(getDoc(doc(anonymous, 'user_directory/perf-player')));
  await assertFails(getDoc(doc(player, 'user_directory/perf-player')));
  await assertSucceeds(getDoc(doc(dm, 'user_directory/perf-player')));
  await assertSucceeds(getDoc(doc(webmaster, 'user_directory/perf-player')));

  await assertFails(getDocs(userDirectoryFirstPageQuery(anonymous)));
  await assertFails(getDocs(userDirectoryFirstPageQuery(player)));
  const dmPage = await assertSucceeds(getDocs(userDirectoryFirstPageQuery(dm)));
  const webmasterPage = await assertSucceeds(getDocs(userDirectoryFirstPageQuery(webmaster)));

  assert.equal(dmPage.docs.length, 50);
  assert.equal(webmasterPage.docs.length, 50);
  for (const snapshot of dmPage.docs) {
    assert.deepEqual(Object.keys(snapshot.data()).sort(), [
      'characterId',
      'label',
      'normalizedLabel',
      'role',
      'schemaVersion',
    ]);
    assert.equal(snapshot.data().schemaVersion, 1);
    assert.equal(snapshot.data().role, 'player');
  }
});

test('all user directory client writes are denied', async () => {
  const contexts = [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext('perf-player').firestore(),
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const candidate = {
    schemaVersion: 1,
    characterId: 'Client write',
    label: 'Client write',
    normalizedLabel: 'client write',
    role: 'player',
  };

  for (const firestore of contexts) {
    await assertFails(setDoc(doc(firestore, 'user_directory/client-write-probe'), candidate));
    await assertFails(updateDoc(doc(firestore, 'user_directory/perf-player'), {label: 'Changed'}));
    await assertFails(deleteDoc(doc(firestore, 'user_directory/perf-player')));
  }
});

test('Task 05 private user domains preserve owner, DM, and webmaster read boundaries', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const owner = environment.authenticatedContext('perf-player').firestore();
  const peer = environment.authenticatedContext('perf-peer-2').firestore();
  const dm = environment.authenticatedContext('perf-dm').firestore();
  const webmaster = environment.authenticatedContext('perf-webmaster').firestore();
  const privateDocumentPaths = [
    'users/perf-player/state/progression',
    'users/perf-player/state/resources',
    'users/perf-player/state/settings',
    'users/perf-player/state/equipment',
    'users/perf-player/state/profileContent',
    'users/perf-player/inventory/inventory-probe',
    'users/perf-player/spells/spell-probe',
    'users/perf-player/tecniche/technique-probe',
  ];

  for (const documentPath of privateDocumentPaths) {
    await assertFails(getDoc(doc(anonymous, documentPath)));
    await assertSucceeds(getDoc(doc(owner, documentPath)));
    await assertFails(getDoc(doc(peer, documentPath)));
    await assertSucceeds(getDoc(doc(dm, documentPath)));
    await assertSucceeds(getDoc(doc(webmaster, documentPath)));
  }

  for (const collectionPath of [
    ['users', 'perf-player', 'inventory'],
    ['users', 'perf-player', 'spells'],
    ['users', 'perf-player', 'tecniche'],
  ]) {
    await assertFails(getDocs(collection(anonymous, ...collectionPath)));
    await assertSucceeds(getDocs(collection(owner, ...collectionPath)));
    await assertFails(getDocs(collection(peer, ...collectionPath)));
    await assertSucceeds(getDocs(collection(dm, ...collectionPath)));
    await assertSucceeds(getDocs(collection(webmaster, ...collectionPath)));
  }
});

test('Task 05 user-domain and server-only collections reject every client write', async () => {
  const contexts = [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext('perf-player').firestore(),
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const serverOwnedDocumentPaths = [
    'users/perf-player/state/resources',
    'users/perf-player/inventory/client-write-probe',
    'users/perf-player/spells/client-write-probe',
    'users/perf-player/tecniche/client-write-probe',
    'users/perf-player/content_names/client-write-probe',
    'user_operations/client-write-probe',
    'user_media_cleanup/client-write-probe',
    'migration_state/user-data-v2/runs/client-write-probe',
    'user_deletion_jobs/client-write-probe',
  ];

  for (const firestore of contexts) {
    for (const documentPath of serverOwnedDocumentPaths) {
      await assertFails(setDoc(doc(firestore, documentPath), {schemaVersion: 2}));
      await assertFails(updateDoc(doc(firestore, documentPath), {revision: 2}));
      await assertFails(deleteDoc(doc(firestore, documentPath)));
    }
  }
});

test('Task 05 historical rollout record is private and remains server-owned', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('perf-player').firestore();
  const privileged = [
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const configPath = 'app_config/user_data_v2';

  await assertFails(getDoc(doc(anonymous, configPath)));
  await assertFails(getDoc(doc(player, configPath)));
  await assertFails(setDoc(doc(anonymous, configPath), {mode: 'new-only'}));
  await assertFails(setDoc(doc(player, configPath), {mode: 'new-only'}));
  await assertFails(updateDoc(doc(player, configPath), {mode: 'new-only'}));
  await assertFails(deleteDoc(doc(player, configPath)));
  for (const firestore of privileged) {
    await assertSucceeds(getDoc(doc(firestore, configPath)));
    await assertFails(setDoc(doc(firestore, configPath), {mode: 'new-only'}));
    await assertFails(updateDoc(doc(firestore, configPath), {mode: 'new-only'}));
    await assertFails(deleteDoc(doc(firestore, configPath)));
  }
});

test('Task 05 V2-only blocks legacy aggregates while preserving shell updates', async () => {
  const owner = environment.authenticatedContext('perf-player').firestore();
  const peer = environment.authenticatedContext('perf-peer-2').firestore();
  const newOwner = environment.authenticatedContext('task05-new-owner').firestore();

  try {
    await assertFails(updateDoc(doc(owner, 'users/perf-player'), {
      'stats.hpCurrent': 44,
    }));
    await assertFails(updateDoc(doc(owner, 'users/perf-player'), {
      inventory: [],
    }));
    await assertSucceeds(updateDoc(doc(owner, 'users/perf-player'), {
      username: 'Task 05 shell update',
    }));
    await assertFails(setDoc(doc(newOwner, 'users/task05-new-owner'), {
      role: 'player',
      email: 'task05-new-owner@example.invalid',
      modelVersion: 2,
    }));
    await assertFails(updateDoc(doc(peer, 'users/perf-peer-2'), {
      'stats.hpCurrent': 43,
    }));
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const adminFirestore = context.firestore();
      await updateDoc(doc(adminFirestore, 'users/perf-player'), {
        username: deleteField(),
      });
    });
  }
});

test('Task 05 content-name reservations and operation records are unreadable to clients', async () => {
  const contexts = [
    environment.unauthenticatedContext().firestore(),
    environment.authenticatedContext('perf-player').firestore(),
    environment.authenticatedContext('perf-dm').firestore(),
    environment.authenticatedContext('perf-webmaster').firestore(),
  ];
  const hiddenPaths = [
    'users/perf-player/content_names/name-probe',
    'user_operations/operation-probe',
    'user_media_cleanup/cleanup-probe',
    'migration_state/user-data-v2/runs/run-probe',
    'user_deletion_jobs/deletion-probe',
  ];

  for (const firestore of contexts) {
    for (const documentPath of hiddenPaths) {
      await assertFails(getDoc(doc(firestore, documentPath)));
    }
  }
});

test('Task 05 canonical inventory media is private and client deletion is queue-only', async () => {
  const objectPath = 'users/perf-player/inventory/rules-probe/image.png';
  const anonymous = environment.unauthenticatedContext().storage();
  const owner = environment.authenticatedContext('perf-player').storage();
  const peer = environment.authenticatedContext('perf-peer-2').storage();
  const dm = environment.authenticatedContext('perf-dm').storage();
  const webmaster = environment.authenticatedContext('perf-webmaster').storage();

  await assertSucceeds(uploadString(
    ref(owner, objectPath),
    'task-05-storage-probe',
    'raw',
    {contentType: 'image/png'}
  ));
  await assertFails(getMetadata(ref(anonymous, objectPath)));
  await assertSucceeds(getMetadata(ref(owner, objectPath)));
  await assertFails(getMetadata(ref(peer, objectPath)));
  await assertSucceeds(getMetadata(ref(dm, objectPath)));
  await assertSucceeds(getMetadata(ref(webmaster, objectPath)));

  await assertFails(uploadString(
    ref(peer, 'users/perf-player/inventory/rules-probe/peer.png'),
    'peer-write-probe',
    'raw',
    {contentType: 'image/png'}
  ));
  await assertFails(deleteObject(ref(owner, objectPath)));
  await assertFails(deleteObject(ref(dm, objectPath)));
  await assertFails(deleteObject(ref(webmaster, objectPath)));

  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteObject(ref(context.storage(), objectPath));
  });
});

test('Task 05 canonical profile media also requires server-side queued deletion', async () => {
  const objectPath = 'users/perf-player/profile/rules-probe.png';
  const owner = environment.authenticatedContext('perf-player').storage();
  const dm = environment.authenticatedContext('perf-dm').storage();
  const webmaster = environment.authenticatedContext('perf-webmaster').storage();

  await assertSucceeds(uploadString(
    ref(owner, objectPath),
    'task-05-profile-storage-probe',
    'raw',
    {contentType: 'image/png'}
  ));
  await assertFails(deleteObject(ref(owner, objectPath)));
  await assertFails(deleteObject(ref(dm, objectPath)));
  await assertFails(deleteObject(ref(webmaster, objectPath)));

  await environment.withSecurityRulesDisabled(async (context) => {
    await deleteObject(ref(context.storage(), objectPath));
  });
});

test('Task 05 deletion tombstones fence root recreation and every owner write plane', async () => {
  const pendingUid = 'task05-pending-owner';
  const deletedUid = 'task05-deleted-owner';
  const pendingFirestore = environment.authenticatedContext(pendingUid).firestore();
  const deletedFirestore = environment.authenticatedContext(deletedUid).firestore();
  const pendingStorage = environment.authenticatedContext(pendingUid).storage();
  const dmStorage = environment.authenticatedContext('perf-dm').storage();

  await environment.withSecurityRulesDisabled(async (context) => {
    const adminFirestore = context.firestore();
    await setDoc(doc(adminFirestore, `users/${pendingUid}`), {
      role: 'player',
      email: 'pending@example.invalid',
      deletionState: 'pending',
      stats: {level: 1},
    });
    await setDoc(doc(adminFirestore, `user_deletion_jobs/${pendingUid}`), {
      schemaVersion: 2,
      targetUid: pendingUid,
      stage: 'pending',
    });
    await setDoc(doc(adminFirestore, `user_deletion_jobs/${deletedUid}`), {
      schemaVersion: 2,
      targetUid: deletedUid,
      stage: 'completed',
    });
  });

  try {
    await assertFails(updateDoc(doc(pendingFirestore, `users/${pendingUid}`), {
      username: 'must-not-write',
    }));
    await assertFails(setDoc(
      doc(pendingFirestore, `users/${pendingUid}/diceRolls/probe`),
      {result: 20}
    ));
    await assertFails(setDoc(
      doc(pendingFirestore, `users/${pendingUid}/map_markers_private/probe`),
      {lat: 0, lng: 0}
    ));
    await assertFails(setDoc(
      doc(pendingFirestore, 'map_markers/task05-pending-owner-probe'),
      {lat: 0, lng: 0}
    ));
    await assertFails(setDoc(doc(deletedFirestore, `users/${deletedUid}`), {
      role: 'player',
      email: 'recreated@example.invalid',
    }));

    await assertFails(uploadString(
      ref(pendingStorage, `users/${pendingUid}/profile/probe.png`),
      'blocked-profile',
      'raw',
      {contentType: 'image/png'}
    ));
    await assertFails(uploadString(
      ref(dmStorage, `users/${pendingUid}/inventory/probe/dm.png`),
      'blocked-manager-to-pending-target',
      'raw',
      {contentType: 'image/png'}
    ));
    await assertFails(uploadString(
      ref(pendingStorage, `characters/avatar_${pendingUid}.png`),
      'blocked-legacy',
      'raw',
      {contentType: 'image/png'}
    ));
    await assertFails(uploadString(
      ref(pendingStorage, `grigliata/tokens/${pendingUid}/probe.png`),
      'blocked-grigliata-owner',
      'raw',
      {contentType: 'image/png'}
    ));
  } finally {
    await environment.withSecurityRulesDisabled(async (context) => {
      const adminFirestore = context.firestore();
      await deleteDoc(doc(adminFirestore, `users/${pendingUid}`));
      await deleteDoc(doc(adminFirestore, `user_deletion_jobs/${pendingUid}`));
      await deleteDoc(doc(adminFirestore, `user_deletion_jobs/${deletedUid}`));
      await deleteDoc(doc(adminFirestore, 'map_markers/task05-pending-owner-probe'));
    });
  }
});
