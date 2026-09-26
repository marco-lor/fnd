const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parseOptions, run, validateReport, fingerprint} = require('./backfill-manager-summaries');
const {assertSafeTarget} = require('../backfill-user-directory');
const hash = (n) => String(n).padStart(64, '0');
const fixture = (count = 53) => {
  const states = new Map(Array.from({length: count}, (_, i) => [`player-${String(i).padStart(3, '0')}`, {current: hash(0), desired: hash(1)}]));
  let writes = 0;
  const db = {projectId: 'demo-fnd-perf', collection: (name) => {
    let after = '', limit;
    const query = {orderBy: () => query, limit: (n) => { limit = n; return query; }, startAfter: (uid) => { after = uid; return query; },
      get: async () => { const ids = [...states.keys()].filter((uid) => uid > after && (name === 'users' ? !states.get(uid).orphan : states.get(uid).current !== hash(0))).sort().slice(0, limit);
        return {size: ids.length, docs: ids.map((id) => ({id}))}; }};
    return query;
  }};
  const inspect = async (_db, uid, write, approved) => {
    const state = states.get(uid) || {current: hash(0), desired: hash(0)};
    if (approved && (approved.projectionHash !== state.desired || ![approved.currentHash, state.desired].includes(state.current))) throw new Error('Stale transaction approval');
    const result = {uid, action: state.current === state.desired ? 'unchanged' : state.desired === hash(0) ? 'delete' : 'set', currentHash: state.current, projectionHash: state.desired};
    if (write && result.action !== 'unchanged') { state.current = state.desired; writes += 1; if (state.orphan && result.action === 'delete') states.delete(uid); }
    return result;
  };
  return {db, inspect, states, get writes() { return writes; }};
};
const apply = (f, report, extra = {}) => run({...f, write: true, report, approveFingerprint: report.planFingerprint, ...extra});
test('explicit target parser uses dedicated artifacts and rejects bypasses', () => {
  const args = ['--environment', 'staging', '--project', 'fatin-test'];
  const options = parseOptions(args);
  assert.equal(options.shouldWrite, false);
  assert.throws(() => parseOptions([...args, '--report', 'same.json', '--checkpoint', 'same.json']), /paths must differ/);
  assert.match(options.reportPath, /task11-summary-dry-run/);
  assert.match(options.checkpointPath, /task11-summary-checkpoint/);
  assert.equal(parseOptions([...args, '--write', '--resume', '--approve-fingerprint', hash(1), '--report', 'review.json']).resume, true);
  assert.throws(() => parseOptions([...args, '--start-after', 'player-a']), /Unknown argument/);
  assert.equal(parseOptions(['--environment', 'production', '--project', 'fatins']).environmentName, 'production');
  assert.throws(() => parseOptions([...args, '--write', '--verify']), /mutually exclusive/);
});

