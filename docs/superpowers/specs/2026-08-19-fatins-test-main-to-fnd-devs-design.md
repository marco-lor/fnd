# Fatins-Test Main to FND Devs Production Port Design

Date: 2026-08-19  
Target repository: `fnd`  
Target branch: `devs`  
Design status: approved in chat; written specification awaiting user review

## Objective

Safely incorporate the newer, production-relevant developments from
`fatins-test/main` into `fnd/devs`, deploy the resulting Fatins production
frontend, verify it with automated and logged-in browser checks, push the exact
deployed revision to `origin/devs`, and remove every temporary local or cloud
test artifact created for the update.

The port must preserve the existing Fatins Firestore data and production
bindings. A data migration is permitted only if a reviewed source/schema change
proves one is required. The current source analysis proves no migration or
non-Hosting Firebase deployment is required.

## Authoritative Anchors

- FND production baseline and target base:
  `c5ead60ce1dc63489176aade057f15ded6fad7fb`.
- Fatins-test last verified production-aligned baseline:
  `b652b69544526b3ebdc078e52836dffda6411064`.
- Fatins-test source tip:
  `296eeca60fc3d1ec8b3bde535a325f7683348140`.
- Source range: 14 commits and 58 changed paths from the aligned baseline to the
  source tip.
- The repositories have unrelated Git histories. Git ahead/behind counts,
  cross-repository merges, and direct cherry-picks are therefore not valid port
  mechanisms.

These hashes are immutable source-code scope anchors. The required design-doc
commit may advance `devs` without changing its application tree. If the
Fatins-test source tip or the FND application tree changes before implementation
begins, repeat the three-way analysis and obtain review for any material scope
change.

## Chosen Approach

Use a semantic three-way port in an isolated, ignored worktree checked out on
`fnd/devs`:

1. Treat the Fatins-test aligned baseline as the semantic ancestor.
2. For each changed path, inspect `baseline -> fatins-test/main` and apply that
   intent to the current production file.
3. Copy a file byte-for-byte only when the current FND file is byte-identical to
   the aligned baseline and the file contains no environment-specific binding.
4. Manually merge files with production drift or environment-sensitive values.
5. Port tests before, or in the same narrowly scoped change as, the behavior
   they prove.
6. Keep each port group independently reviewable and run its focused tests
   before proceeding.

This avoids importing test-project history or silently replacing production
configuration. A raw tree copy, force merge, or test-to-production data copy is
forbidden.

## Port Scope

### Runtime behavior

- App/bootstrap and login module isolation improvements in `frontend/src/App*`,
  `frontend/src/components/Login*`, and the Firebase configuration tests.
- Catalog query batching/caching improvements in
  `frontend/src/data/catalogItemRepository*`,
  `frontend/src/data/useCatalogItemsById*`, and the query contract.
- Grigliata render scheduling, geometry readiness, media deferral, and music
  behavior in the changed Grigliata components, hooks, and tests.
- Performance runtime instrumentation changes required to measure the new
  behavior without contaminating production runtime behavior.

### Performance and release evidence

- The changed Task 07 performance harness, deterministic fixtures, comparison,
  repeatability, report, baseline-source, and browser scenario files.
- The relevant performance workflow changes, preserving production release
  guards and demo-project isolation.
- Documentation updates rewritten for Fatins production context where needed.

### Explicit exclusions and manual merges

- Do not copy
  `docs/performance-improvement-plan/task-07/fatin-test-closure-2026-08-16.md`.
  It is test-environment closure evidence, not production evidence.
- Merge `frontend/package.json` manually. Add the new
  `scripts/performance/baseline-source.test.js` entry to `perf:test` while
  retaining every Fatins-specific script, guard, and binding.
- Preserve all Fatins project IDs, Firebase web configuration, App Check setup,
  Hosting target, storage bucket, callable regions, and release guards. No
  `fatins-test` identifier may remain in executable production configuration.
- Demo performance fixtures must remain bound to `demo-fnd-perf`; they must
  never target `fatins` or contain copied test-project data.

## Firebase and Data Safety

The source range changes none of these planes:

- `frontend/functions`
- Firestore rules or indexes
- Storage rules
- `firebase.json`
- backend maintenance code

The source range also adds no production write API calls. Therefore:

- No Firestore migration will run.
- No Firestore, Functions, Storage rules, index, or backend deployment will run.
- The authorized production release plane is Hosting only.

Data-safety procedure:

1. Retain the already validated read-only preflight export while work is in
   progress.
2. Immediately before deployment, confirm no active Grigliata presence/session,
   then take and validate a fresh recursive production Firestore export with
   the repository backup reader.
3. Record its canonical hash, document count, root collection count, and file
   checksum without exposing document contents, user IDs, or credentials.
4. Run all migration tools in planning/audit mode only. The expected result is
   a no-op; never pass an execution flag.
5. Preserve the dormant production Grigliata turn cursor and active-background
   state exactly as stored.
6. After deployment, take a second read-only export and compare canonical
   hashes. Investigate any drift; never overwrite legitimate concurrent user
   activity and never restore automatically.

If implementation analysis discovers a schema-plane or write-contract change,
stop. Amend this specification with a reversible, new-only migration and obtain
new approval before any production write.

## Implementation Workflow

Implementation begins only after the user approves this written specification.

1. Work exclusively in the isolated `fnd/devs` worktree.
2. Confirm both repositories and all relevant refs are clean and anchored to the
   hashes above.
3. Port in the following review groups:
   - test and harness foundations;
   - app/login/Firebase module isolation;
   - catalog query behavior;
   - Grigliata scheduling and media behavior;
   - workflow, documentation, and package-script adaptation.
