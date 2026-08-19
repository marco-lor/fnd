# Fatins-Test Main Production Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the approved newer behavior from `fatins-test/main` into `fnd/devs`, prove production safety and regression freedom, deploy only Fatins Hosting, push the exact deployed revision, and remove every temporary artifact.

**Architecture:** Use the Fatins-test aligned commit as a semantic ancestor and apply the reviewed 14-commit delta to the current FND application tree in an isolated `devs` worktree. Preserve every production binding, keep Firestore read-only, and separate behavior ports from harness ports so each review gate has focused tests before the full release matrix.

**Tech Stack:** React 18, Jest, Firebase Web SDK 12, Firebase Tools 15, Firebase Functions/TypeScript, Firestore/Storage/Auth emulators, Node.js 22 test runner, Playwright, Python Firestore backup utilities, PowerShell, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-19-fatins-test-main-to-fnd-devs-design.md`

## Global Constraints

- FND application baseline is exactly `c5ead60ce1dc63489176aade057f15ded6fad7fb`.
- Fatins-test semantic ancestor is exactly `b652b69544526b3ebdc078e52836dffda6411064`.
- Fatins-test source tip is exactly `296eeca60fc3d1ec8b3bde535a325f7683348140`.
- Port exactly the production-relevant intent of the 14-commit, 58-path source range; do not merge or cherry-pick unrelated histories.
- Exclude `docs/performance-improvement-plan/task-07/fatin-test-closure-2026-08-16.md`.
- Preserve project `fatins`, its Firebase runtime endpoint, App Check configuration, Hosting target, storage bucket, callable regions, release guards, and all production npm scripts.
- Keep deterministic performance data bound to `demo-fnd-perf`; never copy `fatins-test` Firestore or Storage data into production.
- No Firestore migration or non-Hosting Firebase deployment is authorized by this plan.
- If a Functions, rules, indexes, Storage rules, backend, schema, or production write-contract diff appears, stop and return to the specification gate.
- Use `apply_patch` for tracked file edits.
- Do not expose credentials, certificates, Firebase tokens, user IDs, document contents, or Browser session storage.
- A failed test, build, emulator, benchmark, backup, Browser check, or exact-SHA check blocks release.
- Preserve the dormant production Grigliata turn cursor and active-background state.
- Remove all worktrees, dependencies, builds, reports, caches, temporary certificate bundles, local backups, logs, and cloud test artifacts created for this update after verification.

---

## File Structure

The port is divided by responsibility:

- Measurement contract:
  `frontend/scripts/performance/{common,baseline-source,accept-baseline,compare,repeatability,report}.js`
  and their tests. These files define evidence validity, variance handling, aggregation, and baseline provenance.
- Deterministic harness lifecycle:
  `frontend/performance/{global-setup,global-teardown,playwright.config,scenarios,fixture-manifest}.*`
  and `frontend/scripts/performance/{fixtures,emulators,task07-harness}*.js`.
- Browser evidence primitives:
  `frontend/performance/tests/browser/helpers.js`,
  `helpers.test.js`, `routes.performance.js`, and
  `grigliata-five-peer.performance.js`.
- Task 07 browser lifecycle:
  `frontend/scripts/performance/task07-render-scheduler.js` and the changed
  Task 07 browser scenarios.
- Bootstrap isolation:
  `frontend/src/App*`, `frontend/src/components/Login*`, and
  `frontend/src/components/firebaseConfig*`.
- Catalog batching:
  `frontend/src/data/catalogItemRepository*`,
  `useCatalogItemsById*`, and `query-contracts.json`.
- Grigliata media/access lifecycle:
  `GlobalGrigliataMusicPlayer*`, `characterTokenMedia*`,
  `useGrigliataPageData.js`, and the relevant `GrigliataPage*` tests.
- Grigliata board lifecycle:
  `GrigliataBoard*` and the board mount point in `GrigliataPage.js`.
- Release integration:
  `.github/workflows/performance.yml`, `frontend/package.json`, and the two
  performance roadmap READMEs.

No production file is split or broadly refactored; the source range follows the
existing repository boundaries.

---

### Task 1: Revalidate Anchors and Prepare the Isolated Toolchain

**Files:**
- Read: `docs/superpowers/specs/2026-08-19-fatins-test-main-to-fnd-devs-design.md`
- Read: `frontend/package-lock.json`
- Read: `frontend/functions/package-lock.json`
- Create ignored artifacts only under the isolated worktree and
  `backend/backups/`

**Interfaces:**
- Consumes: the three immutable commit anchors from Global Constraints.
- Produces: a clean `devs` worktree with reproducible Node, Functions, Python,
  Java, Firebase CLI, and Playwright dependencies.

- [ ] **Step 1: Verify every ref and tree before installing anything**

Run from the isolated FND worktree:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/devs
git -C C:/Users/Marco/OneDrive/git_projects/fatins-test rev-parse main
git -C C:/Users/Marco/OneDrive/git_projects/fatins-test rev-parse b652b69544526b3ebdc078e52836dffda6411064
```

Expected: local `devs` is clean and contains only the approved design/plan
commits above the application tree at `c5ead60`; `origin/devs` is
`c5ead60`; Fatins-test `main` is `296eeca`; the semantic ancestor resolves
to `b652b69`.

- [ ] **Step 2: Verify the approved source range has not drifted**

```powershell
git -C C:/Users/Marco/OneDrive/git_projects/fatins-test rev-list --count b652b69544526b3ebdc078e52836dffda6411064..296eeca60fc3d1ec8b3bde535a325f7683348140
git -C C:/Users/Marco/OneDrive/git_projects/fatins-test diff --name-only b652b69544526b3ebdc078e52836dffda6411064..296eeca60fc3d1ec8b3bde535a325f7683348140
```

Expected: `14` commits and `58` paths, including the one explicitly excluded
test closure document.

- [ ] **Step 3: Install exact locked dependencies in the worktree**

```powershell
Set-Location frontend
npm.cmd ci
npm.cmd --prefix functions ci
npx.cmd playwright install chromium firefox webkit
```

Expected: commands exit 0 and do not alter either lockfile. If network access is
blocked, rerun the same commands with the required sandbox/network approval;
never replace `npm ci` with a dependency upgrade.

- [ ] **Step 4: Establish ignored environment overrides**

```powershell
$env:XDG_CONFIG_HOME = (Resolve-Path test-results/configstore-home).Path
$env:CI = 'true'
git check-ignore test-results/configstore-home
git status --short
```

Expected: the config home is ignored and the tracked tree remains clean. Use
`--watchman=false` on every Jest invocation.

---

### Task 2: Port Measurement Contract and Baseline Provenance

