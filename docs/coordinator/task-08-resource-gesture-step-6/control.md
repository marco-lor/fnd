# Coordinator control — task08-resource-step6-4cc22c2739f8

- Coordinator task title: `Coordinator - Task 08`
- Coordinator thread ID: `01a047ff-5aee-7c22-8ec8-d74c7ade949d`
- Project ID/path: `local-3800f17496f5c93e49da280e2e23eb95` / `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Current step: 6
- Phase: developer-active
- Pause latch: clear
- Pending outbound action: none; Attempt 16 is active in the new Sol High developer task and must callback for independent review
- Developer baseline: `gpt-5.6-sol` / `high` / standard speed
- Current escalation tier: explicit user model override
- Non-progress counter: 0 for all currently open findings. Attempt 6 materially expanded ownership/contract/emulator coverage and completed full React plus `perf:test`; the remaining lifecycle, concurrent-envelope, render-isolation, and Chromium findings are narrowed gaps or a new harness reproduction rather than a non-progressing round. Attempt 4 ended without a report/callback and is not counted.

## Workspace baseline
- Decision: existing checkout.
- Branch/ref: `devs` (`devs...origin/devs [ahead 1]`).
- Baseline SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`.
- Accepted pre-Step-6 tracked-diff fingerprint: `336ce85a851c3599f81693b39b891a08a5522391b239aaaa025041830cd5358d`.
- Accepted pre-Step-6 source-tree fingerprint: `6e0b768fdb868721ebba8ee6c264d1d8398981ca4a2f48787d722dd690fb0d86`.
- Dirty-state policy: preserve the complete accepted, uncommitted Steps 2–5 state and every coordinator artifact. Step 6 changes must be additive. No reset, stash, clean, discard, commit, push, deploy, dependency upgrade, or worktree-topology change is authorized.

## Task registry
### Step 6 / attempt 1
- Developer task ID and title: `01a05751-fb94-7060-8946-a0c092ca0261` / `Task 08 Step 6 Resource Gesture Batching`
- Host/client task ID when applicable: `local` / `01a05751-fb94-7060-8946-a0c092ca0261`
- Callback token: `0414931b-521c-4f72-bf3b-d8394d41a6b0`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `336ce85a851c3599f81693b39b891a08a5522391b239aaaa025041830cd5358d`; source `6e0b768fdb868721ebba8ee6c264d1d8398981ca4a2f48787d722dd690fb0d86`.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-01.md`
- Status: authenticated `DONE_WITH_CONCERNS` payload recovered from the referenced developer task after direct callback delivery failed
- Review verdict: RED — Attempt 1 is not acceptable
- Automated evidence: independently reran focused React `3/3` suites and `37/37` tests plus Task 08 Node contract `11/11`; those green checks do not exercise the blocking races and contract gaps below. Developer-reported Functions build and diff check were green; broader gates remain unrun.
- Manual evidence: not reached because source/automated review is red; the coordinator-owned staging Browser tab remains untouched
- Findings still open:
  - Optimistic resource state has no source-acknowledgement state machine. A Firestore update arriving before the callable resolves double-applies the pending delta, while a callable resolving before Firestore acknowledgement removes the overlay and visibly snaps back.
  - In-flight pending gestures are not actor/generation scoped or cleared on freshness loss; switching actors after pointer release can render actor A's delta over actor B and late promise handlers can update state after unmount.
  - Pointer ownership is incomplete: non-primary/secondary pointers are accepted, pointer-capture failure can strand a timer, and touch/pen cancellation, lost capture, actor change, and unmount are not covered.
  - Every callable rejection discards optimistic state even for ambiguous outcomes, despite the existing definitive-error classifier; explicit operation IDs bypass the command-layer retry cache and there is no same-operation recovery path.
  - Barrier server clamping ignores legacy `stats.barriera` fallback and can reset legacy shield state to zero; the optimistic display can also escape bounds after concurrent authoritative changes.
  - Barrier delta/clamp semantics and concurrency lack callable-emulator coverage.
  - Task 08 evidence emits only a terminal label, has no hold correlation, is not summarized/gated by the contract, and its Browser scenarios do not prove one logical hold produces one command and one authoritative application under overlap.
  - Full Step 6 gates, fixture restoration/hash verification, and port cleanup have not yet been completed.

### Step 6 / attempt 2
- Developer task ID and title: `01a05751-fb94-7060-8946-a0c092ca0261` / `Task 08 Step 6 Resource Gesture Batching`
- Host/client task ID when applicable: `local` / `01a05751-fb94-7060-8946-a0c092ca0261`
- Callback token: `bf53662c-6ab0-480e-b7b8-53ee7af7eba4`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; preserve the complete accepted pre-Step-6 dirty state plus all Attempt-1 additions. Recompute and report final tracked/source fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-02.md`
- Status: callback received from the expected task with matching control ID/token/step/attempt/report/baseline, but malformed: it omitted the `COORDINATOR_CALLBACK` header and `status`, used `developer_task_id: /root` instead of the expected `developer_thread_id`, and therefore is not accepted as a fully authenticated completion envelope
- Review verdict: RED — Attempt 2 is materially improved but not acceptable
- Automated evidence required: RED-first coverage and fixes for source acknowledgement, scope/mount/freshness fencing, Pointer Events ownership, definitive versus ambiguous outcomes, legacy/concurrent barrier bounds, and Task 08 UI-hold evidence; then every focused, full, behavior, build, emulator, perf, Chromium, fixture, hash, port, and diff gate in the plan
- Automated evidence: independently reran focused React `3/3` suites and `42/42` tests, Functions build with `105` verified outputs, Task 08 Node contract `11/11`, and `git diff --check`; all passed, with the known `punycode` deprecation and LF-to-CRLF warnings. These checks do not cover the remaining source/spec defects. The developer's full React run was inconclusive and every broader acceptance gate remained unrun.
- Manual evidence: not reached because source/spec review remains red; the user's staging Browser tab remains untouched
- Findings still open:
  - Resource freshness loss is not a lifecycle fence. The scope cleanup effect depends only on `actionScopeKey`; when status leaves `fresh`, the buttons lose terminal handlers while the active interval continues ticking and no cancellation occurs. In-flight metadata is not fully cleared on freshness loss or unmount.
  - The second ambiguous failure enters a `retryable` phase with no retry action or recovery path. It remains permanently overlaid, allows new gestures, and even a source publication of the successful-but-response-lost operation is still double-added because `retryable` always contributes its delta.
  - Persisting `lastResourceOperationId` changes the resource-document schema despite the explicit non-goal, exposes operation identity to readers, and is not a correct acknowledgement fence: if this operation is followed by another write before the listener snapshot, the later marker hides the first even though the snapshot already contains it, so the committing delta is double-applied.
  - The optimistic barriera value is not clamped in `optimisticResourceValue`; a concurrent current/total reduction can leave an already-accumulated overlay outside authoritative bounds. The client also does not use the callable's `appliedDelta` for reconciliation/evidence.
  - Pointer acceptance/cleanup remains under-specified and under-tested: no explicit non-primary, touch, pen, pointer-cancel, lost-capture, capture-failure, freshness-loss, actor-switch, or unmount coverage; capture failure leaves metadata behind and no touch-action policy is present.
  - No callable-emulator barrier test was added. The suite contains no floor, ceiling, zero-total, legacy-only, numeric-string, or concurrent barrier delta case, nor the required unaffected-resource checks.
  - `resource-gesture-terminal` is still ignored by `task08-contract.js`; command-applied evidence still derives applied delta from the requested payload rather than the callable result. The Home Browser scenario does not assert exact one terminal/one command/one application, and the two-client scenario still uses two direct bridge commands instead of overlapping a client-A UI hold with client B.
  - Required full React, callable-emulator, perf, behavior, normal staging-build, performance-build/preflight, Chromium, fixture/hash, cleanup, and port gates remain incomplete.
  - The callback envelope itself did not follow the persisted contract and must be corrected on the next attempt.

