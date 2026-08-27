'use strict';

const path = require('node:path');
const {
  resolveCurrentBranchName,
  resolveEnvironmentSelection,
} = require('./firebase-environment');

const FRONTEND_ROOT = path.resolve(__dirname, '..');

const resolveOperatorTarget = ({
  options,
  environment = process.env,
  cwd = FRONTEND_ROOT,
  allowPerformance = false,
} = {}) => {
  if (!options) throw new Error('Explicit Firebase operator target options are required.');
  const target = resolveEnvironmentSelection({
    branchName: resolveCurrentBranchName({environment, cwd}),
    environmentName: options.environmentName,
    hostingSite: options.hostingSite,
    projectId: options.projectId,
    storageBucket: options.storageBucket,
  });
  if (!allowPerformance && target.name === 'performance') {
    throw new Error('This Firebase operator cannot target the performance environment.');
  }
  return target;
};

module.exports = {
  FRONTEND_ROOT,
  resolveOperatorTarget,
};
