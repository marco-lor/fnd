# FND performance improvement plan

This architecture and implementation plan originated in the 2026-07-17 read-only audit. Tasks 09-22 were revised on 2026-09-05 against current source; this revision changes documentation only. The audit and Tasks 01-08 remain historical records.

Task 09 is the normal next step. Accept one implementation unit at a time, but follow explicit dependencies rather than a blanket total order. A task number is a roadmap position, not a requirement to postpone unrelated correctness work.

## Current planning status and dependencies

Tasks 09-22 distinguish delivered source foundations from remaining work. Source presence does not establish staging acceptance, production deployment or a fresh performance baseline. Verify actual release evidence before implementation. The earlier Task 07 source-closure note is superseded here as a sequencing guide, without changing historical evidence.

Independent candidates include 15A map delivery, 15B NPC deduplication, 18A video lifecycle and 20A fog concurrency assessment. Keep Task 09 next unless the user selects another unit. The implementation still proceeds one accepted unit at a time.

The explicit dependency graph is: 09 <- 04/05/07; 10 <- 04/07 (09 only for summary consumers); 11 <- 04-07; 12 <- 04/06; 13 <- 04-07; 14 <- 03/04/05; 15 <- 04/07; 16 <- 04-07; 17 store changes <- 16 (local input independent); 18A <- 07; 18B <- 21B ownership decision; 18C <- 18B; 19 <- 04/07 (18 only for consumed outputs); 20 <- 04/05; 21 <- 04-07; final 22B <- all accepted units. Agree contracts between 19 and 20 without making either whole task depend on the other. 21B does not depend on 18, so the forward reference creates no cycle.

## Documents

- [`00-performance-audit.md`](./00-performance-audit.md) contains the repository-wide analysis, evidence, priorities, route coverage, and baseline.
- [`tasks/`](./tasks/) contains the sequential implementation tasks.

## Roadmap order

| Order | Task | Primary outcome | Risk |
|---:|---|---|---|
| 01 | [Performance baseline and budgets](./tasks/01-performance-baseline-and-budgets.md) | Reproducible measurements and CI gates | Low |
| 02 | [Async bootstrap, auth, and shell cache](./tasks/02-async-bootstrap-auth-and-shell-cache.md) | Remove blocking config load and duplicate auth/profile work | Medium |
| 03 | [Route and feature code splitting](./tasks/03-route-and-feature-code-splitting.md) | Stop Login and ordinary pages loading the whole application | Medium |
| 04 | [Firestore access foundation](./tasks/04-firestore-access-foundation.md) | Shared subscriptions/config, bounded queries, indexes, telemetry | Medium |
| 05 | [User and inventory data-model migration](./tasks/05-user-and-inventory-data-model-migration.md) | Stop high-frequency writes retransmitting a growing user aggregate | High |
| 06 | [Functions and backend scaling](./tasks/06-functions-and-backend-scaling.md) | Reduce trigger/callable amplification, region latency, and batch failures | High |
| 07 | [Media and global shell runtime](./tasks/07-media-and-global-shell-runtime.md) | Thumbnails, bounded caches/preload, efficient visual/audio shell | Medium |
| 08 | [Login, character creation, and Home](./tasks/08-login-character-creation-and-home.md) | Remove duplicate reads and high-frequency stat writes | Medium |
| 09 | [Bazaar catalog data path](./tasks/09-bazaar-catalog-data-path.md) | Bounded summaries, pagination, authoritative purchasing | High |
| 10 | [Bazaar editor consolidation](./tasks/10-bazaar-editor-consolidation.md) | Preserve lazy editors; reduce measured data/form work | Medium-High |
| 11 | [DM Dashboard and Admin](./tasks/11-dm-dashboard-and-admin.md) | Summary/detail loading, projected directories, scalable bulk actions | High |
| 12 | [Codex data-model migration](./tasks/12-codex-data-model-migration.md) | Replace the single unbounded Codex document | High |
| 13 | [Tecniche/Spell and Foes Hub](./tasks/13-tecniche-spell-and-foes-hub.md) | Shared user/config flow, bounded lists, safer media/actions | Medium |
| 14 | [Combat Tool removal](./tasks/14-combat-tool-removal.md) | Retire exclusive page/wiring while preserving shared turns | High |
| 15 | [Echi di Viaggio](./tasks/15-echi-di-viaggio.md) | Compress maps, deduplicate NPC data, bound marker/list rendering | Medium |
| 16 | [Grigliata realtime data plane](./tasks/16-grigliata-realtime-data-plane.md) | Tab-scoped listeners and incremental stable stores | High |
| 17 | [Grigliata board render and input](./tasks/17-grigliata-board-render-and-input.md) | Contained Konva renders and frame-coalesced input | High |
| 18 | [Grigliata video and visibility](./tasks/18-grigliata-video-and-visibility.md) | Frame-driven video and one visibility computation engine | High |
| 19 | [Grigliata incremental fog atlases](./tasks/19-grigliata-incremental-fog-atlases.md) | Dirty-tile/dirty-atlas updates instead of full rebuilds | High |
| 20 | [Grigliata fog persistence](./tasks/20-grigliata-fog-persistence.md) | Concurrency-safe, bounded, recoverable brush persistence | High |
| 21 | [Grigliata writes, music, and migrations](./tasks/21-grigliata-writes-music-and-migrations.md) | Narrow atomic writes, one music runtime, no route-time migrations | High |
| 22 | [Final validation and rollout](./tasks/22-final-validation-and-rollout.md) | Prove targets, staged rollout, operations handoff | Medium |