### Step 6 / attempt 3
- Developer task ID and title: `01a05751-fb94-7060-8946-a0c092ca0261` / `Task 08 Step 6 Resource Gesture Batching`
- Host/client task ID when applicable: `local` / `01a05751-fb94-7060-8946-a0c092ca0261`
- Callback token: `25d9bf97-320a-463f-ba50-cdcfea663dfb`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; preserve the complete accepted pre-Step-6 dirty state plus Attempts 1–2 and recompute final tracked/source fingerprints
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-03.md`
- Status: authenticated `DONE_WITH_CONCERNS` callback received with the expected source task, control ID, token, step, attempt, status, developer thread ID, report path, and baseline/current SHA
- Review verdict: RED — Attempt 3 materially progressed but remains incomplete and unacceptable
- Automated evidence required: remove the schema marker and close revision races; fence freshness/scope/unmount; provide real same-operation ambiguous recovery; finish barrier and Pointer Events behavior/coverage; make Task 08 evidence gate the real UI hold and actual applied result; then complete every plan gate with exact evidence
- Automated evidence: independently reran focused StatsBars `1/1` suite and `11/11` tests, Task 08 Node contract `11/11`, and `git diff --check`; all passed with the known `punycode` deprecation and LF-to-CRLF warnings. Developer reported a green Functions build with `105` outputs. These checks still do not cover the blocking requirements.
- Manual evidence: not reached because source/spec review is red; the user's staging Browser tab remains untouched
- Findings still open:
  - Resolved from Attempt 2: the persisted `lastResourceOperationId` schema field was removed; committing gestures now freeze rather than blindly re-add to ambiguous snapshots, and revision/result acknowledgement handles the covered source/result orderings.
  - Improved but still open: freshness loss clears the active overlay/timer, but async success/failure handlers do not fence on readiness or a captured lifecycle generation. A stale ambiguous rejection can therefore call `commitGesture` again after freshness loss; all metadata is not cleared on unmount/scope change, and pointer-capture failure still leaves the pre-created metadata entry.
  - Unchanged, non-progress round 1: the second ambiguous failure still enters a permanent `retryable` overlay with no recovery action, does not block new logical gestures, and can double-display a successful-but-response-lost operation.
  - Unchanged, non-progress round 1: the optimistic barrier value/effective delta remains unclamped after concurrent current/total changes and `appliedDelta` is not used by client reconciliation/evidence.
  - Unchanged, non-progress round 1: the StatsBars suite remains at `11` tests and still lacks explicit non-primary, wrong-pointer, touch, pen, cancel, lost-capture, capture-failure, actor/freshness, unmount, and barrier cases.
  - Unchanged, non-progress round 1: no callable-emulator barrier floor/ceiling/zero/legacy/numeric/concurrency or unaffected-resource coverage exists.
  - Unchanged, non-progress round 1: `resource-gesture-terminal` remains outside the Task 08 settlement contract, applied evidence still copies requested delta, Home lacks exact one-terminal/one-command/one-apply gates, and two-client still uses two direct bridge commands instead of a client-A UI hold overlapped with client B.
  - Unchanged, non-progress round 1: full React and every required emulator, perf, behavior, staging-build, performance-build/preflight, Chromium, fixture/hash, cleanup, and port gate remain unrun.

### Step 6 / attempt 4
- Developer task ID and title: `01a05751-fb94-7060-8946-a0c092ca0261` / `Task 08 Step 6 Resource Gesture Batching`
- Host/client task ID when applicable: `local` / `01a05751-fb94-7060-8946-a0c092ca0261`
- Callback token: `4bd31d07-1d16-436e-abac-991336496300`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; preserve all accepted dirty state and Attempts 1–3; report final tracked/source fingerprints
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-04.md`
- Status: superseded/interrupted at the user's direction. The task became idle after partial source/test edits, returned a completed turn with no result items, produced no authenticated callback, and did not create `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-04.md`.
- Review verdict: RED / not reviewable as a completed attempt. The unreported partial edits are preserved for the recovery task to inspect and finish; they are not accepted in isolation.
- Automated evidence: coordinator independently reran StatsBars `1/1` suite and `13/13` tests, Functions build with `105` verified outputs, Task 08 Node contract `11/11`, and `git diff --check`; all passed, with the known `punycode` deprecation and LF-to-CRLF warnings. These green checks are narrower than the acceptance contract and do not close the findings below.
- Manual evidence: not reached because the implementation and evidence matrix remain incomplete; the user's staging Browser tab was not touched.
- Preserved partial progress: lifecycle generation/readiness checks, centralized cancellation, pointer-capture-failure metadata cleanup, a retry action, barrier display/terminal clamping work, `touch-none`, and two focused tests were added. The recovery task must review these edits rather than assuming they are correct.
- Findings still open:
  - Ambiguous recovery can still double-display over a later source snapshot; unresolved retry state does not block keyboard activation and lacks the complete one-operation replay/new-operation-after-resolution contract.
  - Cancellation releases pointer capture before clearing active ownership, so synchronous `lostpointercapture` can finalize and dispatch during cancellation; finalization also lacks an exact lifecycle-generation fence and the cleanup race matrix is missing.
  - Barrier terminal evidence is emitted before effective-delta recomputation and can report a different delta from the dispatched command; the hold ID is not captured once at gesture start.
  - Pointer semantics/coverage remain incomplete for non-primary and wrong pointers, touch/pen, cancel/lost capture, capture failure, actor/freshness/unmount changes, synthetic click suppression, and timer cleanup.
  - Callable-emulator barrier coverage remains absent for overflow, underflow, zero-total, legacy-only, numeric-string, concurrent, result-field, schema, and unaffected-resource cases.
  - Task 08 still does not summarize/gate terminal evidence or actual callable results, the Home scenario lacks exact one-terminal/one-command/one-application assertions, and the two-client scenario still uses direct bridge mutations instead of a real client-A UI hold overlapped with client B.
  - No Attempt-4 report or complete focused/full/emulator/perf/behavior/build/Chromium/fixture/hash/port acceptance matrix exists.

