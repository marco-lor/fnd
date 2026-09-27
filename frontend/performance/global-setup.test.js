const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activateCatalogFixture,
  activateSummaryFixture,
  reconcileSummaryFixture,
  assertMeasurementTriggerSuppression,
  summarizeTriggerActivityText,
  waitForEmulators,
} = require('./global-setup');
const {
  collectTeardownEvidence,
  formatAggregateGateErrorMessage,
  reenableBackgroundTriggers,
  TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS,
} = require('./global-teardown');
const playwrightConfig = require('./playwright.config');

const invocation = (name) => `Beginning execution of "${name}"`;

test('catalog page, detail and writer callables are foreground activity', () => {
  const summary = summarizeTriggerActivityText([
    invocation('europe-west8-task09CatalogPage'),
    invocation('europe-west8-task09CatalogDetail'),
    invocation('europe-west8-task09WriteCatalogItem'),
  ].join('\n'));
  assert.equal(summary.backgroundInvocations, 0);
  assert.deepEqual(assertMeasurementTriggerSuppression(
    {backgroundInvocations: 0}, summary
  ), {expected: 0, observed: 0});
});

test('browser setup activates the seeded catalog using the bounded emulator operator', async () => {
  let invocation;
  await activateCatalogFixture(async (input) => {
    invocation = input;
    return {status: 0};
  });
  assert.match(invocation.args[0], /task09b-migrate\.js$/);
  assert.equal(invocation.args[1], 'run');
  assert.ok(invocation.timeoutMs > 0);
  await assert.rejects(activateCatalogFixture(async () => ({
    status: 1, stderr: 'projection incomplete',
  })), /Catalog fixture activation failed.*projection incomplete/s);
});

test('summary preparation uses a bounded child and propagates preparation errors', async () => {
  let call;
  await activateSummaryFixture(async (input) => { call = input; return {status: 0}; });
  assert.match(call.args[0], /global-setup\.js$/);
  assert.equal(call.args[1], '--prepare-manager-summaries');
  assert.equal(call.timeoutMs, 120_000);
  await assert.rejects(activateSummaryFixture(async () => ({status: 1, stderr: 'stale approval'})),
    /Manager summary fixture activation failed.*stale approval/s);
});

test('summary preparation approves its complete emulator plan then verifies every projection', async () => {
  const report = {complete: true, planFingerprint: 'fixture-plan'};
  const calls = [];
  const results = [report, {complete: true, counts: {set: 200}}, {complete: true, counts: {set: 0, delete: 0, unchanged: 200}}];
  const db = {};
  const result = await reconcileSummaryFixture({db, runBackfill: async (options) => {
    calls.push(options); return results[calls.length - 1];
  }});
  assert.deepEqual(calls, [
    {db, projectId: 'demo-fnd-perf'},
    {db, projectId: 'demo-fnd-perf', write: true, report, approveFingerprint: 'fixture-plan'},
    {db, projectId: 'demo-fnd-perf', mode: 'verify'},
  ]);
  assert.equal(result.verified.unchanged, 200);
});

test('summary preparation fails closed for unsafe targets, partial plans, writes and invalid verification', async () => {
  let calls = 0;
  await assert.rejects(reconcileSummaryFixture({db: {}, lifecycleProjectId: 'fnd-staging',
    runBackfill: async () => { calls += 1; }}), /non-demo/);
  assert.equal(calls, 0);
  for (const results of [
    [{complete: false}],
    [{complete: true}, {complete: false}],
    [{complete: true}, new Error('stale or failed write')],
    ...[{complete: false}, {complete: true, counts: {set: 1, delete: 0}},
      {complete: true, counts: {set: 0, delete: 1}}, {complete: true}]
      .map((verify) => [{complete: true}, {complete: true}, verify]),
  ]) {
    let index = 0;
    await assert.rejects(reconcileSummaryFixture({db: {}, runBackfill: async () => {
      const result = results[index++];
      if (result instanceof Error) throw result;
      return result;
    }}), /incomplete|stale|verification failed/);
    assert.equal(index, results.length);
  }
});

