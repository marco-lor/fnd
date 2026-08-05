#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PERFORMANCE_PROJECT_ID,
  assertPerformanceProject,
  frontendRoot,
  resolvePortableJavaHome,
} = require('./common');
const {
  assertEmulatorPortsFree,
  createFirebaseCliEnvironment,
  waitForEmulatorPortsFree,
  withEmulatorPortCleanup,
} = require('./emulators');
const {
  TASK06_EMULATORS,
  TASK06_EMULATOR_PORTS,
  withDemoFunctionsEnvironment,
} = require('./task06/functions-integration');

const RULES_EXEC_SCRIPT = 'scripts/performance/rules-exec.js';
const RULES_EMULATOR_LABEL = 'Rules emulator integration';

const parseArguments = (argv = process.argv.slice(2)) => {
  const allowedArguments = new Set(['--task07-only']);
  const unknownArgument = argv.find((argument) => !allowedArguments.has(argument));
  if (unknownArgument) {
    throw new Error(`Unknown rules emulator argument: ${unknownArgument}`);
  }
  return {task07Only: argv.includes('--task07-only')};
};

const buildFirebaseRulesInvocation = ({
  argv = process.argv.slice(2),
  firebaseCli = path.join(
    frontendRoot,
    'node_modules',
    'firebase-tools',
    'lib',
    'bin',
    'firebase.js'
  ),
  fsImpl = fs,
  projectId = PERFORMANCE_PROJECT_ID,
} = {}) => {
  assertPerformanceProject(projectId);
  const options = parseArguments(argv);
  if (!fsImpl.existsSync(firebaseCli)) {
    throw new Error(`Firebase CLI not found: ${firebaseCli}`);
  }
  const rulesCommand = [
    'node',
    RULES_EXEC_SCRIPT,
    ...(options.task07Only ? ['--task07-only'] : []),
  ].join(' ');
  return {
    args: [
      firebaseCli,
      'emulators:exec',
      '--project',
      projectId,
      '--only',
      TASK06_EMULATORS.join(','),
      '--config',
      path.join(frontendRoot, 'firebase.json'),
      rulesCommand,
    ],
    command: process.execPath,
  };
};

const requireSuccessfulSpawn = (result) => {
  if (result.error) {
    throw new Error(`${RULES_EMULATOR_LABEL} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const error = new Error(
      `${RULES_EMULATOR_LABEL} failed with exit code ${result.status ?? 'unknown'}.`
    );
    error.exitCode = result.status || 1;
    throw error;
  }
  return result;
};

const runRulesEmulators = async ({
  argv = process.argv.slice(2),
  assertEmulatorPortsFreeImpl = assertEmulatorPortsFree,
  createFirebaseCliEnvironmentImpl = createFirebaseCliEnvironment,
  env = process.env,
  firebaseCli,
  fsImpl = fs,
  projectId = PERFORMANCE_PROJECT_ID,
  resolvePortableJavaHomeImpl = resolvePortableJavaHome,
  spawnSyncImpl = childProcess.spawnSync,
  waitForEmulatorPortsFreeImpl = waitForEmulatorPortsFree,
  withDemoFunctionsEnvironmentImpl = withDemoFunctionsEnvironment,
  withEmulatorPortCleanupImpl = withEmulatorPortCleanup,
} = {}) => {
  const invocation = buildFirebaseRulesInvocation({
    argv,
    ...(firebaseCli ? {firebaseCli} : {}),
    fsImpl,
    projectId,
  });
  await assertEmulatorPortsFreeImpl({ports: TASK06_EMULATOR_PORTS});

  const configRoot = path.join(
    frontendRoot,
    '.perf-emulator-data',
    'rules-exec-config'
  );
  fsImpl.mkdirSync(configRoot, {recursive: true});
  const portableJavaHome = resolvePortableJavaHomeImpl();
  const childEnvironment = createFirebaseCliEnvironmentImpl(env, {
    XDG_CONFIG_HOME: configRoot,
    ...(portableJavaHome ? {
      JAVA_HOME: portableJavaHome,
      PATH: `${path.join(portableJavaHome, 'bin')}`
        + `${path.delimiter}${env.PATH || ''}`,
    } : {}),
  });

  return withDemoFunctionsEnvironmentImpl(
    () => withEmulatorPortCleanupImpl(
      async () => requireSuccessfulSpawn(spawnSyncImpl(
        invocation.command,
        invocation.args,
        {
          cwd: frontendRoot,
          env: childEnvironment,
          stdio: 'inherit',
          shell: false,
        }
      )),
      {
        label: RULES_EMULATOR_LABEL,
        waitForPorts: () => waitForEmulatorPortsFreeImpl({
          ports: TASK06_EMULATOR_PORTS,
        }),
      }
    ),
    {fsImpl, projectId}
  );
};

if (require.main === module) {
  runRulesEmulators().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = {
  RULES_EXEC_SCRIPT,
  buildFirebaseRulesInvocation,
  parseArguments,
  requireSuccessfulSpawn,
  runRulesEmulators,
};
