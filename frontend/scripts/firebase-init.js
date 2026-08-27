#!/usr/bin/env node

'use strict';

const childProcess = require('node:child_process');
const {
  buildFirebaseInvocation,
  parseArguments,
  readGitBranchOutput,
  resolveChildExitCode,
} = require('./firebase-deploy');
const {resolveBranchName} = require('./firebase-environment');

const main = () => {
  const options = parseArguments();
  if (options.help) {
    console.log('Use the explicit Firebase environment, project, site, bucket, and --only options.');
    return;
  }
  const environment = process.env;
  const branchName = resolveBranchName({
    environment,
    gitBranchOutput: readGitBranchOutput({environment}),
  });
  const invocation = buildFirebaseInvocation({
    branchName,
    commandArgs: ['--force'],
    commandPrefixArgs: [options.only.join(',')],
    environment,
    firebaseCommand: 'init',
    options,
  });
  const result = childProcess.spawnSync(invocation.command, invocation.args, {
    cwd: require('node:path').resolve(__dirname, '..'),
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

module.exports = {main};