test('seed trigger summary allows only bounded readiness activity', () => {
  const summary = summarizeTriggerActivityText([
    invocation('europe-west8-syncUserDirectory'),
    invocation('europe-west8-cleanupLegacyRemovedFoeMedia'),
    invocation('europe-west8-cleanupLegacyRemovedUserMedia'),
    invocation('europe-west8-cleanupTask07RemovedBackgroundMedia'),
    invocation('europe-west8-cleanupTask07RemovedCatalogItemMedia'),
    invocation('europe-west8-cleanupTask07RemovedFoeMedia'),
    invocation('europe-west8-cleanupTask07RemovedInventoryMedia'),
    invocation('europe-west8-cleanupTask07RemovedNpcMedia'),
    invocation('europe-west8-cleanupTask07RemovedUserMedia'),
    invocation('europe-west8-cleanupTask07MediaAsset'),
    invocation('europe-west1-clientFirebaseConfig'),
    invocation('europe-west8-task05ListAdminUsers'),
    invocation('europe-west8-task05UpdateResource'),
    invocation('europe-west8-task07PrepareMediaUpload'),
    invocation('europe-west8-task07GetMediaStatus'),
    invocation('europe-west8-task07ResolveCharacterMedia'),
    invocation('europe-west8-task07AttachMediaAsset'),
    invocation('europe-west8-task07PrepareFoeMediaRetirement'),
    invocation('europe-west8-task07CommitFoeMediaRetirement'),
    invocation('europe-west8-task07AbandonFoeMediaRetirement'),
  ].join('\n'));

  assert.equal(summary.backgroundInvocations, 10);
  assert.equal(summary.cleanupInvocations, 0);
  assert.deepEqual(summary.counts, {
    'europe-west8-syncUserDirectory': 1,
    'europe-west8-cleanupLegacyRemovedFoeMedia': 1,
    'europe-west8-cleanupLegacyRemovedUserMedia': 1,
    'europe-west8-cleanupTask07RemovedBackgroundMedia': 1,
    'europe-west8-cleanupTask07RemovedCatalogItemMedia': 1,
    'europe-west8-cleanupTask07RemovedFoeMedia': 1,
    'europe-west8-cleanupTask07RemovedInventoryMedia': 1,
    'europe-west8-cleanupTask07RemovedNpcMedia': 1,
    'europe-west8-cleanupTask07RemovedUserMedia': 1,
    'europe-west8-cleanupTask07MediaAsset': 1,
    'europe-west1-clientFirebaseConfig': 1,
    'europe-west8-task05ListAdminUsers': 1,
    'europe-west8-task05UpdateResource': 1,
    'europe-west8-task07PrepareMediaUpload': 1,
    'europe-west8-task07GetMediaStatus': 1,
    'europe-west8-task07ResolveCharacterMedia': 1,
    'europe-west8-task07AttachMediaAsset': 1,
    'europe-west8-task07PrepareFoeMediaRetirement': 1,
    'europe-west8-task07CommitFoeMediaRetirement': 1,
    'europe-west8-task07AbandonFoeMediaRetirement': 1,
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

test('seed trigger summary rejects non-sentinel background activity', () => {
  assert.throws(
    () => summarizeTriggerActivityText(
      invocation('europe-west1-cleanupGrigliataMusicTrack')
    ),
    (error) => {
      assert.match(error.message, /unexpected background triggers: europe-west1-cleanupGrigliataMusicTrack/);
      assert.equal(error.triggerActivity.backgroundInvocations, 1);
      assert.deepEqual(error.triggerActivity.counts, {
        'europe-west1-cleanupGrigliataMusicTrack': 1,
      });
      return true;
    }
  );
});

test('measured Task 05 HTTPS callables never count as background trigger activity', () => {
  const summary = summarizeTriggerActivityText([
    invocation('europe-west8-task05UpdateResource'),
    invocation('europe-west8-task05UpdateResource'),
    invocation('europe-west8-task05ListAdminUsers'),
    invocation('europe-west8-task05ListAdminUsers'),
    invocation('europe-west8-task05CharacterCreation'),
    invocation('europe-west8-task05PrepareConsumable'),
    invocation('europe-west8-task05CommitConsumable'),
  ].join('\n'));

  assert.equal(summary.backgroundInvocations, 0);
  assert.deepEqual(summary.counts, {
    'europe-west8-task05UpdateResource': 2,
    'europe-west8-task05ListAdminUsers': 2,
    'europe-west8-task05CharacterCreation': 1,
    'europe-west8-task05PrepareConsumable': 1,
    'europe-west8-task05CommitConsumable': 1,
  });
});

test('Task 11 summary triggers share the readiness budget and remain forbidden during measurement', () => {
  const triggers = ['europe-west8-syncManagerUserSummary', 'europe-west8-syncManagerUserSummaryShell'];
  const contents = Array.from({length: 150}, (_, index) => invocation(triggers[index % 2])).join('\n');
  const baseline = summarizeTriggerActivityText(contents);
  assert.equal(baseline.backgroundInvocations, 150);
  assert.deepEqual(baseline.counts, Object.fromEntries(triggers.map((name) => [name, 75])));
  for (const trigger of triggers) {
    assert.throws(() => summarizeTriggerActivityText(`${contents}\n${invocation(trigger)}`), (error) => {
      assert.match(error.message, /produced 151 background invocations/);
      assert.equal(error.triggerActivity.counts[trigger], 76);
      return true;
    });
    const before = summarizeTriggerActivityText(invocation(trigger));
    assert.deepEqual(assertMeasurementTriggerSuppression(before, before), {expected: 1, observed: 1});
    const after = summarizeTriggerActivityText(`${invocation(trigger)}\n${invocation(trigger)}`);
    assert.throws(() => assertMeasurementTriggerSuppression(before, after), /ran during the measurement window/);
  }
});

test('teardown re-enables triggers with the bounded heavy-runtime timeout', async () => {
  const calls = [];
  await reenableBackgroundTriggers({
    lifecycleProjectId: 'demo-fnd-perf',
    setBackgroundTriggersEnabledImpl: async (enabled, options) => {
      calls.push({ enabled, options });
    },
  });

  assert.equal(TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS, 180_000);
  assert.deepEqual(calls, [{
    enabled: true,
    options: {
      projectId: 'demo-fnd-perf',
      timeoutMs: TEARDOWN_TRIGGER_CONTROL_TIMEOUT_MS,
    },
  }]);
});

test('seed trigger summary rejects every retired user-root trigger', () => {
  for (const trigger of [
    'europe-west8-updateHpTotal',
    'europe-west8-updateManaTotal',
    'europe-west8-updateTotParameters',
    'europe-west8-updateAnimaModifier',
    'europe-west8-expireBarriera',
    'europe-west8-syncUserDerivedState',
  ]) {
    assert.throws(
      () => summarizeTriggerActivityText(invocation(trigger)),
      new RegExp(`unexpected background triggers: ${trigger}`)
    );
  }
});

test('seed trigger summary rejects an unexpected background invocation storm', () => {
  const contents = Array.from(
    { length: 151 },
    () => invocation('europe-west8-syncUserDirectory')
  ).join('\n');
  assert.throws(
    () => summarizeTriggerActivityText(contents),
    /produced 151 background invocations/
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

test('startup readiness consumes Hub and Functions bodies for the exact harness project', async () => {
  const registrations = {
    auth: {}, firestore: {}, functions: {}, hosting: { port: 5002 }, storage: {},
  };
  const calls = [];
  let functionBodyReads = 0;
  await waitForEmulators({
    lifecycleProjectId: 'demo-fnd-perf',
    fetchImpl: async (url, init) => {
      calls.push({ url, signal: init.signal });
      if (url.endsWith('/emulators')) {
        return { ok: true, status: 200, json: async () => registrations };
      }
      return {
        ok: true,
        status: 200,
        text: async () => {
          functionBodyReads += 1;
          return '{}';
        },
      };
    },
  });

  assert.deepEqual(calls.map(({ url }) => url), [
    'http://127.0.0.1:4400/emulators',
    'http://127.0.0.1:5001/demo-fnd-perf/europe-west1/clientFirebaseConfig',
  ]);
  assert.equal(functionBodyReads, 1);
  assert.ok(calls.every(({ signal }) => signal instanceof AbortSignal && !signal.aborted));
});

test('startup readiness requires Firebase Hosting on the hidden upstream port', async () => {
  let currentTime = 0;
  await assert.rejects(
    waitForEmulators({
      lifecycleProjectId: 'demo-fnd-perf',
      timeoutMs: 5,
      requestTimeoutMs: 2,
      intervalMs: 1,
      nowImpl: () => currentTime,
      sleepImpl: async (delayMs) => { currentTime += delayMs; },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          auth: {},
          firestore: {},
          functions: {},
          hosting: { port: 5000 },
          storage: {},
        }),
      }),
    }),
    /Firebase Hosting registered on port 5000; expected 5002/
  );
});

test('startup readiness refuses a different demo project before making requests', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    waitForEmulators({
      lifecycleProjectId: 'demo-other',
      fetchImpl: async () => {
        fetchCalls += 1;
      },
    }),
    /requires demo-fnd-perf; found demo-other/
  );
  assert.equal(fetchCalls, 0);
});

for (const stalledPhase of ['response headers', 'Hub JSON body']) {
  for (const deadlinePath of ['request timeout', 'between loop and request']) {
    test(`startup readiness aborts stalled ${stalledPhase}: ${deadlinePath}`, async () => {
      const signals = [];
      let currentTime = 0;
      let crossDeadlineOnNextRead = false;
      let sleeps = 0;
      let bodyReads = 0;
      const startedAt = Date.now();
      const expectedError = deadlinePath === 'request timeout'
        ? 'Firebase emulators were not ready within 35 ms (Firebase Emulator Hub startup probe timed out after 10 ms.).'
        : 'Firebase emulators were not ready within 35 ms (Firebase emulator startup deadline expired.).';
      await assert.rejects(waitForEmulators({
        lifecycleProjectId: 'demo-fnd-perf',
        timeoutMs: 35,
        requestTimeoutMs: 10,
        intervalMs: 0,
        nowImpl: () => {
          const observed = currentTime;
          // Return 34 to the loop check, then 35 to nextRequestTimeout.
          if (crossDeadlineOnNextRead) {
            currentTime = 35;
            crossDeadlineOnNextRead = false;
          }
          return observed;
        },
        sleepImpl: async (delayMs) => {
          assert.equal(delayMs, 0);
          sleeps += 1;
          crossDeadlineOnNextRead = true;
        },
        fetchImpl: async (url, init) => {
          assert.equal(url, 'http://127.0.0.1:4400/emulators');
          signals.push(init.signal);
          // Keep the real request timer/abort; control only the outer clock so
          // event-loop scheduling cannot choose the final diagnostic for us.
          init.signal.addEventListener('abort', () => {
            currentTime = deadlinePath === 'request timeout' ? 35 : 34;
          }, {once: true});
          if (stalledPhase === 'response headers') return new Promise(() => {});
          return {ok: true, status: 200, json: async () => {
            bodyReads += 1;
            return new Promise(() => {});
          }};
        },
      }), {message: expectedError});
      assert.ok(Date.now() - startedAt < 1_000);
      assert.equal(currentTime, 35);
      assert.equal(signals.length, 1);
      assert.ok(signals.every(({aborted}) => aborted));
      assert.equal(bodyReads, stalledPhase === 'Hub JSON body' ? 1 : 0);
      assert.equal(sleeps, deadlinePath === 'request timeout' ? 0 : 1);
    });
  }
}

test('teardown preserves raw trigger and log evidence when their assertions fail', () => {
  const triggerActivity = {
    counts: { 'europe-west1-unexpected': 6 },
    backgroundInvocations: 6,
    cleanupInvocations: 0,
  };
  const triggerError = new Error('unexpected trigger');
  triggerError.triggerActivity = triggerActivity;
  const logBudget = {
    logPath: 'firebase-debug.log',
    sizeBytes: 30 * 1024 * 1024,
    maxBytes: 25 * 1024 * 1024,
  };
  const logError = new Error('trigger storm');
  logError.logBudget = logBudget;

  const evidence = collectTeardownEvidence({
    healthReport: {
      measurementWindow: { triggerActivityBaseline: { backgroundInvocations: 6 } },
    },
    emulatorLogPath: 'emulator.log',
    firebaseDebugLogPath: 'firebase-debug.log',
    lifecycleProjectId: 'demo-fnd-perf',
    summarizeTriggerActivityImpl: () => { throw triggerError; },
    assertLogWithinBudgetImpl: () => { throw logError; },
  });

  assert.equal(evidence.measurementTriggerActivity, triggerActivity);
  assert.deepEqual(evidence.suppression, { expected: 6, observed: 6 });
  assert.equal(evidence.logBudget, logBudget);
  assert.deepEqual(evidence.errors, [triggerError, logError]);
});

test('aggregate teardown diagnostics include every bounded child message', () => {
  const firstMessage = `unexpected\ntrigger ${'a'.repeat(600)}`;
  const secondMessage = `log\tbudget ${'b'.repeat(600)}`;
  const firstExpected = `[1] unexpected trigger ${'a'.repeat(477)}`;
  const secondExpected = `[2] log budget ${'b'.repeat(485)}`;
  const result = formatAggregateGateErrorMessage('Performance teardown failed.', [
    new Error(firstMessage),
    new Error(secondMessage),
  ]);

  assert.equal(firstExpected.length, 500);
  assert.equal(secondExpected.length, 500);
  assert.equal(
    result,
    `Performance teardown failed. ${firstExpected} ${secondExpected}`
  );
});

test('Playwright always starts an owned emulator server instead of reusing port 5000', () => {
  assert.equal(playwrightConfig.webServer.reuseExistingServer, false);
});

test('Playwright keeps one worker and zero retries', () => {
  assert.equal(playwrightConfig.workers, 1);
  assert.equal(playwrightConfig.retries, 0);
});

const { prepareCodexFixture, CODEX_FIXTURE_GENERATION } = require('../scripts/performance/task12-codex-fixture');
const codexCore = require('../functions/lib/codexCore');
const codexPreparationHarness = ({ items = 2 } = {}) => {
  const source = { categoria_00: Object.fromEntries(Array.from({ length: items }, (_, i) => [`Codex 0-${i}`, `value-${i}`])) };
  const data = new Map([[codexCore.LEGACY, structuredClone(source)]]);
  const actions = [], creates = [];
  const doc = path => ({ path, listCollections: async () => [...new Set([...data.keys()]
    .filter(key => key.startsWith(path + '/')).map(key => key.slice(path.length + 1).split('/')[0]))]
    .map(name => ({ listDocuments: async () => [...new Set([...data.keys()].filter(key => key.startsWith(path + '/' + name + '/'))
      .map(key => key.split('/').slice(0, path.split('/').length + 2).join('/')))].map(doc) })) });
  const db = { doc, runTransaction: async work => {
    const writes = []; let count = 0;
    const result = await work({
      getAll: async (...refs) => refs.map(ref => ({ ref, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) })),
      create: (ref, value) => { assert.equal(data.has(ref.path), false); count++; writes.push([ref.path, structuredClone(value)]); },
      set: (ref, value) => writes.push([ref.path, structuredClone(value)]),
      update: (ref, value) => { assert.ok(data.has(ref.path)); writes.push([ref.path, { ...data.get(ref.path), ...structuredClone(value) }]); },
    });
    writes.forEach(([path, value]) => data.set(path, value)); if (count) creates.push(count); return result;
  } };
  const core = { ...codexCore, applyPlan: async (...args) => { actions.push(args[1].action); return codexCore.applyPlan(...args); } };
  const input = { db, core, expectedSource: structuredClone(source) };
  const apply = async action => { const state = await core.readState(db, CODEX_FIXTURE_GENERATION);
    const plan = core.makePlan(state, action, CODEX_FIXTURE_GENERATION); return core.applyPlan(db, plan, plan.fingerprint); };
  return { input, core, db, data, source, actions, creates, apply, root: `codex_versions/${CODEX_FIXTURE_GENERATION}` };
};
test('Codex preparation uses bounded fixture creates with real activation verification; active repeats are read-only', async () => {
  const h = codexPreparationHarness({ items: 405 });
  const first = await prepareCodexFixture(h.input);
  assert.deepEqual(h.actions, ['freeze', 'backfill', 'verify', 'activate']);
  assert.deepEqual(h.creates, [1, 200, 200, 6]);
  assert.deepEqual({ mode: first.mode, categories: first.categories, items: first.items, projectionDocuments: first.projectionDocuments },
    { mode: 'v2', categories: 1, items: 405, projectionDocuments: 406 });
  const before = structuredClone([...h.data]); h.actions.length = 0; h.creates.length = 0;
  assert.equal((await prepareCodexFixture(h.input)).alreadyActive, true);
  assert.deepEqual(h.actions, []); assert.deepEqual(h.creates, []); assert.deepEqual([...h.data], before);
  assert.deepEqual(h.data.get(codexCore.LEGACY), h.source);
});

