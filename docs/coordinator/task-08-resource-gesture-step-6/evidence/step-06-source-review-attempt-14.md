# Task 08 Step 6 — coordinator source review of Attempt 14

Date: 2026-09-01  
Verdict: `RED`  
Severity: Important  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`

## Authenticated intake and accepted progress

- The referenced task supplied the expected control ID, callback token, step, attempt, developer task ID, report path, baseline/current SHA, final fingerprints, concern, and review request.
- Attempt 14 correctly routes a normal parent IPC disconnect through the existing Firebase CLI SIGINT path and makes that transition idempotent with an explicit IPC shutdown request.
- Its two owned Windows probes showed both normal Ctrl+C and unexpected exact-wrapper termination removing every captured supervisor/Java descendant and stably freeing all harness ports.
- Independent focused verification passed `90/90`; the unrestricted full performance suite passed `462/462`; staging identity and performance-disabled checks passed; all harness ports are free. The sandboxed full suite reproduced the known four Firebase Tools configstore `EPERM` failures before the identical unrestricted run passed.
- `git diff --check` passed with only the existing LF-to-CRLF warnings. The initial coordinator staging verification omitted the required explicit branch and failed closed; the corrected `FND_GIT_BRANCH=devs` invocation passed.

## Blocking finding

The new child-side transition is not terminal when its only graceful mechanism is unavailable after the parent has already disappeared:

1. If parent IPC disconnects and Firebase CLI initialization completes without a SIGINT handler, `requestFirebaseCliShutdown()` returns `firebase-cli-sigint-handler-missing`. No acknowledgement can reach the dead parent, no fallback is launched, no exit/failure is made terminal, and both supervisor lifecycle listeners remain.
2. If the Firebase CLI SIGINT listener throws during a parent-disconnect transition, the exception is converted to a returned rejection, but the parent is gone. The code has already marked shutdown requested and removed the disconnect listener, yet performs no terminal fallback or exit.

Fresh direct probes reported:

```json
{"case":"parent-gone-no-handler","connected":false,"messageListeners":1,"disconnectListeners":1,"sigintListeners":0,"sent":[]}
{"case":"parent-gone-throwing-handler","sigintHits":1,"messageListeners":1,"disconnectListeners":0,"sent":[]}
```

With `detached: true`, either state can leave an incompatible or failed Firebase CLI plus descendants alive indefinitely, and no parent remains to execute `taskkill`. Current tests either add a handler before initialization returns or explicitly accept the thrown-handler state without proving process termination.

## Required repair boundary

- Add RED-first coverage for parent gone plus final no-handler, and parent gone plus throwing handler.
- Implement a bounded, idempotent, child-side terminal fallback for the exact supervisor-owned process tree. Do not assume `process.exit()` kills descendants; prove the chosen Windows behavior with an owned process-tree integration case.
- Preserve normal explicit IPC acknowledgement, normal disconnect, duplicate/late event idempotence, and Attempt 13's bounded parent fallback.
- Target only exact processes spawned and owned by the active probe; never discover a termination target by port or scan and never touch a pre-existing process.
- Rerun focused/full gates and restore fixture, normal staging output, generated config absence, and stable free ports.

No Browser action, deployment, commit, push, remote Firebase access, or product-code change was performed by the coordinator review.
