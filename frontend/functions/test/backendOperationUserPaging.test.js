const test = require('node:test');
const assert = require('node:assert/strict');
const {processUserPage} = require('../lib/backendOperations');

const fixture = ({count = 235, cost = 1} = {}) => {
  const ids = Array.from({length: count}, (_, index) => `user-${String(index).padStart(4, '0')}`);
  const state = {cursor: '', processed: 0};
  const receipts = new Set();
  const queries = [], checkpoints = [], calls = [], replays = [];
  let time = 0, completionReads = 0;
  const operationRef = {
    get: async () => { completionReads += 1; return {get: key => key === 'progress.processed' ? state.processed : undefined}; },
    update: async value => { checkpoints.push(value.cursor); state.cursor = value.cursor; },
  };
  const queryPage = async cursor => {
    const docs = ids.filter(id => id > cursor).slice(0, 100).map(id => ({id}));
    queries.push({cursor, size: docs.length});
    return {empty: !docs.length, docs};
  };
  const processSubject = async uid => {
    calls.push(uid); time += cost;
    if (receipts.has(uid)) { replays.push(uid); return 'replayed'; }
    receipts.add(uid); state.processed += 1; return 'new';
  };
  const run = (overrides = {}) => {
    const snapshot = {cursor: state.cursor, actorUid: 'dm', input: {}, 'progress.processed': state.processed};
    return processUserPage({operation: {get: key => snapshot[key]}, operationRef, receiptId: 'receipt', kind: 'level-up-all'},
      {now: () => time, queryPage, processSubject, ...overrides});
  };
  return {ids, state, receipts, queries, checkpoints, calls, replays, operationRef, queryPage, processSubject, run,
    advance: amount => { time += amount; }, get completionReads() { return completionReads; }};
};

test('crosses bounded pages within one step and completes with fresh progress without another worker', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), {done: true, phase: 'completed', result: {processedUsers: 235}});
  assert.deepEqual(f.queries.map(page => page.size), [100, 100, 35, 0]);
  assert.deepEqual(f.checkpoints, [f.ids[99], f.ids[199], f.ids[234]]);
  assert.equal(f.completionReads, 1);
  assert.equal(f.receipts.size, 235);
});

test('one deadline spans pages and checkpoints a partial page before budget yield', async () => {
  const f = fixture({cost: 125});
  assert.deepEqual(await f.run(), {done: false, phase: 'mutate'});
  assert.equal(f.state.processed, 160);
  assert.deepEqual(f.checkpoints, [f.ids[99], f.ids[159]]);
  assert.deepEqual(f.queries.map(page => page.size), [100, 100]);
  assert.deepEqual(await f.run(), {done: true, phase: 'completed', result: {processedUsers: 235}});
  assert.equal(f.replays.length, 0);
});

test('query latency consumes the same deadline; no subject starts after it expires', async () => {
  const f = fixture({cost: 100});
  await f.run({queryPage: async cursor => {
    if (cursor) f.advance(10000);
    return f.queryPage(cursor);
  }});
  assert.equal(f.state.processed, 100);
  assert.equal(f.state.cursor, f.ids[99]);
  assert.deepEqual(f.checkpoints, [f.ids[99]]);
});

test('pause after a page boundary checkpoints only committed subjects and resumes the paused UID', async () => {
  const f = fixture();
  const result = await f.run({processSubject: uid => uid === f.ids[102] ? Promise.resolve('paused') : f.processSubject(uid)});
  assert.deepEqual(result, {done: false, phase: 'paused', paused: true});
  assert.deepEqual(f.checkpoints, [f.ids[99], f.ids[101]]);
  assert.equal(f.receipts.has(f.ids[102]), false);
  assert.equal((await f.run()).done, true);
  assert.equal(f.receipts.size, 235);
  assert.equal(f.replays.length, 0);
});

test('crash after subject commit but before cursor checkpoint replays receipts without duplicate mutation', async () => {
  const f = fixture();
  await assert.rejects(f.run({processSubject: async uid => {
    const result = await f.processSubject(uid);
    if (uid === f.ids[125]) throw new Error('interrupted after commit');
    return result;
  }}), /interrupted after commit/);
  assert.equal(f.state.processed, 126);
  assert.equal(f.state.cursor, f.ids[99]);
  assert.equal((await f.run()).done, true);
  assert.deepEqual(f.replays, f.ids.slice(100, 126));
  assert.equal(f.state.processed, 235);
});

test('failed cursor persistence leaves the old checkpoint and safely replays its complete page', async () => {
  const f = fixture({count: 130});
  const persist = f.operationRef.update;
  f.operationRef.update = async () => { throw new Error('checkpoint unavailable'); };
  await assert.rejects(f.run(), /checkpoint unavailable/);
  assert.equal(f.state.cursor, '');
  assert.equal(f.state.processed, 100);
  f.operationRef.update = persist;
  assert.equal((await f.run()).done, true);
  assert.equal(f.replays.length, 100);
  assert.equal(f.state.processed, 130);
});

test('pause on the first subject neither advances its cursor nor loops', async () => {
  const f = fixture();
  const result = await f.run({processSubject: async () => 'paused'});
  assert.deepEqual(result, {done: false, phase: 'paused', paused: true});
  assert.equal(f.queries.length, 1);
  assert.equal(f.checkpoints.length, 0);
  assert.equal(f.receipts.size, 0);
});
