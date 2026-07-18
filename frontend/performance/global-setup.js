const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForEmulators = async () => {
  const required = ['auth', 'firestore', 'functions', 'hosting', 'storage'];
  const deadline = Date.now() + 240_000;
  let lastError = 'emulator hub did not respond';
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:4400/emulators');
      if (response.ok) {
        const emulators = await response.json();
        const missing = required.filter((name) => !emulators[name]);
        if (!missing.length) {
          const functionProbe = await fetch(
            'http://127.0.0.1:5001/demo-fnd-perf/europe-west1/clientFirebaseConfig'
          );
          if (functionProbe.ok) return;
          lastError = `Functions runtime probe returned ${functionProbe.status}`;
        } else {
          lastError = `missing emulator registrations: ${missing.join(', ')}`;
        }
      } else {
        lastError = `emulator hub returned ${response.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }
    await delay(500);
  }
  throw new Error(`Firebase emulators were not ready within 240 seconds (${lastError}).`);
};

module.exports = async () => {
  const frontendRoot = path.resolve(__dirname, '..');
  const resultsDirectory = path.join(frontendRoot, 'performance-results');
  const scenarioDirectory = path.join(resultsDirectory, 'scenarios');
  fs.rmSync(scenarioDirectory, { recursive: true, force: true });
  fs.mkdirSync(scenarioDirectory, { recursive: true });

  await waitForEmulators();

  const seed = childProcess.spawnSync(
    process.execPath,
    [path.join(frontendRoot, 'scripts', 'performance', 'fixtures.js'), 'seed'],
    { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
  );
  if (seed.status !== 0) {
    throw new Error(`Deterministic fixture setup failed.\n${seed.stdout || ''}\n${seed.stderr || ''}`);
  }
  process.stdout.write(seed.stdout || '');

  const rules = childProcess.spawnSync(
    process.execPath,
    ['--test', path.join(frontendRoot, 'performance', 'tests', 'firestore-rules.test.js')],
    { cwd: frontendRoot, env: process.env, encoding: 'utf8' }
  );
  if (rules.status !== 0) {
    throw new Error(`Security Rules integration tests failed.\n${rules.stdout || ''}\n${rules.stderr || ''}`);
  }
  process.stdout.write(rules.stdout || '');
};
