#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const { frontendRoot } = require('./common');

for (const args of [
  [path.join(__dirname, 'fixtures.js'), 'seed'],
  ['--test', path.join(frontendRoot, 'performance', 'tests', 'firestore-rules.test.js')],
  ['--test', path.join(frontendRoot, 'performance', 'tests', 'user-directory-query-builder.test.js')],
]) {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: frontendRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