### Step 6 / attempt 5 — recovery task
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `f65fcef8-9ee6-469b-bb67-9020966ce505`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `34f96ea65d75baac1a1d65e023c810cee4cc183b3eeee781ba32c8ef1f8530f6`; source `31a584006bf0a14eb644536c13cd351273ab90783bf5bdf0b737f318ce130084`. Preserve the complete accepted Steps 2–5 state, all Step 6 attempts, and all coordinator artifacts exactly; verify this baseline before editing and report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-05.md`
- Status: authenticated `DONE_WITH_CONCERNS` completion recovered from the expected task's final answer after direct callback delivery failed; control ID, token, step, attempt, task ID, report path, and SHA fields match
- Review verdict: RED — Attempt 5 materially improves Step 6 but does not satisfy its required contracts or evidence matrix
- Automated evidence required: red-first focused contracts for every open finding, then the complete local Step 6 acceptance matrix, deterministic fixture restoration/hash proof, and port cleanup
- Automated evidence: coordinator independently reran focused StatsBars/command tests `2/2` suites and `43/43` tests, Task 08 Node contract `12/12`, Functions build with `105` verified outputs, and `git diff --check`; all passed, with the known `punycode` and LF-to-CRLF warnings. Green current tests do not cover the blocking gaps below. Developer-reported behavior-with-Browser-skipped `65+4+17`, fixture/hash, build checks, and port cleanup are recorded but the required full React, `perf:test`, and Chromium gates remain unrun.
- Manual evidence: not reached because source/spec and required automated review are red. The coordinator-owned localhost Browser gate remains separate; the user's open staging tab was not touched.
- Findings still open:
  - The required Pointer Events/lifecycle regression matrix is still absent. The StatsBars gesture suite has only 14 gesture tests and does not explicitly cover `isPrimary:false`, wrong pointer IDs, independent mouse/touch/pen terminal paths, pointercancel, lostpointercapture during capture release, setPointerCapture failure, actor/generation switch, unmount with late success/ambiguous/definitive continuations, pointer-synthesized click suppression, or complete interval cleanup.
  - Schema-free acknowledgement proof is muddy: `withResourceRevision` still accepts and injects `lastResourceOperationId`, and acknowledgement tests pass that removed marker even though production no longer uses it. The constant `createUserOperationId` mock also cannot prove that replay retains one ID and the next post-resolution gesture obtains a new ID.
  - The Home Chromium hold still accepts any negative delta (`toBeLessThan(0)`) instead of proving the deterministic 2-second hold's exact requested/effective/applied/authoritative delta and explicit one-terminal/one-command/one-application/no-pending/no-failure outcome.
  - The two-client scenario hard-codes `resourceCommandCount: 2`, masking duplicate or missing commands, and supplies no measured render-isolation observations. It must derive and assert actual per-client command/application and render deltas rather than report constants/default zeroes.
  - Task 08 contract tests do not exercise duplicate terminal, terminal resource/delta/local-sequence mismatch, duplicate/missing application, or duplicate physical-command rejection even though those are acceptance conditions.
  - Callable-emulator coverage does not execute a discrete barrier set with turn metadata and does not assert the exact concurrent previous/new/applied/revision sequence, leaving two requested compatibility/serialization proofs incomplete.
  - Full React, `perf:test`, full local Chromium `perf:task08`, stable browser evidence, restored staging build/disabled verification after perf build, final fixture/hash proof, and final port cleanup have not been completed. Manual localhost Browser acceptance remains coordinator-owned after automated green.
- Recovery exception: although normal fix rounds resume the same task, the user explicitly authorized a new Terra High task because Attempt 4 was malfunctioning. The old task is superseded and must not be polled or resumed.

### Step 6 / attempt 6 — recovery fix round
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `48fb630c-18ee-47a0-bc90-4bf2f999e8ce`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `ee9b005e28d6dcb4311030d6ecdb7d4a1e5ff0ba194689dbabe30c9006a3ea76`; source `6ba2230dd2f7e78dfbde78b251b00e4009a990a9f077458a4baffb8c47a9c07c`. Preserve every accepted and in-progress tracked/untracked change; report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-06.md`
- Status: authenticated `DONE_WITH_CONCERNS` completion recovered from the expected task's final answer after direct callback delivery failed; control ID, token, step, attempt, task ID, report path, and SHA fields match
- Review verdict: RED — Attempt 6 materially progresses Step 6 but remains incomplete against the explicit test and Browser acceptance contract
- Automated evidence: coordinator independently reran focused StatsBars/command Jest `2/2` suites and `50/50` tests, Task 08 Node contract `19/19`, `git diff --check`, and the required-port inspection; all passed and all listed ports were free. Developer-reported full React `156/156` suites and `1,462/1,462` tests, `perf:test` `431/431`, Browser-skipped behavior `65+4+17`, fixture/hash, and build/preflight checks are recorded. Chromium aborted during six static-asset warmup requests before Task 08 scenarios, so it supplies no application verdict.
- Manual evidence: not reached because source/spec and Chromium review are red. The coordinator-owned localhost Browser gate remains separate; the user's staging tab was not touched.
- Findings still open:
  - `StatsBars.test.js` collapses actor change, freshness loss, and unmount into one sequence followed by only an ambiguous rejection. It does not independently prove late success, definitive rejection, ambiguous rejection, and in-flight manual retry are fenced for each relevant lifecycle invalidation, as required. It also lacks an explicit pointerup-then-synthetic-click (`detail > 0`) no-double-mutation assertion and complete timer-clear assertions for normal finalize/cancel/scope/unmount paths.
  - The callable-emulator concurrent barrier case still asserts only the two `appliedDelta` values and final current value. It does not assert the order-independent exact `{previousValue,newValue,appliedDelta,newRevision}` pair set or the final revision required to prove serialized truthful envelopes.
  - The two-client Browser source asserts only that StatsBars rendered on each client. It does not assert Navbar, Inventory, EquippedInventory, Extra, and ParamTables each remained at zero for each client during the resource window, so the requested per-client isolation proof is absent.
  - Full Chromium did not reach any Task 08 scenario because asset warmup aborted six chunk requests. The exact Home `-11`, two-client command/application/render evidence, final report, and coordinator manual localhost Browser gate therefore remain unverified.
  - Attempt 6 does not show the required final normal `build:staging` + `verify:staging-build` + `perf:verify-disabled` restoration after the performance build, nor a completed full `perf:task08` runner result. These final-state gates must be fresh after the Chromium run.

