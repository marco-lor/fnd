const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {after, before, test} = require('node:test');
const {assertFails, assertSucceeds, initializeTestEnvironment} = require('@firebase/rules-unit-testing');
const {deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch} = require('firebase/firestore');
const {configureOwnedPerformanceEnvironment, projectId} = require('../../scripts/performance/common');

configureOwnedPerformanceEnvironment({mode: 'strict'});
const actors = {
  dm: 'task14g-dm', owner: 'task14g-owner', peer: 'task14g-peer',
  webmaster: 'task14g-webmaster', pending: 'task14g-pending', deleted: 'task14g-deleted',
};
const fixedTime = Timestamp.fromMillis(1780000000000);
const seededPaths = new Set();
let environment;

// Synthetic values with the complete persisted video-map descriptor shape.
// No production identifiers, URLs, credentials, or recovery snapshots are used.
const mediaFile = (role, contentType, width, height, durationMs) => ({
  bytes: 120000, cacheControl: 'private, max-age=31536000, immutable',
  checksum: 'b'.repeat(64), contentType, durationMs, generation: '1234567890',
  height, orientationDegrees: 0,
  path: `media_assets/v1/signed-in/${actors.dm}/m_${'a'.repeat(40)}/1234567890/${role}`,
  role, width,
});
const videoMedia = {
  assetId: `m_${'a'.repeat(40)}`, audience: 'signed-in', contractVersion: 1,
  generation: '1234567890', kind: 'map-video',
  original: mediaFile('original', 'video/mp4', 1920, 1080, 30000),
  ownerUid: actors.dm, processing: {authoritative: true, fallbackCode: null},
  schemaVersion: 1, state: 'ready',
  variants: {
    poster: mediaFile('poster', 'image/webp', 960, 540, null),
    poster2x: mediaFile('poster2x', 'image/webp', 1920, 1080, null),
  },
};
const makeEffect = (index) => ({
  id: `effect-${index}`, kind: index === 0 ? 'shield' : `duration-${index}`,
  totalTurns: 2, remainingTurns: 2, appliesFromTurnCounter: 1,
});
const effects = (count) => Array.from({length: count}, (_, index) => makeEffect(index));

const seed = async (documentPath, data) => {
  seededPaths.add(documentPath);
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), documentPath), data));
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId, firestore: {host: '127.0.0.1', port: 8080,
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8')},
  });
  for (const [name, uid] of Object.entries(actors)) {
    await seed(`users/${uid}`, {
      role: name === 'dm' || name === 'pending' || name === 'deleted' ? 'dm'
        : name === 'webmaster' ? 'webmaster' : 'player',
      ...(name === 'pending' ? {deletionState: 'pending'} : {}),
    });
  }
  await seed(`user_deletion_jobs/${actors.deleted}`, {status: 'pending'});
});

after(async () => {
  try {
    await environment?.withSecurityRulesDisabled(async (context) => {
      for (const documentPath of seededPaths) await deleteDoc(doc(context.firestore(), documentPath));
    });
  } finally {
    await environment?.cleanup();
  }
});

