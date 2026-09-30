#!/usr/bin/env node
const path = require('node:path');
const fs = require('node:fs');
const {runBoundedChildProcess} = require('../bounded-child-process');
const {configureOwnedPerformanceEnvironment, frontendRoot, resolvePortableJavaHome} = require('../performance/common');
const {assertEmulatorPortsFree, waitForEmulatorPortsFree, withEmulatorPortCleanup, createFirebaseCliEnvironment, environmentPath} = require('../performance/emulators');
async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--rules-only')) throw Error('Unknown Task13 test argument.');
  const env = configureOwnedPerformanceEnvironment({env: {...process.env}, mode: 'strict'});
  const java = resolvePortableJavaHome();
  const configRoot = path.join(frontendRoot, '.perf-emulator-data', 'task13-config');
  fs.mkdirSync(configRoot, {recursive: true});
  const environment = createFirebaseCliEnvironment(env, {XDG_CONFIG_HOME: configRoot, JAVA_TOOL_OPTIONS: '-Xmx512m', ...(java ? {JAVA_HOME: java, PATH: path.join(java, 'bin') + path.delimiter + environmentPath(env)} : {})});
  const ports = [4000, 4400, 4500, 8080, 9150];
  await assertEmulatorPortsFree({ports});
  const result = await withEmulatorPortCleanup(() => runBoundedChildProcess({command: process.execPath,
    args: [path.resolve(__dirname, '../performance/firebase-emulator-supervisor.js'), require.resolve('firebase-tools/lib/bin/firebase.js'),
      'emulators:exec', '--project', 'demo-fnd-perf', '--only', 'firestore', '--config', path.join(frontendRoot, 'firebase.json'),
      `node --test --test-concurrency=1 ${process.argv.includes('--rules-only') ? '--test-name-pattern=rules ' : ''}performance/tests/task13b-foes.test.js performance/tests/task13a-mana.test.js`],
    cwd: frontendRoot, environment, timeoutMs: 15 * 60 * 1000, label: 'Task13 isolated Firestore integration', captureOutput: false}),
  {label: 'Task13 isolated Firestore integration', waitForPorts: () => waitForEmulatorPortsFree({ports})});
  process.exitCode = result.status;
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
