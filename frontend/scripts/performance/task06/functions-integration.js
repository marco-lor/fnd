#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PERFORMANCE_ENVIRONMENT_MODE,
  PERFORMANCE_PROJECT_ID,
  assertPerformanceProject,
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  resolvePortableJavaHome,
} = require('../common');
const {
  assertEmulatorPortsFree,
  waitForEmulatorPortsFree,
  withEmulatorPortCleanup,
} = require('../emulators');

const TASK06_EMULATORS = Object.freeze([
  'auth',
  'firestore',
  'storage',
  'functions',
]);
const TASK06_EMULATOR_PORTS = Object.freeze([
  4000,
  4400,
  4500,
  5001,
  8080,
  9099,
  9150,
  9199,
]);
const TASK06_INTEGRATION_TEST =
  'scripts/performance/task06/run-integration-tests.js';
const TASK06_TEST_COMMAND =
  `node ${TASK06_INTEGRATION_TEST}`;

const parseArguments = (args = process.argv.slice(2)) => {
  const parsed = {projectId: PERFORMANCE_PROJECT_ID};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--project') {
      parsed.projectId = String(args[index + 1] || '').trim();
      index += 1;
      continue;
    }
    throw new Error(`Unknown Task 06 integration argument: ${args[index]}`);
  }
  return parsed;
};

const firebaseConfigProject = (value) => {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value);
    return String(parsed.projectId || parsed.project_id || '').trim();
  } catch (_error) {
    return '';
  }
};

const assertTask06IntegrationTarget = ({
  projectId = PERFORMANCE_PROJECT_ID,
  env = process.env,
} = {}) => {
  assertPerformanceProject(projectId);
  const inheritedProjects = [
    ['FND_PERF_PROJECT_ID', env.FND_PERF_PROJECT_ID],
    ['GCLOUD_PROJECT', env.GCLOUD_PROJECT],
    ['GOOGLE_CLOUD_PROJECT', env.GOOGLE_CLOUD_PROJECT],
    ['FIREBASE_CONFIG.projectId', firebaseConfigProject(env.FIREBASE_CONFIG)],
  ].filter(([, value]) => value);
  const mismatches = inheritedProjects.filter(([, value]) => (
    value !== PERFORMANCE_PROJECT_ID
  ));
  if (mismatches.length) {
    throw new Error(
      'Task 06 integration refuses inherited non-demo project identity: '
      + mismatches.map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join(', ')
    );
  }
  configureOwnedPerformanceEnvironment({
    env,
    mode: PERFORMANCE_ENVIRONMENT_MODE.STRICT,
  });
  env.FND_TASK06_INTEGRATION = '1';
  env.FND_TASK06_CONSOLIDATED_OWNER = '1';
  return {
    projectId,
    emulatorHosts: {
      auth: env.FIREBASE_AUTH_EMULATOR_HOST,
      firestore: env.FIRESTORE_EMULATOR_HOST,
      storage: env.STORAGE_EMULATOR_HOST,
    },
  };
};

const buildFirebaseExecInvocation = ({
  projectId = PERFORMANCE_PROJECT_ID,
  firebaseCli = path.join(
    frontendRoot,
    'node_modules',
    'firebase-tools',
    'lib',
    'bin',
    'firebase.js'
  ),
} = {}) => {
  assertPerformanceProject(projectId);
  return {
    command: process.execPath,
    args: [
      firebaseCli,
      'emulators:exec',
      '--project',
      projectId,
      '--only',
      TASK06_EMULATORS.join(','),
      '--config',
      path.join(frontendRoot, 'firebase.json'),
      '--log-verbosity',
      'INFO',
      TASK06_TEST_COMMAND,
    ],
  };
};

const demoFunctionsEnvironment = (projectId = PERFORMANCE_PROJECT_ID) => [
  'FATINS_FIREBASE_API_KEY=demo-api-key',
  `FATINS_FIREBASE_AUTH_DOMAIN=${projectId}.firebaseapp.com`,
  `FATINS_FIREBASE_PROJECT_ID=${projectId}`,
  `FATINS_FIREBASE_STORAGE_BUCKET=${projectId}.appspot.com`,
  'FATINS_FIREBASE_MESSAGING_SENDER_ID=000000000000',
  'FATINS_FIREBASE_APP_ID=1:000000000000:web:performance',
  'FATINS_FIREBASE_MEASUREMENT_ID=',
  'FND_TASK06_CONSOLIDATED_OWNER=1',
  '',
].join('\n');

