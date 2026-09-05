# Task 08 Step 6 — Attempt 13 Windows interactive shutdown recovery

Status: `DONE_WITH_CONCERNS`  
Date: 2026-09-01  
Checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / baseline HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`  
Dispatch tracked/source fingerprints: `c6565b3b24ca56878a17e17a7ec6860d1faa6d33da5f94cde2e6b33bf60d4ce8` / `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902`.

## Investigation before implementation

- Coordinator evidence reproduced the symptom: one owned PTY Ctrl+C freed all service ports but left the exact owned `pwsh -> npm -> emulators.js -> Firebase supervisor/CLI` chain alive for more than four bounded windows.
- Current Windows launch shares the console group (`detached: false`) between the wrapper and supervisor. A Ctrl+C can therefore reach the Firebase CLI's direct SIGINT handler concurrently with the wrapper's parent-owned IPC request.
- The existing parent fallback calls `spawnSync(taskkill.exe, ...)` without a timeout. If an already-shutting-down child does not exit after its services close, that synchronous exact-tree fallback can block the wrapper indefinitely. Existing tests only model a taskkill return and do not cover a stalled invocation.
- Hypothesis under test: make the owned supervisor signal-isolated on Windows and bound the exact-tree fallback, then require the parent to settle and report an explicit bounded failure if cleanup cannot complete. No product behavior or Task 08 metric code will be changed.

## RED/GREEN repair

- RED command: `node --test scripts/performance/emulators.test.js` failed `30/33`. The failures proved: no finite `taskkill.exe` timeout, timeout diagnostics were thrown away, and there was no Windows console-isolation launch contract for the supervisor.
- The repair keeps the exact captured child PID/tree contract. `taskkill.exe /PID <captured-pid> /T /F` now has a 10,000 ms synchronous bound and returns status, stdout, stderr, signal, timeout, and spawn-error diagnostics to the shutdown aggregate. The Windows child is launched detached and hidden with the existing IPC channel, so a parent-console Ctrl+C cannot independently invoke the Firebase CLI shutdown handler.
- Green focused matrix: `node --test scripts/performance/emulators.test.js scripts/performance/firebase-emulator-supervisor.test.js scripts/performance/task07-harness.test.js scripts/performance/task08-contract.test.js scripts/performance/task08-runner.test.js scripts/performance/task08-preflight.test.js` — `82/82` passed. It covers direct/early child SIGINT with a matching parent IPC acknowledgement, ACK/no-exit fallback, missing/rejected/mismatched/late acknowledgement, send failure/disconnect/error, taskkill success/non-zero/spawn timeout, one-fallback-only behavior, and terminal listener cleanup.
- Green unrestricted suite: `npm.cmd run perf:test` — `454/454` passed.
- `git diff --check` passed; only pre-existing LF-to-CRLF warnings were emitted.

## Fresh owned interactive probe

- Built a fresh source-matched performance artifact with command-scoped `C:\Program Files\JetBrains\PyCharm 2024.1.4\jbr`; `npm.cmd run perf:preflight` passed. The performance build/current source fingerprint is `7e87a20db716b9847af21181fcfaac9a199cd2b9660f73f97d7e5dc1f0736b1f`.
- Started one owned PTY `npm.cmd run perf:emulators`, verified the exact owned chain before shutdown: `emulators.js` PID `14376` -> detached Firebase supervisor PID `25568` -> Firestore Java PID `26156` (and its owned Storage Java child PID `21728`).
- Seeded and verified the deterministic local fixture before shutdown: `9,139` documents, `136` storage objects, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- Sent exactly one Ctrl+C to that PTY at `2026-09-01T18:00:14.061Z`; after the normal batch termination confirmation, the PTY exited in about `30.1` seconds with exit code `1`. Firebase logged its clean shutdown, every listed owned process and descendant was gone, and every Task 08 harness port was free. No coordinator or external `taskkill` was used.

## Final state and boundaries

- Restored normal staging output without touching the user staging Browser tab: `FND_GIT_BRANCH=devs npm.cmd run build:staging`, `npm.cmd run verify:staging-build`, and `npm.cmd run perf:verify-disabled` all passed.
- Final fixture report retained the verified `9,139`/`136`/approved-hash values; final port check reported `HARNESS_PORTS_FREE`.
- Final HEAD remains `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`. Final tracked/source fingerprints are `e37fec10f6696eea6efcb1b58cd1d5af38bd94fefd809f8b83e53c55db2b959f` / `7e87a20db716b9847af21181fcfaac9a199cd2b9660f73f97d7e5dc1f0736b1f`.
- Concern: the Windows `npm.cmd` wrapper reports exit code `1` after the single Ctrl+C/batch confirmation even though the owned `emulators.js` tree completed clean shutdown and left no ports or descendants. This is recorded for coordinator review; it is not an ownership leak.
- This attempt does not claim the coordinator-owned Browser verdict. It relies only on the existing Attempt 12 evidence for the already-green product behavior, and does not alter it.

## Callback delivery

- The one required callback attempt to coordinator task `01a047ff-5aee-7c22-8ec8-d74c7ade949d` was rejected by the app risk policy because its callback token and detailed evidence were classified as unverified-destination egress. No retry or workaround was attempted. Delivery status: `failed`.