**Files:**
- Create: `frontend/scripts/performance/baseline-source.js`
- Create: `frontend/scripts/performance/baseline-source.test.js`
- Modify: `frontend/scripts/performance/common.js`
- Modify: `frontend/scripts/performance/accept-baseline.js`
- Modify: `frontend/scripts/performance/authoritative.test.js`
- Modify: `frontend/scripts/performance/compare.js`
- Modify: `frontend/scripts/performance/compare.test.js`
- Modify: `frontend/scripts/performance/repeatability.js`
- Modify: `frontend/scripts/performance/repeatability.test.js`
- Modify: `frontend/scripts/performance/report.js`
- Modify: `frontend/scripts/performance/report.test.js`
- Modify: `frontend/performance/README.md`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: existing performance report schema and scenario records.
- Produces:
  `assertBaselineReferenceMachine(report): string`,
  `assertBaselineRepeatability(repeatability, aggregate): object`,
  `compareReports(left, right, maximumVariancePercent, manifest): report`, and
  measurement contract version 5.

- [ ] **Step 1: Port the contract tests before implementation**

Apply the exact source-range test changes to the five test files and add
`baseline-source.test.js`. The new tests must assert:

```javascript
assert.throws(
  () => assertBaselineReferenceMachine({
    environment: { referenceMachine: 'github-hosted-runner' },
  }),
  /named controlled reference machine/
);
assert.equal(timingAggregation('home:runtime.maxLongTaskMs'), 'maximum');
assert.equal(timingAggregation('home:web-vital.LCP'), 'median');
assert.equal(assertMaximumVariancePercent(15), 15);
```

Also cover TTFB's 5 ms absolute tolerance, hosted long-task 50 ms tolerance,
hosted microbenchmark 1 ms tolerance, finite 0-100 variance validation, distinct
`status/evidenceStatus/timingStatus/gateStatus`, and aggregate/report field
agreement.

- [ ] **Step 2: Run the focused tests and observe the expected failure**

```powershell
node --test --test-concurrency=1 scripts/performance/baseline-source.test.js scripts/performance/compare.test.js scripts/performance/repeatability.test.js scripts/performance/report.test.js scripts/performance/authoritative.test.js
```

Expected: FAIL because `baseline-source.js` and the v5 exports/fields do not
exist yet.

- [ ] **Step 3: Implement the v5 contract and provenance guards**

Port the semantic source changes, preserving this exact public contract:

```javascript
const PERFORMANCE_MEASUREMENT_CONTRACT_VERSION = 5;
const PERFORMANCE_MAX_VARIANCE_PERCENT = 15;
const GITHUB_HOSTED_REFERENCE_MACHINE = 'github-hosted-runner';

const timingAggregation = (key) => (
  /:runtime\.maxLongTaskMs$/.test(key) ? 'maximum' : 'median'
);

const BASELINE_REPEATABILITY_CONTRACT = Object.freeze({
  status: 'pass',
  evidenceStatus: 'pass',
  timingStatus: 'pass',
  gateMode: 'strict',
  gateStatus: 'pass',
});
```

The repeatability result must retain raw variance and gated variance separately,
allow hosted timing to be advisory only when compatibility/deterministic/sample
evidence is complete, and reject unknown or mismatched reference-machine
identities. Baseline acceptance must reject hosted/advisory/custom-threshold
evidence even when its execution gate passed.

- [ ] **Step 4: Merge the new test entry without replacing production scripts**

Add only `scripts/performance/baseline-source.test.js` to the existing
`perf:test` command. Confirm every `fatins` deployment and maintenance script
in `frontend/package.json` is unchanged.

- [ ] **Step 5: Run focused and package-level performance tests**

```powershell
node --test --test-concurrency=1 scripts/performance/baseline-source.test.js scripts/performance/compare.test.js scripts/performance/repeatability.test.js scripts/performance/report.test.js scripts/performance/authoritative.test.js
npm.cmd run perf:test
```

Expected: all tests pass; the second command includes the new baseline-source
test file.

- [ ] **Step 6: Commit the measurement contract**

```powershell
git add -- frontend/scripts/performance frontend/performance/README.md frontend/package.json
git commit -m "perf: harden repeatability evidence"
```

---

### Task 3: Port Deterministic Fixture and Emulator Lifecycle Contracts

**Files:**
- Modify: `frontend/performance/fixture-manifest.json`
- Modify: `frontend/performance/global-setup.js`
- Modify: `frontend/performance/global-setup.test.js`
- Modify: `frontend/performance/global-teardown.js`
- Modify: `frontend/performance/playwright.config.js`
- Modify: `frontend/performance/scenarios.json`
- Modify: `frontend/scripts/performance/emulators.test.js`
- Modify: `frontend/scripts/performance/fixtures.js`
- Modify: `frontend/scripts/performance/fixtures.test.js`
- Modify: `frontend/scripts/performance/task07-harness.test.js`

**Interfaces:**
- Consumes: v5 required-metric handling from Task 2.
- Produces: deterministic fixture version
  `fnd-performance-v2-task05-runtime-retired-task07-media-codex-map`, canonical
  hash `c56b0dbae8e449e56eeaa9324e836e97575de1385e1d9f104c5515cc3e4ee194`,
  graceful emulator shutdown, sanitized aggregate teardown errors, and three
  registered one-shot Task 07 scenarios.

- [ ] **Step 1: Port lifecycle and fixture tests first**

Add exact assertions for:

```javascript
assert.equal(Array.isArray(codex), false);
assert.equal(Object.keys(codex).length, 20);
assert.equal(category && typeof category, 'object');
assert.equal(Object.keys(category).length, 250);
assert.equal(Object.values(category).every((value) => typeof value === 'string'), true);
```

Also assert Task 05 HTTPS callables do not count as background triggers,
Playwright shutdown uses `SIGTERM` with at least 80 seconds, aggregate errors
include each bounded child message, and the Task 07 one-shot scenarios expose
their exact `requiredMetrics` arrays.

- [ ] **Step 2: Run tests to verify the old harness fails the new contract**

```powershell
node --test --test-concurrency=1 performance/global-setup.test.js scripts/performance/emulators.test.js scripts/performance/fixtures.test.js scripts/performance/task07-harness.test.js
```

Expected: FAIL on the array-shaped Codex fixture, missing scenario metrics,
missing graceful shutdown, and Task 05 callable classification.

- [ ] **Step 3: Port the deterministic fixture and manifest**

Implement the Codex map shape:

```javascript
const buildCodex = () => Object.fromEntries(
  Array.from({ length: 20 }, (_, categoryIndex) => {
    const key = `categoria_${pad(categoryIndex, 2)}`;
    const values = Object.fromEntries(
      Array.from({ length: 250 }, (_, itemIndex) => ([
        `Codex ${categoryIndex}-${itemIndex}`,
        `Deterministic fixture entry ${categoryIndex}-${itemIndex}`,
      ]))
    );
    return [key, values];
  })
);
```

Update only the demo fixture version/hash. Keep document count `9139`, Storage
object count `136`, and project `demo-fnd-perf`.

- [ ] **Step 4: Port lifecycle classification and teardown evidence**

Rename the setup allowlist to `NON_BACKGROUND_HTTP_FUNCTIONS` and include
`europe-west8-task05ListAdminUsers` and
`europe-west8-task05UpdateResource`. Add:

```javascript
const formatAggregateGateErrorMessage = (prefix, errors) => [
  prefix,
  ...errors.map((error, index) => (
    `[${index + 1}] ${String(error?.message || error || 'Unknown error')}`
      .replace(/\s+/g, ' ')
      .slice(0, 500)
  )),
].join(' ');
```

Record the owned emulator Firestore transport policy in teardown evidence and
configure Playwright web-server shutdown with `SIGTERM` and `120000` ms.

- [ ] **Step 5: Register exact one-shot scenario metric contracts**

Add `task07-media-shell`, `task07-registry-compact`, and
`task07-registry-desktop` with `scheduledOnly: true`. Use the exact metric
lists asserted by `task07-harness.test.js`; do not let
`routes.performance.js` iterate them.

- [ ] **Step 6: Rebuild and verify the fixture deterministically**

```powershell
node --test --test-concurrency=1 performance/global-setup.test.js scripts/performance/emulators.test.js scripts/performance/fixtures.test.js scripts/performance/task07-harness.test.js
npm.cmd run perf:fixture-determinism
```

Expected: all tests pass and the regenerated canonical hash equals
`c56b0dba...`.

- [ ] **Step 7: Commit the harness lifecycle**

```powershell
git add -- frontend/performance frontend/scripts/performance/fixtures.js frontend/scripts/performance/fixtures.test.js frontend/scripts/performance/emulators.test.js frontend/scripts/performance/task07-harness.test.js
git commit -m "perf: stabilize deterministic harness lifecycle"
```

---

### Task 4: Port Browser Evidence Primitives and Runtime Attribution

**Files:**
- Modify: `frontend/performance/tests/browser/helpers.js`
- Modify: `frontend/performance/tests/browser/helpers.test.js`
- Modify: `frontend/src/performance/runtime.js`
- Modify: `frontend/src/performance/runtime.test.js`

**Interfaces:**
- Consumes: v5 scenario phases and required metrics.
- Produces:
  `installOwnedEmulatorFirestoreTransport(context): Promise<void>`,
  `waitForImageRegistrySettlement(page, options): Promise<object>`,
  `sanitizeFivePeerRequestFailure(input): object`,
  `measurePeerTransitionTimings(input): Promise<object>`,
  `retainImageResourceTimings(entries): object[]`, and
  `retainLongTaskEntries(events, options): {totalCount, entries}`.

- [ ] **Step 1: Port helper/runtime tests before source**

Add the source assertions for bounded sanitized request evidence, async response
status recovery, per-browser Firestore transport, finite asset snapshots, image
timing retention, long-task phase attribution, peer visibility, peer convergence
timing, native long-task start time, and RAF callback diagnostics.

Representative required assertions:

```javascript
expect(retainImageResourceTimings(entries)).toHaveLength(128);
expect(retainLongTaskEntries(events).entries[0]).toEqual(expect.objectContaining({
  scenarioPhase: 'interaction',
  routePhase: 'interactive',
}));
expect(summary.postWriteAckConvergenceMs).toEqual([5, 15]);
```

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
node --test --test-concurrency=1 performance/tests/browser/helpers.test.js
npm.cmd test -- --watch=false --runInBand --watchman=false src/performance/runtime.test.js
```

Expected: FAIL because the new exports, long-task start tags, and RAF diagnostics
do not exist.

- [ ] **Step 3: Implement bounded, non-secret diagnostics**

Port the helper functions with these hard bounds:

```javascript
const MAX_RETAINED_IMAGE_RESOURCE_TIMINGS = 128;
const MAX_RETAINED_LONG_TASK_ENTRIES = 64;
const MAX_FIVE_PEER_DIAGNOSTIC_QUERY_KEYS = 16;
```

`sanitizeFivePeerRequestFailure` may retain only classified role/phase/type,
bounded path/query-key metadata, categorical WebChannel fields, status, and
opaque-value length/format. It must never retain raw SID/AID/zx values, request
bodies, headers, auth data, or full URLs.

- [ ] **Step 4: Implement deterministic settlement and attribution**

Use double `requestAnimationFrame` after idle, require registry active/queued
requests to reach zero, retain LCP candidates without text content, tag
`long-task` events with native `entry.startTime`, and pass
`describeTimerCallback(callback)` into RAF resource registration.

- [ ] **Step 5: Run focused tests**

```powershell
node --test --test-concurrency=1 performance/tests/browser/helpers.test.js
npm.cmd test -- --watch=false --runInBand --watchman=false src/performance/runtime.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit evidence primitives**

```powershell
git add -- frontend/performance/tests/browser/helpers.js frontend/performance/tests/browser/helpers.test.js frontend/src/performance/runtime.js frontend/src/performance/runtime.test.js
git commit -m "perf: retain bounded browser timing evidence"
```

---

### Task 5: Port Browser Scenario and Task 07 Lifecycle Evidence

**Files:**
- Create: `frontend/scripts/performance/task07-render-scheduler.js`
- Modify: `frontend/performance/tests/browser/auth.setup.js`
- Modify: `frontend/performance/tests/browser/grigliata-five-peer.performance.js`
- Modify: `frontend/performance/tests/browser/routes.performance.js`
- Modify: `frontend/performance/tests/browser/task07-media-cross-browser.smoke.js`
- Modify: `frontend/performance/tests/browser/task07-media-routes.performance.js`
- Modify: `frontend/performance/tests/browser/task07-media-shell.performance.js`
- Modify: `frontend/performance/tests/browser/task07-media-soak.performance.js`

**Interfaces:**
- Consumes: Task 4 Browser helper APIs.
- Produces:
  `validateRenderSchedulerSnapshot(snapshot, context): object` and
  `drainRouteRenderScheduler(page, options): Promise<object>`; deterministic
  route phases, finite asset/LCP settlement, visible five-peer convergence, and
  settled Task 07 registry/crossfade evidence.

- [ ] **Step 1: Extend the existing harness tests first**

Port the scheduler, one-shot scenario, cleanup-cycle, and workflow ordering
assertions into `task07-harness.test.js`. Run:

```powershell
node --test --test-concurrency=1 scripts/performance/task07-harness.test.js
```

Expected: FAIL because `task07-render-scheduler.js` and the revised scenario
code are absent.

- [ ] **Step 2: Implement the render scheduler**

Create a scheduler that brings the page to front, waits exactly two RAFs, and
fails unless this shape is true:

```javascript
{
  visibilityState: 'visible',
  hasFocus: true,
  state: 'settled',
  frameCount: 2,
  stageCount: 0,
  containerCount: 0,
}
```

Use a 2000 ms bounded timeout and include route/cycle plus at most 20 resource
counts and 10 sanitized resource diagnostics in failures.

- [ ] **Step 3: Port ordinary route measurement rigor**

