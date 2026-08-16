# fatin-test Task 07 closure record

Date: 2026-08-16

Status: release candidate. This record becomes final only after the containing
candidate passes the clean-commit authoritative and soak gates, the scoped
`fatin-test` Hosting release is verified, and the exact pushed revision is
green in CI.

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

## Candidate validation completed

All emulator and browser commands used only the owned `demo-fnd-perf` fixture.
No live application data was mutated by these gates.

| Gate | Result |
| --- | --- |
| Task 07 Node and focused Jest gate | PASS |
| Full frontend Jest | PASS: 138 suites, 1,297 tests |
| Performance/harness Node tests | PASS: 360/360 |
| Functions lint | PASS: 0 errors; 5 pre-existing non-blocking warnings |
| Functions TypeScript build and tests | PASS: 211/211 |
| Backend unit tests | PASS: 22/22 |
| Full rules/callables emulator gate | PASS |
| Task 07 media integration | PASS: callables 3/3, rules 27/27, query emulator 3/3, browser 10/10 |
| Firefox/WebKit Task 07 smoke | PASS: 4/4 |
| Chromium transport-regression reproduction | PASS: five-peer and Echi 3/3 each |
| Bounded 50-map/200-token diagnostic soak | PASS: 3 complete cycles |
| Chromium route/performance matrix | PASS: 28/28 scenarios and every blocking budget |

The comparison continues to report five non-blocking roadmap targets. They are
not hidden or re-baselined by this closure:

- initial collection-view size is owned by Task 04 and the route-specific
  selector/data work in later tasks, including Task 08 for Home;
- LCP, INP, and CLS final targets are owned by Task 22; and
- the Grigliata long-task target is owned by Task 17.

## Final release gates

Before changing this record to `complete`:

1. commit the release candidate so the authoritative harness can prove a clean
   worktree;
2. pass `npm run perf:authoritative`, including two three-iteration Chromium
   snapshots, repeatability comparison, and all blocking budgets;
3. pass the default 600-second `npm run perf:media:soak` with all 50 maps, 200
   placements, three or more cycles, zero stale route resources, and zero Konva
   stages/containers after cleanup;
4. rebuild and verify the production bundle and unchanged `npm start` path;
5. deploy Hosting only to the exact `fatin-test` target and verify the served
   release; and
6. fast-forward and push `main`, dispatch the full benchmark for the exact
   pushed revision, and require its checks to finish green.

After those gates pass, Task 07 is closed for `fatin-test` roadmap progression
and Task 08 is the next sequential task.
