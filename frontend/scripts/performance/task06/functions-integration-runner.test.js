const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  TASK06_EMULATOR_PORTS,
  TASK06_TEST_COMMAND,
  assertTask06IntegrationTarget,
  buildFirebaseExecInvocation,
  demoFunctionsEnvironment,
  parseArguments,
  resolveNpmCli,
  withDemoFunctionsEnvironment,
} = require('./functions-integration');

const ownedEnvironment = () => ({
  FND_PERF_PROJECT_ID: 'demo-fnd-perf',
  GCLOUD_PROJECT: 'demo-fnd-perf',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199',
});

test('Task 06 integration accepts only the exact owned demo project', () => {
  const env = ownedEnvironment();
  const result = assertTask06IntegrationTarget({env});
  assert.equal(result.projectId, 'demo-fnd-perf');
  assert.equal(env.FND_TASK06_INTEGRATION, '1');
  assert.equal(env.FND_TASK06_CONSOLIDATED_OWNER, '1');

  assert.throws(
    () => assertTask06IntegrationTarget({
      projectId: 'fatins',
      env: ownedEnvironment(),
    }),
    /refuse non-demo Firebase project/
  );
  assert.throws(
    () => assertTask06IntegrationTarget({
      env: {
        ...ownedEnvironment(),
        GOOGLE_CLOUD_PROJECT: 'fatins',
      },
    }),
    /refuses inherited non-demo project identity/
  );
  assert.throws(
    () => assertTask06IntegrationTarget({
      env: {
        ...ownedEnvironment(),
        FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443',
      },
    }),
    /refuse inherited environment values outside the owned demo emulator/
  );
});

test('Task 06 emulator invocation excludes hosting and application port 3000', () => {
  const invocation = buildFirebaseExecInvocation({
    firebaseCli: 'firebase-cli.js',
  });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(0, 8), [
    'firebase-cli.js',
    'emulators:exec',
    '--project',
    'demo-fnd-perf',
    '--only',
    'auth,firestore,storage,functions',
    '--config',
    path.resolve(__dirname, '..', '..', '..', 'firebase.json'),
  ]);
  assert.equal(invocation.args.at(-1), TASK06_TEST_COMMAND);
  assert.equal(TASK06_EMULATOR_PORTS.includes(3000), false);
  assert.equal(TASK06_EMULATOR_PORTS.includes(5000), false);
});

test('Task 06 argument parser refuses unknown and live project arguments', () => {
  assert.deepEqual(parseArguments([]), {projectId: 'demo-fnd-perf'});
  assert.deepEqual(parseArguments(['--project', 'demo-fnd-perf']), {
    projectId: 'demo-fnd-perf',
  });
  assert.throws(() => parseArguments(['--unknown']), /Unknown/);
  assert.throws(
    () => buildFirebaseExecInvocation({projectId: 'fatins'}),
    /refuse non-demo Firebase project/
  );
});

test('generated Functions environment enables consolidation only for demo', () => {
  const contents = demoFunctionsEnvironment();
  assert.match(contents, /FATINS_FIREBASE_PROJECT_ID=demo-fnd-perf/);
  assert.match(contents, /FND_TASK06_CONSOLIDATED_OWNER=1/);
  assert.doesNotMatch(contents, /fatins/);
});

test('Functions build resolves npm through a JS entry point, not npm.cmd', () => {
  const expected = path.join('C:', 'npm', 'npm-cli.js');
  assert.equal(resolveNpmCli({
    env: {npm_execpath: expected},
    fsImpl: {existsSync: (candidate) => candidate === expected},
  }), expected);
  assert.throws(
    () => resolveNpmCli({
      env: {npm_execpath: 'C:\\Program Files\\nodejs\\npm.cmd'},
      fsImpl: {existsSync: () => false},
    }),
    /could not locate npm-cli\.js/
  );
});

test('temporary demo Functions environment restores an existing file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fnd-task06-env-'));
  const fakeFs = {
    existsSync: () => true,
    readFileSync: () => 'existing=preserved\n',
    writes: [],
    writeFileSync(filePath, contents, encoding) {
      this.writes.push({contents, encoding, filePath});
    },
    rmSync() {
      throw new Error('existing environment must not be removed');
    },
  };
  try {
    const result = await withDemoFunctionsEnvironment(
      async () => 'ok',
      {fsImpl: fakeFs}
    );
    assert.equal(result, 'ok');
    assert.equal(fakeFs.writes.length, 2);
    assert.match(fakeFs.writes[0].contents, /FND_TASK06_CONSOLIDATED_OWNER=1/);
    assert.equal(fakeFs.writes[1].contents, 'existing=preserved\n');
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
