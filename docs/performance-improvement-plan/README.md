# FND performance improvement plan

This directory is a read-only architecture and implementation plan created on 2026-07-17. No production code was changed as part of the audit.

The tasks are intentionally ordered and must be implemented one at a time. Each task should land as a separately measurable change. Do not start a later task until the preceding task's acceptance gates pass, unless the later file explicitly marks work as independent.

## Documents

- [`00-performance-audit.md`](./00-performance-audit.md) contains the repository-wide analysis, evidence, priorities, route coverage, and baseline.
- [`tasks/`](./tasks/) contains the sequential implementation tasks.

## Required sequence

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
| 10 | [Bazaar editor consolidation](./tasks/10-bazaar-editor-consolidation.md) | On-demand, shared, low-read editors | Medium-High |
| 11 | [DM Dashboard and Admin](./tasks/11-dm-dashboard-and-admin.md) | Summary/detail loading, projected directories, scalable bulk actions | High |
| 12 | [Codex data-model migration](./tasks/12-codex-data-model-migration.md) | Replace the single unbounded Codex document | High |
| 13 | [Tecniche/Spell and Foes Hub](./tasks/13-tecniche-spell-and-foes-hub.md) | Shared user/config flow, bounded lists, safer media/actions | Medium |
| 14 | [Combat Tool scaling](./tasks/14-combat-tool-scaling.md) | Bounded encounters and listener count that grows by chunks | High |
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

## Standard fixture sizes

The baseline task may refine these values, but later tasks should keep a stable named fixture:

- 200 users with realistic profiles, stats, inventory, spells, and techniques.
- 1,000 Bazaar items and 500 inventory entries.
- 500 foes, 500 NPCs, and 2,000 Echi markers.
- 100 encounters, including one 40-participant encounter and 1,000 log entries.
- Codex with 20 categories and 5,000 items.
- Grigliata with 200 placements, 100 x 100 grid, 200 walls, 20 light/darkness sources, 512-1,024 fog tiles, five peers, and 500 library assets.

## Baseline verification observed during this audit

- Existing production main JavaScript: 2,652,877 bytes raw, 700,738 bytes gzip, 529,252 bytes Brotli.
- Existing route-independent async JavaScript: one 7,341-byte chunk.
- Echi map PNGs: 7,994,651 and 6,894,688 bytes.
- Frontend test suite: 52 suites and 624 tests passed in 79.74 seconds with `--watchman=false`; the run emitted repeated async `act(...)` and unimplemented media cleanup errors.
- Production-build verification passed.
- Functions TypeScript `--noEmit` passed; Functions lint completed with 20 warnings because compiled `lib` output is included in lint scope.

These are directional measurements from the current checkout. Task 01 must regenerate and persist the authoritative baseline.
