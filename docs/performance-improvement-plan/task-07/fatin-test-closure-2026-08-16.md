# fatin-test Task 07 closure record

Date: 2026-08-16

Status: implementation, independent review, focused browser reproduction, full
frontend tests, and hardened build gates are complete. The containing `main`
revision still requires a fresh exact-revision automatic workflow, v4
authoritative pair, scoped Hosting redeploy, and exact live-bundle verification;
any failure reopens this closure.

This closure is limited to the isolated `fatin-test` project. It does not
authorize or describe a `fatins` deployment, data copy, media-control change,
Firestore/Storage rules release, Functions release, index release, legacy
deletion, or new performance-baseline acceptance.

## Why a closure increment was required

The 2026-07-29 implementation evidence is a historical snapshot, and the
2026-08-14 canonical-only record proves that specific test rollout. Neither
record proves that the current repository revision is ready for Task 08.

The closure audit reproduced and fixed four material gaps:

- Home opened one persistent catalog-document listener per inventory ID. The
  500-item fixture therefore created 500 listeners and did not reach the route
  readiness contract in WebKit.
- the placed-character canonical-media client silently kept only the first 60
  token IDs even though the Grigliata fixture contains 200 placements;
- `GrigliataPage` remounted the entire board on every active-map change, which
  destroyed the outgoing image before the board's existing crossfade could
  render; and
- the browser harness classified two measured Task 05 HTTPS callables as
  background triggers and used timing-only asset/cleanup assertions that hid
  the actionable pending resource.

## Closure implementation

### Home catalog reads

- Replace per-document catalog listeners with stable, actor-scoped,
  ref-counted `documentId() in` query subscriptions of at most 10 IDs.
- Limit physical listener startup to four until each initial chunk settles.
  The 500-item fixture now uses at most 50 physical catalog listeners and the
  two Home consumers share identical chunks.
- Preserve realtime updates, missing-document settlement, current-scope error
  state, exact snapshot-ID authority, unrequested-document filtering, and
  actor/access-generation fencing.
- Update the checked-in query registry to describe the active bounded query.

This is a Task 07 closure correction, not Task 08 completion. Task 08 still
owns Home selector slices, resource-write batching, inventory normalization,
render-count reductions, and the final Home data path.

### Grigliata canonical media and map lifecycle

- Resolve every placed token through deterministic callable chunks of at most
  60 IDs with concurrency two, sanitize each response against its requested
  chunk, and publish only the atomically merged result.
- Fence stale canonical-media responses and retries across unmount, actor,
  access-generation, active-map, and placement-set changes.
- Keep `GrigliataBoard` mounted across active-map changes so its existing
  active/outgoing full-quality image leases and crossfade remain effective.
- Reset map-scoped interaction transients on the board's existing scene key and
  remount only the nested turn-order panel so an unsaved initiative editor
  cannot carry into another map.

### Browser and emulator evidence quality

- Restore Firebase's default buffering-proxy auto-detection for normal
  performance builds. Only the owned Playwright WebKit emulator probe may set
  the SDK-supported force-long-polling flag for WebKit only; Chromium and
  Firefox retain the SDK default auto-detection because forcing long polling
  there can strand later targets under multi-context load. Production behavior
  is unchanged.
- Begin the five-peer asset quiet window after route readiness, require both
  network quiet and an empty registry request queue, and retain sanitized
  pending-request diagnostics.
- Treat the known Task 05 HTTPS callables as non-background work while keeping
  unknown and actual background functions fail-closed. Aggregate teardown
  failures now expose their bounded child messages.
- Diagnose animation-frame callback ownership. The remaining one-shot frame was
  Konva 9.3.20's global `batchDraw` queue dispatcher after React-Konva had
  destroyed the Stage. Route cleanup now waits for two rendering opportunities,
  proves zero Konva stages and containers, and then retains the strict zero
  old-route resource assertion. It does not cancel or allowlist Konva's private
  global queue.
- Make the 50-map soak observe the transient crossfade concurrently with the
  Active badge, verify the exact folder membership, require a stable active
  battlemap layer, and emit phase-specific registry/layer/cleanup diagnostics.