4. For each behavior group, first run the source tests against the unported
   production behavior where practical, observe the expected failure, then add
   the minimal production-safe implementation and make the focused tests pass.
5. Review the final diff for environment identifiers, write APIs, deployment
   planes, data contracts, and accidental generated files.
6. Commit the implementation locally only after all local gates pass. The commit
   must be the exact source used to build and deploy.

No unrelated refactor, dependency upgrade, or production-data cleanup is part
of this port.

## Verification Matrix

All checks must run from the isolated production worktree with supported local
environment overrides confined to ignored paths.

### Static and unit gates

- Full React/Jest suite in CI mode with Watchman disabled.
- Focused Task 07 Node and Jest gate.
- Functions build and all Functions tests.
- Functions lint: zero errors; the five recorded baseline warnings may remain
  only if the changed lines do not introduce or worsen them.
- Backend health/maintenance and Firestore backup-reader tests.
- `npm run perf:test` with the local `XDG_CONFIG_HOME` override.
- `npm run release:test`.
- Query, callable-registry, shared-config, user-data, media-boundary, and
  Firestore-import checks.

### Build and integration gates

- `npm run build:production`.
- `npm run verify:production-build`.
- Owned demo Firebase emulator rules/callable suite with every configured port
  free before and after the run.
- Authoritative performance and repeatability checks against `demo-fnd-perf`.
- Task 07 media integration, cross-browser smoke, and the checked-in bounded
  lifecycle soak using the production-adapted source.
- Confirm the resulting bundle contains Fatins production bindings and contains
  no Fatins-test or emulator bindings.

Any failure is a blocker. Diagnose the root cause, add a regression test for a
code defect, fix it, and rerun the failing gate plus the complete matrix. Do not
waive failures as flaky without reproducible evidence and a deterministic fix.

### Live Browser acceptance

Use the explicitly selected in-app Browser and the already logged-in test
account. Do not inspect cookies, passwords, tokens, private account data, or
unrelated user content.

Verify:

- authenticated Home renders after a fresh production navigation;
- lazy routes load without stale-chunk or console failures;
- catalog/Bazaar queries resolve and render correctly;
- Grigliata shell, board geometry, background readiness, token media, and music
  controls render without new runtime errors;
- route transitions do not regress login state or module initialization;
- the served asset hashes match the locally verified production build.

Prefer read-only navigation. If entering Grigliata creates an ephemeral presence
record, confirm it is the test account's record and obtain the required
action-time confirmation before triggering its deletion on navigation/cleanup.
Do not create gameplay, catalog, billing, or other persistent production data.

## Deployment and Rollback

Deployment preconditions:

- all validation gates pass;
- the final recursive backup validates;
- no active live session is detected;
- local `devs` is clean at a recorded commit;
- the production build maps to that exact commit;
- Firebase CLI identity, project, and Hosting target resolve to `fatins`;
- certificate handling uses only the PC trust store and an ignored temporary CA
  bundle whose contents are never logged.

Deploy only Hosting to project `fatins`. Capture the Firebase release result and
verify the live bundle directly. Do not deploy with an unqualified command.

Keep the prior production commit/build and final pre-deploy backup available
until live acceptance passes. For a frontend regression, redeploy the prior
known-good Hosting build. A Firestore restore is never an automatic rollback;
it requires a separate review because it could overwrite legitimate writes.

## Publish and Exact-Revision Evidence

After live acceptance:

1. Confirm the deployed local commit is still clean.
2. Push `devs` to `origin/devs` without force.
3. Verify local `devs`, `origin/devs`, and the deployed build evidence identify
   the same revision.
4. Verify applicable GitHub Actions checks for that exact SHA. A green run for a
   different SHA is not evidence.
5. Recheck production health after the push.

## Cleanup

After deployment, Browser acceptance, exact-SHA CI, and post-deploy data checks
all pass:

- remove the isolated Git worktree and prune its Git metadata;
- remove worktree-only dependencies, build output, Playwright output, test
  results, local Firebase state, temporary config homes, Python environment,
  uv/npm caches, temporary CA bundle, and all generated logs;
- remove the preflight and final local backup exports once rollback is no longer
  needed, as requested, and report that they are no longer recoverable locally;
- remove any test-account presence record or other ephemeral cloud artifact with
  the required action-time confirmation;
- verify the primary FND checkout and the Fatins-test checkout are clean;
- verify only the primary FND worktree remains.

Cleanup must use exact resolved paths. No recursive deletion may target the
workspace root, repository root, user profile, or an unresolved variable.

## Stop Conditions

Stop before deployment or data mutation if any of these occurs:

- reviewed source-range drift or FND application-tree drift outside this design
  document;
- a schema, write-contract, Firebase plane, or production binding difference not
  covered here;
- a failed or unverifiable backup;
- active users or a live Grigliata session;
- unresolved test, build, emulator, performance, or Browser regression;
- Fatins-test data or identifiers in a production executable artifact;
- an unexpected dirty tree or remote divergence;
- a deployment command that would affect more than Hosting.

## Completion Criteria

The work is complete only when all of the following are evidenced:

- every approved production-relevant source change is ported, with exclusions
  documented;
- no migration was needed, or a separately approved migration completed with
  reversible evidence;
- pre/post production data checks show no unexplained loss or mutation;
- the complete local validation matrix passes;
- Fatins Hosting serves the exact verified build and logged-in Browser acceptance
  passes without regression;
- the exact deployed commit is present on `origin/devs` with applicable CI green;
- `main` remains unchanged;
- all temporary local worktrees, environments, caches, certificates, backups,
  builds, reports, logs, and cloud test artifacts created for this update are
  removed.
