# Task 08 Step 6 — coordinator source review of Attempt 15

Date: 2026-09-01  
Verdict: `RED`  
Severity: Important  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`

## Authenticated intake and accepted progress

- The callback matches the expected control ID, token, step, attempt, developer task, report, baseline/current SHA, final fingerprints, and review request.
- Attempt 15 adds a self-rooted `taskkill.exe /PID <supervisorPid> /T /F` path without port, name, sibling, ancestor, or arbitrary-PID discovery.
- Fresh coordinator verification passed the six-file focused matrix `99/99`, including owned Windows no-handler and throwing-handler trees; both captured supervisor/descendant pairs disappeared and their owned ports became stably free.
- Fresh unrestricted `perf:test` passed `471/471`; staging identity, performance-disabled state, and all harness ports are green.
- The developer's real Firebase wrapper-loss probe also removed its complete captured tree within its bounded observation window. The user's staging Browser tab remained untouched.

## Blocking finding

`requestOwnedWindowsSupervisorTreeTermination()` calls both `timer.unref()` and `helper.unref()`. Once parent IPC and the supervisor-owned message/disconnect listeners are gone, those two objects are supposed to be the terminal cleanup authority. Unrefing both permits Node to exit naturally before either the taskkill helper settles or the deadline fires.

The coordinator ran the production helper with an injected detached helper intentionally alive for 750 ms and a five-second deadline. No other referenced handle was retained. The observed result was:

```text
FALLBACK_LIVENESS {"naturalExitCode":0,"elapsedMs":47,"helperPid":18424}
```

The supervisor therefore exited successfully after 47 ms, before the helper or timeout could call the required terminal `processImpl.exit(1)`. The owned probe helper later exited on its own and was confirmed gone. With real `taskkill`, the root PID can disappear before the helper enumerates the root's descendants, leaving them orphaned while the fallback reports no failure.

The current unit test explicitly requires one `helper.unref()` and one `timer.unref()`, so all `99/99` tests preserve rather than detect this race. The successful owned-tree probes are not sufficient because their live descendant handle keeps the supervisor event loop referenced and masks the no-other-handle case.

## Required repair boundary

- Add a RED child-process liveness test reproducing the natural code-0 exit before helper/deadline settlement.
- Keep at least one authoritative referenced handle until exact-tree termination succeeds or the bounded failure/deadline path executes. Do not treat an unrefed helper as process-lifetime authority.
- Reassess helper launch/error/nonzero/timeout handling: supervisor-only `process.exit()` cannot itself prove descendant cleanup. Do not silently orphan the tree on fallback failure; record and test the chosen fail-closed ownership outcome.
- Audit that the Windows-specific self-tree fallback is invoked only on supported Windows paths, or provide an exact POSIX process-group counterpart without weakening existing behavior.
- Preserve all green normal shutdown, parent-disconnect, product, metric, fixture, staging, and process-ownership contracts and rerun the complete required matrix.

No deployment, commit, push, remote Firebase access, Browser interaction, or product-code mutation was performed by the coordinator review.