const fixture = async (name, turnEffects = effects(2), placementPatch = {}, tokenPatch = {}) => {
  const backgroundId = `task14g-map-${name}`;
  const tokenId = `task14g-token-${name}`;
  const placementId = `${backgroundId}__${tokenId}`;
  const placement = {
    backgroundId, tokenId, ownerUid: actors.owner, label: 'Synthetic custom token',
    imageUrl: 'https://example.invalid/token.webp', col: 20, row: 13,
    sizeSquares: 1, isVisibleToPlayers: true, isDead: false, statuses: ['shielded'],
    visionEnabled: true, visionRadiusSquares: 12,
    isInTurnOrder: true, turnOrderInitiative: 10, turnOrderJoinedAt: fixedTime,
    turnEffects, updatedAt: fixedTime, updatedBy: actors.dm, ...placementPatch,
  };
  await seed(`grigliata_backgrounds/${backgroundId}`, {
    assetType: 'video', contentType: 'video/mp4', createdAt: fixedTime,
    createdBy: actors.dm, durationMs: 30000, fileName: 'synthetic-map.mp4',
    galleryFolderAssignedAt: fixedTime, galleryFolderAssignedBy: actors.dm,
    galleryFolderId: 'synthetic-folder', grid: {cellSizePx: 64, offsetXPx: 3, offsetYPx: 2},
    imageHeight: 1080, imageWidth: 1920, imagePath: videoMedia.original.path,
    imageUrl: 'https://example.invalid/synthetic-map.mp4', isGridVisible: true,
    lightingEnabled: true,
    lightingSummary: {alignmentStatus: 'aligned', importedAt: fixedTime, lightCount: 4,
      schemaVersion: 1, sourceType: 'synthetic', wallCount: 20},
    media: videoMedia, mediaUpdatedAt: fixedTime, name: 'Synthetic video map',
    sizeBytes: 120000, task07MediaRevision: 1, updatedAt: fixedTime, updatedBy: actors.dm,
  });
  await seed(`grigliata_tokens/${tokenId}`, {
    ownerUid: actors.owner, label: placement.label, imageUrl: placement.imageUrl,
    imagePath: `grigliata/tokens/${actors.owner}/synthetic.webp`,
    tokenType: 'custom', customTokenRole: 'instance', customTemplateId: 'task14g-template',
    imageSource: 'uploaded', stats: {shieldCurrent: 5, shieldTotal: 5},
    createdAt: fixedTime, createdBy: actors.dm, updatedAt: fixedTime, updatedBy: actors.dm,
    ...tokenPatch,
  });
  await seed(`grigliata_token_placements/${placementId}`, placement);
  return {backgroundId, tokenId, placementId, placement};
};

const client = (uid = actors.dm) => uid === null
  ? environment.unauthenticatedContext().firestore()
  : environment.authenticatedContext(uid).firestore();

const assertDenied = async (operation, {allowExistingGeneralBudgetDenial = false} = {}) => {
  const error = await assertFails(operation);
  assert.equal(error.code, 'permission-denied');
  if (allowExistingGeneralBudgetDenial) {
    // Only explicit pre-existing invalid general writes use this exception.
    // Fast turn-path denials must prove validation/authorization within budget.
    if (/maximum of 1000 expressions/.test(error.message)) {
      console.log('Preserved general-write limitation: denial reached the expression budget.');
    }
  } else assert.doesNotMatch(error.message, /maximum of 1000 expressions/);
};

const turnBatch = (state, {uid = actors.dm, turnCounter = 1, placementPatch = {}, backgroundPatch = {}, expireShield = false} = {}) => {
  const db = client(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, 'grigliata_backgrounds', state.backgroundId), {
    turnOrderActive: {tokenId: state.tokenId, initiative: 10, joinedAt: fixedTime,
      label: typeof state.placement.label === 'string' ? state.placement.label : '', startedAt: serverTimestamp()},
    updatedAt: serverTimestamp(), updatedBy: uid, ...backgroundPatch,
  }, {merge: true});
  batch.set(doc(db, 'grigliata_token_placements', state.placementId), {
    tokenId: state.tokenId, turnCounter,
    turnEffects: state.placement.turnEffects.length ? state.placement.turnEffects : deleteField(),
    updatedAt: serverTimestamp(), updatedBy: uid,
    ...placementPatch,
  }, {merge: true});
  if (expireShield) batch.set(doc(db, 'grigliata_tokens', state.tokenId), {
    stats: {shieldCurrent: 0, shieldTotal: 0}, updatedAt: serverTimestamp(), updatedBy: uid,
  }, {merge: true});
  return batch.commit();
};