## Rules for every task

1. Capture the task's before metrics on the same fixture and machine used for after metrics.
2. Preserve authorization, visibility, gameplay rules, direct-navigation behavior, and data durability unless the task explicitly changes a contract.
3. Add correctness tests before replacing a data path. Timing assertions belong in controlled browser benchmarks, not brittle unit tests.
4. Validate Firestore queries against emulator rules and checked-in indexes.
5. Keep migrations versioned, idempotent, resumable, observable, and reversible until verification is complete.
6. Do not claim a gain from file splitting or `React.memo` alone. The acceptance metric must show reduced bytes, reads, writes, commits, draw calls, latency, or memory.
7. Record unexpected regressions and stop the sequence rather than compensating for them in a later task.

8. For every unit, record source/build identity, fixture, machine/browser, cold/warm mode, current values, numeric targets and repeatability. Existing `.github/workflows/performance.yml` and `frontend/performance/budgets.json` are the starting gates. A missing budget is a decision to resolve before implementation, never a claimed pass.
9. Each release owns correctness tests, migration compatibility, rollback/restore strategy, and observation criteria before changing a reader or writer. Task 22 consolidates evidence; it does not supply delayed safeguards.
10. Keep local checks, staging Browser/manual acceptance and authorized production release separate. Production is `main` -> `fatins`; permanent `devs`/`fnd-devs` -> `fatin-test` staging; `demo-fnd-perf` is isolated and non-deployable. Use guarded repository release commands and explicit project routing. This revision authorizes no deployment, commit, push or data deletion.
11. Choose the smallest implementation that meets a measured user need. Workers, generic schema frameworks, dual writing, operation logs and percentage canaries require justification and actual capability. Preserve all results through paging/search; no hidden collection truncation.

## Standard fixture sizes

The baseline task may refine these values, but later tasks should keep a stable named fixture:

- 200 users with realistic profiles, stats, inventory, spells, and techniques.
- 1,000 Bazaar items and 500 inventory entries.
- 500 foes, 500 NPCs, and 2,000 Echi markers.
- Historical encounter fixture retained for retirement/data-preservation checks only; retained Grigliata initiative/turn/effect journeys replace Combat scaling scenarios.
- Codex with 20 categories and 5,000 items.
- Grigliata with 200 placements, 100 x 100 grid, 200 walls, 20 light/darkness sources, 512-1,024 fog tiles, five peers, and 500 library assets.

## Historical baseline observed during the July 2026 audit

- Existing production main JavaScript: 2,652,877 bytes raw, 700,738 bytes gzip, 529,252 bytes Brotli.
- Existing route-independent async JavaScript: one 7,341-byte chunk.
- Echi map PNGs: 7,994,651 and 6,894,688 bytes.
- Frontend test suite: 52 suites and 624 tests passed in 79.74 seconds with `--watchman=false`; the run emitted repeated async `act(...)` and unimplemented media cleanup errors.
- Production-build verification passed.
- Functions TypeScript `--noEmit` passed; Functions lint completed with 20 warnings because compiled `lib` output is included in lint scope.

These are historical July observations, not current checkout or deployed results. Regenerate compatible evidence through the existing Task 01 harness before claiming gains. The map file sizes were rechecked on 2026-09-05; transfer and visual targets still need measurement.
