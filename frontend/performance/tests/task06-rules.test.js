const fs = require('fs');
const path = require('path');
const {after, before, test} = require('node:test');
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require('@firebase/rules-unit-testing');
const {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} = require('firebase/firestore');

const PROJECT_ID = 'demo-fnd-perf';

let environment;

const npcDocument = (overrides = {}) => ({
  nome: 'Task 06 NPC',
  imageUrl: 'https://example.invalid/task06.png',
  imagePath: 'echi_npcs/task06-dm/task06.png',
  description: 'Rules fixture',
  notes: '',
  createdBy: 'task06-dm',
  createdByRole: 'dm',
  createdAt: new Date('2026-07-23T00:00:00.000Z'),
  updatedAt: new Date('2026-07-23T00:00:00.000Z'),
  ...overrides,
});

const customTokenDocument = (tokenId, overrides = {}) => ({
  ownerUid: 'task06-dm',
  characterId: '',
  label: 'Task 06 token',
  imageUrl: 'https://example.invalid/task06-token.png',
  imagePath: 'grigliata/custom/task06-token.png',
  tokenType: 'custom',
  customTokenRole: 'template',
  customTemplateId: tokenId,
  imageSource: 'uploaded',
  notes: '',
  stats: {},
  updatedAt: new Date('2026-07-23T00:00:00.000Z'),
  updatedBy: 'task06-dm',
  ...overrides,
});

const placementDocument = (tokenId, overrides = {}) => ({
  backgroundId: 'task06-bg',
  tokenId,
  ownerUid: 'task06-dm',
  label: 'Task 06 token',
  imageUrl: 'https://example.invalid/task06-token.png',
  col: 1,
  row: 1,
  isVisibleToPlayers: true,
  isDead: false,
  statuses: [],
  updatedAt: new Date('2026-07-23T00:00:00.000Z'),
  updatedBy: 'task06-dm',
  ...overrides,
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(
        path.resolve(__dirname, '..', '..', 'firestore.rules'),
        'utf8'
      ),
    },
  });

  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'users/task06-player'), {
        role: 'player',
        characterId: 'task06-character',
      }),
      setDoc(doc(firestore, 'users/task06-dm'), {role: 'dm'}),
      setDoc(doc(firestore, 'users/task06-webmaster'), {role: 'webmaster'}),
      setDoc(doc(firestore, 'app_config/task06_backend'), {
        schemaVersion: 1,
        derivedOwnerMode: 'authoritative',
        enabledOperationKinds: ['level-up-all'],
      }),
      setDoc(doc(firestore, 'backend_operations/private-operation'), {
        actorUid: 'task06-dm',
        input: {privateTarget: 'task06-player'},
        status: 'running',
      }),
      setDoc(doc(
        firestore,
        'backend_operations/private-operation/subjects/private-subject'
      ), {
        outcome: 'succeeded',
      }),
      setDoc(doc(firestore, 'backend_operation_work/private-work'), {
        receiptId: 'private-operation',
        status: 'pending',
      }),
      setDoc(doc(firestore, 'user_operations/private-receipt'), {
        actorUid: 'task06-dm',
        requestHash: 'private',
      }),
      setDoc(doc(firestore, 'echi_npcs/active-npc'), npcDocument()),
      setDoc(doc(firestore, 'echi_npcs/pending-npc'), npcDocument({
        deletionState: 'pending',
        deletionRequestedBy: 'task06-dm',
        deletionRequestedAt: new Date('2026-07-23T00:01:00.000Z'),
      })),
      setDoc(doc(firestore, 'map_markers/pending-public-marker'), {
        npcId: 'pending-npc',
        label: 'Pending',
      }),
      setDoc(doc(
        firestore,
        'users/task06-player/map_markers_private/pending-private-marker'
      ), {
        npcId: 'pending-npc',
        label: 'Pending private',
      }),
      setDoc(doc(firestore, 'encounters/active-encounter'), {
        status: 'active',
        participantIds: ['task06-player'],
        participantCharacterIds: ['task06-character'],
      }),
      setDoc(doc(firestore, 'encounters/pending-encounter'), {
        status: 'deleted',
        deletionState: 'pending',
        participantIds: ['task06-player'],
        participantCharacterIds: ['task06-character'],
      }),
      setDoc(doc(
        firestore,
        'encounters/pending-encounter/participants/task06-player'
      ), {
        uid: 'task06-player',
      }),
      setDoc(
        doc(firestore, 'grigliata_tokens/task06-active-template'),
        customTokenDocument('task06-active-template')
      ),
      setDoc(
        doc(firestore, 'grigliata_tokens/task06-pending-template'),
        customTokenDocument('task06-pending-template', {
          task06Deletion: {
            status: 'pending',
            operationReceiptId: 'task06-delete-operation',
          },
        })
      ),
      setDoc(
        doc(firestore, 'grigliata_tokens/task06-existing-pending-instance'),
        customTokenDocument('task06-existing-pending-instance', {
          customTokenRole: 'instance',
          customTemplateId: 'task06-pending-template',
        })
      ),
    ]);
  });
});

