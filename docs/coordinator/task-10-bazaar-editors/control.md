# Control — Task 10

- Stage/mode: G production release and H production manual acceptance complete. PR #42 merged at 50d7bc897957ff9e31b0775363b63ff75d7a1508; all applicable PR checks passed. Merge tree equals tested head 93a393802b4a4fc70c5d509bbf43eaef04ea6db1.
- Pause: clear. User explicitly authorized fatins production deployment and the six referenced fatin-test scenarios, signed in as MarcoDM, and enabled Chrome file uploads.
- Resources: developers and local test/build processes quiescent; no outstanding lease or code fix. Coordinator performed deployment and browser testing. Only plan/control records changed during production work.
- Workspace: clean fnd/main at 50d7bc8 for release. Coordinator records remain in permanent fnd-devs/devs at 93a3938 as local documentation edits. No new worktree; no AGENTS.md found.
- Release: version 98d2d3493c2ddb8b, release 1789947884195000, 2026-09-20T23:44:44.195Z. Guarded App Check, 11/11 unchanged directory projections, build and Hosting deployment passed. Served index and main.01e61077.js match the production build; browser loaded that bundle; instrumentation absent. Rollback version 8a109cbd2f7567bb.
- H: all six required manual scenarios passed. Four QA10 PROD 20260921 catalog records retained, prices 201/202/203/204, final Forza level1 61/71/81/91. Four-level parameters, type fields, custom spell cost 8, reductions 2/3 and MarcoDM + MarcoTEST visibility persisted. Search/add/remove, nested draft retention and Cancel/save passed for each type.
- Images: blue QA A saved for all four with additional image-retention custom spells; all four blue→orange QA B replacements visually verified after reload. Weapon image removal persisted; other three orange images remain. No captured browser application errors at final checks.
- Inventory: two production QA weapon copies granted to MarcoTEST. After reload first copy Forza=161, second=61, catalog=61; other parameters/reductions/spell cost retained. Gold stayed 3565. No unrelated records changed.
- Browser left on production Bazaar filtered to QA10 PROD 20260921, editor closed and marked deliverable. Optional manual network interruption was unavailable; automated retry coverage is separate evidence. Task 09's outstanding performance gates remain unchanged.

## 10A
- Accepted: attempt 3 / t10a-20260921-03 / /root/task10a_review_high / gpt-6-astra high; result received, quiescent, lease released.
- Failures: Light 2/2; High 0/2; last counted attempt 2 / t10a-20260920-02, cached-null schema retry. Earlier attempt 1 draft-reset failure retained.
- Repair: editorData.js and two existing test files invalidate item/spell schemas on retry, preserving common caches and initialized drafts. Six real-cache cases RED then GREEN; focused 4 suites/57 tests. PR discussion PRRT_kwDONsnF3s6kMS8q fixed/resolved, repair published as 93a3938 and merged.

## 10B
- Accepted: attempt 3 / t10b-20260920-03 / /root/task10b_high / gpt-6-astra high; quiescent, lease released.
- Failures: Light 2/2; High 0/2; last counted attempt 2 / t10b-20260920-02. Earlier stale boundary assertion and later live media-lifecycle failure retained.
- Repair: Bazaar comparison-panel edit uses the stable editor snapshot; duplicate panel editor removed. Four-type RED reproduction and 36 lifecycle regressions cover media/account/cancel/retry behavior. No backend/schema change.

## Verification and earlier staging
- Final PR gates: React 169 suites/1,633 tests, performance 491, release 62, bundle contracts 2, query/config/user/media boundaries, hardened build, module graph/instrumentation and diff-check passed.
- Earlier staging version 66b4a5ede1c2f830 passed all six manual scenarios with QA10 20260920 R2 fixtures. Staging release identity, metrics and retained data remain in plan.md; production evidence is separately recorded there.
