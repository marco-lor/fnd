# Task 07 operations runbook

Date: 2026-07-26

Current status: local candidate only; production activation is prohibited

## Hard stop

Do not deploy, enable, backfill, or apply CORS for Task 07 while any of these
conditions is true:

- the final full frontend, Functions, rules, build, startup, and demo integration
  gates have not passed from the clean merged revision;
- the full route, cross-browser, 50-map/token, ten-minute lifecycle, `perf:ci`,
  and two-pass authoritative repeatability gates are incomplete;
- V1 token copy and spawn operations do not yet acquire an owned canonical
  family or reviewed reference-ledger entry; or
- Task 07 foe `v1-write` can be enabled without the Task 06 `duplicate-foe` V2
  operation being deployed and enabled; or
- production backup, write-backfill, restore, and reconciliation procedures are
  unreviewed.

The presence of green unit tests, a green build, or a green `npm start` smoke
does not override this stop.

## Non-negotiable safety rules

1. Work only in an isolated worktree while port 3000 or a live battle exists.
2. Use only exact project `demo-fnd-perf` and loopback emulators for Task 07
   browser/rules/backfill validation.
3. Use read-only `/home` for ordinary browser evidence. Never mount, refresh,
   click, or otherwise manipulate the live `/grigliata` route.
4. Run one heavyweight workload at a time. Use one browser worker, serial rules
   tests, and `--runInBand` for Jest.
5. Bound every long command with a hard timeout and inspect owned processes and
   ports after it exits. Never leave an unbounded shell command overnight.
6. Never stop an existing port-3000 process. Owned validation uses port 3001 or
   the checked-in emulator ports.
7. Never use bare `firebase deploy`. Each future deployment plane requires a
   separately reviewed command and approval.
8. Do not accept or rewrite a performance baseline from a partial run.
9. Do not delete legacy originals, canonical objects, or lifecycle ledgers as a
   rollback shortcut.

## Before any local validation

From the isolated worktree, record:

```powershell
git status --short --branch
node --version
npm.cmd --version
firebase.cmd --version
Get-NetTCPConnection -State Listen | Where-Object {
  $_.LocalPort -in 3000,3001,4000,4400,4500,5000,5001,8080,8085,9099,9199
}
```

Confirm all of the following:

- Task 07 flags are unset in the ordinary shell;
- project IDs and environment files resolve to demo values for emulator tests;
- Java 21 is available for the Firebase emulators;
- task-local cache/temp directories have sufficient space;
- no stale Task 07 Node, Java, browser, or emulator process is running; and
- any port-3000 PID belongs to the user's pre-existing app and will not be
  touched.

If a previous run ended during a PC freeze, do not immediately rerun it. First
inspect Windows System/Application events, current memory/disk space, owned
process trees, listening ports, and the previous log tail. Resume with the
smallest serial gate that can distinguish an application failure from a host
failure.

## Resource-bounded local gate sequence

Run these groups separately. Do not paste them into one chained command.
Capture stdout/stderr and stop if memory pressure grows, a process survives its
owner, or a port remains bound unexpectedly.

### 1. Static boundaries

From `frontend`:

```powershell
npm.cmd run perf:check-firestore-imports
npm.cmd run perf:check-callable-registry
npm.cmd run perf:check-query-contracts
npm.cmd run perf:check-shared-config-boundaries
npm.cmd run perf:check-user-data-boundaries
```

Expected candidate inventory:

- 36 registered callables across 3 regions;
- 57 listener contracts;
- 10 repository shapes;
- 7 activated index signatures; and
- 42 tracked Task 05 legacy-access files plus 1 adapter, with no new direct
  access.

### 2. Functions

From `frontend/functions`:

```powershell
npm.cmd run lint
npm.cmd test
```

`npm test` includes the TypeScript build. Expected result for this candidate is
110/110 tests.

### 3. Rules

Start no manually persistent emulator. Use `emulators:exec` so ownership and
shutdown are automatic, exact project `demo-fnd-perf`, Firestore and Storage
only, Java 21, and test concurrency 1.

Focused command body:

```powershell
node --test --test-concurrency=1 performance/tests/task07-media-rules.test.js
```

Then run the deterministically seeded full rules body:

```powershell
npm.cmd run perf:rules
```

Expected results are 10/10 focused and 30/30 full. Negative authorization cases
will print denied-write diagnostics. Treat an unexpected allow, emulator crash,
or non-owned process after shutdown as a failure.

### 4. Frontend and tooling

From `frontend`, set `CI=true`, use a task-local cache, and run serially:

```powershell
npm.cmd test -- --watch=false --runInBand --watchman=false --testMatch=**/*.test.js
npm.cmd run perf:test
```

Expected results are 102/102 suites and 955/955 frontend tests, then 201/201
performance/tooling tests. React act warnings are failures for this candidate.
The known Node `punycode` deprecation should remain the only frontend warning
until dependency maintenance removes it.

### 5. Backend

From the repository root:

```powershell
python -m unittest discover -s backend -p "test_*.py"
```

Expected result is 21/21 tests.

### 6. Default-off build and normal startup

With `REACT_APP_TASK07_MEDIA_PIPELINE` and `REACT_APP_FND_PERF` unset:

```powershell
npm.cmd run build
npm.cmd run verify:start
```

Run these separately. The build must compile. `verify:start` must invoke the
normal `npm start` contract, bind only its owned port 3001, obtain HTTP 200 from
`/home`, stop only its own process tree, and release port 3001. It must never
reuse or stop port 3000.