after(async () => {
  await environment?.clearFirestore();
  await environment?.cleanup();
});

test('Task 06 operation control, work, subject, and receipt documents stay server-only', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('task06-player').firestore();
  const dm = environment.authenticatedContext('task06-dm').firestore();
  const webmaster = environment.authenticatedContext('task06-webmaster').firestore();
  const contexts = [anonymous, player, dm, webmaster];
  const hiddenPaths = [
    'backend_operations/private-operation',
    'backend_operations/private-operation/subjects/private-subject',
    'backend_operation_work/private-work',
    'user_operations/private-receipt',
  ];

  for (const firestore of contexts) {
    for (const documentPath of hiddenPaths) {
      await assertFails(getDoc(doc(firestore, documentPath)));
      await assertFails(setDoc(doc(firestore, documentPath), {client: true}));
      await assertFails(updateDoc(doc(firestore, documentPath), {client: true}));
      await assertFails(deleteDoc(doc(firestore, documentPath)));
    }
  }
});

test('Task 06 rollout config is operator-readable and server-owned', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  const player = environment.authenticatedContext('task06-player').firestore();
  const dm = environment.authenticatedContext('task06-dm').firestore();
  const webmaster = environment.authenticatedContext('task06-webmaster').firestore();
  const configPath = 'app_config/task06_backend';

  await assertFails(getDoc(doc(anonymous, configPath)));
  await assertFails(getDoc(doc(player, configPath)));
  await assertSucceeds(getDoc(doc(dm, configPath)));
  await assertSucceeds(getDoc(doc(webmaster, configPath)));

  for (const firestore of [anonymous, player, dm, webmaster]) {
    await assertFails(setDoc(doc(firestore, configPath), {
      schemaVersion: 1,
      derivedOwnerMode: 'authoritative',
      enabledOperationKinds: [],
    }));
    await assertFails(updateDoc(doc(firestore, configPath), {
      derivedOwnerMode: 'legacy',
    }));
    await assertFails(deleteDoc(doc(firestore, configPath)));
  }
});