Filter route scenarios with `scenario.scheduledOnly !== true`; mark
`route-readiness`, `route-active`, `asset-settlement`,
`lcp-settlement`, `interaction`, `post-interaction-settlement`, and
`capture`. Require stable LCP for 500 ms within 5000 ms and explicitly settle
Foes Hub assets after deterministic scrolling. Persist only bounded image, LCP,
and long-task diagnostic arrays.

- [ ] **Step 4: Port five-peer convergence and failure evidence**

Measure Firestore write acknowledgement and each visible peer independently:

```javascript
const transitionTimings = await measurePeerTransitionTimings({
  performWrite: () => placement.update({ col, updatedAt }),
  waitForPeers: pages.map(({ page }, index) => () => waitForKonvaTokenMove(page, {
    tokenId: PROBE_TOKEN_ID,
    from: fromPositions[index],
    deltaX,
    deltaY: 0,
  })),
});
```

Require every peer `document.visibilityState` to be `visible`, wait for
finite network and registry settlement, retain at most 16 request failures per
classification, and attach sanitized evidence if the scenario fails.

- [ ] **Step 5: Port Task 07 route, shell, and soak settlement**

Require Home to show at least 400 managed images and 1-50 batched catalog
listeners. Require desktop/compact Grigliata registries to settle with no active
or queued requests, no more than two unpinned records, and no more than 256 KiB
unpinned decoded bytes. During the 50-map soak, prove active/outgoing battlemap
layers, active/crossfade pins, exact gallery rows, and scheduler-clean route
teardown for every cycle.

- [ ] **Step 6: Run all non-live harness tests**

```powershell
node --test --test-concurrency=1 scripts/performance/task07-harness.test.js performance/tests/browser/helpers.test.js performance/global-setup.test.js
```

Expected: all tests pass. Browser scenarios are exercised later against owned
emulators, never against production.

- [ ] **Step 7: Commit Browser scenario evidence**

```powershell
git add -- frontend/scripts/performance/task07-render-scheduler.js frontend/scripts/performance/task07-harness.test.js frontend/performance/tests/browser
git commit -m "perf: stabilize Task 07 browser evidence"
```

---

### Task 6: Port Login and Firebase Bootstrap Isolation

**Files:**
- Modify: `frontend/src/App.js`
- Modify: `frontend/src/App.test.js`
- Modify: `frontend/src/components/Login.js`
- Create: `frontend/src/components/Login.moduleIsolation.test.js`
- Modify: `frontend/src/components/firebaseConfig.js`
- Modify: `frontend/src/components/firebaseConfig.test.js`

**Interfaces:**
- Consumes: `window.__FND_PERF_FORCE_FIRESTORE_LONG_POLLING__` from Task 4.
- Produces: login module isolation, test-only WebKit emulator long-polling, and
  unchanged production Firebase runtime configuration.

- [ ] **Step 1: Add the failing bootstrap tests**

Add the module-isolation test that mocks
`../data/userData/userDataCommands`, requires `Login` inside
`jest.isolateModules`, and asserts `commandModuleLoads === 0`. Update
Firebase tests to assert ordinary performance builds pass `{}` and the owned
WebKit flag passes:

```javascript
{ experimentalForceLongPolling: true }
```

Update the App cold-session assertion to require class `text-xl`.

- [ ] **Step 2: Run tests to confirm baseline failure**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/App.test.js src/components/Login.moduleIsolation.test.js src/components/firebaseConfig.test.js
```

Expected: FAIL because Login eagerly imports the command module, the performance
Firestore settings still force the prior mode, and the status heading is
`text-2xl`.

- [ ] **Step 3: Implement lazy command loading and emulator-only transport**

Replace the eager command import with:

```javascript
const updateCharacterCreation = async (input) => {
  const commands = await import('../data/userData/userDataCommands');
  return commands.updateCharacterCreation(input);
};
```

Add `getPerformanceFirestoreSettings()` that returns forced long polling only
when the window flag is exactly `true`; production continues to call
`getFirestore(app)`, so App Check and the `/fatins-runtime/firebase-client`
endpoint are unchanged. Change only the status heading size in `App.js`.

- [ ] **Step 4: Run focused tests and production-config guards**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/App.test.js src/components/Login.moduleIsolation.test.js src/components/firebaseConfig.test.js
npm.cmd run release:test
```

Expected: all tests pass; production Firebase/App Check guards remain green.

- [ ] **Step 5: Commit bootstrap isolation**

```powershell
git add -- frontend/src/App.js frontend/src/App.test.js frontend/src/components/Login.js frontend/src/components/Login.moduleIsolation.test.js frontend/src/components/firebaseConfig.js frontend/src/components/firebaseConfig.test.js
git commit -m "perf: isolate login bootstrap work"
```

---

### Task 7: Port Bounded Catalog Item Subscriptions

**Files:**
- Modify: `frontend/src/data/catalogItemRepository.js`
- Modify: `frontend/src/data/catalogItemRepository.test.js`
- Modify: `frontend/src/data/query-contracts.json`
- Modify: `frontend/src/data/useCatalogItemsById.js`
- Create: `frontend/src/data/useCatalogItemsById.test.js`

**Interfaces:**
- Produces:
  `CATALOG_ITEM_QUERY_MAX_IDS = 10`,
  `subscribeCatalogItems(itemIds, observer): () => void`,
  `CATALOG_ITEM_QUERY_STARTUP_CONCURRENCY = 4`, and
  `chunkCatalogItemIds(itemIds): string[][]`.
- Consumers: existing Home inventory/equipment hooks continue using
  `useCatalogItemsById(itemIds)` and receive
  `{itemsById, status, error}`.

- [ ] **Step 1: Port repository and hook tests before implementation**

Tests must prove sorted/deduplicated Firestore `documentId() in` queries,
actor-scoped listener sharing, filtering of unexpected documents, empty/missing
snapshots, unsafe/oversized rejection, delimiter-safe keys, 500 IDs in 50
chunks, four-listener startup waves, realtime replacement, access-generation
fencing, errors, and unmount cleanup.

- [ ] **Step 2: Run focused tests to observe the API mismatch**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/data/catalogItemRepository.test.js src/data/useCatalogItemsById.test.js
```

Expected: FAIL because production exposes single-document
`subscribeCatalogItem` and no chunked hook helpers.

- [ ] **Step 3: Implement the bounded query repository**

Use sorted unique IDs and one shared query per exact JSON-encoded batch:

```javascript
query(
  collection(db, 'items'),
  where(documentId(), 'in', stableItemIds)
)
```

Reject 0 or more than 10 IDs before opening a listener, freeze returned maps,
derive trusted IDs from snapshot document IDs, and ignore unrequested results.

- [ ] **Step 4: Implement four-wave startup and generation fencing**

Chunk sorted IDs by 10; start at most four subscriptions whose initial snapshot
has not settled. A success or error settles one initial chunk and starts the
next. Use JSON scope keys containing UID, repository access generation, and
normalized IDs; close old listeners and ignore late snapshots.

- [ ] **Step 5: Update the query contract**

Replace `home-inventory-catalog-item-document` with
`home-inventory-catalog-item-batches`, query key
`catalog.items-batch.subscribe.v1`, at-most-10 scope, and the four-listener
startup policy. Add repository query
`task05-home-catalog-item-batches` with automatic indexing. Do not add a
Firestore composite index.

- [ ] **Step 6: Run focused and contract checks**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/data/catalogItemRepository.test.js src/data/useCatalogItemsById.test.js
npm.cmd run perf:check-query-contracts
npm.cmd run perf:check-firestore-imports
```