test('Codex preparation resumes a partial frozen fixture without rewriting existing documents or source', async () => {
  const h = codexPreparationHarness({ items: 405 });
  await h.apply('freeze'); await h.apply('backfill');
  const existing = [...h.data].filter(([path]) => path.startsWith(h.root + '/'));
  h.actions.length = 0; h.creates.length = 0;
  await prepareCodexFixture(h.input);
  assert.deepEqual(h.actions, ['backfill', 'verify', 'activate']); assert.deepEqual(h.creates, [200, 6]);
  for (const [path, value] of existing) assert.deepEqual(h.data.get(path), value);
  assert.deepEqual(h.data.get(codexCore.LEGACY), h.source);
});

test('Codex preparation refuses non-demo targets and noncanonical source before mutation', async () => {
  const h = codexPreparationHarness();
  await assert.rejects(prepareCodexFixture({ ...h.input, lifecycleProjectId: 'fatin-test' }), /non-demo/);
  await assert.rejects(prepareCodexFixture({ ...h.input, expectedSource: { changed: {} } }), /canonical fixture/);
  assert.deepEqual(h.actions, []); assert.equal(h.data.size, 1);
});

test('Codex preparation rejects corrupt checkpoints and projections before fixture writes', async () => {
  for (const patch of [{ offset: -1 }, { offset: 9999 }, { status: 'corrupt' }, { runtime: {} }, { sourceDigest: 'wrong' },
    { schemaVersion: 1 }, { generation: 'wrong' }, { categories: 9 }, { items: 9999 }]) {
    const h = codexPreparationHarness(); await h.apply('freeze');
    h.data.set(h.root, { ...h.data.get(h.root), ...patch }); const before = structuredClone([...h.data]);
    await assert.rejects(prepareCodexFixture(h.input)); assert.deepEqual([...h.data], before);
    assert.ok(!h.actions.includes('activate'));
  }
  const h = codexPreparationHarness(); await h.apply('freeze'); await h.apply('backfill');
  const itemPath = [...h.data.keys()].find(path => path.includes('/items/'));
  h.data.set(itemPath, { ...h.data.get(itemPath), value: 'corrupt' });
  const before = structuredClone([...h.data]);
  await assert.rejects(prepareCodexFixture(h.input), /Corrupt target projection/); assert.deepEqual([...h.data], before);
});