The existing stale Browserslist database notice is disclosed candidate debt; a
compile warning/error or a changed start script is a failure.

### 7. Focused browser evidence

Only after all previous groups are green, use the exact demo harness:

```powershell
npx.cmd playwright test performance/tests/browser/task07-media-shell.performance.js --project=chromium
```

The project dependency chain owns asset warmup and emulator auth setup. It must
use one worker, exact `demo-fnd-perf`, locally owned ports, and read-only `/home`.
Do not navigate an existing signed-in browser tab. Expected focused result is
3/3 cases.

This is partial evidence. It does not substitute for the missing route matrix,
Firefox/WebKit run, 50-map/token soak, ten-minute lifecycle run, `perf:ci`, or
authoritative repeatability.

## Candidate media lifecycle diagnostics

For an emulator-only canary, record the operation ID and asset ID, then verify
this sequence without skipping a state:

```text
prepared -> finalizing -> ready/fallback -> entity commit -> referenced
```

For replacement:

```text
new referenced -> previous superseded -> cleanup pending -> cleaned
```

Inspect these facts before retrying anything:

- manifest request hash and reconstructed plan match;
- actor, owner, kind, entity, reference scope, and previous asset are exact;
- original and planned derivative generations exist and metadata is exact;
- the entity contains the exact finalized descriptor;
- no active entity still references an asset proposed for retirement; and
- cleanup queue state, attempts, lease timestamps, reason, and generation family
  agree with the manifest.

Do not manually delete bucket objects to resolve an ambiguous commit. Reconcile
the entity reference first, then use the authorized confirm, abandon, retire,
or retry path appropriate to the manifest state.

## Demo-only backfill rehearsal

The only authorized migration command in this candidate is:

```powershell
npm.cmd run task07:media-backfill:plan -- --project demo-fnd-perf --json
```

Planning and verification are read-only by default. Exact-demo execution is
available only with loopback Firestore and Functions emulators, the reviewed
report, and its exact `--approve-fingerprint`; writes are serial and checkpointed,
and `--resume` is accepted only with `--execute`. The command rejects `--write`,
live reads, and non-demo projects. Review counts by kind, missing owners,
canonical skips, and unsupported fallbacks before any rehearsal.

A production write backfill requires a separate implementation and approval
covering backup/restore, immutable receipts, resumability, per-entity auth,
rate limits, canaries, rollback, and active-battle exclusion.

## Production prerequisite review

After the battle and only after every hard stop is closed:

1. freeze a clean reviewed candidate commit and rerun every authoritative gate;
2. archive current Hosting, Functions, Firestore rules/indexes, Storage rules,
   App Check/config, bucket CORS, and object inventory;
3. verify exact production bucket and all approved Hosting/custom origins;
4. review CORS without wildcard origins and confirm that authenticated `getBlob`
   succeeds only for permitted Storage audiences;
5. create the staged control document with default `legacy` and allowlists;
6. exercise non-battle canaries for prepare through cleanup and restoration;
7. rehearse immediate flag/config rollback while retaining all originals; and
8. obtain separate approval for each deployment plane.

Only then follow `activation-runbook.md`. Its deployment order is descriptive,
not current authorization.

## Monitoring requirements for a future rollout

At minimum, dashboard and alert:

- prepare/finalize/confirm/cleanup successes and failures by kind and stage;
- manifest age by non-terminal state;
- orphan and cleanup queue age, attempts, lease expiry, and failed count;
- reference/manifest mismatch and ambiguous commit count;
- private-media fetch failures by redacted code;
- active fetches, registry record count, encoded bytes, estimated decoded bytes,
  pinned bytes, delayed releases, and active object URLs;
- image/video request count, transfer bytes, request concurrency, and fallbacks;
- aurora active timers/frames while hidden or under reduced motion;
- music listener count, audio nodes, and byte delta while stopped/muted; and
- denied Storage/rules activity by audience without exposing private paths.

Production widening stops on any unexplained denial spike, trigger loop, cleanup
backlog, decoded-memory trend, object-URL leak, audio transfer while muted, or
legacy fallback regression.

## Rollback

1. Set the staged control mode to `legacy` or rebuild Hosting with the Task 07
   write flag unset.
2. Preserve canonical manifests, objects, generations, and legacy fields.
3. Keep lifecycle Functions/rules operating until prepared and cleanup-pending
   assets reach a reconciled terminal state.
4. Do not restore an old CORS policy while enabled clients still require
   authenticated blob reads.
5. Verify rollback on a non-battle canary and read-only `/home`; never use the
   live board as a presence check.
6. Record every affected asset ID and final state before pausing processor or
   cleanup work.

## Host-freeze response

If the PC freezes or becomes unresponsive again:

1. do not rerun the last command automatically after restart;
2. capture the exact last command, start time, last log lines, and whether a
   timeout wrapper owned it;
3. inspect Kernel-Power, bugcheck, WHEA, disk, display, application-hang, and
   resource-exhaustion events around the incident;
4. verify RAM, page file, free disk, temperatures if available, and surviving
   Node/Java/browser processes;
5. verify the existing port-3000 PID before stopping any Task 07-owned process;
6. reduce the next diagnostic to one serial focused case with a shorter timeout;
   and
7. stop Task 07 work and investigate the host if a second bounded reproduction
   produces the same freeze signature.

A whole-PC freeze is never an acceptable test outcome and must not be dismissed
as an ordinary test timeout.
