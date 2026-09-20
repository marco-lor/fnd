# Control — Task 10

- Stage/mode: F review accepted; reopened A/10A repair accepted and affected B behavior revalidated. Full diff reviewed with one valid retry finding, now fixed; no remaining code blocker. PR #42 remains the same devs→main publication target.
- Pause: clear. User authorizes review, valid fixes, commits/pushes and updates to PR #42 into main. Merge and production release are outside this request.
- Shared resources: developer and all local tests/builds quiescent. Coordinator owns docs/Git/PR; no developer lease remains. QA data retained.
- Workspace: permanent C:\Users\Marco\OneDrive\git_projects\fnd-devs, branch devs; fresh clean head 31f0fd1df803bc64e4d896f037517b0e977a6ad4, main/base 6f080dbd9bd3f6380242fa0ea66894620d9ad958. No AGENTS.md found. PR open/ready/mergeable; hosted checks passed at intake. Main checkout remains outside write scope.
- Source review, measurement values, release identity, rollback reference and live interaction scope: see plan.md.
- Manual fixtures: four fresh QA10 20260920 R2 catalog items, prices 201/202/203/204, final Forza level1 61/71/81/91. Four-level values, type-specific fields, custom spell cost 8, reductions 2/3 and visibility MarcoDM + MarcoTEST persisted. Search/add/remove, Cancel and saved edits passed for all four.
- Images: original failing panel-pencil path and all four R2 blue→orange replacements passed after full reload. R2 weapon removal passed; its image is absent, other three orange images remain. No fresh console errors. Optional network interruption/duplicate retry was not manually simulated: no browser offline control; automated failure/retry coverage passed.
- Inventory: two fresh R2 weapon copies granted to MarcoTEST; first saved/reloaded Forza=161, second and catalog=61, spell cost 8 and reductions unchanged. Gold stayed 3565. Earlier QA catalog/inventory fixtures and new R2 fixtures retained for review; see plan.md.

## 10A
- Phase: accepted repair; source diff reviewed and fresh combined verification passed.
- Dispatch: attempt 3 / t10a-20260921-03 / canonical /root/task10a_review_high / result received, quiescent; gpt-6-astra high.
- Final writes: editorData.js, editorData.test.js, editorDataParity.test.js; no repository-layer or adapter change. Developer lease released.
- Failures: Light 2/2; High 0/2; last counted attempt 2 / t10a-20260920-02 (cached-null schema retry); earlier attempt 1 draft-reset failure preserved.
- Finding: PR thread PRRT_kwDONsnF3s6kMS8q verified and fixed: getSchema caches null; retry now invalidates item/spell schemas through the existing observer. Restored schema recovery preserves drafts and common caches.
- Latest result: six cases RED then GREEN; focused 4 suites/57 tests passed with real repositories and mocked Firestore. Only editorData.js and its two existing test files changed. Retry evicts item/spell schemas and retains common-data caches; draft/reduction preservation asserted.
- Coordinator gates: full React 169 suites/1,633 tests, performance 491, release 62, bundle contracts 2, query/config/user/media boundaries, hardened staging build and fresh module graph/instrumentation checks all passed; diff-check passed. Exact commands are in plan.md.
- Publication: this repair and acceptance record belong on existing devs/PR #42; coordinator owns commit/push, description and thread reply/resolution. Reconcile current remote head, checks and discussion state from GitHub on resume. No local fix remains.
- Validation limit: retry repair is automated-test/build verified; previous staging version and manual evidence below were not repeated or redeployed for this follow-up.

## 10B
- Accepted: attempt 3 / t10b-20260920-03 / /root/task10b_high / gpt-6-astra high; local and live gates passed.
- Failures: Light 2/2; High 0/2; last counted attempt 2 / t10b-20260920-02. Two observed browser failures count once against that attempt.
- Final repair writes: Bazaar.js routes panel Edit to the existing stable editor; comparisonComponent.js removes duplicate editor; Bazaar.mediaLifecycle.test.js adds 36 cases. No adapter/media/auth change. Lease released.
- Root cause: comparison panel's own editor closes when useBazaarDetail temporarily masks item during catalog refresh from media prepareEntity; toolbar editor already snapshots selected data. Coordinator confirmed both failures used panel pencil.
- Evidence: four-type RED reproduced; focused 24 suites/226 tests; full React 169/1631; independent lifecycle rerun 36/36; source review and diff-check passed. Failed-save/retry, completed-root reuse, account/access/role/unmount and next-item tests covered. No blocker in code review.

## Earlier staging gates (2026-09-20)
- Fresh React 169 suites/1631 tests, independent lifecycle 36/36, performance 491/491, release contracts and query/config/user/media boundaries passed. Fresh bundle contracts 2/2 and module graph passed; all 63 JS assets match release; instrumentation absent.
- Sandbox process/config restrictions resolved with required permissions, no implementation failure counted; temporary owned process trees and state cleaned up.
- Repair deployed: version 66b4a5ede1c2f830, release 1789916321303000 (14:58:41.303 UTC), main.f6c353d9.js (669447 bytes) SHA-256 dca00dc3edd8e3ae8379d7552444e6a7b995230ae74fbd6730b531afb9f5f93c matches served file. CLI required NODE_OPTIONS=--use-system-ca; existing login valid, second guarded release succeeded. Browser reloaded new main.
- Final browser state: Bazaar filtered to QA10 20260920 R2, editor closed, tab marked deliverable. All six required scenarios passed on the new release. No further product edits followed automated verification/deployment.
- Task 09's separate outstanding performance gates are unchanged.
