# Task 09A: Bazaar semantics, baseline and price contract

09A characterizes the existing reader. It does not implement 09B summary queries or
09C render/detail isolation. This record distinguishes measured values, source facts,
numeric targets and unavailable evidence. No deployment or remote Git action occurred.

## Current result semantics

The pure oracle is frontend/src/data/bazaarCatalogContract.js. Eight additional
rendered-Bazaar tests compare actual current production component output against it
on 65 rows, including a match and facet value beyond row 50. The production reader
does not import the oracle. Tests cover accents/punctuation, substring/case/whitespace,
OR within facets and AND across groups, affordable-only, summed base/combat sorting,
and numeric zero/false/nested special values.

- Catalog rows require item_type, General, Specific and Parametri; schema rows excluded.
- A missing actor has no UI catalog. Exact role dm queries all items. Webmaster retains
  editor capabilities but does not acquire DM catalog-query scope.
- Non-DM visibility is all, or custom with the authenticated UID in allowed_users.
- Whitespace-only search means no filter. Other search input is used without trimming,
  with case-insensitive arbitrary substring matching against General.Nome.
- Selected values OR within each facet and groups AND together. Special values recurse;
  numeric zero is meaningful, false/null/NaN/blank strings are not.
- Selected level-one base and combat values contribute one descending sum. Missing
  values contribute zero. Equal scores use lowercased localeCompare on display name;
  equal names retain input/Firestore ID order, not an invented tie-break.
- Card/filter price uses General.prezzo; General.Costo remains a legacy field and is
  not silently substituted. Missing future normalized/order fields cannot disappear.
- Facet options come from the complete visible catalog, independent of filtered results.
  A slice of the first page cannot replace complete semantics.
- Candidate summaries exclude embedded spells/techniques and full Parametri detail.

Visibility above is current UI behavior, not database confidentiality: current item
rules allow public reads and existing rules tests explicitly accept anonymous get.
09B must tighten rules with player/custom/DM/webmaster/anonymous coverage and preserve
Home catalog-by-ID acquired history/media consumers. Four editors directly write items.

## Price contract

The existing Task05 callable is authoritative. Wire fields are itemId and operationId.
Client retryKey is converted into operation identity before transport; it is not a
server field. The transaction rereads catalog/resources, validates visibility/current
price/gold, and writes one inventory record plus resource/idempotency records.
CatalogVersion records authoritative snapshot version, not an expected-price precondition.

09A selects server-authoritative-current-price for the future 09B UX. The current modal
has no disclosure. 09B must explain before confirmation that the actual current server
price will be charged. No expected-version rejection or reconfirmation behavior is
claimed to exist. A later precondition contract would require coordinated client/server
rollout and preserve replay of prior successful receipts.

The local callable integration passed 1 scenario in 22.7 seconds. With 500 existing
inventory entries, displayed price 4/server price 9 charges 9. Replay after price 12
returns original result with replayed=true. Two concurrent distinct IDs each charge12
and add distinct inventory records. Gold is 100 -> 91 -> 67; inventory 500 -> 501 ->503.
Insufficient gold and custom-denied purchases create no inventory/success receipts.
Catalog deletion preserves all three acquired snapshots. The prior 500 entries retain
both values and updateTimes. Exact new paths/receipts are cleaned and item/resources
restored. Canonical fixture verification then passes its original 9,139-document hash.

## Fixture and prerequisite fix

Canonical demo-fnd-perf fixture: 1,000 items / 500 inventory entries; canonicalHash
fbabc02a3376d466cf717e3886e0d12a9e15568c17b654322cff4909dc6eaca8.
The sparse canonical item builder uses General.Costo and empty parameters; the historical
canonical route run measured 1,000 catalog docs / 330,024 estimated catalog JSON bytes,
1,010 total docs, 46,942 DOM nodes and max long task290ms, with zero diagnostics errors.
These are a separate sparse-fixture scale baseline, not semantic coverage.

The opt-in task09a-overlay enriches the owned emulator with numeric/string prezzo,
legacy Costo, slots/types/hands, zero/false/nested special values, level-one base/combat
params and actual General.spells objects. Root spell/technique arrays also remain as
full-detail payload. Fifty custom rows are denied, giving 950 player-visible items.
The directory references across 50 allowed custom rows are 15 in first page, 30 beyond
first page and 5 missing, computed from canonical normalizedLabel/ID ordering.
Original full documents are backed up and restored in finally; canonicalized value
hashes verify all 1,000 item and500 inventory documents before backup deletion.

