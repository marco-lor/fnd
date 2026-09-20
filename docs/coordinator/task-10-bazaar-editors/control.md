# Control — Task 10

- Stage/mode: complete / A–E accepted. PR #42 is open from devs into main and attached to this task; GitHub checks started and remain separate from the passed local/staging gates.
- Pause: clear. User explicitly authorizes committing, pushing and creating the PR into main, following accepted staging deployment/manual tests. Merge and production release are outside this request.
- Shared resources: all developers/processes quiescent; coordinator owns build/tests, docs, staging release and IAB tab 1. Preserve unrelated data; retain QA fixtures.
- Workspace: permanent C:\Users\Marco\OneDrive\git_projects\fnd-devs, branch devs, implementation base 6f080dbd9bd3f6380242fa0ea66894620d9ad958. Reviewed implementation committed/pushed as 565628341b52d5a229b0439afddfa3c29fe57db8. Coordinator owns Git/PR mutations; no developer lease remains.
- Source review, measurement values, release identity, rollback reference and live interaction scope: see plan.md.
- Manual fixtures: four fresh QA10 20260920 R2 catalog items, prices 201/202/203/204, final Forza level1 61/71/81/91. Four-level values, type-specific fields, custom spell cost 8, reductions 2/3 and visibility MarcoDM + MarcoTEST persisted. Search/add/remove, Cancel and saved edits passed for all four.
- Images: original failing panel-pencil path and all four R2 blue→orange replacements passed after full reload. R2 weapon removal passed; its image is absent, other three orange images remain. No fresh console errors. Optional network interruption/duplicate retry was not manually simulated: no browser offline control; automated failure/retry coverage passed.
- Inventory: two fresh R2 weapon copies granted to MarcoTEST; first saved/reloaded Forza=161, second and catalog=61, spell cost 8 and reductions unchanged. Gold stayed 3565. Earlier QA catalog/inventory fixtures and new R2 fixtures retained for review; see plan.md.

## 10A
- Accepted attempt 2 / token t10a-20260920-02 / canonical /root/task10a / gpt-6-astra low.
- Failures: Light 1/2; High 0/2; last counted attempt 1 / t10a-20260920-01 (draft-reset regression corrected).

## 10B
- Accepted: attempt 3 / t10b-20260920-03 / /root/task10b_high / gpt-6-astra high; local and live gates passed.
- Failures: Light 2/2; High 0/2; last counted attempt 2 / t10b-20260920-02. Two observed browser failures count once against that attempt.
- Final repair writes: Bazaar.js routes panel Edit to the existing stable editor; comparisonComponent.js removes duplicate editor; Bazaar.mediaLifecycle.test.js adds 36 cases. No adapter/media/auth change. Lease released.
- Root cause: comparison panel's own editor closes when useBazaarDetail temporarily masks item during catalog refresh from media prepareEntity; toolbar editor already snapshots selected data. Coordinator confirmed both failures used panel pencil.
- Evidence: four-type RED reproduced; focused 24 suites/226 tests; full React 169/1631; independent lifecycle rerun 36/36; source review and diff-check passed. Failed-save/retry, completed-root reuse, account/access/role/unmount and next-item tests covered. No blocker in code review.

## Final gates
- Fresh React 169 suites/1631 tests, independent lifecycle 36/36, performance 491/491, release contracts and query/config/user/media boundaries passed. Fresh bundle contracts 2/2 and module graph passed; all 63 JS assets match release; instrumentation absent.
- Sandbox process/config restrictions resolved with required permissions, no implementation failure counted; temporary owned process trees and state cleaned up.
- Repair deployed: version 66b4a5ede1c2f830, release 1789916321303000 (14:58:41.303 UTC), main.f6c353d9.js (669447 bytes) SHA-256 dca00dc3edd8e3ae8379d7552444e6a7b995230ae74fbd6730b531afb9f5f93c matches served file. CLI required NODE_OPTIONS=--use-system-ca; existing login valid, second guarded release succeeded. Browser reloaded new main.
- Final browser state: Bazaar filtered to QA10 20260920 R2, editor closed, tab marked deliverable. All six required scenarios passed on the new release. No further product edits followed automated verification/deployment.
- Task 09's separate outstanding performance gates are unchanged.
