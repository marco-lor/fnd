const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertMeasurementTriggerSuppression,
  summarizeTriggerActivityText,
} = require('./global-setup');

const invocation = (name) => `Beginning execution of "${name}"`;

test('seed trigger summary allows only bounded readiness activity', () => {
  const summary = summarizeTriggerActivityText([
    invocation('europe-west8-updateTotParameters'),
    invocation('europe-west8-updateTotParameters'),
    invocation('europe-west1-clientFirebaseConfig'),
  ].join('\n'));

  assert.equal(summary.backgroundInvocations, 2);
  assert.equal(summary.cleanupInvocations, 0);
  assert.deepEqual(summary.counts, {
    'europe-west8-updateTotParameters': 2,
    'europe-west1-clientFirebaseConfig': 1,
  });
});

test('seed trigger summary rejects bulk token cleanup activity', () => {
  assert.throws(
    () => summarizeTriggerActivityText(
      invocation('europe-west1-cleanupReplacedGrigliataTokenImage')
    ),
    /invoked cleanupReplacedGrigliataTokenImage 1 times/
  );
});

test('seed trigger summary rejects an unexpected background invocation storm', () => {
  const contents = Array.from(
    { length: 51 },
    () => invocation('europe-west8-updateTotParameters')
  ).join('\n');
  assert.throws(
    () => summarizeTriggerActivityText(contents),
    /produced 51 background invocations/
  );
});

test('measurement trigger suppression rejects any background invocation growth', () => {
  assert.deepEqual(
    assertMeasurementTriggerSuppression(
      { backgroundInvocations: 5 },
      { backgroundInvocations: 5 }
    ),
    { expected: 5, observed: 5 }
  );
  assert.throws(
    () => assertMeasurementTriggerSuppression(
      { backgroundInvocations: 5 },
      { backgroundInvocations: 6 }
    ),
    /ran during the measurement window/
  );
});
