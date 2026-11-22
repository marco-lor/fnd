#!/usr/bin/env node
// Runs the Grigliata fog memory two-client persistence test
// (src/components/grigliata/fogRasterTilePersistence.emulator.test.js)
// against a LOCAL Firestore emulator for the demo project, loaded with the
// repository's firestore.rules. It never contacts live Firebase: the owned
// performance environment pins the demo project and 127.0.0.1 emulator hosts
// and refuses conflicting inherited values.
//
//   node scripts/grigliata/run-fog-emulator-tests.js
//
// Needs Java 11+ for the emulator (JAVA_HOME, FND_PERF_JAVA_HOME, or a
// portable JDK under frontend/.perf-tools) and installed dependencies. From a
// checkout without its own node_modules, point NODE_PATH at an existing
// frontend/node_modules; Jest then receives it through --modulePaths.
const fs = require('node:fs');
const path = require('node:path');
const {runBoundedChildProcess} = require('../bounded-child-process');
const {
  PERFORMANCE_PROJECT_ID,
  configureOwnedPerformanceEnvironment,
  frontendRoot,
  resolvePortableJavaHome,
} = require('../performance/common');
const {
  assertEmulatorPortsFree,
  createFirebaseCliEnvironment,
  environmentPath,
  waitForEmulatorPortsFree,
  withEmulatorPortCleanup,
} = require('../performance/emulators');

const LABEL = 'Grigliata fog memory Firestore emulator test';
const TEST_PATH_PATTERN = 'grigliata/fogRasterTilePersistence.emulator.test';
const EMULATOR_PORTS = [4000, 4400, 4500, 8080, 9150];

const buildJestCommand = () => {
  const reactScriptsPackage = require.resolve('react-scripts/package.json');
  const nodeModulesDir = path.resolve(path.dirname(reactScriptsPackage), '..');
  const usesExternalNodeModules = nodeModulesDir !== path.resolve(frontendRoot, 'node_modules');
  return [
    'node',
    path.join(path.dirname(reactScriptsPackage), 'bin', 'react-scripts.js'),
    'test',
    '--watchAll=false',
    '--runInBand',
    '--watchman=false',
    `--testPathPattern=${TEST_PATH_PATTERN}`,
    ...(usesExternalNodeModules ? [`--modulePaths=${nodeModulesDir}`] : []),
  ].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
};

async function main() {
  if (process.argv.length > 2) throw new Error('This runner takes no arguments.');
  const ownedEnvironment = configureOwnedPerformanceEnvironment({env: {...process.env}, mode: 'strict'});
  const java = resolvePortableJavaHome();
  const configRoot = path.join(frontendRoot, '.perf-emulator-data', 'grigliata-fog-config');
  fs.mkdirSync(configRoot, {recursive: true});
  const environment = createFirebaseCliEnvironment(ownedEnvironment, {
    XDG_CONFIG_HOME: configRoot,
    JAVA_TOOL_OPTIONS: '-Xmx512m',
    CI: 'true',
    FND_FOG_EMULATOR_TEST: '1',
    ...(java ? {
      JAVA_HOME: java,
      PATH: path.join(java, 'bin') + path.delimiter + environmentPath(ownedEnvironment),
    } : {}),
  });

  await assertEmulatorPortsFree({ports: EMULATOR_PORTS});
  const result = await withEmulatorPortCleanup(() => runBoundedChildProcess({
    command: process.execPath,
    args: [
      path.resolve(__dirname, '../performance/firebase-emulator-supervisor.js'),
      require.resolve('firebase-tools/lib/bin/firebase.js'),
      'emulators:exec',
      '--project',
      PERFORMANCE_PROJECT_ID,
      '--only',
      'firestore',
      '--config',
      path.join(frontendRoot, 'firebase.json'),
      buildJestCommand(),
    ],
    cwd: frontendRoot,
    environment,
    timeoutMs: 10 * 60 * 1000,
    label: LABEL,
    captureOutput: false,
  }), {label: LABEL, waitForPorts: () => waitForEmulatorPortsFree({ports: EMULATOR_PORTS})});
  process.exitCode = result.status;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {buildJestCommand};