### Step 6 / attempt 7 — narrowed recovery fix round
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `29924eb3-435d-4f37-8b22-97d26d329df3`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `0a5aa2f95b9eed9fb96e58cf1d0334b87ce906d835a4ad7ed8296b620cbabd2e`; source `cd68942ad14f9dfa39a9a819d43f65d6c13f75fbce1ebd5e2fada6368f783bc8`. Preserve every tracked/untracked change and report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-07.md`
- Status: authenticated `DONE_WITH_CONCERNS` completion recovered from the expected task's final answer after direct callback delivery failed; control ID, token, step, attempt, task ID, report path, and SHA fields match
- Review verdict: RED / blocked — source and focused-contract review is green, but the corrected two-client Chromium assertion has still not executed and Step 6 cannot be accepted without that gate
- Independent automated evidence: inspected the narrowed StatsBars lifecycle/timer/synthetic-click coverage, exact concurrent callable envelopes, and the resource-only per-client render window. Fresh focused Jest passed `2/2` suites and `59/59` tests; the Task 08 settlement contract passed `19/19`; `git diff --check` passed with existing LF-to-CRLF warnings only.
- Chromium rerun evidence: the first coordinator invocation reached no emulator because the performance build had yielded before its process fully exited; after the build settled, its build/source fingerprint matched exactly. The second invocation was correctly rejected by the no-takeover guard when ports `8080` and `9150` were reclaimed. PID `31296` remains alive and `jcmd VM.command_line` proves it is the `demo-fnd-perf` Firestore emulator for this exact checkout, rules path, project, and ports. The ports were free at the subsequent snapshot, but the orphan can reclaim them and the harness cleanup verdict remains red.
- Final local build state: restored the ordinary explicit `devs` / `fatin-test` staging-target build; `verify:staging-build` and `perf:verify-disabled` passed. No deployment or remote Firebase access occurred.
- Manual evidence: not reached. The coordinator-owned localhost Browser gate remains pending, and the user's open staging tab was not touched.
- Finding still open: stop the exact owned orphan with explicit authorization, verify every Task 08 port remains free, rebuild the opt-in performance artifact, rerun all six Chromium stages through the corrected two-client assertion, restore/verify the ordinary staging build again, and then complete the separate localhost Browser gate.
- Post-authorization coordinator rerun: PID `31296` was terminated after exact re-verification and all harness ports were free. A fresh performance build/preflight passed. Chromium completed `5/6` stages: Character Creation, Home, and the corrected two-client scenario passed; Home proved one `-11` resource command/application and zero unrelated resource-window renders, while two-client proved two commands/applications, final value `40`, convergence on both clients, and zero unrelated resource-window renders. Login failed only in its per-context asset validation: warm pass `70/70`, validation `62/70`, with eight assets across two consecutive four-request batches aborting at exactly `5.0–5.01s`; later batches and every other context passed. Managed Windows shutdown also reported `taskkill` access denied and a 60-second cleanup timeout, although all ports were free at the immediate coordinator snapshot. The overall report remains `partial`, `complete=false`, `officialBaseline=false`.
- Automated evidence required: close only the five findings above with red-first proof, then complete the full local Chromium/final-build matrix and affected regression gates
- Manual evidence: coordinator-owned localhost Browser gate only after source and automated review are green

### Step 6 / attempt 8 — harness reliability fix round
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `a9c0fc8b-f4f5-4732-91f6-6db29d0d1a8a`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `d11b30f8fef0ed0a45b94296d8858e460110e24c4c155bb80708e2972fc40932`; source `14c825916e82857508ed661ac1928924dcd3fd62aab2b7e475b3246ad48f1bbf`. Preserve every tracked/untracked change and coordinator artifact; report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-08.md`
- Status: authenticated `DONE_WITH_CONCERNS` completion recovered from the expected task's final answer after direct callback delivery failed; control ID, token, step, attempt, task ID, report path, and SHA fields match
- Review verdict: RED — asset validation and all six Chromium scenarios are green, but the Windows shutdown implementation leaves the Firestore Java descendant alive and the required cleanup/report-completeness gate fails
- Scope: do not alter the now-green Step 6 product behavior or its gesture/concurrency semantics unless a new deterministic regression proves a product defect. Fix only the bounded browser asset-validation and owned-emulator shutdown reliability gaps, with test-first proof and retained fail-closed verification.
- Automated evidence required: deterministic RED/GREEN unit coverage for transient validation stalls and Windows owned-child cleanup denial/fallback; affected performance/helper/emulator suites; full React/perf regression gates proportional to changed source; one fresh source-matched `6/6` Chromium run with `complete=true`, corrected Home/two-client metrics, fixture/hash restoration, stable free ports, and a final ordinary staging build plus disabled-instrumentation verification.
- Manual evidence: coordinator-owned localhost Browser gate only after Attempt 8 is independently green; the user's staging tab remains untouched.
- Independent review evidence (2026-09-01): callback fields authenticated. Fresh browser-helper tests passed `50/50`, emulator lifecycle tests passed `20/20`, Task 08 contract passed `19/19`, and `git diff --check` passed with existing line-ending warnings. The developer report's final source fingerprint was stale after its tracked README update; the coordinator rebuilt a source-matched opt-in artifact at tracked/source fingerprints `b0d6bf458297fc6285353541fd5df2513e78d9e78b06828dcab17e56e669e0f6` / `407df445824c79670416cfd319cdc3428bdc3d40a3f17f6becf1396ae8ffa9ec` and proved all twelve harness ports bindable before the run.
- Independent Chromium evidence: one full coordinator invocation reached Playwright and passed `6/6` in `5.1m`. Asset warmup/validation, Login, Character Creation, Home, and corrected two-client scenarios all passed. Home recorded one requested/applied `-11` resource command and zero unrelated resource-window renders. Two-client recorded two commands/applications, final value `40`, convergence on both clients, and zero unrelated resource-window renders.
- Blocking cleanup evidence: the same invocation exited `1`; the report is `partial`, `complete=false`, `officialBaseline=false`, and records `Performance emulator harness ports did not become stably free within 60000 ms` for `8080, 9150`. The captured Firebase CLI child exited after `child.kill('SIGINT')`, so the helper skipped its tree fallback, while Java PID `18624` survived. JBR `jcmd 18624 VM.command_line` proves it is `cloud-firestore-emulator-v1.21.0.jar` for project `demo-fnd-perf`, this checkout's `frontend/firestore.rules`, and ports `8080/9150`. The user previously authorized only PID `31296`; PID `18624` was not terminated.
- Blocking implementation finding: on Windows the new helper treats exit of the captured Node/Firebase CLI wrapper as proof that the owned emulator suite exited. The OS-level `SIGINT` kills that wrapper without executing Firebase CLI's registered clean-shutdown handler, leaving its Firestore descendant alive. The unit tests mock child exit and free ports together and therefore do not reproduce the proven wrapper-exits/descendant-survives case. Implement a genuinely owned graceful control path (for example, an IPC/supervisor path that invokes Firebase CLI shutdown inside its process, or another equally ownership-safe mechanism), retain bounded exact-tree fallback and stable-port proof, and add a RED regression for this exact sequence.