test('pending NPC deletion fences the document and every referencing marker write', async () => {
  const player = environment.authenticatedContext('task06-player').firestore();
  const dm = environment.authenticatedContext('task06-dm').firestore();
  const webmaster = environment.authenticatedContext('task06-webmaster').firestore();
  const pendingNpc = doc(dm, 'echi_npcs/pending-npc');

  await assertSucceeds(getDoc(pendingNpc));
  await assertFails(updateDoc(pendingNpc, {
    description: 'must remain fenced',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(pendingNpc));
  await assertFails(deleteDoc(doc(webmaster, 'echi_npcs/pending-npc')));

  await assertFails(setDoc(doc(dm, 'map_markers/new-pending-reference'), {
    npcId: 'pending-npc',
  }));
  await assertFails(updateDoc(
    doc(dm, 'map_markers/pending-public-marker'),
    {label: 'must remain fenced'}
  ));
  await assertFails(deleteDoc(
    doc(dm, 'map_markers/pending-public-marker')
  ));
  await assertFails(setDoc(doc(
    player,
    'users/task06-player/map_markers_private/new-pending-reference'
  ), {
    npcId: 'pending-npc',
  }));
  await assertFails(deleteDoc(doc(
    player,
    'users/task06-player/map_markers_private/pending-private-marker'
  )));

  await assertSucceeds(setDoc(doc(dm, 'map_markers/active-reference'), {
    npcId: 'active-npc',
  }));
  await assertSucceeds(updateDoc(doc(dm, 'echi_npcs/active-npc'), {
    description: 'Allowed text-only edit',
    updatedAt: serverTimestamp(),
  }));
});

test('pending encounter deletion fences the parent and descendants', async () => {
  const player = environment.authenticatedContext('task06-player').firestore();
  const dm = environment.authenticatedContext('task06-dm').firestore();
  const webmaster = environment.authenticatedContext('task06-webmaster').firestore();
  const pendingPath = 'encounters/pending-encounter';

  await assertSucceeds(getDoc(doc(player, pendingPath)));
  await assertSucceeds(getDoc(doc(dm, pendingPath)));
  await assertSucceeds(getDoc(doc(webmaster, pendingPath)));
  await assertFails(updateDoc(doc(dm, pendingPath), {name: 'must remain fenced'}));
  await assertFails(deleteDoc(doc(dm, pendingPath)));
  await assertFails(setDoc(doc(
    dm,
    `${pendingPath}/participants/new-participant`
  ), {
    uid: 'new-participant',
  }));
  await assertFails(deleteDoc(doc(
    dm,
    `${pendingPath}/participants/task06-player`
  )));
  await assertFails(setDoc(doc(dm, `${pendingPath}/logs/new-log`), {
    message: 'must remain fenced',
  }));

  await assertSucceeds(updateDoc(
    doc(dm, 'encounters/active-encounter'),
    {name: 'Allowed active edit'}
  ));
  await assertSucceeds(setDoc(doc(
    dm,
    'encounters/active-encounter/participants/second'
  ), {
    uid: 'second',
  }));
});

test('encounter parent and participants can still be created atomically', async () => {
  const dm = environment.authenticatedContext('task06-dm').firestore();
  const batch = writeBatch(dm);
  batch.set(doc(dm, 'encounters/batched-encounter'), {
    status: 'active',
    participantIds: ['task06-player'],
    participantCharacterIds: ['task06-character'],
  });
  batch.set(doc(
    dm,
    'encounters/batched-encounter/participants/task06-player'
  ), {
    uid: 'task06-player',
  });
  await assertSucceeds(batch.commit());
});

test('pending custom-token deletion fences instances, placements, and token updates', async () => {
  const dm = environment.authenticatedContext('task06-dm').firestore();

  await assertSucceeds(setDoc(
    doc(dm, 'grigliata_tokens/task06-active-instance'),
    customTokenDocument('task06-active-instance', {
      customTokenRole: 'instance',
      customTemplateId: 'task06-active-template',
    })
  ));
  await assertFails(setDoc(
    doc(dm, 'grigliata_tokens/task06-pending-instance'),
    customTokenDocument('task06-pending-instance', {
      customTokenRole: 'instance',
      customTemplateId: 'task06-pending-template',
    })
  ));

  await assertSucceeds(setDoc(
    doc(dm, 'grigliata_token_placements/task06-bg__task06-active-template'),
    placementDocument('task06-active-template')
  ));
  await assertSucceeds(setDoc(
    doc(dm, 'grigliata_token_placements/task06-bg__task06-player'),
    placementDocument('task06-player', {
      ownerUid: 'task06-player',
    })
  ));
  await assertFails(setDoc(
    doc(dm, 'grigliata_token_placements/task06-bg__task06-pending-template'),
    placementDocument('task06-pending-template')
  ));
  await assertFails(updateDoc(
    doc(dm, 'grigliata_tokens/task06-pending-template'),
    {
      label: 'must remain fenced',
      updatedAt: serverTimestamp(),
      updatedBy: 'task06-dm',
    }
  ));
  await assertFails(deleteDoc(
    doc(dm, 'grigliata_tokens/task06-pending-template')
  ));
  await assertFails(updateDoc(
    doc(dm, 'grigliata_tokens/task06-existing-pending-instance'),
    {
      label: 'must remain parent-fenced',
      updatedAt: serverTimestamp(),
      updatedBy: 'task06-dm',
    }
  ));
  await assertFails(deleteDoc(
    doc(dm, 'grigliata_tokens/task06-existing-pending-instance')
  ));
  await assertSucceeds(updateDoc(
    doc(dm, 'grigliata_tokens/task06-active-instance'),
    {
      label: 'active instance remains editable',
      updatedAt: serverTimestamp(),
      updatedBy: 'task06-dm',
    }
  ));
  await assertSucceeds(deleteDoc(
    doc(dm, 'grigliata_tokens/task06-active-instance')
  ));
});
