#!/usr/bin/env node

'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  requiredValue,
  resolveBranchName,
  resolveEnvironmentSelection,
} = require('./firebase-environment');
const {resolveChildExitCode} = require('./firebase-deploy');
const {withForcedEnvironment} = require('./forced-release-environment');

const frontendRoot = path.resolve(__dirname, '..');
const FIREBASE_CONFIG_PATH = path.join(frontendRoot, 'firebase.json');
const FIREBASE_CLI_PATH = path.join(
  frontendRoot,
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js'
);
const DEFAULT_EMULATORS = ['firestore', 'storage', 'functions', 'hosting'];

const parseArguments = (args = process.argv.slice(2)) => {
  const options = {
    environmentName: '',
    projectId: '',
    hostingSite: '',
    storageBucket: '',
    only: DEFAULT_EMULATORS,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (['--environment', '--project', '--site', '--bucket', '--only'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--environment') options.environmentName = value;
      if (argument === '--project') options.projectId = value;
      if (argument === '--site') options.hostingSite = value;
      if (argument === '--bucket') options.storageBucket = value;
      if (argument === '--only') options.only = value.split(',').map((item) => item.trim()).filter(Boolean);
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  requiredValue(options.environmentName, 'Firebase environment');
  requiredValue(options.projectId, 'Firebase project');
  requiredValue(options.hostingSite, 'Firebase Hosting site');
  requiredValue(options.storageBucket, 'Firebase Storage bucket');
  if (!options.only.length) throw new Error('Explicit --only selector is required.');
  return options;
};

const buildFirebaseEmulatorInvocation = ({
  branchName,
  environment = process.env,
  firebaseCli = FIREBASE_CLI_PATH,
  fsImpl = fs,
  options,
  configPath = FIREBASE_CONFIG_PATH,
} = {}) => {
  if (!options) throw new Error('Explicit Firebase emulator options are required.');
  const selection = resolveEnvironmentSelection({
    branchName,
    environmentName: options.environmentName,
    hostingSite: options.hostingSite,
    projectId: options.projectId,
    storageBucket: options.storageBucket,
  });
  if (selection.name !== 'performance') {
    throw new Error('Firebase emulators must use the performance environment.');
  }
  if (!fsImpl.existsSync(firebaseCli)) throw new Error(`Firebase CLI not found: ${firebaseCli}`);
  return {
    command: process.execPath,
    args: [
      firebaseCli,
      'emulators:start',
      '--config',
      configPath,
      '--project',
      selection.projectId,
      '--only',
      options.only.join(','),
    ],
    configPath,
    environment: withForcedEnvironment(environment, {
      REACT_APP_FND_PERF: '1',
      REACT_APP_FND_PERF_PROJECT_ID: selection.projectId,
      FND_FIREBASE_ENVIRONMENT: selection.name,
      FND_FIREBASE_PROJECT_ID: selection.projectId,
      FND_FIREBASE_HOSTING_SITE: selection.hostingSite,
      FND_FIREBASE_STORAGE_BUCKET: selection.storageBucket,
      FND_GIT_BRANCH: branchName,
      REACT_APP_FND_ENVIRONMENT: selection.name,
      REACT_APP_FND_FIREBASE_AUTH_DOMAIN: selection.authDomain,
      REACT_APP_FND_FIREBASE_PROJECT_ID: selection.projectId,
      REACT_APP_FND_FIREBASE_HOSTING_SITE: selection.hostingSite,
      REACT_APP_FND_FIREBASE_STORAGE_BUCKET: selection.storageBucket,
      FND_FIREBASE_AUTH_DOMAIN: selection.authDomain,
    }),
    selection,
  };
};

const readGitBranchOutput = ({
  environment = process.env,
  execFileSyncImpl = childProcess.execFileSync,
} = {}) => {
  if (environment.FND_GIT_BRANCH || environment.GITHUB_HEAD_REF || environment.GITHUB_REF_NAME) return '';
  try {
    return execFileSyncImpl('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: frontendRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_error) {
    return '';
  }
};

const main = () => {
  const options = parseArguments();
  if (options.help) {
    console.log('Use --environment performance --project demo-fnd-perf --site demo-fnd-perf --bucket demo-fnd-perf.appspot.com.');
    return;
  }
  const environment = process.env;
  const branchName = resolveBranchName({
    environment,
    gitBranchOutput: readGitBranchOutput({environment}),
  });
  const invocation = buildFirebaseEmulatorInvocation({branchName, environment, options});
  const result = childProcess.spawnSync(invocation.command, invocation.args, {
    cwd: frontendRoot,
    env: invocation.environment,
    shell: false,
    stdio: 'inherit',
  });
  process.exitCode = resolveChildExitCode(result);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_EMULATORS,
  FIREBASE_CLI_PATH,
  FIREBASE_CONFIG_PATH,
  buildFirebaseEmulatorInvocation,
  parseArguments,
  readGitBranchOutput,
};
