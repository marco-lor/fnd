# Task 08 Step 8 — coordinator review and Browser acceptance, attempt 1

Date: 2026-09-02  
Control ID: `task08-steps7-8-3095fd2c`  
Verdict: GREEN, local-only  
Workspace: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`  
Branch / HEAD: `devs` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`

## Independent source and evidence review

- The authenticated developer result and
  `docs/coordinator/task-08-steps-7-8/reports/step-08-attempt-01.md`
  match control ID, attempt, dispatch token, task identity, unchanged HEAD, and
  the protected dirty-state contract.
- `HomeReadPlane.js` owns one parallel Home config attempt for `getVarie` and
  the four special-parameter schemas. Its result publication is fenced by UID,
  repository generation, store scope, and exact attempt; retry invalidates the
  same five documents; React 18 Strict Mode reuses the in-flight owner.
- `ConfirmUseConsumableModal.js` consumes the shared config slice. It neither
  calls `getVarie` nor fabricates a `d10`; regeneration is blocked until a fresh,
  valid die is available, while no-regeneration consumption remains independent
  of config and DiceRoller.
- The isolated Anima consumer in `Home.js` prevents config-only transitions from
  rerendering unrelated Home sections. No legacy `createRoot` remains in the
  Home/DiceRoller path.
- Fresh coordinator focused verification passed: 4 Home/config suites, 15/15
  tests; Functions TypeScript build passed with 105 outputs. The final host-side
  performance contracts passed 486/486. A preceding sandboxed run's seven
  failures were limited to Windows child-process cleanup and Firebase configstore
  permissions; the unrestricted host rerun is the accepted result.
- Developer source-matched evidence remains green: focused 130/130, Steps 2–7
  287/287, full React 1,496/1,496, Task 08 behavior 77 React + 4 Node + 18
  callable, and final Chromium 6/6. The Task 08 report is complete with run ID
  `bcee9a13-76ed-4f51-bf29-cc8f4f20bca2` and
  `officialBaseline=false`.

## Coordinator-owned localhost Browser acceptance

Only newly created `http://127.0.0.1:5000` tabs were used. The user's existing
`https://fatin-test.web.app/home` tab was not opened, selected, or modified.

1. The deterministic performance artifact served
   `static/js/main.1b614fab.js`. Before acceptance, the fixture verified at
   exactly 9,139 documents with SHA-256
   `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
2. Fixture login reached `/home`; shared Home config settled visibly to `d8`
   without an error or fallback state.
3. Inventory opened with 60 mounted rows and 440 remaining. Two explicit
   `Load more` gestures produced 180 mounted rows and 320 remaining. Of 181
   image elements, 17 had real sources and all 17 completed with nonzero natural
   width; empty-source fallback images were not classified as failures.
4. A pointer click on `-1 HP` changed `45/50` to `44/50` in the initiating
   client. A separately authenticated second localhost client converged to
   `44/50` after its subscription update.
5. The exact documented local consumable setup exposed Fixture item 315 through
   the real UI. Confirmation showed `1d8`; the prepared result was `Result = 2`.
   Closing the dice result committed the action, after which the exact item was
   absent from both clients.
6. A fresh local account followed the complete Login → Character Creation →
   Home journey. The deterministic missing-race fixture exposed the supported
   `Evocazione Permanente` placeholder; `Spirito`, points, and character details
   completed successfully, and the new character arrived at `/home` with `d8`.
7. The fresh peer client recorded no console entries. The fresh account journey
   recorded no console errors (only the expected completed-character redirect
   log). One earlier primary-tab `auth/user-not-found` error was caused by an
   intentionally attempted login before the freshly restarted emulator had been
   seeded; it predates the verified fixture and is excluded as setup-only.

The first localhost load also intentionally proved that the restored ordinary
staging artifact cannot initialize against the isolated emulator project. The
acceptance run began only after rebuilding the deterministic performance
artifact and restarting the owned hosting emulator, so that setup observation is
not product evidence.

## Cleanup and release boundary

- All coordinator-created localhost tabs were closed.
- The first post-acceptance reseed failed closed because the local Functions
  worker had exited and its readiness sentinel timed out after 180 seconds. The
  exact owned emulator tree was inspected and restarted; the retry completed and
  re-verified the exact 9,139-document fixture/hash above. No remote data was
  involved.
- The ordinary `devs` staging artifact was rebuilt and verified. Main is
  `static/js/main.a34fe146.js`, route-home is
  `static/js/route-home.2d7753d2.chunk.js`, and `perf:verify-disabled` confirms
  that no performance bridge, profiler, benchmark, or persistence experiment is
  present.
- The exact owned emulator tree was terminated. All ten task ports were free in
  two samples; `.firebase.performance.generated.json` is absent.
- `git diff --check` passed with only existing LF-to-CRLF notices. The
  conflict-marker scan returned no matches. Branch, HEAD, and the intentionally
  dirty/un-staged workspace remain unchanged except for authorized Task 08 and
  coordinator artifacts.

No commit, push, merge, PR, deployment, remote Firebase access, staging Browser
acceptance, or baseline acceptance was performed. Those boundaries remain
unverified and unauthorized in this run.
