const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const {buildFirebaseRulesInvocation} = require('./rules-emulators');
const {buildRulesExecCommands, runRulesExec} = require('./rules-exec');

const frontendRoot = path.resolve(__dirname, '..', '..');
const script = name => path.join(frontendRoot, 'scripts', 'performance', name);
const suite = name => ['--test', '--test-concurrency=1', path.join(frontendRoot, 'performance', 'tests', name)];
const overlay = action => [script('task09a-overlay.js'), action];
const expected = [
  [script('fixtures.js'), 'seed'],
  overlay('apply'),
  suite('task09b-catalog.test.js'),
  suite('task09b-rules.test.js'),
  suite('task09b-media-writer.test.js'),
  suite('task09a-price-contract.test.js'),
];

test('catalog mode targets only the owned demo emulator and forwards its explicit mode', () => {
  const options = {argv: ['--task09-only'], firebaseCli: 'firebase-cli.js', fsImpl: {existsSync: () => true}};
  const invocation = buildFirebaseRulesInvocation(options);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(0, 6), [
    'firebase-cli.js', 'emulators:exec', '--project', 'demo-fnd-perf', '--only', 'auth,firestore,storage,functions',
  ]);
  assert.equal(invocation.args.at(-1), 'node scripts/performance/rules-exec.js --task09-only');
  for (const projectId of ['fatins', 'fatin-test', 'demo-unowned']) {
    assert.throws(() => buildFirebaseRulesInvocation({...options, projectId}), /refuse|requires/);
  }
});

test('catalog integration prepares its complete fixture before serial catalog, rules, media and purchase suites', () => {
  assert.deepEqual(buildRulesExecCommands({task09Only: true}), expected);
  const calls = [];
  const directories = [];
  const exitCode = runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: (...args) => directories.push(args), existsSync: () => false},
    spawnSyncImpl: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.equal(options.cwd, frontendRoot);
      assert.equal(options.shell, false);
      calls.push(args);
      return {status: 0};
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [...expected, overlay('restore')]);
  assert.deepEqual(directories, [[
    path.resolve(frontendRoot, '..', 'docs', 'coordinator', 'task-09-bazaar-catalog', 'evidence'),
    {recursive: true},
  ]]);
});

test('catalog integration restores the overlay and preserves a failed suite status', () => {
  const calls = [];
  const exitCode = runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: () => {}, existsSync: () => false},
    spawnSyncImpl: (_command, args) => {
      calls.push(args);
      return {status: args.includes(path.join(frontendRoot, 'performance', 'tests', 'task09b-rules.test.js')) ? 7 : 0};
    },
  });
  assert.equal(exitCode, 7);
  assert.deepEqual(calls, [...expected.slice(0, 4), overlay('restore')]);
});

test('catalog integration does not restore an overlay that failed to apply', () => {
  const calls = [];
  const exitCode = runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: () => {}, existsSync: () => false},
    spawnSyncImpl: (_command, args) => {
      calls.push(args);
      return {status: calls.length === 2 ? 8 : 0};
    },
  });
  assert.equal(exitCode, 8);
  assert.deepEqual(calls, expected.slice(0, 2));
});

test('catalog integration reports cleanup failure after otherwise successful suites', () => {
  const exitCode = runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: () => {}, existsSync: () => false},
    spawnSyncImpl: (_command, args) => ({status: args[1] === 'restore' ? 9 : 0}),
  });
  assert.equal(exitCode, 9);
});

test('catalog integration treats a terminated child as failure and still restores the fixture', () => {
  const calls = [];
  const exitCode = runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: () => {}, existsSync: () => false},
    spawnSyncImpl: (_command, args) => {
      calls.push(args);
      return calls.length === 3 ? {status: null, signal: 'SIGTERM'} : {status: 0};
    },
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(calls, [...expected.slice(0, 3), overlay('restore')]);
});

test('catalog integration restores a partially applied overlay when its backup was created', () => {
  const calls = [];
  let backupExists = false;
  const exitCode = runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: () => {}, existsSync: () => backupExists},
    spawnSyncImpl: (_command, args) => {
      calls.push(args);
      if (args[1] === 'apply') {backupExists = true; return {status: 4};}
      return {status: 0};
    },
  });
  assert.equal(exitCode, 4);
  assert.deepEqual(calls, [...expected.slice(0, 2), overlay('restore')]);
});

test('catalog integration preserves a previous backup before reseeding its emulator', () => {
  assert.throws(() => runRulesExec({
    argv: ['--task09-only'],
    fsImpl: {mkdirSync: () => {}, existsSync: () => true},
    spawnSyncImpl: () => {throw new Error('must not execute');},
  }), /backup.*restore/i);
});

test('catalog mode rejects conflicting suite modes before executing anything', () => {
  for (const argv of [['--task09-only', '--task07-only'], ['--task09-only', '--task08-only']]) {
    const spawnSyncImpl = () => {throw new Error('must not execute');};
    assert.throws(() => runRulesExec({argv, spawnSyncImpl}), /one|exclusive|conflict/i);
    assert.throws(() => buildFirebaseRulesInvocation({argv, fsImpl: {existsSync: () => true}}), /one|exclusive|conflict/i);
  }
});
