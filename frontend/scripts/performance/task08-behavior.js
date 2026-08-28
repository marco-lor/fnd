#!/usr/bin/env node

const childProcess = require('node:child_process');
const path = require('node:path');

const {
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  PERFORMANCE_ENVIRONMENT_MODE,
  projectId,
  repoRoot,
} = require('./common');
const { sourceTreeIdentity } = require('./task08-report');
const { validateTask08Prerequisites } = require('./task08-preflight');

const TASK08_BEHAVIOR_JEST_FILES = Object.freeze([
  'src/performance/task08-regression.test.js',
  'src/components/Login.test.js',
  'src/components/home/elements/useConsumable.test.js',
  'src/data/userData/userDataCommands.test.js',
]);
const TASK08_BEHAVIOR_NODE_FILES = Object.freeze([
  'scripts/performance/task08-regression-contracts.test.js',
  'performance/tests/browser/task08-cleanup.test.js',
]);

const parseArguments = (args = process.argv.slice(2)) => {
  const options = {
    includeCallables: true,
    includeBrowser: true,
  };
  for (const argument of args) {
    if (argument === '--unit-only') {
      options.includeCallables = false;
      options.includeBrowser = false;
    } else if (argument === '--skip-callables') {
      options.includeCallables = false;
    } else if (argument === '--skip-browser') {
      options.includeBrowser = false;
    } else {
      throw new Error(`Unknown Task 08 behavior argument: ${argument}`);
    }
  }
  return options;
};

const buildTask08BehaviorCommands = ({
  includeCallables = true,
  includeBrowser = true,
} = {}) => {
  const commands = [
    {
      label: 'Task 08 Jest behavior suites',
      command: process.execPath,
      args: [
        require.resolve('react-scripts/scripts/test'),
        '--watchAll=false',
        '--watchman=false',
        '--runInBand',
        ...TASK08_BEHAVIOR_JEST_FILES,
      ],
    },
    {
      label: 'Task 08 deterministic Node behavior suites',
      command: process.execPath,
      args: [
        '--test',
        '--test-concurrency=1',
        ...TASK08_BEHAVIOR_NODE_FILES,
      ],
    },
  ];
  if (includeCallables) {
    commands.push({
      label: 'Task 08 local callable emulator behavior suite',
      command: process.execPath,
      args: [path.join('scripts', 'performance', 'rules-emulators.js'), '--task08-only'],
      behaviorFiles: ['performance/tests/task05-callables.test.js'],
    });
  }
  if (includeBrowser) {
    commands.push({
      label: 'Task 08 four-scenario browser behavior suite',
      command: process.execPath,
      args: [path.join('scripts', 'performance', 'task08-runner.js')],
    });
  }
  return commands;
};

const requireSuccessfulCommand = (result, label) => {
  if (result?.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result?.status !== 0) {
    const error = new Error(`${label} failed with exit code ${result?.status ?? 'unknown'}.`);
    error.exitCode = result?.status || 1;
    throw error;
  }
  return result;
};

const runTask08Behavior = ({
  args = process.argv.slice(2),
  env = process.env,
  spawnSyncImpl = childProcess.spawnSync,
  validatePrerequisitesImpl = validateTask08Prerequisites,
} = {}) => {
  const options = parseArguments(args);
  const ownedEnvironment = configureOwnedPerformanceEnvironment({
    env: { ...env },
    mode: PERFORMANCE_ENVIRONMENT_MODE.STRICT,
  });
  if (options.includeCallables || options.includeBrowser) {
    validatePrerequisitesImpl({
      env: ownedEnvironment,
      sourceIdentity: sourceTreeIdentity({ repoRoot }),
    });
  }
  for (const entry of buildTask08BehaviorCommands(options)) {
    const result = spawnSyncImpl(entry.command, entry.args, {
      cwd: frontendRoot,
      env: {
        ...ownedEnvironment,
        CI: 'true',
      },
      shell: false,
      stdio: 'inherit',
    });
    requireSuccessfulCommand(result, entry.label);
  }
  return 0;
};

if (require.main === module) {
  try {
    process.exitCode = runTask08Behavior();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = error.exitCode || 1;
  }
}

module.exports = {
  TASK08_BEHAVIOR_JEST_FILES,
  TASK08_BEHAVIOR_NODE_FILES,
  buildTask08BehaviorCommands,
  parseArguments,
  requireSuccessfulCommand,
  runTask08Behavior,
};
