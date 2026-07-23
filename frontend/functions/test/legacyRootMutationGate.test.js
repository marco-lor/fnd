const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (name) => fs.readFileSync(
  path.join(__dirname, '..', 'src', name),
  'utf8'
);

const STAGED_CALLABLE_WRITERS = Object.freeze([
  'spendCharacterPoint.ts',
  'levelUpUser.ts',
  'backendOperations.ts',
]);

const DERIVED_ROOT_TRIGGERS = Object.freeze([
  'updateHpTotal.ts',
  'updateManaTotal.ts',
  'updateTotParameters.ts',
  'updateAnimaModifier.ts',
  'expireBarriera.ts',
]);

test('Task 06 progression writers honor drain and V2 projection stages', () => {
  for (const file of STAGED_CALLABLE_WRITERS) {
    const contents = source(file);
    assert.match(contents, /isUserDataLegacyDrainFrozen\(/, file);
    assert.match(contents, /resolveUserDataRolloutStage\(/, file);
    assert.match(contents, /writesLegacyUserProjection\(/, file);
    assert.match(contents, /app_config\/user_data_v2/, file);
  }
  assert.match(
    source('levelUpAll.ts'),
    /asTrimmedString\(request\.data\?\.operationId\)[\s\S]*?levelUpAllTask06Handler\(request\)[\s\S]*?levelUpAllLegacyHandler\(request\)/
  );
});

test('every derived root trigger delegates its write to the transactional gate', () => {
  for (const file of DERIVED_ROOT_TRIGGERS) {
    const contents = source(file);
    assert.match(contents, /applyLegacyRootTriggerUpdate\(/, file);
    assert.doesNotMatch(
      contents,
      /(?:doc\(`users\/\$\{userId\}`\)|collection\("users"\)\.doc\(userId\))\.update\(/,
      file
    );
  }
});

test('Anima builds leaf updates from the current transactional source', () => {
  const contents = source('updateAnimaModifier.ts');
  assert.match(contents, /buildUpdate: \(currentSource\)/);
  assert.match(
    contents,
    /buildAnimaModifierFieldUpdate\(\s*currentSource,\s*utilsData\s*\)/
  );
  assert.doesNotMatch(contents, /update:\s*\{Parametri:/);
});

test('Grigliata token deletion fences staged settings before destructive work', () => {
  const contents = source('deleteGrigliataCustomToken.ts');
  const gate = contents.indexOf(
    'isUserDataLegacyDrainFrozen(rollout.data(), claim.ownerUid)'
  );
  const destructiveCommit = contents.indexOf('await batch.commit()');
  const tokenDelete = contents.indexOf('transaction.delete(tokenRef)');
  assert.ok(gate >= 0);
  assert.match(contents, /writesLegacyUserProjection\(/);
  assert.match(contents, /\.where\("tokenId", "in", ids\)/);
  assert.ok(destructiveCommit > gate);
  assert.ok(tokenDelete > gate);
});

test('user deletion publishes a drain-visible job before external cleanup', () => {
  const contents = source('deleteUser.ts');
  const transaction = contents.indexOf('db.runTransaction(async (transaction)');
  const requesterRead = contents.indexOf('transaction.get(reqUserRef)');
  const configRead = contents.indexOf('transaction.get(rolloutRef)');
  const pendingJob = contents.indexOf('stage: "pending"');
  const authDisable = contents.indexOf('admin.auth().updateUser');
  const authDelete = contents.indexOf('admin.auth().deleteUser');
  const recursiveDelete = contents.indexOf('db.recursiveDelete');
  const finalMediaSweep = contents.lastIndexOf('await deleteAndVerifyOwnedMedia()');
  const finalFirestoreSweep = contents.lastIndexOf('await deleteAndVerifyFirestore()');
  assert.ok(transaction >= 0);
  assert.ok(requesterRead > transaction);
  assert.ok(configRead > transaction);
  assert.ok(pendingJob > configRead);
  assert.ok(authDisable > pendingJob);
  assert.ok(recursiveDelete > pendingJob);
  assert.ok(finalMediaSweep > authDelete);
  assert.ok(finalFirestoreSweep > authDelete);
  assert.match(contents, /if \(authorizedPendingJob\) \{/);
  assert.match(contents, /if \(!job\.exists \|\| job\.get\("stage"\) === "completed"\) return;/);
});

test('level-up authorizes the requester inside the mutation transaction', () => {
  const contents = source('levelUpUser.ts');
  const transaction = contents.indexOf(
    'db.runTransaction(async (transaction)'
  );
  const callerRead = contents.indexOf(
    'const [\n        receipt,\n        caller,\n        rollout,\n        target,'
  );
  const roleCheck = contents.indexOf('caller.get("role") !== "dm"');
  const update = contents.indexOf('transaction.update(userRef');
  assert.ok(transaction >= 0);
  assert.ok(callerRead > transaction);
  assert.ok(roleCheck > callerRead);
  assert.ok(update > roleCheck);
  assert.doesNotMatch(contents.slice(0, transaction), /callerSnap|\.get\("role"\)/);
});
