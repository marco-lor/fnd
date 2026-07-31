# Task 03 - Route and feature code splitting

Depends on Task 02.

## Outcome

Make transferred and parsed code proportional to the active route and opened feature.

## Evidence

- `frontend/src/App.js:4-16` statically imports every route.
- The existing build has a 2.65 MB main JavaScript file and one 7.3 KB async chunk.
- Grigliata imports inactive manager panels up front (`GrigliataPage.js:33-35,133,141-147`).
- Bazaar imports four editors before a role/action can open them (`Bazaar.js:7-10`); DM `playerInfo.js:10-39` imports numerous overlays.
- Several declared frontend dependencies have no production-source import and need ownership review.

## Implementation elements

1. Add route-level lazy boundaries for every page, including public Character Creation and role-protected routes.
2. Keep only bootstrap, Login shell, router/auth gates, and minimal shared layout in the entry graph.
3. Add recoverable loading and chunk-error boundaries that support retry and refresh.
4. Split manager/admin editors, Grigliata inactive tabs, rich media/detail panels, and other rarely opened overlays behind feature-level dynamic imports.
5. Prefetch only after authentication and likely user intent (navigation hover/focus or an explicit product rule). Respect data-saver/slow-network signals.
6. Split Firebase service acquisition where practical so Login does not initialize/import Storage and Functions code it does not use.
7. Audit dependency ownership. Remove confirmed unused runtime dependencies; move script-only/admin packages out of the browser dependency set. Verify dynamic/require imports before removal.
8. Add chunk naming/reporting and CI budgets from Task 01.

## Boundaries and non-goals

- Do not change route URLs, role redirects, Layout placement, or business behavior.
- Do not combine data-model or render optimizations with this task.
- Do not prefetch DM/Admin code for unauthorized users.
- Do not replace the build tool in this task; open a separate decision only if measured constraints remain.

## Tests

- Direct navigation and refresh for every route.
- Auth/profile pending, unauthenticated, player, DM, and webmaster routing while a route is suspended.
- Simulated chunk failure, retry, and a release with old cached HTML.
- Bundle assertions proving Login excludes Konva/Grigliata, Echi maps, DM/Admin, and Bazaar editors.
- Feature assertions proving closed editors/inactive Grigliata tabs are not requested.

## Acceptance gates

- Fresh production manifest contains distinct route and optional-feature chunks.
- Initial gzip meets the Task 01 target or records a reviewed exception with package-level evidence.
- Opening `/home` does not request Grigliata code; ordinary Bazaar does not request editors.
- No route gains extra Firestore listeners merely from prefetch.