The richer fixture initially crashed ComparisonPanel: numeric3 throws formula.replace
is not a function; numeric0 loses computed zero; string Forza +2 works. Actual panel
RED is 2failed/1passed, then GREEN3passed after a single caller conversion to String.
Shared computeValue remains unchanged. Subsequent baseline is labeled pre-optimization
plus numeric panel crash fix and measurement probes, not byte-identical old source.

## Verified richer baseline

Final opt-in Chromium run passed3 Playwright tests (asset/auth setup plus measurement),
with15 rules and3 directory setup tests passing. Standard performance build passed.
HEAD dc2ddd4aa2c907763f3603ebcf1458e5ec184cef has declared local09A edits.
Build main.955d5296.js SHA256 f1d88537fda2100c9aa2261146b24d04983d040ddc1312580ea3b6256ac6ecb3.
Application source is unchanged since that build; later harness/tests/docs edits are
identified separately. Archived verified-baseline JSON includes exact harness hash,
source/build/fixture identity, browser version and viewport. Windows10.0.19045 x64,
Intel i7-5820K,12 logical CPUs,85,728,866,304 bytes RAM.

| Metric | Measured richer current reader |
| --- | ---: |
| Initial catalog documents | 950 |
| Catalog-only initial JSON estimate | 850,438 bytes |
| All initial listener JSON estimate | 851,347 bytes |
| Initial listener document emissions | 954 |
| Initial DOM nodes | 53,982 |
| Mounted cards / offscreen image elements | 950 / 941 |
| Cold synthetic list/card render deltas | 1 / 950 |
| Warm synthetic list/card render deltas | 0 / 0 |
| 20 deliberate real-pointer list/card deltas | 22 / 20,900 |
| First hover extra progression/shell registrations | 1 / 0 |
| Cold/warm added one-shot documents | 1 / 0 |
| React Profiler commit count/duration | unavailable / unavailable |
| Dropped events / Resource Timing overflow | 0 / false |
| Console/page/request errors | 0 / 0 / 0 |
| Bazaar-owned listeners/resources after cleanup | 0 / 0 |

Cold means fresh context/auth, warmed static assets, no prior route detail/config cache.
Warm repeats on the same page/session. Synthetic20 events take3ms cold/0.9ms warm plus
175ms dwell; React batches them, so this is not20 native transitions. The separate
20-card real pointer trace has deliberate dwell,916-1,142ms per card including scrolling.
It is not the future rapid-below150ms acceptance trace.09C must measure that separately.

The added cold one-shot is configuration work, not item detail. The existing reader
passes full subscription items directly and has no hover item-detail fetch path.
Document emissions are not automatically billable reads. Catalog streaming wire bytes
are unavailable, not0; completed static Resource Timing totals are separately archived.
Offscreen mounted images are counted, not attributed offscreen network requests.
Committed effect probes measure counts; they do not provide React actualDuration.
Separate profiling-enabled evidence is recorded below; these ordinary-build null values remain unchanged.

Three richer runs reproduced docs/bytes/render deltas, DOM53,983/53,983/53,982. The first
two failed harness assertions only (future zero-progression target, then shell-inclusive
cleanup); their complete measured evidence is retained, not counted as passing runs.
The final route-owned cleanup gate passes; authenticated shell stays until context close.
No improvement or09B/09C target pass is claimed.

## Numeric targets before replacement

| Gate | Target |
| --- | --- |
| Default initial query | 50 summaries; first page realtime, explicit cursor pages |
| Initial catalog JSON estimate | <=65,536 bytes; wire transfer separate |
| Hidden client truncation / embedded summary detail | 0 / 0 |
| Search/final-hover debounce | 150ms |
| Cold final item-detail fetches after rapid20-card trace | <=1 |
| Same-session warm item-detail fetches | 0 |
| Additional profile/shell registrations | 0 / 0 |
| Hover-only list derivation reruns | 0 |
| Card updates for20 deliberate transitions | <=40 previous/current updates |
| Measured React commit duration | p95<=16.7ms; profiling measurement still required |
| Initial offscreen card-media requests | 0 under bounded mounting/viewport policy |
| Inventory writes per unique successful purchase | 1 inventory document, O(1) total command writes |

The existing initial-collection-view-bounded-target is500 documents. Task09 tightens
catalog default browse to50; existing route JS regression budget remains unchanged.
Targets are not evidence. Missing timing/network evidence cannot be counted as passes.

## Unresolved09B architecture gates

