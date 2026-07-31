const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { assertCleanWorktree, main } = require('./authoritative');

test('clean-worktree assertion accepts empty status and rejects changes', () => {
  let invocation;
  assert.doesNotThrow(() => assertCleanWorktree({
    label: 'test run',
    spawnSync: (...args) => {
      invocation = args;
      return { status: 0, stdout: '', stderr: '' };
    },
  }));
  assert.equal(invocation[0], 'git');
  assert.deepEqual(invocation[1].slice(0, 3), [
    '-c',
    `safe.directory=${path.resolve(__dirname, '..', '..', '..').replace(/\\/g, '/')}`,
    'status',
  ]);

  assert.throws(() => assertCleanWorktree({
    label: 'test run',
    spawnSync: () => ({ status: 0, stdout: ' M src/App.js\n?? scratch.txt\n', stderr: '' }),
  }), (error) => {
    assert.equal(error.code, 'FND_PERF_DIRTY_WORKTREE');
    assert.match(error.message, /Refusing test run/);
    assert.match(error.message, /src\/App\.js/);
    assert.match(error.message, /scratch\.txt/);
    return true;
  });
});

test('authoritative flow checks cleanliness at entry and immediately before every build and snapshot', async () => {
  const events = [];
  const runId = 'focused-clean-check';
  const commandName = (args) => path.basename(args[0]);

  await main({
    environment: { FND_PERF_RUN_ID: runId },
    assertClean: ({ label }) => events.push(`clean:${label}`),
    execute: (_command, args, commandEnvironment = {}) => {
      events.push(`run:${commandName(args)}:${commandEnvironment.FND_PERF_RUN_ID || '-'}`);
    },
    cleanup: async (operation, { waitForPorts }) => {
      await operation();
      await waitForPorts();
    },
    waitForPorts: async () => events.push('ports-free'),
  });

  assert.deepEqual(events.filter((event) => event.startsWith('clean:')), [
    'clean:authoritative entry',
    `clean:authoritative run ${runId}-a build`,
    `clean:authoritative run ${runId}-a snapshot`,
    `clean:authoritative run ${runId}-b build`,
    `clean:authoritative run ${runId}-b snapshot`,
  ]);

  for (const suffix of ['a', 'b']) {
    const currentRunId = `${runId}-${suffix}`;
    const buildGuard = events.indexOf(`clean:authoritative run ${currentRunId} build`);
    const build = events.indexOf(`run:build.js:${currentRunId}`);
    const snapshotGuard = events.indexOf(`clean:authoritative run ${currentRunId} snapshot`);
    const snapshot = events.indexOf(`run:snapshot-authoritative.js:${currentRunId}`);
    assert.equal(build, buildGuard + 1);
    assert.equal(snapshot, snapshotGuard + 1);
  }
});

test('authoritative flow stops before a snapshot if the worktree becomes dirty', async () => {
  const commands = [];

  await assert.rejects(main({
    environment: { FND_PERF_RUN_ID: 'dirty-check' },
    assertClean: ({ label }) => {
      if (label === 'authoritative run dirty-check-a snapshot') {
        const error = new Error('dirty before snapshot');
        error.code = 'FND_PERF_DIRTY_WORKTREE';
        throw error;
      }
    },
    execute: (_command, args) => commands.push(path.basename(args[0])),
    cleanup: async (operation) => operation(),
    waitForPorts: async () => {},
  }), (error) => error.code === 'FND_PERF_DIRTY_WORKTREE');

  assert.equal(commands.includes('snapshot-authoritative.js'), false);
  assert.equal(commands.includes('repeatability.js'), false);
});