## Callback contract
At the end of Attempt 8, the recovery developer must send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `a9c0fc8b-f4f5-4732-91f6-6db29d0d1a8a`, step `6`, attempt `8`, status `DONE` or `DONE_WITH_CONCERNS`, developer thread ID `01a058c2-333c-7432-99fb-2d50a404aa3b`, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-08.md`, baseline/current SHA, exact one-line verification, concerns, and requested action `review`. If direct delivery fails, the identical payload must appear in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 9 — owned Windows shutdown fix
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `ce7d9f57-64a9-44aa-afdc-91460b418267`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `b0d6bf458297fc6285353541fd5df2513e78d9e78b06828dcab17e56e669e0f6`; source `407df445824c79670416cfd319cdc3428bdc3d40a3f17f6becf1396ae8ffa9ec`. Preserve all accepted/in-progress changes and coordinator evidence.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-09.md`
- Status: authenticated `NEEDS_CONTEXT` completion recovered from the expected task's final answer after direct callback delivery failed; control ID, token, step, attempt, task ID, report path, SHA, status, and requested action match
- Review verdict: RED — the IPC supervisor is directionally correct, but `requestOwnedWindowsGracefulShutdown` treats `child.send(...) === false` as immediate non-delivery even though Node defines `false` as possible channel backpressure. That can race a queued, eventually acknowledged graceful shutdown with the exact-tree force fallback. Integration also remains blocked by unauthorized PID `18624`.
- Scope: retain the now-green asset validation and all Step 6 product/browser behavior. Fix only the proven owned Windows shutdown lifecycle and its deterministic coverage. Do not terminate PID `18624`; its exact authorization is not recorded.
- Automated evidence required: RED/GREEN proof for wrapper exit without descendant cleanup, a genuine owned graceful control/acknowledgement path, exact fallback and stable-port semantics, focused/perf/full-React gates, and final integration only after a newly authorized clean-port boundary.
- Manual evidence: coordinator-owned localhost Browser gate remains pending after complete automated green.

- Independent review evidence (2026-09-01): callback tuple and report authenticated. Fresh `npm.cmd run perf:test` passed `439/439` outside the restricted sandbox; the initial restricted run's four Storage failures were only `EPERM` reads of the user's Firebase config file. `git diff --check` passed with the existing line-ending warnings. A deterministic fake-child reproduction returned `false` from `send`, then delivered a matching acknowledgement and successful send callback; the current helper still rejected immediately with `Owned Firebase emulator graceful shutdown request was not accepted by its IPC channel.` Local Node typings confirm that `send()` may return `false` solely because the channel backlog exceeds its threshold. Attempt 9's tests cover only `send() === true` and omit the required backpressure, malformed/mismatched/missing/late acknowledgement, early-wrapper-exit, and single-settlement cleanup matrix.
- Clean-port boundary: PID `18624` still owns ports `8080` and `9150`; `jcmd` reconfirmed it as the exact `demo-fnd-perf` Firestore emulator for this checkout and rules path. It was not terminated because the user's earlier grant named only PID `31296`.