The user selected a Firebase-only two-mode design: page-bounded default summary browse
plus measured full-catalog scans for advanced filters. This is an architecture direction,
not an implemented reader. No external search infrastructure is authorized:

- Firestore normalizedName binary ordering differs from current localeCompare for
  accents/punctuation. Preserve an explicitly tested collation projection or agree a
  contract change before freezing deterministic ordering. Tentative query objects are
  not equality proof.
- Arbitrary substring, multi-facet OR/AND and selected-stat sums need complete evaluation.
  Core query disjunction limits and stored-field ordering do not directly express all
  cases. No Enterprise deployment is established by this repository.
- A cold full-summary backend scan is O(catalog size), even if response has50 rows.
  The user explicitly permits these measured scans, including persisted advanced filters
  on cold route entry. Advanced scan documents/CPU/latency are separate costs and must
  never be claimed page-bounded. Default unfiltered browse remains page-bounded.
- Audience-complete facet projection remains a proposal. Resolve visibility combinations,
  revocation, cost, editor writes, projection lag and legacy missing fields before use.
- Tightened detail/summary rules must preserve Home acquired history/media consumers.
  Existing minimal userDirectory is manager-only; do not expose privileged records to
  resolve allowed names. Current panel only resolves its first page and can show raw IDs.

The entire Task9 is not complete. Coordinator owns independent native Browser verdict,
staging/production authority and any follow-up profiling measurement. This unit performs
no migration, no reader switch, no deployment and no remote Git mutation.


## Separate React profiling baseline (attempt 3)

`npm.cmd run perf:build -- --profile` uses installed CRA production profiling support.
Its `profile-build-report.json` confirms react-dom/profiling.js and
react-dom/cjs/react-dom.profiling.min.js. Ordinary reports remain unchanged.
Profiling main.d29d3357.js SHA256 is
5076393bee9e36edc89adace2d267e90f6dda19a7a72d073964573cbe66595bf.
These measurements must not be compared to non-profiling totals as before/after gains.

The same richer fixture and machine/browser/viewport definitions were measured twice
with `FND_PERF_REACT_PROFILE=1` and Playwright `--repeat-each=2`. Four tests passed
(two setup plus two measurement tests). Each iteration starts a fresh context, repeats
synthetic hover warm in the same session, then visits 20 real pointer deliberate dwells.
No native rapid-pointer target is claimed. Both runs have zero dropped events, errors,
Resource Timing overflow and Bazaar-owned cleanup leaks; exact fixture restoration passes.

| Profiling window | Run 1 count / total ms / p95 ms | Run 2 count / total ms / p95 ms |
| --- | --- | --- |
| Cold | 17 / 231.5 / 175.2 | 18 / 264.2 / 200.0 |
| Synthetic cold hover | 8 / 126.4 / 124.4 | 8 / 123.0 / 120.7 |
| Synthetic same-session warm | 1 / 0 / 0 | 1 / 0 / 0 |
| 20 deliberate pointer dwells | 132 / 1338.9 / 65.0 | 131 / 1550.4 / 74.9 |

Values are real React Profiler actualDuration for rendering the Bazaar subtree on each
commit, not full DOM commit/paint latency. Warm emits a measured zero-duration bailout
commit, distinct from missing telemetry. The p95 target is 16.7 ms: cold and deliberate
windows miss it in both iterations. Warm is a no-op workload, not an improvement claim.
Two observations document repeatability and variation, not a statistical confidence bound.
Deliberate total render work varies approximately 15.8%; its count differs by one commit.

Authoritative artifacts are the dedicated profile JSON and profile build report archived
under coordinator attempt-03 evidence. The standard browser-report.json generated by
teardown is excluded: its report.js still reads the ordinary build report. The ordinary
raw baseline and build-report hashes were verified unchanged. An ordinary guarded
build and disabled-instrumentation verification follow these measurements.

Profiling changes the audited WebChannel wrapper spelling to function(){i()}. Its build
has exactly one executable setTimeout wrapper and three total occurrences: the wrapper,
the runtime pin literal, and an unrelated web-vitals pointercancel callback. The latter
is not a timer. The ordinary function(){e()} guard remains one executable/two total.
No errors or cleanup requirements are suppressed by the profiling path.

Final ordinary guarded `npm.cmd run build:performance` passed, followed by
`npm.cmd run perf:verify-disabled`: no performance bridge, profiler, benchmark or
persistence-experiment artifacts. Owned emulator ports and helpers are stopped.
