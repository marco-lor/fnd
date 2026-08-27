# Firebase environment operations

The shared `fnd` checkout has one explicit Firebase target registry in
`frontend/scripts/firebase-environment.js`. Every release, build, maintenance,
and emulator entry point must provide the semantic environment plus the exact
project, Hosting site, and Storage bucket.

| Environment | Allowed branch | Firebase project / Hosting site | Storage bucket |
| --- | --- | --- | --- |
| `production` | `main` | `fatins` / `fatins` | `fatins.firebasestorage.app` |
| `staging` | `devs` | `fatin-test` / `fatin-test` | `fatin-test.firebasestorage.app` |
| `performance` | any checked-out ref | `demo-fnd-perf` / `demo-fnd-perf` | `demo-fnd-perf.appspot.com` |

Production and staging are deployable environments. Performance is emulator-
only and is never a release target. A detached or unknown Git ref cannot
select production or staging.

From `frontend`, use the branch-specific commands:

- On `main`: `npm run build:production`, `npm run fb:deploy:all`, or the
  production `fb:deploy:*` / maintenance commands.
- On `devs`: `npm run build:staging`, `npm run verify:staging-build`, or the
  `fb:deploy:staging:*` / staging maintenance commands.
- For local performance work: `npm run fb:emulators`, `npm run perf:ci`, or
  the `perf:*` commands. These use `demo-fnd-perf` and local emulators.

`frontend/.firebaserc` intentionally has no default project. Do not use
ambient `firebase use` or a bare `firebase deploy`: the release wrappers pass
the explicit target, and Firebase predeploy guards fail closed when the
semantic environment, branch, project, site, or bucket is absent or mismatched.

App Check and the runtime client endpoint remain environment-specific. The
production and staging release paths verify their own runtime prerequisites and
App Check configuration; do not copy credentials, `.env.local` files, or
Firebase data between environments.
