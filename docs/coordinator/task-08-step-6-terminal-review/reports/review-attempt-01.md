RED

# Task 08 Step 6 Attempt 16 independent terminal-fallback review

## Review identity and lease verification

- Review time: 2026-09-01T21:30:27.8675484Z.
- Control ID: `task08-step6-review-a38f4568`.
- Step / workstream / attempt: `1` / `terminal-fallback-acceptance` / `1`.
- Dispatch token: `a31b407a-e17d-426d-b514-df46b8ee7494`.
- Dispatch control revision: `1`; current `control.md` revision read: `2`. Revision 2 records this already-running dispatch and is expected coordinator bookkeeping inside the excluded directory.
- Requested / canonical task: `step6_review_01_a31b407a` / `/root/step6_review_01_a31b407a`.
- Effective pair: `gpt-5.6-sol` / `max`.
- Checkout / branch / HEAD: `C:\Users\Marco\OneDrive\git_projects\fnd-devs` / `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Runtime: Windows NT 10.0.19045.0, Node `v22.22.2`, npm `11.2.0`.
- Protected manifest: `docs/coordinator/task-08-step-6-terminal-review/protected-dirty-state.md`.

The exact dispatch serialization was rerun before source review, filtering only `docs/coordinator/task-08-step-6-terminal-review/`. Every component matched:

| Component | Current | Expected |
| --- | --- | --- |
| Branch | `devs` | `devs` |
| HEAD | `9c7fcc7c5799a458768512b7cbab49e4d9b301a9` | same |
| Porcelain-v2 status SHA-256 | `ed57ee27449fdf20e360cea59f22fc6c91d7e4f750835d951aee1ab0623760ed` | same |
| Staged diff SHA-256 | `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b` | same, empty serialization |
| Unstaged binary diff SHA-256 | `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` | same |
| Sorted untracked path/hash tree SHA-256 | `91996d06c5426293866b77628f49a411f4ed3041ea1a573d8d27e04ae14cad2a` | same, 70 protected paths |
| Composite code-workspace fingerprint | `9c556fa01c4db1de8c7f55adda9c73f8a48cbea59f1584f7bf8bd46307faa028` | same |

No protected mismatch was present, so substantive review proceeded.

## Outcome

Attempt 16 does close the reported natural-code-0 liveness race: the deadline is referenced at `frontend/scripts/performance/firebase-emulator-supervisor.js:100-103`, the helper is referenced at `:105-120`, and a real no-other-application-reference child remained alive until its delayed helper settled. Windows still invokes exactly `taskkill.exe /PID <trusted process.pid> /T /F` (`:54-61`), while POSIX signals only `-process.pid` with `SIGKILL` (`:138-166`). The normal registered-handler disconnect and accepted explicit shutdown paths remain idempotent in the passing focused coverage.

Acceptance is nevertheless blocked by two Important ownership/process-lifecycle defects. The focused and broad suites pass because neither missing transition is asserted.

## Findings

### Critical

None.

### Important 1 — A rejected connected shutdown drops child fallback ownership before the parent safely assumes it

Evidence:

- `requestFirebaseCliShutdown()` sets `shutdownRequested = true` and unconditionally removes the supervisor's `disconnect` listener before calling the Firebase SIGINT handlers (`frontend/scripts/performance/firebase-emulator-supervisor.js:228-243`).
- If a handler throws, the function returns `accepted: false` without restoring that listener (`:244-248`).
- `handleParentMessage()` only sends the negative acknowledgement; it does not retain or re-establish child ownership if the IPC handoff subsequently disappears (`:252-269`).
- The direct-disconnect throwing-handler test covers fallback when disconnect is the first event (`frontend/scripts/performance/firebase-emulator-supervisor.test.js:398-423`). The connected-rejection test stops while the parent is still connected and asserts only that fallback has not yet run (`:850-880`). No test performs the real transition `connected rejection -> parent IPC disconnect`.

Fresh reproduction against production code:

```text
node -e "const {EventEmitter}=require('node:events');const {runFirebaseEmulatorSupervisor,FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE}=require('./scripts/performance/firebase-emulator-supervisor');const p=new EventEmitter();p.pid=4321;p.connected=true;p.sent=[];p.send=m=>{p.sent.push(m);return true;};let sigints=0;const fallbacks=[];runFirebaseEmulatorSupervisor({argv:['node','supervisor','firebase-cli','emulators:start'],processImpl:p,requireImpl:()=>p.on('SIGINT',()=>{sigints+=1;throw new Error('controlled handler failure');}),terminateOwnedTreeImpl:({reason})=>fallbacks.push(reason)});p.emit('message',{type:FIREBASE_EMULATOR_SHUTDOWN_REQUEST_TYPE,requestId:'owned-request'});const afterRejection={connected:p.connected,disconnectListeners:p.listenerCount('disconnect'),messageListeners:p.listenerCount('message'),sigints,fallbacks:[...fallbacks],ack:p.sent[0]};p.connected=false;p.emit('disconnect');const afterParentLoss={disconnectListeners:p.listenerCount('disconnect'),messageListeners:p.listenerCount('message'),sigints,fallbacks:[...fallbacks],exitCode:p.exitCode??null};console.log('REJECT_THEN_DISCONNECT '+JSON.stringify({afterRejection,afterParentLoss}));if(fallbacks.length!==1)process.exitCode=17;"
```

Observed nonzero exit and evidence:

```json
{
  "afterRejection": {
    "connected": true,
    "disconnectListeners": 0,
    "messageListeners": 1,
    "sigints": 1,
    "fallbacks": [],
    "ack": {
      "type": "fnd-performance-emulator-shutdown-ack",
      "requestId": "owned-request",
      "accepted": false,
      "reason": "controlled handler failure"
    }
  },
  "afterParentLoss": {
    "disconnectListeners": 0,
    "messageListeners": 1,
    "sigints": 1,
    "fallbacks": [],
    "exitCode": null
  }
}
```

Impact: the supervisor is deliberately detached. If the wrapper dies after delivering the request but before receiving/acting on the rejection, the Firebase handler has already failed, the child no longer observes the IPC disconnect, and neither side runs exact-tree enforcement. The emulator descendants and ports can therefore be orphaned. This is the same ownership class Step 6 is intended to close, not a cosmetic test gap.

Required behavior: keep child-side disconnect ownership through a rejected graceful handoff. While the parent remains connected, preserve the negative acknowledgement and do not launch child fallback. If the channel then disconnects—or closes while the rejection acknowledgement is being delivered—enter the exact-tree fallback once, retain the original failure diagnosis, never re-emit SIGINT, remove the lifecycle listeners, and make duplicate/late events harmless. An accepted usable-handler path must retain its current no-fallback/idempotent behavior.

Required regression expectation for the implementer: a production-code test must issue a connected request whose SIGINT handler throws, verify one negative acknowledgement and zero fallback while connected, then disconnect IPC and verify exactly one fallback with the trusted supervisor PID, one SIGINT total, listener cleanup, and no effect from duplicate disconnects or late messages. Add the closing-channel/send-error variant so failed acknowledgement delivery cannot strand the detached tree. An owned-process integration should cover the parent disappearing during this rejected handoff, with the recorded supervisor/descendant PIDs gone and its owned port stably free.

### Important 2 — Timeout transfers to the diagnosed retainer without releasing or bounding the referenced detached taskkill helper

Evidence:

- The helper is detached (`frontend/scripts/performance/firebase-emulator-supervisor.js:57-61`) and explicitly referenced (`:117-120`).
- Common failure settlement clears the deadline and removes helper listeners, then installs the exact-root retainer, but it neither unrefs nor terminates/aborts the helper (`:75-90`).
- On deadline, that common settlement runs at `:100-103`; a taskkill process that is itself stuck therefore remains a second referenced handle and an additional detached owned process indefinitely.
- The explicit diagnosed owner is already the interval created at `:20-31`. The contract allows that one fail-closed owner, not an accidental still-referenced helper beside it.
- The timeout test defines `helper.unref` but never counts or asserts it and injects a non-retaining callback (`frontend/scripts/performance/firebase-emulator-supervisor.test.js:632-667`). The real liveness probe covers a helper that exits after 750 ms, not a helper still alive when the deadline transfers authority.

Fresh bounded real-process reproduction used a 1,200 ms owned Node helper, a 50 ms deadline, production fallback code, and a non-retaining injected transfer callback. No other application handle was present:

```text
TIMEOUT_DIAGNOSTIC {"elapsedMs":60,"diagnostic":"[firebase-emulator-supervisor] taskkill did not terminate rootPid=27160 within 50 ms; retaining exact supervisor root ownership; rootPid=27160; reason=firebase-cli-shutdown-unavailable"}
RETENTION_TRANSFER {"elapsedMs":60,"helperPid":4644}
TIMEOUT_CALLER_EXIT {"code":1,"elapsedMs":1291,"helperPid":4644,"helperExitCode":0}
```

The caller remained alive for the helper's full lifetime, about 1.23 seconds after authority had supposedly transferred. A genuinely hung `taskkill.exe` would remain indefinitely. The owned helper exited naturally, and final process inventory confirmed PID 4644 gone.

Impact: the advertised bounded enforcement deadline does not bound the helper process or its event-loop reference. Failure can leak an extra detached taskkill process/handle and leave cleanup dependent on more than the single diagnosed exact-root owner. This violates the explicit helper/deadline-release and process-leak acceptance boundary.

Required behavior: retain the helper and deadline until one settlement wins, then release both on every exit/error/deadline path. On deadline, bound and clean up the exact helper itself (for example, an exact helper abort/kill plus `unref`, with diagnostic handling if helper cleanup fails) before or as authority transfers to the one root retainer. Do not weaken the pre-settlement liveness fix, rediscover any PID, or target anything except the already-owned helper and supervisor root.

Required regression expectation for the implementer: extend the timeout unit test to assert one helper `ref`, one post-settlement `unref`, one cleared deadline, one retention transfer, zero residual helper listeners, and exactly-once behavior under late events. Add a real child-process deadline probe with a helper whose natural lifetime is much longer than the deadline; prove the caller reaches diagnosed nonzero/retention settlement promptly, the exact helper PID is gone, and only the explicit retainer remains authoritative. Repeat for async helper error where a helper handle exists.

### Minor — Two pre-review failed-probe temp directories remain outside the checkout

The elevated final inventory found two directories predating this review:

- `C:\Users\Marco\AppData\Local\Temp\fnd-supervisor-throwing-handler-NFbqEl` (2026-09-01T20:19:13Z; historical supervisor/descendant PIDs `4252/9608`, port `51359`).
- `C:\Users\Marco\AppData\Local\Temp\fnd-supervisor-throwing-handler-tphG2C` (2026-09-01T20:15:47Z; historical PIDs `3720/1840`, port `51279`).

Both recorded ports are free and no matching processes remain. They predate this lease, so they were inspected but not removed. The fixture's `finally` throws on a surviving descendant before reaching `fs.rmSync(root)` (`frontend/scripts/performance/firebase-emulator-supervisor.test.js:141-155`), explaining how a sandbox-denied cleanup leaves diagnostic temp residue. This is non-blocking relative to the two ownership defects but should be cleaned by its owning coordinator and made exception-safe in the test.

## Fresh verification

All commands ran from `frontend` unless noted. Process-owning test commands were run with the approved elevated boundary from the outset because Attempt 16 already demonstrated that restricted `taskkill` denial intentionally retains exact roots. No restricted process-owning run was repeated, avoiding known orphan/retainer cleanup work.

1. Pre-integration ownership gate:
   - Production `assertEmulatorPortsFree()` plus explicit loopback binds for `3000` and `3001`.
   - Exit `0`; ports `3000,3001,4000,4400,4500,5000,5001,5002,8080,9099,9150,9199` all free.
   - `.firebase.performance.generated.json` absent; `.perf-emulator-data/playwright-webserver.active` absent.
   - Restricted `Get-CimInstance Win32_Process` returned `Accesso negato`; this read-only inventory was rerun elevated at the final gate.

2. Syntax:

```text
node --check scripts/performance/firebase-emulator-supervisor.js
node --check scripts/performance/firebase-emulator-supervisor-liveness-probe-fixture.js
node --check scripts/performance/firebase-emulator-supervisor-probe-fixture.js
node --check scripts/performance/emulators.js
```

Exit `0`; `4/4` files passed; wrapper duration `1,039 ms`.

3. Focused supervisor suite, elevated for exact owned taskkill integration:

```text
node --test scripts/performance/firebase-emulator-supervisor.test.js
```

Exit `0`; `27/27` passed, `0` failed, `0` skipped; TAP duration `2,044.6879 ms`, wrapper duration `2,325 ms`.

- No-other-ref liveness: helper settlement `834 ms`, caller `949 ms`, controlled exit `23`.
- Owned no-handler tree: supervisor/descendant `5168/26516`, port `61732`, gone/free in `476 ms`.
- Owned throwing-handler tree: supervisor/descendant `26536/16732`, port `61733`, gone/free in `426 ms`.

4. Required six-file relevant matrix, elevated for exact owned taskkill integration:

```text
node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js
```

Exit `0`; `107/107` passed, `0` failed, `0` skipped; TAP duration `2,135.3325 ms`, wrapper duration `2,428 ms`.

- No-other-ref liveness: helper settlement `838 ms`, caller `969 ms`, controlled exit `23`.
- Owned no-handler tree: supervisor/descendant `24868/5184`, port `61744`, gone/free in `539 ms`.
- Owned throwing-handler tree: supervisor/descendant `23304/17600`, port `61745`, gone/free in `421 ms`.

5. Broad performance suite, elevated for normal Firebase Tools config access and exact owned taskkill integration:

```text
npm.cmd run perf:test
```

Exit `0`; `479/479` passed, `0` failed, `0` skipped; TAP duration `14,877.7718 ms`, wrapper duration `16,249 ms`. The existing Node `punycode` deprecation warning was emitted by test workers; no dependency change was made.

6. Retained normal staging output:

```text
$env:FND_GIT_BRANCH='devs'; npm.cmd run verify:staging-build
npm.cmd run perf:verify-disabled
```

Both exited `0`; durations `1,558 ms` and `1,550 ms`. The retained main asset remains `static/js/main.252018f4.js`; disabled verification found no performance bridge, profiler, benchmark, or persistence-experiment artifacts.

7. Whitespace:

```text
git -c safe.directory='C:/Users/Marco/OneDrive/git_projects/fnd-devs' diff --check
```

Exit `0`; duration `250 ms`; no whitespace errors. Existing LF-to-CRLF working-copy warnings were emitted for the 47 protected tracked paths.

8. Final ownership and artifact checks:
   - Elevated read-only process inventory: all explicitly recorded review PIDs gone; zero process command lines matching the supervisor, either probe fixture, or `scripts/performance/emulators.js`; zero live `taskkill.exe` processes.
   - Final generated config and Playwright marker absent.
   - All twelve listed Task 08 ports free and stable; historical failed-probe ports `51279` and `51359` also free.
   - Retained fixture report SHA-256 `48bfa23355699d5865c05779dc72dedfd753c05cf54865e5a1c187933639e600`, unchanged `verifiedAt` `2026-09-01T20:24:05.746Z`, project `demo-fnd-perf`, `9,139` documents, `136` Storage objects, approved fixture hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

## Product/manual evidence boundary

No Browser run was performed and the user's staging tab was not inspected or touched.

The Attempt 12 Browser gate remains applicable to product behavior:

- Attempt 12 recorded tracked/source identities `c6565b3b24ca56878a17e17a7ec6860d1faa6d33da5f94cde2e6b33bf60d4ce8` / `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902` and green physical resource behavior, with cleanup as its only red boundary.
- Attempt 13 changed the tracked fingerprint to the current `e37fec10...` only for the emulator lifecycle harness; that tracked fingerprint is unchanged through Attempts 14-16.
- Attempts 14-16 add only supervisor/probe files under `frontend/scripts/performance`. Current product/resource/metric files (`StatsBars`, Task 08 instrumentation/contract/browser scenario, and the callable) all retain modification times before the Attempt 12 source-matched build, while the lifecycle harness files are later.
- Fresh staging identity and performance-disabled verification passed after this review's tests.

Thus the current blocking findings are harness ownership defects and do not invalidate the already-observed product gesture behavior. They do prevent Step 6 terminal-fallback acceptance.

## Final status

- Source/test verdict: blocked by the two Important findings above.
- Required fresh automated gates: syntax `4/4`, supervisor `27/27`, relevant matrix `107/107`, and `perf:test` `479/479` all passed; no skips.
- Cleanup: review-created processes/artifacts are gone, listed ports are free, generated config is absent, fixture report is unchanged, staging output verifies, and protected checkout state remains preserved.
- Current HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Current code fingerprint excluding this coordinator directory: `9c556fa01c4db1de8c7f55adda9c73f8a48cbea59f1584f7bf8bd46307faa028`.
- Requested action: dispatch the Sol High implementer with both Important findings and their regression expectations; re-review before any acceptance or Step 7 work.
