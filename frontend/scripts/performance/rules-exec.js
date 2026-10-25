#!/usr/bin/env node

const childProcess = require('child_process');
const fs = require('fs');
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
const task14gRulesPath = path.join(
  frontendRoot,
  'performance',
  'tests',
  'task14g-grigliata-rules.test.js'
);
const task07CallablesPath = path.join(
  frontendRoot,
  'performance',
  'tests',
  'task07-media-callables.test.js'
);
const task05CallablesPath = path.join(
  frontendRoot,
  'performance',
  'tests',
  'task05-callables.test.js'
);
const fixtureSeedCommand = [path.join(__dirname, 'fixtures.js'), 'seed'];
const catalogOverlayCommand = action => [path.join(__dirname, 'task09a-overlay.js'), action];
const catalogOverlayBackup = path.join(frontendRoot, 'performance-results', 'task09a-overlay-backup.json');

const buildRulesExecCommands = ({ task07Only = false, task08Only = false, task09Only = false } = {}) => {
  if (task09Only) {
    return [
      fixtureSeedCommand,
      catalogOverlayCommand('apply'),
      ...['task09b-catalog.test.js', 'task09b-rules.test.js', 'task09b-media-writer.test.js', 'task09a-price-contract.test.js']
        .map(name => serialNodeTest(path.join(frontendRoot, 'performance', 'tests', name))),
    ];
  }
  if (task08Only) {
    return [
      fixtureSeedCommand,
      serialNodeTest(task05CallablesPath),
    ];
  }
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
    serialNodeTest(task14gRulesPath),
    // This suite clears the shared Firestore emulator during teardown, so it
    // must remain after every suite that consumes the deterministic fixture.
    serialNodeTest(task06RulesPath),
  ];
};

const runRulesExec = ({
  argv = process.argv.slice(2),
  fsImpl = fs,
  spawnSyncImpl = childProcess.spawnSync,
} = {}) => {
  const allowedArguments = new Set(['--task07-only', '--task08-only', '--task09-only']);
  const unknownArgument = argv.find((argument) => !allowedArguments.has(argument));
  if (unknownArgument) {
    throw new Error(`Unknown rules runner argument: ${unknownArgument}`);
  }
  if (argv.length > 1) throw new Error('Select at most one rules runner mode.');
  assertPerformanceProject(projectId);
  const task09Only = argv.includes('--task09-only');
  if (task09Only) {
    if (fsImpl.existsSync(catalogOverlayBackup)) {
      throw new Error('Catalog fixture backup exists; restore the previous overlay before reseeding.');
    }
    fsImpl.mkdirSync(path.resolve(frontendRoot, '..', 'docs', 'coordinator', 'task-09-bazaar-catalog', 'evidence'), {recursive: true});
  }
  const commands = buildRulesExecCommands({
    task07Only: argv.includes('--task07-only'),
    task08Only: argv.includes('--task08-only'),
    task09Only,
  });
  const execute = args => {
    const result = spawnSyncImpl(process.execPath, args, {
      cwd: frontendRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    if (result.error) throw result.error;
    return result.status === 0 ? 0 : result.status || 1;
  };
  let exitCode = 0;
  let overlayAttempted = false;
  let overlayApplied = false;
  try {
    for (const args of commands) {
      if (task09Only && args[0] === catalogOverlayCommand('apply')[0]) overlayAttempted = true;
      exitCode = execute(args);
      if (exitCode) break;
      if (overlayAttempted) overlayApplied = true;
    }
  } finally {
    // A failed apply can already have committed a partial overlay. Its backup
    // is the original owned demo fixture, never a live-project snapshot.
    if (task09Only && overlayAttempted && (overlayApplied || fsImpl.existsSync(catalogOverlayBackup))) {
      const cleanupCode = execute(catalogOverlayCommand('restore'));
      if (!exitCode) exitCode = cleanupCode;
    }
  }
  return exitCode;
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
