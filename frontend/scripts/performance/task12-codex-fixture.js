'use strict';

const assert = require('node:assert/strict');
const { assertPerformanceProject, configureOwnedPerformanceEnvironment, projectId } = require('./common');
const CODEX_FIXTURE_GENERATION = 'task12_performance';
const CODEX_FIXTURE_REPORT_PREFIX = 'FND_CODEX_FIXTURE_REPORT ';

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
    // One real backfill validates the existing checkpoint, including a resumed
    // partial fixture. Repeating the operator's recursive inventory for every
    // batch would make demo preparation quadratic in the number of item RPCs.
    await apply('backfill');
    const frozen = await C.readState(db, generation);
    assert.equal(C.sourceHash(frozen.source), sourceDigest, 'Codex source changed during preparation.');
    const root = `codex_versions/${generation}`;
    const marker = frozen.documents.find(row => row.path === root).data;
    const expected = C.verifyMigration(frozen, generation, frozen.control.collationLocale, false);
    const existing = new Set(frozen.documents.map(row => row.path));
    const missing = expected.filter(row => !existing.has(row.path));
    const guardedWrite = async write => db.runTransaction(async tx => {
      const snapshots = await tx.getAll(db.doc(C.LEGACY), db.doc(C.CONTROL), db.doc(root));
      assert.deepEqual([C.sourceHash(snapshots[0].data()), C.hash(snapshots[1].data()), C.hash(snapshots[2].data())],
        [sourceDigest, C.hash(frozen.control), C.hash(marker)], 'Frozen Codex fixture changed during preparation.');
      write(tx);
    });
    for (let start = 0; start < missing.length; start += C.PAGE) {
      const batch = missing.slice(start, start + C.PAGE);
      await guardedWrite(tx => batch.forEach(row => tx.create(db.doc(row.path), row.data)));
    }
    await guardedWrite(tx => tx.update(db.doc(root), {offset: expected.length, status: 'building'}));
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
  try { console.log(CODEX_FIXTURE_REPORT_PREFIX + JSON.stringify(await prepareCodexFixture({ db: getFirestore(app) }))); }
  finally { await deleteApp(app); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { CODEX_FIXTURE_GENERATION, CODEX_FIXTURE_REPORT_PREFIX, prepareCodexFixture };