test('Codex fixture creates and checkpoint updates fence source order, control and marker changes', async () => {
  for (const [guardNumber, change] of [[1, 'order'], [1, 'control'], [1, 'marker'], [3, 'marker']]) {
    const h = codexPreparationHarness({ items: 405 }); const transaction = h.db.runTransaction; let guards = 0;
    h.db.runTransaction = work => transaction(async tx => {
      const getAll = tx.getAll;
      tx.getAll = async (...refs) => {
        if (refs.length === 3 && ++guards === guardNumber) {
          if (change === 'order') h.data.get(codexCore.LEGACY).categoria_00 = Object.fromEntries(Object.entries(h.source.categoria_00).reverse());
          if (change === 'control') h.data.get(codexCore.CONTROL).epoch++;
          if (change === 'marker') h.data.get(h.root).offset++;
        }
        return getAll(...refs);
      };
      return work(tx);
    });
    await assert.rejects(prepareCodexFixture(h.input), /Frozen Codex fixture changed/);
    assert.ok(!h.actions.includes('verify')); assert.ok(!h.actions.includes('activate'));
  }
});

test('Codex preparation fails closed on source changes, batch failure and incomplete or corrupt active projections', async () => {
  const changed = codexPreparationHarness(); const readState = changed.core.readState; let read = 0;
  changed.core.readState = async (...args) => { if (++read > 1) changed.data.get(codexCore.LEGACY).categoria_00['Codex 0-0'] = 'changed'; return readState(...args); };
  await assert.rejects(prepareCodexFixture(changed.input), /source changed/); assert.deepEqual(changed.actions, []);
  const failed = codexPreparationHarness({ items: 405 }); const transaction = failed.db.runTransaction;
  failed.db.runTransaction = async work => transaction(async tx => { const create = tx.create;
    tx.create = (...args) => { if (failed.actions.at(-1) === 'backfill' && failed.creates.includes(200)) throw new Error('fixture batch failure'); return create(...args); };
    return work(tx); });
  await assert.rejects(prepareCodexFixture(failed.input), /fixture batch failure/); assert.ok(!failed.actions.includes('activate'));
  for (const corrupt of [false, true]) {
    const h = codexPreparationHarness(); await prepareCodexFixture(h.input);
    const itemPath = [...h.data.keys()].find(path => path.includes('/items/'));
    if (corrupt) h.data.set(itemPath, { ...h.data.get(itemPath), value: 'corrupt' }); else h.data.delete(itemPath);
    h.actions.length = 0; await assert.rejects(prepareCodexFixture(h.input), /target projection/); assert.deepEqual(h.actions, []);
  }
});

test('browser setup prepares Codex in a bounded child and rejects incomplete activation reports', async () => {
  const { activateCodexFixture } = require('./global-setup');
  let call; const report = { mode: 'v2', categories: 20, items: 5000, projectionDocuments: 5020 };
  assert.deepEqual(await activateCodexFixture(async input => { call = input; return { status: 0, stdout: JSON.stringify(report) }; }), report);
  assert.match(call.args[0], /task12-codex-fixture\.js$/); assert.equal(call.timeoutMs, 300_000);
  await assert.rejects(activateCodexFixture(async () => ({ status: 1, stderr: 'projection incomplete' })), /Codex fixture activation failed.*projection incomplete/s);
  await assert.rejects(activateCodexFixture(async () => ({ status: 0, stdout: JSON.stringify({ ...report, items: 4999 }) })), /incomplete projection/);
});