for (const count of Array.from({length: 13}, (_, index) => index)) test(`custom-token start and advance batches accept ${count} effects on a complete video map`, async () => {
  const state = await fixture(`count-${count}`, effects(count));
  await assertSucceeds(turnBatch(state));
  await assertSucceeds(turnBatch(state, {turnCounter: 2,
    placementPatch: {turnEffects: count
      ? effects(count).map((effect) => ({...effect, remainingTurns: 1})) : deleteField()}}));
  const stored = (await getDoc(doc(client(), 'grigliata_token_placements', state.placementId))).data();
  assert.equal(stored.turnCounter, 2);
  assert.equal((stored.turnEffects || []).length, count);
  assert.ok((stored.turnEffects || []).every((effect) => effect.remainingTurns === 1));
  for (const field of ['label', 'imageUrl', 'col', 'row', 'sizeSquares', 'statuses',
    'isVisibleToPlayers', 'isDead', 'visionEnabled', 'visionRadiusSquares',
    'isInTurnOrder', 'turnOrderInitiative', 'turnOrderJoinedAt']) {
    assert.deepEqual(stored[field], state.placement[field]);
  }
  await assertSucceeds(turnBatch(state, {turnCounter: 3, expireShield: count > 0,
    placementPatch: {turnEffects: deleteField()}}));
  const expired = (await getDoc(doc(client(), 'grigliata_token_placements', state.placementId))).data();
  assert.equal(expired.turnCounter, 3);
  assert.equal(expired.turnEffects, undefined);
  if (count > 0) assert.deepEqual((await getDoc(doc(client(), 'grigliata_tokens', state.tokenId))).data().stats,
    {shieldCurrent: 0, shieldTotal: 0});
});

test('effect identifiers and kinds preserve all nonempty strings', async () => {
  const values = ['\n', 'first\nsecond', '😀', '\u0000', ' '];
  const list = effects(12).map((effect, index) => ({...effect,
    id: values[index % values.length], kind: values[(index + 1) % values.length]}));
  const state = await fixture('effect-text', list);
  await assertSucceeds(turnBatch(state));
  const stored = (await getDoc(doc(client(), 'grigliata_token_placements', state.placementId))).data();
  assert.deepEqual(stored.turnEffects, list);
});

test('optional placement fields retain omission defaults and reject explicit invalid values', async () => {
  const state = await fixture('optional-fields', []);
  const ref = doc(client(), 'grigliata_token_placements', state.placementId);
  await environment.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), ref.path)));
  await assertSucceeds(setDoc(ref, {
    backgroundId: state.backgroundId, tokenId: state.tokenId, ownerUid: actors.owner,
    col: 0, row: 0, isDead: false, updatedAt: fixedTime, updatedBy: null,
  }));
  for (const patch of [
    {label: null}, {label: 1}, {imageUrl: null}, {imageUrl: true}, {tokenId: null},
    {sizeSquares: null}, {sizeSquares: 0}, {sizeSquares: 10}, {sizeSquares: 1.5},
    {isVisibleToPlayers: null}, {isVisibleToPlayers: 0}, {isDead: null},
    {visionEnabled: null}, {visionEnabled: 0},
    {visionRadiusSquares: null}, {visionRadiusSquares: 0}, {visionRadiusSquares: 61},
    {visionRadiusSquares: 1.5}, {isInTurnOrder: null}, {isInTurnOrder: 0},
    {turnOrderInitiative: null}, {turnOrderInitiative: 1.5},
    {turnOrderJoinedAt: null}, {turnOrderJoinedAt: 'timestamp'},
    {turnCounter: null}, {turnCounter: -1}, {turnCounter: 1.5},
    {statuses: null}, {statuses: 'shielded'}, {statuses: ['unknown']},
    {statuses: Array.from({length: 22}, () => 'shielded')}, {unexpected: true},
  ]) await assertDenied(updateDoc(ref, patch));
  for (const field of ['backgroundId', 'tokenId', 'ownerUid', 'col', 'row', 'isDead', 'updatedAt', 'updatedBy']) {
    await assertDenied(updateDoc(ref, {[field]: deleteField()}));
  }
});

