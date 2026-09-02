# Task 08 Step 6 — coordinator source review of Attempt 13

Date: 2026-09-01  
Verdict: `RED`  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
HEAD: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`

## Accepted progress

- Attempt 13 reproduced the normal interactive Windows Ctrl+C leak and changed the Firebase supervisor to an isolated Windows process group.
- The exact-tree `taskkill.exe` fallback now has a finite 10-second bound and retains timeout/error diagnostics.
- The developer's fresh owned Ctrl+C probe exited in about 30.1 seconds with no surviving owned process or occupied Task 08 port.
- Independent focused verification passed `82/82` tests across the emulator lifecycle and Task 08 contract/runner/preflight files.
- Independent final port verification reported `HARNESS_PORTS_FREE`.

## Blocking finding

`frontend/scripts/performance/emulators.js` now launches the Firebase supervisor with `detached: true` on Windows, intentionally preventing the wrapper's console Ctrl+C from reaching it. The supervisor in `frontend/scripts/performance/firebase-emulator-supervisor.js` handles only explicit IPC `message` shutdown requests and registers no `disconnect` handler.

An independent direct probe initialized the supervisor with a Firebase CLI SIGINT handler, closed the simulated parent IPC channel, and emitted `disconnect`. It reported:

```json
{"parentDisconnectSigints":0,"disconnectListeners":0,"sigintListeners":1}
```

Therefore an unexpected wrapper exit can close IPC while leaving the detached supervisor and its Firebase emulator descendants alive. This is an Important process-ownership regression in the exact lifecycle area Attempt 13 was meant to harden. Current unit coverage verifies parent-side reaction when the child IPC disconnects, but not child-side cleanup when the parent disappears.

## Required repair boundary

- Add RED-first supervisor coverage for parent disconnect after CLI initialization.
- Make parent disconnect request the same in-process Firebase CLI shutdown exactly once.
- Keep explicit IPC request, duplicate/late disconnect, and normal Ctrl+C paths idempotent.
- Prove both a normal Ctrl+C and an unexpected exact-owned wrapper exit leave no supervisor/descendant process and all harness ports stably free.
- Preserve all green Step 6 product behavior and avoid deployment, commit, push, staging Browser interaction, arbitrary PID targeting, or unrelated edits.

The coordinator did not open or alter the user's `https://fatin-test.web.app` Browser tab.