test('production parser retains exact live target, confirmation and CLI authentication fences', () => {
  const options = parseOptions(['--environment', 'production', '--project', 'fatins',
    '--site', 'fatins', '--bucket', 'fatins.firebasestorage.app', '--allow-live-project',
    '--confirm-project', 'fatins', '--auth', 'firebase-cli']);
  const env = {FND_GIT_BRANCH: 'main'};
  assert.deepEqual(assertSafeTarget(options, env), {emulatorHost: null, live: true, projectId: 'fatins'});
  for (const patch of [{projectId: 'fatin-test'}, {hostingSite: 'fatin-test'},
    {storageBucket: 'fatin-test.firebasestorage.app'}, {allowLiveProject: false},
    {confirmProject: 'fatin-test'}, {authMode: 'admin'}]) {
    assert.throws(() => assertSafeTarget({...options, ...patch}, env));
  }
  assert.throws(() => assertSafeTarget(options, {...env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}), /performance environment/);
  assert.throws(() => assertSafeTarget(options, {...env, GCLOUD_PROJECT: 'fatin-test'}), /does not match/);
});
test('dry-run is read-only, complete approval is mandatory, and report integrity/age/project are checked', async () => {
  const f = fixture();
  const partial = await run({...f, maxBatches: 1});
  assert.equal(partial.complete, false);
  await assert.rejects(apply(f, partial), /complete/);
  const report = await run(f);
  assert.equal(f.writes, 0);
  assert.equal(report.subjects.length, 53);
  assert.equal(report.counts.set, 53);
  await assert.rejects(run({...f, write: true}), /complete/);
  await assert.rejects(apply(f, report, {approveFingerprint: ''}), /fingerprint/);
  await assert.rejects(apply(f, {...report, subjects: []}), /fingerprint/);
  assert.throws(() => validateReport(report, 'wrong', report.planFingerprint), /complete/);
  assert.throws(() => validateReport(report, f.db.projectId, report.planFingerprint, Date.parse(report.createdAt) + 86400001), /expired/);
  assert.equal(f.writes, 0);
});
test('bounded apply checkpoints resume without duplicate writes; complete verification has no changes', async () => {
  const f = fixture();
  const report = await run(f);
  const checkpoints = [];
  const first = await apply(f, report, {maxBatches: 1, onCheckpoint: (value) => checkpoints.push(value)});
  assert.equal(first.complete, false);
  assert.equal(first.nextIndex, 50);
  assert.equal(checkpoints[0].nextIndex, 0);
  assert.equal(f.writes, 50);
  await assert.rejects(apply(f, report), /Stale/);
  await assert.rejects(apply(f, report, {checkpoint: {...first, planFingerprint: hash(9)}}), /checkpoint/);
  const resumed = await apply(f, report, {checkpoint: first});
  assert.equal(resumed.complete, true);
  assert.equal(f.writes, 53);
  await apply(f, report, {checkpoint: resumed});
  assert.equal(f.writes, 53);
  assert.deepEqual((await run(f)).counts, {set: 0, delete: 0, unchanged: 53});
});
test('source changes and newly discovered subjects reject before any apply write', async () => {
  for (const mutate of [f => { f.states.get('player-000').desired = hash(2); }, f => f.states.set('new-user', {current: hash(0), desired: hash(1)})]) {
    const f = fixture(2), report = await run(f);
    mutate(f);
    await assert.rejects(apply(f, report), /Stale/);
    assert.equal(f.writes, 0);
  }
});
test('transaction precondition catches source change after preflight and durable checkpoint resumes a commit-before-save crash', async () => {
  const f = fixture(2), report = await run(f);
  let durable;
  await assert.rejects(apply(f, report, {onCheckpoint: value => { if (value.nextIndex === 1) throw new Error('disk interruption'); durable = value; }}), /disk interruption/);
  assert.equal(f.writes, 1);
  assert.equal(durable.nextIndex, 0);
  await apply(f, report, {checkpoint: durable});
  assert.equal(f.writes, 2);
  const other = fixture(1), otherReport = await run(other);
  await assert.rejects(apply(other, otherReport, {onCheckpoint: () => { other.states.get('player-000').desired = hash(3); }}), /Stale transaction/);
  assert.equal(other.writes, 0);
});
test('even a re-fingerprinted partial report cannot be approved', async () => {
  const f = fixture(2), report = await run(f);
  report.complete = false; report.planFingerprint = fingerprint(report);
  await assert.rejects(apply(f, report), /complete/);
});

test('verification is read-only and its output cannot substitute for dry-run approval', async () => {
  const f = fixture(1), report = await run(f);
  await apply(f, report);
  const verify = await run({...f, mode: 'verify'});
  assert.deepEqual(verify.counts, {set: 0, delete: 0, unchanged: 1});
  await assert.rejects(apply(f, verify), /complete Task11 dry-run/);
  assert.equal(f.writes, 1);
});

test('orphan deletion committed before checkpoint can resume after the subject disappears', async () => {
  const f = fixture(1);
  f.states.set('a-orphan', {orphan: true, current: hash(1), desired: hash(0)});
  const report = await run(f);
  assert.equal(report.counts.delete, 1);
  let durable;
  await assert.rejects(apply(f, report, {onCheckpoint: value => { if (value.nextIndex === 1) throw new Error('disk interruption'); durable = value; }}), /disk interruption/);
  assert.equal(f.states.has('a-orphan'), false);
  assert.equal((await apply(f, report, {checkpoint: durable})).complete, true);
  assert.equal(f.writes, 2);
});
test('resume refuses regressed completed subjects and forged skipped positions', async () => {
  const f = fixture(), report = await run(f);
  const first = await apply(f, report, {maxBatches: 1});
  f.states.get('player-000').current = hash(0);
  await assert.rejects(apply(f, report, {checkpoint: first}), /Stale/);
  assert.equal(f.writes, 50);
});