Expected: all tests and checks pass.

- [ ] **Step 7: Commit catalog batching**

```powershell
git add -- frontend/src/data/catalogItemRepository.js frontend/src/data/catalogItemRepository.test.js frontend/src/data/query-contracts.json frontend/src/data/useCatalogItemsById.js frontend/src/data/useCatalogItemsById.test.js
git commit -m "perf: batch Home catalog subscriptions"
```

---

### Task 8: Port Grigliata Media Access and Resolver Fencing

**Files:**
- Modify: `frontend/src/components/grigliata/GlobalGrigliataMusicPlayer.js`
- Modify: `frontend/src/components/grigliata/GlobalGrigliataMusicPlayer.test.js`
- Modify: `frontend/src/components/grigliata/GrigliataPage.js`
- Modify: `frontend/src/components/grigliata/GrigliataPage.test.js`
- Modify: `frontend/src/components/grigliata/characterTokenMedia.js`
- Modify: `frontend/src/components/grigliata/characterTokenMedia.test.js`
- Modify: `frontend/src/components/grigliata/useGrigliataPageData.js`

**Interfaces:**
- Consumes: `profileFresh` and `repositoryAccessGeneration` from AuthContext.
- Produces: two-worker, 60-ID callable batching; all-or-nothing resolver
  failure; profile-ready media reads; request-generation fencing; stable
  canonical-media maps.

- [ ] **Step 1: Add access/resolver regression tests first**

Add tests named:

```text
waits for the authoritative profile role before resolving the automatic media mode
ignores canonical media resolved under an earlier access generation
waits for a fresh auth profile before resolving placed canonical media
resolves every placement through bounded 60-ID chunks without silent loss
rejects an entire multi-chunk result when any bounded callable fails
```

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/components/grigliata/GlobalGrigliataMusicPlayer.test.js src/components/grigliata/GrigliataPage.test.js src/components/grigliata/characterTokenMedia.test.js
```

Expected: FAIL because media resolution starts before a fresh role, truncates
after 60 IDs, and cannot fence stale access generations.

- [ ] **Step 3: Implement bounded callable workers**

Keep `MAX_CHARACTER_TOKEN_IDS = 60`, add
`CHARACTER_MEDIA_RESOLVE_CONCURRENCY = 2`, preserve every normalized safe ID,
build 60-ID chunks, and run at most two worker loops. Filter every response to
its requested chunk and reject the whole aggregate if any invocation rejects.

- [ ] **Step 4: Gate music and placed media on authoritative access**

Do not resolve automatic music mode until `userRole` is non-empty. In
`GrigliataPage`, pass:

```javascript
const isCanonicalMediaAccessReady = profileFresh ?? !loading;
const { repositoryAccessGeneration = 0 } = useAuthSession();
```

Include the generation in the request/scope key. Use a monotonically increasing
request-generation ref and an `isCurrentRequest()` predicate so old promises
and retries cannot publish. Clear maps on logout and avoid React updates when
the canonical media map is structurally unchanged.

- [ ] **Step 5: Run focused tests**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/components/grigliata/GlobalGrigliataMusicPlayer.test.js src/components/grigliata/GrigliataPage.test.js src/components/grigliata/characterTokenMedia.test.js
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit media access fencing**

```powershell
git add -- frontend/src/components/grigliata/GlobalGrigliataMusicPlayer.js frontend/src/components/grigliata/GlobalGrigliataMusicPlayer.test.js frontend/src/components/grigliata/GrigliataPage.js frontend/src/components/grigliata/GrigliataPage.test.js frontend/src/components/grigliata/characterTokenMedia.js frontend/src/components/grigliata/characterTokenMedia.test.js frontend/src/components/grigliata/useGrigliataPageData.js
git commit -m "fix: fence Grigliata media access"
```

---

### Task 9: Port Grigliata Viewport, Media Priority, and Crossfade Lifecycle

**Files:**
- Modify: `frontend/src/components/grigliata/GrigliataBoard.js`
- Modify: `frontend/src/components/grigliata/GrigliataBoard.test.js`
- Modify: `frontend/src/components/grigliata/GrigliataPage.js`
- Modify: `frontend/src/components/grigliata/GrigliataPage.test.js`

**Interfaces:**
- Consumes: canonical media maps from Task 8.
- Produces: `buildBoundedTokenMediaIdSet(input): Set<string>` with
  `allowVisibleMedia`; geometry-aware viewport fit; preserved board mount
  across map switches; reset map-scoped interaction/initiative state.

- [ ] **Step 1: Port board lifecycle tests before source**

Add tests named:

```text
bounds token media leases and excludes offscreen tokens after priority selection
defers tiny overview token media except active, selected, and viewer-owned art
keeps token media priority and fixture order stable when candidates exceed the limit
defers ordinary visible token media until the current viewport fit is ready
fits a new map before leasing its ordinary token media
waits for background geometry before completing the token-media viewport fit
preserves the completed token-media fit across wheel zoom updates
preserves a narration viewport when unrelated combat-map geometry hydrates
resets a dirty initiative draft when the same token appears on another map
keeps the board mounted across active-map changes so its outgoing layer can crossfade
```

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/components/grigliata/GrigliataBoard.test.js src/components/grigliata/GrigliataPage.test.js
```

Expected: FAIL because ordinary visible media leases before a geometry-complete
fit, the board remounts by map key, and map-scoped UI state persists incorrectly.

- [ ] **Step 3: Implement media priority and fit identity**

Add a 16 px minimum useful visible-media size. Priority order is active turn,
selected, viewer-owned, then useful visible media; manager mobility alone does
not raise media priority. Track `fittedViewportKey` inside viewport state and
build the key from background/narration identity plus resolved geometry.

- [ ] **Step 4: Gate fit and reset map-scoped state**

Fit only when stage size and background geometry are ready, preserve the fit key
during wheel zoom, and prevent unrelated combat-map geometry from invalidating
narration bounds. On map changes clear pointer/drop/selection/AoE/light/darkness/
wall/ping/turn-order prompt and initiative draft state.

- [ ] **Step 5: Preserve crossfade ownership**

Remove `key={activeBackgroundId || '__grid__'}` from the `GrigliataBoard`
mount so outgoing image layers can crossfade. Add the active background key to
`TurnOrderPanel` instead so only map-scoped initiative draft state remounts.