The first clean-candidate authoritative attempt correctly stopped after 68 of
70 browser scenarios passed. Its retained traces showed that blanket forced
long polling had stranded one of five Chromium placement listeners and the
initial Echi route targets even though the emulator acknowledged both Watch
requests. No authoritative snapshot from that attempt was accepted. After the
fallback was scoped to WebKit, the two exact Chromium scenarios each passed
three consecutive executions, and the Firefox/WebKit Task 07 smoke remained
green.

The first exact-revision GitHub push and dispatch then correctly reopened the
closure on two Linux-only integration gaps. The login route statically imported
the complete user-data command module, so Linux chunk extraction placed
`firebase/functions` in the login closure. Login now imports that command module
only when profile initialization is actually required, and the real performance
build reports zero forbidden login modules. Separately, all 70 authoritative
browser checks passed before the detached Firebase emulator group survived
Playwright's default POSIX web-server `SIGKILL`; the soak then could not acquire
the owned ports. The Playwright web server now grants the existing emulator
wrapper a bounded `SIGTERM` window so it can terminate its captured child group,
escalate if needed, and prove stable port release. The original failed runs are
diagnostic evidence only and are not accepted closure evidence.

The next exact-revision dispatch proved both corrections: every standard Linux
job passed, the full default media soak passed on the same runner, and the
emulator ports were stably free immediately after the authoritative command.
The authoritative command nevertheless remained failed because the DM peer
reported one active Firestore Write-channel `ERR_ABORTED` after all placement
delivery checks had converged. The old diagnostic retained only the path and
let the following soak overwrite the failed trace, so it could not prove
whether Chromium had already observed HTTP 200 or whether the abort lacked a
response.

The closure keeps that classification fail-closed. It now resolves Playwright's
request response as a fallback when the response-event map misses it, awaits
all diagnostic tasks before assertions, and retains only bounded categorical
protocol evidence: response status, owned origin/database booleans, operation,
sorted query-key names, fixed protocol categories, and opaque-value
presence/length/format. Complete URLs, database values, headers, bodies, and
raw `SID`, `AID`, and `zx` values are never serialized. A fallback HTTP 200
uses the already-reviewed turnover branch; missing, error, and unknown shapes
still fail. On an authoritative failure, GitHub uploads this immutable evidence
before the soak starts, so the soak can continue without replacing the failure
artifact. The classifier itself was not broadened.