// Full maximum-effect creation has a pre-existing expression-budget limitation.
// This regression gate covers existing-placement turn updates, plus ordinary
// creation and owner/DM boundaries; it does not claim to fix that limitation.
test('ordinary placements can be created, joined, moved by their owner, and deleted by the DM', async () => {
  const state = await fixture('create-owner-delete', []);
  await environment.withSecurityRulesDisabled((context) => deleteDoc(doc(context.firestore(), 'grigliata_token_placements', state.placementId)));
  await assertSucceeds(setDoc(doc(client(), 'grigliata_token_placements', state.placementId), state.placement));
  await assertSucceeds(updateDoc(doc(client(actors.owner), 'grigliata_token_placements', state.placementId), {
    isInTurnOrder: false, turnOrderJoinedAt: deleteField(), updatedBy: actors.owner,
  }));
  await assertSucceeds(updateDoc(doc(client(actors.owner), 'grigliata_token_placements', state.placementId), {
    isInTurnOrder: true, turnOrderJoinedAt: serverTimestamp(), updatedBy: actors.owner,
  }));
  await assertSucceeds(updateDoc(doc(client(actors.owner), 'grigliata_token_placements', state.placementId), {col: 21, updatedBy: actors.owner}));
  await assertSucceeds(deleteDoc(doc(client(), 'grigliata_token_placements', state.placementId)));
});

test('effect expiry atomically removes effects and clears the custom token shield', async () => {
  const state = await fixture('expiry', effects(12));
  await assertSucceeds(turnBatch(state, {turnCounter: 3, expireShield: true,
    placementPatch: {turnEffects: deleteField()}}));
  const db = client();
  assert.equal((await getDoc(doc(db, 'grigliata_token_placements', state.placementId))).data().turnEffects, undefined);
  assert.deepEqual((await getDoc(doc(db, 'grigliata_tokens', state.tokenId))).data().stats,
    {shieldCurrent: 0, shieldTotal: 0});
  await assertSucceeds(turnBatch(state, {turnCounter: 4,
    placementPatch: {turnEffects: [{...makeEffect(0), remainingTurns: 0, appliesFromTurnCounter: 0}]}}));
});

test('all effect fields and the 12-entry limit remain enforced, including the last effect', async () => {
  const state = await fixture('invalid');
  const invalid = [null, true, 'abcde', 'effect', {}, {...makeEffect(0), extra: true},
    {...makeEffect(0), id: ''}, {...makeEffect(0), id: 1},
    {...makeEffect(0), kind: ''}, {...makeEffect(0), kind: 1},
    {...makeEffect(0), totalTurns: 0}, {...makeEffect(0), totalTurns: 1.5},
    {...makeEffect(0), remainingTurns: -1}, {...makeEffect(0), remainingTurns: 3},
    {...makeEffect(0), remainingTurns: 1.5},
    {...makeEffect(0), appliesFromTurnCounter: -1}, {...makeEffect(0), appliesFromTurnCounter: 1.5}];
  for (const field of Object.keys(makeEffect(0))) {
    const missing = makeEffect(0); delete missing[field]; invalid.push(missing);
    invalid.push({...missing, unexpected: true});
  }
  for (const field of ['totalTurns', 'remainingTurns', 'appliesFromTurnCounter']) {
    for (const value of [null, true, '2']) invalid.push({...makeEffect(0), [field]: value});
  }
  for (const malformed of invalid) {
    await assertDenied(turnBatch(state, {placementPatch: {turnEffects: [...effects(11), malformed]}}));
  }
  for (const malformed of [null, {}, effects(13)]) {
    await assertDenied(turnBatch(state, {placementPatch: {turnEffects: malformed}}));
  }
  for (let index = 0; index < 12; index += 1) {
    const list = effects(12); list[index] = {...list[index], remainingTurns: -1};
    await assertDenied(turnBatch(state, {placementPatch: {turnEffects: list}}));
  }
});