- [ ] **Step 6: Run focused tests**

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false src/components/grigliata/GrigliataBoard.test.js src/components/grigliata/GrigliataPage.test.js
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit board lifecycle**

```powershell
git add -- frontend/src/components/grigliata/GrigliataBoard.js frontend/src/components/grigliata/GrigliataBoard.test.js frontend/src/components/grigliata/GrigliataPage.js frontend/src/components/grigliata/GrigliataPage.test.js
git commit -m "fix: stabilize Grigliata map rendering"
```

---

### Task 10: Adapt Workflow and Roadmap Documentation for Production

**Files:**
- Modify: `.github/workflows/performance.yml`
- Modify: `docs/performance-improvement-plan/README.md`
- Modify: `frontend/performance/README.md`
- Verify: `frontend/package.json`
- Exclude: `docs/performance-improvement-plan/task-07/fatin-test-closure-2026-08-16.md`

**Interfaces:**
- Consumes: all prior harness/runtime ports.
- Produces: CI failure artifacts before soak, accurate Fatins production
  documentation, and no false test-project production claim.

- [ ] **Step 1: Port workflow assertions before YAML**

Ensure `task07-harness.test.js` asserts the authoritative step has
`id: authoritative`, uploads `performance-results`, test results, and
Playwright reports only on authoritative failure, then runs soak and uploads the
combined final artifact.

- [ ] **Step 2: Modify the workflow**

Add the failure artifact step with retention 30 days and
`if-no-files-found: error`. Preserve existing push branches `main, devs`,
Node 22, Java 21, serial workers, and demo-only emulator commands. Do not add a
deployment step or secret.

- [ ] **Step 3: Rewrite roadmap status without copying test closure evidence**

State that Fatins-test commit `296eeca` is the reviewed Task 07 source closure
and that production adaptation follows this spec/plan. Do not claim production
deployment or copy test bundle hashes, workflow run IDs, fingerprints, or the
438-line test closure file.

- [ ] **Step 4: Run harness tests and verify production scripts**

```powershell
node --test --test-concurrency=1 scripts/performance/task07-harness.test.js
git diff c5ead60ce1dc63489176aade057f15ded6fad7fb..HEAD -- frontend/package.json
rg -n "fatins-test|fatin-test" frontend/src frontend/scripts .github/workflows
```

Expected: harness tests pass; the package diff only adds the baseline-source
test to `perf:test`; executable source/workflow contains no test-project
binding. Documentation references are permitted only as historical source
context.

- [ ] **Step 5: Commit workflow/documentation adaptation**

```powershell
git add -- .github/workflows/performance.yml docs/performance-improvement-plan/README.md frontend/performance/README.md frontend/package.json
git commit -m "docs: adapt Task 07 evidence for production"
```

---

### Task 11: Audit Port Completeness and Firebase/Data Scope

**Files:**
- Inspect: every path changed from `c5ead60` to `HEAD`
- Inspect unchanged planes:
  `frontend/functions`, `firestore.rules`, `firestore.indexes.json`,
  `storage.rules`, `firebase.json`, and `backend`

**Interfaces:**
- Consumes: all implementation commits.
- Produces: an exact expected-path manifest and proof that migration and
  non-Hosting deployment remain unnecessary.

- [ ] **Step 1: Compare the final port against the semantic source range**

```powershell
git diff --name-status c5ead60ce1dc63489176aade057f15ded6fad7fb..HEAD
git -C C:/Users/Marco/OneDrive/git_projects/fatins-test diff --name-status b652b69544526b3ebdc078e52836dffda6411064..296eeca60fc3d1ec8b3bde535a325f7683348140
```

Expected: every production-relevant source path is present with equivalent
intent; the test closure document is absent; the design/plan documents are the
only FND-only additions.

- [ ] **Step 2: Prove protected Firebase planes are unchanged**

```powershell
git diff --exit-code c5ead60ce1dc63489176aade057f15ded6fad7fb..HEAD -- frontend/functions firestore.rules firestore.indexes.json storage.rules firebase.json backend
```

Expected: exit 0 with no output.

- [ ] **Step 3: Prove no new runtime write API was introduced**

```powershell
git diff -U0 c5ead60ce1dc63489176aade057f15ded6fad7fb..HEAD -- frontend/src | rg "^\+.*(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction|httpsCallable)"
```

Expected: no new write call. Existing imports/context lines do not count; any
added invocation stops the plan for review.

- [ ] **Step 4: Run repository boundary checks**

```powershell
Set-Location frontend
npm.cmd run perf:check-firestore-imports
npm.cmd run perf:check-callable-registry
npm.cmd run perf:check-query-contracts
npm.cmd run perf:check-shared-config-boundaries
npm.cmd run perf:check-user-data-boundaries
npm.cmd run perf:check-media-boundaries
```

Expected: every check passes.

- [ ] **Step 5: Confirm a clean tracked tree**

```powershell
git status --short --branch
git diff --check
```

Expected: no tracked changes and local `devs` is ahead only by reviewed
commits.

---

### Task 12: Run the Complete Static, Unit, Build, and Emulator Matrix

**Files:**
- Generated ignored artifacts only under `frontend/build`,
  `frontend/test-results`, `frontend/performance-results`,
  `frontend/playwright-report`, and emulator logs.

**Interfaces:**
- Consumes: clean committed implementation.
- Produces: fresh pass evidence for every local non-live gate.

- [ ] **Step 1: Run the full frontend and focused Task 07 suites**

```powershell
$env:CI = 'true'
npm.cmd test -- --watch=false --runInBand --watchman=false
npm.cmd run test:task07
```

Expected: all suites pass, with 1310 full-suite tests expected from the reviewed
source range. Existing React `act(...)` warnings may remain only if no new
warning class or failed assertion appears.

- [ ] **Step 2: Run Functions checks**

```powershell
Set-Location functions
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd test
```

Expected: lint has zero errors and no more than the five recorded baseline
warnings; TypeScript passes; all 211 Functions tests pass.

- [ ] **Step 3: Run backend backup/health tests**

```powershell
Set-Location ../..
C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/fnd-maintenance-env/Scripts/python.exe -m unittest backend.test_backend_health_and_maintenance backend.test_firestore_backup
```

Expected: all 22 tests pass. Do not print credential environment variables.

- [ ] **Step 4: Run release/performance unit gates**

```powershell
Set-Location frontend
$env:XDG_CONFIG_HOME = (Resolve-Path test-results/configstore-home).Path
npm.cmd run perf:test
npm.cmd run release:test
```

Expected: all Node tests pass with zero failures.

- [ ] **Step 5: Build and verify production**

```powershell
npm.cmd run build:production
npm.cmd run verify:production-build
```

Expected: production build succeeds, source maps are absent where required,
performance instrumentation is absent from the normal build, and all production
binding guards pass.

- [ ] **Step 6: Run the owned rules/callable integration gate**

```powershell
node scripts/performance/rules-emulators.js
```

