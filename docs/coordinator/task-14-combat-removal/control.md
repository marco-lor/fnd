# Control - Step 14

- Stage: 14G complete. Local, staging, independent review, production and restoration gates accepted; pause clear.
- Workspace: permanent C:/Users/Marco/OneDrive/git_projects/fnd-devs on devs. Production release used merged main ac106e7e21d9ce953c1428e47a174e9b95aa9bdb and the identical reviewed patch. Git closeout authorized on2026-10-04: commit this fix and coordinator records, then align local main/devs and origin/main/origin/devs to the same descendant commit through fast-forwards and an atomic push. No force push or new PR.
- Authority: user requested fix -> staging/manual -> independent review -> production/manual. Only test DM and owned fixtures changed; other players/inventories/resources protected. No IAM or auth changes.

## Accepted implementation / review
- Developer /root/task14g_rules_budget_resume, attempt3/token14G-20261003-03, Sol6.1/xhigh/priority user lock; failures1/2 (last counted attempt2/token14G-20261003-02). Source/test/runtime lease released, quiescent.
- Rules narrowly validate DM turn patches, preserving role/identity/current-after token/deletion boundaries; client writes only tokenId/counter/effects/metadata. Changed effects fully validated0-12; unrelated unchanged stored fields trusted. General creates retain schema; owner unchanged effects skip retraversal.
- Fresh checks: 14G25+Task06 6=31/31, client4suites212/212, harness22/22, existing Firestore and media rules12/12 pass. Full runner exits1 on unchanged Admin-only nested media trigger (attached vs superseded after90s,2/3); no causal link to changed rules/client. Later unrelated callables were not reached.
- Fresh reviewer /root/task14g_fresh_reviewer, token14G-REVIEW-01, Sol6.1/xhigh/priority, fork none: no actionable findings; independently25/25 and diff check pass, exact hashes verified. No edits/live actions; probes/processes cleaned.
- Frontend patch SHA2564f357c404c6fea82d123e9a24e90b51944f8b2c7cfeafdea27a4b99da745557c (tracked frontend binary diff + sorted untracked paths/bytes). Rules SHA2566a0b411ac6a0a457c6c365d1d8a9b27e18dcff9db0500413e7816baf66529a15.

## Releases and manual acceptance
- Staging rules ce4f4b37-a9b6-4b19-bcfa-72de1695da48; Hosting ce7862c41d85d789/release1791063003337000, main.7b629ba0.js. Production rules8458e4cf-70ab-4aa9-b7d9-a7890a06b96c; Hosting e48c57df92277775/release1791063703693000, main.ea9a3f05.js SHA5a123c18e11a756c735480028621da7d8627644f6d26c963f77344acc7a45c90. Published sources/assets match builds; Grigliata chunk7f58e14f SHA603602680614612e8fe6023f0e792560227a0bfcecc0185d973cc03cc113b575. AppCheck8/8 each; directory12/12 staging,11/11 production, zero writes. Functions unchanged.
- Both live browsers passed2and12effect start1->advance2->expiry3, duration retention on first activation, shield5->0, HP13/Mana23 stable, reload persistence, clean console. Initial staging fixture had invalid imageSource template; coordinator corrected only fixture to uploaded and repeated complete sequences successfully.
- Test DM hOmn5SAsF0c3OtQWkmM7qNnfj1o2. Staging19original hashes restored/2fixture docs removed. Production12original hashes restored/2fixture docs removed; original active map ETkmG1KTE9DuYbCseOjt restored, test map hBkVsVtaZNB5n8PzHNiL empty, no new fog. Stable after Home/fullreload, guarded cleanup and Grigliata reentry.
- Recovery: ignored frontend/performance-results/task14g-fatin-test-restoration.json and task14g-fatins-restoration.json. Preserve earlier restoration snapshots. Evidence: C:/Users/Marco/.codex/visualizations/2026/10/02/01a0fe66-0c72-74c2-87ea-b96be62a8d5a/task14g-{staging,production}-verified.png. IAB id2/tab1 staging user-owned; recreated production tab2 marked deliverable, original map/Tokens.
- Rollback identities: staging old rules1cd41f5e-5449-4ccc-bd04-567117ea32f8/Hosting5147b30310283aae; production old rulesfbeb893e-368c-42eb-a3c3-74cf4f7fd499/Hosting5ac4d53098cdb0ba.

## Remaining known limits
- Pre-existing full12-effect general create/write budget, concurrent DM nontransactional advance and placement-only parent-pending semantics remain outside this fix. Earlier14F exact lost-response authenticated API replay remains unverified; no credential/IAM workaround used.
- Release14G complete; final local diff/hash/process reconciliation passed. Git closeout source check confirms the exact reviewed frontend patch; no additional product edits or repeat deployment required. Recovery snapshots remain ignored and outside the commit.