## Callback contract — Attempt 9
At the end of Attempt 9, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `ce7d9f57-64a9-44aa-afdc-91460b418267`, step `6`, attempt `9`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, developer thread ID `01a058c2-333c-7432-99fb-2d50a404aa3b`, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-09.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 10 — IPC backpressure repair
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `353fa20d-c30d-46cb-bf9d-c63d956071cb`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `4e6a9d674294fe61c4d6b4e2f87945af6ad7d212f115b516182a78f20bbd0399`; source `a632186389547c794f91180c731c223a6984e9fce038639ea11f6dd47fe9cff1`. Preserve every tracked/untracked change and coordinator artifact; report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-10.md`
- Status: authenticated `NEEDS_CONTEXT` completion recovered from the expected task's final answer after direct callback delivery failed; control ID, token, step, attempt, task ID, report path, SHA, status, and requested action match
- Review verdict: GREEN for the scoped IPC source repair, but Step 6 remains unaccepted pending the required source-matched emulator/Chromium, fixture, cleanup, final-build, and coordinator Browser gates
- Scope: fix the proven IPC backpressure race and complete deterministic acknowledgement/lifecycle coverage. Do not alter the green product behavior, asset validation, resource gesture semantics, or Browser assertions without a new deterministic regression.
- Automated evidence required: RED/GREEN coverage for `send() === false` with eventual successful callback/acknowledgement and no fallback; bounded failure for callback error/channel close/no acknowledgement; malformed, mismatched, missing, and late acknowledgement behavior; early wrapper exit; listener/timer cleanup and exactly-once settlement; then focused emulator lifecycle, full `perf:test`, proportional React/build checks, and source/diff evidence. Do not run the integrated emulator/Chromium gate while PID `18624` owns required ports.
- Manual evidence: coordinator-owned localhost Browser gate remains pending after complete automated green.

- Independent review evidence (2026-09-01): inspected the complete supervisor, parent shutdown path, lifecycle matrix, report, Git state, and fingerprints. Fresh focused emulator/supervisor/Task 08 Node verification passed `58/58`. The first restricted `perf:test` run reached `444/448`; all four failures were independently localized to sandbox-only `EPERM` reads of `C:\Users\Marco\.config\configstore\firebase-tools.json`. The fresh unrestricted rerun passed `448/448`. The current branch/HEAD and final fingerprints match the report, and `git diff --check` remains green apart from existing line-ending warnings. No Critical or Important source defect remains in the Attempt 10 scope.
- Context resolution: PID `18624` is no longer present and ports `8080` and `9150` have no listener. A fresh fail-closed `assertEmulatorPortsFree()` check reported `HARNESS_PORTS_FREE`; no process was terminated, signalled, adopted, or taken over by the coordinator.

## Callback contract — Attempt 10
At the end of Attempt 10, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `353fa20d-c30d-46cb-bf9d-c63d956071cb`, step `6`, attempt `10`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, developer thread ID `01a058c2-333c-7432-99fb-2d50a404aa3b`, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-10.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 11 — clean-port integration continuation
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `5aac1e03-762b-45b1-b04a-100690b58d5d`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `4ab192e4b0fc4fa23261b698b12091dc53eb6003dfbdb2c863f608e9ffe0796e`; source `39d2a75fadcf228f11d7ec1d97b6f13cc64c5cf8228a459469c01be666548892`. Preserve every tracked/untracked change and coordinator artifact; report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-11.md`
- Status: incomplete / unauthenticated — the task is idle after a completed turn, but `read_thread` returned no result items or callback payload and `step-06-attempt-11.md` was not created
- Review verdict: RED / not acceptable as a completed attempt. Attempt 11 left a narrow unreported Windows PATH fix, but produced no fresh behavior/Chromium report and no final acceptance evidence.
- Scope: consume the now-resolved clean-port context and complete the previously blocked source-matched local integration/final-state matrix. Do not alter source unless the run exposes a deterministic defect; if it does, capture evidence first and make only the smallest test-backed repair.
- Automated evidence required: reverify all harness ports free; create the exact opt-in performance build/preflight for the recorded source; run the complete local Task 08 behavior/callable gates and one full `perf:task08` Chromium journey through all `6/6` stages; require `complete=true`, `officialBaseline=false`, exact Home one-command/one-application `-11` evidence, two-client convergence/render isolation, fixture `9,139`/approved hash, and stable cleanup with every task port free. Then restore `build:staging`, run `verify:staging-build` and `perf:verify-disabled`, recheck fixture/hash, ports, Git diff, and final fingerprints.
- Manual evidence: developer prepares localhost state only and must not claim the coordinator-owned Browser verdict. The user's open staging Browser tab remains out of scope.

- Reconciled workspace evidence (2026-09-01): Attempt 11 added case-insensitive Windows `Path`/`PATH` normalization in `createFirebaseCliEnvironment`, reused it for the portable-Java path in the main and rules emulator launchers, and added one focused regression. This is consistent with a nested `node` lookup failure after prepending portable Java. Fresh coordinator verification passed the emulator/supervisor/Task 07 harness matrix `53/53`; `git diff --check` passed with existing line-ending warnings. No Important defect was found in this narrow change.
- Missing acceptance evidence: the newest performance build was generated at `2026-09-01T16:04:00.511Z` for tracked/source fingerprints `654174008bd46a3b269d88c53cae0ad89d7ea651d9a01b23138e8c1f0deb80da` / `e2fe69f5ed8e785555f9295518819a030d6c3332a9b198653d649c7bff9e025c`, before the PATH fix. The current tracked/source fingerprints are `3cca79dbdf051640a887472b6b1ed6a3ad79acb000b38bee3569c37138950e65` / `fb5d45086c70bf51490de3a6fd10f61db9d63d6d62d01911599b1dd489d550c5`; therefore that build is stale and no source-matched Attempt 11 Chromium result exists. The visible `task08-baseline.json` remains the older partial run from `2026-09-01T09:14:29Z` and cannot support Attempt 11.
- Current external state: all harness ports are free; no process termination, signalling, adoption, or takeover occurred during reconciliation.

