#!/usr/bin/env node

'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const {
  resolveCurrentBranchName,
  resolveEnvironmentSelection,
} = require('./firebase-environment');

const FRONTEND_ROOT = path.resolve(__dirname, '..');
const APP_CHECK_SCRIPT = path.join(__dirname, 'verify-app-check-production.js');
const USER_DIRECTORY_SCRIPT = path.join(__dirname, 'backfill-user-directory.js');

const parseArguments = (args = process.argv.slice(2)) => {
  const options = {
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
    if (['--environment', '--project', '--site', '--bucket'].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
      index += 1;
      if (argument === '--environment') options.environmentName = value;
      if (argument === '--project') options.projectId = value;
      if (argument === '--site') options.hostingSite = value;
      if (argument === '--bucket') options.storageBucket = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  return options;
};

const resolveOptionsFromProcess = ({options, environment = process.env} = {}) => ({
  environmentName: options.environmentName || environment.FND_FIREBASE_ENVIRONMENT,
  projectId: options.projectId || environment.FND_FIREBASE_PROJECT_ID,
  hostingSite: options.hostingSite || environment.FND_FIREBASE_HOSTING_SITE,
  storageBucket: options.storageBucket || environment.FND_FIREBASE_STORAGE_BUCKET,
});

const buildPrerequisiteInvocations = ({
  branchName,
  options,
} = {}) => {
  const selection = resolveEnvironmentSelection({
    branchName,
    environmentName: options?.environmentName,
    hostingSite: options?.hostingSite,
    projectId: options?.projectId,
    storageBucket: options?.storageBucket,
  });
  if (!selection.deployable) {
    throw new Error(`Firebase environment ${selection.name} cannot run live release prerequisites.`);
  }
  const targetArguments = [
    '--environment', selection.name,
    '--project', selection.projectId,
    '--site', selection.hostingSite,
    '--bucket', selection.storageBucket,
  ];
  return [
    {
      script: APP_CHECK_SCRIPT,
      args: [
        ...targetArguments,
        '--auth', 'firebase-cli',
        '--allow-live-project',
        '--confirm-project', selection.projectId,
      ],
    },
    {
      script: USER_DIRECTORY_SCRIPT,
      args: [
        ...targetArguments,
        '--auth', 'firebase-cli',
        '--allow-live-project',
        '--confirm-project', selection.projectId,
        '--verify',
      ],
    },
  ];
};

const run = ({
  environment = process.env,
  options = parseArguments(),
  spawnSyncImpl = childProcess.spawnSync,
  branchName,
} = {}) => {
  if (options.help) {
    console.log('Use explicit --environment, --project, --site, and --bucket values.');
    return;
  }
  const resolvedOptions = resolveOptionsFromProcess({options, environment});
  const resolvedBranchName = branchName || resolveCurrentBranchName({
    environment,
    cwd: FRONTEND_ROOT,
  });
  const invocations = buildPrerequisiteInvocations({
    branchName: resolvedBranchName,
    options: resolvedOptions,
  });
  for (const invocation of invocations) {
    const result = spawnSyncImpl(
      process.execPath,
      ['--use-system-ca', invocation.script, ...invocation.args],
      {
        cwd: FRONTEND_ROOT,
        env: {
          ...environment,
          FND_FIREBASE_ENVIRONMENT: resolvedOptions.environmentName,
          FND_FIREBASE_PROJECT_ID: resolvedOptions.projectId,
          FND_FIREBASE_HOSTING_SITE: resolvedOptions.hostingSite,
          FND_FIREBASE_STORAGE_BUCKET: resolvedOptions.storageBucket,
          FND_GIT_BRANCH: resolvedBranchName,
        },
        shell: false,
        stdio: 'inherit',
      }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Runtime prerequisite failed: ${path.basename(invocation.script)}.`);
    }
  }
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = {
  APP_CHECK_SCRIPT,
  USER_DIRECTORY_SCRIPT,
  buildPrerequisiteInvocations,
  parseArguments,
  resolveOptionsFromProcess,
  run,
};
