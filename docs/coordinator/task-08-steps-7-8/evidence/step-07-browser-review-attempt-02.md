# Step 7 coordinator acceptance — attempt 2

Verdict: **GREEN** for local Step 7 acceptance. This is not a deployment or an official performance-baseline acceptance.

## Identity and independent automated review

- Control/result identity authenticated for `task08-steps7-8-3095fd2c`, Step 7 attempt 2, token `33a6300b-b20a-4e9c-8e37-1a11a06fae0d`.
- HEAD remained `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`; no staged changes were introduced.
- Source review confirmed the Strict Mode mount effect is symmetric and the cleanup-image classifier is constrained to a proven successful deterministic fixture image request aborted only by harness-owned route cleanup.
- Fresh focused React matrix: 10/10 suites and 108/108 tests passed.
- Fresh Task 08/browser helper Node matrix: 74/74 tests passed.
- The final developer report was parsed independently: `complete=true`, all four required scenarios completed, source/build identities matched, fixture count/hash matched, and Chromium was 6/6.
- `git diff --check` had no errors (only existing Windows line-ending notices); conflict-marker scan found none.

## Coordinator-owned localhost Browser gate

The coordinator opened new localhost tabs against the deterministic `demo-fnd-perf` emulator stack. The user's already-open `https://fatin-test.web.app/home` tab was not inspected or changed.

- Signed in as the deterministic performance player and reached Home with no console errors or warnings.
- Confirmation cancellation left HP unchanged at 45/50.
- Rapid double confirmation produced exactly one in-tree DiceRoller, disabled competing Use actions, and used the server-prepared result.
- With two localhost clients, a concurrent second-client HP mutation converged in both clients before consumable close; the subsequent authoritative consumable commit removed the exact item, cleared its equipped slot, and converged both clients to the server-capped resource state.
- A Mana variation converged both clients to 27/33 and removed the consumed item.
- A no-regeneration case was rerun with a valid, separate unlimited-use belt fixture: the no-regeneration message appeared, no DiceRoller mounted, the consumable was removed, the belt remained equipped, and both clients stayed at HP 45/50. An earlier direct-admin setup that equipped the consumable itself as the belt was rejected as an invalid fixture artifact and was not used as product evidence.
- Route-unmount cancellation was exercised by starting an HP roll and navigating away before Close. After the presentation delay, the authoritative inventory still contained quantity 1 and resources remained 45/50 at revision 1, with no console errors.
- Ambiguous transport retry was not manually fault-injected; stable operation identity and exactly-once retry are covered by the accepted focused hook and callable-emulator tests.

## Restore and cleanup

- The post-manual reseed command timed out waiting for its Functions-directory readiness sentinel after 180 seconds. Emulator logs then showed function definitions reloaded and `syncUserDirectory` initialized. A separate `perf:verify-fixture` immediately passed at exactly 9,139 documents and SHA-256 `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`, proving the deterministic fixture was restored, including removal of temporary manual documents.
- The owned emulator process tree did not respond to repeated Ctrl+C. The coordinator inspected its exact command-line ancestry, then terminated only PIDs `5860, 8652, 4068, 18112, 12916, 24320, 20864, 4696`; the PTY then exited.
- The normal staging build was restored with `FND_GIT_BRANCH=devs`; `build:staging`, `verify:staging-build`, and `perf:verify-disabled` passed. The build emitted only the existing stale Browserslist warning.
- The generated emulator config was removed. `.firebase.performance.generated.json` and `.perf-emulator-data/playwright-webserver.active` are absent.
- Ports 4000, 4400, 4500, 5000, 5001, 5002, 8080, 9099, 9150, and 9199 were free in two samples.

No deployment, remote Firebase access, commit, push, merge, PR, dependency change, or staging Browser interaction occurred.