const resolveNpmCli = ({
  env = process.env,
  fsImpl = fs,
} = {}) => {
  const candidates = [
    env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js'
    ),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => (
    candidate.toLowerCase().endsWith('.js')
    && fsImpl.existsSync(candidate)
  ));
  if (!npmCli) {
    throw new Error(
      'Task 06 Functions build could not locate npm-cli.js.'
    );
  }
  return npmCli;
};

const withDemoFunctionsEnvironment = async (
  operation,
  {
    projectId = PERFORMANCE_PROJECT_ID,
    fsImpl = fs,
  } = {}
) => {
  assertPerformanceProject(projectId);
  if (typeof operation !== 'function') {
    throw new TypeError('Task 06 integration operation must be a function.');
  }
  const envPath = path.join(
    frontendRoot,
    'functions',
    `.env.${projectId}`
  );
  const existed = fsImpl.existsSync(envPath);
  const previous = existed ? fsImpl.readFileSync(envPath, 'utf8') : null;
  fsImpl.writeFileSync(
    envPath,
    demoFunctionsEnvironment(projectId),
    'utf8'
  );
  try {
    return await operation();
  } finally {
    if (existed) {
      fsImpl.writeFileSync(envPath, previous, 'utf8');
    } else {
      fsImpl.rmSync(envPath, {force: true});
    }
  }
};

const requireSuccessfulSpawn = (result, label) => {
  if (result.error) {
    throw new Error(`${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const error = new Error(
      `${label} failed with exit code ${result.status ?? 'unknown'}.`
    );
    error.exitCode = result.status || 1;
    throw error;
  }
  return result;
};

const run = async ({
  args = process.argv.slice(2),
  env = process.env,
  spawnSyncImpl = childProcess.spawnSync,
} = {}) => {
  const options = parseArguments(args);
  assertTask06IntegrationTarget({
    projectId: options.projectId,
    env,
  });
  if (TASK06_EMULATOR_PORTS.includes(3000)) {
    throw new Error('Task 06 integration must never own application port 3000.');
  }

  const preflight = spawnSyncImpl(
    process.execPath,
    [
      path.join(frontendRoot, 'scripts', 'performance', 'preflight.js'),
      '--skip-browser',
    ],
    {
      cwd: frontendRoot,
      env,
      stdio: 'inherit',
      shell: false,
    }
  );
  requireSuccessfulSpawn(preflight, 'Task 06 emulator preflight');

  const npmCli = resolveNpmCli({env});
  const build = spawnSyncImpl(
    process.execPath,
    [npmCli, 'run', 'build'],
    {
      cwd: path.join(frontendRoot, 'functions'),
      env,
      stdio: 'inherit',
      shell: false,
    }
  );
  requireSuccessfulSpawn(build, 'Task 06 Functions build');

  await assertEmulatorPortsFree({ports: TASK06_EMULATOR_PORTS});
  const portableJavaHome = resolvePortableJavaHome();
  const firebaseConfigHome = path.join(
    frontendRoot,
    '.perf-emulator-data',
    'task06-config'
  );
  fs.mkdirSync(firebaseConfigHome, {recursive: true});
  const invocation = buildFirebaseExecInvocation({
    projectId: options.projectId,
  });
  const childEnvironment = {
    ...env,
    XDG_CONFIG_HOME: firebaseConfigHome,
    ...(portableJavaHome ? {
      JAVA_HOME: portableJavaHome,
      PATH: `${path.join(portableJavaHome, 'bin')}`
        + `${path.delimiter}${env.PATH || ''}`,
    } : {}),
  };

  return withDemoFunctionsEnvironment(
    () => withEmulatorPortCleanup(
      async () => {
        const result = spawnSyncImpl(
          invocation.command,
          invocation.args,
          {
            cwd: frontendRoot,
            env: childEnvironment,
            stdio: 'inherit',
            shell: false,
          }
        );
        requireSuccessfulSpawn(result, 'Task 06 emulator integration');
        return result;
      },
      {
        label: 'Task 06 emulator integration',
        waitForPorts: () => waitForEmulatorPortsFree({
          ports: TASK06_EMULATOR_PORTS,
        }),
      }
    ),
    {projectId: options.projectId}
  );
};

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  TASK06_EMULATORS,
  TASK06_EMULATOR_PORTS,
  TASK06_INTEGRATION_TEST,
  TASK06_TEST_COMMAND,
  assertTask06IntegrationTarget,
  buildFirebaseExecInvocation,
  demoFunctionsEnvironment,
  parseArguments,
  resolveNpmCli,
  run,
  withDemoFunctionsEnvironment,
};
