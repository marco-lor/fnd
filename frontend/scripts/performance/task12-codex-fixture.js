'use strict';

const assert = require('node:assert/strict');
const { assertPerformanceProject, configureOwnedPerformanceEnvironment, projectId } = require('./common');
const CODEX_FIXTURE_GENERATION = 'task12_performance';

// Projection follows canonical fixture verification, like catalog preparation.
// The source fixture and its version/hash remain unchanged; only demo-derived
// documents are added. No production credentials or default-project fallback.
async function prepareCodexFixture({ db, lifecycleProjectId = projectId, core, expectedSource } = {}) {
  assertPerformanceProject(lifecycleProjectId);
  const C = core || require('../../functions/lib/codexCore');
  const expected = expectedSource || require('./fixtures').buildDocuments().find(row => row.path === C.LEGACY).data;
  const generation = CODEX_FIXTURE_GENERATION;
  const initial = await C.readState(db, generation);
  assert.equal(C.hash(initial.source), C.hash(expected), 'Codex source differs from the canonical fixture.');
  const sourceDigest = C.sourceHash(initial.source);
  const source = C.inspectSource(initial.source);
  assert.equal(source.valid, true, 'Invalid canonical Codex source.');
  if (initial.control && initial.control.mode !== 'legacy') {
    assert.equal(initial.control.generation, generation, 'Unexpected Codex fixture generation.');
    assert.ok(['frozen', 'v2'].includes(initial.control.mode), 'Unexpected Codex fixture mode.');
  }
  const apply = async action => {
    const state = await C.readState(db, generation);
    assert.equal(C.sourceHash(state.source), sourceDigest, 'Codex source changed during preparation.');
    const plan = C.makePlan(state, action, generation);
    return C.applyPlan(db, plan, plan.fingerprint);
  };
  const alreadyActive = initial.control?.mode === 'v2';
  if (!alreadyActive) {
    if (initial.control?.mode !== 'frozen') await apply('freeze');
    let complete = false;
    const maximumBatches = Math.ceil((source.categories + source.items) / C.PAGE) + 1;
    for (let batch = 0; batch < maximumBatches && !complete; batch++) complete = (await apply('backfill')).complete;
    assert.equal(complete, true, 'Codex fixture backfill did not complete within its bounded batch count.');
    const verified = await apply('verify');
    assert.equal(verified.verified, true, 'Codex fixture verification failed.');
    await apply('activate');
  }
  const final = await C.readState(db, generation);
  assert.equal(final.control?.mode, 'v2', 'Codex fixture activation failed.');
  assert.equal(final.control.generation, generation, 'Codex activated the wrong fixture generation.');
  assert.equal(C.sourceHash(final.source), sourceDigest, 'Codex preparation changed the legacy fixture.');
  const documents = C.verifyMigration(final, generation, final.control.collationLocale, true);
  assert.equal(documents.length, source.categories + source.items, 'Incomplete Codex fixture projection.');
  return { mode: 'v2', generation, categories: source.categories, items: source.items,
    sourceDigest, projectionDocuments: documents.length, alreadyActive };
}

async function main() {
  configureOwnedPerformanceEnvironment();
  assertPerformanceProject(projectId);
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId }, 'task12-fixture-preparation');
  try { console.log(JSON.stringify(await prepareCodexFixture({ db: getFirestore(app) }))); }
  finally { await deleteApp(app); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { CODEX_FIXTURE_GENERATION, prepareCodexFixture };
