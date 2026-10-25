# Task15A Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. User explicitly delegates implementation/release choices; continue without extra approval menus.

**Goal:** Deliver and verify Task15A on fatin-test and fatins without regressing existing gameplay or production data.

**Architecture:** Reproducible static map variants feed a geometry-stable picture component with controlled activation/fallback. Local tooltip/layout repairs preserve accessibility. Requested-path HTML caching and bounded previous-asset retention preserve SPA navigation across deployments.

**Tech Stack:** React 18/CRA, Sharp, Jest/Testing Library, Node tests, Playwright, Firebase Hosting guarded release wrappers.

**Spec:** docs/superpowers/specs/2026-10-25-task15a-finalization-design.md

## Global Constraints

- Scope Task15A only; Task15B/15C data ownership, query redesign and virtualization are excluded.
- Cold modern map bodies total <=4,466,801 bytes; originals total14,889,339 bytes. Preserve all labels and exact aspect ratios.
- Artistica2816x1536; Dettagliata2752x1536; lower map activation margin320CSSpx; marker error<=1CSSpx.
- No App Check debug tokens or protection changes for15A acceptance; ordinary session proof remains distinct from automated tests.
- Actualdevs->fatin-test and actualmain->fatins with existing release guards. No spoofed branch identity or backend/data migration.
- New high-entropy owned QA sources/accounts only; preserve every original production document.
- Every PR opening/update: record timestamp/deadline, wait15minutes, then inspect all comments and address findings before merge. Any further update restarts interval.
- After every test deployment run all affected manual checks; production promotion follows full staging acceptance.
- Report unverified required surfaces accurately; no physical/Safari claims from Linux emulation.

## Review Focus

- WebKit may request PNG before picture sources: real network request counts must show no fallback duplication.
- Picture decode failure needs explicit format advance and terminal stop; test HTTPsuccess/corrupt bytes and finalPNGfailure.
- Images must not change the overlay coordinate rectangle on hover, activation, resize or fallback; measure edges/center.
- Fresh oldHTML can outlive new cache headers, and oldmain can fail before new recovery code executes; retain real previousassetbytes and test different hashes with normalcache.
- Portaled popup focus/scroll and 200% zoom can hide controls/lastNPCnotes; verify wholepage and keyboard behavior.

### Task 1: Responsive map delivery

**Files:** Create frontend/scripts/maps/generate-maps.js, check-maps.js, associated Node tests; frontend/src/assets/images/maps/generated variants/manifest; frontend/src/components/echiDiViaggio/EchiMapPicture.js and .test.js. Modify frontend/package.json/lock and EchiDiViaggio.js map wrappers.

**Interfaces:** EchiMapPicture({mapId, alt, eager=false, children, className, ...surfaceEvents}) owns the exact coordinate surface and renders children overlays; supports art/precisa. Manifest records original SHA256/dimensions and each variant dimensions/bytes/SHA256. maps:generate regenerates, maps:check validates content/decode/budget and manifest.

- [ ] Add failing component tests for eager/lazyactivation,320pxIO, noURLs beforeactivation, noIOfallback, orderedformatfailureandterminalerror,cleanupandreservedgeometry.
- [ ] Add failing generator/check tests for missing/tampered/wrongaspect assets and bytes.
- [ ] Generate exact-ratio responsive sizes at1/4,1/2,full master dimensions inAVIF/WebP; choose quality from measured readability/budget, record values. PinSharpdevdependency.
- [ ] Implement picture atomically; verify realWebKit no duplicatefallback; remove image-onlyhover scaling; keepdrag/markerhandlersonthecoordinate surface.
- [ ] Run maps:check, focusedNode/Jest and baseline Echi/MapEditor/NpcSidebar tests. Self-review and commit. Independent task review before marking accepted.

### Task 2: Zoom and tooltip usability

**Files:** Modify EchiDiViaggio.js, NpcSidebar.js and focused tests; create small local positioning helper/component and tests if necessary.

**Interfaces:** Preserve existing public/private marker/NPC command contracts. Popup position uses current viewport, boundedwidth/height, scrollablecontent, trigger+popupfocus/pointerownership andEscape; marker coordinate wrapper remainsownedbyTask1.

- [ ] Write regressions for narrowviewport tooltip bounds, focus moving into popup, Escape, marker accessibility and popup clipping.
- [ ] Implement local viewport/focus/layout repairs; boundsidebarheight underlg. Do not change subscriptions/query/counts.
- [ ] Run relevant frontend tests and browser wholepage200%zoom/edges/lastnotes checks. Self-review, commit and independent task review.

### Task 3: SPA release cache continuity

**Files:** Modify frontend/firebase.json and release pipeline files as justified; frontend/src/runtime/staticChunkRecovery.js only if boundedrecovery is required. Create dedicated retention/cache tests and staging transition harness.

**Interfaces:** Preserve environmentselection/buildhardening; retain only validatedsame-sitepreviouspublichashedstaticassets, withmanifest boundedexpiry andobservablecounts. Newrequested-pathHTMLheadersrevalidate whileexplicitstatic/runtimepoliciesremainvalid. NoprivateDBorFunctionsread/write.

- [ ] Add failing header tests forroot,Echi,trailing-slash,unknownSPAroute,staticandruntimeexceptions.
- [ ] Add meaningful retention tests foroldentry/chunkavailability,expiry,targetmismatch,pathtraversal,hashmismatch/partialdownload and hardening preservation.
- [ ] Implement minimalguardedpreviousassetpreservationafterbuild/beforeHostingupload. Nevermakeexistingoldentry404duringfirsttransition.
- [ ] Run existingreleaseguard/deploy/buildtests plus newcoverage. Independentreview cachecontract and commit.
- [ ] Preparebrowserprofileontheoldreleasebeforenextpublish. Laterverifyfreshnessanddistinctold/newbundlehasheswithordinarynavigationbeforeanyreload.

### Task 4: Integrated acceptance, PR and rollout

**Files:** Create docs/coordinator/task-15a-echi-maps/acceptance-checklist.md, currentcontrol/reviewrecords and fresh evidence pointers; browser15Ascenarios and controlledQAhelpers. Keepsecretfixtures/manifestsignoredoroutsiderepo.

- [ ] Reconstruct an explicit15criterionchecklist from userobjective/historicalrunbook; labelnewcontractandoldhistoricalevidenceclearly.
- [ ] Run appropriatefullfrontend/build/harnesschecks, completebrowsermatrix and independentwholebranchreview. Fixallactionablefindings.
- [ ] Open/attachfeature->devsPR, recordreal15minreviewdeadline, inspectcommentsafterdeadline, repeatonupdate, mergeafterCI/review.
- [ ] Onactualdevs guardedHostingdeploywithpreviousassets; verifyliveversion/headers/hashidentity and all15criteria manually includingcachetransition andownedCRUDserverchecks. Fixandreview/redeploy/retest ifneeded.
- [ ] Whenfullyaccepted open/attachdevs->mainPR, obeysame15minreviewinterval,inspectcommentsandCI,merge.
- [ ] Onactualmain deploysame reviewedsourceusingproductionconfig, preservingoldassets andalloriginaldata; repeatallmanualaffectedflowsandpaginatedcleanupverification.
- [ ] Verifybothsourcereleasesaligned,CIgreen,originaldataunchanged,QAabsent;removeonlymergedtemporarybranchesandownedprocesses,cleanGitstatus;savefinalreportandstop_goalcomplete. Ifrequiredsurface/accessgenuinelyunavailablefinishallindependentworkandreportexactblockinsteadoffalsecompletion.
