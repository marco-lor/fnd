# Control - Step 11

- Stage: repair source, local gates and affected staging interactions accepted. Coordinator publishes PR43 repair and verifies GitHub checks; current remote status is tracked on https://github.com/marco-lor/fnd/pull/43.
- Pause: clear. User authorized "keep going until green", then diagnosis/fix/update of PR43. Continue reviewed Astra High repairs if needed, retaining counters and gates.
- Workspace: permanent fnd-devs/devs. Original implementation commit63fe9cd; main checkout50d7bc8 remains clean/unchanged. Protected Step10 hashes in plan match and those files stay outside commits.
- Resources: all developers, tests, builds and emulator processes quiescent; leases released. Coordinator owns docs, GitHub and staging/browser actions. No merge or production deployment authorized.
- Blockers: none in reviewed source/local/staging gates. Four advisory performance target classes remain unmet: initial collections, INP, CLS and Grigliata long-task duration. All34blocking comparisons pass.

## 11A accepted repair
- Developer /root/task11_dashboard, gpt-6-astra/high; attempt5/token11A-20260926-05. Failures Light0/High4; last counted attempt4/token11A-20260926-04. User overrode automatic stop.
- Fixed query-contract registration and browser fixture preparation/accounting. Guarded backfill supports production; Dashboard prefix bounds cover Unicode, UIDs reconcile without delimiter collisions, and optional transactional floorAtZero preserves Dashboard vital semantics and other callers.
- Final checks exit0: perf:test495; five boundary/query gates(47listeners/16query shapes/10indexes); Jest175suites/1664tests; setup/backfill33; Task11Firestore7; Functions build117/lint; performance build/disabled verification; Chromium28/28 and34/34blocking comparisons; Firefox/WebKit6/6 with background35->35. Windows cleanup probes pass elevated; isolated timing failures resolve in the quiescent full run without test/timeout changes.
- Fixture9139/hash fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8 unchanged. Setup verifies200summaries; readiness32/150Chromium and35/150cross-browser. Measurement zero-growth gate retained.
- SDK serialized bytes4405/576237/601815 and11/16/26listeners at0/1/3 expansions unchanged; collapse11 with0detail/dice, unmount0, full catalog0. Projection5r/<=1w; atomic bulk2level/3lock additional reads+<=1summarywrite; marked events0r/0w.
- Repair staging release: functions:task05UpdateResource then Hosting, both exit0. Function source SHA25662ADFE0885A06401E2B9C43CD7E36254548DA84305AB8E271604CC5C3250E04D. AppCheck, directory12/12 and callable policies41+5 green.
- Hosting versionc94ad381d78f6b61, release1790448231017000 at2026-09-26T18:43:51.017Z; main.b6252120.js observed in Codex Browser. Rollback version12127e32489f2cee/main.d43a8b41.js; earlier releases in plan.
- DM Browser passed normalized/no-match search/recovery, detail expansion and release on page change. Task08QA HP28 minus100 became0; further HP/essenza decrements stayed0; HP restored28, mana61 and essenza0 retained. Console[], canonical summaries12/12verified after restoration. Proof: frontend/performance-results/task11-dashboard-pr43-staging.png.

## 11B accepted
- Developer /root/task11_admin, gpt-6-astra/high; attempt2/token11B-20260926-02. Failures Light0/High1; last counted attempt1/token11B-20260926-01.
- 200-user fixture before2requests/200rows/25724serializedB/403modeled reads; after1/10/1402B/22; all20pages reachable. Legacy100/UID contract retained; webmaster-only v2 five-field NFKD-prefix/composite cursor verified, including D7FF->E000 and malformed Unicode rejection.
- Deletion retains cleanup/permanent tombstone, actor/request receipts/status/resume, target lease,50s cooperative deadline, generation fences and drained in-flight groups. Legacy/retry/duplicate/failure cases pass.
- Prior local gates and separate deletion/query/role releases accepted. Webmaster Browser verified10+2users, stable paging, normalized/no-match search, self-action disabling, exact delete-confirmation/cancel and reload. No live deletion/role change; console[]. Evidence in plan and frontend/performance-results/task11-admin-staging.png. Affected combined frontend/browser checks pass above.

## C combined evidence / review
- Unchanged525-user gate passed: level232.696s/525success+2skip, lock86.641s/526success+1skip; both527processed/0failed with replay/exact summaries. Existing240s threshold/triggers retained; scheduler unchanged by repair.
- /root/task11_projection_review, AstraHigh token11B-review-01: Unicode blocker fixed; no remaining deletion/auth/receipt/lease/shared-bulk blocker. Coordinator verified and repaired all four PR review findings. No outstanding source owner/process.