Expected: Firestore rules, Task 05/06/07 callables, directory queries, and all
negative permission tests pass against `demo-fnd-perf); the script exits 0 and
ports 4000, 4400, 4500, 5001, 8080, 9099, 9150, and 9199 are free afterward.

---

### Task 13: Run Authoritative Browser and Performance Regression Gates

**Files:**
- Generated ignored performance results and Playwright reports only.

**Interfaces:**
- Consumes: the verified production-adapted source/build.
- Produces: Chromium, Firefox, WebKit, five-peer, authoritative repeatability,
  media lifecycle, and 600-second soak evidence.

- [ ] **Step 1: Run complete local CI and cross-browser smoke**

```powershell
$env:FND_PERF_REFERENCE_MACHINE = 'fnd-production-port-pc'
npm.cmd run perf:ci
npm.cmd run perf:smoke-cross-browser
```

Expected: all deterministic budgets and cross-browser readiness gates pass.

- [ ] **Step 2: Run two-run authoritative measurement**

```powershell
$env:FND_PERF_REFERENCE_MACHINE = 'fnd-production-port-pc'
npm.cmd run perf:authoritative
```

Expected: compatibility, deterministic evidence, timing evidence, strict gate,
and budget comparison all pass under measurement contract v5. Do not accept or
rewrite the checked-in baseline.

- [ ] **Step 3: Run Task 07 media integration and cross-browser checks**

```powershell
npm.cmd run perf:media
npm.cmd run perf:media:cross-browser
```

Expected: all media route, registry, shell, Firefox, and WebKit checks pass
serially against `demo-fnd-perf`.

- [ ] **Step 4: Run the full 600-second lifecycle soak**

```powershell
$env:FND_TASK07_SOAK_DURATION_MS = '600000'
npm.cmd run perf:media:soak
```

Expected: at least three settled cycles, all 50 backgrounds and 200 tokens,
stable active/crossfade pins, no upward registry trend, no leaked stages,
containers, listeners, timers, media, or emulator processes.

- [ ] **Step 5: Recheck ports and tracked status**

```powershell
$ports = @(4000,4400,4500,5000,5001,8080,9099,9150,9199)
$busy = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort })
if ($busy.Count -ne 0) { throw "Owned emulator ports remain occupied." }
git status --short
```

Expected: zero busy owned ports and no tracked changes.

---

### Task 14: Freeze the Release Commit and Take the Final Data-Safety Snapshot

**Files:**
- Create ignored backup under
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/final-predeploy-2026-08-19/`
- Use the existing ignored PC CA bundle at
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/windows-system-ca-bundle.pem`

**Interfaces:**
- Consumes: all green local gates and a clean commit.
- Produces: exact release SHA, validated predeploy Firestore hash/checksum, no
  active session, and authenticated Hosting-only Firebase CLI preflight.

- [ ] **Step 1: Record the exact clean release SHA**

```powershell
git status --porcelain
$releaseSha = git rev-parse HEAD
git show --stat --oneline $releaseSha
```

Expected: porcelain output is empty and the SHA includes the approved design,
plan, and all implementation commits.

- [ ] **Step 2: Re-audit active production presence read-only**

Use the validated recursive export/inspection code to report only:

```text
presence_document_count
active_presence_within_75_seconds
grigliata_updates_within_5_minutes
grigliata_updates_within_15_minutes
persisted_active_turn_cursor_count
```

Expected: zero active presence and zero recent Grigliata activity. A dormant
cursor may remain and must not be changed. If active users are detected, wait
and repeat; do not deploy.

- [ ] **Step 3: Take and validate a fresh recursive backup**

```powershell
$python = 'C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/fnd-maintenance-env/Scripts/python.exe'
& $python -m backend.main --export-data --project fatins --allow-live-project --confirm-project fatins --output-dir C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/final-predeploy-2026-08-19
```

Then load the resulting file with
`backend.firestore_backup.read_backup(..., expected_project_id='fatins')` and
record only canonical hash, document/root/subcollection counts, byte length,
and SHA-256. Never run a restore or execute flag.

- [ ] **Step 4: Reconfirm migration is a no-op**

```powershell
git diff --exit-code c5ead60ce1dc63489176aade057f15ded6fad7fb..HEAD -- frontend/functions firestore.rules firestore.indexes.json storage.rules firebase.json backend
git diff -U0 c5ead60ce1dc63489176aade057f15ded6fad7fb..HEAD -- frontend/src | rg "^\+.*(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction|httpsCallable)"
```

Expected: protected planes have no diff and the write-API scan has no added
invocation. No migration runs.

- [ ] **Step 5: Authenticate Firebase CLI using the PC trust bundle**

```powershell
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/windows-system-ca-bundle.pem).Path
$env:SSL_CERT_FILE = $env:NODE_EXTRA_CA_CERTS
Set-Location frontend
npx.cmd firebase projects:list
```

Expected: the authenticated project list includes `fatins`. Do not print
tokens, certificate contents, or credential paths beyond the local bundle path.

---

### Task 15: Deploy Hosting and Verify the Exact Live Bundle

**Files:**
- Deploy: `frontend/build` to Firebase Hosting project `fatins`
- Do not deploy any other Firebase plane.

**Interfaces:**
- Consumes: exact release SHA/build and validated backup.
- Produces: a successful Hosting release and live asset hashes matching the
  local build.

- [ ] **Step 1: Rebuild from the frozen release commit**

```powershell
git status --porcelain
npm.cmd run build:production
npm.cmd run verify:production-build
```

Expected: clean source before build and both commands pass.

- [ ] **Step 2: Deploy only Hosting**

```powershell
npx.cmd firebase deploy --only hosting --project fatins --non-interactive
```

Expected: Firebase reports only Hosting deployment to `fatins` and returns the
production URL. If output names Functions, Firestore, indexes, or Storage, stop
before confirmation or treat the release as failed.

- [ ] **Step 3: Match live and local entry assets**

Fetch `https://fatins.web.app/` with a cache-busting query, parse its main
script path, fetch that exact path with another query, and compare SHA-256 to
the corresponding `frontend/build/static/js/` file. In PowerShell, append
queries using `${liveAssetPath}` so path interpolation is exact.

Expected: HTTP 200, the live asset path exists locally, and hashes match.

- [ ] **Step 4: Run non-authenticated production health checks**

Verify `/`, `/home`, and one lazy-route URL return the production shell with
the expected CSP and no emulator/test project identifiers. Do not infer runtime
success from HTML alone; Browser acceptance is the next task.

- [ ] **Step 5: Use the exact Hosting-only rollback if a live gate fails**

From the untouched primary FND checkout, verify `main` is
`c5ead60ce1dc63489176aade057f15ded6fad7fb`, rebuild it, and deploy only
Hosting:

```powershell
Set-Location C:/Users/Marco/OneDrive/git_projects/fnd
git rev-parse main
Set-Location frontend
npm.cmd run build:production
npm.cmd run verify:production-build
npx.cmd firebase deploy --only hosting --project fatins --non-interactive
```

