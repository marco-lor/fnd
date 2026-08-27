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
const {
  FIREBASE_CLI_PATH,
  FIREBASE_CONFIG_PATH,
  buildChildEnvironment,
  readGitBranchOutput,
  resolveChildExitCode,
} = require('./firebase-deploy');
const {withForcedEnvironment} = require('./forced-release-environment');

const COMMANDS = new Set(['serve', 'shell', 'deploy', 'logs']);
const frontendRoot = path.resolve(__dirname, '..');

const parseArguments = (args = process.argv.slice(2)) => {
  const options = {
    command: '',
    environmentName: '',
    projectId: '',
    hostingSite: '',
    storageBucket: '',
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (['--command', '--environment', '--project', '--site', '--bucket'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--command') options.command = value;
      if (argument === '--environment') options.environmentName = value;
      if (argument === '--project') options.projectId = value;
      if (argument === '--site') options.hostingSite = value;
      if (argument === '--bucket') options.storageBucket = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  requiredValue(options.command, 'Firebase Functions command');
  if (!COMMANDS.has(options.command)) {
    throw new Error(`Unsupported Firebase Functions command: ${options.command}.`);
  }
  requiredValue(options.environmentName, 'Firebase environment');
  requiredValue(options.projectId, 'Firebase project');
  requiredValue(options.hostingSite, 'Firebase Hosting site');
  requiredValue(options.storageBucket, 'Firebase Storage bucket');
  return options;
};

const buildFirebaseFunctionsInvocation = ({
  branchName,
  environment = process.env,
  firebaseCli = FIREBASE_CLI_PATH,
  fsImpl = fs,
  options,
  configPath = FIREBASE_CONFIG_PATH,
} = {}) => {
  if (!options) throw new Error('Explicit Firebase Functions options are required.');
  const selection = resolveEnvironmentSelection({
    branchName,
    environmentName: options.environmentName,
    hostingSite: options.hostingSite,
    projectId: options.projectId,
    storageBucket: options.storageBucket,
  });
  const performanceCommand = options.command === 'serve' || options.command === 'shell';
  if (performanceCommand !== (selection.name === 'performance')) {
    throw new Error(
      performanceCommand
        ? 'Firebase Functions emulator commands must use the performance environment.'
        : 'Firebase Functions live commands must use production or staging.'
    );
  }
  if (!fsImpl.existsSync(firebaseCli)) throw new Error(`Firebase CLI not found: ${firebaseCli}`);

  const command = options.command === 'serve'
    ? 'emulators:start'
    : options.command === 'shell'
      ? 'functions:shell'
      : options.command === 'logs'
        ? 'functions:log'
        : 'deploy';
  const args = [
    firebaseCli,
    command,
    '--config',
    configPath,
    '--project',
    selection.projectId,
  ];
  if (options.command === 'serve') args.push('--only', 'functions');
  if (options.command === 'deploy') args.push('--only', 'functions');

  const childEnvironment = performanceCommand
    ? withForcedEnvironment(environment, {
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
    })
    : buildChildEnvironment({
      sourceEnvironment: environment,
      selection,
      branchName,
    });
  return {
    command: process.execPath,
    args,
    configPath,
    environment: childEnvironment,
    selection,
  };
};

const main = () => {
  const options = parseArguments();
  if (options.help) {
    console.log('Use --command serve|shell|deploy|logs with explicit environment, project, site, and bucket.');
    return;
  }
  const environment = process.env;
  const branchName = resolveBranchName({
    environment,
    gitBranchOutput: readGitBranchOutput({environment}),
  });
  const invocation = buildFirebaseFunctionsInvocation({branchName, environment, options});
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
  COMMANDS,
  buildFirebaseFunctionsInvocation,
  parseArguments,
};