## Callback contract — Attempt 11
At the end of Attempt 11, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `5aac1e03-762b-45b1-b04a-100690b58d5d`, step `6`, attempt `11`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, developer thread ID `01a058c2-333c-7432-99fb-2d50a404aa3b`, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-11.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 12 — PATH-fix integration recovery
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `760fe0b4-2f2e-445b-a405-1f71dadcf535`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `3cca79dbdf051640a887472b6b1ed6a3ad79acb000b38bee3569c37138950e65`; source `fb5d45086c70bf51490de3a6fd10f61db9d63d6d62d01911599b1dd489d550c5`. Preserve every tracked/untracked change and coordinator artifact; report final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-12.md`
- Status: `DONE_WITH_CONCERNS` report reconciled from durable state after the task returned no result items and direct callback delivery failed
- Review verdict: RED — product gesture behavior and automated evidence are green, but the coordinator-owned manual harness leaked its complete Windows wrapper/Firebase CLI process tree after Ctrl+C and therefore failed required cleanup
- Scope: reconcile the unreported Attempt 11 PATH fix, prove its actual root cause and RED/GREEN behavior, then complete the source-matched local behavior/Chromium/final-state matrix. Do not alter product code; do not add another harness change without a deterministic failing reproduction.
- Automated evidence required: focused PATH/emulator tests, full `perf:test`, fresh source-matched performance build/preflight, complete Task 08 behavior/callable gates, one complete `perf:task08` Chromium `6/6` run with `complete=true` and `officialBaseline=false`, exact Step 6 Home/two-client metrics, fixture `9,139`/approved hash, owned shutdown and stable-free ports, then restored `build:staging`, `verify:staging-build`, `perf:verify-disabled`, final fixture/port/diff/fingerprint proof.
- Automated evidence: coordinator independently passed focused emulator/supervisor/Task 07/Task 08 tests `80/80`, unrestricted `perf:test` `450/450` (the sandbox-only run failed exactly four Firebase config-store reads with `EPERM`), `git diff --check`, source-matched performance preflight, normal staging verification, disabled-performance verification, fixture `9,139` / `136` / approved hash, and final free ports. The developer's source-matched full report remains `complete=true`, `officialBaseline=false`, Chromium `6/6`, run ID `f7b38e3c-790e-4448-bba3-437154ccb81f`, and source fingerprint `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902`.
- Manual evidence: product behavior GREEN / cleanup RED in `evidence/step-06-browser-review-attempt-12.md`. Physical holds showed intermediate optimistic ticks and exact one-revision settlement; route loss discarded a pending overlay with no write; barrier ceiling/floor and two-client overlap converged; both tabs had zero warnings/errors; the staging tab was untouched. After fixture restoration and one Ctrl+C, all ports became free but the exact owned process tree remained alive for more than four bounded-shutdown windows. The coordinator revalidated and force-terminated only that owned tree, then restored the staging build and reverified fixture/ports.
- Blocking finding: the Windows shutdown path can release every emulator port but fail to terminate `pwsh -> npm -> emulators.js -> firebase-emulator-supervisor/Firebase CLI` and descendants. This violates bounded owned cleanup and can leave later runs/resources unstable. The observed tree was `19120 -> 12500 -> 19036 -> 9988 -> 14976 -> 17152`, with owned descendants `4864` and `5876`; these PIDs are historical evidence only and are no longer running.

## Callback contract — Attempt 12
At the end of Attempt 12, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `760fe0b4-2f2e-445b-a405-1f71dadcf535`, step `6`, attempt `12`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, developer thread ID `01a058c2-333c-7432-99fb-2d50a404aa3b`, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-12.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 13 — interactive Windows shutdown leak
- Developer task ID and title: `01a058c2-333c-7432-99fb-2d50a404aa3b` / `Task 08 Step 6 Recovery`
- Host/client task ID when applicable: `local` / `01a058c2-333c-7432-99fb-2d50a404aa3b`
- Callback token: `8f6b07b3-b3bc-4e96-b1ea-e8b340ab523f`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `c6565b3b24ca56878a17e17a7ec6860d1faa6d33da5f94cde2e6b33bf60d4ce8`; source `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902`. Preserve every tracked/untracked change and coordinator artifact; recompute final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-13.md`
- Status: authenticated `DONE_WITH_CONCERNS` report recovered from the referenced recovery task; direct callback delivery failed, but the report matches the expected task, control ID context, attempt, report path, baseline/current SHA, and final fingerprints
- Review verdict: RED — the normal Ctrl+C leak is repaired, but the Windows console-isolation change creates an uncovered parent-disconnect orphan path
- Scope: fix only the deterministic Windows interactive-shutdown/process-exit leak exposed by the coordinator Browser run. Do not change now-green resource product behavior or Task 08 measurements unless a deterministic regression directly requires it.
- Required evidence: exact RED reproduction; bounded unit/integration coverage for early/direct child SIGINT concurrent with parent IPC shutdown, acknowledged child that releases ports but does not exit, taskkill/fallback timeout and diagnostics, complete wrapper/child exit, listener/timer cleanup, and no arbitrary-PID targeting; then focused tests, `perf:test`, one owned real `perf:emulators` start/seed/Ctrl+C exit probe with exact elapsed time and zero surviving owned PIDs, staging restoration, fixture/hash, free ports, and final diff/fingerprints.

## Callback contract — Attempt 13
At the end of Attempt 13, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `8f6b07b3-b3bc-4e96-b1ea-e8b340ab523f`, step `6`, attempt `13`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, developer thread ID `01a058c2-333c-7432-99fb-2d50a404aa3b`, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-13.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 14 — detached supervisor parent-disconnect cleanup
- Developer task ID and title: `01a05e29-bba1-7e61-89fd-a8f4a7aebd25` / `Task 08 Step 6 Parent Disconnect Recovery`
- Host/client task ID when applicable: `local` / `01a05e29-bba1-7e61-89fd-a8f4a7aebd25`
- Callback token: `872733a1-760a-4fc4-b815-de9531af2045`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f`; source `7e87a20db716b9847af21181fcfaac9a199cd2b9660f73f97d7e5dc1f0736b1f`. Preserve every tracked/untracked change and coordinator artifact; recompute final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-14.md`
- Status: authenticated `DONE_WITH_CONCERNS` callback recovered from the referenced task with the expected control ID, token, step, attempt, developer task ID, report path, baseline/current SHA, fingerprints, and requested action
- Review verdict: RED — normal parent disconnect is repaired, but two parent-gone failure paths remain non-terminal and can still orphan the detached emulator tree
- Scope: close only the parent-IPC-disconnect/orphan lifecycle gap introduced by the Windows detached supervisor. Preserve Attempt 13's normal Ctrl+C fix and all green Step 6 product behavior, metrics, fixtures, and staging output.
- RED evidence: independent focused shutdown/Task 08 tests pass `82/82`, and all harness ports are free; however, a direct supervisor probe after CLI SIGINT registration reports `parentDisconnectSigints: 0` and `disconnectListeners: 0`. Because `createOwnedFirebaseEmulatorSpawnOptions` now launches the Windows supervisor with `detached: true`, an unexpected wrapper exit closes IPC without delivering Ctrl+C to the child and can leave the Firebase CLI/emulator descendants alive.
- Required evidence: test-first parent-disconnect handling that is idempotent with accepted/in-flight IPC shutdown; no duplicate SIGINT, arbitrary PID targeting, or new unbounded wait; normal Ctrl+C and unexpected-wrapper-exit integration probes proving bounded wrapper/supervisor/descendant exit, stable free ports, fixture restoration/hash, staging restoration, focused tests, `perf:test`, diff/fingerprints, and explicit remaining boundaries.

