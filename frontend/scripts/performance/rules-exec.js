#!/usr/bin/env node

const childProcess = require('child_process');
const path = require('path');
const {
  assertPerformanceProject,
  frontendRoot,
  projectId,
} = require('./common');

const serialNodeTest = (testPath) => [
  '--test',
  '--test-concurrency=1',
  testPath,
];

const task07RulesPath = path.join(
  frontendRoot,
  'performance',
  'tests',
  'task07-media-rules.test.js'
);
const task06RulesPath = path.join(
  frontendRoot,
  'performance',
  'tests',
  'task06-rules.test.js'
);
const task07CallablesPath = path.join(
  frontendRoot,
  'performance',
  'tests',
  'task07-media-callables.test.js'
);
const fixtureSeedCommand = [path.join(__dirname, 'fixtures.js'), 'seed'];

const buildRulesExecCommands = ({ task07Only = false } = {}) => {
  if (task07Only) {
    return [
      fixtureSeedCommand,
      serialNodeTest(task07RulesPath),
      serialNodeTest(task07CallablesPath),
    ];
  }
  return [
    fixtureSeedCommand,
    serialNodeTest(path.join(
      frontendRoot,
      'performance',
      'tests',
      'firestore-rules.test.js'
    )),
    serialNodeTest(task07RulesPath),
    serialNodeTest(task07CallablesPath),
    serialNodeTest(path.join(
      frontendRoot,
      'performance',
      'tests',
      'user-directory-query-builder.test.js'
    )),
    serialNodeTest(path.join(
      frontendRoot,
      'performance',
      'tests',
      'task05-callables.test.js'
    )),
    // This suite clears the shared Firestore emulator during teardown, so it
    // must remain after every suite that consumes the deterministic fixture.
    serialNodeTest(task06RulesPath),
  ];
};

const runRulesExec = ({
  argv = process.argv.slice(2),
  spawnSyncImpl = childProcess.spawnSync,
} = {}) => {
  const allowedArguments = new Set(['--task07-only']);
  const unknownArgument = argv.find((argument) => !allowedArguments.has(argument));
  if (unknownArgument) {
    throw new Error(`Unknown rules runner argument: ${unknownArgument}`);
  }
  assertPerformanceProject(projectId);
  const commands = buildRulesExecCommands({
    task07Only: argv.includes('--task07-only'),
  });
  for (const args of commands) {
    const result = spawnSyncImpl(process.execPath, args, {
      cwd: frontendRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    if (result.status !== 0) return result.status || 1;
  }
  return 0;
};

if (require.main === module) {
  try {
    process.exitCode = runRulesExec();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  buildRulesExecCommands,
  runRulesExec,
  task06RulesPath,
  task07CallablesPath,
  task07RulesPath,
};
