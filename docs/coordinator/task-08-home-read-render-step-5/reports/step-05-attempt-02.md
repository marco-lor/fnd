# Task 08 Step 5 developer report — attempt 2

status: DONE_WITH_CONCERNS
callback_delivery: failed

The single direct callback attempt was rejected by the app safety boundary as
an unverified external-thread transfer. It was not retried. The identical
authenticated callback payload is returned in the developer task's final
response for coordinator intake, as required by the fallback contract.

## Objective and boundaries

Remediated all three Attempt-1 review findings in the existing `fnd-devs`
checkout: Inventory pagination now resets for filter lifecycle and data-identity
changes, Inventory gold accepts the selector-shaped scalar value, and committed
render accounting has exactly one authoritative owner per component.

All Step 2–4 and Attempt-1 Step 5 state was preserved. No Step 6 or Step 7 work
was started. No remote Firebase state was read or mutated. No commit, push,
merge, pull request, deployment, accepted-baseline mutation, dependency upgrade,
reset, stash, discard, user-owned cleanup, or worktree change was performed.
The coordinator-owned manual localhost Browser gate remains outstanding and is
the reason for `DONE_WITH_CONCERNS`.

## Control and workspace identity

- Control ID: `task08-home-step5-c07137fad080`
- Callback token: `4ce23a09-2a5f-4b13-b302-ebea4f7b7f4a`
- Step / attempt: `5 / 2`
- Developer task ID: `01a05428-79f1-7fa3-bd3e-2d8a2c59045f`
- Exact checkout: `C:\Users\Marco\OneDrive\git_projects\fnd-devs`
- Canonical `fnd` checkout: not edited
- Branch/upstream: `devs` / `origin/devs`; final divergence `0` behind / `1` ahead
- Baseline and current SHA: `9c7fcc7c5799a458768512b7cbab49e4d9b301a9`
- Starting tracked fingerprint:
  `58f951f992b356ca8556873c79ee552b1448f68df54f3966be8feeebb6d586fc`
- Starting source fingerprint:
  `365bbf928249717a902d290e40cd77d421654c034c65321c574e6135482b60c3`
- Browser-run tracked fingerprint:
  `284f697d072eafd2ce8ef7c1707fff0f72ba100eeb5af2406c92b74025f77c41`
- Browser-run source fingerprint:
  `d593623c55819be84eb8095c9f70ecb3e431d9d553312328962f7e46bb9c6abf`
- Final tracked fingerprint:
  `336ce85a851c3599f81693b39b891a08a5522391b239aaaa025041830cd5358d`
- Final source fingerprint:
  `6e0b768fdb868721ebba8ee6c264d1d8398981ca4a2f48787d722dd690fb0d86`
- Final opt-in performance build identity:
  `f7b1ccba13770ffbaad387fcfc90b2c73a65136bc33035397a1054646319b822`
- Final main asset: `static/js/main.47b05f2b.js`, SHA-256
  `410ba8982fe309084f5e9a75606b65e8cbc6f7ae9026c74837d3e2e941c4acca`

The browser observation preceded the required additive README entry. After the
README append, the opt-in performance build and preflight were rerun, producing
the final source-matched identity above. This report is an untracked Markdown
artifact and is excluded from Task 08 source/test fingerprinting.

## Finding remediation

### 1. Inventory window lifecycle

`Inventory` now associates its expanded count with both the active query and
the current filtered-item identity. Input changes synchronously reset the
actual stored count to `60`, and a same-query item-set shrink invalidates prior
expansion so later growth cannot resurrect a stale deep window.

Regression coverage proves:

- exact 500-item fixture: `60 -> 120`, deep query `Fixture item 315 -> 1`,
  clear -> `60`;
- a fully mounted 120-item list: filter item 115 -> `1`, clear -> `60`;
- same-query `500` expanded to `180`, shrink to `40`, regrow to `500` -> `60`;
- ordinary accessible expansion remains `60 -> 120`.

The browser scenario now asserts initial `60`, expanded `120`, deep-filter
result `1`, cleared/reset `60`, and accessible re-expansion `120`.

### 2. Selector-shaped gold

Inventory consumes `useResources(..., value => value?.gold ?? 0)` as the scalar
selector result it actually returns. Finite numeric values and legacy numeric
strings normalize correctly; malformed values remain zero. Regression coverage
asserts display of `100` and a command-layer adjustment delta of `5`.

### 3. Authoritative committed render ownership

`PerformanceProfiler` now distinguishes committed probe evidence from auxiliary
React Profiler samples. A wrapper can declare `committedProbeOwner="child"`,
which suppresses its own probe while leaving the child probe authoritative.
Task 08 aggregation counts only events tagged `committed: true` and
`authoritative: true`; React Profiler events remain observable but cannot
double-count.

