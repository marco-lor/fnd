const assert = require('node:assert/strict');
const test = require('node:test');

const prerequisites = (() => {
  try {
    return require('./verify-runtime-prerequisites');
  } catch (_error) {
    return {};
  }
})();

const requirePrerequisites = (name) => {
  assert.equal(
    typeof prerequisites[name],
    'function',
    `verify-runtime-prerequisites must export ${name}()`
  );
  return prerequisites[name];
};

test('predeploy prerequisite invocations preserve the explicit staging target', () => {
  const buildPrerequisiteInvocations = requirePrerequisites('buildPrerequisiteInvocations');
  const invocations = buildPrerequisiteInvocations({
    branchName: 'devs',
    options: {
      environmentName: 'staging',
      projectId: 'fatin-test',
      hostingSite: 'fatin-test',
      storageBucket: 'fatin-test.firebasestorage.app',
    },
  });

  assert.equal(invocations.length, 2);
  assert.match(invocations[0].script, /verify-app-check-production\.js$/);
  assert.deepEqual(invocations[0].args.slice(0, 8), [
    '--environment', 'staging',
    '--project', 'fatin-test',
    '--site', 'fatin-test',
    '--bucket', 'fatin-test.firebasestorage.app',
  ]);
  assert.match(invocations[1].script, /backfill-user-directory\.js$/);
  assert.deepEqual(invocations[1].args.slice(0, 8), [
    '--environment', 'staging',
    '--project', 'fatin-test',
    '--site', 'fatin-test',
    '--bucket', 'fatin-test.firebasestorage.app',
  ]);
  assert.ok(invocations[1].args.includes('--verify'));
  assert.ok(invocations.every((invocation) => invocation.args.includes('--confirm-project')));
});
test('predeploy prerequisites reject production values on devs', () => {
  const buildPrerequisiteInvocations = requirePrerequisites('buildPrerequisiteInvocations');
  assert.throws(
    () => buildPrerequisiteInvocations({
      branchName: 'devs',
      options: {
        environmentName: 'production',
        projectId: 'fatins',
        hostingSite: 'fatins',
        storageBucket: 'fatins.firebasestorage.app',
      },
    }),
    /production.*main|main.*production/i
  );
});
