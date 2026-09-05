# Task 08 Step 6 — coordinator Browser review, Attempt 12

## Scenario recorded before interaction

- Review owner: coordinator.
- Surface: new agent-controlled in-app Browser tabs at `http://127.0.0.1:5000/` only. The existing `https://fatin-test.web.app/home` tab is excluded and must not be inspected, navigated, or reused.
- Checkout/revision: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`, branch `devs`, HEAD `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`, dirty working tree intentionally preserved.
- Source identity: tracked diff `c6565b3b24ca56878a17e17a7ec6860d1faa6d33da5f94cde2e6b33bf60d4ce8`; source tree `6235c283cf134a4e2c3d6b9a015da4bf2e05a47a02b8300f4d0a0e2ecc9dc902`.
- Performance build: local opt-in `demo-fnd-perf` build generated `2026-09-01T17:23:20.754Z`; main asset `static/js/main.f7101a4b.js`, SHA-256 `6a95632f3602f2dcce08e0efd2be21b3c5e269c8ba54e46161047d59c2e6e088`.
- Test identity/data: deterministic local account `perf-player@example.test`; fixture project `demo-fnd-perf`, expected initial HP `45/50`, mana `24/30`, essenza `8/10`, barrier `0/0`, 9,139 documents, 136 storage objects, fixture hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.
- Permitted mutations: only task-owned local emulator fixture mutations needed to exercise resource controls. No remote Firebase access or deployment.
- Expected observations:
  1. Mouse short activation immediately shows one optimistic tick and produces one authoritative mutation only after release.
  2. Touch-equivalent short activation follows the same one-gesture/one-command contract.
  3. A two-second hold displays responsive 200 ms optimistic ticks and settles through one authoritative delta command with no duplicate, pending, or failure terminal.
  4. Pointer cancellation and lost capture clear ownership/timers without duplicate dispatch or stuck optimistic state.
  5. Barrier controls remain within authoritative floor/ceiling bounds.
  6. A second localhost client can overlap a resource update with client A; both converge without losing either delta.
  7. Resource updates leave Navbar, Inventory, EquippedInventory, Extra, and ParamTables outside the measured resource-render window; no unexplained console/page errors occur.
- Cleanup: restore and verify the deterministic fixture; close only coordinator-created localhost tabs; gracefully stop only the coordinator-owned emulator process tree; restore the normal `devs` staging build and verify instrumentation is disabled; prove every Task 08 harness port free. Do not touch the existing staging tab.

## Observed result

Verdict: **RED because owned-process cleanup failed**, although the Step 6 product gesture behavior observed in the localhost Browser was green.

- Local sign-in reached `/home` with the expected deterministic fixture and no interaction with the open staging tab.
- Short mouse activation: HP `45/50 -> 44/50`; the authoritative document changed `revision 1 -> 2` and `hpCurrent 45 -> 44`, proving one command/application.
- Physical held gestures through Browser CUA:
  - a 339 ms hold displayed/settled `44/50 -> 42/50`;
  - a 1,686 ms hold displayed/settled `42/50 -> 33/50`;
  - a 1,904 ms near-two-second hold displayed/settled `33/50 -> 23/50`, while the authoritative document changed only `revision 4 -> 5` and `hpCurrent 33 -> 23`;
  - a further held gesture was sampled while active at `21/50`, then `19/50`, then settled at `17/50`, visibly proving responsive optimistic ticks rather than a release-only update.
- Cancellation/lifecycle cleanup: during an active physical hold, client A displayed a pending `14/50`; direct local navigation to `/bazaar` unmounted the Home route before release. The authoritative document remained exactly `revision 6`, `hpCurrent 17`, and returning to `/home` displayed `17/50` with no stale overlay or delayed write.
- Barrier bounds: activating a local `5/5` barrier disabled its increment controls at the ceiling. A held decrement longer than the available barrier settled at `0/5`; the authoritative document changed only `revision 7 -> 8` with `barrieraCurrent 5 -> 0` and `barrieraTotal 5`, so the one committed gesture was transaction-clamped at the floor.
- Two-client overlap: client A began a 1,109 ms Mana hold and displayed `22/30` while active; client B issued `+1 Mana` before client A released. Both tabs converged to `20/30`, and the authoritative document changed `revision 8 -> 10`, proving exactly two overlapping commands without a lost update.
- Tap-style short physical activation through Browser CUA changed Essenza `8/10 -> 7/10` on both clients and advanced the authoritative document once to `revision 11`. The Browser backend does not expose hardware touch `pointerType`; the actual touch/pen pointer lifecycle remains covered by the independently green focused automated suite rather than being claimed as hardware-touch evidence.
- Final Home inspection retained the Home navigation and `Fixture item 321` inventory row while resources updated. Both local tabs reported zero console warnings/errors. A final in-app Browser screenshot showed the stable Home layout and resource controls.
- Browser-created localhost tabs were closed. The deterministic fixture was restored and independently verified at 9,139 documents, 136 storage objects, and hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`.

## Blocking cleanup reproduction

1. The coordinator started `npm.cmd run perf:emulators` in one owned PTY with command-scoped JBR 25 and completed the Browser matrix.
2. One Ctrl+C was sent to that PTY. All Task 08 ports became free, but the command did not exit after more than four bounded-shutdown windows.
3. The exact still-live owned parent chain was:
   `pwsh 19120 -> cmd 12500 -> node 19036 -> cmd 9988 -> node 14976 (emulators.js) -> node 17152 (Firebase supervisor/CLI)`.
   The CLI still had child PIDs `4864` and `5876`. No unrelated process was included.
4. Because graceful cleanup had released all ports but leaked the complete owned wrapper tree, the coordinator terminated only that revalidated tree with `taskkill /PID 19120 /T /F`; every listed owned PID exited.
5. Final cleanup then passed: normal `devs` staging build restored, `verify:staging-build` green, `perf:verify-disabled` green, fixture verified, and `HARNESS_PORTS_FREE` green.

This is an Important lifecycle regression in the new Windows shutdown path: port freedom is necessary but the owned command/process tree must also terminate without coordinator force cleanup. Step 6 is not accepted until a deterministic test-backed repair reproduces and closes this exact interactive Ctrl+C/early-Firebase-shutdown ordering.