test('turn batches remain DM-only and rejected batches leave the cursor and counter unchanged', async () => {
  const state = await fixture('actors');
  for (const uid of [null, actors.owner, actors.peer, actors.webmaster, actors.pending, actors.deleted]) {
    await assertDenied(turnBatch(state, {uid}));
  }
  assert.equal((await getDoc(doc(client(), 'grigliata_backgrounds', state.backgroundId))).data().turnOrderActive, undefined);
  assert.equal((await getDoc(doc(client(), 'grigliata_token_placements', state.placementId))).data().turnCounter, undefined);
});

test('owner visibility, death, fog, identity, and turn-effect restrictions remain enforced', async () => {
  const state = await fixture('owner-boundaries', effects(12));
  const ownerRef = doc(client(actors.owner), 'grigliata_token_placements', state.placementId);
  await assertSucceeds(updateDoc(ownerRef, {col: 21, updatedBy: actors.owner}));
  assert.deepEqual((await getDoc(ownerRef)).data().turnEffects, effects(12));
  for (const patch of [{isVisibleToPlayers: false}, {isDead: true}, {visionEnabled: false},
    {visionRadiusSquares: 13}, {turnCounter: 1}, {turnEffects: []}, {ownerUid: actors.peer},
    {tokenId: 'task14g-other-token'}, {backgroundId: 'task14g-other-map'},
    {statuses: ['unknown']}, {sizeSquares: 10}]) await assertDenied(updateDoc(ownerRef, patch));
  await seed(`grigliata_token_placements/${state.placementId}`, {...state.placement, isVisibleToPlayers: false});
  await assertDenied(updateDoc(ownerRef, {col: 22}));
  const foe = await fixture('foe-owner', [], {}, {tokenType: 'foe'});
  await assertDenied(updateDoc(doc(client(actors.owner), 'grigliata_token_placements', foe.placementId), {col: 22}));
  await seed(`grigliata_tokens/${state.tokenId}`, {ownerUid: actors.peer, tokenType: 'custom'});
  await assertDenied(turnBatch(state));
});

test('pending token deletion and immutable video-map media still deny complete batches', async () => {
  const state = await fixture('pending-token', effects(12), {}, {task06Deletion: {status: 'pending'}});
  await assertDenied(turnBatch(state));
  const valid = await fixture('media');
  for (const backgroundPatch of [
    {media: {...videoMedia, assetId: `m_${'c'.repeat(40)}`}},
    {media: {...videoMedia, original: {...videoMedia.original, path: 'forged/original'}}},
    {media: deleteField()}, {task07MediaRevision: 2}, {mediaUpdatedAt: serverTimestamp()},
    {videoMedia}, {task07VideoMediaRevision: 1}, {videoMediaUpdatedAt: serverTimestamp()},
  ]) await assertDenied(turnBatch(valid, {backgroundPatch}));
  const parentId = 'task14g-pending-parent';
  const child = await fixture('pending-parent', effects(12), {}, {customTemplateId: parentId});
  await seed(`grigliata_tokens/${parentId}`, {ownerUid: actors.owner, tokenType: 'custom',
    customTokenRole: 'template', customTemplateId: parentId, task06Deletion: {status: 'pending'}});
  await assertDenied(turnBatch(child, {turnCounter: 3, expireShield: true,
    placementPatch: {turnEffects: deleteField()}}), {allowExistingGeneralBudgetDenial: true});
  assert.equal((await getDoc(doc(client(), 'grigliata_token_placements', child.placementId))).data().turnCounter, undefined);
  assert.equal((await getDoc(doc(client(), 'grigliata_backgrounds', child.backgroundId))).data().turnOrderActive, undefined);
  assert.deepEqual((await getDoc(doc(client(), 'grigliata_tokens', child.tokenId))).data().stats,
    {shieldCurrent: 5, shieldTotal: 5});
});