The exact evidence-patch push then exposed a separate product regression in
the standard Linux route smoke. Run
[`31941432007`](https://github.com/marco-lor/fatins-test/actions/runs/31941432007)
passed every non-browser job and cross-browser readiness, but the first
five-peer player still had four active and thirteen queued token images at the
unchanged 15-second finite-asset deadline. The retained trace showed 75 image
requests whose individual emulator responses took only about 5-62 ms, while
registry polls were blocked for 4-5 seconds. The full-map fit rendered all 200
tokens at roughly seven CSS pixels, yet the selector filled 72 media leases
because every token was technically on screen and every DM token was movable.

The board now loads token art only when the token is active, selected,
viewer-owned, or both on screen and at least 16 CSS pixels. Offscreen and tiny
overview tokens keep their existing initials/fallback rendering, and manager
movement authority no longer makes all token art eager. The 200-token fixture,
registry concurrency, and 15-second gate remain unchanged. The compact browser
contract now proves all 200 Konva token nodes remain rendered while the active
board stays pinned, finite registry work drains to zero, no preload is dropped,
and compact record/byte budgets hold; it no longer requires spare registry
capacity to be filled to an incidental exact count.

The next exact-revision automatic workflow, run
[`31943141392`](https://github.com/marco-lor/fatins-test/actions/runs/31943141392),
passed all six required jobs on `d8c8133a1d3ae05dc908bdc27a2dd351eb3229e1`.
The manually dispatched full benchmark, run
[`31943659189`](https://github.com/marco-lor/fatins-test/actions/runs/31943659189),
then ran both 70-scenario browser measurements successfully but correctly failed
their repeatability comparison. One run retained one unpinned 96-by-96 token
image while the other retained 71: the initial measured-stage render still used
viewport scale 1 before the fit effect, leased the 72-record token budget, and
left those otherwise released images in the deliberately retained registry.
The same hosted pair also exposed one sub-threshold Long Tasks observation and
sub-millisecond timer variance. This failed pair is diagnostic evidence only;
it was not retried into acceptance and cannot be used as a baseline.

Ordinary visible token media is now ineligible until the current scene's
`fitKey` has been fitted. Active, selected, and viewer-owned media keeps its
priority. A map-switch component test proves that a previous scene's viewport
cannot lease the new scene's ordinary token art, and two separate fresh
desktop/compact emulator runs prove the registry settles with zero active or
queued work and the strict retained-record/byte bounds.

Measurement contract v4 keeps the raw timing values and raw maximum variance,
while applying explicit GitHub-hosted-only absolute bands for the Long Tasks
API's 50 ms observation boundary and sub-millisecond microbenchmarks. Larger
drift still fails, and controlled, missing, or mismatched machine identities
retain the strict 15 percent contract. Baseline acceptance separately rejects
GitHub-hosted, unknown, blank, or missing reference-machine identities before
any baseline write.

## Independent review

An independent read-only agent audited the implementation from base
`b652b69544526b3ebdc078e52836dffda6411064`. Its findings drove the catalog
batching contract, all-placement canonical resolution, map-lifecycle fix,
Task 05 callable classification, WebKit transport isolation, and Konva cleanup
diagnostics.

Final stabilized-diff verdict: **APPROVE**. No P0-P2 correctness, security, or
release-blocking finding remains. The reviewer recorded one P3 resilience
observation: after one canonical-media chunk fails, another bounded worker may
finish its already-selected chunks before the finite retry begins. Results are
still atomic, stale publication is fenced, and both per-attempt concurrency and
retry count are bounded. A later hardening increment may define an explicit
cross-attempt overlap policy; this is not a Task 07 release blocker.

The same reviewer separately approved the final login split and POSIX emulator
shutdown correction. The decisive integration proof remains a fresh Linux
normal workflow plus manually dispatched full benchmark for the containing
revision.

The reviewer also approved the final Write-channel evidence patch with no
release-blocking correctness, security, race, classifier, or CI finding. Its
precision suggestions were applied before commit: failure timing is sampled
before asynchronous response resolution, retained error strings and diagnostic
errors are bounded, and the failure-only upload is tied specifically to the
authoritative step outcome.

After the exact-SHA Linux smoke exposed overview token-media starvation, the
reviewer independently approved the product correction with no P0-P2 blocker.
The review confirmed the 15.9/16.0 CSS-pixel boundary, large-offscreen,
viewer-owned-offscreen, manager-movable-non-owned, and stable over-limit order
coverage; verified that ownership derivation preserves the prior movement
authorization rule without changing persistence or reads; and approved the
compact 200-node, active-pin, drained-queue, zero-drop, and budget contract.

The reviewer then independently audited the final viewport-fit fence,
map-switch regression test, v4 timing arithmetic, raw-variance reporting,
machine-identity scoping, and baseline-acceptance guard. Final verdict:
**APPROVE** with no release-blocking correctness, security, or evidence-gaming
finding. The only P3 suggestion is an additional end-to-end CLI test for the
already directly wired and unit-tested baseline write guard.

## Candidate validation completed

All emulator and browser commands used only the owned `demo-fnd-perf` fixture.
No live application data was mutated by these gates.

| Gate | Result |
| --- | --- |
| Task 07 Node and focused Jest gate | PASS |
| Full frontend Jest | PASS: 139 suites, 1,303 tests |
| Performance/harness Node tests | PASS: 370/370 |
| Functions lint | PASS: 0 errors; 5 pre-existing non-blocking warnings |
| Functions TypeScript build and tests | PASS: 211/211 |
| Backend unit tests | PASS: 22/22 |
| Full rules/callables emulator gate | PASS |
| Task 07 media integration | PASS: callables 3/3, rules 27/27, query emulator 3/3, browser 10/10 |
| Firefox/WebKit Task 07 smoke | PASS: 4/4 |
| Chromium transport-regression reproduction | PASS: five-peer and Echi 3/3 each |
| Patched five-peer response-evidence gate | PASS: 3/3 Playwright stages with clean owned-emulator teardown; all 12 additional scenario repetitions passed |
| Overview token-media and initial-fit regressions | PASS: GrigliataBoard 148/148; two separate fresh desktop/compact 200-token browser probes 4/4 each |
| Bounded 50-map/200-token diagnostic soak | PASS: 3 complete cycles |
| Chromium route/performance matrix | PASS: 28/28 scenarios and every blocking budget |
| Historical clean-commit v3 authoritative pair | PASS: `2026-08-16T04-18-59-324Z-a` and `-b`, both on `8f7cfc5c95ccbd24129f999242776fe9afed2ca2`, three retained iterations each; superseded as final evidence by contract v4 |
| Historical v3 authoritative repeatability | PASS: zero compatibility, deterministic, or timing failures; maximum gated variance 10.00%; a fresh v4 pair remains required for the containing revision |
| Default 600-second media soak | PASS: all 3 Playwright stages in 16.5 minutes, including the 600,000 ms minimum lifecycle |
| Production bundle and unchanged start path | PASS: hardened build verification and `/home` HTTP 200 through `npm start` |

The comparison continues to report five non-blocking roadmap targets. They are
not hidden or re-baselined by this closure:

- initial collection-view size is owned by Task 04 and the route-specific
  selector/data work in later tasks, including Task 08 for Home;
- LCP, INP, and CLS final targets are owned by Task 22; and
- the Grigliata long-task target is owned by Task 17.

## Scoped release and live verification

Only Hosting was deployed. Functions, Firestore rules/indexes, Storage rules,
rollout controls, and application data were not changed. The release command
targeted the hard-coded `fatin-test` site, and the predeploy guard reran all
prerequisites before uploading 82 Hosting files.

The Windows Firebase CLI session was reused through Node's system certificate
store with `NODE_OPTIONS=--use-system-ca`. The ignored canonical
`fatins-test/frontend/.env.local` values required by the App Check verifier
were inherited only by the release process; no credential or environment file
was copied into this worktree or committed.

Predeploy and live evidence:

- App Check reported `ready: true`, including API, domain, service-agent,
  reCAPTCHA Enterprise, score-integration, site-key, and web-app bindings;
- the user-directory verifier scanned 11 documents, found all 11 unchanged,
  and performed zero writes;
- Firebase reported the `fatin-test` Hosting release complete at
  `https://fatin-test.web.app`;
- live `/home` returned HTTP 200 and referenced the exact local script
  manifest;
- live `main.355adcc4.js` matched the corrected local production bundle exactly
  (665,057 UTF-8 bytes; SHA-256
  `cc852397ab5cc197f972c66486a96d77518edb8f85e2e0749314707af0965d43`);
  and
- `X-Frame-Options` remained `DENY`, while the report-only CSP contained no
  loopback source.

The viewport-fit correction and v4 evidence contract produce the next scoped
release candidate as `main.7921f66a.js` (665,057 bytes; SHA-256
`941255d03969ac5adda563dc7d1652d7a8b073309e7f69e0287ada8f1f68a3fe`). Its
exact-SHA workflows and live served-bundle match remain explicit final release
gates; the earlier `main.355adcc4.js` evidence above is retained as the last
completed scoped deployment rather than being rewritten as future evidence.

## Final release gates

The containing revision must retain all of these gates:

1. the clean-commit authoritative pair and blocking budgets recorded above;
2. the default 600-second media soak with the full 50-map/200-placement fixture;
3. the production bundle, unchanged start path, scoped Hosting release, and
   exact served-bundle verification recorded above; and
4. a fast-forward push to `main` followed by the normal workflow and a manually
   dispatched full benchmark for that exact pushed revision, both green.

After those gates pass, Task 07 is closed for `fatin-test` roadmap progression
and Task 08 is the next sequential task.