## Callback contract — Attempt 14
At the end of Attempt 14, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `872733a1-760a-4fc4-b815-de9531af2045`, step `6`, attempt `14`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, the new developer thread ID, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-14.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 15 — fail-closed parent-loss shutdown
- Developer task ID and title: `01a05e4c-fb87-70b2-9551-1284bedc68e9` / `Task 08 Step 6 Fail-Closed Parent Loss`
- Host/client task ID when applicable: `local` / `01a05e4c-fb87-70b2-9551-1284bedc68e9`
- Callback token: `e14c58f6-3558-4821-bed7-e92ab1cd610d`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f`; source `e02a2684845ba36fbd3ddff9db6193f51ffb12cce14a631e3b9758c43e6b31a4`. Preserve every tracked/untracked change and coordinator artifact; recompute final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-15.md`
- Status: authenticated `DONE_WITH_CONCERNS` callback received with the expected control ID, token, step, attempt, developer task ID, report path, baseline/current SHA, final fingerprints, and requested action
- Review verdict: RED — the exact-tree success path works, but the fallback unrefs both its helper and its deadline, allowing the supervisor to exit naturally before cleanup becomes authoritative
- Scope: make the detached supervisor's parent-gone failure paths terminal and demonstrably leak-free when no usable Firebase CLI SIGINT handler exists after initialization or when that handler throws. Preserve Attempt 14's green normal-disconnect behavior and all Step 6 product/measurement contracts.
- RED evidence: with parent IPC disconnected and initialization complete without a SIGINT handler, the supervisor returns with `messageListeners: 1`, `disconnectListeners: 1`, `sigintListeners: 0`, no exit status, and no terminal fallback. With a throwing SIGINT handler, it records one hit, removes only the disconnect listener, swallows the failure, sets no terminal status, and leaves the message listener. In both cases the parent is already gone, so the parent-owned exact-tree fallback cannot run.
- Required evidence: RED-first tests for post-initialization no-handler and throwing-handler parent loss; an evidence-backed child-side terminal fallback that targets only the supervisor's exact owned tree and is bounded/idempotent; no arbitrary PID discovery or new product changes; actual owned integration proof for normal disconnect and both failure paths; then focused `90+` tests, unrestricted `perf:test`, diff, staging/fixture/config/port restoration, and final fingerprints.

## Callback contract — Attempt 15
At the end of Attempt 15, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `e14c58f6-3558-4821-bed7-e92ab1cd610d`, step `6`, attempt `15`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, the new developer thread ID, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-15.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

### Step 6 / attempt 16 — terminal-fallback liveness authority
- Developer task ID and title: `01a05e96-b131-79e3-b3ae-8bde47b9793e` / `Task 08 Step 6 Terminal Fallback Liveness`
- Host/client task ID when applicable: `local` / `01a05e96-b131-79e3-b3ae-8bde47b9793e`
- Callback token: `60e73040-0eaf-47fd-85a4-61fdaf8f38da`
- Baseline SHA and dirty-state fingerprint: SHA `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; tracked `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f`; source `e783a42ab23735f081dc3389c672888c6dc4a62a7c65c0749d9399fd1e924cb4`. Preserve every tracked/untracked change and coordinator artifact; recompute final fingerprints.
- Report path: `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-16.md`
- Status: dispatched in a new task with the user's explicit `gpt-5.6-sol` / `high` override
- Review verdict: pending
- Scope: retain authoritative supervisor liveness until the exact-tree taskkill helper succeeds or a referenced deadline/failure path settles; close the natural-exit race without changing green product, metric, normal shutdown, or ownership behavior.
- RED evidence: an independent real event-loop probe invoked the production fallback with a helper intentionally alive for 750 ms and a 5-second deadline. Because both helper and timer are unrefed, the supervisor process exited naturally with code `0` after 47 ms. The helper had not settled, `processImpl.exit(1)` had not run, and a real taskkill could then lose its root PID before enumerating descendants.
- Required evidence: RED-first child-process liveness coverage; keep an authoritative ref until helper/deadline settlement; no natural code-0 exit; prove exact-tree success plus helper error/exit/timeout semantics do not silently orphan descendants; audit platform gating; rerun owned process integrations, focused tests, unrestricted `perf:test`, staging/fixture/config/ports/diff/fingerprints.

## Callback contract — Attempt 16
At the end of Attempt 16, send exactly one callback to coordinator thread `01a047ff-5aee-7c22-8ec8-d74c7ade949d` beginning with `COORDINATOR_CALLBACK` and containing control ID `task08-resource-step6-4cc22c2739f8`, callback token `60e73040-0eaf-47fd-85a4-61fdaf8f38da`, step `6`, attempt `16`, status `DONE`, `DONE_WITH_CONCERNS`, or `NEEDS_CONTEXT`, the new developer thread ID, report path `docs/coordinator/task-08-resource-gesture-step-6/reports/step-06-attempt-16.md`, baseline/current SHA, exact verification, concerns, and requested action `review` or `provide-context`. If direct delivery fails, put the identical payload in the final answer with `callback_delivery: failed`.

## Authorization envelope
- Local Step 6 edits/tests/builds and deterministic loopback emulator/browser harnesses in `fnd-devs`: allowed.
- Exact process cleanup authorization: on 2026-08-31 the user explicitly authorized termination of PID `31296`, independently reverified immediately beforehand as the `demo-fnd-perf` Firestore emulator for this checkout's `frontend/firestore.rules` on ports `8080` and `9150`. This authorization does not extend to any other PID.
- Commit/push/merge/PR/deploy/remote Firebase reads or writes/baseline acceptance/dependency upgrades: forbidden.
- Destructive Git/filesystem operations, user-change cleanup, and worktree changes: forbidden.
- The user's open `fatin-test.web.app` Browser tab: out of scope.
- Coordinator manual-review cleanup record: the exact task-owned tree rooted at PID `19120`, spawned by the coordinator's Attempt 12 localhost harness, was revalidated and terminated after graceful shutdown released all ports but failed to exit. This is historical evidence, not authority over any future PID.

## Resume instruction
Attempt 4 is superseded. Attempt 10's scoped IPC repair is independently green. Attempt 12's product behavior and automated evidence remain green. Attempts 13–15 close the normal Ctrl+C, parent-disconnect, and exact-tree failure-path gaps, but Attempt 15 is RED because its unrefed helper/deadline allow natural supervisor exit before enforcement. Attempt 16 must run in a new Sol High task and stop after its report/callback. Do not start Step 7, deploy, touch the user's staging Browser tab, or terminate/signal/adopt any process not spawned and owned by the active Attempt 16 harness.
