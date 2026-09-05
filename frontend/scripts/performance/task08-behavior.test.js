const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTask08BehaviorCommands,
  TASK08_BEHAVIOR_JEST_FILES,
  TASK08_BEHAVIOR_NODE_FILES,
} = require('./task08-behavior');

test('focused Task 08 behavior entry point names actual regression suites', () => {
  assert.ok(TASK08_BEHAVIOR_JEST_FILES.includes('src/performance/task08-regression.test.js'));
  assert.ok(TASK08_BEHAVIOR_JEST_FILES.includes('src/components/Login.test.js'));
  assert.ok(TASK08_BEHAVIOR_JEST_FILES.includes('src/components/home/elements/useConsumable.test.js'));
  assert.ok(TASK08_BEHAVIOR_JEST_FILES.includes('src/data/userData/userDataCommands.test.js'));
  assert.ok(TASK08_BEHAVIOR_NODE_FILES.includes('scripts/performance/task08-regression-contracts.test.js'));
  const commands = buildTask08BehaviorCommands({ includeCallables: true, includeBrowser: true });
  const serialized = JSON.stringify(commands);
  assert.match(serialized, /task05-callables\.test\.js/);
  assert.match(serialized, /task08-runner\.js/);
});