Use the same PC CA environment from Task 14. Verify the restored live asset
matches the main build. Never run a Firestore restore automatically; the failed
port remains unpushed until diagnosed and revalidated.

---

### Task 16: Perform Logged-In In-App Browser Acceptance

**Files:**
- No local file changes.
- Ephemeral production presence may be created only by visiting Grigliata with
  the already logged-in test account.

**Interfaces:**
- Consumes: exact deployed Hosting build and existing in-app Browser session.
- Produces: authenticated runtime evidence without persistent gameplay/catalog
  mutations.

- [ ] **Step 1: Refresh Home and verify session/bootstrap**

Use only the in-app Browser tab already at `https://fatins.web.app/home`.
Reload/navigate fresh, wait for the authenticated shell, and verify the test
account remains signed in, Home content appears, no error boundary is visible,
and no new console/runtime error is emitted.

- [ ] **Step 2: Verify catalog and lazy-route behavior read-only**

Navigate to Bazaar/catalog and at least one other lazy route. Verify list/query
results render, filters/open-close UI work without saving, route transitions
preserve login, and no stale-chunk recovery/error appears.

- [ ] **Step 3: Verify Grigliata rendering without gameplay mutation**

Enter Grigliata, verify board geometry, active background, token nodes/media,
music controls, and panel state render. Do not move tokens, change maps, save
initiative, upload media, or alter gameplay state.

- [ ] **Step 4: Clean up ephemeral presence**

Immediately before navigation that deletes the test account's presence, request
the required action-time confirmation. After approval, leave Grigliata and
verify read-only that the test account's ephemeral presence record is gone. Do
not delete any other user's record.

- [ ] **Step 5: Reverify the served asset**

Confirm the Browser loaded the same main asset path/hash verified in Task 15.
Any Browser regression triggers redeployment of the prior known-good Hosting
build and blocks push.

---

### Task 17: Compare Post-Deploy Data, Push Devs, and Verify Exact-SHA CI

**Files:**
- Create ignored postdeploy backup under
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/final-postdeploy-2026-08-19/`
- No tracked edits.

**Interfaces:**
- Consumes: accepted live build, cleaned Browser presence, release SHA.
- Produces: unexplained-data-drift result, `origin/devs` at the deployed SHA,
  and green push-triggered/manual performance workflows for that SHA.

- [ ] **Step 1: Take and validate a postdeploy read-only export**

Run the same `backend.main --export-data` command as Task 14 with absolute
output directory
`C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/final-postdeploy-2026-08-19`.
Validate with `read_backup` and compare canonical hashes to the predeploy
export.

Expected: hashes match after the Browser presence is removed. If they differ,
classify paths read-only. Never restore over legitimate concurrent user writes.
Unexplained deletion or mutation blocks completion.

- [ ] **Step 2: Push without force**

```powershell
git status --porcelain
git push origin devs
git fetch origin devs
git rev-parse HEAD
git rev-parse origin/devs
```

Expected: clean tree and identical local/remote release SHA.

- [ ] **Step 3: Verify push-triggered workflows for the exact SHA**

```powershell
$releaseSha = git rev-parse HEAD
gh run list --branch devs --commit $releaseSha --json databaseId,headSha,name,status,conclusion,url
```

Wait until every applicable push-triggered job for that SHA completes
successfully. A run for another SHA is not evidence.

- [ ] **Step 4: Dispatch and verify the full benchmark for devs**

```powershell
gh workflow run performance.yml --ref devs
```

Wait for the dispatched run whose `headSha` equals the release SHA. Verify its
full-benchmark job and final artifacts. If repository policy does not make the
scheduled-only job runnable on dispatch, the already completed local
authoritative/soak evidence remains required and the exact reason must be
reported; push-triggered jobs still must be green.

- [ ] **Step 5: Recheck production after CI**

Fetch the live main asset again and confirm it still matches the release build.
Verify Home remains healthy in the in-app Browser.

---

### Task 18: Remove Every Temporary Artifact and Prove Final State

**Files/paths to remove after resolving exact absolute paths:**
- Isolated worktree:
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/fnd-devs-update-worktree`
- Maintenance Python environment:
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/fnd-maintenance-env`
- uv cache:
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/uv-cache`
- Temporary CA bundle:
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/windows-system-ca-bundle.pem`
- Preflight, predeploy, and postdeploy backup directories under the exact
  `C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/` paths created by
  this work.
- Worktree-owned `node_modules`, builds, Firebase state, test results,
  performance results, Playwright reports/auth state, npm/config caches, and
  logs; these disappear with the worktree.

**Interfaces:**
- Consumes: successful deployment, remote/CI verification, and no rollback need.
- Produces: only the primary FND worktree, clean FND main, clean Fatins-test
  main, and no agent-created temporary artifact.

- [ ] **Step 1: Verify cleanup preconditions**

```powershell
git status --porcelain
git rev-parse HEAD
git rev-parse origin/devs
```

Expected: clean and exact SHA equality. Confirm rollback is no longer needed
before deleting local backups; deletion makes those local copies unrecoverable.

- [ ] **Step 2: Resolve and validate every destructive target**

From the primary FND checkout, use `Resolve-Path -LiteralPath` for each target
and assert every resolved path begins with:

```text
C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/
```

Do not continue if a path resolves to the repository root, workspace root, user
profile, an empty string, or outside the backups directory.

- [ ] **Step 3: Remove the isolated worktree through Git**

```powershell
git worktree remove C:/Users/Marco/OneDrive/git_projects/fnd/backend/backups/fnd-devs-update-worktree
git worktree prune
```

Expected: worktree and its ignored dependencies/build/results are removed while
branch `devs` and its commits remain.

- [ ] **Step 4: Remove remaining exact temporary paths**

Use PowerShell `Remove-Item -LiteralPath` only on the validated maintenance
environment, uv cache, CA bundle, and the exact agent-created backup
directories/files. Do not use a glob, `$HOME`, `~`, or a recursively computed
unvalidated path.

- [ ] **Step 5: Verify final Git/worktree cleanliness**

```powershell
git worktree list --porcelain
git status --short --branch
git rev-parse main origin/main devs origin/devs
git -C C:/Users/Marco/OneDrive/git_projects/fatins-test status --short --branch
```

Expected: only the primary FND worktree remains; `main == origin/main ==
c5ead60`; `devs == origin/devs == deployed release SHA`; both repositories
are clean.

- [ ] **Step 6: Verify temporary paths and owned ports are absent**

Check every exact path from this task with `Test-Path -LiteralPath`; all return
`False`. Confirm no owned emulator port is listening and no ephemeral Browser
presence/test artifact remains.

- [ ] **Step 7: Completion audit**

Match each specification completion criterion to current evidence: semantic
path coverage, no migration, pre/post data comparison, complete local matrix,
live asset hash, logged-in Browser acceptance, remote exact SHA, exact-SHA CI,
unchanged main, and cleanup. Mark the goal complete only when every item is
proven.
