# Task 08 Step 6 — attempt 02

## Status

**DONE_WITH_CONCERNS** — Attempt 2 corrects the Attempt-1 reconciliation, scope, pointer, retry, and barrier findings with focused local evidence. The complete emulator/browser/build acceptance matrix remains unrun, so this report requests independent review rather than acceptance.

## Workspace and baseline

- Workspace: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Branch / baseline SHA: `devs...origin/devs [ahead 1]` / `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Accepted pre-Step-6 fingerprints: tracked `336ce85a851c3599f81693b39b891a08a5522391b239aaaa025041830cd5358d`; source `6e0b768fdb868721ebba8ee6c264d1d8398981ca4a2f48787d722dd690fb0d86`.
- Recorded immediately before this report metadata append: tracked `6b6b3c2d77d4726deb086a6e9a112dfc3b794e86`; source `7ba4dd95fbd8577b0eff59d3ae88944777706c62201f47aafe750a4b0d50820c`.
- The complete pre-existing dirty state, including Attempt 1, was preserved. No reset, stash, clean, commit, push, deployment, remote Firebase access, or worktree change occurred.

## Attempt-2 corrections

- `StatsBars` has an explicit active → committing → awaiting-source-ack gesture lifecycle, scoped by accepted UID/repository generation. A callable-first result holds its authoritative `newValue` until the resource revision arrives; a source-first update is recognised by its operation ID and never has the delta added a second time.
- The resource callable returns `previousValue`, `newValue`, `appliedDelta`, and `newRevision`, and writes `lastResourceOperationId`. Later authoritative revisions win; an unrelated concurrent source update remains visible with the local delta still overlaid.
- Pointer starts reject non-primary/non-left input, use pointer capture defensively, and finish only from pointer-up/cancel/lost-capture. Mouse-up is no longer a terminal path; keyboard remains one logical delta.
- Definitive callable failures roll back. One ambiguous transport failure is retried with the exact same idempotency operation ID, preventing a second physical write; a second ambiguous outcome remains visibly retryable rather than silently discarded.
- Barrier delta logic now reads the legacy `stats.barriera` fallback as well as current/total fields before transaction-local clamping.
- Terminal measurement now includes terminal type, resource, effective delta, local sequence, and the active Task-08 hold ID when present.

## RED / GREEN evidence

The original source-ack tests were deliberately RED against Attempt 1: source-first delivery rendered `6/10` for an authoritative `7/10` because the frozen `-1` overlay was added twice; callable-first resolution removed the overlay before source acknowledgement. The first full-suite command in this attempt produced no completion result from the local command runner after its initial Jest banner, so it is recorded as inconclusive rather than passed.

| Command | Result |
| --- | --- |
| Focused `StatsBars.test.js` | PASS — `1/1` suite, `11/11` tests (source-first, callable-first, concurrent source, pointer-only, retry identity included) |
| Focused StatsBars/Home store/command tests | PASS — `3/3` suites, `42/42` tests |
| Functions TypeScript build | PASS — 105 output files |
| Task 08 Node contract | PASS — `11/11` tests |
| `git diff --check` | PASS; existing LF-to-CRLF warnings only |
| Full React suite | Inconclusive — no completion/exit result was emitted by the local command runner after the initial Jest banner; not claimed as green |

## Remaining acceptance boundaries

- The focused callable emulator test, deterministic fixture restoration/determinism, full `perf:test`, local behavior gate, staging build/verify/disabled build, performance build/preflight, and Chromium Task 08 journey were not run.
- The existing browser scenario was not updated/run here to prove a real UI hold plus a second-client concurrent delta. Manual localhost Browser acceptance remains coordinator-owned and was not attempted.
- No production/staging data, deployment, baseline acceptance, or external state was changed.

## Requested action

Review the Attempt-2 source and run the remaining local acceptance matrix before accepting Step 6.
