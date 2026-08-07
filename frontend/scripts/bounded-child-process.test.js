const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  runBoundedChildProcess,
  terminateOwnedProcessTree,
} = require('./bounded-child-process');

const createChild = (pid = 1234) => {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
};

test('bounded child returns bounded stdout and stderr after exit', async () => {
  const child = createChild();
  const resultPromise = runBoundedChildProcess({
    command: 'node',
    args: ['example.js'],
    timeoutMs: 1_000,
    outputLimitBytes: 5,
    spawnImpl: () => child,
  });
  child.stdout.write('123456');
  child.stderr.write('abcdef');
  child.exitCode = 0;
  child.emit('exit', 0, null);

  assert.deepEqual(await resultPromise, {
    status: 0,
    signal: null,
    stdout: '23456',
    stderr: 'bcdef',
  });
});

test('bounded child terminates only its owned process tree at the deadline', async () => {
  const child = createChild(4321);
  const terminations = [];
  const startedAt = Date.now();
  await assert.rejects(
    runBoundedChildProcess({
      command: 'node',
      timeoutMs: 20,
      platform: 'win32',
      spawnImpl: () => child,
      terminateProcessTreeImpl: async (ownedChild, options) => {
        terminations.push({ ownedChild, options });
        ownedChild.exitCode = 1;
        ownedChild.emit('exit', 1, null);
      },
    }),
    (error) => error.code === 'ETIMEDOUT' && /timed out after 20 ms/.test(error.message)
  );
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(terminations.length, 1);
  assert.equal(terminations[0].ownedChild, child);
  assert.equal(terminations[0].options.platform, 'win32');
});

test('bounded child reports both timeout and cleanup failure', async () => {
  const child = createChild();
  await assert.rejects(
    runBoundedChildProcess({
      command: 'node',
      timeoutMs: 10,
      spawnImpl: () => child,
      terminateProcessTreeImpl: async () => {
        throw new Error('cleanup failed');
      },
    }),
    (error) => (
      error instanceof global.AggregateError
      && error.errors.some((entry) => entry.code === 'ETIMEDOUT')
      && error.errors.some((entry) => /cleanup failed/.test(entry.message))
    )
  );
});

test('Windows process-tree termination targets the exact owned PID', async () => {
  const child = createChild(2468);
  const calls = [];
  const termination = terminateOwnedProcessTree(child, {
    platform: 'win32',
    spawnSyncImpl: (...args) => {
      calls.push(args);
      child.exitCode = 1;
      child.emit('exit', 1, null);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  await termination;
  assert.deepEqual(calls[0].slice(0, 2), [
    'taskkill.exe',
    ['/PID', '2468', '/T', '/F'],
  ]);
});