test('turn-only dispatch validates new turn fields without admitting unrelated new fields', async () => {
  const state = await fixture('turn-fields', effects(12));
  for (const patch of [{turnCounter: null}, {turnCounter: -1}, {turnCounter: 1.5},
    {turnCounter: '1'}, {updatedBy: true}, {updatedBy: 1},
    {updatedAt: deleteField()}, {updatedBy: deleteField()}, {tokenId: deleteField()},
    {tokenId: actors.owner}, {tokenId: ''}]) {
    await assertDenied(turnBatch(state, {placementPatch: patch}));
  }
  const ordinary = await fixture('unrelated-fields', []);
  const ref = doc(client(), 'grigliata_token_placements', ordinary.placementId);
  for (const patch of [{label: null}, {sizeSquares: 10}, {statuses: ['unknown']},
    {visionEnabled: 'enabled'}, {unexpected: true}, {manager: true},
    {backgroundId: 'forged-map'}, {ownerUid: actors.peer}]) {
    await assertDenied(turnBatch(ordinary, {placementPatch: patch}));
    await assertDenied(setDoc(ref, {...ordinary.placement, ...patch}), {
      allowExistingGeneralBudgetDenial: 'ownerUid' in patch || 'backgroundId' in patch,
    });
    assert.deepEqual((await getDoc(ref)).data(), ordinary.placement);
  }
});

test('unchanged legacy fields stay untouched while changed turn effects are fully checked', async () => {
  const state = await fixture('legacy-unrelated', effects(12), {
    legacyExtra: 'preserved', label: null, sizeSquares: 99, statuses: ['legacy-status'],
  });
  await assertSucceeds(turnBatch(state, {turnCounter: 2,
    placementPatch: {turnEffects: effects(12).map(effect => ({...effect, remainingTurns: 1}))}}));
  const stored = (await getDoc(doc(client(), 'grigliata_token_placements', state.placementId))).data();
  for (const field of ['legacyExtra', 'label', 'sizeSquares', 'statuses']) {
    assert.deepEqual(stored[field], state.placement[field]);
  }
  await assertDenied(turnBatch(state, {turnCounter: 3,
    placementPatch: {turnEffects: [...effects(11), {...makeEffect(11), remainingTurns: -1}]}}));
});

test('legacy owner token IDs normalize stably and forged placement paths are denied', async () => {
  const state = await fixture('legacy-id', effects(12));
  const legacy = {...state.placement}; delete legacy.tokenId;
  const legacyState = {...state, tokenId: actors.owner,
    placementId: `${state.backgroundId}__${actors.owner}`, placement: legacy};
  await seed(`grigliata_token_placements/${legacyState.placementId}`, legacy);
  await assertSucceeds(turnBatch(legacyState, {turnCounter: 2,
    placementPatch: {turnEffects: effects(12).map(effect => ({...effect, remainingTurns: 1}))}}));
  assert.equal((await getDoc(doc(client(), 'grigliata_token_placements', legacyState.placementId))).data().tokenId, actors.owner);
  const forged = {...state, placementId: `${state.backgroundId}__forged`};
  await seed(`grigliata_token_placements/${forged.placementId}`, state.placement);
  await assertDenied(turnBatch(forged));
  await environment.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), 'grigliata_tokens', state.tokenId)));
  await assertDenied(turnBatch(state));
});

test('retired encounter, participant, and log writes stay denied for every actor', async () => {
  for (const documentPath of ['encounters/task14g-retired',
    'encounters/task14g-retired/participants/probe', 'encounters/task14g-retired/logs/probe']) {
    await seed(documentPath, {status: 'active', participantIds: [actors.owner], participantCharacterIds: []});
    for (const uid of [actors.dm, actors.owner, actors.webmaster]) {
      const target = doc(client(uid), documentPath);
      await assertDenied(setDoc(target, {status: 'active'}));
      await assertDenied(deleteDoc(target));
    }
  }
});
