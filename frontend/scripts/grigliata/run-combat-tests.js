const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {frontendRoot, resolvePortableJavaHome} = require('../performance/common');
const {createFirebaseCliEnvironment, environmentPath} = require('../performance/emulators');

const browser = process.argv[2] === '--browser';
if (process.argv.length > (browser ? 3 : 2)) throw new Error('Expected no arguments or --browser.');
const suites = browser
  ? ['grigliata-guided-browser.test.js']
  : ['grigliata-combat.integration.test.js', 'grigliata-guided-catalog.integration.test.js'];
const java = resolvePortableJavaHome() || process.env.JAVA_HOME;
const env = createFirebaseCliEnvironment(process.env, {
  ...(java && {JAVA_HOME: java, PATH: path.join(java, 'bin') + path.delimiter + environmentPath()}),
  // The Firestore emulator's rules validator ships its messages in English.
  JAVA_TOOL_OPTIONS: [process.env.JAVA_TOOL_OPTIONS, '-Duser.language=en', '-Duser.country=US'].filter(Boolean).join(' '),
});
const result = spawnSync(process.execPath, [
  require.resolve('firebase-tools/lib/bin/firebase.js'), 'emulators:exec',
  '--project', 'demo-fnd-perf', '--only', browser ? 'auth,firestore,functions,hosting' : 'firestore',
  'node --test --test-concurrency=1 ' + suites.map(name => 'performance/tests/' + name).join(' '),
], {cwd: frontendRoot, env, stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
