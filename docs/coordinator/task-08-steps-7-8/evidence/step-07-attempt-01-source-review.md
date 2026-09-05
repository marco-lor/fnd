# Step 7 attempt 1 — independent source review

Verdict: **RED / remediation required**.

## Important finding: Strict Mode leaves the consumable owner permanently unmounted

- `frontend/src/index.js` renders the application inside `React.StrictMode`.
- `useConsumableAction` initializes `mountedRef` to `true`, but its empty-dependency effect only returns a cleanup that sets the ref to `false`; the effect setup never restores it to `true`.
- React 18 development Strict Mode runs the initial effect setup/cleanup/setup probe on the same hook state. After the probe, `mountedRef.current` remains `false`.
- Every `actionMatchesCurrentScope` check then fails, so `begin()` can publish the initial preparing view but `runPrepare()` returns without invoking the authoritative preparation. The action remains wedged and busy.
- The focused tests render the harness without `React.StrictMode`, so the current 17/17 and broader React runs do not cover this application lifecycle.

Required remediation: make the mount effect symmetric (`mountedRef.current = true` in setup, cleanup sets it false) and add a regression that mounts the real hook under `React.StrictMode` and proves one logical begin reaches exactly one preparation and one commit. Audit cancellation telemetry so the Strict Mode probe does not emit a false user cancellation or discard valid logical ownership.

## Blocking verification concern: the final integrated Chromium run is not green

- The final report is partial/non-official and reports `5/6`, not `6/6`.
- The failed Home scenario records four local Storage image requests as `net::ERR_ABORTED` after the journey navigates into route cleanup.
- A prior run passing Home and a later run passing the corrected two-client scenario are useful debugging evidence, but they are not one source-matched complete run.

Required remediation: determine the exact lifecycle/ownership cause. Do not broadly ignore `net::ERR_ABORTED` or all image failures. If these are provably cancellation of already-settled local fixture images caused solely by the harness's own cleanup navigation, encode only that narrow classification with focused tests and preserve visibility in explained diagnostics. Otherwise fix the product/harness race. Produce a fresh, source-matched full Chromium `6/6` report after the code fix.

No Step 8 work is authorized until this remediation is independently accepted.