Regression coverage proves wrapper-plus-child ownership, a child-local update,
wrapper-only ownership, and a mixed authoritative/auxiliary contract stream
that counts exactly one committed render.

## Test-first evidence

The first contract RED run had exactly the three intended failures:

- missing `home.inventory.resetMountedItemCount` metric;
- reset mounted count was `undefined` instead of `60`;
- mixed render evidence counted `3` instead of authoritative count `1`.

The first focused React run was behavior-green except for one five-second test
timeout caused by mounting all 500 rows in the separate full-expansion case.
That distinct test was right-sized to 120 rows while the required exact-500
deep-filter lifecycle regression remained intact.

Final focused results:

- Inventory independently: `13/13` tests;
- five affected React suites: `5/5` suites, `25/25` tests;
- Task 08 contract: `11/11` tests.

## Fresh verification

| Gate | Result |
| --- | --- |
| Full React suite | PASS — `156/156` suites, `1,442/1,442` tests, `0` snapshots, clean exit (`129.825s`). |
| Functions TypeScript compile | PASS — `105` output files; no retired Task 05 artifacts. |
| Full performance test gate | PASS — `423/423`, `0` failed/skipped/cancelled. |
| Staging build | PASS on explicit `devs`; `static/js/main.1c45d437.js`. |
| Staging build verification | PASS. |
| Performance-disabled verification | PASS — no performance instrumentation. |
| Opt-in performance build | PASS; final source-matched build identity recorded above. |
| Performance preflight | PASS — Node `22.22.2`, command-scoped Java 21+. |
| Task 08 behavior, `--skip-browser` | PASS — React `4/4` suites (`65/65`), Node `4/4`, callable emulator `16/16`, fixture `9,139`, clean shutdown. |
| Full Task 08 browser | PASS — `6/6` Playwright stages in `4.4m`, complete report, managed cleanup. |
| Fixture determinism | PASS — `9,139` documents, hash `fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8`. |
| Diff hygiene | PASS — `git diff --check` emitted only existing LF-to-CRLF notices, no whitespace error. |

The first sandboxed `perf:test` run passed `419/423`; the only four failures
were Firebase CLI config-store permission errors. The host-permission rerun
passed `423/423`. Focused React tests used `--no-watchman` after Watchman access
was denied by the host boundary.

After the performance build, the first behavior invocation was interrupted
when inherited Windows `Path`/`PATH` casing caused the Functions emulator to
reject `node`. The required ports and generated ownership markers were checked
and found clean. A command-scoped PATH normalization and the authorized local
JDK then produced the passing behavior and browser runs reported above.

## Browser evidence

Report: `frontend/performance-results/task08-baseline.json`

- Run ID: `8409d721-e7c6-41b6-a476-95ead66d4854`
- Complete: `true`
- Official baseline: `false`
- Chromium / Playwright: `149.0.7827.55` / `1.61.1`
- Compact targets / listener opens: `6 / 7`
- Total authoritative committed renders, Navbar / StatsBars / Inventory /
  EquippedInventory / Extra / ParamTables: `2 / 17 / 43 / 37 / 2 / 9`
- Resource-window authoritative committed renders, same order:
  `0 / 11 / 0 / 0 / 0 / 0`
- Mutations / applied / non-replayed: `11 / 11 / 0`
- Requested / applied delta: `-11 / -11`
- Inventory total / deep result: `500 / 1`
- Inventory mounted initial / reset / expanded / window limit:
  `60 / 60 / 120 / 60`
- Inventory media requests: `null`
- Consumable prepare / commit / atomic outcome: `1 / 1 / committed`
- Login authoritative committed renders: Login `15`, decorative background `2`,
  orbs `2`, border `2`, header `2`, submit `7`, create `7`
- Two-client and Character Creation scenarios: passed

The browser report is local reproducibility evidence only and remains
`officialBaseline=false`. Manual localhost Browser acceptance is owned by the
coordinator and is not claimed by this developer report.

## Warnings and concerns

- The coordinator-owned manual localhost Browser gate is still pending.
- Expected local warnings were Browserslist/caniuse-lite age, Node `punycode`,
  Playwright color handling, Firebase/Java emulator diagnostics, and intentional
  negative-path rules/test console output.
- No production or staging Firebase state was contacted or changed.

## Requested action

`review`

Independently review the three scoped remediations, authenticate the Attempt-2
callback, inspect the fresh source/build/browser evidence, and run the
coordinator-owned localhost Browser acceptance gate before accepting Step 5.
