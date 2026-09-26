# Control - Step 11

- Stage: complete. A, B and C coordinator-accepted on 2026-09-26; agreed local, staging and Browser gates green.
- Pause: clear. User authorized "keep going until green"; retain counters and gates, continue Astra High repairs if needed.
- Workspace: permanent fnd-devs/devs; baseline HEAD93a393802b4a4fc70c5d509bbf43eaef04ea6db1. Main checkout clean/unchanged; protected Step10 hashes in plan match.
- Resources: all three developers quiescent; leases released. Coordinator tests/emulators/deployments exited; ports free. Existing user browser remains open.
- Blockers: none. Final Admin gate passed; Browser tab1 remains on Admin page1. User now requested a PR: coordinator authorized to commit/push Step11 on devs and open against main. Pre-existing Step10 notes stay uncommitted. No merge, production deployment, live deletion or privilege changes authorized.
- Staging: Hosting version12127e32489f2cee, release1790430723912000 at2026-09-26T13:52:03.912Z; main.d43a8b41.js observed in browser. B rollback: versioneddc5f553a82815d/main.a1c03181.js; pre-A66b4a5ede1c2f830/main.f6c353d9.js.

## 11A accepted
- Developer /root/task11_dashboard, gpt-6-astra/high; attempt4/token11A-20260926-04. Failures Light0/High3; last counted attempt3/token11A-20260926-03; user overrode automatic stop.
- Gates: Node27, Firestore5, build115, lint/diff and Jest15/90; reviewed scheduler/summary source. Initial525 level206.082s/lock113.542s receipts,0failed; repeated combined result below.
- Measurements: SDK serialized payload4405/576237/601815B;11/16/26 listeners at0/1/3 expanded. Collapse11 with0detail/dice; unmount0; full catalog0. Projection5r/<=1w; atomic bulk2level/3lock reads+<=1summarywrite; marked events0r/0w. Gold4r/2w,token5r/2w before retry.
- Released separate bulk3functions, summary2triggers/progression/deleteUser/rules, fingerprinted backfill and Hosting. Backfill b630dfd94083080f79ec216bd52ba9eecc4bc8de9d02d8bcf9c6ba94ea1c0273:9sets/0deletes/3unchanged. Final canonical verify12/12 after restored mutations; recovery artifacts frontend/performance-results/task11-staging-{dry-run,checkpoint,verify}.json.
- Browser passed search/selection/max3/collapse/lazy catalog and restored gold3565->3566->3565,combat42->43->42,base lock true->false->true; grant/bulk confirmations cancelled. Latest B reader regression search/detail/collapse pass;9collapsed/0expanded,console[],direct/admin redirects DM to/home. Screenshot frontend/performance-results/task11-dashboard-staging.png.

## 11B accepted
- Developer /root/task11_admin, gpt-6-astra/high; attempt2/token11B-20260926-02. Failures Light0/High1; last counted attempt1/token11B-20260926-01.
- Scope: Admin/client/query/role/delete/tests; shared operation changes only delete-user kind/status/resume and optional progress callback. Accepted A scheduler preserved.
- 200-user fixture: before2requests/200rows/25724serializedB/403modeled reads; after1/10/1402B/22,20pages reachable. Targets<=1/10/1800B/22. Legacy100/UID callable retained; v2 private five-field NFKD-prefix/composite cursor verified. Unicode D7FF->E000 and malformed surrogate rejection repaired.
- Delete adapter retains cleanup engine/permanent tombstone; Task06 actor/request-bound receipts/status/resume, target lease, cooperative50s deadline and generation fences. RPC groups drain before release; in-flight idempotent calls may settle after lease loss. Legacy/retry/duplicate/failure cleanup tested.
- Gates: Jest5/68,Node25,deletion callable; repair build117/Node27/6rules+Admin callable (12Unicode matches/4pages,2unrelated excluded). Coordinator combined Jest7/32+Node37 green. Focused lint/diff and final staging-build verification pass; userDataV2 SHA256580EF4299AE6460BA5B3A515353EDF582F9B559174BBF382DE562B5D0B76DCD8.
- Released separately deletion/status/resume, then query/role, then Hosting; all exit0. AppCheck/directory12/12/callable policies41+5 green; no B rules/index/backfill. Existing Task06 legacy owner config retained.
- Browser: exact deployed build confirmed;10+2 users across2pages,12distinct, stable previous-page recovery. Search normalizes case/accents/space; no-match and clear recover correctly. Self-role/delete disabled. Delete button disabled for empty/wrong-case text, enabled for ELIMINA; cancelled, target/role retained. Direct/admin reload restored10rows; console[]. Proof frontend/performance-results/task11-admin-staging.png.

## C final combined evidence / review
- Coordinator525 gate exit0: level232.696s/525success+2skip;lock86.641s/526success+1skip. Both527processed/0failed, replay/exact summaries pass;6rules+2Functions tests green. Threshold240s/fixture/triggers unchanged. Paging unit tests cover partial checkpoint/pause/crash/replay; no further scaling change.
- Reviewer /root/task11_projection_review, gpt-6-astra/high, token11B-review-01: one Unicode blocker confirmed and fixed; no remaining deletion/auth/receipt/lease/shared-bulk blocker. Quiescent/no resources.
